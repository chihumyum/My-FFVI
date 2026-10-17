import test from 'node:test';import assert from 'node:assert/strict';
import { WEB_BATTLE_BRANCH_EXECUTION as policy,classifyDeferredBattleInstruction } from '../src/core/battle-branch-execution.js';
import { compileBattleEvent } from '../src/compiler/battle-event.js';
import { parseBattleLifecycle } from '../src/core/battle-lifecycle.js';
import { assertBattleEventExecutable,createBattleEventState,advanceBattleEvent,parseBattleEventProgram,BattleEventError } from '../src/core/battle-event.js';
import { BattleGame } from '../src/core/battle.js';
import { fixture } from './fixtures/battle-content.js';
import { compileBattleEncounterRuntime } from '../src/compiler/battle-encounter-runtime.js';
import { encounterRuntimeFixture } from './fixtures/battle-encounter-runtime.js';
import { branchRaw as raw,branchProgram,branchSourceData,branchInputs,unknownBranchRaw as unknown } from './fixtures/battle-branch-execution.js';
const context=(clock=0)=>({clock,timeSeconds:clock/100,started:true,aiCoreAlive:false,actionStaging:false});
test('strict/v1 still reject all blocked operations; explicit source v2 can finish a branch without touching its preserved unknown PC',()=>{
 const ops=[raw('Jump',[1]),unknown(),raw('Exit')],p=branchProgram(ops),before=structuredClone(p);
 assert.equal(p.kind,'battle-event-v2');assert.deepEqual(p.branchExecution!.sourceProgram,branchSourceData(ops));assert.deepEqual(p.branchExecution!.deferred.map(d=>d.pc),[1]);
 assert.throws(()=>assertBattleEventExecutable(p),/Mnemonics\/1/);assert.throws(()=>createBattleEventState(p),/Mnemonics\/1/);
 const state=createBattleEventState(p,policy),step=advanceBattleEvent(p,state,context(),policy);assert.equal(step.state.status,'exited');assert.deepEqual(step.visited,[0,2]);assert.deepEqual(p,before);
 assert.throws(()=>advanceBattleEvent(p,state,context()),/Mnemonics\/1/);
 const f=branchInputs(),legacy=compileBattleEvent(branchSourceData(ops),f.source);assert.equal(legacy.kind,'battle-event-v1');assert.throws(()=>createBattleEventState(legacy,policy),/Mnemonics\/1/);
 assert.throws(()=>parseBattleLifecycle({kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:p}),/Legacy/);
 const content=fixture(),gameProgram=branchProgram([raw('BattleEndEnabled',[0]),raw('Jump',[2]),unknown(),raw('Exit')]);content.lifecycle={kind:'battle-lifecycle-v2',mode:'script',scriptId:1,program:gameProgram,branchExecution:policy};
 assert.throws(()=>new BattleGame(content,99),/explicit Web runtime host/);const game=new BattleGame(content,99,undefined,undefined,undefined,undefined,undefined,undefined,{branchExecution:policy});
 assert.equal(game.eventExecution.state!.pc,0);assert.deepEqual(game.eventBranchExecution!.committedVisited,[]);assert.doesNotThrow(()=>game.advance(10));assert.equal(game.eventExecution.state!.status,'exited');assert.deepEqual(game.eventBranchExecution!.unvisitedDependencies.map(d=>d.pc),[2]);
});
test('later actual unknown throws exact raw/source/PC/reason with attempted visits and leaves the input continuation unchanged for retry',()=>{
 const p=branchProgram([raw('Wait',[],[.01]),unknown(),raw('Exit')]),state=createBattleEventState(p,policy),first=advanceBattleEvent(p,state,context(),policy),before=structuredClone(first.state);
 for(let n=0;n<2;n++)assert.throws(()=>advanceBattleEvent(p,first.state,context(1),policy),(e:unknown)=>{
  assert(e instanceof BattleEventError);assert.equal(e.pc,1);assert.equal(e.reason,p.instructions[1]!.op.kind==='blocked'?p.instructions[1]!.op.reason:'unexpected');assert.deepEqual(e.rawInstruction,p.branchExecution!.sourceProgram.Mnemonics[1]);assert.deepEqual(e.source,p.source);assert.deepEqual(e.attemptedVisited,[0,1]);return true;
 });assert.deepEqual(first.state,before);
});
test('opaque selector classification depends on complete raw semantics, never generic versus specific diagnostic wording; Gau gates still fail on actual entry',()=>{
 const gates={
  '敵パーティをガウに':'Gau enemy replacement requires source flag-selected party, native asset-load/condition/AI/entity lifecycle and exact source party dependencies',
  'バトル加入：ガウ':'Gau battle join requires the complete owned enable/equipment/level/recovery/Corps borrow and publication',
  'メンバー加入：ガウ':'Gau member join requires the complete source JoinCharacter owned enable/equipment/level/recovery/Corps lifecycle',
  'ガウ登場アニメ':'Gau appearance requires native enemy-instance animation/movement and completion callbacks',
 };
 for(const [selector,specific]of Object.entries(gates))for(const reason of ['An independently reworded opaque semantic diagnostic',specific]){
  const op=raw('SysCall',[],[],[selector]),p=branchProgram([raw('Jump',[1]),op,raw('Exit')]);
  assert.equal(classifyDeferredBattleInstruction(op),'unimplemented-selector');assert.equal(p.instructions[1]!.op.kind,'blocked');
  (p.instructions[1]!.op as {reason:string}).reason=reason;p.branchExecution!.deferred[0]!.reason=reason;
  const state=createBattleEventState(p,policy),skipped=advanceBattleEvent(p,state,context(),policy);assert.equal(skipped.state.status,'exited');assert.deepEqual(skipped.visited,[0,2]);
  state.pc=1;assert.throws(()=>advanceBattleEvent(p,state,context(),policy),(e:unknown)=>{assert(e instanceof BattleEventError);assert.equal(e.pc,1);assert.equal(e.reason,reason);assert.deepEqual(e.rawInstruction,op);return true;});
 }
 for(const op of [raw('SysCall',[1],[],['とびこむで離脱']),raw('SysCall',[],[],['とびこむで離脱','extra']),raw('SysCall',[],[],['ガウバトルモード設定']),raw('GetEnemyMode',[0]),raw('Msg',[],[],['missing'])])assert.equal(classifyDeferredBattleInstruction(op),null);
});
test('v2 cannot bypass complete Main/source identity, local/target validation, source flags or dependency declarations even on unvisited paths',()=>{
 const base=branchProgram([raw('Jump',[2]),raw('Calc',[1,1],[],['ScriptLocalVariable','＋','imm']),unknown(),raw('Exit')]);
 const changes=[(p:typeof base)=>{p.entry=1;},(p:typeof base)=>{p.branchExecution!.sourceProgram.Segments[0]!.EntryPoint=1;},
  (p:typeof base)=>{p.branchExecution!.sourceProgram.SystemFlag.SkipInitialize=1;},(p:typeof base)=>{p.branchExecution!.sourceProgram.Animations=[{}];},
  (p:typeof base)=>{p.branchExecution!.sourceProgram.ScriptLocalValue=[1,0];},(p:typeof base)=>{p.source!.objectId='9223372036854775808';},
  (p:typeof base)=>{p.branchExecution!.sourceProgram.Mnemonics[0]!.operands.iValues[0]=3;},
  (p:typeof base)=>{p.branchExecution!.sourceProgram.Mnemonics[1]!.operands.iValues[0]=99;},
  (p:typeof base)=>{p.branchExecution!.deferred=[];},(p:typeof base)=>{p.branchExecution!.deferred.push({...p.branchExecution!.deferred[0]!});},
  (p:typeof base)=>{p.instructions[2]!.op={kind:'nop'};p.branchExecution!.deferred=[];}];
 for(const mutate of changes){const p=structuredClone(base);mutate(p);assert.throws(()=>createBattleEventState(p,policy));}
 assert.deepEqual(parseBattleEventProgram(base),base);
 for(const missing of [raw('PlayBattleEffect',[1,1000,99,1]),raw('Msg',[],[],['missing']),raw('BattleAddFellow',[-1]),raw('Jump',[999])]){
  const f=branchInputs(),ops=[raw('Jump',[1]),missing,raw('Exit')],p=compileBattleEvent(branchSourceData(ops),f.source,undefined,undefined,policy);
  assert.equal(p.branchExecution!.deferred.length,0);assert.throws(()=>createBattleEventState(p,policy));
 }
});
test('directory v2 materialization retains exact runtime dependency diagnostics and still hard-blocks newly visible dynamic/player or media dependencies',()=>{
 const f=encounterRuntimeFixture(),source=branchInputs().source,ops=[raw('Jump',[1]),unknown(),raw('Exit')],entry=f.input.encounters[0]!;
 entry.metadata.scriptId=1;entry.script={source,data:branchSourceData(ops)};
 const strict=compileBattleEncounterRuntime(f.reader(),f.input);assert(!strict.encounters[entry.partyId]);assert(strict.diagnostics.some(d=>d.code==='battle-script'&&d.kind==='blocked'));
 const permissive=compileBattleEncounterRuntime(f.reader(),{...f.input,branchExecution:policy});assert(permissive.encounters[entry.partyId]);
 const dependency=permissive.diagnostics.find(d=>d.partyId===entry.partyId&&d.code==='battle-script'&&d.kind==='runtime-dependency')!;assert.equal(dependency.pc,1);assert.deepEqual(dependency.battleEventDependency!.raw,ops[1]);assert.deepEqual(dependency.battleEventDependency!.source,source);
 entry.script.data=branchSourceData([raw('Jump',[2]),unknown(),raw('BattleAddFellow',[1000]),raw('Exit')]);
 const dynamic=compileBattleEncounterRuntime(f.reader(),{...f.input,branchExecution:policy});assert(!dynamic.encounters[entry.partyId]);assert(dynamic.diagnostics.some(d=>d.partyId===entry.partyId&&d.kind==='blocked'&&d.code==='owned-player-borrow-policy'));assert(dynamic.diagnostics.some(d=>d.kind==='runtime-dependency'&&d.code==='battle-script'));
 entry.background='missing';const media=compileBattleEncounterRuntime(f.reader(),{...f.input,branchExecution:policy});assert(!media.encounters[entry.partyId]);assert(media.diagnostics.some(d=>d.partyId===entry.partyId&&d.kind==='blocked'&&/sprite/.test(d.reason)));
});
