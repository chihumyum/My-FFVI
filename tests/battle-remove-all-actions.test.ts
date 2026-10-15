import test from 'node:test';
import assert from 'node:assert/strict';
import {BattleGame,type BattleAction} from '../src/core/battle.js';
import {WEB_BATTLE_EVENT_CONTROLS} from '../src/core/battle-controls.js';
import {WEB_SCRIPTED_BATTLE_ACTIONS,type ScriptedBattleAction} from '../src/core/scripted-battle-action.js';
import {compileScriptedBattleAction} from '../src/compiler/battle-scripted-action.js';
import {advanceBattleEvent,createBattleEventState,type BattleEventOp,type BattleEventProgram} from '../src/core/battle-event.js';
import {WEB_BATTLE_BRANCH_EXECUTION,classifyDeferredBattleInstruction} from '../src/core/battle-branch-execution.js';
import {branchRaw,branchProgram} from './fixtures/battle-branch-execution.js';
import {fixture} from './fixtures/battle-content.js';
import {itemFixture} from './fixtures/items.js';
import {syntheticAI} from './fixtures/battle-ai.js';
import {battleMessageContent,battleMessageProgram,messageRaw} from './fixtures/battle-event-message.js';
import {SourceMessageState} from '../src/core/source-message.js';
import {createWebFieldMessageSequencePort} from '../src/core/source-message-sequence.js';
import {WEB_BATTLE_EVENT_MESSAGE_POLICY} from '../src/core/battle-event-message.js';
import {WEB_BATTLE_EVENT_EFFECTS,createWebBattleEventEffectHost} from '../src/core/battle-event-effect.js';
import {authoredBattleEffect} from './fixtures/battle-event-effect.js';

