import{mkdir,writeFile}from'node:fs/promises';
import test from 'node:test';import assert from 'node:assert/strict';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
import{hash}from'../src/compiler/content.js';import{compileSourceStoryExecutionGraph,type SourceExecutionProgramInput}from'../src/compiler/source-story-execution-graph.js';
import{compileSourceStoryExecutionLedger}from'../src/compiler/source-story-execution-ledger.js';
import{GameContentRepository}from'../src/core/game-content.js';import{contentBatchFixture,sealBatchContent}from'./fixtures/content-batch.js';import{choiceDefinition}from'./fixtures/field-choice.js';
import type{CorpusAsset}from'../src/compiler/corpus.js';import type{Op}from'../src/field/types.js';
const load=async(n:string)=>import(pathToFileURL(resolve('scripts',n+'.mjs')).href),{runtimeDigest}=await load('runtime-digest'),{runSourceStoryExploration}=await load('source-story-explore');
async function fixture(){
 const f=contentBatchFixture(),sourceSetHash=hash('controlled source graph parent'),assets:CorpusAsset[]=[],programs:SourceExecutionProgramInput[]=[],tables={'map.csv':[]as Record<string,string>[]};
 f.packages.entry.parentSourceSetHash=f.packages.catalog.parentSourceSetHash=sourceSetHash;f.packages.entry.sourceSetHash=hash('controlled field');f.packages.catalog.sourceSetHash=hash('controlled world');f.packages.battle.common.fieldSourceSetHash=f.packages.entry.sourceSetHash;f.packages.battle.common.sprites.synthetic={file:'/synthetic/story-player.png',width:16,height:16};f.packages.battle=sealBatchContent(f.packages.battle);
 for(const map of f.packages.maps){map.parentSourceSetHash=sourceSetHash;map.sourceSetHash=f.packages.catalog.sourceSetHash;}
 const branch={category:'MessageSelection' as const,index:0},flag={category:'ScenarioFlag1' as const,index:8};
 const input=(script:string,rows:unknown[])=>rows.map((op,index)=>({...op as object,script,index,source:{file:'synthetic.bundle',assetPath:'Assets/Story/1/'+script+'.json',serializedFile:'controlled',objectId:'90071992547409939',sha256:hash(script),pointer:'/Mnemonics/'+index}}as unknown as Op));
 f.packages.entry.scripts.journey=input('journey',[{kind:'nop'},choiceDefinition(),{kind:'branch',left:branch,operator:'＝',right:{kind:'immediate',value:0},target:5},{kind:'flag',ref:flag,operation:'set'},{kind:'jump',target:6},{kind:'flag',ref:flag,operation:'reset'},{kind:'encounter',party:1000,continuation:'after'}]);
 f.packages.entry.scripts.after=input('after',[{kind:'nop'},...f.packages.entry.scripts.after!.map(({script:_,index:__,source:___,...op})=>op)]);
 f.packages.entry=sealBatchContent(f.packages.entry);f.packages.maps[0]!.scripts=structuredClone(f.packages.entry.scripts);
 for(const map of f.packages.maps){
  if(map.mapId===2)map.scripts.init=input('init',[{kind:'nop'},...map.scripts.init!.map(({script:_,index:__,source:___,...op})=>op)]);
  tables['map.csv'].push({id:String(map.mapId),asset_name:'story',map_name:'map'+map.mapId,area_id:String(map.areaId)});
  for(const[alias,ops]of Object.entries(map.scripts)){
   const first=ops[0]!.source as CorpusAsset['source'],source={file:first.file,assetPath:first.assetPath,serializedFile:first.serializedFile,objectId:first.objectId,sha256:first.sha256},id='program:'+map.mapId+':'+alias,
    raw={Mnemonics:ops.map((op,index)=>({mnemonic:op.kind==='branch'?'Branch':op.kind,label:index===0?'Main':'',operands:{retained:op}})),Segments:[{Label:'Main',EntryPoint:0,Count:ops.length}],SystemFlag:{},ScriptLocal:[],ScriptLocalValue:[]};
   assets.push({id,kind:'script',source,data:raw});programs.push({id,domain:'field',source,raw,instructions:ops,diagnostics:[]});
  }
 }
 // The fixture has unique physical paths even when its public script alias repeats.
 const packageSource={file:'synthetic.bundle',assetPath:'Assets/Story/package.json',serializedFile:'controlled',objectId:'-90071992547409939',sha256:hash('package')};
 assets.push({id:'package',kind:'map-package',source:packageSource,data:{asset_group_name:'story',map:f.packages.maps.map(map=>({name:'map'+map.mapId,script:Object.entries(map.scripts).map(([name,ops])=>({name,asset:ops[0]!.source.assetPath.replace('Assets/Story/','').replace('.json','')}))}))}});
 f.packages.maps=f.packages.maps.map(sealBatchContent);f.packages.catalog.maps=Object.fromEntries(f.packages.maps.map(m=>[m.mapId,{...f.packages.catalog.maps[m.mapId]!,contentHash:m.contentHash}]));f.packages.catalog=sealBatchContent(f.packages.catalog);
 const refs={kind:'game-content-refs-v1'as const,profile:'source'as const,source:null,world:{url:'/world/catalog.json',contentHash:f.packages.catalog.contentHash},development:{entry:{url:'/game/content.json',contentHash:f.packages.entry.contentHash},battle:{url:'/game/battle.json',contentHash:f.packages.battle.contentHash}}};
 f.manifest.contentRefs=refs;f.manifest.roots.push(...f.packages.maps.flatMap(m=>Object.keys(m.scripts).map(script=>({kind:'script'as const,mapId:m.mapId,script}))));
 const files=new Map<string,unknown>([[refs.world.url,f.packages.catalog],[refs.development.entry.url,f.packages.entry],[refs.development.battle.url,f.packages.battle],...f.packages.maps.map(m=>[f.packages.catalog.maps[m.mapId]!.url,m]as[string,unknown])]),repository=new GameContentRepository(async url=>{assert(files.has(url),url);return files.get(url);},'source',refs),runtimeHash=await runtimeDigest(process.cwd(),'dist'),
  graphInput={sourceSetHash,sourceDigest:hash(assets),runtimeHash,assets,tables,programs},graph=compileSourceStoryExecutionGraph(graphInput);
 return {f,repository,graphInput,graph};
}
test('whole graph retains every alias, exact local call/branch successors, unknown raw branches and decimal source identity',async()=>{
 const x=await fixture(),input=structuredClone(x.graphInput),p=input.programs[0]!;
 p.instructions=[{kind:'call',target:2},{kind:'branch',target:3},{kind:'blocked',reason:'unknown branch'},...p.instructions.slice(3)];
 (p.raw as any).Mnemonics[2].mnemonic='BranchMystery';input.assets.find(a=>a.id===p.id)!.data=structuredClone(p.raw);
 const graph=compileSourceStoryExecutionGraph(input),program=graph.programs.find(a=>a.id===p.id)!;
 assert.deepEqual(program.sites[0]!.flow.successors,[3]);assert.deepEqual(program.sites[1]!.flow.successors,[2,3]);assert.equal(program.sites[2]!.flow.kind,'branch-domain-unassessed');
 assert.equal(graph.counts.programs,3);assert.equal(graph.counts.roots,3);assert.equal(graph.counts.unknownBranches,1);assert.equal(program.source.objectId,'90071992547409939');assert.equal(program.sites.length,(p.raw as any).Mnemonics.length);
 assert.throws(()=>compileSourceStoryExecutionGraph({...input,programs:input.programs.slice(1)}),/denominator/);
 const changed=structuredClone(input);(changed.assets[0]!.data as any).Mnemonics.pop();assert.throws(()=>compileSourceStoryExecutionGraph(changed),/binding changed/);
});
test('one bounded explorer discovers both source-shaped choice paths through actual Session, battle return, map and predecessor Storage, then independently replays',async()=>{
 const x=await fixture(),report=await runSourceStoryExploration({root:process.cwd(),graph:x.graph,packages:x.f.packages,repository:x.repository,manifest:x.f.manifest,lane:'synthetic-contract-only',limits:{maxTrials:12,maxInputDepth:2,maxChoiceDepth:3}});
 await mkdir('build/reports',{recursive:true});await writeFile('build/reports/source-story-execution-controlled.json',JSON.stringify(report)+'\n');
 assert(report.attempts.every((a:any)=>a.replayMatched));assert.equal(report.ledger.issues.length,0,JSON.stringify(report.ledger.issues));assert(report.ledger.counts.enteredRoots>=3,JSON.stringify(report.ledger.counts));assert.equal(report.ledger.counts.observedBranchEdges,2);
 assert(report.attempts.some((a:any)=>a.parentId!==null&&a.run.inputCheckpoint));assert(report.attempts.some((a:any)=>a.run.execution.committedStarts===1&&a.run.execution.committedReturns===1));
 assert(report.attempts.some((a:any)=>a.run.sourceStory.checkpointRelays.length>=2));assert(report.unexpanded.length>0);assert.equal(report.completeStoryBatches,0);assert.equal(report.sourceCampaignComplete,false);
 const bad=structuredClone(report.attempts);bad[0].run.sourceStory.checkpointRelays[0].slotBytes='{}';bad[0].replay=structuredClone(bad[0].run);assert(compileSourceStoryExecutionLedger(x.graph,bad).issues.some(i=>i.code==='checkpoint-chain-broken'));
 const fake=structuredClone(report.attempts);fake[0].run.receipt.runtimeHash=hash('other');fake[0].replay=structuredClone(fake[0].run);assert(compileSourceStoryExecutionLedger(x.graph,fake).issues.some(i=>i.code==='runtime-or-journal-mismatch'));
 await assert.rejects(runSourceStoryExploration({root:process.cwd(),graph:x.graph,packages:x.f.packages,repository:x.repository,manifest:x.f.manifest}),/source-new-game/);
});
test('late actual Storage restore failure cannot become a trusted checkpoint or independent replay success',async()=>{
 const x=await fixture(),restore=x.repository.restoreSessionContent.bind(x.repository);let calls=0;
 x.repository.restoreSessionContent=async cp=>{if(++calls===1)throw Error('late original storage resource failure');return restore(cp);};
 const report=await runSourceStoryExploration({root:process.cwd(),graph:x.graph,packages:x.f.packages,repository:x.repository,manifest:x.f.manifest,lane:'synthetic-contract-only',limits:{maxTrials:3,maxInputDepth:2,maxChoiceDepth:3}});
 assert.equal(report.attempts.length,1);assert.equal(report.attempts[0].replayMatched,false);assert.equal(report.ledger.counts.enteredRoots,0);assert.equal(report.unexpanded[0].reason,'independent-replay-mismatch');
});

test('failure after a real battle return and completed roots cannot seed another exploration branch',async()=>{
 const x=await fixture(),restore=x.repository.restoreSessionContent.bind(x.repository);let injected=false;
 x.repository.restoreSessionContent=async cp=>{if(!injected&&cp.owned.completedBattles.length){injected=true;throw Error('late post-battle map Storage restore failure');}return restore(cp);};
 const report=await runSourceStoryExploration({root:process.cwd(),graph:x.graph,packages:x.f.packages,repository:x.repository,manifest:x.f.manifest,lane:'synthetic-contract-only',limits:{maxTrials:8,maxInputDepth:2,maxChoiceDepth:3}}),failed=report.attempts.find((a:any)=>!a.replayMatched&&a.run.execution.committedReturns===1);
 assert(injected);assert(failed);assert(failed.run.sourceStory.fields.some((f:any)=>f.events.some((e:any)=>e.kind==='natural-finish')));
 assert(!report.attempts.some((a:any)=>a.parentId===failed.id));assert(report.ledger.issues.some((i:any)=>i.attemptId===failed.id&&i.code==='independent-replay-mismatch'));assert.equal(report.completeStoryBatches,0);
});
