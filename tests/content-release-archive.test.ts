import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonical} from '../src/core/canonical.js';
import {contentDigest,verifyContent} from '../src/core/content-integrity.js';
import {GameContentRepository} from '../src/core/game-content.js';
import {GameSession} from '../src/core/game-session.js';
import {resolveGameContentReleaseMedia,resolveGameContentReleaseObject,selectGameContentRelease,
  type GameContentReleaseIndex} from '../src/core/game-content-release.js';
import type {GameContentRefsV1,GameContentRefsV2} from '../src/core/game-content-refs.js';
import {compileFrameworkNewGame} from '../src/compiler/framework-new-game.js';
import {sourceNewGameFixture} from './fixtures/source-new-game.js';
import {frameworkNewGameFixture} from './fixtures/framework-new-game.js';
import {sealBatchContent} from './fixtures/content-batch.js';

const compiledDir=fileURLToPath(new URL('../',import.meta.url));
const script=pathToFileURL(resolve(process.cwd(),'scripts/archive-content-release.mjs')).href;
const archive=async(options:Record<string,unknown>)=>(await import(script)).archiveContentPackage({...options,compiledDir}) as
  Promise<{index:GameContentReleaseIndex;release:GameContentReleaseIndex['releases'][number];report:Record<string,unknown>}>;
const raw=(value:unknown)=>Buffer.from(canonical(value)+'\n');
const media=Buffer.from('Controlled media bytes; no PNG/FLAC decoding or browser claim');
const mediaSha=createHash('sha256').update(media).digest('hex');
const packageId='synthetic-history';
const refsURL='/content-packages/'+packageId+'.json';
const prefix='/content-packages/'+packageId;

function sourceFixture(){
  const f=sourceNewGameFixture(),first=sealBatchContent(f.map),futureId=777;
  const future=sealBatchContent({...structuredClone(f.map),mapId:futureId,map:null,name:'Blocked future map',
    blockers:[{reason:'Unimplemented future routine',source:{file:'/original-do-not-read.png',assetPath:'unknown',objectId:'9223372036854775807'}}]});
  const battle=sealBatchContent(f.battle),world=structuredClone(f.world);
  for(const character of Object.values(world.characters))for(const sprite of Object.values(character.sprites)){
    sprite.file='/synthetic/image.png';sprite.sha256=mediaSha;
  }
  world.maps[first.mapId]!.contentHash=first.contentHash;world.maps[first.mapId]!.url=prefix+'/maps/'+first.mapId+'.json';
  world.maps[futureId]={contentHash:future.contentHash,url:prefix+'/maps/'+futureId+'.json',name:future.name,areaId:future.areaId,
    geometryReady:false,defaultGroupReady:false,blockers:structuredClone(future.blockers)};
  // Explicit runtime sound slot, distinct from the original source evidence.
  world.se={kind:'static-audio-catalog',tracks:{controlled:{file:'/synthetic/track.flac',sha256:mediaSha}},groups:[]} as never;
  const catalog=sealBatchContent(world),entry=sealBatchContent({...f.content,worldCatalogHash:catalog.contentHash,
    battleCatalogHash:battle.contentHash,mapContentHash:first.contentHash});
  const refs:GameContentRefsV1={kind:'game-content-refs-v1',profile:'source',development:null,
    world:{url:prefix+'/world.json',contentHash:catalog.contentHash},source:{
      entry:{url:prefix+'/entry.json',contentHash:entry.contentHash},battle:{url:prefix+'/battle.json',contentHash:battle.contentHash}}};
  const files=new Map<string,Buffer>([[refsURL,raw(refs)],[refs.world.url,raw(catalog)],
    [refs.source!.entry.url,raw(entry)],[refs.source!.battle.url,raw(battle)],
    ...[first,future].map(map=>[catalog.maps[map.mapId]!.url,raw(map)] as [string,Buffer])]);
  return {f,first,future,battle,catalog,entry,refs,files};
}

