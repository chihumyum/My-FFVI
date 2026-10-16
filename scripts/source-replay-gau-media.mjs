// CPU source replay only. App continues to use its actual browser Image store.
// This adapter decodes content-addressed source PNGs; it cannot create an owned
// character, grant an encounter policy, or claim rendered/native acceptance.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {readFileSync,realpathSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const SOURCE_REPLAY_PNG_ACK='source-png-decoded-controlled-replay-v1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const decodePython=String.raw`
import hashlib,json,sys
from PIL import Image
rows=json.load(sys.stdin);out=[]
for row in rows:
    path=row['path'];before=open(path,'rb').read()
    if hashlib.sha256(before).hexdigest()!=row['sha256']:raise ValueError('Source PNG changed before decode')
    with Image.open(path) as image:
        if image.format!='PNG':raise ValueError('Source media is not PNG')
        image.verify()
    with Image.open(path) as image:
        image.load();pixels=image.convert('RGBA');width,height=image.size
        result={'file':row['file'],'sha256':row['sha256'],'width':width,'height':height,'rgbaSha256':hashlib.sha256(pixels.tobytes()).hexdigest()}
    if open(path,'rb').read()!=before:raise ValueError('Source PNG changed during decode')
    out.append(result)
json.dump(out,sys.stdout)
`;

async function decode(python,rows){
  return await new Promise((yes,no)=>{
    const child=spawn(python,['-c',decodePython],{stdio:['pipe','pipe','pipe']});
    const output=[],errors=[];let size=0,failure=null;
    child.once('error',error=>{failure=error;});
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>4*1024*1024){failure=new Error('Source PNG metadata output exceeded bound');child.kill();}else output.push(bytes);});
    child.stderr.on('data',bytes=>{if(errors.reduce((n,b)=>n+b.length,0)<65536)errors.push(bytes);});
    child.stdin.on('error',error=>{failure??=error;});
    child.once('close',(code,signal)=>{
      if(failure||code!==0||signal)return no(failure??new Error('Source PNG decode failed: '+Buffer.concat(errors).toString('utf8')));
      try{yes(JSON.parse(Buffer.concat(output).toString('utf8')));}catch(error){no(error);}
    });
    child.stdin.end(JSON.stringify(rows));
  });
}

/** Caller supplies the same validated full battle catalog as its Session.
 * Policy/ack are explicit; missing images never become a ready placeholder. */
export async function createSourceReplayGauMedia({root,compiledDir,battleCatalog,policy,acknowledgement}){
  assert.equal(acknowledgement,SOURCE_REPLAY_PNG_ACK,'Explicit controlled PNG acknowledgement required');
  assert(battleCatalog?.common?.sprites&&battleCatalog.encounters,'Actual battle catalog required');
  // Freeze this caller's exact media/factory inputs before the first await.
  const sprites=structuredClone(battleCatalog.common.sprites),encounters=Object.values(battleCatalog.encounters).map(encounter=>structuredClone({gauInstancePolicy:encounter.gauInstancePolicy,gauInstances:encounter.gauInstances}));
  root=resolve(root);compiledDir=resolve(root,compiledDir);
  const api=await import(pathToFileURL(resolve(compiledDir,'src/core/battle-gau-instances.js')).href);
  api.parseWebBattleGauInstances(policy);
  const declared=new Map(),factoryKeys=new Set();
  for(const encounter of encounters){
    if(encounter.gauInstancePolicy===undefined){assert.equal(encounter.gauInstances,undefined,'Factory cannot grant its own policy');continue;}
    api.parseWebBattleGauInstances(encounter.gauInstancePolicy);
    const factory=api.parseBattleGauInstanceContent(encounter.gauInstances);
    factoryKeys.add(JSON.stringify(factory));
    for(const row of factory.playerPrefabs){
      // A source factory gate remains a gate when that instance is requested;
      // it is not a permission to replace the row with another actor.
      if(row.actor===null)continue;
      for(const id of Object.values(row.actor.bodySprites)){
        const sprite=sprites[id];assert(sprite,'Missing source factory sprite '+id);
        assert(Number.isInteger(sprite.width)&&sprite.width>0&&Number.isInteger(sprite.height)&&sprite.height>0,'Invalid source PNG dimensions');
        const match=/^\/battle\/sprites\/([a-f0-9]{64})\.png$/.exec(sprite.file);assert(match,'Unbound source PNG path');
        const value={id,file:sprite.file,width:sprite.width,height:sprite.height,sha256:match[1],path:resolve(root,'build',sprite.file.slice(1))};
        if(declared.has(id))assert.deepEqual(declared.get(id),value,'Conflicting source factory sprite');else declared.set(id,value);
      }
    }
  }
  const files=new Map();
  for(const row of declared.values()){
    const bytes=await readFile(row.path);assert.equal(sha(bytes),row.sha256,'Source PNG differs from content address');
    row.realPath=await realpath(row.path);
    if(!files.has(row.file))files.set(row.file,{file:row.file,path:row.path,sha256:row.sha256});
  }
  const decoded=files.size?await decode(resolve(root,'.venv/bin/python'),[...files.values()]):[];
  assert.equal(decoded.length,files.size,'Incomplete PNG decode acknowledgement');
  const images=new Map();
  for(const image of decoded){assert(files.has(image.file)&&image.sha256===files.get(image.file).sha256&&!images.has(image.file),'Changed PNG decode identity');images.set(image.file,image);}
  for(const row of declared.values()){
    const image=images.get(row.file);assert(image&&image.width===row.width&&image.height===row.height,'Decoded source PNG dimensions differ from catalog');
    assert.equal(await realpath(row.path),row.realPath,'Source PNG target changed');assert.equal(sha(await readFile(row.path)),row.sha256,'Source PNG changed after decode');
  }
  let retired=false;
  const host=api.createBattleGauMediaHost(sprite=>{
    if(retired)throw new Error('Retired source replay media');
    const row=declared.get(sprite.id),image=row&&images.get(row.file);
    if(!row||!image||row.file!==sprite.file||row.width!==sprite.width||row.height!==sprite.height)throw new Error('Unbound source replay factory media request');
    // A late changed physical resource invalidates the real resource lease.
    if(realpathSync(row.path)!==row.realPath||sha(readFileSync(row.path))!==row.sha256)throw new Error('Source replay PNG changed during execution');
    return {complete:true,width:image.width,height:image.height};
  });
  const validate=async()=>{assert(!retired,'Retired source replay media');for(const row of declared.values()){assert.equal(await realpath(row.path),row.realPath);assert.equal(sha(await readFile(row.path)),row.sha256);}};
  const evidence=Object.freeze({kind:SOURCE_REPLAY_PNG_ACK,factories:factoryKeys.size,sprites:declared.size,decodedFiles:images.size,decoder:'Project Python/Pillow verify and full RGBA decode',images:structuredClone(decoded),browserPixelsVerified:false,nativeParity:false});
  return {host,evidence,validate,retire(){retired=true;}};
}
