import {createHash} from "node:crypto";
import { z } from "zod";
import { hash, canonical } from "./content.js";
import { assessStoryRouteContinuity, assessStoryCheckpointLink, parseStoryRouteContract, type StoryCheckpointBytes, type StoryRouteBinding,
  type StoryRouteCapture, type StoryRouteContract } from "./story-continuity.js";
import type { ContentBatchRouteReceipt } from "./content-batch-admission.js";
import type { FieldStoryExecutionEvent } from "../core/field-story-execution.js";
import type { Op } from "../field/types.js";

const text=z.string().min(1),digest=z.string().regex(/^[a-f0-9]{64}$/),id=z.number().int().positive(),pc=z.number().int().nonnegative();
const continuity=z.unknown().transform(raw=>parseStoryRouteContract(raw));
const root=z.object({id:text,mapId:id,script:text,source:z.json(),fingerprintKey:text,
  rawBodyHash:digest,typedBodyHash:digest,entryPc:z.literal(0),rawMainIndex:pc,
  completion:z.enum(["natural-finish","handoff"]),successorRootIds:z.array(text)}).strict();
const schema=z.object({kind:z.literal("source-story-batch-contract-v1"),id:text,
  lane:z.enum(["original-source","synthetic-source-contract"]),manifestHash:digest,dependencyHash:digest,
  roots:z.array(root).min(1),routes:z.array(z.object({id:text,predecessorRouteId:text.nullable(),
    rootIds:z.array(text).min(1),requiredEncounterIds:z.array(id),
    branches:z.array(z.object({id:text,rootId:text,pc,nextPc:pc}).strict()),continuity}).strict()).min(1),
}).strict();
export type SourceStoryBatchContract=z.infer<typeof schema>;
export function parseSourceStoryBatchContract(raw:unknown):SourceStoryBatchContract {
  const value=schema.parse(raw),unique=(values:string[],label:string)=>{
    if(new Set(values).size!==values.length)throw Error("Duplicate source story "+label);
  };
  unique(value.roots.map(r=>r.id),"root");unique(value.roots.map(r=>`${r.mapId}:${r.script}`),"program");
  unique(value.routes.map(r=>r.id),"route");
  for(const route of value.routes){unique(route.rootIds,"route root");unique(route.branches.map(b=>b.id),"branch");}
  return value;
}
export type SourceStoryProgramWitness={kind:"verified-source-program-v1"|"synthetic-source-program-v1";
  mapId:number;script:string;sourceSetHash:string;source:unknown;rawBody:unknown[];typedBody:Op[]};
export type SourceStoryRouteEvidence={kind:"source-story-route-execution-v1";overflow:boolean;
  fields:{fieldId:number;mapId:number|null;contentHash:string;sourceSetHash:string;parentSourceSetHash:string;
    publication:{kind:"actual-session-field";worldTransition:unknown|null};candidateAttempt:number|null;
    programs:{script:string;typedBody:Op[]}[];events:FieldStoryExecutionEvent[];cursor:number;enabled:boolean}[];
  candidateAttempts:unknown[];checkpointRelays:{final:boolean;inputIndex:number;slotBytes:string;
    beforeCheckpointHash:string;restoredCheckpointHash:string;inputCountAtRestore:number}[]};
export type SourceStoryRun={receipt:Omit<ContentBatchRouteReceipt,"lane">&{lane:string};
  trace:{kind:string;[key:string]:unknown}[];sourceStory?:SourceStoryRouteEvidence;
  inputCheckpoint?:StoryCheckpointBytes;finalState?:StoryRouteCapture;execution:{entriesCommitted:number;loadsCommitted:number;committedStarts:number;committedReturns:number};
};
/** Return the exact checkpoint substring present in the real Storage save.
 * Require the existing encoder's JSON representation; never assume that a
 * semantically equivalent reserialization is the prior payload. */
