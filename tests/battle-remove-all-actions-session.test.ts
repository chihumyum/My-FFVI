import test from 'node:test';
import assert from 'node:assert/strict';
import {GameSession} from '../src/core/game-session.js';
import {GameFlow} from '../src/core/game-flow.js';
import {GameCommands} from '../src/core/game-commands.js';
import {GameBattleHandoff} from '../src/core/game-battle-handoff.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {WEB_SCRIPTED_BATTLE_ACTIONS} from '../src/core/scripted-battle-action.js';
import {WEB_BATTLE_EVENT_CONTROLS} from '../src/core/battle-controls.js';
import {compileScriptedBattleAction} from '../src/compiler/battle-scripted-action.js';
import type {BattleGame,BattleAction} from '../src/core/battle.js';
import type {BattleEventOp} from '../src/core/battle-event.js';
import {checkpointFixture} from './fixtures/checkpoint-game.js';
const ready={visible:true,mediaReady:true,overlayOpen:false};
const runtime={battleHandoff:'prepared' as const,scriptedBattleActions:WEB_SCRIPTED_BATTLE_ACTIONS,battleEventControls:WEB_BATTLE_EVENT_CONTROLS};
function fixture(){
 const f=checkpointFixture();f.battle.common.sprites.synthetic={file:'synthetic.png',width:16,height:16};
 f.battle.common.battleEvents={conditions:f.battle.common.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
 const action=(asynchronous:boolean)=>compileScriptedBattleAction({type:1,mnemonic:'BattleAction',operands:{iValues:[1,1000,10,2,0,asynchronous?1:0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
 const ops:BattleEventOp[]=[action(true),{kind:'wait',seconds:.05},{kind:'remove-all-actions'},{kind:'wait',seconds:.03},action(false),{kind:'calc',index:0,operator:'＋',right:{kind:'immediate',value:1}},{kind:'exit'}];
 f.battle.encounters[1000]!.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:{kind:'battle-event-v1',source:null,entry:0,end:ops.length,localNames:['after'],initialLocals:[0],instructions:ops.map(op=>({mnemonic:op.kind,op})),blockers:[]}};
 const game=new GameSession(f.field,f.battle,314,runtime),flow=new GameFlow(game);flow.start();flow.advance(0,ready);
 const owner=game.state,before=owner.snapshot();assert(game.field.startEvent('fight'));const request=game.field.stop;
 return {...f,game,flow,owner,before,request,commands:new GameCommands(flow,game)};
}
const host={prepareStart:async()=>({kind:'start'}),prepareReturn:async()=>({kind:'return'}),discard(_v:{kind:string}){}};
const late=(battle:BattleGame,action:BattleAction)=>Reflect.get(battle,'resolve').call(battle,action);
function cancelFirst(f:ReturnType<typeof fixture>){
 const b=f.game.battle!,hp=b.enemies.map(e=>e.hp);f.flow.advance(10,ready);const held=b.action!;assert(held);assert.equal(held.resolved,false);
 while(!b.actionExecutor.cancellations.length)f.flow.advance(10,ready);
 assert.equal(b.action,null);assert.equal(b.pendingActions.length,0);assert.equal(b.actionExecutor.fixedPlayerActions.length,0);assert.deepEqual(b.enemies.map(e=>e.hp),hp);
 const before={units:structuredClone(b.combatants),executor:b.actionExecutor,events:structuredClone(b.events)};late(b,held);assert.deepEqual({units:structuredClone(b.combatants),executor:b.actionExecutor,events:structuredClone(b.events)},before);
 return {b,held};
}
function win(f:ReturnType<typeof fixture>){
 const {b,held}=cancelFirst(f);for(let i=0;i<300&&b.phase==='active';i++)f.flow.advance(10,ready);
 assert.equal(b.phase,'victory');assert.equal(b.actionExecutor.cancellations.length,1);assert.equal(b.eventExecution.state?.locals[0],1);assert(b.enemies.every(e=>e.hp===0));return {b,held};
}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}

test('actual Session entry failure and obsolete media completion retain the sole lease; cancelled action cannot affect later return',async()=>{
 const f=fixture();let fail=true;const handoff=new GameBattleHandoff(f.flow,{...host,prepareStart:async()=>{if(fail){fail=false;throw Error('entry media failure');}return {kind:'start'};}});
 assert.equal((await handoff.start()).status,'failed');assert.equal(f.game.battle,null);assert.equal(f.game.field.stop,f.request);assert.deepEqual(f.owner.snapshot(),f.before);
 const held=deferred<{kind:string}>(),discarded:{kind:string}[]=[],obsolete=new GameBattleHandoff(f.flow,{...host,prepareStart:()=>held.promise,discard:value=>discarded.push(value)}),pending=obsolete.start();obsolete.cancel();
 assert.equal((await handoff.start()).status,'committed');const result=win(f);held.resolve({kind:'obsolete'});assert.equal((await pending).status,'cancelled');assert.equal(discarded.length,1);assert.equal(f.game.battle,result.b);
 assert.equal((await handoff.return()).status,'committed');f.flow.advance(10,ready);const settled=f.game.checkpoint();late(result.b,result.held);assert.deepEqual(f.game.checkpoint(),settled);
 assert.equal(f.owner.snapshot().completedBattles.length,1);assert.equal(f.commands.command(result.b,'a',10,'e1',100),false);await assert.rejects(()=>handoff.return(),/pending encounter|requires/);
});
test('actual return retries and Storage restore preserve one reward; cancelled completion cannot reach a restored/new battle owner',async()=>{
 const f=fixture();let fail=true;const handoff=new GameBattleHandoff(f.flow,{...host,prepareReturn:async()=>{if(fail){fail=false;throw Error('return media failure');}return {kind:'return'};}});
 await handoff.start();const result=win(f),before=f.owner.snapshot();assert.equal((await handoff.return()).status,'failed');assert.equal(f.game.battle,result.b);assert.deepEqual(f.owner.snapshot(),before);
 assert.equal((await handoff.return()).status,'committed');f.flow.advance(10,ready);const settled=f.game.checkpoint(),bytes=new Map<string,string>();let quota=true;
 const storage=new CheckpointStorage({getItem:key=>bytes.get(key)??null,setItem:(key,value)=>{if(quota)throw Error('quota');bytes.set(key,value);}},'framework','remove-all-actions');
 await assert.rejects(storage.save(settled,1),/quota/);assert.equal(bytes.size,0);assert.deepEqual(f.game.checkpoint(),settled);quota=false;await storage.save(settled,2);
 const save=(await storage.load())!,restored=GameSession.restore(save.checkpoint,f.field,f.battle,undefined,runtime),flow=new GameFlow(restored);flow.start();flow.advance(0,ready);assert.deepEqual(restored.checkpoint(),settled);
 assert(restored.field.startEvent('fight'));const next=new GameBattleHandoff(flow,host);assert.equal((await next.start()).status,'committed');const current=restored.battle!,currentBefore={units:structuredClone(current.combatants),executor:current.actionExecutor,state:restored.state.snapshot()};
 late(result.b,result.held);assert.deepEqual({units:structuredClone(current.combatants),executor:current.actionExecutor,state:restored.state.snapshot()},currentBefore);assert.equal(f.commands.command(result.b,'a',10,'e1',100),false);
 for(let i=0;i<300&&current.phase==='active';i++)flow.advance(10,ready);assert.equal(current.phase,'victory');assert.equal(current.actionExecutor.cancellations.length,1);assert.equal((await next.return()).status,'committed');flow.advance(10,ready);assert.equal(restored.state.snapshot().completedBattles.length,2);
});
test('actual defeat retry after cancellation restores entry and rejects the retired action against the new single owner',async()=>{
 const f=fixture(),handoff=new GameBattleHandoff(f.flow,host);await handoff.start();const {b:old,held}=cancelFirst(f);
 for(const player of old.players){player.hp=0;player.conditionIds=[305];}f.flow.advance(10,ready);assert.equal(old.phase,'defeat');assert.equal(f.owner.snapshot().completedBattles.length,0);
 assert.equal((await handoff.retry()).status,'committed');assert.notEqual(f.game.battle,old);assert.equal(f.game.state,f.owner);assert.equal(f.game.field.stop,f.request);assert.deepEqual(f.owner.snapshot(),f.before);
 const next=f.game.battle!,before={units:structuredClone(next.combatants),executor:next.actionExecutor};late(old,held);assert.deepEqual({units:structuredClone(next.combatants),executor:next.actionExecutor},before);assert.throws(()=>old.advance(10),/Retired/);
 win(f);assert.equal((await handoff.return()).status,'committed');f.flow.advance(10,ready);assert.equal(f.owner.snapshot().completedBattles.length,1);assert.equal(f.commands.command(old,'a',10,'e1',100),false);
});
