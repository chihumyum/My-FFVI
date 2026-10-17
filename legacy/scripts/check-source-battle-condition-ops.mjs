// A complete source audit and original-parameter callers are separate lanes.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
const view=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),o={root:view,compiled:'dist',beforeRoot:null,beforeCompiled:null,report:'build/reports/source-battle-condition-ops.json'},seen=new Set();
const options={'--input-root':'root','--compiled-dir':'compiled','--baseline-script-root':'beforeRoot','--baseline-compiled-dir':'beforeCompiled','--report':'report'};
while(args.length){const key=args.shift();assert(Object.hasOwn(options,key)&&args[0]&&!seen.has(key));seen.add(key);o[options[key]]=args.shift();}
assert(o.beforeRoot&&o.beforeCompiled);const root=resolve(view,o.root),dist=resolve(view,o.compiled),beforeRoot=resolve(view,o.beforeRoot),beforeDist=resolve(view,o.beforeCompiled),out=resolve(view,o.report);
assert(out.startsWith(resolve(view,'build')+'/'));
async function prepare(scriptRoot,compiled){
 const load=n=>import(pathToFileURL(resolve(compiled,'src/'+n+'.js')).href),api=Object.assign({},...await Promise.all(['compiler/content','compiler/battle','compiler/game-catalog','compiler/battle-encounter-runtime','compiler/source-battle-participant-closure'].map(load)));
 const {readSourceBattleDirectoryPolicy}=await import(pathToFileURL(resolve(scriptRoot,'scripts/source-battle-directory.mjs')).href),policyBytes=await readFile(resolve(scriptRoot,'content-batches/source-battle-directory.policy.json'));
 const policy=await readSourceBattleDirectoryPolicy({root,compiledDir:compiled,policy:JSON.parse(policyBytes)}),runtime=await runtimeDigest(scriptRoot,compiled),input=await loadBattleEventMessageSourceInputs(root,compiled,{branchExecution:policy.framework.branchExecution});
 const source=await api.compileSharedBattleSource(root),shared=await api.compileGameCatalogModules(root,source),dep=input.dependencies;
 const closure=api.compileSourceBattleParticipantClosure(input.snapshot.reader,{policy:policy.framework.sourceParticipants,encounters:dep.encounters,sources:input.encounterSources,eventMessages:input.input,branchExecution:policy.framework.branchExecution});
 const value={...shared.runtimeInput,requestedPartyIds:dep.requestedPartyIds,encounters:dep.encounters,sourceDiagnostics:[...dep.diagnostics,...closure.diagnostics],reserveEnemies:closure.reserveEnemies,enemyParties:closure.enemyParties,
  branchExecution:policy.framework.branchExecution,manualControls:policy.framework.manualControls,conditionControlPolicy:policy.framework.conditionControlPolicy,...(policy.framework.spawnConditionPolicy?{spawnConditionPolicy:policy.framework.spawnConditionPolicy}:{}),...(policy.framework.forcedSavePolicy?{forcedSavePolicy:policy.framework.forcedSavePolicy}:{}),
  handoff:{policy:policy.framework.handoff},development:{...(policy.framework.entry?.formations?{formations:policy.framework.entry.formations}:{}),scripts:[],flagGroups:[],participants:closure.participants}};
 return {api,policy,policyBytes,runtime,input,shared,closure,result:api.compileBattleEncounterRuntime(shared.reader,value),scriptRoot,compiled};
}
const before=await prepare(beforeRoot,beforeDist),after=await prepare(view,dist),{api,input}=after;
assert.equal(input.sourceDigest,before.input.sourceDigest);assert.equal(api.canonical(input.dependencies),api.canonical(before.input.dependencies));
const sites=[],bodies=[];
for(const p of input.programs){const old=before.input.programs.find(q=>q.id===p.id);assert(old);assert.equal(p.rawHash,old.rawHash);assert.equal(api.canonical(p.source),api.canonical(old.source));let selected=false;
 for(const[pc,row]of p.compiled.instructions.entries())if(p.data.Mnemonics[pc].mnemonic==='BattleCondition'){
  assert.equal(old.compiled.instructions[pc].op.kind,'blocked');assert.equal(row.op.kind,'condition-list');selected=true;
  const condition=input.snapshot.reader.row('condition.csv',row.op.conditionId);
  sites.push({program:p.id,pc,source:{...p.source,pointer:'/Mnemonics/'+pc},raw:p.data.Mnemonics[pc],before:old.compiled.instructions[pc].op,after:row.op,condition,
   previous:p.data.Mnemonics.slice(Math.max(0,pc-3),pc),next:p.data.Mnemonics.slice(pc+1,pc+4)});
 }else assert.equal(api.canonical(old.compiled.instructions[pc]),api.canonical(row),'Unrelated source op changed');
 if(selected)bodies.push(p);
}
assert.equal(input.scripts.length,3304);assert.equal(input.inventory.counts.allInstructions,186003);assert.equal(input.programs.length,53);assert.equal(input.inventory.counts.instructions,2312);assert.equal(input.dependencies.requestedPartyIds.length,490);assert.equal(input.dependencies.encounters.length,483);assert.equal(input.dependencies.diagnostics.length,7);assert.equal(sites.length,15);assert.equal(bodies.length,9);assert.equal(bodies.reduce((n,p)=>n+p.data.Mnemonics.length,0),533);
const load=n=>import(pathToFileURL(resolve(dist,n+'.js')).href),[{battleMessageProgram,battleMessageSessionFixture,messageRaw},{fixtureRosterLifecycle},{GameSession},{WEB_BATTLE_EVENT_CONDITIONS},{WEB_BATTLE_EVENT_CONTROLS}]=await Promise.all(['tests/fixtures/battle-event-message','tests/fixtures/roster-lifecycle','src/core/game-session','src/core/battle-event-condition','src/core/battle-controls'].map(load));
const attempts=[];
for(const site of sites){
 // Only the instruction and physical source are original. Callers, owners and
 // terminal are explicit controlled data; no source party/story is fabricated.
 const p=battleMessageProgram([structuredClone(site.raw),messageRaw('BattleForceExit'),messageRaw('Exit')]),f=battleMessageSessionFixture(p),op=site.after;
 f.battle.common.conditions=structuredClone(after.shared.runtimeInput.conditions);
 f.battle.common.battleEvents={conditions:input.snapshot.tables['condition.csv'].map(row=>({id:Number(row.id),type:Number(row.condition_type),attackTarget:Number(row.attack_target),gameOverTarget:Number(row.game_over_target)}))};
 if(op.target.side==='player'&&op.target.id>0){const key=Object.keys(f.battle.common.players)[0];f.battle.common.players[key].sourceId=op.target.id;}
 f.battle.gameState.rosterLifecycle=fixtureRosterLifecycle(f.battle.common.players);
 if(op.target.side==='enemy'&&op.target.id>0){const template=f.battle.encounters[1000].enemies[0];f.battle.encounters[1000].enemies=Array.from({length:9},(_,i)=>({...structuredClone(template),id:'controlled-slot-'+(i+1)}));}
 const runtime={...f.runtime,battleEventConditions:WEB_BATTLE_EVENT_CONDITIONS,battleEventControls:WEB_BATTLE_EVENT_CONTROLS},game=new GameSession(f.field,f.battle,314,runtime);
 assert(game.field.startEvent('fight'));game.advance(10);assert(game.prepareBattleStart().commit());const battle=game.battle,beforeUnits=structuredClone(battle.combatants);let execution;
 try{game.advance(10);assert.equal(battle.phase,'forced');assert.equal(battle.conditionExecution.length,1);assert(game.prepareBattleReturn().commit());game.advance(10);
  const cp=game.checkpoint(),restored=GameSession.restore(JSON.parse(JSON.stringify(cp)),f.field,f.battle,undefined,runtime);assert.deepEqual(restored.checkpoint(),cp);
  execution={result:'completed-controlled-original-parameter',journal:battle.conditionExecution,beforeUnits,afterUnits:battle.combatants,actualSessionReturn:true,storageShapeRestored:true};
 }catch(error){assert.equal(battle.time,0);assert.equal(battle.conditionExecution.length,0);assert.deepEqual(battle.combatants,beforeUnits);
  execution={result:'specific-runtime-gate',error:{message:String(error.message),reason:error.reason??null,pc:error.pc??null},beforeUnits,afterUnits:battle.combatants};}
 attempts.push({program:site.program,pc:site.pc,raw:site.raw,source:site.source,typed:site.after,execution,scope:'controlled-caller-and-owners-not-original-source-body-or-entry-party'});
}
const hard=r=>r.diagnostics.filter(d=>d.kind==='blocked'),key=d=>api.canonical(d),oldHard=hard(before.result),newHard=hard(after.result),oldSet=new Set(oldHard.map(key)),newSet=new Set(newHard.map(key)),removed=oldHard.filter(d=>!newSet.has(key(d))),added=newHard.filter(d=>!oldSet.has(key(d)));
assert.equal(removed.length,0,'Unrelated or unaccounted source hard gate removed');
const oldUnknown=before.result.diagnostics.filter(d=>d.kind==='runtime-dependency'&&d.code==='battle-script'),newUnknown=after.result.diagnostics.filter(d=>d.kind==='runtime-dependency'&&d.code==='battle-script'),unknownAfter=new Set(newUnknown.map(key));
const removedUnknown=oldUnknown.filter(d=>!unknownAfter.has(key(d)));
assert(removedUnknown.every(d=>d.battleEventDependency?.raw.mnemonic==='BattleCondition'),'Unrelated unknown-op dependency removed');
const conditionDependencies=after.result.diagnostics.filter(d=>d.code.startsWith('battle-event-condition-'));
for(const d of removedUnknown)assert(conditionDependencies.some(next=>next.partyId===d.partyId&&next.pc===d.pc&&next.code==='battle-event-condition-host'),'Typed source call lost its actual runtime host dependency');
const counts={allPrograms:3304,allInstructions:186003,battlePrograms:53,battleInstructions:2312,requestedParties:490,sourceDescriptors:483,sourceDiagnostics:7,sourceBound:52,sourceUnbound:1,
 conditionSites:15,conditionShapes:new Set(sites.map(s=>api.hash(s.raw.operands))).size,completeConditionBodies:9,completeConditionInstructions:533,beforeDefinitions:before.result.report.compiledDefinitions,afterDefinitions:after.result.report.compiledDefinitions,
 beforeHardParties:before.result.report.blocked,afterHardParties:after.result.report.blocked,removedHard:removed.length,newHard:added.length,removedUnknownOpDependencies:removedUnknown.length,retainedConditionDependencies:conditionDependencies.length,
 originalParameterAttempts:attempts.length,completedOriginalParameterCallers:attempts.filter(a=>a.execution.result==='completed-controlled-original-parameter').length,specificOriginalParameterGates:attempts.filter(a=>a.execution.result==='specific-runtime-gate').length,originalSourceBodiesExecuted:0};
