import test from 'node:test';import assert from 'node:assert/strict';import{resolve}from'node:path';import{pathToFileURL}from'node:url';import{spawnSync}from'node:child_process';
import{mkdir,writeFile}from'node:fs/promises';
import{hash,canonical}from'../src/compiler/content.js';import{compileFrameworkContent}from'../src/compiler/framework-content.js';
import{compileSourceStoryExecutionGraph,type SourceExecutionProgramInput}from'../src/compiler/source-story-execution-graph.js';
import{planContentBatch}from'../src/compiler/content-batch.js';import{sourceNewGameFixture}from'./fixtures/source-new-game.js';
import{sealBatchContent as seal}from'./fixtures/content-batch.js';import type{CorpusAsset}from'../src/compiler/corpus.js';
const load=(name:string)=>import(pathToFileURL(resolve('scripts',name+'.mjs')).href),{runtimeDigest}=await load('runtime-digest'),
 {prepareSourceStoryExploration}=await load('check-source-story-exploration'),{runSourceStoryExploration}=await load('source-story-explore');
async function fixture(){
 const f=sourceNewGameFixture(),parent=hash('controlled original parent'),worldHash=hash('controlled original world'),assets:CorpusAsset[]=[],programs:SourceExecutionProgramInput[]=[];
 f.map.sourceSetHash=f.world.sourceSetHash=f.content.sourceSetHash=worldHash;f.map.parentSourceSetHash=f.world.parentSourceSetHash=f.content.parentSourceSetHash=parent;
 for(const[script,ops]of Object.entries(f.map.scripts)){
  const source={file:'controlled-source.bundle',assetPath:`Assets/Story/${f.map.mapId}/${script}.json`,serializedFile:'controlled-source',objectId:'90071992547409939',sha256:hash(script)},id='program:'+script;
  ops.forEach(op=>{op.source={...source};});
  const raw={Mnemonics:ops.map((op,index)=>({mnemonic:op.kind,label:index===0?'Main':'',operands:{retained:op}})),Segments:[{Label:'Main',EntryPoint:0,Count:ops.length}],SystemFlag:{},ScriptLocal:[],ScriptLocalValue:[]};
  assets.push({id,kind:'script',source,data:raw});programs.push({id,domain:'field',source,raw,instructions:ops,diagnostics:[]});
 }
 const source={file:'controlled-source.bundle',assetPath:'Assets/Story/package.json',serializedFile:'controlled-source',objectId:'-90071992547409939',sha256:hash('package')};
 assets.push({id:'package',kind:'map-package',source,data:{asset_group_name:'story',map:[{name:'map'+f.map.mapId,script:Object.keys(f.map.scripts).map(name=>({name,asset:f.map.mapId+'/'+name}))}]}});
 const map=seal(f.map),battle=seal(f.battle);f.world.maps={[map.mapId]:{...f.world.maps[map.mapId]!,contentHash:map.contentHash,url:'/world/maps/'+map.mapId+'.json'}};
 const catalog=seal(f.world),entry=seal({...f.content,worldCatalogHash:catalog.contentHash,battleCatalogHash:battle.contentHash,mapContentHash:map.contentHash}),
  framework=compileFrameworkContent(catalog,[map],entry,{birdViewActors:'web-flat-bird-view-actors-v1'}),
  graph=compileSourceStoryExecutionGraph({runtimeHash:await runtimeDigest(process.cwd(),'dist'),sourceSetHash:parent,sourceDigest:hash(assets),assets,programs,tables:{'map.csv':[{id:String(map.mapId),asset_name:'story',map_name:'map'+map.mapId,area_id:String(map.areaId)}]}}),
  refs={kind:'game-content-refs-v1',profile:'framework',world:{url:'/framework/world/catalog.json',contentHash:framework.catalog.contentHash},source:{entry:{url:'/framework/full-new-game.json',contentHash:framework.entry.contentHash},battle:{url:'/framework/full-battle.json',contentHash:battle.contentHash}},development:null};
 const files=new Map<string,any>([['/world/catalog.json',catalog],['/game/source-new-game.json',entry],['/game/source-catalog.json',battle],[catalog.maps[map.mapId]!.url,map],
  ['/framework/world/catalog.json',framework.catalog],['/framework/full-new-game.json',framework.entry],['/framework/full-battle.json',battle],['/framework/full-content-refs.json',refs],
  [framework.catalog.maps[map.mapId]!.url,framework.maps[0]!]]);
 // Derivation normally uses a separate /framework URL domain. Do not let the
 // authored fixture's map reader accidentally overwrite its strict role.
 assert.notEqual(catalog.maps[map.mapId]!.url,framework.catalog.maps[map.mapId]!.url);
 const read=async(url:string)=>{assert(files.has(url),'Missing controlled dependency '+url);return structuredClone(files.get(url));};
 return {files,read,graph,entry,catalog,map,battle,framework,refs};
}
test('explicit Web profile keeps true source title initialization, real Storage and two independent owner runs',async()=>{
 const f=await fixture(),before=canonical([...f.files]),prepared=await prepareSourceStoryExploration({sourceCompiled:resolve('dist'),read:f.read,graph:f.graph,profile:'framework',maxTicks:2000}),
  report=await runSourceStoryExploration({root:process.cwd(),graph:f.graph,...prepared,limits:{maxTrials:2,maxInputDepth:1,maxChoiceDepth:1}});
 assert.equal(prepared.manifest.profile,'framework');assert.equal(prepared.manifest.routes[0].entry,'source-new-game');assert.equal(prepared.manifest.contentRefs.development,null);assert.deepEqual(prepared.manifest.contentRefs,f.refs);
 assert.equal(report.lane,'original-source');assert.equal(report.profile,'framework');assert.equal(report.nativeParity,false);assert.equal(report.completeStoryBatches,0);assert.equal(report.sourceCampaignComplete,false);
 assert.equal(report.ledger.issues.length,0,JSON.stringify(report.ledger.issues));assert(report.attempts.length>=1);assert(report.attempts.every((a:any)=>a.replayMatched));
 const first=report.attempts[0];assert.equal(first.run.receipt.lane,'source-profile');assert.equal(first.run.receipt.profile,'framework');assert.equal(first.run.receipt.saveRestored,true);
 assert.equal(first.run.finalState.checkpoint.owned.initialization,'source-new-game');assert.equal(first.run.finalState.checkpoint.origin.kind,'source-new-game');
 assert(first.run.sourceStory.checkpointRelays.length>0);assert(first.replay.sourceStory.checkpointRelays.length>0);assert(report.attempts.some((a:any)=>a.parentId!==null));
 assert.equal(prepared.packages.maps[0].developmentProfile.birdViewActors,'web-flat-bird-view-actors-v1');
 assert.equal(canonical([...f.files]),before);await mkdir('build/reports',{recursive:true});await writeFile('build/reports/story-framework-exploration-controlled.json',JSON.stringify(report)+'\n');
});
test('source remains the default and retains source-profile initialization/replay without Web policy',async()=>{
 const f=await fixture(),prepared=await prepareSourceStoryExploration({sourceCompiled:resolve('dist'),read:f.read,graph:f.graph,maxTicks:2000}),
  report=await runSourceStoryExploration({root:process.cwd(),graph:f.graph,...prepared,limits:{maxTrials:1,maxInputDepth:1,maxChoiceDepth:1}});
 assert.equal(prepared.manifest.profile,'source');assert.equal(prepared.packages.entry.developmentProfile,undefined);assert.equal(report.profile,'source');assert.equal(report.attempts[0].run.receipt.lane,'source-profile');assert(report.attempts[0].replayMatched);assert.equal(report.ledger.issues.length,0);
});
test('source graph typed-body mismatch remains an issue under the explicit framework profile',async()=>{
 const f=await fixture(),graph=structuredClone(f.graph);graph.roots.find(r=>r.alias==='reserved')!.typedBodyHash=hash('controlled mismatched framework body');
 const bound=seal(graph),prepared=await prepareSourceStoryExploration({sourceCompiled:resolve('dist'),read:f.read,graph:bound,profile:'framework',maxTicks:2000}),
  report=await runSourceStoryExploration({root:process.cwd(),graph:bound,...prepared,limits:{maxTrials:1,maxInputDepth:1,maxChoiceDepth:1}});
 assert(report.attempts[0].replayMatched);assert(report.ledger.issues.some((i:any)=>i.code==='source-root-binding-mismatch'));assert.equal(report.ledger.counts.enteredRoots,0);assert.equal(report.completeStoryBatches,0);
});
test('mixed reference profile, namespace, development role, entry kind or source/framework bodies reject',async()=>{
 for(const kind of ['profile','namespace','development','entry-kind','world-body','map-body','map-denominator']){
  const f=await fixture(),files=f.files,refs=structuredClone(f.refs);let graph=f.graph;
  if(kind==='profile')refs.profile='source';
  if(kind==='namespace')refs.source.entry.url='/game/source-new-game.json';
  if(kind==='development')(refs as any).development=structuredClone(refs.source);
  if(kind==='entry-kind')files.set(refs.source.entry.url,{...f.framework.entry,kind:'framework-new-game-content-v1'});
  if(kind==='world-body'){files.set(refs.world.url,f.catalog);refs.world.contentHash=f.catalog.contentHash;}
  if(kind==='map-body')files.set(f.framework.catalog.maps[f.map.mapId]!.url,f.map);
  if(kind==='map-denominator'){graph=structuredClone(graph);graph.maps.push({...graph.maps[0]!,mapId:999});}
  files.set('/framework/full-content-refs.json',refs);
  await assert.rejects(prepareSourceStoryExploration({sourceCompiled:resolve('dist'),read:f.read,graph,profile:'framework'}),/.*/,kind);
 }
 const f=await fixture(),p=await prepareSourceStoryExploration({sourceCompiled:resolve('dist'),read:f.read,graph:f.graph,profile:'framework'});p.manifest.profile='source';assert.throws(()=>planContentBatch(p.manifest,p.packages),/profile/);
 await assert.rejects(prepareSourceStoryExploration({sourceCompiled:resolve('dist'),read:f.read,graph:f.graph,profile:'initialized'}),/Unknown.*profile/);
});
test('CLI accepts the explicit profile option but rejects invalid or duplicated declarations before a candidate read',()=>{
 const args=['scripts/check-source-story-exploration.mjs','--source-root',process.cwd(),'--candidate-dir','/nonexistent-controlled-candidate','--output','/nonexistent-controlled-output'];
 const invalid=spawnSync(process.execPath,[...args,'--profile','initialized'],{encoding:'utf8'});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Unknown source story content profile/);
 const duplicate=spawnSync(process.execPath,[...args,'--profile','framework','--profile','source'],{encoding:'utf8'});assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/AssertionError/);
});