async function withDirectory(work:(root:string)=>Promise<void>){
  const root=await mkdtemp(resolve(tmpdir(),'ffvi-content-history-'));
  try{await mkdir(resolve(root,'build'),{recursive:true});await work(root);}
  finally{await rm(root,{recursive:true,force:true});}
}
function readers(files:Map<string,Buffer>){
  const calls:string[]=[];
  return {calls,readJson:async(url:string)=>{calls.push(url);assert.ok(files.has(url),'Undeclared current JSON '+url);return Buffer.from(files.get(url)!);},
    readMedia:async(url:string)=>{calls.push(url);assert.notEqual(url,'/original-do-not-read.png');return Buffer.from(media);}};
}
function archivedRepository(root:string,index:GameContentReleaseIndex,selector:Parameters<typeof selectGameContentRelease>[1]){
  const selected=selectGameContentRelease(index,selector),calls:string[]=[];
  const repository=new GameContentRepository(async logical=>{
    const ref=resolveGameContentReleaseObject(selected,logical);calls.push(ref.url);
    const value=JSON.parse(await readFile(resolve(root,'build',ref.url.slice(1)),'utf8'));
    await verifyContent(value,ref.contentHash);return value;
  },selected.profile,selected.release.refs);
  return {repository,selected,calls};
}

test('a release captures every world index and original JSON bytes without granting blocked maps or following source evidence',async()=>{
  await withDirectory(async root=>{
    const f=sourceFixture(),reader=readers(f.files),result=await archive({root,packageId,refs:f.refs,...reader});
    assert.equal(result.report.mapIndexCount,2);assert.equal(result.report.jsonCount,5);
    assert.equal(result.report.sourceGameplayAdmitted,false);assert.equal(result.report.batchAdmission,'unassessed');
    for(const [url,hash] of Object.entries(result.release.bindings))
      assert.ok((await readFile(resolve(root,'build/content-releases/objects',hash+'.json'))).equals(f.files.get(url)!));
    const stored=archivedRepository(root,result.index,{kind:'current'}),world=await stored.repository.world();
    const blocked=await stored.repository.map(f.future.mapId,world);
    assert.equal(blocked.map,null);assert.deepEqual(blocked.blockers,f.future.blockers);
    assert.ok(result.release.bindings[f.catalog.maps[f.future.mapId]!.url]);
    assert.equal(result.release.bindings['/original-do-not-read.png'],undefined);
    assert.equal(result.release.mediaBindings['/original-do-not-read.png'],undefined);
    assert.equal(reader.calls.includes('/original-do-not-read.png'),false);
    const bundle=await stored.repository.sourceNewGame();assert.deepEqual(bundle.battle.gameState,f.battle.gameState);
    const track=resolveGameContentReleaseMedia(stored.selected,'/synthetic/track.flac');
    assert.equal(track.sha256,mediaSha);assert.ok((await readFile(resolve(root,'build',track.url.slice(1)))).equals(media));
  });
});

test('repeated archival reuses immutable bytes and does not append duplicate versions',async()=>{
  await withDirectory(async root=>{
    const f=sourceFixture(),reader=readers(f.files),one=await archive({root,packageId,refs:f.refs,...reader});
    const before=await readFile(resolve(root,'build/content-releases/packages',packageId+'.json'));
    const two=await archive({root,packageId,refs:f.refs,...reader});
    assert.equal(two.index.currentReleaseId,one.index.currentReleaseId);assert.equal(two.index.releases.length,1);
    assert.equal(two.report.writtenJSON,0);assert.equal(two.report.writtenMedia,0);
    assert.ok((await readFile(resolve(root,'build/content-releases/packages',packageId+'.json'))).equals(before));
  });
});

test('an indexed but unavailable profile is preserved in the archive and remains rejected by the runtime repository',async()=>{
  await withDirectory(async root=>{
    const f=sourceFixture(),future=sealBatchContent({...f.future,developmentProfile:{kind:'framework-development-v1' as const,
      policy:'omit-anonymous-environment-particles-v1' as const,sourceContentHash:f.future.contentHash,omissions:[]}});
    const world=structuredClone(f.catalog);world.maps[future.mapId]!.contentHash=future.contentHash;
    const catalog=sealBatchContent(world),entry=sealBatchContent({...f.entry,worldCatalogHash:catalog.contentHash});
    f.refs.world.contentHash=catalog.contentHash;f.refs.source!.entry.contentHash=entry.contentHash;
    f.files.set(f.refs.world.url,raw(catalog));f.files.set(f.refs.source!.entry.url,raw(entry));
    f.files.set(catalog.maps[future.mapId]!.url,raw(future));
    const result=await archive({root,packageId,refs:f.refs,...readers(f.files)});
    assert.equal(result.report.preservedProfileBlockedMapCount,1);
    const archived=archivedRepository(root,result.index,{kind:'current'});await archived.repository.sourceNewGame();
    await assert.rejects(archived.repository.map(future.mapId),/development profile mismatch/);
    const original=await readFile(resolve(root,'build/content-releases/objects',future.contentHash+'.json'));
    assert.ok(original.equals(raw(future)));assert.equal(result.report.sourceGameplayAdmitted,false);
  });
});

