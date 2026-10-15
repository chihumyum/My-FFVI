// Complete source-family compiler comparison, never a source execution or producer.
import assert from 'node:assert/strict';import{mkdir,readFile,writeFile}from'node:fs/promises';import{resolve,dirname}from'node:path';import{pathToFileURL}from'node:url';
import{runtimeDigest}from'./runtime-digest.mjs';import{loadBattleEventMessageSourceInputs}from'./battle-event-message-source-inputs.mjs';
const view=resolve(import.meta.dirname,'..'),o={root:view,compiled:'dist',baselineRoot:null,baselineCompiled:null,report:'build/reports/source-battle-forced-save.json'},args=process.argv.slice(2),seen=new Set();
const options={'--input-root':'root','--compiled-dir':'compiled','--baseline-script-root':'baselineRoot','--baseline-compiled-dir':'baselineCompiled','--report':'report'};
while(args.length){const f=args.shift();assert(Object.hasOwn(options,f)&&args[0]&&!seen.has(f));seen.add(f);o[options[f]]=args.shift();}
assert(o.baselineRoot&&o.baselineCompiled,'An exact before script root and compiled directory are required');
const root=resolve(view,o.root),compiled=resolve(view,o.compiled),beforeRoot=resolve(view,o.baselineRoot),beforeCompiled=resolve(view,o.baselineCompiled),out=resolve(view,o.report);assert(out.startsWith(resolve(view,'build')+'/'));await mkdir(dirname(out),{recursive:true});
async function prepare(scriptRoot,dist){
 const load=n=>import(pathToFileURL(resolve(dist,'src/'+n+'.js')).href),api=Object.assign({},...await Promise.all(['compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure'].map(load))),
  {readSourceBattleDirectoryPolicy}=await import(pathToFileURL(resolve(scriptRoot,'scripts/source-battle-directory.mjs')).href),policyBytes=await readFile(resolve(scriptRoot,'content-batches/source-battle-directory.policy.json')),
  policy=await readSourceBattleDirectoryPolicy({root,compiledDir:dist,policy:JSON.parse(policyBytes)}),runtime=await runtimeDigest(scriptRoot,dist),input=await loadBattleEventMessageSourceInputs(root,dist,{branchExecution:policy.framework.branchExecution}),
  source=await api.compileSharedBattleSource(root),shared=await api.compileGameCatalogModules(root,source),dep=input.dependencies,
  closure=api.compileSourceBattleParticipantClosure(input.snapshot.reader,{policy:policy.framework.sourceParticipants,encounters:dep.encounters,sources:input.encounterSources,eventMessages:input.input,branchExecution:policy.framework.branchExecution}),
  value={...shared.runtimeInput,requestedPartyIds:dep.requestedPartyIds,encounters:dep.encounters,sourceDiagnostics:[...dep.diagnostics,...closure.diagnostics],reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,
   branchExecution:policy.framework.branchExecution,manualControls:policy.framework.manualControls,conditionControlPolicy:policy.framework.conditionControlPolicy,...(policy.framework.spawnConditionPolicy?{spawnConditionPolicy:policy.framework.spawnConditionPolicy}:{}),...(policy.framework.forcedSavePolicy?{forcedSavePolicy:policy.framework.forcedSavePolicy}:{}),
   handoff:{policy:policy.framework.handoff},development:{...(policy.framework.entry?.formations?{formations:policy.framework.entry.formations}:{}),scripts:[],flagGroups:[],participants:closure.participants}},result=api.compileBattleEncounterRuntime(shared.reader,value);
 return {api,policy,policyBytes,runtime,input,closure,result,scriptRoot,dist};
}
const before=await prepare(beforeRoot,beforeCompiled),after=await prepare(view,compiled),api=after.api;
assert.equal(after.input.sourceDigest,before.input.sourceDigest);assert.equal(api.canonical(after.input.dependencies),api.canonical(before.input.dependencies));
const sites=[],programs=[];for(const p of after.input.programs){const old=before.input.programs.find(q=>q.id===p.id);assert(old);assert.equal(p.rawHash,old.rawHash);assert.equal(api.canonical(p.source),api.canonical(old.source));assert.equal(p.compiled.instructions.length,old.compiled.instructions.length);
 let changed=false;for(const[pc,row]of p.compiled.instructions.entries()){
  const original=p.data.Mnemonics[pc],prior=old.compiled.instructions[pc];
  if(original.mnemonic==='BattleForceExitOnSave'){assert.equal(row.op.kind,'force-save-return');assert.equal(prior.op.kind,'blocked');sites.push({program:p.id,pc,raw:original,before:prior.op,after:row.op});changed=true;}
  else assert.equal(api.canonical(row),api.canonical(prior),'Changed unrelated source operation '+p.id+':'+pc);
 }if(changed)programs.push(p);
}
assert.equal(sites.length,22);assert.equal(programs.length,8);
const hard=r=>r.diagnostics.filter(d=>d.kind==='blocked'),key=d=>api.canonical(d),oldHard=hard(before.result),newHard=hard(after.result),oldSet=new Set(oldHard.map(key)),newSet=new Set(newHard.map(key)),removed=oldHard.filter(d=>!newSet.has(key(d))),added=newHard.filter(d=>!oldSet.has(key(d))),
 oldUnknown=before.result.diagnostics.filter(d=>d.kind==='runtime-dependency'&&d.code==='battle-script'),newUnknown=after.result.diagnostics.filter(d=>d.kind==='runtime-dependency'&&d.code==='battle-script');
