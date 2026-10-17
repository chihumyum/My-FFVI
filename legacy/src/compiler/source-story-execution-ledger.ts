import {hash,canonical} from './content.js';
import {readSourceStoryCheckpointSlot,type SourceStoryRun} from './source-story-batch.js';
import type {SourceStoryExecutionGraph} from './source-story-execution-graph.js';
export type SourceStoryExplorationAttempt={id:string;parentId:string|null;inputCheckpointSha256:string|null;
  replayMatched:boolean;run:SourceStoryRun;replay:SourceStoryRun};
export function sourceStoryReplayProjection(run:SourceStoryRun):unknown {
 const value=structuredClone(run) as SourceStoryRun&{explorationFrontier?:{kind?:string}};
 const boundary=value.receipt.boundary as {kind?:string;reason?:string;requestId?:string}|null;
 if(boundary&&['exception','cleanup'].includes(boundary.kind??'')&&typeof boundary.reason==='string')boundary.reason=boundary.reason.split('\n')[0]!;
 // A request capability belongs to each fresh Field instance. Compare its
 // public semantic options, never reuse or require the same opaque owner ID.
 if(boundary?.kind==='missing-choice-input'&&value.explorationFrontier?.kind==='choice')delete boundary.requestId;
 return value;
}
/** Execution evidence is a separate ledger, never a plot oracle. Caller binds
 * original graph bytes; the runner supplies two independent actual Session runs. */