for(const value of[before,after]){assert.equal(await runtimeDigest(value.scriptRoot,value.compiled),value.runtime);assert.equal((await readFile(resolve(value.scriptRoot,'content-batches/source-battle-directory.policy.json'))).toString(),value.policyBytes.toString());}
const current=await input.api.loadCorpus(root);assert.equal(api.hash({assets:current.assets,tables:current.tables,messages:current.messages,manifest:current.manifest}),input.sourceDigest);
const report={kind:'whole-source-battle-condition-op-check-v1',result:'passed-source-audit-and-controlled-parameters-not-source-bodies',runtimeSha256:after.runtime,baselineRuntimeSha256:before.runtime,sourceDigest:input.sourceDigest,counts,sites,attempts,completeConditionBodies:bodies,completeBattlePrograms:input.programs,completeDependencies:input.dependencies,participantClosure:after.closure.report,
 comparison:{before:{report:before.result.report,diagnostics:before.result.diagnostics},after:{report:after.result.report,diagnostics:after.result.diagnostics},removedHard:removed,newHard:added,removedUnknownOpDependencies:removedUnknown,retainedConditionDependencies:conditionDependencies},
 completeConditionMaster:input.snapshot.reader.ordered('condition.csv'),completeConditionGroups:input.snapshot.tables['condition_group.csv'].map(row=>input.snapshot.reader.row('condition_group.csv',row.id)),completeEraseGroups:input.snapshot.tables['erase_condition_group.csv'].map(row=>input.snapshot.reader.row('erase_condition_group.csv',row.id)),
 sourceProgramsExecuted:0,sourceBattlesEntered:0,nativeParity:false,worldCompilations:0,publications:0,sourceCampaignComplete:false};report.contentHash=api.hash(report);await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report)+'\n');console.log(JSON.stringify({result:report.result,counts,report:out,contentHash:report.contentHash}));
