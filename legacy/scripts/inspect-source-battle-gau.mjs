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
const compiled=resolve(root,opts['--compiled-dir']??'dist'),out=resolve(root,opts['--report']??'build/reports/source-battle-gau.json'),
  load=(n,dir=compiled)=>import(pathToFileURL(resolve(dir,'src',n+'.js'))),sha=b=>createHash('sha256').update(b).digest('hex'),
  api=Object.assign({},...await Promise.all(['compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime'].map(n=>load(n)))),runtime=await runtimeDigest(root,compiled);
const selectors=new Set(['ガウバトルモード設定','とびこむで離脱','敵パーティをガウに','ガウ登場アニメ','バトル加入：ガウ','メンバー加入：ガウ','ガウ初回予約']);
await mkdir(dirname(out),{recursive:true});const report={kind:'whole-source-battle-gau-family-v1',result:'running',runtimeSha256:runtime,worldCompilations:0,sourceExecutions:0,sourceCampaignComplete:false,nativeDynamicParity:false};
try{
 const input=await loadBattleEventMessageSourceInputs(root,compiled),dep=input.dependencies,source=await api.compileSharedBattleSource(root),modules=await api.compileGameCatalogModules(root,source),
   policy=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')))}),
   runtimeInput={...modules.runtimeInput,requestedPartyIds:dep.requestedPartyIds,encounters:dep.encounters,sourceDiagnostics:dep.diagnostics,
     ...(policy.framework.spawnConditionPolicy?{spawnConditionPolicy:policy.framework.spawnConditionPolicy}:{}),...(policy.framework.forcedSavePolicy?{forcedSavePolicy:policy.framework.forcedSavePolicy}:{}),
      ...(policy.framework.manualControls===undefined?{}:{manualControls:policy.framework.manualControls}),
     ...(policy.framework.conditionControlPolicy?{conditionControlPolicy:policy.framework.conditionControlPolicy}:{}),
     handoff:{policy:policy.framework.handoff},development:{...(policy.framework.entry?.formations?{formations:policy.framework.entry.formations}:{}),scripts:[],flagGroups:[]}},
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
 report.inputs={sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,sourceDigest:input.sourceDigest,physicalSources:input.snapshot.manifest.sources,messageBinding:input.input.binding};
 report.sites=sites;report.groups=[...groups.values()];report.selected=selected;report.completeBattlePrograms=input.programs;report.completeSourcePartyDependencies=dep;report.completeDirectory={encounters:directory.encounters,diagnostics:directory.diagnostics,report:directory.report,sourceScriptOmissions:[],sourceFlagOmissions:[]};
 if(opts['--baseline-compiled-dir']){
  const dir=resolve(root,opts['--baseline-compiled-dir']),old=await load('compiler/battle-event',dir),changes=[];
  for(const program of input.programs){const baseline=old.compileBattleEvent(program.data,program.compiled.source,input.input,input.snapshot.reader);
   assert.equal(baseline.instructions.length,program.compiled.instructions.length);assert.deepEqual(baseline.blockers,program.compiled.blockers);
   for(let pc=0;pc<baseline.instructions.length;pc++)if(api.canonical(baseline.instructions[pc])!==api.canonical(program.compiled.instructions[pc])){
    assert(sites.some(s=>s.program===program.id&&s.pc===pc),'Changed a non-family operation');changes.push({program:program.id,pc,before:baseline.instructions[pc],after:program.compiled.instructions[pc]});
   }
  }
  const baselineRuntime=await load('compiler/battle-encounter-runtime',dir),baselineDirectory=baselineRuntime.compileBattleEncounterRuntime(modules.reader,runtimeInput),
    unaffected=rows=>rows.filter(row=>row.code!=='battle-script').map(api.canonical).sort();
  assert.deepEqual(unaffected(baselineDirectory.diagnostics),unaffected(directory.diagnostics),'Changed a non-script directory diagnostic');
  report.sameSourceBaseline={compilerSha256:sha(await readFile(resolve(dir,'src/compiler/battle-event.js'))),changes,allOtherInstructionsAndHeadersExact:true,
    baselineDefinitions:Object.keys(baselineDirectory.encounters),currentDefinitions:Object.keys(directory.encounters),allOtherDirectoryDiagnosticsExact:true,
    baselineDirectory:{report:baselineDirectory.report,diagnostics:baselineDirectory.diagnostics}};
 }
 assert.equal(beforeHash,api.hash(input.programs));assert.equal((await loadBattleEventMessageSourceInputs(root,compiled)).sourceDigest,input.sourceDigest);assert.equal(await runtimeDigest(root,compiled),runtime);
 report.result='passed-complete-family-compilation-not-execution';
}catch(error){report.result='failed';report.error=error.stack??String(error);throw error;}finally{await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,report:out}));}