test('a new initialized version retains the old entry, media and checkpoint for real repository/session restore',async()=>{
  await withDirectory(async root=>{
    const original=await frameworkNewGameFixture(),rawWorld=structuredClone(original.world);
    for(const character of Object.values(rawWorld.characters))for(const sprite of Object.values(character.sprites)){
      sprite.file='/synthetic/image.png';sprite.sha256=mediaSha;
    }
    const worldWithMedia=sealBatchContent(rawWorld),contentWithMedia=await compileFrameworkNewGame({
      sourceEntry:original.sourceEntry,sourceBattle:original.sourceBattle,sourceMap:original.sourceMap,
      world:worldWithMedia,map:original.map,battle:original.battle,entrance:original.content.entry.entrance});
    const f={...original,world:worldWithMedia,content:contentWithMedia},refs:GameContentRefsV2={kind:'game-content-refs-v2',profile:'framework',source:null,development:null,
      world:{url:prefix+'/world.json',contentHash:f.world.contentHash},initialized:{
        entry:{url:prefix+'/entry.json',contentHash:f.content.contentHash},battle:{url:prefix+'/battle.json',contentHash:f.battle.contentHash}}};
    const files=new Map<string,Buffer>([[refs.world.url,raw(f.world)],[refs.initialized!.entry.url,raw(f.content)],
      [refs.initialized!.battle.url,raw(f.battle)],[f.world.maps[f.map.mapId]!.url,raw(f.map)]]);
    const reader=readers(files),first=await archive({root,packageId,refs,...reader});
    const initial=archivedRepository(root,first.index,{kind:'current'}),bundle=await initial.repository.initializedNewGame();
    const game=await GameSession.prepareFrameworkNewGame(bundle.content,bundle.catalog,bundle.map,bundle.battle,{battleHandoff:'prepared'},42);
    const saved=game.checkpoint(),oldOwned=structuredClone(game.state.snapshot());
    const newMap=sealBatchContent({...structuredClone(f.map),name:'Second content version'}),world=structuredClone(f.world);
    world.maps[f.map.mapId]!.contentHash=newMap.contentHash;
    const newWorld=sealBatchContent(world),newEntry=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,
      sourceMap:f.sourceMap,world:newWorld,map:newMap,battle:f.battle,entrance:f.content.entry.entrance});
    refs.world.contentHash=newWorld.contentHash;refs.initialized!.entry.contentHash=newEntry.contentHash;
    files.set(refs.world.url,raw(newWorld));files.set(refs.initialized!.entry.url,raw(newEntry));files.set(f.world.maps[f.map.mapId]!.url,raw(newMap));
    const second=await archive({root,packageId,refs,...reader});assert.equal(second.index.releases.length,2);
    assert.notEqual(second.index.currentReleaseId,first.index.currentReleaseId);
    files.clear(); // Current mutable payloads are gone; neither JSON nor media may fall back.
    const historical=archivedRepository(root,second.index,{kind:'checkpoint',checkpoint:saved});
    assert.equal(historical.selected.release.id,first.release.id);
    const restoredContent=await historical.repository.restoreSessionContent(saved);
    const restored=GameSession.restore(saved,restoredContent.initial,restoredContent.battle,restoredContent.world,{battleHandoff:'prepared'});
    assert.deepEqual(restored.checkpoint(),saved);assert.deepEqual(restored.state.snapshot(),oldOwned);
    assert.ok(historical.calls.every(url=>url.startsWith('/content-releases/objects/')));
    const oldImage=Object.keys(first.release.mediaBindings)[0]!;
    const image=resolveGameContentReleaseMedia(historical.selected,oldImage);
    assert.ok((await readFile(resolve(root,'build',image.url.slice(1)))).equals(media));
  });
});

