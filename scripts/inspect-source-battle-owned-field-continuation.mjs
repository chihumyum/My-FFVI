// Pure full-source compiler audit. No map producer, source script mutation or execution.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy} from './source-battle-directory.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),opts={};
assert.equal(args.length%2,0);for(let i=0;i<args.length;i+=2){assert(['--compiled-dir','--baseline-compiled-dir','--report'].includes(args[i])&&args[i+1]&&!opts[args[i]]);opts[args[i]]=args[i+1];}
const compiled=resolve(root,opts['--compiled-dir']??'dist'),out=resolve(root,opts['--report']??'build/reports/source-battle-owned-field-continuation.json'),
  load=(n,dir=compiled)=>import(pathToFileURL(resolve(dir,'src',n+'.js'))),sha=b=>createHash('sha256').update(b).digest('hex'),
  api=Object.assign({},...await Promise.all(['compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure'].map(n=>load(n)))),runtime=await runtimeDigest(root,compiled);
const selectors=new Set(['ガウバトルモード設定','とびこむで離脱','敵パーティをガウに','ガウ登場アニメ','バトル加入：ガウ','メンバー加入：ガウ','ガウ初回予約','バトルでシャドウ離脱','シャドウ離脱抽選']);
await mkdir(dirname(out),{recursive:true});const report={kind:'whole-source-battle-owned-field-continuation-v1',result:'running',runtimeSha256:runtime,worldCompilations:0,sourceExecutions:0,sourceCampaignComplete:false,nativeDynamicParity:false};
try{
 const input=await loadBattleEventMessageSourceInputs(root,compiled),dep=input.dependencies,source=await api.compileSharedBattleSource(root),modules=await api.compileGameCatalogModules(root,source),
   policy=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')))}),
   participantClosure=policy.framework.sourceParticipants?api.compileSourceBattleParticipantClosure(input.snapshot.reader,{policy:policy.framework.sourceParticipants,encounters:dep.encounters,sources:input.encounterSources,eventMessages:modules.runtimeInput.eventMessages,branchExecution:policy.framework.branchExecution}):null,
   runtimeInput={...modules.runtimeInput,requestedPartyIds:dep.requestedPartyIds,encounters:dep.encounters,sourceDiagnostics:dep.diagnostics,
     ...(policy.framework.branchExecution?{branchExecution:policy.framework.branchExecution}:{}),
     ...(participantClosure?{reserveEnemies:participantClosure.reserveEnemies,enemyParties:participantClosure.enemyParties,sourceDiagnostics:[...dep.diagnostics,...participantClosure.diagnostics]}:{}),
     ...(policy.framework.forcedSavePolicy?{forcedSavePolicy:policy.framework.forcedSavePolicy}:{}),
      ...(policy.framework.manualControls===undefined?{}:{manualControls:policy.framework.manualControls}),
     ...(policy.framework.conditionControlPolicy?{conditionControlPolicy:policy.framework.conditionControlPolicy}:{}),
     handoff:{policy:policy.framework.handoff},development:{...(policy.framework.entry?.formations?{formations:policy.framework.entry.formations}:{}),scripts:[],flagGroups:[],...(participantClosure?{participants:participantClosure.participants}:{})}},
   directory=api.compileBattleEncounterRuntime(modules.reader,runtimeInput),sites=[],selected=[],beforeHash=api.hash(input.programs);
 for(const program of input.programs){const hits=[];
  for(const [pc,raw]of program.data.Mnemonics.entries())if(raw.mnemonic==='GetEnemyMode'||raw.mnemonic==='SysCall'&&selectors.has(raw.operands.sValues[0])){
   const row={program:program.id,source:program.source,rawHash:program.rawHash,pc,raw,decoded:program.compiled.instructions[pc].op,
     dependentParties:dep.encounters.filter(e=>e.script?.source.assetPath===program.source.assetPath).map(e=>e.partyId)};sites.push(row);hits.push(pc);
  }if(hits.length)selected.push({program:program.id,sites:hits,rawHash:program.rawHash,completeInstructions:program.data.Mnemonics.length});
 }
 assert.equal(input.programs.length,53);assert.equal(dep.requestedPartyIds.length,490);assert.equal(sites.filter(s=>s.decoded.kind==='set-gau-mode').length,5);assert.equal(sites.filter(s=>s.decoded.kind==='get-enemy-mode').length,14);
 const groups=new Map();for(const site of sites){const key=api.canonical({mnemonic:site.raw.mnemonic,operands:site.raw.operands,cause:site.decoded.kind==='blocked'?site.decoded.reason:null}),group=groups.get(key)??{mnemonic:site.raw.mnemonic,operands:site.raw.operands,cause:site.decoded.kind==='blocked'?site.decoded.reason:null,sites:[]};group.sites.push({program:site.program,pc:site.pc,dependentParties:site.dependentParties});groups.set(key,group);}
 report.counts={allPhysicalPrograms:input.scripts.length,allSourceInstructions:input.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),battlePrograms:53,battleInstructions:input.programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),
   exportBoundPrograms:input.programs.filter(p=>p.battleExportBinding.kind==='exact-battle-export-source-binding-v1').length,exportUnboundPrograms:input.programs.filter(p=>p.battleExportBinding.kind==='unbound-battle-export-source-v1').length,
   requestedParties:490,descriptors:dep.encounters.length,descriptorDiagnostics:dep.diagnostics.length,selectedPrograms:selected.length,completeSelectedInstructions:selected.reduce((n,p)=>n+p.completeInstructions,0),sites:sites.length,exactOperandCauseGroups:groups.size,
   decodedSetGauMode:5,decodedGetEnemyMode:14,remainingSpecificGauGates:sites.filter(s=>s.decoded.kind==='blocked').length,currentDirectoryDefinitions:Object.keys(directory.encounters).length};
 assert.equal(sites.length,50);assert.equal(selected.length,12);assert.equal(report.counts.completeSelectedInstructions,1076);
 const broad=input.scripts.flatMap(program=>program.data.Mnemonics.flatMap((raw,pc)=>raw.mnemonic==='GetEnemyMode'||raw.mnemonic==='SysCall'&&(/ガウ|シャドウ/.test(raw.operands.sValues[0])||selectors.has(raw.operands.sValues[0]))?[{program:program.id,pc,raw,source:program.source}]:[])),
   broadIds=new Set(broad.map(site=>site.program)),wholeBroad=input.scripts.filter(program=>broadIds.has(program.id));
 assert.equal(input.scripts.length,3304);assert.equal(report.counts.allSourceInstructions,186003);assert.equal(report.counts.battleInstructions,2312);
 assert.equal(broad.length,94);assert.equal(wholeBroad.length,41);assert.equal(wholeBroad.reduce((n,p)=>n+p.data.Mnemonics.length,0),6858);
 report.wholeFamily={directSites:50,directPrograms:12,directBodyInstructions:1076,broadSites:broad.length,broadPrograms:41,broadBodyInstructions:6858,
   broad,completeBroadPrograms:wholeBroad,completeReservedPrograms:input.scripts.filter(p=>['sc_e_0239','sc_secede_shadow'].includes(p.data.Name)),
   allRemainingBlockedBattleSyscalls:input.programs.flatMap(program=>program.data.Mnemonics.flatMap((raw,pc)=>raw.mnemonic==='SysCall'&&program.compiled.instructions[pc].op.kind==='blocked'?[{program:program.id,pc,raw,decoded:program.compiled.instructions[pc].op}]:[])),
   allBattleFadeOut:input.programs.flatMap(program=>program.data.Mnemonics.flatMap((raw,pc)=>raw.mnemonic==='FadeOut'?[{program:program.id,pc,raw}]:[]))};
 assert.equal(report.wholeFamily.allBattleFadeOut.length,8);
 report.directoryInputScope={kind:'same-source-descriptor-runtime-with-participant-closure-v1',policy,participantClosure,descriptorCount:dep.encounters.length,descriptorDiagnostics:dep.diagnostics,frameworkCompositionApplied:false,sourceInitializedCatalogComposed:false,noComparisonToPublishedOrJointDirectoryCounts:true};
 report.inputs={sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,sourceDigest:input.sourceDigest,physicalSources:input.snapshot.manifest.sources,messageBinding:input.input.binding};
 report.sites=sites;report.groups=[...groups.values()];report.selected=selected;report.completeBattlePrograms=input.programs;report.completeSourcePartyDependencies=dep;report.completeDirectory={encounters:directory.encounters,diagnostics:directory.diagnostics,report:directory.report,sourceScriptOmissions:[],sourceFlagOmissions:[]};
 if(opts['--baseline-compiled-dir']){
  const dir=resolve(root,opts['--baseline-compiled-dir']),old=await load('compiler/battle-event',dir),changes=[];
  const oldClosureApi=await load('compiler/source-battle-participant-closure',dir),oldClosure=policy.framework.sourceParticipants?oldClosureApi.compileSourceBattleParticipantClosure(input.snapshot.reader,{policy:policy.framework.sourceParticipants,encounters:dep.encounters,sources:input.encounterSources,eventMessages:modules.runtimeInput.eventMessages,branchExecution:policy.framework.branchExecution}):null;
  assert.deepEqual(oldClosure,participantClosure,'Changed an independent source participant dependency closure');
  for(const program of input.programs){const baseline=old.compileBattleEvent(program.data,program.compiled.source,input.input,input.snapshot.reader);
   assert.equal(baseline.instructions.length,program.compiled.instructions.length);assert.deepEqual(baseline.blockers,program.compiled.blockers);
   for(let pc=0;pc<baseline.instructions.length;pc++)if(api.canonical(baseline.instructions[pc])!==api.canonical(program.compiled.instructions[pc])){
    assert(sites.some(s=>s.program===program.id&&s.pc===pc),'Changed a non-family operation');changes.push({program:program.id,pc,before:baseline.instructions[pc],after:program.compiled.instructions[pc]});
   }
  }
  const baselineRuntime=await load('compiler/battle-encounter-runtime',dir),baselineDirectory=baselineRuntime.compileBattleEncounterRuntime(modules.reader,runtimeInput),
    unaffected=rows=>rows.filter(row=>row.code!=='battle-script').map(api.canonical).sort();
  const beforeDiagnostics=unaffected(baselineDirectory.diagnostics),afterDiagnostics=unaffected(directory.diagnostics);
  for(const row of beforeDiagnostics)assert(afterDiagnostics.includes(row),'Lost a non-script directory diagnostic');
  report.newlyVisibleNonScriptDiagnostics=directory.diagnostics.filter(row=>row.code!=='battle-script'&&!beforeDiagnostics.includes(api.canonical(row)));
  assert.equal(changes.length,13);for(const change of changes)assert(['reserve-gau-first','shadow-battle-departure','gau-leap'].includes(change.after.op.kind),'Changed an unimplemented owned phase');
  report.sameSourceBaseline={compilerSha256:sha(await readFile(resolve(dir,'src/compiler/battle-event.js'))),changes,allOtherInstructionsAndHeadersExact:true,
    baselineDefinitions:Object.keys(baselineDirectory.encounters),currentDefinitions:Object.keys(directory.encounters),allPreviousNonScriptDirectoryDiagnosticsPreserved:true,
    baselineDirectory:{report:baselineDirectory.report,diagnostics:baselineDirectory.diagnostics}};
 }
 assert.equal(beforeHash,api.hash(input.programs));assert.equal((await loadBattleEventMessageSourceInputs(root,compiled)).sourceDigest,input.sourceDigest);assert.equal(await runtimeDigest(root,compiled),runtime);
 report.result='passed-complete-family-compilation-not-execution';
}catch(error){report.result='failed';report.error=error.stack??String(error);throw error;}finally{await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,report:out}));}
