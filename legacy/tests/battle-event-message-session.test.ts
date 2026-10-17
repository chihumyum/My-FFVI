import { compileManualMessageInstruction } from "../src/compiler/message.js";
import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { battleMessageSessionFixture, battleMessageProgram, messageRaw } from "./fixtures/battle-event-message.js";
const ready={visible:true,mediaReady:true,overlayOpen:false};
function setup() {const f=battleMessageSessionFixture(),game=new GameSession(f.field,f.battle,314,f.runtime),flow=new GameFlow(game);flow.start();flow.advance(0,ready);game.field.startEvent("fight");game.advance(10);return {...f,game,flow};}
function finish(game:GameSession){let inputs=0;for(let n=0;n<30000&&game.battle?.phase==="active";n++){
 if(game.battle.sourceMessage?.projection?.acceptsInput){assert.equal(game.battle.confirmMessage(),true);inputs++;}
 if(!game.battle.messageInputPending)for(const actor of game.battle.ready){const target=game.battle.targets(actor.id,10)[0];if(target)game.battle.command(actor.id,10,target.id);}
 game.advance(10);
}assert.equal(game.battle?.phase,"victory");return inputs;}
const messageState=(game:GameSession)=>({message:game.field.sourceMessage.snapshot(),revision:game.field.sourceMessage.mutationRevision,time:game.battle?.time,event:game.battle?.eventExecution});
test("real Session/Flow share the original message owner; close resumes the complete battle, reward once, Storage restore and another battle",async()=>{
 const f=setup(),{game,flow}=f,owner=game.field.sourceMessage;
 assert.equal(game.prepareBattleStart()!.commit(),true);assert.equal(game.battle!.sourceMessage,owner);assert.equal(owner.active,false);
 flow.advance(10,ready);assert.equal(owner.active,true);assert.equal(game.field.updateAttributeMask,9);const firstTicket=owner.projection!.windowTicket;assert.equal(game.checkpointReady,false);
 for(let n=0;n<1000&&!owner.projection?.acceptsInput;n++)flow.advance(10,ready);
 const time=game.battle!.time;assert.equal(flow.confirm(),true);flow.advance(10,ready);assert.ok(game.battle!.time>time);
 assert.ok(finish(game)>=1);const ended=game.battle!;assert.equal(game.prepareBattleReturn()!.commit(),true);assert.equal(owner.active,false);assert.equal(game.field.updateAttributeMask,3);
 assert.equal(game.continueVictory(),false);game.advance(10);assert.equal(game.state.snapshot().completedBattles.length,1);
 const slots=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>slots.get(k)??null,setItem:(k,v)=>{slots.set(k,v);}});
 await storage.save(game.checkpoint(),1000);const saved=await storage.load();assert.ok(saved);
 const restored=GameSession.restore(saved.checkpoint,f.field,f.battle,undefined,f.runtime);assert.deepEqual(restored.checkpoint(),saved.checkpoint);
 assert.equal(restored.field.sourceMessage.active,false);assert.equal(restored.battle,null);assert.throws(()=>ended.confirmMessage(),/Retired/);
 restored.field.startEvent("fight");restored.advance(10);assert.equal(restored.prepareBattleStart()!.commit(),true);assert.ok(finish(restored)>0);
 assert.equal(restored.prepareBattleReturn()!.commit(),true);restored.advance(10);assert.equal(restored.state.snapshot().completedBattles.length,2);
 assert.ok(firstTicket!>0);
});
test("media failure/cancel preserves the original owner and pending field request; readiness never clocks or publishes Msg",async()=>{
 const {game,flow}=setup(),owner=game.field.sourceMessage,before=owner.snapshot(),request=game.field.stop;
 const failed=new GameBattleHandoff(flow,{async prepareStart(){throw new Error("controlled decode failure");},async prepareReturn(){return null;},discard(){}});
 assert.equal((await failed.start()).status,"failed");assert.equal(game.battle,null);assert.deepEqual(owner.snapshot(),before);assert.equal(game.field.stop,request);assert.equal(game.state.inBattle,false);
 let resolve!:(v:{media:boolean})=>void;const handoff=new GameBattleHandoff(flow,{prepareStart(){return new Promise<{media:boolean}>(r=>{resolve=r;});},async prepareReturn(){return {media:true};},discard(){}});
 const pending=handoff.start();game.advance(60000);assert.equal(owner.active,false);assert.equal(flow.confirm(),false);handoff.cancel();resolve({media:true});assert.equal((await pending).status,"cancelled");assert.equal(owner.active,false);
 assert.equal(game.prepareBattleStart()!.commit(),true);game.advance(10);assert.equal(owner.active,true);
});
test("cancelled return keeps a retained async window; successful return retires it and stale windows cannot affect a later battle",async()=>{
 const p=battleMessageProgram();p.instructions.splice(7,0,{mnemonic:"Msg",op: { ...((battleMessageProgram([messageRaw("Msg",-1,"ASYNC",2),messageRaw("Exit")])).instructions[0]!.op as any) }});p.end++;
 const f=battleMessageSessionFixture(p),game=new GameSession(f.field,f.battle,314,f.runtime),flow=new GameFlow(game);flow.start();flow.advance(0,ready);game.field.startEvent("fight");game.advance(10);game.prepareBattleStart()!.commit();finish(game);
 const battle=game.battle!,owner=game.field.sourceMessage,ticket=owner.projection!.windowTicket,oldClose=owner.prepare({kind:"source-message",command:{kind:"close"}}),before=messageState(game);
 let done!:(v:null)=>void;const handoff=new GameBattleHandoff(flow,{async prepareStart(){return null;},prepareReturn(){return new Promise<null>(r=>{done=r;});},discard(){}});
 const pending=handoff.return();flow.advance(60000,ready);assert.deepEqual(messageState(game),before);handoff.cancel();done(null);assert.equal((await pending).status,"cancelled");assert.deepEqual(messageState(game),before);
 assert.equal(game.prepareBattleReturn()!.commit(),true);assert.equal(owner.active,false);assert.throws(oldClose.commit,/Stale/);assert.throws(()=>battle.advance(10),/Retired/);
 game.advance(10);game.field.startEvent("fight");game.advance(10);game.prepareBattleStart()!.commit();game.advance(10);assert.ok(owner.projection!.windowTicket!>ticket!);assert.throws(()=>battle.confirmMessage(),/Retired/);assert.ok(owner.active);
});
test("fixed-entry defeat retry changes neither owned state nor a held message until successful publication; old VM cannot revive its ticket",()=>{
 const {game}=setup();game.prepareBattleStart()!.commit();game.advance(10);const old=game.battle!,owner=game.field.sourceMessage;
 // This is an explicit runtime failure fixture, not a source-story replay.
 for(const player of old.players){player.hp=0;player.conditionIds=[305];}game.advance(10);assert.equal(old.phase,"defeat");
 const before=messageState(game),owned=game.state.snapshot(),ticket=owner.projection!.windowTicket;
 const cancelled=game.prepareBattleRetry()!;cancelled.discard();assert.deepEqual(messageState(game),before);assert.deepEqual(game.state.snapshot(),owned);
 const retry=game.prepareBattleRetry()!;assert.equal(retry.commit(),true);assert.equal(owner.active,false);assert.equal(game.battle!.time,0);assert.deepEqual(game.state.snapshot(),owned);
 game.advance(10);assert.ok(owner.projection!.windowTicket!>ticket!);assert.throws(()=>old.confirmMessage(),/Retired/);assert.throws(()=>old.advance(10),/Retired/);assert.equal(game.battle!.messageInputPending,true);
});

