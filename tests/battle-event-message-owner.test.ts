import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { SourceMessageState } from "../src/core/source-message.js";
import { createWebFieldMessageSequencePort } from "../src/core/source-message-sequence.js";
import { WEB_BATTLE_EVENT_MESSAGE_POLICY } from "../src/core/battle-event-message.js";
import { battleMessageContent, battleMessageProgram, messageRaw } from "./fixtures/battle-event-message.js";
function controlledMask() { let mask=3; return (effects: readonly import("../src/core/source-message.js").SourceMessageEffect[]) => {
 const before=mask,next=effects[0]!.group===8?9:3; const validate=()=>{assert.equal(mask,before);};return {validate,commit(){validate();mask=next;}};
}; }
function make(sequence = createWebFieldMessageSequencePort()) {
 const owner = new SourceMessageState(), content = battleMessageContent();
 return { owner, battle: new BattleGame(content, 53, undefined, undefined, undefined, undefined, undefined, undefined,
   { messages: { policy: WEB_BATTLE_EVENT_MESSAGE_POLICY, owner, sequence, prepareEffects:controlledMask() } }) };
}
function until(battle: BattleGame, predicate: () => boolean) { for(let n=0;n<1000&&!predicate();n++)battle.advance(10);assert.equal(predicate(),true); }
test("battle VM publishes only on admitted ticks to the actual field message owner, with real page input and no implicit pause",()=>{
 const {owner,battle}=make();assert.equal(owner.active,false);assert.equal(battle.sourceMessage,owner);assert.deepEqual(battle.ready,[]);assert.equal(battle.command("a",10,"e1"),false);
 battle.advance(10);assert.equal(owner.active,true);assert.equal(battle.messageInputPending,true);assert.equal(battle.eventExecution.state!.pc,0);
 const ticket=owner.projection!.windowTicket;assert.equal(battle.messagePresentation?.sourceWindow,1);
 until(battle,()=>!!owner.projection?.acceptsInput);const time=battle.time;assert.equal(battle.confirmMessage(),true);
 battle.advance(100);assert.ok(battle.time>time);assert.equal(owner.projection!.windowTicket,ticket);
 until(battle,()=>!!owner.projection?.acceptsInput);assert.equal(battle.confirmMessage(),true);
 for(let n=0;n<1000&&battle.messageInputPending;n++){if(owner.projection?.acceptsInput)battle.confirmMessage();battle.advance(10);}
 assert.equal(battle.messageInputPending,false);assert.equal(owner.active,false);assert.equal(battle.eventExecution.controls.aiStarted,true);
});
test("missing or unknown battle message host is rejected rather than a log or fallback window",()=>{
 assert.throws(()=>new BattleGame(battleMessageContent(),1),/shared source-message host/);
 assert.throws(()=>new BattleGame(battleMessageContent(),1,undefined,undefined,undefined,undefined,undefined,undefined,
  {policy:WEB_BATTLE_EVENT_MESSAGE_POLICY} as any),/Unknown battle event host options/);
 const {owner,battle}=make();assert.equal(owner.active,false);assert.equal(battle.events.some(e=>JSON.stringify(e).includes("First page")),false);
});
test("late message provider failure and reentrant global input leave the entire battle frame and old window unchanged",()=>{
 let fail=true;const ordinary=createWebFieldMessageSequencePort();
 const {owner,battle}=make({prepare(){const p=ordinary.prepare();return {...p,validate(){p.validate();if(fail)throw new Error("controlled unavailable context");}};}});
 const before={time:battle.time,event:battle.eventExecution,units:structuredClone(battle.combatants),message:owner.snapshot(),revision:owner.mutationRevision};
 assert.throws(()=>battle.advance(10),/controlled unavailable context/);assert.deepEqual({time:battle.time,event:battle.eventExecution,units:battle.combatants,message:owner.snapshot(),revision:owner.mutationRevision},before);
 fail=false;battle.advance(0);assert.equal(owner.active,true,"failed 10ms remains one retryable logical step");
 let shared:SourceMessageState;const bad=make({prepare(){shared.confirm();return ordinary.prepare();}});shared=bad.owner;
 assert.throws(()=>bad.battle.advance(10),/reserved/);assert.equal(shared.active,false);assert.equal(bad.battle.time,0);
});
test("BattlePause leaves common message update/input live; asynchronous windows retire without old tickets controlling a new battle",()=>{
 const p=battleMessageProgram([messageRaw("BattlePause"),messageRaw("Msg",-1,"ASYNC",2),messageRaw("Wait",1),messageRaw("Exit")]);
 // BattlePause's actual operands are separately covered by the compiler; this
 // authored program tests the shared runtime gate directly.
 p.instructions[0]!.op={kind:"pause",enabled:true};
 const owner=new SourceMessageState(),battle=new BattleGame(battleMessageContent(p),1,undefined,undefined,undefined,undefined,undefined,undefined,
 {messages:{policy:WEB_BATTLE_EVENT_MESSAGE_POLICY,owner,sequence:createWebFieldMessageSequencePort(),prepareEffects:controlledMask()}});
 battle.advance(10);assert.equal(battle.messageInputPending,false);const ticket=owner.projection!.windowTicket;
 const before=battle.enemies.map(c=>c.atb);battle.advance(100);assert.deepEqual(battle.enemies.map(c=>c.atb),before);assert.notEqual(owner.projection!.phase,"play");
 const stale=owner.prepare({kind:"source-message",command:{kind:"close"}}),retire=battle.prepareMessageRetirement();retire.commit();assert.equal(owner.active,false);
 const next=make(); // independent test owner does not establish ownership below.
 assert.ok(next.battle);const newer=owner.prepare({kind:"source-message",command:(p.instructions[1]!.op as any).command},createWebFieldMessageSequencePort().prepare().context);newer.commit();
 assert.ok(owner.projection!.windowTicket!>ticket!);assert.throws(stale.commit,/Stale/);assert.throws(()=>battle.confirmMessage(),/Retired/);assert.throws(()=>battle.advance(10),/Retired/);
});

test("a message context observer cannot publish a resource mutation as part of opening a window",()=>{
 let live:BattleGame;const ordinary=createWebFieldMessageSequencePort(),f=make({prepare(){live.players[0]!.hp--;return ordinary.prepare();}});live=f.battle;
 const before={units:structuredClone(live.combatants),time:live.time,event:live.eventExecution,message:f.owner.snapshot()};
 assert.throws(()=>live.advance(10),/observer mutated/);assert.deepEqual({units:live.combatants,time:live.time,event:live.eventExecution,message:f.owner.snapshot()},before);
});
