import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleEvent } from "../src/compiler/battle-event.js";
import { compileBattleEventMessage } from "../src/compiler/battle-event-message.js";
import { createBattleEventState, advanceBattleEvent, acknowledgeBattleEventMessage, parseBattleEventProgram } from "../src/core/battle-event.js";
import { SourceMessageState } from "../src/core/source-message.js";
import { createSourceMessageTaskCursor, createWebFieldMessageSequencePort } from "../src/core/source-message-sequence.js";
import { prepareBattleEventMessagePresentation } from "../src/core/battle-event-message.js";
const messages = {story_mes_zhc:{AUTHORED:"A full source-style message.<PRESS>"},story_cha_zhc:{AUTHORED:"Known speaker"}};
const raw = (window=0,seconds=0) => ({type:1,mnemonic:"Msg",operands:{iValues:[window,2,0,0,0,0,0,0],rValues:[seconds,0,0,0,0,0,0,0],sValues:["AUTHORED","","","","","","",""]}});
const empty=(mnemonic:string)=>({type:1,mnemonic,operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:Array(8).fill("")}});
const source=(ops:unknown[])=>({Name:"authored",Title:{main:"",sub:""},Mnemonics:ops,Segments:[{Label:"Main",EntryPoint:0,Count:ops.length}],ScriptLocal:[],ScriptLocalValue:[],SystemFlag:{KeepBadStatusVisual:0,KeepPlayerPuppet:0,RidingVehicle:0,SkipInitialize:0},Animations:[]});
const context=(clock:number)=>({clock,timeSeconds:clock/100,started:true,aiCoreAlive:false,actionStaging:false});
test("all source Msg window styles preserve their semantics without routing unknown forms through the field decoder",()=>{
 for(const window of [0,1,2])for(const seconds of [-4,-1,0,3]){
  const op=compileBattleEventMessage(raw(window,seconds),{messages},"Exit");assert.equal(op.command.kind,"sequence");if(op.command.kind!=="sequence")assert.fail();
  assert.equal(op.command.seconds,seconds);assert.equal(op.presentation?.sourceWindow,window);assert.equal(op.presentation?.speakerAnchor,window===2?"right":"left");assert.equal(op.command.layout.anchor,"bottom");
 }
 const reserved=raw();reserved.operands.iValues[7]=1;assert.throws(()=>compileBattleEventMessage(reserved,{messages},"Exit"),/reserved/);
 assert.throws(()=>compileBattleEventMessage(raw(7),{messages},"Exit"),/window/);
 assert.throws(()=>compileBattleEventMessage(raw(),{messages:{story_mes_zhc:{},story_cha_zhc:{}}},"Exit"),/Missing source/);
});
test("unknown middle messages retain exact instruction positions and do not grant a whole source program",()=>{
 const unknown=raw();unknown.operands.sValues[0]="MISSING";
 const p=compileBattleEvent(source([raw(),unknown,empty("Exit")]),null,{messages});assert.equal(p.instructions.length,3);assert.equal(p.instructions[0]!.op.kind,"message");assert.equal(p.instructions[1]!.op.kind,"blocked");assert.equal(p.instructions[2]!.op.kind,"exit");
 const legacy=compileBattleEvent(source([empty("Nop"),empty("Exit")]),null);assert.equal(Object.hasOwn(legacy,"messageBinding"),false);assert.deepEqual(parseBattleEventProgram(legacy),legacy);
});
test("the message request binds once to its actual window ticket, waits for real input and rejects a replaced window atomically",()=>{
 const p=compileBattleEvent(source([raw(),empty("Exit")]),null,{messages}), initial=createBattleEventState(p),first=advanceBattleEvent(p,initial,context(1));assert.equal(first.requests.length,1);assert.equal(first.requests[0]!.kind,"message");assert.equal(initial.wait,null);
 const op=p.instructions[0]!.op;assert.equal(op.kind,"message");if(op.kind!=="message"||op.command.kind!=="sequence")assert.fail();const owner=new SourceMessageState(),prepared=owner.prepare({kind:"source-message",command:op.command},createWebFieldMessageSequencePort().prepare().context);prepared.commit();
 const cursor=createSourceMessageTaskCursor(op.command,prepared.timing!,prepared.ticket,10), waiting=acknowledgeBattleEventMessage(p,first.state,0,cursor);assert.equal(waiting.pc,0);assert.equal(waiting.wait?.kind,"message");
 assert.equal(advanceBattleEvent(p,waiting,{...context(1),messageStatus:owner.sequenceStatus(prepared.ticket)}).requests.length,0);
 owner.advance(.01);const next=advanceBattleEvent(p,waiting,{...context(2),messageStatus:owner.sequenceStatus(prepared.ticket)});assert.equal(next.state.pc,0);assert.equal(next.requests.length,0);
 const before=structuredClone(next.state);assert.throws(()=>advanceBattleEvent(p,next.state,{...context(3),messageStatus:{...owner.sequenceStatus(prepared.ticket),ticket:prepared.ticket+1}}),/Stale/);assert.deepEqual(next.state,before);
 assert.throws(()=>acknowledgeBattleEventMessage(p,waiting,0,cursor),/Stale/);
});
test("negative Msg returns Next only after successful publication; exact Close requests continue without inventing confirmation",()=>{
 const p=compileBattleEvent(source([raw(2,-4),empty("MsgClose"),empty("Exit")]),null,{messages});const first=advanceBattleEvent(p,createBattleEventState(p),context(1)),bound=acknowledgeBattleEventMessage(p,first.state,0,null);assert.equal(bound.pc,1);
 const close=advanceBattleEvent(p,bound,context(1));assert.equal(close.requests[0]!.kind,"message");assert.equal(close.state.pc,2);assert.equal(advanceBattleEvent(p,close.state,context(1)).state.status,"exited");
});
test("owned-name preparation verifies the source text binding and never substitutes a missing held name",()=>{
 const op=compileBattleEventMessage(raw(),{messages},"Exit");if(op.command.kind!=="sequence")assert.fail();const command={...op.command,template:{kind:"field-message-template-v1" as const,pages:[[{kind:"character-name" as const,ref:{tag:"TERRA",sourceId:1,rowId:1}}]],speaker:[]}};
 assert.throws(()=>prepareBattleEventMessagePresentation(command,{},new SourceMessageState()),/binding mismatch/);
 command.document={kind:"source-message-sequence-v1",alignment:"left",tokens:[{kind:"text",text:"(TERRA)"}]};command.speaker="";
 assert.throws(()=>prepareBattleEventMessagePresentation(command,{},new SourceMessageState()),/actual held-name owner/);
});
