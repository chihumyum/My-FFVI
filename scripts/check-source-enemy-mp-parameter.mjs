// Whole-source MP-parameter census and unchanged decoder/ability/directory
// comparison. This is not a producer, source execution or walking admission.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy,compileSourceBattleDirectoryEntryPolicy} from './source-battle-directory.mjs';
const args=process.argv.slice(2),opt={root:resolve(import.meta.dirname,'..'),compiled:'dist',before:null,output:'build/reports/source-enemy-mp-parameter'};
while(args.length){const key=args.shift();assert(['--root','--compiled','--before','--output'].includes(key)&&args[0]);opt[key.slice(2)]=args.shift();}
assert(opt.before,'Independent fixed before author tree is required');
const root=resolve(opt.root),dist=resolve(root,opt.compiled),beforeRoot=resolve(root,opt.before),before=resolve(beforeRoot,'dist'),out=resolve(root,opt.output);
assert(out.startsWith(resolve(root,'build')+'/'),'Original source reports remain ignored');await mkdir(out,{recursive:true});
const load=(base,name)=>import(pathToFileURL(resolve(base,'src',name+'.js')).href),names=[
 'compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure',
 'compiler/ability','compiler/battle-ai','compiler/world','compiler/battle-encounters','core/battle-ai','core/enemy-behavior','core/battle-ai-targets','compiler/battle-event'];
const mpApi=await load(dist,'compiler/source-enemy-mp-parameter'),api=Object.assign({},...await Promise.all(names.map(name=>load(dist,name)))),old=Object.assign({},...await Promise.all(names.map(name=>load(before,name)))),
 runtime=await runtimeDigest(root,dist),beforeRuntime=await runtimeDigest(beforeRoot,before),
 policy=JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json'),'utf8')),
 declared=await readSourceBattleDirectoryPolicy({root,compiledDir:dist,policy}),framework=declared.framework,
 input=await loadBattleEventMessageSourceInputs(root,dist,{branchExecution:framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:framework.gauInstances}),
 ais=input.scripts.filter(p=>p.source.assetPath.includes('/MonsterAI/'));
assert.equal(input.scripts.length,3304);assert.equal(input.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),186003);
assert.equal(input.programs.length,53);assert.equal(input.programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),2312);
assert.equal(ais.length,430);assert.equal(ais.reduce((n,p)=>n+p.data.Mnemonics.length,0),10093);
assert.equal(input.dependencies.requestedPartyIds.length,490);assert.equal(input.dependencies.encounters.length,483);assert.equal(input.dependencies.diagnostics.length,7);
const completeAI=[],sites=[],sourceAbilities=[],sourceParameters=[];
for(const p of ais){let now=null,was=null,error=null,oldError=null;
 try{now=api.compileBattleAI(p.data,null);}catch(e){error=String(e);}try{was=old.compileBattleAI(p.data,null);}catch(e){oldError=String(e);}
 assert.equal(error,oldError);assert.deepEqual(now,was);completeAI.push({...p,rawHash:api.hash(p.data),compiled:now,parseError:error});
 for(const[pc,raw]of p.data.Mnemonics.entries())if(['FinalAttackAct','FinalLoopAttackAct'].includes(raw.mnemonic))sites.push({program:p.id,source:p.source,rawHash:api.hash(p.data),pc,raw,typed:now?.instructions[pc]?.op??null});
}
const ordinary=sites.filter(s=>s.raw.mnemonic==='FinalAttackAct'),loops=sites.filter(s=>s.raw.mnemonic==='FinalLoopAttackAct');
assert.equal(ordinary.length,54);assert.equal(new Set(ordinary.map(s=>s.program)).size,34);assert.equal(loops.length,8);assert.equal(new Set(loops.map(s=>s.program)).size,6);
for(const row of input.snapshot.tables['ability.csv']){let now=null,was=null,error=null,oldError=null;
 try{now=api.compileDevelopmentAbility(input.snapshot.reader,Number(row.id),row.id);}catch(e){error=String(e);}
 try{was=old.compileDevelopmentAbility(input.snapshot.reader,Number(row.id),row.id);}catch(e){oldError=String(e);}
 assert.equal(error,oldError);assert.deepEqual(now,was);sourceAbilities.push({row:input.snapshot.reader.row('ability.csv',row.id),compiled:now,error});
}
assert.equal(sourceAbilities.length,1530);
for(const row of input.snapshot.tables['monster.csv']){const value=mpApi.compileSourceEnemyMpParameter(input.snapshot.reader,Number(row.id));
 const groupRows=Number(row.monster_flag_group_id)===0?[]:input.snapshot.tables['monster_flag_group.csv'].filter(flag=>flag.group_id===row.monster_flag_group_id);
 assert.equal(value.metadata.isUnableMP,groupRows.some(flag=>flag.monster_flag_id==='4'));sourceParameters.push(value);
}
assert.equal(sourceParameters.length,508);assert.equal(sourceParameters.filter(p=>p.metadata.isUnableMP).length,87);
const completeBattlePrograms=[];
for(const p of input.programs){const bound=p.battleExportBinding?.kind==='exact-battle-export-source-binding-v1'?p.battleExportBinding.source:null,proof=bound?input.sourceFormatImport?.({data:p.data,source:bound}):undefined,
 was=old.compileBattleEvent(p.data,bound,input.input,input.snapshot.reader,framework.branchExecution,proof,framework.gauInstances);
 assert.deepEqual(p.compiled,was);completeBattlePrograms.push(p);
}
const source=await api.compileSharedBattleSource(root,{gauInstances:framework.gauInstances}),shared=await api.compileGameCatalogModules(root,source),
 mapObligations=input.snapshot.tables['map.csv'].map(row=>api.compileSourceWalkEncounterDependencies(input.snapshot.reader,Number(row.id))),
 walkIds=[...new Set(mapObligations.flatMap(map=>map.set?Object.entries(map.set.values).filter(([key])=>/^monster_set\d+$/.test(key)).map(([,v])=>Number(v)).filter(id=>Number.isInteger(id)&&id>0):[]))],
 union=[...new Set([...input.dependencies.requestedPartyIds,...walkIds])].sort((a,b)=>a-b),combined=api.compileBattleEncounterSources(input.snapshot.reader,{partyIds:union,...input.encounterSources});