const hosts={controls:WEB_BATTLE_EVENT_CONTROLS,scriptedActions:WEB_SCRIPTED_BATTLE_ACTIONS};
const action=(abilityId=11,targetKind=1,targetId=1001):ScriptedBattleAction=>compileScriptedBattleAction({type:1,mnemonic:'BattleAction',
  operands:{iValues:[1,1000,abilityId,targetKind,targetId,1,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
function program(ops:BattleEventOp[]):BattleEventProgram{
  const label=ops.length;return {kind:'battle-event-v1',source:null,entry:0,end:label+3,localNames:['after','enemyMode'],initialLocals:[0,0],blockers:[],
    instructions:[...ops,{kind:'nop'} as const,{kind:'blank'} as const,{kind:'jump',target:label} as const].map(op=>({mnemonic:op.kind,op}))};
}
function content(wait=.2,ops:BattleEventOp[]=[]){
  const c=fixture();c.enemies=c.enemies.slice(0,1);c.enemies[0]!.hp=9999;
  c.battleEvents={conditions:c.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:program([{kind:'end-enabled',enabled:false},{kind:'pause',enabled:true},...ops,
    {kind:'wait',seconds:wait},{kind:'remove-all-actions'},{kind:'sync-action'},{kind:'calc',index:0,operator:'＋',right:{kind:'immediate',value:1}}])};return c;
}
const snapshot=(b:BattleGame)=>({time:b.time,units:structuredClone(b.combatants),action:structuredClone(b.action),pending:b.pendingActions,
  executor:b.actionExecutor,event:b.eventExecution,ui:b.uiControls,inventory:b.inventory,events:structuredClone(b.events),random:Reflect.get(b,'randomState')});
const late=(b:BattleGame,a:BattleAction)=>Reflect.get(b,'resolve').call(b,a);

test('RemoveAllAct is one immediate Next request; malformed known operands stay hard under source branch execution',()=>{
  const raw=branchRaw('SysCall',[],[],['RemoveAllAct']),p=branchProgram([raw,branchRaw('Exit')]);
  assert.equal(p.instructions[0]!.op.kind,'remove-all-actions');assert.equal(classifyDeferredBattleInstruction(raw),null);
  const step=advanceBattleEvent(p,createBattleEventState(p,WEB_BATTLE_BRANCH_EXECUTION),{clock:1,timeSeconds:.01,started:true,aiCoreAlive:false,actionStaging:true},WEB_BATTLE_BRANCH_EXECUTION);
  assert.deepEqual(step.requests,[{kind:'remove-all-actions',pc:0}]);assert.equal(step.state.pc,1);assert.equal(step.state.wait,null);
  for(const key of ['iValues','rValues','sValues']as const){const bad=structuredClone(raw);(bad.operands[key]as(number|string)[])[7]=key==='sValues'?'unexpected':1;
    const blocked=branchProgram([branchRaw('Jump',[1]),bad,branchRaw('Exit')]);assert.equal(blocked.instructions[1]!.op.kind,'blocked');assert.equal(classifyDeferredBattleInstruction(bad),null);
    assert.throws(()=>createBattleEventState(blocked,WEB_BATTLE_BRANCH_EXECUTION));}
  assert.throws(()=>new BattleGame(content(),1),/explicit Web battle event control policy/);
});
test('cancelling pending ordinary turns releases real reservations and fixed references while preserving both ATB values and host pause',()=>{
  const b=new BattleGame(content(),8,undefined,undefined,undefined,undefined,undefined,undefined,hosts);
  for(const unit of b.players)unit.atb=100;
  assert(b.command('a',10,'e1'));assert(b.command('b',10,'e1'));assert.equal(b.pendingActions.length,2);
  assert.equal(b.actionExecutor.fixedPlayerActions.length,2);const hp=b.enemies[0]!.hp,atb=b.combatants.map(unit=>unit.atb),revision=b.uiControls.revision;
  b.setClockInput({paused:true,helpPaused:false,progressEnabled:true,uiWaiting:true,forceWaiting:true});const held=snapshot(b);b.advance(500);assert.deepEqual(snapshot(b),held);
  b.setClockInput({paused:false,helpPaused:false,progressEnabled:true,uiWaiting:false,forceWaiting:false});b.advance(210);
  assert.equal(b.pendingActions.length,0);assert.equal(b.action,null);assert.equal(b.actionExecutor.fixedPlayerActions.length,0);assert.equal(b.actionExecutor.cancellations.length,1);
  assert.equal(b.enemies[0]!.hp,hp);assert.deepEqual(b.combatants.map(unit=>unit.atb),atb);assert(b.players.every(unit=>!unit.queued));assert.equal(b.uiControls.revision,revision+1);
  assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(b.phase,'active');assert.equal(b.reward,null);
});
test('staged cancellation before the effect fence spends no MP and late completion cannot revive it or duplicate a later action',()=>{
  const b=new BattleGame(content(.2,[action()]),8,undefined,undefined,undefined,undefined,undefined,undefined,hosts);b.players[1]!.hp=10;
  b.advance(10);const held=b.action!,mp=b.players[0]!.mp,hp=b.players[1]!.hp,ticket=held.executionTicket;assert(ticket);
  b.advance(200);assert.equal(b.action,null);assert.equal(b.players[0]!.mp,mp);assert.equal(b.players[1]!.hp,hp);assert.equal(b.actionExecutor.cancellations[0]!.stagedCommitted,false);
  const after=snapshot(b);late(b,held);assert.deepEqual(snapshot(b),after);b.advance(1000);assert.equal(b.players[0]!.mp,mp);assert.equal(b.players[1]!.hp,hp);
});
test('cancelling after a committed hit preserves paid MP and effects, clears real interrupts and leaves AI continuation unchanged',()=>{
  const c=content(.5,[{kind:'exec-ai'},{kind:'enemy-no-act',enabled:true},action(10,2,1)]);
  c.enemies[0]!.ai=syntheticAI([['Nop'],['SyncAI'],['StartTable',[0]],['Act',[13]],['CounterAct',[13]],['EndTable'],['JumpBattleAI',[0]]]);
  const b=new BattleGame(c,8,undefined,undefined,undefined,undefined,undefined,undefined,hosts);b.players[1]!.atb=100;assert(b.command('b',10,'e1'));
  b.advance(490);assert(b.action?.resolved);assert(b.pendingActions.some(a=>a.kind==='counter'));const held=b.action,hp=b.enemies[0]!.hp,ai=b.enemyAIState('e1'),atb=b.combatants.map(unit=>unit.atb);
  b.advance(20);assert.equal(b.action,null);assert.equal(b.pendingActions.length,0);assert.equal(b.enemies[0]!.hp,hp);assert.deepEqual(b.enemyAIState('e1'),ai);
  assert.deepEqual(b.combatants.map(unit=>unit.atb),atb);assert.equal(b.actionExecutor.cancellations[0]!.stagedCommitted,true);const after=snapshot(b);late(b,held);assert.deepEqual(snapshot(b),after);
  const heal=new BattleGame(content(.5,[action()]),8,undefined,undefined,undefined,undefined,undefined,undefined,hosts);heal.players[1]!.hp=10;const mp=heal.players[0]!.mp;
  heal.advance(490);assert(heal.action?.resolved);const healing=heal.players[1]!.hp;assert.equal(heal.players[0]!.mp,mp-2);
  heal.advance(1000);assert.equal(heal.players[0]!.mp,mp-2);assert.equal(heal.players[1]!.hp,healing);
});
test('unknown action identity is a reached gate and a later VM failure restores the exact tickets, fixed references, queues and menu revision',()=>{
  const c=content(.05,[action()]),p=c.lifecycle!;assert.equal(p.mode,'script');if(p.mode!=='script')return;
  const cancel=p.program.instructions.findIndex(row=>row.op.kind==='remove-all-actions');p.program.instructions[cancel+1]!.op={kind:'get-enemy-mode',uniqueId:9,expected:0};
  const b=new BattleGame(c,8,undefined,undefined,undefined,undefined,undefined,undefined,hosts);b.advance(40);const before=snapshot(b),owners=[...b.combatants];
  assert.throws(()=>b.advance(10),/unique-slot/);assert.deepEqual(snapshot(b),before);assert(b.combatants.every((unit,i)=>unit===owners[i]));
  const unknown=new BattleGame(content(.05,[action()]),8,undefined,undefined,undefined,undefined,undefined,undefined,hosts);unknown.advance(40);delete unknown.action!.executionTicket;const broken=snapshot(unknown);
  assert.throws(()=>unknown.advance(10),/actual queued\/staged action owner/);assert.deepEqual(snapshot(unknown),broken);
});
test('cancellation composes with real message/effect resource publication; throwing commit rolls all owners back and retry publishes once',()=>{
  const p=battleMessageProgram([messageRaw('Wait',.05),messageRaw('Nop'),messageRaw('Nop'),messageRaw('Msg',-1,'ASYNC'),messageRaw('Wait',.1),messageRaw('Exit')]);
  p.instructions[1]!.op={kind:'remove-all-actions'};p.instructions[2]!.op=authoredBattleEffect(1);
  const c=battleMessageContent(p),owner=new SourceMessageState(),base=createWebBattleEventEffectHost();let fail=true,discards=0;
  const b=new BattleGame(c,8,undefined,undefined,undefined,undefined,undefined,undefined,{...hosts,
    messages:{policy:WEB_BATTLE_EVENT_MESSAGE_POLICY,owner,sequence:createWebFieldMessageSequencePort(),prepareEffects:()=>({validate(){},commit(){}})},
    effects:{policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const r=base.prepare(request);return {...r,commit(){if(fail)throw Error('cancel effect commit failure');r.commit();},discard(){discards++;r.discard();}};}}});
  b.advance(10);assert(b.command('a',10,'e1'));b.advance(50);const before={battle:snapshot(b),message:owner.snapshot(),revision:owner.mutationRevision};
  assert.throws(()=>b.advance(10),/cancel effect commit failure/);assert.deepEqual({battle:snapshot(b),message:owner.snapshot(),revision:owner.mutationRevision},before);assert.equal(discards,1);
  fail=false;b.advance(0);assert.equal(b.actionExecutor.cancellations.length,1);assert.equal(b.action,null);assert.equal(owner.active,true);assert.equal(b.effectPresentation.length,1);
  assert.equal(b.pendingActions.length,0);const copy=b.actionExecutor;copy.cancellations.length=0;assert.equal(b.actionExecutor.cancellations.length,1);
});

test('cancellation releases a real unspent item reservation and preserves a committed item consumption without refund',()=>{
  function itemBattle(wait:number){const c=content(wait);if(c.lifecycle?.mode==='script')c.lifecycle.program.instructions[1]!.op={kind:'pause',enabled:false};c.commands[200]={id:200,kind:'item',name:'Items',abilityIds:[],referencedAbility:null,forbiddenConditionIds:[]};
    c.players.forEach(player=>player.commands.push(200));const b=new BattleGame(c,43,undefined,{definitions:{10:itemFixture()},stacks:[{id:10,count:1}],limit:99},undefined,undefined,undefined,undefined,hosts);
    b.players[0]!.hp=1;return b;}
  const before=itemBattle(.2);assert(before.commandItem('a',10,{kind:'single',id:'a'},200));assert.equal(before.inventory[0]!.available,0);
  before.advance(210);assert.deepEqual(before.inventory[0],{id:10,count:1,available:1});assert.equal(before.players[0]!.hp,1);
  const after=itemBattle(.5);assert(after.commandItem('a',10,{kind:'single',id:'a'},200));after.advance(490);const held=after.action!;assert(held.resolved);assert.equal(after.players[0]!.hp,51);
  after.advance(20);assert.deepEqual(after.inventory[0],{id:10,count:0,available:0});assert.equal(after.players[0]!.hp,51);const committed=snapshot(after);late(after,held);assert.deepEqual(snapshot(after),committed);
});
