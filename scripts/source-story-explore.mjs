// Bounded normal-input exploration through the one existing Session runner.
// Never starts a script, rewrites PC/state or invents a predecessor save.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';import{createHash}from'node:crypto';
import {pathToFileURL} from 'node:url';
import {runContentBatchRoute} from './content-batch-route.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
export async function runSourceStoryExploration({root,compiled='dist',graph,packages,repository,manifest:template,toolingCompiled=resolve(import.meta.dirname,'../dist'),
 lane='original-source',limits={maxTrials:32,maxInputDepth:8,maxChoiceDepth:8}}){
 const load=n=>import(pathToFileURL(resolve(root,compiled,'src/compiler',n+'.js'))),
  [{hash,canonical},{planContentBatch,ContentBatchManifest},{readSourceStoryCheckpointSlot},{compileSourceStoryExecutionLedger,sourceStoryReplayProjection}]=await Promise.all(
   [...['content','content-batch','source-story-batch'].map(load),import(pathToFileURL(resolve(toolingCompiled,'src/compiler/source-story-execution-ledger.js')))]);
 assert(['original-source','synthetic-contract-only'].includes(lane));
 assert.deepEqual(Object.keys(limits).sort(),['maxChoiceDepth','maxInputDepth','maxTrials']);
 for(const v of Object.values(limits))assert(Number.isSafeInteger(v)&&v>0&&v<=1000000,'Bounded positive exploration limits required');
 const manifest=ContentBatchManifest.parse(structuredClone(template));assert.equal(manifest.routes.length,1,'One normal origin template required');
 assert.equal(manifest.routes[0].entry,lane==='original-source'?'source-new-game':'controlled-fixture');
 const runtimeHash=await runtimeDigest(root,compiled);assert.equal(runtimeHash,graph.runtimeHash,'Same actual game runtime required');
 const queue=[{parentId:null,depth:0,inputs:[{kind:'save-restore'}],choiceAnswers:[]}],attempts=[],continuations=new Map(),stableHashes=new Set(),unexpanded=[],seenSpecs=new Set();
 let serial=0;
 while(queue.length&&attempts.length<limits.maxTrials){
  const spec=queue.shift(),key=canonical(spec);if(seenSpecs.has(key))continue;seenSpecs.add(key);
  const id='source-exploration:'+serial++,parent=spec.parentId===null?null:continuations.get(spec.parentId);
  assert(spec.parentId===null||parent,'Only a verified actual predecessor Storage relay can grant continuation');
  const m=structuredClone(manifest),route=m.routes[0];route.id=id;route.inputs=structuredClone(spec.inputs);route.choiceAnswers=[...spec.choiceAnswers];
  const plan=planContentBatch(m,packages),invoke=async()=>{
   const run=await runContentBatchRoute({root,compiled,plan,routeId:id,repository,runtimeHash,captureFinalState:true,captureSourceStory:true,captureExplorationFrontier:true,
    continuation:parent?{predecessorRouteId:spec.parentId,checkpoint:JSON.parse(parent.bytes),checkpointHash:hash(parent.checkpoint)}:null});
   if(parent)run.inputCheckpoint=structuredClone(parent);return run;
  };
  // This is a second full owner/entry/Storage run, never a clone of discovery.
  const run=await invoke(),replay=await invoke(),replayMatched=canonical(sourceStoryReplayProjection(run))===canonical(sourceStoryReplayProjection(replay)),
   attempt={id,parentId:spec.parentId,inputCheckpointSha256:parent?.sha256??null,replayMatched,run,replay,
    inputProgram:{inputs:spec.inputs,choiceAnswers:spec.choiceAnswers},manifestHash:plan.manifestHash,dependencyHash:plan.dependencyHash};
  attempts.push(attempt);
  if(!replayMatched){unexpanded.push({spec,reason:'independent-replay-mismatch'});continue;}
  const frontier=run.explorationFrontier;
  if(frontier?.kind==='choice'){
   if(spec.choiceAnswers.length>=limits.maxChoiceDepth){unexpanded.push({spec,frontier,reason:'choice-depth-budget'});continue;}
   frontier.options.forEach((_,index)=>queue.unshift({...spec,choiceAnswers:[...spec.choiceAnswers,index]}));
  }else if(frontier?.kind==='stable'&&run.receipt.boundary?.kind==='exploration-stable-frontier'&&run.receipt.saveRestored){
   const relay=run.sourceStory.checkpointRelays.filter(r=>r.final).at(-1);assert(relay,'Actual final Storage relay required');
   const stored=readSourceStoryCheckpointSlot(relay.slotBytes);
   assert.equal(hash(stored.checkpoint),relay.beforeCheckpointHash);assert.equal(relay.beforeCheckpointHash,relay.restoredCheckpointHash);
   assert.equal(canonical(stored.checkpoint),canonical(run.finalState.checkpoint));
   continuations.set(id,stored);
   const stateHash=hash(stored.checkpoint);if(stableHashes.has(stateHash))continue;stableHashes.add(stateHash);
   if(spec.depth>=limits.maxInputDepth){unexpanded.push({spec,frontier,reason:'normal-input-depth-budget'});continue;}
   frontier.inputs.forEach(input=>queue.push({parentId:id,depth:spec.depth+1,inputs:[{kind:'save-restore'},input],choiceAnswers:[]}));
  }else unexpanded.push({spec,frontier:frontier??null,reason:run.receipt.boundary??'unassessed-frontier'});
 }
 unexpanded.push(...queue.map(spec=>({spec,reason:'trial-budget'})));
 assert.equal(await runtimeDigest(root,compiled),runtimeHash,'Runtime changed during exploration');
 const executionToolPins=await Promise.all(['source-story-explore.mjs','content-batch-route.mjs'].map(async name=>({module:'scripts/'+name,sha256:createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex')})));
 return {kind:'source-story-normal-exploration-v1',lane,profile:manifest.profile,nativeParity:false,runtimeHash,executionToolPins,graphHash:graph.contentHash,limits,attempts,unexpanded,
  ledger:compileSourceStoryExecutionLedger(graph,attempts),completeStoryBatches:0,sourceCampaignComplete:false,originalGameExecuted:false,
  scope:'bounded-normal-input-and-independent-replay-only',worldCompilations:0,publications:0};
}
