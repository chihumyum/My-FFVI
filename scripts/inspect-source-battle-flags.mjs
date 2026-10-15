// Whole original flag family and complete original battle directory. Pure
// compilation only: no world publisher, program execution or source omission.
import assert from 'node:assert/strict';
import{readFile,mkdir,writeFile}from'node:fs/promises';
import{resolve,dirname}from'node:path';
import{pathToFileURL,fileURLToPath}from'node:url';
import{createHash}from'node:crypto';
import{runtimeDigest}from'./runtime-digest.mjs';
import{loadBattleEventMessageSourceInputs}from'./battle-event-message-source-inputs.mjs';
import{readSourceBattleDirectoryPolicy}from'./source-battle-directory.mjs';
const view=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i+=2){assert(['--input-root','--compiled-dir','--baseline-compiled-dir','--report'].includes(args[i])&&args[i+1]);assert(!opts[args[i]]);opts[args[i]]=args[i+1];}
const root=resolve(view,opts['--input-root']??'.'),compiled=resolve(view,opts['--compiled-dir']??'dist'),out=resolve(view,opts['--report']??'build/reports/source-battle-flags.json'),
 sha=b=>createHash('sha256').update(b).digest('hex'),load=(name,dir=compiled)=>import(pathToFileURL(resolve(dir,'src/'+name+'.js'))),
 api=Object.assign({},...await Promise.all(['compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/battle-flags','compiler/content'].map(n=>load(n)))),
 before=await runtimeDigest(view,compiled),checkerBytes=await readFile(fileURLToPath(import.meta.url)),report={kind:'whole-source-battle-flag-family-compilation-v1',result:'running',runtimeSha256:before,worldCompilations:0,sourceExecutions:0,sourceStoryReachability:false,nativeDynamicParity:false};