export function readSourceStoryCheckpointSlot(slotBytes:string):StoryCheckpointBytes {
  const slot=JSON.parse(slotBytes),savedText=slot.current;
  if(typeof savedText!=="string")throw Error("Missing actual saved current payload");
  const save=JSON.parse(savedText),{contentHash,...payload}=save;
  if(save.kind!=="web-game-save"||save.formatVersion!==1||hash(payload)!==contentHash||savedText!==JSON.stringify(save))
    throw Error("Changed actual Storage encoding or content hash");
  const marker='"checkpoint":',start=savedText.indexOf(marker)+marker.length,encoded=JSON.stringify(save.checkpoint);
  const bytes=savedText.slice(start,start+encoded.length);
  if(start<marker.length||bytes!==encoded||JSON.stringify(JSON.parse(bytes))!==encoded)throw Error("Missing exact stored checkpoint bytes");
  return {checkpoint:save.checkpoint,bytes,sha256:createHash("sha256").update(bytes).digest("hex")};
}
export type SourceStoryBatchIssue={code:string;routeId:string|null;rootId:string|null;detail:string};
export type SourceStoryBatchResult={kind:"source-story-batch-result-v1";id:string;
  status:"passed"|"blocked"|"unassessed";coverage:"complete-declared-source-batch"|"synthetic-contract-only"|"unassessed";
  issues:SourceStoryBatchIssue[];roots:{id:string;status:"passed"|"blocked";episodes:number}[];
  branches:{id:string;routeId:string;status:"passed"|"blocked"}[];
  sourceCampaignComplete:false;originalGameExecuted:false};

/** A structural cohort is not a runnable story batch until it has a complete
 * declared route contract. Existing admission/continuity receipts are necessary
 * evidence, but a caller-supplied completed boolean is never root execution. */
