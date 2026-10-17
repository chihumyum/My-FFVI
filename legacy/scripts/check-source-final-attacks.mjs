// Full-source Final census and unchanged-operand probes. This is not a map
// producer, a walking admission gate, or original complete-body gameplay.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
import {readSourceBattleDirectoryPolicy,compileSourceBattleDirectoryEntryPolicy} from './source-battle-directory.mjs';
const args=process.argv.slice(2),opt={root:resolve(import.meta.dirname,'..'),compiled:'dist',before:null,output:'build/reports/source-final-attacks'};
while(args.length){const key=args.shift();assert(['--root','--compiled','--before','--output'].includes(key)&&args[0]);opt[key.slice(2)]=args.shift();}
assert(opt.before,'Independent fixed before author tree is required');
const root=resolve(opt.root),dist=resolve(root,opt.compiled),beforeRoot=resolve(root,opt.before),before=resolve(beforeRoot,'dist'),out=resolve(root,opt.output);
assert(out.startsWith(resolve(root,'build')+'/'),'Original source reports remain ignored');await mkdir(out,{recursive:true});
const load=(base,name)=>import(pathToFileURL(resolve(base,'src',name+'.js')).href),names=[
 'compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure',
 'compiler/ability','compiler/battle-ai','compiler/world','compiler/battle-encounters','core/battle-ai','core/enemy-behavior','core/battle-ai-targets'];
const api=Object.assign({},...await Promise.all(names.map(name=>load(dist,name)))),old=Object.assign({},...await Promise.all(names.map(name=>load(before,name)))),
 runtime=await runtimeDigest(root,dist),beforeRuntime=await runtimeDigest(beforeRoot,before),
 policy=JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json'),'utf8')),
 declared=await readSourceBattleDirectoryPolicy({root,compiledDir:dist,policy}),framework=declared.framework,
 input=await loadBattleEventMessageSourceInputs(root,dist,{branchExecution:framework.branchExecution,sourceFormatImport:true,gauInstancePolicy:framework.gauInstances}),
 ais=input.scripts.filter(p=>p.source.assetPath.includes('/MonsterAI/'));
assert.equal(input.scripts.length,3304);assert.equal(input.scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),186003);
assert.equal(input.programs.length,53);assert.equal(input.programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),2312);
assert.equal(ais.length,430);assert.equal(ais.reduce((n,p)=>n+p.data.Mnemonics.length,0),10093);
assert.equal(input.dependencies.requestedPartyIds.length,490);assert.equal(input.dependencies.encounters.length,483);assert.equal(input.dependencies.diagnostics.length,7);
const sites=[],completeAI=[],abilityIds=new Set();let changed=0,probes=0,messageGates=0;
for(const p of ais){let now,was,error=null,oldError=null;try{now=api.compileBattleAI(p.data,null);}catch(e){error=String(e);}try{was=old.compileBattleAI(p.data,null);}catch(e){oldError=String(e);}
 assert.equal(error,oldError);const normalized=structuredClone(now),retained=[];
 for(const[pc,raw]of p.data.Mnemonics.entries()){
  if(!['FinalAttackAct','FinalLoopAttackAct'].includes(raw.mnemonic))continue;
  const ordinary=raw.mnemonic==='FinalAttackAct',typed=now?.instructions[pc]?.op,prior=was?.instructions[pc]?.op,
   record={program:p.id,source:p.source,rawHash:api.hash(p.data),pc,raw,ordinary,typed,before:prior};
  sites.push(record);retained.push(pc);
  if(!ordinary){assert.deepEqual(typed,prior);assert.equal(typed?.kind,'blocked');continue;}
  assert.equal(typed?.kind,'final-act');assert.equal(prior?.kind,'blocked');changed++;
  normalized.instructions[pc]=structuredClone(was.instructions[pc]);
  for(const id of raw.operands.iValues)abilityIds.add(id);
  const stub={Segments:[{Label:'Main',EntryPoint:0,Count:4}],ScriptLocal:[],ScriptLocalValue:[],SystemFlag:{},Animations:[],Mnemonics:[
   {type:1,mnemonic:'Nop',operands:{iValues:[],rValues:[],sValues:[]}},
   {type:1,mnemonic:'SyncAI',operands:{iValues:[],rValues:[],sValues:[]}},structuredClone(raw),
   {type:1,mnemonic:'JumpBattleAI',operands:{iValues:[0],rValues:[],sValues:[]}}]};
  const program=api.compileBattleAI(stub,null),context={self:{hp:0,mp:100,monsterId:1,behavior:api.initialEnemyBehavior()},conditionIds:[],players:[{level:1}],enemies:[{level:1}]},
   initial=api.startBattleAI(program,context),wake={counterReady:false,receivedAbilityId:1,receivedSystemId:3};
  assert.deepEqual(api.planBattleAIReaction(program,initial.state,context,wake).acts,[]);
  if(raw.operands.sValues.some(value=>value!=='')){
   assert.throws(()=>api.planBattleAIReaction(program,initial.state,context,{...wake,finalReady:true}),/FinalAttackAct message execution/);
   record.parameterProbe={result:'specific-message-phase-gate'};messageGates++;continue;
  }
  const turn=api.planBattleAIReaction(program,initial.state,context,{...wake,finalReady:true});assert.equal(turn.acts.length,1);
  assert.deepEqual(turn.acts[0].abilities,raw.operands.iValues);assert.deepEqual(turn.acts[0].weights,raw.operands.rValues);
  record.parameterProbe={result:'selected-original-operands',draws:[0,1].map(edge=>{let count=0;
   const ids=api.selectBattleAIAbilities(turn.acts[0],{integer:(min,max)=>{count++;return edge?max:min;},float:(min,max)=>{count++;return edge?max:min;}});
   assert.equal(count,1);assert.equal(ids.length,1);assert(raw.operands.iValues.includes(ids[0]));return {edge,ids,count};})};probes++;
 }
 assert.deepEqual(normalized,was,'Non-Final decoder changed: '+p.id);completeAI.push({...p,rawHash:api.hash(p.data),parseError:error,finalSites:retained});
}
const ordinary=sites.filter(s=>s.ordinary),loops=sites.filter(s=>!s.ordinary),ordinaryPrograms=completeAI.filter(p=>ordinary.some(s=>s.program===p.id));
assert.equal(changed,54);assert.equal(ordinary.length,54);assert.equal(new Set(ordinary.map(s=>s.program)).size,34);
assert.equal(ordinaryPrograms.reduce((n,p)=>n+p.data.Mnemonics.length,0),1159);assert.equal(loops.length,8);assert.equal(new Set(loops.map(s=>s.program)).size,6);
assert.equal(abilityIds.size,21);assert.equal(probes,53);assert.equal(messageGates,1);
const source=await api.compileSharedBattleSource(root,{gauInstances:framework.gauInstances}),shared=await api.compileGameCatalogModules(root,source),
 mapObligations=input.snapshot.tables['map.csv'].map(row=>api.compileSourceWalkEncounterDependencies(input.snapshot.reader,Number(row.id))),
 walkIds=[...new Set(mapObligations.flatMap(map=>map.set?Object.entries(map.set.values).filter(([key])=>/^monster_set\d+$/.test(key)).map(([,v])=>Number(v)).filter(id=>Number.isInteger(id)&&id>0):[]))],
 union=[...new Set([...input.dependencies.requestedPartyIds,...walkIds])].sort((a,b)=>a-b),
 combined=api.compileBattleEncounterSources(input.snapshot.reader,{partyIds:union,...input.encounterSources});