assert(removed.every(d=>d.code==='battle-script'),'A hard gate outside the exact Save opcode changed');
const group=rows=>Object.entries(rows.reduce((m,d)=>(m[d.code]=(m[d.code]??0)+1,m),{})).map(([code,count])=>({code,count}));
const counts={allSourcePrograms:after.input.scripts.length,allSourceInstructions:after.input.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),battlePrograms:after.input.programs.length,battleInstructions:after.input.inventory.counts.instructions,
 requestedParties:after.input.dependencies.requestedPartyIds.length,sourceDescriptors:after.input.dependencies.encounters.length,sourceDiagnostics:after.input.dependencies.diagnostics.length,sourceBound:after.input.inventory.counts.exportBoundPrograms,sourceUnbound:after.input.inventory.counts.exportUnboundPrograms,
 familySites:sites.length,completeFamilyPrograms:programs.length,completeFamilyInstructions:programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),beforeDefinitions:before.result.report.compiledDefinitions,afterDefinitions:after.result.report.compiledDefinitions,
 beforeHardParties:before.result.report.blocked,afterHardParties:after.result.report.blocked,removedHard:removed.length,newHard:added.length,beforeUnknownSiteDependencies:oldUnknown.length,afterUnknownSiteDependencies:newUnknown.length,
 boundSavedReturnDefinitions:Object.values(after.result.encounters).filter(e=>e.forcedSavePolicy).length};
for(const value of [before,after]){assert.equal(await runtimeDigest(value.scriptRoot,value.dist),value.runtime);assert.equal((await readFile(resolve(value.scriptRoot,'content-batches/source-battle-directory.policy.json'))).toString(),value.policyBytes.toString());}
const current=await after.input.api.loadCorpus(root);assert.equal(api.hash({assets:current.assets,tables:current.tables,messages:current.messages,manifest:current.manifest}),after.input.sourceDigest);
const report={kind:'source-battle-forced-save-inspection-v1',result:'passed-compilation-only',runtimeSha256:after.runtime,baselineRuntimeSha256:before.runtime,sourceDigest:after.input.sourceDigest,counts,policy:after.policy,baselinePolicy:before.policy,
 inventory:after.input.inventory,sites,completeFamilyPrograms:programs,completeDependencies:after.input.dependencies,
 comparison:{before:{report:before.result.report,diagnostics:before.result.diagnostics},after:{report:after.result.report,diagnostics:after.result.diagnostics},removedHard:removed,newHard:added,removedGroups:group(removed),newGroups:group(added)},
 sourceProgramsExecuted:0,sourceBattlesEntered:0,sourceCampaignComplete:false,nativeParity:false,worldCompilations:0,sourceProducerStarted:false};report.contentHash=api.hash(report);await writeFile(out,JSON.stringify(report)+'\n');console.log(JSON.stringify({result:report.result,counts,newHardGroups:group(added),report:out,contentHash:report.contentHash}));