export function assessSourceStoryBatch(input:{id:string;contract:unknown|null;binding:StoryRouteBinding;
  manifestHash:string;dependencyHash:string;diagnostics:{code:string;reason:string}[];
  witnesses:SourceStoryProgramWitness[];runs:SourceStoryRun[]}):SourceStoryBatchResult {
  const result:SourceStoryBatchResult={kind:"source-story-batch-result-v1",id:input.id,status:"blocked",coverage:"unassessed",
    issues:[],roots:[],branches:[],sourceCampaignComplete:false,originalGameExecuted:false};
  const fail=(code:string,detail:string,routeId:string|null=null,rootId:string|null=null)=>result.issues.push({code,detail,routeId,rootId});
  if(input.contract===null){result.status="unassessed";fail("missing-contract","Structural cohort has no declared complete source-story route contract");return result;}
  let contract:SourceStoryBatchContract;
  try{contract=parseSourceStoryBatchContract(input.contract);}catch(error){fail("invalid-contract",String(error));return result;}
  if(contract.id!==input.id)fail("batch-id-mismatch","Contract belongs to another batch");
  if(contract.manifestHash!==input.manifestHash)fail("manifest-hash-mismatch","Contract manifest differs from the current plan");
  if(contract.dependencyHash!==input.dependencyHash)fail("dependency-hash-mismatch","Contract dependencies differ from the current plan");
  for(const d of input.diagnostics)fail("unresolved-diagnostic",d.code+": "+d.reason);
  const roots=new Map(contract.roots.map(r=>[r.id,r])),routes=new Map(contract.routes.map(r=>[r.id,r]));
  const used=new Set(contract.routes.flatMap(r=>r.rootIds));
  for(const r of contract.roots)if(!used.has(r.id))fail("root-without-route","Declared root has no execution route",null,r.id);
  for(const route of contract.routes){
    for(const id of route.rootIds)if(!roots.has(id))fail("unknown-route-root","Route references an undeclared root",route.id,id);
    if(route.predecessorRouteId!==null&&!routes.has(route.predecessorRouteId))fail("unknown-predecessor","Missing predecessor contract",route.id);
  }
  for(const run of input.runs)if(!routes.has(run.receipt.routeId))fail("unexpected-run","Run has no route contract",run.receipt.routeId);
  const counts=new Map<string,number>();
  for(const route of contract.routes){
    if(contract.lane==="original-source")for(const side of ["entry","exit"] as const){
      const state=route.continuity[side];
      if(state.mapId===null||state.roster===null||state.party===null||state.gil===null)
        fail("incomplete-source-state-contract","Original source entry/exit requires exact map, roster, party and gil",route.id);
    }
    const matches=input.runs.filter(r=>r.receipt.routeId===route.id);
    if(matches.length!==1){fail("missing-or-duplicate-route","Exactly one continuous run is required",route.id);continue;}
    const run=matches[0]!,receipt=run.receipt;
    for(const [key,expected]of Object.entries({manifestHash:input.manifestHash,dependencyHash:input.dependencyHash,runtimeHash:input.binding.runtimeHash}))
      if(receipt[key as "runtimeHash"]!==expected)fail("runtime-or-plan-mismatch",key+" differs",route.id);
    if(canonical(receipt.contentHashes)!==canonical(input.binding.contentHashes))fail("content-pin-mismatch","Run content pins differ",route.id);
    if(receipt.result!=="completed"||receipt.boundary!==null||!receipt.checkpointReady||!receipt.saveRestored)
      fail("route-not-complete","Route has a failure, boundary, or missing stable restore",route.id);
    const expectedLane=route.predecessorRouteId===null?(contract.lane==="original-source"?"source-profile":"synthetic-controlled"):"story-checkpoint-continuation";
    if(receipt.lane!==expectedLane)fail("entry-lane-mismatch","Requires actual new-game or exact predecessor continuation",route.id);
    if(!run.finalState)fail("missing-state-capture","No actual entry/exit checkpoint projections",route.id);
    else{
      const c=assessStoryRouteContinuity(route.continuity,{binding:input.binding,capture:run.finalState});
      for(const issue of c.issues)fail("continuity-"+issue.code,issue.path+": "+issue.detail,route.id);
    }
    const evidence=run.sourceStory;
    if(!evidence||evidence.kind!=="source-story-route-execution-v1"){fail("missing-root-execution","No actual Field execution journal",route.id);continue;}
    // A contract cannot improve its result by omitting an actually entered
    // source Main. Candidate fields are already excluded by the runner.
    for(const field of evidence.fields)for(const event of field.events)if(event.kind==="root-enter"&&event.slot===null){
      const declared=contract.roots.find(r=>r.mapId===field.mapId&&r.script===event.script);
      if(!declared||!route.rootIds.includes(declared.id))
        fail("undeclared-executed-root","Actual published source Main is outside this route's complete contract",route.id,declared?.id??null);
    }
    if(evidence.fields.at(-1)?.mapId!==receipt.finalMapId)fail("wrong-actual-exit-map","Receipt final map differs from the actual published field",route.id);
    if(evidence.overflow)fail("execution-evidence-overflow","Bounded observation overflowed; evidence is incomplete",route.id);
    if(!evidence.checkpointRelays.length||run.execution.loadsCommitted<1)fail("missing-storage-relay","No real committed Storage/EntryLoader restore",route.id);
    for(const relay of evidence.checkpointRelays){
      try{
        const saved=readSourceStoryCheckpointSlot(relay.slotBytes);
        if(hash(saved.checkpoint)!==relay.beforeCheckpointHash||relay.beforeCheckpointHash!==relay.restoredCheckpointHash)
          fail("storage-relay-mismatch","Stored bytes and restored actual owner differ",route.id);
      }catch{fail("invalid-storage-bytes","Real saved slot bytes are missing or corrupt",route.id);}
    }
    if(!evidence.checkpointRelays.some(r=>!r.final)||!receipt.program||receipt.program.postRestoreInputCount<1)
      fail("missing-post-restore-play","Final save alone does not prove gameplay continuation",route.id);
    if(route.predecessorRouteId!==null){
      const previous=input.runs.find(r=>r.receipt.routeId===route.predecessorRouteId),start=run.trace.find(t=>t.kind==="story-continuation");
      if(!previous?.finalState?.checkpoint||!start||start.predecessorRouteId!==route.predecessorRouteId||
        start.checkpointHash!==hash(previous.finalState.checkpoint)||
        canonical(run.finalState?.firstStableCheckpoint)!==canonical(previous.finalState.checkpoint))
        fail("checkpoint-chain-broken","Continuation did not consume the predecessor's exact actual checkpoint",route.id);
      const relay=previous?.sourceStory?.checkpointRelays.filter(r=>r.final).at(-1);
      try{
        if(!relay||!run.inputCheckpoint)throw Error("Missing original Storage checkpoint bytes");
        const link=assessStoryCheckpointLink(readSourceStoryCheckpointSlot(relay.slotBytes),run.inputCheckpoint);
        for(const issue of link.issues)fail("checkpoint-link-"+issue.code,issue.path+": "+issue.detail,route.id);
        if(canonical(run.inputCheckpoint.checkpoint)!==canonical(run.finalState?.firstStableCheckpoint))
          fail("checkpoint-input-owner-mismatch","Stored predecessor bytes do not describe the actual restored entry",route.id);
      }catch(error){fail("missing-checkpoint-link-bytes",String(error),route.id);}
    }
    for(const encounter of route.requiredEncounterIds){
      const actual=run.finalState?.checkpoint?.owned.completedBattles??[];
      if(!receipt.completedEncounterIds.includes(encounter)||!actual.some(b=>b.encounterId===encounter)||
        !run.trace.some(t=>t.kind==="victory"&&t.id===encounter))fail("missing-actual-battle","Required encounter has no committed handoff/settlement",route.id);
    }
    const successful=new Map<string,{field:SourceStoryRouteEvidence["fields"][number];taskId:number}[]>();
    for(const rootId of route.rootIds){
      const declaration=roots.get(rootId);if(!declaration)continue;
      const witness=input.witnesses.filter(w=>w.mapId===declaration.mapId&&w.script===declaration.script);
      if(witness.length!==1){fail("missing-source-program","Exact original raw/typed program witness required",route.id,rootId);continue;}
      const w=witness[0]!,main=w.rawBody[declaration.rawMainIndex] as {label?:unknown}|undefined;
      if(w.sourceSetHash!==input.binding.sourceSetHash||canonical(w.source)!==canonical(declaration.source)||
        input.binding.sourceFingerprints[declaration.fingerprintKey] !== (w.source as {sha256?:unknown}|null)?.sha256||hash(w.rawBody)!==declaration.rawBodyHash||
        hash(w.typedBody)!==declaration.typedBodyHash||main?.label!=="Main"||w.typedBody[0]?.index!==declaration.rawMainIndex||
        contract.lane==="original-source"&&w.kind!=="verified-source-program-v1")
        fail("source-program-binding-mismatch","Main/raw/typed/source fingerprint binding changed",route.id,rootId);
      const episodes:{field:SourceStoryRouteEvidence["fields"][number];taskId:number}[]=[];
      for(const field of evidence.fields.filter(f=>f.mapId===declaration.mapId)){
        if(!field.enabled||field.publication.kind!=="actual-session-field"||
          field.sourceSetHash!==input.binding.sourceSetHash&&field.parentSourceSetHash!==input.binding.sourceSetHash)
          {fail("unpublished-or-wrong-source-field","Field is not the current bound Session publication",route.id,rootId);continue;}
        const contentPin=field.publication.worldTransition===null?input.binding.contentHashes.entry:input.binding.contentHashes[`map:${field.mapId}`];
        if(contentPin!==field.contentHash)fail("field-content-mismatch","Observed actual field body is not a trusted pin",route.id,rootId);
        const program=field.programs.find(p=>p.script===declaration.script);
        if(!program||hash(program.typedBody)!==declaration.typedBodyHash){fail("executed-program-mismatch","Actual Field program differs from original witness",route.id,rootId);continue;}
        for(const enter of field.events.filter(e=>e.kind==="root-enter"&&e.script===declaration.script)){
          if(enter.pc!==0||enter.slot!==null||enter.site?.index!==declaration.rawMainIndex){fail("not-normal-main-entry","Intermediate task/PC cannot establish a root",route.id,rootId);continue;}
          const end=field.events.find(e=>e.taskId===enter.taskId&&e.script===declaration.script&&
            (declaration.completion==="natural-finish"?e.kind==="natural-finish"&&e.site?.kind==="exit":e.kind==="map-handoff"||e.kind==="battle-handoff"));
          if(!end){fail("root-not-naturally-complete","Root has no genuine completion/handoff after Main admission",route.id,rootId);continue;}
          if(declaration.completion==="handoff"){
            for(const successor of declaration.successorRootIds)if(!route.rootIds.includes(successor))fail("missing-handoff-successor","Continuation root is not covered by this route",route.id,rootId);
            const operation=program.typedBody[end.pc];
            if(end.kind==="map-handoff"){
              const request=operation?.kind==="change-map"?operation.request:null;
              const destinations=evidence.fields.filter(f=>f.publication.worldTransition!==null&&
                canonical((f.publication.worldTransition as {request?:unknown}).request)===canonical(request));
              if(!request||!run.trace.some(t=>t.kind==="map"&&t.from===declaration.mapId&&t.to===request.mapId)||!destinations.length)
                fail("uncommitted-handoff","Exact source map request never published its destination",route.id,rootId);
              if(!declaration.successorRootIds.length){
                if(route.continuity.exit.mapId!==request?.mapId||receipt.finalMapId!==request?.mapId)
                  fail("handoff-without-successor","Map handoff has neither continued roots nor the declared stable exit",route.id,rootId);
              }
              for(const successor of declaration.successorRootIds){
                const target=roots.get(successor);
                if(!target||target.mapId!==request?.mapId||!destinations.some(f=>f.mapId===target.mapId&&f.events.some(e=>e.kind==="root-enter"&&e.script===target.script)))
                  fail("handoff-successor-mismatch","Declared source continuation was not entered in the committed destination",route.id,rootId);
              }
            }else{
              const continuation=operation?.kind==="encounter"?operation.continuation:
                operation?.kind==="source-encounter"?operation.command.continuation:
                operation?.kind==="source-boss-encounter"?operation.command.continuation:null;
              if(run.execution.committedReturns<1||!continuation||!declaration.successorRootIds.length)
                fail("uncommitted-handoff","Battle has no committed return and declared original continuation",route.id,rootId);
              for(const successor of declaration.successorRootIds){
                const target=roots.get(successor),endIndex=field.events.indexOf(end);
                if(!target||target.mapId!==declaration.mapId||target.script!==continuation||
                  !field.events.slice(endIndex+1).some(e=>e.kind==="root-enter"&&e.script===target.script))
                  fail("handoff-successor-mismatch","Battle return did not enter its exact source continuation",route.id,rootId);
              }
            }
          }
          episodes.push({field,taskId:enter.taskId});
        }
      }
      if(!episodes.length)fail("missing-root","Declared full source root was never entered and completed",route.id,rootId);
      successful.set(rootId,episodes);counts.set(rootId,(counts.get(rootId)??0)+episodes.length);
    }
    for(const branch of route.branches){
      const episodes=successful.get(branch.rootId)??[],found=episodes.some(({field,taskId})=>field.events.some(e=>
        e.taskId===taskId&&e.kind==="branch"&&e.pc===branch.pc&&e.nextPc===branch.nextPc));
      result.branches.push({id:branch.id,routeId:route.id,status:found?"passed":"blocked"});
      if(!found)fail("missing-branch-evidence","Declared branch successor was not executed in a completed root",route.id,branch.rootId);
    }
  }
  // A complete batch cannot omit a branch simply by declaring no requirements.
  // Both explicit jump and fall-through are required; infeasibility needs an
  // independently evidenced future contract version, never a guessed default.
  for(const r of contract.roots){
    const witness=input.witnesses.find(w=>w.mapId===r.mapId&&w.script===r.script);
    for(const [index,op]of (witness?.typedBody??[]).entries())if(op.kind.startsWith("branch")){
      const target=(op as {target?:unknown}).target;
      if(!Number.isInteger(target)){fail("unknown-branch-domain","No finite source branch target",null,r.id);continue;}
      for(const next of new Set([index+1,target as number])){
        if(!contract.routes.some(route=>route.branches.some(b=>b.rootId===r.id&&b.pc===index&&b.nextPc===next)))
          fail("undeclared-branch-requirement",`Branch ${index} successor ${next} has no declared route requirement`,null,r.id);
      }
    }
  }
  for(const r of contract.roots)result.roots.push({id:r.id,status:result.issues.some(i=>i.rootId===r.id)||!counts.get(r.id)?"blocked":"passed",episodes:counts.get(r.id)??0});
  if(!result.issues.length){result.status="passed";result.coverage=contract.lane==="original-source"?"complete-declared-source-batch":"synthetic-contract-only";}
  return result;
}