assert.equal(mapObligations.length,649);assert.equal(walkIds.length,259);assert.equal(combined.requestedPartyIds.length,492);assert.equal(combined.encounters.length,485);assert.equal(combined.diagnostics.length,7);
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
 const key=d=>api.canonical(d),oldSet=new Set(was.diagnostics.map(key)),newSet=new Set(now.diagnostics.map(key)),
  removed=was.diagnostics.filter(d=>!newSet.has(key(d))),added=now.diagnostics.filter(d=>!oldSet.has(key(d)));
 assert(removed.length>0);assert(removed.every(d=>d.code==='ai-instruction'&&d.reason.includes('FinalAttackAct')),'Unrelated source diagnostic was removed');
 observations.push({label,inputHash,requested:dependencies.requestedPartyIds.length,sourceDescriptors:dependencies.encounters.length,sourceDiagnostics:dependencies.diagnostics,
  completeInput:{...common,name:'same-live-name-owner-function',sourceFormatImport:'same-trusted-source-format-resolver'},participantClosure:closure.report,before:was,after:now,removed,added});
}
assert.equal(await runtimeDigest(root,dist),runtime);assert.equal(await runtimeDigest(beforeRoot,before),beforeRuntime);
const payload={kind:'whole-source-final-attack-check-v1',result:'passed',runtimeSha256:runtime,beforeRuntimeSha256:beforeRuntime,
 sourceDigest:input.sourceDigest,sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,
 counts:{allPrograms:3304,allInstructions:186003,allAI:430,allAIInstructions:10093,battlePrograms:53,battleInstructions:2312,ordinarySites:54,ordinaryCompleteAI:34,
  ordinaryBodyInstructions:1159,loopSites:8,loopCompleteAI:6,ordinaryAbilityCandidates:21,controlledOriginalOperandProbes:53,controlledMessagePhaseGates:1,
  originalCompleteAIExecutions:0,originalBattleExecutions:0,worldCompilations:0,publications:0},completeAI,completeBattlePrograms:input.programs,sites,
 sourceAbilities:[...abilityIds].map(id=>({id,row:input.snapshot.reader.row('ability.csv',id),compiled:api.compileDevelopmentAbility(input.snapshot.reader,id,String(id))})),mapObligations,observations,
 noWalkingAdmissionGranted:true,sourceCampaignComplete:false,nativeDynamicParity:false};
const bytes=JSON.stringify(payload)+'\n',file=resolve(out,'full-source.json');await writeFile(file,bytes);
const summary={kind:payload.kind,result:'passed',runtimeSha256:runtime,beforeRuntimeSha256:beforeRuntime,sourceDigest:input.sourceDigest,counts:payload.counts,
 artifact:{file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)},observations:observations.map(o=>({label:o.label,inputHash:o.inputHash,
  requested:o.requested,sourceDescriptors:o.sourceDescriptors,beforeDefinitions:Object.keys(o.before.encounters).length,afterDefinitions:Object.keys(o.after.encounters).length,
  beforeDiagnostics:o.before.diagnostics.length,afterDiagnostics:o.after.diagnostics.length,removed:o.removed.length,added:o.added.length})),
 noWalkingAdmissionGranted:true,sourceCampaignComplete:false,nativeDynamicParity:false};
await writeFile(resolve(out,'report.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
