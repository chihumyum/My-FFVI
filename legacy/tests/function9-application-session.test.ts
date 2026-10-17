import test from 'node:test';import assert from 'node:assert/strict';
import {GameSession} from '../src/core/game-session.js';import {GameFlow} from '../src/core/game-flow.js';
import {GameBattleHandoff} from '../src/core/game-battle-handoff.js';import {CheckpointStorage} from '../src/core/saved-game.js';
import {WEB_SCRIPTED_BATTLE_ACTIONS} from '../src/core/scripted-battle-action.js';import {compileScriptedBattleAction} from '../src/compiler/battle-scripted-action.js';
import {checkpointFixture} from './fixtures/checkpoint-game.js';import {deathSource} from './fixtures/function9-application.js';

test('actual Session retains explicit death identity through existing owned return and Storage restore',async()=>{
  const f=checkpointFixture(),source=deathSource(3);source.ability.accuracy_rate='255';
  f.battle.common.abilities[901]=source.compileAbility().abilities[901]!;
  f.battle.common.conditions.rules.definitions.push({id:1505,type:5,overlapped:false,eraseGroupId:9900});
  f.battle.common.conditions.rules.eraseRules.push({id:9900,groupId:9900,conditionId:1505,type:2,eraseConditionId:0});
  f.battle.common.conditions.behaviors.push({id:1505,kind:'unable-fight',untilType:3,name:'DEATH_STATE'});
  const action=(actorSide:number,actor:number,id:number,targetSide:number,target:number)=>compileScriptedBattleAction({type:1,mnemonic:'BattleAction',operands:{iValues:[actorSide,actor,id,targetSide,target,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
  const ops=[{kind:'end-enabled'as const,enabled:false},action(2,1,901,1,1000),action(1,1001,10,2,0),{kind:'end-enabled'as const,enabled:true},{kind:'exit'as const}];
  f.battle.common.battleEvents={conditions:f.battle.common.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
  f.battle.encounters[1000]!.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:{kind:'battle-event-v1',source:null,entry:0,end:ops.length,localNames:[],initialLocals:[],instructions:ops.map(op=>({mnemonic:op.kind,op})),blockers:[]}};
  const runtime={battleHandoff:'prepared'as const,scriptedBattleActions:WEB_SCRIPTED_BATTLE_ACTIONS},ready={visible:true,mediaReady:true,overlayOpen:false},
    session=new GameSession(f.field,f.battle,314,runtime),flow=new GameFlow(session);flow.start();flow.advance(0,ready);
  const owner=session.state,before=owner.snapshot();assert(session.field.startEvent('fight'));
  const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>({kind:'ready'}),prepareReturn:async()=>({kind:'return'}),discard:()=>{}});assert.equal((await handoff.start()).status,'committed');
  const b=session.battle!;for(let i=0;i<1000&&!(b.action?.source.id===901&&b.action.resolved);i++)flow.advance(10,ready);
  assert.equal(b.players[0]!.hp,0);assert(b.players[0]!.conditionIds.includes(1505));assert(!b.players[0]!.conditionIds.includes(305));
  assert.deepEqual(owner.snapshot(),before);assert.throws(()=>session.checkpoint());
  for(let i=0;i<2000&&b.phase==='active';i++)flow.advance(10,ready);assert.equal(b.phase,'victory');
  assert.equal((await handoff.return()).status,'committed');flow.advance(10,ready);assert.equal(session.state,owner);
  const dead=owner.snapshot().roster.find(member=>member.id==='a')!;assert.equal(dead.hp,0);assert.deepEqual(dead.conditionIds,[1505]);
  const stable=session.checkpoint(),data=new Map<string,string>();let quota=true;const storage=new CheckpointStorage({getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(quota)throw Error('quota');data.set(key,value);}},'framework','function9-application');
  await assert.rejects(storage.save(stable,1),/quota/);assert.equal(data.size,0);assert.deepEqual(session.checkpoint(),stable);quota=false;await storage.save(stable,2);
  const saved=(await storage.load())!,restored=GameSession.restore(saved.checkpoint,f.field,f.battle,undefined,runtime),next=new GameFlow(restored);next.start();next.advance(0,ready);
  assert.deepEqual(restored.checkpoint(),stable);const retained=restored.state.snapshot().roster.find(member=>member.id==='a')!;assert.equal(retained.hp,0);assert.deepEqual(retained.conditionIds,[1505]);
});
