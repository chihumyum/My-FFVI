import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleGame, type Combatant } from '../src/core/battle.js';
import { SourceMessageState } from '../src/core/source-message.js';
import { createWebFieldMessageSequencePort } from '../src/core/source-message-sequence.js';
import { WEB_BATTLE_EVENT_MESSAGE_POLICY } from '../src/core/battle-event-message.js';
import { WEB_SCRIPTED_BATTLE_ACTIONS } from '../src/core/scripted-battle-action.js';
import { battleMessageContent, battleMessageProgram, messageRaw } from './fixtures/battle-event-message.js';
function fixture(failEffects=false) {
 const action=messageRaw('BattleAction');action.operands.iValues=[1,1000,11,1,1001,1,0,0];
 const program=battleMessageProgram([messageRaw('BattlePause'),action,messageRaw('Msg',-1,'ASYNC'),
  messageRaw('Msg',0,'AUTHORED'),messageRaw('MsgClose'),messageRaw('Nop'),messageRaw('Exit')]);
 program.instructions[0]!.op={kind:'pause',enabled:true};
 program.instructions[5]!.op={kind:'calc',index:0,operator:'＋',right:{kind:'immediate',value:1}};
 const content=battleMessageContent(program);
 // Authored detached entry resources distinguish current HP from maximum HP.
 const players:Combatant[]=content.players.map(p=>({...structuredClone(p),maxHp:p.hp,maxMp:p.mp,atb:0,queued:false,behavior:null}));
 players[1]!.hp=10;
 const owner=new SourceMessageState();let mask=3,fail=failEffects;
 const battle=new BattleGame(content,91,players,undefined,undefined,undefined,undefined,undefined,{
  scriptedActions:WEB_SCRIPTED_BATTLE_ACTIONS,
  messages:{policy:WEB_BATTLE_EVENT_MESSAGE_POLICY,owner,sequence:createWebFieldMessageSequencePort(),
   prepareEffects(effects){const before=mask,next=effects[0]!.group===8?9:3;
    const validate=()=>{assert.equal(mask,before);if(fail)throw new Error('controlled joint message effects unavailable');};
    return {validate,commit(){validate();mask=next;}};}}
 });
 return {battle,owner,mask:()=>mask,allowEffects:()=>{fail=false;}};
}
const snapshot=(f:ReturnType<typeof fixture>)=>({time:f.battle.time,units:structuredClone(f.battle.combatants),
 action:structuredClone(f.battle.action),pending:f.battle.pendingActions,event:f.battle.eventExecution,
 events:structuredClone(f.battle.events),message:f.owner.snapshot(),revision:f.owner.mutationRevision,mask:f.mask()});
test('one battle event frame composes forced action costs/effects and field message input on the same owners',()=>{
 const f=fixture(),b=f.battle,mp=b.players[0]!.mp,hp=b.players[1]!.hp;let action=false,message=false;
 assert.equal(b.sourceMessage,f.owner);assert.equal(b.pendingActions.length,0);
 for(let tick=0;tick<4000&&b.eventExecution.state!.locals[0]===0;tick++){
  if(f.owner.projection?.acceptsInput)b.confirmMessage();b.advance(10);
  action ||= b.action?.kind==='event';message ||= f.owner.active;
 }
 assert(action);assert(message);assert.equal(b.players[0]!.mp,mp-2);assert(b.players[1]!.hp>hp);
 assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(b.pendingActions.length,0);
 assert.equal(f.owner.active,false);assert.equal(f.mask(),3);
 const after=snapshot(f);b.advance(100);assert.equal(b.players[0]!.mp,after.units[0]!.mp);assert.equal(b.eventExecution.state!.locals[0],1);
});
test('failed joint message publication rolls back the VM, action queue, resources and window together before retry',()=>{
 const f=fixture(true),before=snapshot(f);assert.throws(()=>f.battle.advance(10),/controlled joint message effects unavailable/);
 assert.deepEqual(snapshot(f),before);f.allowEffects();f.battle.advance(0);assert.equal(f.battle.sourceMessage,f.owner);assert(f.owner.active);
 for(let tick=0;tick<4000&&f.battle.eventExecution.state!.locals[0]===0;tick++){
  if(f.owner.projection?.acceptsInput)f.battle.confirmMessage();f.battle.advance(10);
 }
 assert.equal(f.battle.players[0]!.mp,before.units[0]!.mp-2);assert.equal(f.battle.eventExecution.state!.locals[0],1);assert.equal(f.owner.active,false);
});
