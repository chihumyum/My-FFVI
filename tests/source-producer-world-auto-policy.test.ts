import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {WEB_FLAT_WORLD_AUTO_TASKS,worldAutoBinding} from '../src/core/field-world-auto-tasks.js';
import {worldAutoSessionFixture} from './fixtures/world-auto-tasks.js';
import {GameFlow} from '../src/core/game-flow.js';
import {GameSession} from '../src/core/game-session.js';
import {compileFrameworkNewGame} from '../src/compiler/framework-new-game.js';
import {sealBatchContent} from './fixtures/content-batch.js';
const root=process.cwd(),compiledDir=fileURLToPath(new URL('../',import.meta.url));
const script=(name:string)=>import(pathToFileURL(resolve(root,'scripts',name+'.mjs')).href);

test('the real public shared builder passes invalid world-auto input to prerequisite admission before any source/map production',async()=>{
 const tmp=await mkdtemp(resolve(tmpdir(),'ffvi-shared-world-auto-'));
 try{
  await mkdir(resolve(tmp,'content-batches'));await symlink(resolve(root,'apps'),resolve(tmp,'apps'),'dir');await symlink(resolve(root,'scripts'),resolve(tmp,'scripts'),'dir');
  const {compileSharedContentPackages}=await script('content-package-pipeline');
  await assert.rejects(compileSharedContentPackages({root:tmp,compiledDir,sourceRecipePaths:[],worldAutoTasks:'unknown'}),/Unknown source world auto-task policy/);
  await assert.rejects(access(resolve(tmp,'build'))); // The actual builder never reached source compilation or publication.
 }finally{await rm(tmp,{recursive:true,force:true});}
});
test('shared producer defaults and real new-game fields require the same explicit content/runtime authorization',async()=>{
 const {webSourceFrameworkInputs}=await script('source-web-framework-inputs'),{sourceWebReplayRuntimePorts}=await script('source-web-replay-runtime');
 const {initializedContentBatchProfile,compileInitializedContentBatch}=await script('build-initialized-content-batch');
 await assert.rejects(compileInitializedContentBatch(root,{},'a'.repeat(64),{worldAutoTasks:'unknown'}),/Unknown initialized world auto-task policy/);
 const a=webSourceFrameworkInputs(),b=webSourceFrameworkInputs();assert.equal(a.worldAutoTasks,WEB_FLAT_WORLD_AUTO_TASKS);assert.equal(sourceWebReplayRuntimePorts().worldAutoTasks,a.worldAutoTasks);
 delete a.worldAutoTasks;assert.equal(b.worldAutoTasks,WEB_FLAT_WORLD_AUTO_TASKS);
 for(const[declared,policy]of[[true,false],[false,true],[true,true]]as const){
  const f=await worldAutoSessionFixture({declared:false,policy}),parentSourceSetHash='a'.repeat(64),
   sourceMap=sealBatchContent({...f.sourceMap,parentSourceSetHash}),sourceEntry=sealBatchContent({...f.sourceEntry,parentSourceSetHash,mapContentHash:sourceMap.contentHash}),
   profile=(hash:string)=>initializedContentBatchProfile(hash,{presentation:'framework-ordinary-field-flat-v1',...(declared?{worldAutoTasks:b.worldAutoTasks}:{})}),
   map=sealBatchContent({...f.map,parentSourceSetHash,developmentProfile:profile(sourceMap.contentHash)}),
   world=sealBatchContent({...f.world,parentSourceSetHash,developmentProfile:profile(sourceEntry.worldCatalogHash),maps:{...f.world.maps,[map.mapId]:{...f.world.maps[map.mapId]!,contentHash:map.contentHash}}}),
   content=await compileFrameworkNewGame({sourceEntry,sourceBattle:f.sourceBattle,sourceMap,world,map,battle:f.battle,entrance:map.partyEntry!.pointIns[0]!.id}),
   game=await GameSession.prepareFrameworkNewGame(content,world,map,f.battle,f.runtime),flow=new GameFlow(game);flow.start();flow.advance(10,{visible:true,mediaReady:true,overlayOpen:false});
  for(const value of[content,world,map])assert.equal(value.developmentProfile?.worldAutoTasks,declared?WEB_FLAT_WORLD_AUTO_TASKS:undefined);
  assert.equal(game.field.content.developmentProfile?.worldAutoTasks,declared?WEB_FLAT_WORLD_AUTO_TASKS:undefined);
  assert.equal(!!worldAutoBinding(game.field.content,policy?WEB_FLAT_WORLD_AUTO_TASKS:undefined),declared&&policy);
  assert(game.field.startEvent('auto'));
  if(declared&&policy){for(let i=0;i<10;i++)game.advance(10);assert.equal(game.field.stop,null);assert.equal(game.field.worldAutoTaskJournal.filter(r=>r.action==='complete').flatMap(r=>r.tickets).length,3);}
  else{assert.equal(game.field.stop?.kind,'unsupported');assert.equal(game.field.worldAutoTaskSnapshot?.tasks.length??0,0);}
 }
});
