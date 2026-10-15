// Pure whole-source compiler conservation. No source execution or map producer.
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
const compiled=resolve(root,opts['--compiled-dir']??'dist'),out=resolve(root,opts['--report']??'build/reports/source-post-battle.json'),
  load=(name,dir=compiled)=>import(pathToFileURL(resolve(dir,'src',name+'.js'))),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),
  api=Object.assign({},...await Promise.all(['compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime'].map(name=>load(name)))),runtime=await runtimeDigest(root,compiled);
const selectors=new Set(['血塗られた盾','シャドウ離脱抽選','バトルでシャドウ離脱']);
await mkdir(dirname(out),{recursive:true});const report={kind:'whole-source-post-battle-checks-family-v1',result:'running',runtimeSha256:runtime,
  sourceExecutions:0,worldCompilations:0,sourceCampaignComplete:false,nativeDynamicParity:false};
try{
  const input=await loadBattleEventMessageSourceInputs(root,compiled),dep=input.dependencies,source=await api.compileSharedBattleSource(root),modules=await api.compileGameCatalogModules(root,source),
    policy=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json')))}),
    runtimeInput={...modules.runtimeInput,requestedPartyIds:dep.requestedPartyIds,encounters:dep.encounters,sourceDiagnostics:dep.diagnostics,
      ...(policy.framework.manualControls===undefined?{}:{manualControls:policy.framework.manualControls}),
      ...(policy.framework.conditionControlPolicy?{conditionControlPolicy:policy.framework.conditionControlPolicy}:{}),
      handoff:{policy:policy.framework.handoff},development:{...(policy.framework.entry?.formations?{formations:policy.framework.entry.formations}:{}),scripts:[],flagGroups:[]}},
    directory=api.compileBattleEncounterRuntime(modules.reader,runtimeInput),sites=[],selected=[],beforeHash=api.hash(input.programs);
  for(const program of input.programs){const hits=[];
    for(const[pc,raw]of program.data.Mnemonics.entries())if(raw.mnemonic==='SysCall'&&selectors.has(raw.operands.sValues[0])){
      sites.push({program:program.id,source:program.source,rawHash:program.rawHash,pc,raw,decoded:program.compiled.instructions[pc].op,
        dependentParties:dep.encounters.filter(enc=>enc.script?.source.assetPath===program.source.assetPath).map(enc=>enc.partyId)});hits.push(pc);
    }
    if(hits.length)selected.push({program:program.id,rawHash:program.rawHash,completeInstructions:program.data.Mnemonics.length,sites:hits});
  }
  const count=kind=>sites.filter(site=>site.decoded.kind===kind).length,parties=[...new Set(sites.flatMap(site=>site.dependentParties))].sort((a,b)=>a-b);
  assert.equal(input.programs.length,53);assert.equal(dep.requestedPartyIds.length,490);assert.equal(sites.length,14);assert.equal(selected.length,7);
  assert.equal(selected.reduce((n,p)=>n+p.completeInstructions,0),585);assert.equal(parties.length,406);
  assert.equal(count('cursed-shield-check'),6);assert.equal(count('shadow-secede-lot'),3);assert.equal(count('blocked'),5);
  const groups=new Map();for(const site of sites){const key=api.canonical({mnemonic:site.raw.mnemonic,operands:site.raw.operands,cause:site.decoded.kind==='blocked'?site.decoded.reason:null}),group=groups.get(key)??{mnemonic:site.raw.mnemonic,operands:site.raw.operands,cause:site.decoded.kind==='blocked'?site.decoded.reason:null,sites:[]};group.sites.push({program:site.program,pc:site.pc,dependentParties:site.dependentParties});groups.set(key,group);}
  const contentRows=[213,214].map(id=>input.snapshot.reader.row('content.csv',id));
  for(const row of contentRows)assert.equal(row.values.type_id,'3');
  const armorRows=contentRows.map(row=>input.snapshot.reader.row('armor.csv',row.values.type_value)),characterRow=input.snapshot.reader.row('character_status.csv',4),commandRow=input.snapshot.reader.row('command.csv',1);
  report.sourceConstants={contentRows,armorRows,characterRow,commandRow,staticFlagArrays:{start:[97,123,147],stop:[108,125,158],source:'exact PE Current.cctor setters + InitializeArray metadata payloads; independent native audit required'},
    runtimeLimits:['Cursed 256 equipment conversion remains a reached gate','Shadow fixedPreeMptiveState is captured as unknown; no guessed Web formation mapping','Shadow BattleActLog publication is not substituted by display/learning logs','All 4 Shadow battle-departure calls remain blocked for owned/field-script lifecycle']};
  report.counts={allPhysicalPrograms:input.scripts.length,allSourceInstructions:input.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),battlePrograms:53,battleInstructions:input.programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),
    exportBoundPrograms:input.programs.filter(p=>p.battleExportBinding.kind==='exact-battle-export-source-binding-v1').length,exportUnboundPrograms:input.programs.filter(p=>p.battleExportBinding.kind==='unbound-battle-export-source-v1').length,
    requestedParties:490,descriptors:dep.encounters.length,descriptorDiagnostics:dep.diagnostics.length,selectedPrograms:selected.length,completeSelectedInstructions:585,sites:14,dependentParties:parties.length,exactOperandCauseGroups:groups.size,
    decodedCursedShieldChecks:count('cursed-shield-check'),decodedShadowLots:count('shadow-secede-lot'),remainingSpecificDepartureGates:sites.filter(site=>site.raw.operands.sValues[0]==='バトルでシャドウ離脱').length,remainingDeclaredLocalBankGates:sites.filter(site=>site.raw.operands.sValues[0]==='シャドウ離脱抽選'&&site.decoded.kind==='blocked').length,currentDirectoryDefinitions:Object.keys(directory.encounters).length};
  report.inputs={sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,sourceDigest:input.sourceDigest,physicalSources:input.snapshot.manifest.sources,messageBinding:input.input.binding};
  report.sites=sites;report.groups=[...groups.values()];report.selected=selected;report.dependentParties=parties;report.completeBattlePrograms=input.programs;report.completeSourcePartyDependencies=dep;
  report.completeDirectory={encounters:directory.encounters,diagnostics:directory.diagnostics,report:directory.report,sourceScriptOmissions:[],sourceFlagOmissions:[]};
  if(opts['--baseline-compiled-dir']){
    const dir=resolve(root,opts['--baseline-compiled-dir']),old=await load('compiler/battle-event',dir),changes=[];
    for(const program of input.programs){const baseline=old.compileBattleEvent(program.data,program.compiled.source,input.input,input.snapshot.reader);
      assert.equal(baseline.instructions.length,program.compiled.instructions.length);assert.deepEqual(baseline.blockers,program.compiled.blockers);
      for(let pc=0;pc<baseline.instructions.length;pc++)if(api.canonical(baseline.instructions[pc])!==api.canonical(program.compiled.instructions[pc])){
        assert(sites.some(site=>site.program===program.id&&site.pc===pc),'Changed a non-family operation');changes.push({program:program.id,pc,before:baseline.instructions[pc],after:program.compiled.instructions[pc]});
      }
    }
    assert.equal(changes.length,14);
    const previous=await load('compiler/battle-encounter-runtime',dir),baselineDirectory=previous.compileBattleEncounterRuntime(modules.reader,runtimeInput),
      unaffected=rows=>rows.filter(row=>row.code!=='battle-script').map(api.canonical).sort();
    assert.deepEqual(unaffected(baselineDirectory.diagnostics),unaffected(directory.diagnostics));
    report.sameSourceBaseline={compilerSha256:sha(await readFile(resolve(dir,'src/compiler/battle-event.js'))),changes,allOtherInstructionsAndHeadersExact:true,
      baselineDefinitions:Object.keys(baselineDirectory.encounters),currentDefinitions:Object.keys(directory.encounters),allOtherDirectoryDiagnosticsExact:true,
      baselineDirectory:{report:baselineDirectory.report,diagnostics:baselineDirectory.diagnostics}};
  }
  assert.equal(beforeHash,api.hash(input.programs));assert.equal((await loadBattleEventMessageSourceInputs(root,compiled)).sourceDigest,input.sourceDigest);assert.equal(await runtimeDigest(root,compiled),runtime);
  report.result='passed-complete-family-compilation-not-execution';
}catch(error){report.result='failed';report.error=error.stack??String(error);throw error;}finally{await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,counts:report.counts,report:out}));}
