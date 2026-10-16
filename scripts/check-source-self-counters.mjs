// Whole CounterAct census and source-operand probes. Does not build maps,
// grant a walking policy, replace source effects or execute original AI bodies.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
const args=process.argv.slice(2),opt={root:resolve(import.meta.dirname,'..'),compiled:'dist',before:null,output:'build/reports/source-self-counters'};
while(args.length){const key=args.shift();assert(['--root','--compiled','--before','--output'].includes(key)&&args[0]);opt[key.slice(2)]=args.shift();}
assert(opt.before,'A separately compiled before runtime is required');
const root=resolve(opt.root),dist=resolve(root,opt.compiled),before=resolve(root,opt.before),out=resolve(root,opt.output);
assert(out.startsWith(resolve(root,'build')+'/'),'Source outputs must remain ignored');await mkdir(out,{recursive:true});
const load=(base,name)=>import(pathToFileURL(resolve(base,'src',name+'.js')).href),api=Object.assign({},...await Promise.all([
 'compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure',
 'compiler/ability','compiler/battle-ai','compiler/world','core/battle-ai','core/enemy-behavior','core/battle-ai-targets'].map(name=>load(dist,name)))),
 old=Object.assign({},...await Promise.all(['compiler/battle-encounter-runtime','compiler/battle-ai','core/battle-ai-targets'].map(name=>load(before,name)))),
 runtime=await runtimeDigest(root,dist),beforeRuntime=await runtimeDigest(root,before),input=await loadBattleEventMessageSourceInputs(root,dist),inputDigest=input.sourceDigest,
 sourcePrograms=input.scripts,ais=sourcePrograms.filter(p=>p.source.assetPath.includes('/MonsterAI/'));
assert.equal(sourcePrograms.length,3304);assert.equal(sourcePrograms.reduce((n,p)=>n+p.data.Mnemonics.length,0),186003);
assert.equal(input.programs.length,53);assert.equal(input.programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),2312);
assert.equal(ais.length,430);assert.equal(ais.reduce((n,p)=>n+p.data.Mnemonics.length,0),10093);
assert.equal(input.dependencies.requestedPartyIds.length,490);assert.equal(input.dependencies.encounters.length,483);assert.equal(input.dependencies.diagnostics.length,7);
const abilityRows=new Map(input.snapshot.tables['ability.csv'].map(row=>[Number(row.id),row])),sites=[],completeAI=[],abilities=new Map();
for(const p of ais){let compiled,prior,parseError=null,priorError=null;try{compiled=api.compileBattleAI(p.data,null);}catch(error){parseError=String(error);}
 try{prior=old.compileBattleAI(p.data,null);}catch(error){priorError=String(error);}
 assert.equal(parseError,priorError);assert.deepEqual(compiled,prior);
 completeAI.push({...p,rawHash:api.hash(p.data),parseError});
 for(const[pc,raw]of p.data.Mnemonics.entries())if(raw.mnemonic==='CounterAct'){
  const ranges=raw.operands.iValues.map(id=>({id,range:abilityRows.has(id)?Number(abilityRows.get(id).renge_id):null}));
  const selected=ranges.some(row=>row.range===5),record={program:p.id,source:p.source,rawHash:api.hash(p.data),pc,raw,ranges,selected,typed:compiled?.instructions[pc]?.op??null};
  sites.push(record);if(!selected)continue;assert.equal(record.typed?.kind,'counter-act');
  for(const{id,range}of ranges)if(range===5&&!abilities.has(id))abilities.set(id,api.compileDevelopmentAbility(input.snapshot.reader,id,String(id)));
  const one={Segments:[{Label:'Main',EntryPoint:0,Count:4}],ScriptLocal:[],ScriptLocalValue:[],SystemFlag:{},Animations:[],
   Mnemonics:[{type:1,mnemonic:'Nop',operands:{iValues:[],rValues:[],sValues:[]}},
    {type:1,mnemonic:'SyncAI',operands:{iValues:[],rValues:[],sValues:[]}},structuredClone(raw),
    {type:1,mnemonic:'JumpBattleAI',operands:{iValues:[0],rValues:[],sValues:[]}}]};
  // A controlled body isolates the unchanged original operand row; this is
  // deliberately not counted as execution of the original complete program.
  const p0=api.compileBattleAI(one,null),ctx={self:{hp:100,mp:10,monsterId:1,behavior:api.initialEnemyBehavior()},conditionIds:[],players:[{level:1}],enemies:[{level:1}]},
   turn=api.planBattleAIReaction(p0,api.startBattleAI(p0,ctx).state,ctx,{counterReady:true,receivedAbilityId:1,receivedSystemId:3});
  assert.equal(turn.acts.length,1);assert.deepEqual(turn.acts[0].abilities,raw.operands.iValues);assert.deepEqual(turn.acts[0].weights,raw.operands.rValues);
  record.sourceOperandBoundaryDraws=[0,1].map(edge=>{
   let draws=0;const ids=api.selectBattleAIAbilities(turn.acts[0],{integer:(min,max)=>{draws++;return edge?max:min;},float:(min,max)=>{draws++;return edge?max:min;}});
   assert.equal(draws,1);return {edge,ids,targetDispatch:ids.map(id=>api.sourceCounterTargeting(Number(abilityRows.get(id).renge_id),'received-actor'))};
  });
 }
}
const self=sites.filter(s=>s.selected);assert.equal(sites.length,233);assert.equal(self.length,203);assert.equal(new Set(self.map(s=>s.program)).size,111);assert.equal(abilities.size,37);
for(const definition of abilities.values())if(definition.plan){assert.equal(definition.program.range,5);assert.equal(api.battleAITargetBlocker(5,definition.plan.targeting,'counter'),null);
 assert.match(old.battleAITargetBlocker(5,definition.plan.targeting,'counter'),/counter target range 5/);}