test("retained legacy ordinary windows cannot be superseded by battle Msg; refusal preserves every existing owner and lease",()=>{
 const f=battleMessageSessionFixture(),source={file:"authored",assetPath:"retained-ordinary-window"},raw={type:1,mnemonic:"Msg",operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:["LEGACY","","","","","","",""]}},
  message=compileManualMessageInstruction(raw,{story_mes_zhc:{LEGACY:"Retained legacy text"},story_cha_zhc:{LEGACY:"Legacy"}},{nextMnemonic:"Msg"});
 // This is the existing accepted legacy typed host, not a claim that the
 // original source compiler would select this authored caller sequence.
 f.field.scripts.fight=[{...message,script:"fight",index:0,source},...f.field.scripts.fight!.map((op,index)=>({...op,index:index+1}))];
 const game=new GameSession(f.field,f.battle,314,f.runtime);game.field.startEvent("fight");game.advance(10);game.field.confirm();
 assert.equal(game.field.stop?.kind,"encounter");assert.ok(game.field.messageWindow);assert.equal(game.field.sourceMessage.active,false);
 const before={owned:game.state.snapshot(),window:structuredClone(game.field.messageWindow),message:game.field.sourceMessage.snapshot(),mask:game.field.updateAttributeMask,request:game.field.stop};
 assert.throws(()=>game.prepareBattleStart(),/existing field window or choice/);assert.equal(game.battle,null);assert.equal(game.state.inBattle,false);
 assert.deepEqual({owned:game.state.snapshot(),window:game.field.messageWindow,message:game.field.sourceMessage.snapshot(),mask:game.field.updateAttributeMask,request:game.field.stop},before);
 assert.throws(()=>game.prepareBattleStart(),/existing field window or choice/);assert.equal(game.field.stop,before.request);
});