await mkdir(dirname(out),{recursive:true});
try{
 const input=await loadBattleEventMessageSourceInputs(root,compiled),source=await api.compileSharedBattleSource(root),modules=await api.compileGameCatalogModules(root,source),
  policyFile=resolve(view,'content-batches/source-battle-directory.policy.json'),policyBytes=await readFile(policyFile),
  policy=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:JSON.parse(policyBytes)}),dep=input.dependencies,
  ownedBefore=api.hash(source.ownedInitializations),programsBefore=api.hash(input.programs),rawParties=[],rawFlagPlans=[],rawFlagFailures=[],cohorts=new Map();
 for(const id of dep.requestedPartyIds){const party=input.snapshot.reader.row('monster_party.csv',id),groupId=Number(party.values.battle_flag_group_id),rows=groupId?input.snapshot.reader.group('battle_flag_group.csv','group_id',groupId):[],flags=rows.map(r=>Number(r.values.battle_flag_id));
  rawParties.push({partyId:id,party,groupId,rows,flags});const key=JSON.stringify([...flags].sort((a,b)=>a-b)),cohort=cohorts.get(key)??{flags:[...flags].sort((a,b)=>a-b),partyIds:[]};cohort.partyIds.push(id);cohorts.set(key,cohort);
  if(flags.includes(14)){try{rawFlagPlans.push({partyId:id,plan:api.compileSourceBattleFlags(id,party.source,groupId,rows)});}catch(error){rawFlagFailures.push({partyId:id,reason:String(error),party,groupId,rows});}}
 }
 const runtimeInput={...modules.runtimeInput,requestedPartyIds:dep.requestedPartyIds,encounters:dep.encounters,sourceDiagnostics:dep.diagnostics,
  ...(policy.framework.forcedSavePolicy?{forcedSavePolicy:policy.framework.forcedSavePolicy}:{}),
      ...(policy.framework.manualControls===undefined?{}:{manualControls:policy.framework.manualControls}),
  ...(policy.framework.conditionControlPolicy?{conditionControlPolicy:policy.framework.conditionControlPolicy}:{}),
  handoff:{policy:policy.framework.handoff},development:{...(policy.framework.entry?.formations?{formations:policy.framework.entry.formations}:{}),scripts:[],flagGroups:[]}},
  current=api.compileBattleEncounterRuntime(modules.reader,runtimeInput);
 assert.equal(runtimeInput.sourceFlagContext,'story');assert.equal(ownedBefore,api.hash(source.ownedInitializations));assert.equal(programsBefore,api.hash(input.programs));
 for(const e of dep.encounters){const p=input.programs.find(p=>p.source.assetPath===e.script?.source.assetPath);assert(p,'Missing full source event body');assert.equal(p.battleExportBinding.kind,'exact-battle-export-source-binding-v1');assert.equal(api.canonical(e.script.data),api.canonical(p.data));}
 const hard=current.diagnostics.filter(d=>d.kind==='blocked');
 report.inputs={root,compiled,sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,sourceDigest:input.sourceDigest,
  checkerSha256:sha(checkerBytes),messageSourceBinding:input.input.binding,policy:{file:policyFile,sha256:sha(policyBytes),declaration:policy},originalSourceFiles:input.snapshot.manifest.sources};
 report.counts={allSourcePrograms:input.scripts.length,allSourceInstructions:input.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),battlePrograms:input.programs.length,battleInstructions:input.programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),exportBoundPrograms:input.programs.filter(p=>p.battleExportBinding.kind==='exact-battle-export-source-binding-v1').length,exportUnboundPrograms:input.programs.filter(p=>p.battleExportBinding.kind==='unbound-battle-export-source-v1').length,requestedParties:dep.requestedPartyIds.length,sourceDescriptors:dep.encounters.length,sourceDescriptorDiagnostics:dep.diagnostics.length,rawNoArPlans:rawFlagPlans.length,rawNoArFailures:rawFlagFailures.length,descriptorFlagPlans:current.report.flagSources?.length??0,currentDefinitions:Object.keys(current.encounters).length,currentHardFlagParties:new Set(hard.filter(d=>d.code==='battle-flags').map(d=>d.partyId)).size};
 report.completeSourcePrograms=input.programs;report.completeSourceDescriptors=dep;report.rawSourceParties=rawParties;report.rawFlagPlans=rawFlagPlans;report.rawFlagFailures=rawFlagFailures;report.flagCombinations=[...cohorts.values()].sort((a,b)=>b.partyIds.length-a.partyIds.length);report.wholeCurrentDirectory={sourceScriptOmissions:[],sourceFlagOmissions:[],report:current.report,diagnostics:current.diagnostics};
 if(opts['--baseline-compiled-dir']){const baselineDir=resolve(view,opts['--baseline-compiled-dir']),old=await load('compiler/battle-encounter-runtime',baselineDir),{sourceFlagContext,...legacyInput}=runtimeInput,
   baseline=old.compileBattleEncounterRuntime(modules.reader,legacyInput),baseHard=baseline.diagnostics.filter(d=>d.kind==='blocked'),keys=new Set(hard.map(d=>api.canonical(d))),oldKeys=new Set(baseHard.map(d=>api.canonical(d))),removed=baseHard.filter(d=>!keys.has(api.canonical(d))),added=hard.filter(d=>!oldKeys.has(api.canonical(d))),
   unaffected=ds=>ds.filter(d=>d.code!=='battle-flags'&&d.code!=='manual-controls-policy').map(d=>api.canonical(d)).sort();
  assert.deepEqual(added,[],'A non-flag hard diagnostic was introduced');assert(removed.every(d=>d.code==='battle-flags'),'A non-flag hard diagnostic was removed');assert.deepEqual(unaffected(current.diagnostics),unaffected(baseline.diagnostics),'Other source diagnostics changed');
  report.sameSourceBaselineComparison={scope:'Independent captured pre-change compiler, exactly the same original descriptors, abilities, reader, conditions, policies and complete source script/AI bodies. No script/flag omissions.',baselineCompiledDir:baselineDir,baselineCompilerSha256:sha(await readFile(resolve(baselineDir,'src/compiler/battle-encounter-runtime.js'))),baselineDefinitions:Object.keys(baseline.encounters).length,baselineHardFlagParties:new Set(baseHard.filter(d=>d.code==='battle-flags').map(d=>d.partyId)).size,removedHardFlagDiagnostics:removed,addedHardDiagnostics:added,allOtherDiagnosticsExact:true,baselineReport:baseline.report,baselineDiagnostics:baseline.diagnostics};
  report.counts.baselineDefinitions=Object.keys(baseline.encounters).length;report.counts.baselineHardFlagParties=report.sameSourceBaselineComparison.baselineHardFlagParties;report.counts.removedHardFlagDiagnostics=removed.length;
 }
 assert.equal(input.sourceDigest,(await loadBattleEventMessageSourceInputs(root,compiled)).sourceDigest);assert.equal(sha(await readFile(policyFile)),sha(policyBytes));assert.equal(sha(await readFile(fileURLToPath(import.meta.url))),sha(checkerBytes));assert.equal(await runtimeDigest(view,compiled),before);report.inputsRevalidated=true;report.result='passed-complete-source-flag-compilation-not-execution';
}catch(error){report.result='failed';report.error=error.stack??String(error);throw error;}finally{await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,report:out}));}