test('missing unvisited JSON or media and wrong byte digests keep the previous current index',async()=>{
  await withDirectory(async root=>{
    const f=sourceFixture(),reader=readers(f.files);await archive({root,packageId,refs:f.refs,...reader});
    const indexFile=resolve(root,'build/content-releases/packages',packageId+'.json'),before=await readFile(indexFile);
    const original=f.files.get(f.catalog.maps[f.future.mapId]!.url)!;f.files.delete(f.catalog.maps[f.future.mapId]!.url);
    await assert.rejects(archive({root,packageId,refs:f.refs,...reader}),/Undeclared/);
    f.files.set(f.catalog.maps[f.future.mapId]!.url,original);
    await assert.rejects(archive({root,packageId,refs:f.refs,...reader,readMedia:async()=>{throw new Error('Missing historical image');}}),/Missing historical/);
    await assert.rejects(archive({root,packageId,refs:f.refs,...reader,readMedia:async()=>Buffer.from('wrong bytes')}),/digest mismatch/);
    assert.ok((await readFile(indexFile)).equals(before));
  });
});

test('changed JSON bodies and corrupt immutable objects cannot be resealed into a successful release',async()=>{
  await withDirectory(async root=>{
    const f=sourceFixture(),reader=readers(f.files),result=await archive({root,packageId,refs:f.refs,...reader});
    const indexFile=resolve(root,'build/content-releases/packages',packageId+'.json'),before=await readFile(indexFile);
    const mapURL=f.catalog.maps[f.first.mapId]!.url,old=f.files.get(mapURL)!;
    f.files.set(mapURL,raw({...f.first,name:'Tampered without new source hash'}));
    await assert.rejects(archive({root,packageId,refs:f.refs,...reader}),/Content payload changed/);f.files.set(mapURL,old);
    const object=resolve(root,'build/content-releases/objects',result.release.bindings[mapURL]!+'.json');
    await writeFile(object,'corrupt object');
    await assert.rejects(archive({root,packageId,refs:f.refs,...reader}),/Immutable object bytes/);
    assert.ok((await readFile(indexFile)).equals(before));
  });
});

test('a resealed index with a forged release ID or a changed package profile is rejected before publication',async()=>{
  await withDirectory(async root=>{
    const f=sourceFixture(),reader=readers(f.files),result=await archive({root,packageId,refs:f.refs,...reader});
    const indexFile=resolve(root,'build/content-releases/packages',packageId+'.json');
    const {contentHash:ignored,...payload}=structuredClone(result.index);
    payload.releases[0]!.id='f'.repeat(64);payload.currentReleaseId='f'.repeat(64);
    const forged={...payload,contentHash:await contentDigest(payload)};await writeFile(indexFile,raw(forged));
    await assert.rejects(archive({root,packageId,refs:f.refs,...reader}),/Archived release identity/);
    assert.ok((await readFile(indexFile)).equals(raw(forged)));
  });
});

test('only published refs are enumerated, and default file reads honor serve aliases without rewriting their payload URLs',async()=>{
  await withDirectory(async root=>{
    const f=sourceFixture();
    // Use source alias as a trusted logical URL; the physical serving contract
    // stores that file at source-new-game.json, not a second current URL.
    const refs=structuredClone(f.refs);refs.source!.entry.url='/game/new-game.json';
    const actual=new Map(f.files);actual.delete(f.refs.source!.entry.url);actual.set('/game/source-new-game.json',raw(f.entry));
    actual.set(refsURL,raw(refs));actual.set('/content-packages/report.json',raw({kind:'diagnostic',sourceAdmission:'blocked'}));
    for(const [url,value] of actual){const path=resolve(root,'build','.'+url);await mkdir(dirname(path),{recursive:true});await writeFile(path,value);}
    const {archivePublishedContentPackages}=await import(script);
    const reports=await archivePublishedContentPackages({root,compiledDir,readMedia:async()=>Buffer.from(media)});
    assert.deepEqual(reports.packages,[packageId]);assert.equal(reports.reports.length,1);
    const index=JSON.parse(await readFile(resolve(root,'build/content-releases/packages',packageId+'.json'),'utf8')) as GameContentReleaseIndex;
    assert.ok(index.releases[0]!.bindings['/game/new-game.json']);assert.equal(index.releases[0]!.bindings['/game/source-new-game.json'],undefined);
    const repository=archivedRepository(root,index,{kind:'current'});await repository.repository.sourceNewGame();
  });
});
