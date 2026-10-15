import test from "node:test";
import assert from "node:assert/strict";
import {BattleGame} from "../src/core/battle.js";
import {WEB_SCRIPTED_BATTLE_ACTIONS,parseScriptedBattleAction,type ScriptedBattleAction} from "../src/core/scripted-battle-action.js";
import {compileScriptedBattleAction} from "../src/compiler/battle-scripted-action.js";
import {compileBattleEvent} from "../src/compiler/battle-event.js";
import {advanceBattleEvent,createBattleEventState,type BattleEventOp,type BattleEventProgram} from "../src/core/battle-event.js";
import {fixture} from "./fixtures/battle-content.js";
import {syntheticAI} from "./fixtures/battle-ai.js";
import {enemyPartyFixture} from "./fixtures/battle-party-game.js";
const action=(actorKind=1,actorId=1000,abilityId=10,targetKind=2,targetId=1,asynchronous=false):ScriptedBattleAction=>
 compileScriptedBattleAction({type:1,mnemonic:"BattleAction",operands:{iValues:[actorKind,actorId,abilityId,targetKind,targetId,Number(asynchronous),0,0],rValues:Array(8).fill(0),sValues:Array(8).fill("")}});
const program=(ops:BattleEventOp[]):BattleEventProgram=>({kind:"battle-event-v1",source:null,entry:0,end:ops.length,
 localNames:["after"],initialLocals:[0],instructions:ops.map(op=>({mnemonic:op.kind,op})),blockers:[]});
function active(ops:BattleEventOp[]){const label=ops.length;return program([...ops,{kind:"nop"},{kind:"blank"},{kind:"jump",target:label}]);}
function content(ops:BattleEventOp[]){const c=fixture();c.battleEvents={conditions:c.conditions.rules.definitions.map(({id,type})=>({id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0}))};
 c.enemies=c.enemies.slice(0,1);c.enemies[0]!.hp=9999;c.lifecycle={kind:"battle-lifecycle-v1",mode:"script",scriptId:1,program:active([{kind:"end-enabled",enabled:false},{kind:"pause",enabled:true},...ops])};return c;}