const source=await api.compileSharedBattleSource(root),shared=await api.compileGameCatalogModules(root,source),
 policy=JSON.parse(await readFile(resolve(root,'content-batches/source-battle-directory.policy.json'),'utf8')),
 {readSourceBattleDirectoryPolicy,compileSourceBattleDirectoryEntryPolicy}=await import('./source-battle-directory.mjs'),
 declaration=await readSourceBattleDirectoryPolicy({root,compiledDir:dist,policy}),
 mapObligations=input.snapshot.tables['map.csv'].map(row=>api.compileSourceWalkEncounterDependencies(input.snapshot.reader,Number(row.id))),
 walkIds=[...new Set(mapObligations.flatMap(map=>map.set?Object.entries(map.set.values).filter(([k])=>/^monster_set\d+$/.test(k)).map(([,v])=>Number(v)).filter(id=>Number.isInteger(id)&&id>0):[]))],
 // Keep the raw walking inventory separate from the source-BattleScript
 // helper. The actual world producer has its own exact request inventory.
 union=[...new Set([...input.dependencies.requestedPartyIds,...walkIds])].sort((a,b)=>a-b);
assert.equal(mapObligations.length,649);assert.equal(walkIds.length,259);
const {compileBattleEncounterSources}=await load(dist,'compiler/battle-encounters'),
 combined=compileBattleEncounterSources(input.snapshot.reader,{partyIds:union,...input.encounterSources});
