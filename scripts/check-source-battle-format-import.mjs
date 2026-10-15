// Complete source metadata and pure battle-directory comparison. No map
// producer, publication, source body execution or owned-state mutation.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy} from './source-battle-directory.mjs';

const view=resolve(import.meta.dirname,'..'),o={root:view,compiled:'dist',report:'build/reports/source-battle-format-import.json'},args=process.argv.slice(2);
while(args.length){const f=args.shift();assert(['--input-root','--compiled-dir','--report'].includes(f)&&args[0]);o[f==='--input-root'?'root':f==='--compiled-dir'?'compiled':'report']=args.shift();}
const root=resolve(o.root),compiled=resolve(view,o.compiled),out=resolve(view,o.report),load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js')).href);
assert(out.startsWith(resolve(view,'build')+'/'));await mkdir(dirname(out),{recursive:true});
const api=Object.assign({},...await Promise.all(['compiler/content','compiler/source-system-flags','compiler/battle-source-format-import',
 'compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure','core/battle-branch-execution'].map(load))),
 runtime=await runtimeDigest(view,compiled),policyBytes=await readFile(resolve(view,'content-batches/source-battle-directory.policy.json')),
 declaration=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:JSON.parse(policyBytes)}),
 input=await loadBattleEventMessageSourceInputs(root,compiled,{branchExecution:declaration.framework.branchExecution}),
 resolver=api.createBattleSourceFormatImportResolver(input.snapshot),rawDigest=api.hash(input.scripts),rows=[],shapes={};
for(const p of input.scripts){
 const before=api.canonical(p.data),shape=!Object.hasOwn(p.data,'SystemFlag')?'object-missing':p.data.SystemFlag===null?'object-null':Object.keys(p.data.SystemFlag).sort().join(',');
 shapes[shape]=(shapes[shape]??0)+1;let projection=null,error=null;
 try{const binding=api.bindSourceFormatFlags({sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,sources:input.snapshot.manifest.sources},p);
  projection={binding,...api.decodeSourceSystemFlags(p.data,binding)};
 }catch(e){error=e.message;}
 assert.equal(api.canonical(p.data),before);
 rows.push({id:p.id,source:p.source,rawHash:api.hash(p.data),rawFlags:Object.hasOwn(p.data,'SystemFlag')?p.data.SystemFlag:null,
  systemFlagMissing:!Object.hasOwn(p.data,'SystemFlag'),instructions:p.data.Mnemonics.length,projection,error});
}
const programs=[];
for(const p of input.programs){
 const source=p.battleExportBinding.kind==='exact-battle-export-source-binding-v1'?p.battleExportBinding.source:null;
 const before=input.api.compileBattleEvent(p.data,source,input.input,input.snapshot.reader,declaration.framework.branchExecution);
 const after=source?input.api.compileBattleEvent(p.data,source,input.input,input.snapshot.reader,declaration.framework.branchExecution,resolver({source,data:p.data})):before;
 assert.deepEqual(after.instructions,before.instructions,'Metadata import changed instruction lowering');
 assert.deepEqual(after.localNames,before.localNames);assert.deepEqual(after.initialLocals,before.initialLocals);
 assert.deepEqual(after.branchExecution.sourceProgram,before.branchExecution.sourceProgram,'Raw source program changed');
 const lost=before.blockers.filter(v=>!after.blockers.includes(v));
 assert(lost.every(v=>v==='battle-event SystemFlag requires four explicitly supported zero flags'));
 assert(after.blockers.every(v=>before.blockers.includes(v)));
 const preflight=value=>{try{input.api.parseBattleEventProgram(value);return{parsed:true};}catch(e){return{parsed:false,reason:e.message};}};
 programs.push({id:p.id,source:p.source,rawHash:p.rawHash,completeRawProgram:p.data,before,after,lostBlockers:lost,
  beforeStructure:preflight(before),afterStructure:preflight(after),sourceExecutions:0});
}
// The explicitly opted common helper must be identical to the manual trusted
// compile path, while its ordinary five-parameter lane remains unchanged.
const imported=await loadBattleEventMessageSourceInputs(root,compiled,{branchExecution:declaration.framework.branchExecution,sourceFormatImport:true});
assert.equal(imported.sourceDigest,input.sourceDigest);
for(const row of programs)assert.equal(api.canonical(imported.programs.find(p=>p.id===row.id).compiled),api.canonical(row.after));

