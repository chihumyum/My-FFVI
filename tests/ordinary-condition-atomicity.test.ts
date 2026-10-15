import test from 'node:test';import assert from 'node:assert/strict';
import {BattleGame} from '../src/core/battle.js';import {SourceMessageState} from '../src/core/source-message.js';
import {createWebFieldMessageSequencePort} from '../src/core/source-message-sequence.js';
import {WEB_BATTLE_EVENT_MESSAGE_POLICY} from '../src/core/battle-event-message.js';
import {createWebBattleEventEffectHost,WEB_BATTLE_EVENT_EFFECTS} from '../src/core/battle-event-effect.js';
import {WEB_SCRIPTED_BATTLE_ACTIONS} from '../src/core/scripted-battle-action.js';import {compileScriptedBattleAction} from '../src/compiler/battle-scripted-action.js';
import {battleMessageProgram,messageRaw} from './fixtures/battle-event-message.js';import {authoredBattleEffect} from './fixtures/battle-event-effect.js';
import {ordinaryConditionContent} from './fixtures/ordinary-condition-action.js';
import {EventState} from '../src/core/event-state.js';import {battleEventSharedSnapshot} from '../src/core/battle-event-shared.js';
for(const mode of ['Msg','Effect']as const)test(`same-frame status application, ${mode} failure, source message and effect drafts all roll back before one retry`,()=>{
 const p=battleMessageProgram([messageRaw('Nop'),messageRaw('Nop'),messageRaw('Nop'),messageRaw('Nop'),messageRaw('Msg',-1,'ASYNC'),messageRaw('Nop'),messageRaw('Nop'),messageRaw('Nop'),messageRaw('Blank'),messageRaw('Exit')]);
 p.instructions[0]!.op={kind:'end-enabled',enabled:false};p.instructions[1]!.op={kind:'pause',enabled:true};
 p.instructions[2]!.op=compileScriptedBattleAction({type:1,mnemonic:'BattleAction',operands:{iValues:[1,1000,901,2,1,1,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
 p.instructions[3]!.op={kind:'wait',seconds:.405};p.instructions[5]!.op=authoredBattleEffect(1);p.instructions[6]!.op={kind:'variable-calc',left:{category:'ScenarioVariable',index:3},operator:'＋',right:{kind:'immediate',value:1}};p.instructions[7]!.op={kind:'calc',index:0,operator:'＋',right:{kind:'immediate',value:1}};p.instructions[9]!.op={kind:'exit'};
 const {content:c}=ordinaryConditionContent();c.battleEvents={conditions:c.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};c.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:p};
 let fail=true,mask=3,discards=0;const owner=new SourceMessageState(),base=createWebBattleEventEffectHost(),b=new BattleGame(c,314,undefined,undefined,undefined,undefined,battleEventSharedSnapshot(EventState.initialized()),undefined,
 {scriptedActions:WEB_SCRIPTED_BATTLE_ACTIONS,effects:{policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const r=base.prepare(request);return {...r,commit(){if(fail&&mode==='Effect')throw Error('authored joint effect failure');r.commit();},discard(){discards++;r.discard();}};}},
  messages:{policy:WEB_BATTLE_EVENT_MESSAGE_POLICY,owner,sequence:createWebFieldMessageSequencePort(),prepareEffects(effects){const before=mask,next=effects[0]!.group===8?9:3;return{validate(){assert.equal(mask,before);},commit(){assert.equal(mask,before);if(fail&&mode==='Msg')throw Error('authored joint message failure');mask=next;}};}}});
 const snapshot=()=>structuredClone({time:b.time,units:b.combatants,action:b.action,pending:b.pendingActions,event:b.eventExecution,effects:b.effectPresentation,journal:b.effectExecution,message:owner.snapshot(),revision:owner.mutationRevision,mask,shared:b.eventSharedReturn,random:Reflect.get(b,'randomState')});
 b.advance(410);assert.equal(b.action?.elapsed,390);assert.equal(b.action?.resolved,false);assert.equal(owner.active,false);const before=snapshot();assert.throws(()=>b.advance(10),/authored joint/);assert.deepEqual(snapshot(),before);assert.equal(discards,1);
 fail=false;b.advance(0);assert(b.action?.resolved);assert.equal(b.players[0]!.mp,6);assert.deepEqual(b.enemies[0]!.conditionIds,[6]);assert.equal(b.eventSharedReturn!.candidate.global[3],1);assert(owner.active);assert.equal(mask,9);assert.equal(b.eventExecution.state!.locals[0],1);assert.equal(b.effectExecution.filter(e=>e.action==='request').length,1);
 const paid=b.players[0]!.mp,status=structuredClone(b.enemies[0]!.conditionIds);b.advance(10);assert.equal(b.players[0]!.mp,paid);assert.deepEqual(b.enemies[0]!.conditionIds,status);assert.equal(b.eventSharedReturn!.candidate.global[3],1);
});