export function compileSourceStoryExecutionLedger(graph:SourceStoryExecutionGraph,attempts:SourceStoryExplorationAttempt[]){
 const {contentHash,...payload}=graph;if(hash(payload)!==contentHash)throw Error('Source graph payload changed');
 if(new Set(attempts.map(a=>a.id)).size!==attempts.length)throw Error('Duplicate source execution attempt');
 const roots=graph.roots.map(r=>({id:r.id,mapId:r.mapId,alias:r.alias,programId:r.programId,entered:0,completed:0,attemptIds:[] as string[],status:'unobserved' as 'unobserved'|'entered'|'completed'})),
  branches=graph.branches.flatMap(b=>b.successors.map(nextPc=>({rootId:b.rootId,pc:b.pc,nextPc,status:'unobserved' as 'unobserved'|'observed',attemptIds:[] as string[]}))),issues:{attemptId:string;code:string;detail:string}[]=[],byAttempt=new Map<string,SourceStoryExplorationAttempt>(),trustedParents=new Set<string>();
 const fail=(attemptId:string,code:string,detail:string)=>issues.push({attemptId,code,detail});
 for(const a of attempts){
  const run=a.run,e=run.sourceStory,parent=a.parentId===null?null:byAttempt.get(a.parentId);
  byAttempt.set(a.id,a);
  if(!a.replayMatched||canonical(sourceStoryReplayProjection(run))!==canonical(sourceStoryReplayProjection(a.replay))){fail(a.id,'independent-replay-mismatch','Full separately executed evidence differs');continue;}
  if(run.receipt.runtimeHash!==graph.runtimeHash||!e||e.overflow){fail(a.id,'runtime-or-journal-mismatch','Bound runtime and complete actual journal required');continue;}
  if(a.parentId===null){if(!['source-profile','synthetic-controlled'].includes(run.receipt.lane)||a.inputCheckpointSha256!==null){fail(a.id,'invalid-normal-entry','First run must use its real normal entry');continue;}}
  else{
   const relay=trustedParents.has(a.parentId!)?parent?.run.sourceStory?.checkpointRelays.filter(r=>r.final).at(-1):undefined;
   try{if(!relay||!run.inputCheckpoint||readSourceStoryCheckpointSlot(relay.slotBytes).sha256!==a.inputCheckpointSha256||run.inputCheckpoint.sha256!==a.inputCheckpointSha256||
    readSourceStoryCheckpointSlot(relay.slotBytes).bytes!==run.inputCheckpoint.bytes||run.receipt.lane!=='story-checkpoint-continuation')throw Error('Missing exact committed predecessor Storage bytes');}
   catch(error){fail(a.id,'checkpoint-chain-broken',String(error));continue;}
  }
  const initialIssueCount=issues.length;
  for(const relay of e.checkpointRelays){try{const cp=readSourceStoryCheckpointSlot(relay.slotBytes);if(hash(cp.checkpoint)!==relay.beforeCheckpointHash||relay.beforeCheckpointHash!==relay.restoredCheckpointHash)throw Error('Saved/restored state differs');}
   catch(error){fail(a.id,'invalid-storage-relay',String(error));}}
  if(issues.length!==initialIssueCount)continue;
  for(const field of e.fields){
   if(!field.enabled||field.publication.kind!=='actual-session-field'||field.sourceSetHash!==graph.sourceSetHash&&field.parentSourceSetHash!==graph.sourceSetHash){fail(a.id,'unpublished-or-foreign-field','Actual Session publication/source required');continue;}
   if(![run.receipt.contentHashes.entry,run.receipt.contentHashes['map:'+field.mapId]].includes(field.contentHash)){fail(a.id,'field-content-pin-mismatch','Actual field body has no exact bound entry/map pin');continue;}
   for(const enter of field.events.filter(ev=>ev.kind==='root-enter'&&ev.slot===null)){
    const candidates=graph.roots.filter(r=>r.mapId===field.mapId&&r.alias===enter.script),declaration=candidates[0],ledger=roots.find(r=>r.id===declaration?.id),
     body=field.programs.find(p=>p.script===enter.script)?.typedBody;
    if(candidates.length!==1||!declaration||!ledger||enter.pc!==0||!declaration.mainLabel||!body||hash(body)!==declaration.typedBodyHash){fail(a.id,'source-root-binding-mismatch','Normal source alias/Main/full typed body required');continue;}
    ledger.entered++;if(ledger.completed===0)ledger.status='entered';if(!ledger.attemptIds.includes(a.id))ledger.attemptIds.push(a.id);
    const events=field.events.filter(ev=>ev.taskId===enter.taskId&&ev.rootScript===enter.rootScript),end=events.find(ev=>ev.kind==='natural-finish'&&ev.site?.kind==='exit');
    if(end){ledger.completed++;ledger.status='completed';}
    for(const b of branches.filter(b=>b.rootId===declaration.id))if(events.some(ev=>ev.kind==='branch'&&ev.pc===b.pc&&ev.nextPc===b.nextPc)){
     b.status='observed';if(!b.attemptIds.includes(a.id))b.attemptIds.push(a.id);
    }
   }
  }
  if(issues.length===initialIssueCount&&e.checkpointRelays.some(r=>r.final))trustedParents.add(a.id);
 }
 return {kind:'source-story-execution-ledger-v1' as const,graphHash:graph.contentHash,runtimeHash:graph.runtimeHash,
  roots,branches,issues,attempts:attempts.map(a=>({id:a.id,parentId:a.parentId,replayMatched:a.replayMatched,result:a.run.receipt.result,boundary:a.run.receipt.boundary,
   inputCheckpointSha256:a.inputCheckpointSha256,finalCheckpointHash:a.run.finalState?.checkpoint?hash(a.run.finalState.checkpoint):null,
   committedBattleStarts:a.run.execution.committedStarts,committedBattleReturns:a.run.execution.committedReturns})),
  counts:{allPrograms:graph.counts.programs,allRoots:roots.length,enteredRoots:roots.filter(r=>r.entered>0).length,naturallyCompletedRoots:roots.filter(r=>r.completed>0).length,
   allBranchEdges:branches.length,observedBranchEdges:branches.filter(b=>b.status==='observed').length,unknownBranches:graph.counts.unknownBranches,unknownProgramBranches:graph.counts.unknownProgramBranches,
   unexecutedRoots:roots.filter(r=>r.entered===0).length,attempts:attempts.length,issues:issues.length},
  completeStoryBatches:0 as const,sourceCampaignComplete:false as const,
  limitations:['Observed state is a regression capture, not an independent gameplay oracle.','A natural root finish is execution evidence; full handoff/branch/state/semantic story contracts remain independently assessed.','All unvisited roots, branch successors and source unknowns remain in the denominator.']};
}
