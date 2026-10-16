import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {resolve} from 'node:path';
import {createSourceReplayGauMedia,SOURCE_REPLAY_PNG_ACK} from './source-replay-gau-media.mjs';
const project=resolve(import.meta.dirname,'..'),policy='web-source-battle-gau-instances-v1';
const sha=b=>createHash('sha256').update(b).digest('hex');
function chunk(name,bytes){
  const tag=Buffer.from(name),body=Buffer.concat([tag,bytes]);let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const length=Buffer.alloc(4),check=Buffer.alloc(4);length.writeUInt32BE(bytes.length);check.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,body,check]);
}
function syntheticPng(){
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(18))),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(t,bytes=syntheticPng()){
  await mkdir(resolve(project,'build/reports'),{recursive:true});const root=await mkdtemp(resolve(project,'build/reports/source-gau-media-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));await symlink(resolve(project,'.venv'),resolve(root,'.venv'),'dir');
  const file='/battle/sprites/'+sha(bytes)+'.png',path=resolve(root,'build',file.slice(1));await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes);
  const catalog={common:{sprites:{pose:{file,width:2,height:2}}},encounters:{1:{gauInstancePolicy:policy,gauInstances:{kind:'source-battle-gau-instances-v1',firstPartyId:501,returnPartyId:502,joinedSourceId:12,
    playerPrefabs:[{kind:'source-enemy-player-appearance-v1',monsterId:600,characterStatusId:12,jobId:1,weaponId:1,gate:null,actor:{sourceId:12,characterAssetId:1,sizeType:1,bodySprites:{WalkL01:'pose'},bodyGeometry:{WalkL01:{synthetic:true}}}}]}}}};
  return {root,path,bytes,catalog,request:{kind:'source-gau-instance-media-v1',operation:'replace',sprites:[{id:'pose',file,width:2,height:2}]},options:{root,compiledDir:resolve(project,'dist'),battleCatalog:catalog,policy,acknowledgement:SOURCE_REPLAY_PNG_ACK}};
}
test('actual content-addressed PNG fully decodes before the existing media lease can become ready',async t=>{
  const f=await fixture(t),media=await createSourceReplayGauMedia(f.options),lease=media.host.prepare(f.request);
  assert.equal(media.evidence.decodedFiles,1);assert.equal(media.evidence.images[0].rgbaSha256,sha(Buffer.alloc(16)));assert.equal(media.evidence.browserPixelsVerified,false);
  assert.equal(lease.status(),'ready');lease.commit();await media.validate();lease.discard();assert.equal(lease.status(),'failed');
  const another=media.host.prepare(f.request);media.retire();assert.throws(()=>another.validate(),/Retired/);await assert.rejects(media.validate(),/Retired/);
});
test('PNG decoding does not accept catalog dimensions as an image-readiness substitute',async t=>{
  const f=await fixture(t);f.catalog.common.sprites.pose.width=4;await assert.rejects(createSourceReplayGauMedia(f.options),/dimensions differ/);
  const bad=await fixture(t,Buffer.from('content-addressed but not a PNG'));await assert.rejects(createSourceReplayGauMedia(bad.options),/PNG decode failed/);
});
test('missing, substituted or unbound source media remain real failures',async t=>{
  const f=await fixture(t),media=await createSourceReplayGauMedia(f.options);
  assert.throws(()=>media.host.prepare({...f.request,sprites:[{...f.request.sprites[0],id:'other'}]}).status(),/Unbound/);
  await writeFile(f.path,Buffer.from('changed'));assert.throws(()=>media.host.prepare(f.request).status(),/changed during/);await assert.rejects(media.validate());
  const missing=await fixture(t);await rm(missing.path);await assert.rejects(createSourceReplayGauMedia(missing.options),/ENOENT/);
});
test('policy, controlled acknowledgement and a complete declared factory are independent requirements',async t=>{
  const f=await fixture(t);await assert.rejects(createSourceReplayGauMedia({...f.options,policy:undefined}),/Missing or unknown/);await assert.rejects(createSourceReplayGauMedia({...f.options,acknowledgement:undefined}),/Explicit/);
  delete f.catalog.encounters[1].gauInstancePolicy;await assert.rejects(createSourceReplayGauMedia(f.options),/Factory cannot grant/);
});
test('async decoding retains its own initial catalog and does not observe later caller mutation',async t=>{
  const f=await fixture(t),pending=createSourceReplayGauMedia(f.options);f.catalog.common.sprites.pose.width=999;delete f.catalog.encounters[1].gauInstances;
  const media=await pending;assert.equal(media.host.prepare(f.request).status(),'ready');await media.validate();
});