const source=await api.compileSharedBattleSource(root),shared=await api.compileGameCatalogModules(root,source),dep=input.dependencies;
assert.equal(api.canonical(shared.runtimeInput.eventMessages),api.canonical(input.input));
const run=sourceFormatImport=>{
 const closure=api.compileSourceBattleParticipantClosure(input.snapshot.reader,{policy:declaration.framework.sourceParticipants,
  encounters:dep.encounters,sources:input.encounterSources,eventMessages:input.input,branchExecution:declaration.framework.branchExecution,
  ...(sourceFormatImport?{sourceFormatImport}:{})});
 return{closure,runtime:api.compileBattleEncounterRuntime(shared.reader,{...shared.runtimeInput,requestedPartyIds:dep.requestedPartyIds,
  encounters:dep.encounters,sourceDiagnostics:[...dep.diagnostics,...closure.diagnostics],reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,
  ...(sourceFormatImport?{sourceFormatImport}:{}),branchExecution:declaration.framework.branchExecution,
  ...(declaration.framework.forcedSavePolicy?{forcedSavePolicy:declaration.framework.forcedSavePolicy}:{}),
  ...(declaration.framework.spawnConditionPolicy?{spawnConditionPolicy:declaration.framework.spawnConditionPolicy}:{}),
  manualControls:declaration.framework.manualControls,conditionControlPolicy:declaration.framework.conditionControlPolicy,
  handoff:{policy:declaration.framework.handoff},development:{formations:declaration.framework.entry.formations,scripts:[],flagGroups:[],participants:closure.participants}})};
};
const before=run(),after=run(resolver);assert.deepEqual(after.closure,before.closure,'Metadata import changed dynamic participant/source closure');
const key=d=>api.canonical(d),oldSet=new Set(before.runtime.diagnostics.map(key)),newSet=new Set(after.runtime.diagnostics.map(key)),
 removed=before.runtime.diagnostics.filter(d=>!newSet.has(key(d))),added=after.runtime.diagnostics.filter(d=>!oldSet.has(key(d)));
// Changed root admission can reveal additional live dependencies. Persist all
// of them; only the exact metadata/structural rejection can disappear.
const changedPhysical=new Set(programs.filter(p=>p.lostBlockers.length).map(p=>p.source.assetPath));
for(const d of removed){
 const descriptor=dep.encounters.find(e=>e.partyId===d.partyId);
 assert(d.kind==='blocked'&&d.code==='battle-script'&&changedPhysical.has(descriptor?.script?.source.assetPath)&&
  (d.reason==='battle-event SystemFlag requires four explicitly supported zero flags'||d.reason.includes('Invalid checkpoint fields')),
  'Removed a gate outside proven source metadata: '+api.canonical(d));
}
const oldIds=Object.keys(before.runtime.encounters);assert(oldIds.every(id=>after.runtime.encounters[id]),'Lost a prior definition');
const now=await input.api.loadCorpus(root);assert.equal(api.hash({assets:now.assets,tables:now.tables,messages:now.messages,manifest:now.manifest}),input.sourceDigest);
assert.equal(api.hash(input.scripts),rawDigest);assert.equal(await runtimeDigest(view,compiled),runtime);
assert.equal(createHash('sha256').update(await readFile(resolve(view,'content-batches/source-battle-directory.policy.json'))).digest('hex'),createHash('sha256').update(policyBytes).digest('hex'));
const body={kind:'source-battle-format-import-cohort-v1',runtimeSha256:runtime,sourceDigest:input.sourceDigest,
 sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,
 policy:declaration,policySha256:createHash('sha256').update(policyBytes).digest('hex'),counts:{allPrograms:rows.length,allInstructions:rows.reduce((n,p)=>n+p.instructions,0),
  projected:rows.filter(p=>p.projection).length,defaulted:rows.filter(p=>p.projection?.defaulted.length).length,stillRejected:rows.filter(p=>p.error).length,
  battlePrograms:programs.length,battleInstructions:programs.reduce((n,p)=>n+p.completeRawProgram.Mnemonics.length,0),changedBattleMetadata:programs.filter(p=>p.lostBlockers.length).length,
  requestedParties:dep.requestedPartyIds.length,sourceDescriptors:dep.encounters.length,sourceDiagnostics:dep.diagnostics.length,
  beforeDefinitions:oldIds.length,afterDefinitions:Object.keys(after.runtime.encounters).length,removedDiagnostics:removed.length,newlyVisibleDiagnostics:added.length},
 shapes,rows,programs,completeBattleDependencies:dep,participantClosure:after.closure,sourceInputParameters:{parameters:shared.runtimeInput.parameters,physical:shared.runtimeInput.physical,
   abilitiesHash:api.hash(shared.runtimeInput.abilities),conditionsHash:api.hash(shared.runtimeInput.conditions),spritesHash:api.hash(shared.runtimeInput.sprites)},
 before:before.runtime,after:after.runtime,removedDiagnostics:removed,newlyVisibleDiagnostics:added,sourceExecutions:0,originalGameExecuted:false,
 worldCompilations:0,publications:0,sourceStoryReachability:false,
 trustBoundary:'Hash-verified source loader and verified compiled content establish provenance; projection receipt is not a signature or save authority.',
 limitations:['Full raw SystemFlag is preserved. Existing nonzero applicability, custom animations, unknown instructions and live actor/media/AI/owned gates remain.',
  'Pure runtime descriptors include full participant closure, forced-save and spawn declarations from this exact baseline policy; no framework catalog composition or original body execution.']};
await writeFile(out,JSON.stringify({...body,contentHash:api.hash(body)})+'\n');console.log(JSON.stringify(body.counts));