assert.equal(combined.requestedPartyIds.length,492);assert.equal(combined.encounters.length,485);assert.equal(combined.diagnostics.length,7);
const observations=[];
for(const[label,dependencies]of [['original490',input.dependencies],['sourceAndWalkingUnion492',combined]]){
 const closure=api.compileSourceBattleParticipantClosure(shared.reader,{policy:declaration.framework.sourceParticipants,encounters:dependencies.encounters,
   sources:input.encounterSources,eventMessages:shared.runtimeInput.eventMessages,branchExecution:declaration.framework.branchExecution}),
 development=await compileSourceBattleDirectoryEntryPolicy({root,compiledDir:dist,policy:declaration.framework.entry,encounters:dependencies.encounters}),
 common={...shared.runtimeInput,requestedPartyIds:dependencies.requestedPartyIds,encounters:dependencies.encounters,sourceDiagnostics:[...dependencies.diagnostics,...closure.diagnostics],
   reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,spawnConditionPolicy:declaration.framework.spawnConditionPolicy,
   forcedSavePolicy:declaration.framework.forcedSavePolicy,branchExecution:declaration.framework.branchExecution,manualControls:declaration.framework.manualControls,
   conditionControlPolicy:declaration.framework.conditionControlPolicy,handoff:{policy:declaration.framework.handoff},development:{...development,participants:closure.participants}},
 beforeInputHash=api.hash({...common,name:"compileGameCatalogModules-bound-name-provider"}),nameProvider=common.name,was=old.compileBattleEncounterRuntime(shared.reader,common),now=api.compileBattleEncounterRuntime(shared.reader,common);
 assert.equal(common.name,nameProvider);assert.equal(api.hash({...common,name:'compileGameCatalogModules-bound-name-provider'}),beforeInputHash,'Runtime compiler changed shared input');
 const key=d=>api.canonical(d),newSet=new Set(now.diagnostics.map(key)),oldSet=new Set(was.diagnostics.map(key)),
 removed=was.diagnostics.filter(d=>!newSet.has(key(d))),added=now.diagnostics.filter(d=>!oldSet.has(key(d)));
 assert(removed.length>0);assert(removed.every(d=>d.code==='automatic-target'&&d.reason.endsWith('counter target range 5')));
 assert.equal(added.length,0,'New target support must not change unrelated diagnostics');
 assert.deepEqual(Object.keys(now.encounters),Object.keys(was.encounters),'No other dependency gate is removed');
 observations.push({label,inputHash:beforeInputHash,requested:dependencies.requestedPartyIds.length,sourceDescriptors:dependencies.encounters.length,
  sourceDiagnostics:dependencies.diagnostics,participantClosure:closure.report,before:was,after:now,removed,added});
}
assert.equal(await runtimeDigest(root,dist),runtime);assert.equal(await runtimeDigest(root,before),beforeRuntime);
const payload={kind:'whole-source-self-counter-check-v1',result:'passed',runtimeSha256:runtime,beforeRuntimeSha256:beforeRuntime,
 sourceDigest:inputDigest,sourceSetHash:input.snapshot.sourceSetHash,parentSourceSetHash:input.snapshot.manifest.parentSourceSetHash,
 counts:{allPrograms:3304,allInstructions:186003,allAI:430,allAIInstructions:10093,battlePrograms:53,battleInstructions:2312,
  counterSites:233,selfCounterSites:203,selfCounterCompleteAI:111,selfCounterSourceAbilities:37,sourceOperandProbes:203,
  originalCompleteAIExecutions:0,originalBattleExecutions:0,worldCompilations:0,publications:0},
 mapObligations,completeAI,completeBattlePrograms:input.programs,counterSites:sites,sourceAbilities:[...abilities.values()],observations,
 noWalkingAdmissionGranted:true,sourceCampaignComplete:false,nativeDynamicParity:false,browserVerified:false};
const bytes=JSON.stringify(payload)+'\n',file=resolve(out,'full-source.json');await writeFile(file,bytes);
const summary={kind:payload.kind,result:payload.result,runtimeSha256:runtime,beforeRuntimeSha256:beforeRuntime,counts:payload.counts,
 artifact:{file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)},
 observations:observations.map(o=>({label:o.label,requested:o.requested,sourceDescriptors:o.sourceDescriptors,compiledDefinitions:Object.keys(o.after.encounters).length,
  beforeDiagnostics:o.before.diagnostics.length,afterDiagnostics:o.after.diagnostics.length,removed:o.removed.length,added:o.added.length})),
 noWalkingAdmissionGranted:true,sourceCampaignComplete:false,nativeDynamicParity:false,browserVerified:false};
await writeFile(resolve(out,'report.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