const game=(c:ReturnType<typeof content>)=>new BattleGame(c,99,undefined,undefined,undefined,undefined,undefined,undefined,{scriptedActions:WEB_SCRIPTED_BATTLE_ACTIONS});
const increment:BattleEventOp={kind:"calc",index:0,operator:"＋",right:{kind:"immediate",value:1}};
function until(b:BattleGame,p:()=>boolean,max=6000){for(let i=0;i<max&&!p();i+=10)b.advance(10);assert(p(),"Missing actual battle lifecycle boundary");}
const snap=(b:BattleGame)=>({time:b.time,units:structuredClone(b.combatants),action:structuredClone(b.action),pending:b.pendingActions,event:b.eventExecution,events:structuredClone(b.events),phase:b.phase});
test("source selectors and untouched operands survive one strict codec; unknown encodings reject",()=>{
 const a=action(2,9,1207,0,3,true);assert.equal(a.actor.side,"enemy");assert.equal(a.target.side,"enemy");assert.equal(a.sourceTargetKind,0);assert(a.asynchronous);
 assert.equal(action(1,33,1382,2,-1).target.id,-1);
 for(const args of [[3,1,10,2,1],[1,-1,10,2,1],[2,10,10,2,1],[1,1,10,3,1],[1,1,10,2,10]])assert.throws(()=>action(...args));
 const raw={type:1,mnemonic:"BattleAction",operands:{iValues:[1,1,10,2,1,0,7,0],rValues:Array(8).fill(0),sValues:Array(8).fill("")}};
 assert.throws(()=>compileScriptedBattleAction(raw));assert.throws(()=>parseScriptedBattleAction({...a,extra:true}));
 assert.throws(()=>parseScriptedBattleAction({...a,sourceTargetKind:1}));
 assert.equal(action(2,9,10,1,33).target.side,"player");
 assert.equal(action(1,33,10,0,33).target.side,"player");
});
test("sync VM continuation sends one action then observes current host staging; async continues without owning an action",()=>{
 const p=active([action(),increment]),ctx={clock:0,timeSeconds:0,started:true,aiCoreAlive:false,actionStaging:false};
 const first=advanceBattleEvent(p,createBattleEventState(p),ctx);assert.equal(first.requests.length,1);assert.equal(first.state.wait?.kind,"script-action");
 const same=advanceBattleEvent(p,first.state,{...ctx,actionStaging:true});assert.equal(same.requests.length,0);
 const pending=advanceBattleEvent(p,same.state,{...ctx,clock:1,timeSeconds:.01,actionStaging:true});assert.equal(pending.state.locals[0],0);assert.equal(pending.requests.length,0);
 const finished=advanceBattleEvent(p,pending.state,{...ctx,clock:2,timeSeconds:.02});assert.equal(finished.state.locals[0],1);
 const ap=active([action(1,1000,10,2,1,true),increment]),one=advanceBattleEvent(ap,createBattleEventState(ap),ctx),
 two=advanceBattleEvent(ap,one.state,ctx);assert.equal(two.state.locals[0],1);assert.equal(two.requests.length,0);
});
test("explicit policy is mandatory; unsupported ability and absent identity fail without guessed targets",()=>{
 const c=content([action(),increment]);assert.throws(()=>new BattleGame(c,1),/policy/);
 const unknown=content([action(1,1000,12),increment]);assert.throws(()=>game(unknown),/Unresolved scripted battle ability/);
 assert.throws(()=>game(content([action(1,1009),increment])),/absent|ambiguous/);
 assert.throws(()=>game(content([action(2,9),increment])),/absent|ambiguous/);
});
test("forced source action uses the real executor/effect/cost pipeline without learning or menu grants",()=>{
 const c=content([action(),increment]);c.players[0]!.abilities=[];c.players[0]!.commands=[];
 const b=game(c),enemy=b.enemies[0]!,before=enemy.hp;assert.equal(b.pendingActions.length,1);assert.equal(b.action,null);
 assert.equal(b.command("a",10,"e1"),false);b.advance(10);assert.equal(snap(b).action?.kind,"event");assert.equal(enemy.hp,before);
 b.advance(390);assert.equal(enemy.hp,before);b.advance(10);assert(enemy.hp<before);assert(snap(b).action?.results.length);
 assert.equal(b.eventExecution.state!.locals[0],0);until(b,()=>b.eventExecution.state!.locals[0]===1);
 assert.equal(b.action,null);assert.equal(b.pendingActions.length,0);assert.deepEqual(b.players[0]!.abilities,[]);
 const hp=enemy.hp;b.advance(100);assert.equal(enemy.hp,hp);assert.equal(b.eventExecution.state!.locals[0],1);
});
test("existing MP owner pays once at effect commit; pause freezes the same owner",()=>{
 const b=game(content([action(1,1000,11,1,1001),increment]));b.players[1]!.hp=10;
 const before=b.players[0]!.mp;b.advance(10);b.setClockInput({paused:true,helpPaused:false,progressEnabled:true,uiWaiting:false,forceWaiting:false});const frozen=snap(b);b.advance(1000);assert.deepEqual(snap(b),frozen);
 b.setClockInput({paused:false,helpPaused:false,progressEnabled:true,uiWaiting:false,forceWaiting:false});b.advance(400);assert.equal(b.players[0]!.mp,before-2);assert(b.players[1]!.hp>10);
 const healed=b.players[1]!.hp;until(b,()=>b.eventExecution.state!.locals[0]===1);b.advance(1000);assert.equal(b.players[0]!.mp,before-2);assert.equal(b.players[1]!.hp,healed);
});
test("effect failure rolls back time, RNG, queues, VM, fees and HP; retry commits once",()=>{
 const c=content([action(1,1000,11,1,1001),increment]),b=game(c);b.players[1]!.hp=10;b.advance(400);
 const before=snap(b),magic=c.abilities[11]!.plan!.magic;c.abilities[11]!.plan!.magic=null;
 assert.throws(()=>b.advance(10));assert.deepEqual(snap(b),before);
 c.abilities[11]!.plan!.magic=magic;b.advance(10);assert.equal(b.players[0]!.mp,before.units[0]!.mp-2);
 until(b,()=>b.eventExecution.state!.locals[0]===1);assert.equal(b.players[0]!.mp,before.units[0]!.mp-2);
});
test("source action waits through real counter reactions rather than just its own presentation",()=>{
 const c=content([{kind:"exec-ai"},action(),increment]);c.enemies[0]!.ai=syntheticAI([["Nop"],["SyncAI"],["StartTable",[0]],["Act",[13]],["CounterAct",[13]],["EndTable"],["JumpBattleAI",[0]]]);
 const b=game(c);until(b,()=>b.action?.kind==="counter");assert.equal(b.eventExecution.state!.locals[0],0);
 until(b,()=>b.eventExecution.state!.locals[0]===1);assert.equal(b.action,null);assert.equal(b.pendingActions.filter(a=>a.kind==="counter").length,0);
});
test("a retired source target cannot rebound to the new instance occupying that same source slot",()=>{
 const c=enemyPartyFixture([{kind:"pause",enabled:true},action(1,1000,10,2,2,true),{kind:"change-enemy-party",partyId:513,hidden:false}]);
 c.participants!.enemyParties![513]!.members[0]!.uniqueId=2;
 const b=game(c as ReturnType<typeof content>);const old=b.enemies[0]!.id;
 until(b,()=>b.enemyPartyExecution.partyId===513);assert(!b.enemies.some(e=>e.id===old));const fresh=b.enemies.map(e=>({id:e.id,hp:e.hp}));
 b.advance(1500);assert.deepEqual(b.enemies.map(e=>({id:e.id,hp:e.hp})),fresh);
 assert(!b.action?.targetIds.includes(old));assert(!b.pendingActions.some(a=>a.targetIds.includes(old)));
});