assert.equal(mapObligations.length,649);assert.equal(combined.requestedPartyIds.length,492);assert.equal(combined.encounters.length,485);assert.equal(combined.diagnostics.length,7);
function changes(was,now,path='',result=[]){
 if(api.canonical(was)===api.canonical(now))return result;
 if(was&&now&&typeof was==='object'&&typeof now==='object'&&Array.isArray(was)===Array.isArray(now)){
  assert.deepEqual(Object.keys(was).filter(k=>k!=='mpParameter'),Object.keys(now).filter(k=>k!=='mpParameter'),'Unexpected directory keys '+path);
  for(const key of new Set([...Object.keys(was),...Object.keys(now)])){
   if(key==='mpParameter') {assert.equal(was[key],undefined);assert.equal(now[key]?.kind,'source-enemy-mp-parameter-v1');result.push({path:path+'.'+key,kind:'source-constructor-metadata',after:now[key]});}
   else if(key==='contentHash'){result.push({path:path+'.'+key,kind:'derived-content-hash',before:was[key],after:now[key]});}
   else changes(was[key],now[key],path+'.'+key,result);
  }return result;
 }
 throw Error('Unrelated directory value changed: '+path);
}
const observations=[];
for(const[label,dependencies]of [['original490',input.dependencies],['sourceAndWalkingUnion492',combined]]){
 const closure=api.compileSourceBattleParticipantClosure(shared.reader,{policy:framework.sourceParticipants,encounters:dependencies.encounters,sources:input.encounterSources,
  eventMessages:shared.runtimeInput.eventMessages,branchExecution:framework.branchExecution,sourceFormatImport:input.sourceFormatImport,gauInstancePolicy:framework.gauInstances}),
  development=await compileSourceBattleDirectoryEntryPolicy({root,compiledDir:dist,policy:framework.entry,encounters:dependencies.encounters}),
  common={...shared.runtimeInput,sourceFlagContext:'story',requestedPartyIds:dependencies.requestedPartyIds,encounters:dependencies.encounters,
   sourceDiagnostics:[...dependencies.diagnostics,...closure.diagnostics],reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,
   sourceFormatImport:input.sourceFormatImport,gauInstancePolicy:framework.gauInstances,gauInstanceContent:source.gauInstances.catalog,childPartyAdmission:framework.childPartyAdmission,
   spawnConditionPolicy:framework.spawnConditionPolicy,forcedSavePolicy:framework.forcedSavePolicy,branchExecution:framework.branchExecution,
   manualControls:framework.manualControls,conditionControlPolicy:framework.conditionControlPolicy,handoff:{policy:framework.handoff},development:{...development,participants:closure.participants}},
  digest=()=>api.hash({...common,name:'same-live-name-owner-function',sourceFormatImport:'same-trusted-source-format-resolver'}),inputHash=digest(),name=common.name,
  was=old.compileBattleEncounterRuntime(shared.reader,common),now=api.compileBattleEncounterRuntime(shared.reader,common);
 assert.equal(common.name,name);assert.equal(digest(),inputHash);
 const addedDiagnostics=now.diagnostics.filter(d=>d.code==='enemy-mp-fee-phase');
 assert(!was.diagnostics.some(d=>d.code==='enemy-mp-fee-phase'));
 assert.deepEqual(now.diagnostics.filter(d=>d.code!=='enemy-mp-fee-phase'),was.diagnostics,'Every old diagnostic retains its original order and body');
 for(const d of addedDiagnostics)assert(d.kind==='runtime-dependency'&&d.dependency?.table==='ability.csv'&&Number.isInteger(d.dependency.id));
 const delta=changes({...was,diagnostics:now.diagnostics},now);
 for(const d of addedDiagnostics)delta.push({kind:'reached-mp-fee-phase-dependency',after:d});assert(delta.some(d=>d.kind==='source-constructor-metadata'));
 observations.push({label,inputHash,requested:dependencies.requestedPartyIds.length,sourceDescriptors:dependencies.encounters.length,sourceDiagnostics:dependencies.diagnostics,
  completeInput:{...common,name:'same-live-name-owner-function',sourceFormatImport:'same-trusted-source-format-resolver'},participantClosure:closure.report,before:was,after:now,changes:delta});
}
assert.equal(await runtimeDigest(root,dist),runtime);assert.equal(await runtimeDigest(beforeRoot,before),beforeRuntime);
const payload={kind:'whole-source-enemy-mp-parameter-check-v1',result:'passed',runtimeSha256:runtime,beforeRuntimeSha256:beforeRuntime,
 sourceDigest:input.sourceDigest,sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,
 counts:{allPrograms:3304,allInstructions:186003,allAI:430,allAIInstructions:10093,battlePrograms:53,battleInstructions:2312,sourceMonsters:508,sourceAbilities:1530,
  ordinarySites:54,ordinaryCompleteAI:34,ordinaryAbilityCandidates:new Set(ordinary.flatMap(s=>s.raw.operands.iValues)).size,loopSites:8,loopCompleteAI:6,
  trueSourceConstructorBits:87,falseSourceConstructorBits:421,sourceOperandProbes:0,originalCompleteAIExecutions:0,originalBattleExecutions:0,worldCompilations:0,publications:0},
 completeAI,completeBattlePrograms,sourceAbilities,sourceParameters,sites,mapObligations,observations,
 noWalkingAdmissionGranted:true,sourceCampaignComplete:false,nativeDynamicParity:false};
const bytes=JSON.stringify(payload)+'\n',file=resolve(out,'full-source.json');await writeFile(file,bytes);
const summary={kind:payload.kind,result:'passed',runtimeSha256:runtime,beforeRuntimeSha256:beforeRuntime,sourceDigest:input.sourceDigest,counts:payload.counts,
 artifact:{file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)},observations:observations.map(o=>({label:o.label,inputHash:o.inputHash,
  requested:o.requested,sourceDescriptors:o.sourceDescriptors,beforeDefinitions:Object.keys(o.before.encounters).length,afterDefinitions:Object.keys(o.after.encounters).length,
  beforeDiagnostics:o.before.diagnostics.length,afterDiagnostics:o.after.diagnostics.length,constructorMetadataChanges:o.changes.filter(d=>d.kind==='source-constructor-metadata').length,
  derivedHashChanges:o.changes.filter(d=>d.kind==='derived-content-hash').length,addedMpFeePhaseDependencies:o.changes.filter(d=>d.kind==='reached-mp-fee-phase-dependency').length})),noWalkingAdmissionGranted:true,sourceCampaignComplete:false,nativeDynamicParity:false};
await writeFile(resolve(out,'report.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
