import test from "node:test";
import assert from "node:assert/strict";
import { SourceMessageState } from "../src/core/source-message.js";
import { bindSourceMessageFee, parseSourceMessageFeeCatalog, type SourceMessageFeeCatalog } from "../src/core/source-message-fees.js";
import { compileSourceGilTagInstruction, compileSourceMessageFees } from "../src/compiler/source-message-fees.js";
import { compileManualMessageInstruction } from "../src/compiler/message.js";
import { compileSourceMessageSequenceInstruction } from "../src/compiler/source-message-sequence.js";
import { compileFieldMessageTemplate } from "../src/compiler/message-template.js";
import { fieldMessageNameReferences, fieldMessageTemplateSource, parseFieldMessageTemplate, resolveFieldMessageTemplate } from "../src/core/field-message-template.js";
import { FieldGame } from "../src/core/field.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { fieldInstructionRequirements } from "../src/core/field-content-admission.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";
const parent="a".repeat(64),source={file:"synthetic-product.bundle",assetPath:"product.csv",objectId:"9223372036854775807",serializedFile:"synthetic",rowId:"9001"};
const catalog=(hash=parent):SourceMessageFeeCatalog=>({kind:"source-message-fees-v1",sourceSetHash:hash,blockers:[],fees:[{groupId:101,productId:9001,amount:50,source},{groupId:102,productId:9002,amount:80,source:{...source,rowId:"9002"}}]});
const tables={"product.csv":[{id:"9001",group_id:"101",coefficient:"50",content_id:"0"},{id:"9002",group_id:"102",coefficient:"80",content_id:"0"}]};
const raw=(group=101)=>({type:1,mnemonic:"SetGilTag",operands:{iValues:[group,...Array(7).fill(0)],rValues:Array(8).fill(0),sValues:Array(8).fill("")}});
const msgRaw=(seconds=0)=>({type:1,mnemonic:"Msg",operands:{iValues:[0,0,0,0,0,0,0,0],rValues:[seconds,...Array(7).fill(0)],sValues:["FEE",...Array(7).fill("")]}});
const messages=(text="Pay (KINGAKU)?<P>Still (KINGAKU).")=>({story_mes_zhc:{FEE:text},story_cha_zhc:{FEE:""}});
const manual=()=>compileManualMessageInstruction(msgRaw(),messages(),{nextMnemonic:"Exit"});
const site={script:"source-evidence-alias",index:99,source:{file:"synthetic",assetPath:"fee",objectId:"9223372036854775807"}};
const fee=(group=101)=>compileSourceGilTagInstruction(raw(group),tables);
function field(sequence=false){const content=structuredClone(checkpointFixture().field);content.parentSourceSetHash=parent;
 content.scripts.fee=[{...site,...fee()},{...site,index:100,...(sequence?compileSourceMessageSequenceInstruction(msgRaw(-1),messages("Pay (KINGAKU)?<WAIT01><P>Still (KINGAKU)."),{nextMnemonic:"Exit"}):manual())},{...site,index:101,kind:"exit"}];
 return content;}
test("SetGilTag binds the unique ordinary Product fee and preserves unknown/ambiguous domains",()=>{
 assert.deepEqual(fee(),{kind:"source-gil-tag",groupId:101,productId:9001,amount:50,dependencies:[{table:"product.csv",id:9001}]});
 for(const change of [(x:ReturnType<typeof raw>)=>x.type=2,(x:ReturnType<typeof raw>)=>x.operands.iValues[3]=1,(x:ReturnType<typeof raw>)=>x.operands.sValues[0]="x"]){const x=raw();change(x);assert.throws(()=>compileSourceGilTagInstruction(x,tables));}
 assert.throws(()=>fee(999));assert.throws(()=>compileSourceGilTagInstruction(raw(),{"product.csv":[...tables["product.csv"],tables["product.csv"][0]]}));
 const rows={"product.csv":[...tables["product.csv"],{id:"9003",group_id:"103",coefficient:"-1",content_id:"0"}]},compiled=compileSourceMessageFees({row:(_t,id)=>({values:rows["product.csv"].find(r=>Number(r.id)===id)!,source:{...source,rowId:String(id)}})},rows,parent);
 assert.equal(compiled.catalog.fees.length,2);assert.equal(compiled.catalog.blockers.length,1);assert.equal(compiled.catalog.blockers[0]!.groupId,103);
});
test("exact amount templates compose with held names without broad macro fallback or extra name requirements",()=>{
 const t=compileFieldMessageTemplate(["(ALICE): (KINGAKU)","(KINGAKU)"],"(ALICE)",[{id:"201",character_id:"101",tag_name:"ALICE"}])!;
 assert.equal(t.kind,"field-message-template-v2");assert.equal(fieldMessageNameReferences(t).length,2);
 assert.deepEqual(resolveFieldMessageTemplate(t,["Current held name","Current held name"],"50"),{pages:["Current held name: 50","50"],speaker:"Current held name"});
 assert.deepEqual(fieldMessageTemplateSource(t),{pages:["(ALICE): (KINGAKU)","(KINGAKU)"],speaker:"(ALICE)"});
 assert.throws(()=>resolveFieldMessageTemplate(t,["Held","Held"]));for(const unknown of ["kingaku","FULL_SPACE","ITEM_N"])assert.throws(()=>compileFieldMessageTemplate(["("+unknown+")"],"",[]));
 const changed=structuredClone(t);changed.kind="field-message-template-v1";assert.throws(()=>parseFieldMessageTemplate(changed));
 const op={...site,...manual()};assert.deepEqual(fieldInstructionRequirements(op).map(r=>r.capability),["messageValues"]);
});
test("the sole message owner validates a replacement once, retains it across close, and rejects missing/stale views",()=>{
 const input=catalog(),owner=new SourceMessageState(input);assert.throws(()=>owner.prepareFeeValue(),/has not been set/);
 const tx=owner.prepareFee(fee());tx.commit();assert.throws(()=>tx.commit(),/Stale/);const view=owner.prepareFeeValue();assert.equal(view.value,"50");
 owner.prepare({kind:"source-message",command:{kind:"close"}}).commit();assert.equal(owner.prepareFeeValue().value,"50");assert.throws(()=>view.validate(),/Stale/);
 input.fees[0]!.amount=999;assert.equal(owner.prepareFeeValue().value,"50");const copy=owner.fork();copy.prepareFee(fee(102)).commit();assert.equal(owner.prepareFeeValue().value,"50");assert.equal(copy.prepareFeeValue().value,"80");
 assert.equal(SourceMessageState.restore(owner.snapshot(),catalog()).prepareFeeValue().value,"50");assert.throws(()=>SourceMessageState.restore(owner.snapshot()));
 const bad=structuredClone(owner.snapshot());if(bad.kind==="source-message-v2")bad.fee.amount++;assert.throws(()=>SourceMessageState.restore(bad,catalog()));
 assert.throws(()=>bindSourceMessageFee(catalog(),{groupId:101,productId:9002,amount:50}));const bound=parseSourceMessageFeeCatalog(catalog());assert.throws(()=>{bound.fees[0]!.amount=1;});
});
test("a manual window resolves its full pages once; the next window reads the latest value",()=>{
 const game=new FieldGame(field(),undefined,undefined,undefined,{messageFees:catalog()});game.startEvent("fee");assert.equal(game.dialogue?.text,"Pay 50?");
 game.sourceMessage.prepareFee(fee(102)).commit();game.advance(10);game.confirm();assert.equal(game.dialogue?.text,"Still 50.");game.advance(10);game.confirm();game.advance(10);assert.equal(game.stop,null);
 game.content.scripts.next=[{...site,...manual()},{...site,kind:"exit"}];game.startEvent("next");assert.equal(game.dialogue?.text,"Pay 80?");
});
test("missing source fee authority or unresolved values fail before the window and mask change",()=>{
 const content=field(),game=new FieldGame(content);game.startEvent("fee");assert.ok(game.stop?.message.includes("catalog"));assert.equal(game.messageWindow,null);assert.equal(game.sourceMessage.feeSnapshot,null);
 const missing=structuredClone(content);missing.scripts.only=[{...site,...manual()},{...site,kind:"exit"}];const unresolved=new FieldGame(missing,undefined,undefined,undefined,{messageFees:catalog()});const before=unresolved.sourceMessage.snapshot();unresolved.startEvent("only");assert.ok(unresolved.stop?.message.includes("has not been set"));assert.deepEqual(unresolved.sourceMessage.snapshot(),before);assert.equal(unresolved.messageWindow,null);
});
test("nonempty message values use source-bound v16 checkpoints; empty legacy shape and invalid restore stay strict",()=>{
 const game=new FieldGame(field(),undefined,undefined,undefined,{messageFees:catalog()});game.sourceMessage.prepareFee(fee()).commit();const saved=game.checkpoint();assert.equal(saved.kind,"idle-field-v16");
 const restored=FieldGame.restore(game.content,saved,{messageFees:catalog()});assert.deepEqual(restored.checkpoint(),saved);assert.equal(restored.sourceMessage.prepareFeeValue().value,"50");
 const bad=structuredClone(saved);if(bad.kind==="idle-field-v16")bad.sourceMessageValues.amount=777;assert.throws(()=>FieldGame.restore(game.content,bad,{messageFees:catalog()}));assert.throws(()=>FieldGame.restore(game.content,saved));
 const empty=new FieldGame(field());assert.equal(empty.checkpoint().kind,"idle-field-v10");
});

import { worldLoopSessionFixture } from "./fixtures/world-loop-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameCommands } from "../src/core/game-commands.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { createWebFieldMessageSequencePort } from "../src/core/source-message-sequence.js";
import type { Op } from "../src/field/types.js";
const ready={visible:true,mediaReady:true,overlayOpen:false};
async function sessionFixture(fail=false){
 const f=await worldLoopSessionFixture(),map=structuredClone(f.map),target=structuredClone(f.worldMap),world=structuredClone(f.world),battle=structuredClone(f.battle);
 map.parentSourceSetHash=parent;target.parentSourceSetHash=parent;world.parentSourceSetHash=parent;
 const sourceMap=sealBatchContent({...structuredClone(f.sourceMap),parentSourceSetHash:parent}),sourceWorld=structuredClone(f.sourceWorld);sourceWorld.parentSourceSetHash=parent;sourceWorld.maps[sourceMap.mapId]!.contentHash=sourceMap.contentHash;
 const sourceEntry=sealBatchContent({...structuredClone(f.sourceEntry),parentSourceSetHash:parent,mapContentHash:sourceMap.contentHash,worldCatalogHash:sealBatchContent(sourceWorld).contentHash});
 battle.common.sourceMessageFees=catalog(parent);const sealedBattle=sealBatchContent(battle);
 map.scripts[map.initializer!]!.unshift({...site,...fee()});target.scripts[target.initializer!]!.unshift({...site,...fee(102)});
 if(fail)target.scripts[target.initializer!]!.splice(1,0,{...site,kind:"blocked",mnemonic:"ControlledLateFeeFailure",reason:"Controlled candidate fails after fee replacement"});
 target.scripts["fee-save"]=[{...site,...manual()},{...site,index:100,kind:"event-save"},{...site,index:101,...fee()},{...site,index:102,kind:"inventory",command:{kind:"pay-gil",amount:50},result:{category:"MapLocalVariable",index:0},dependencies:[]},{...site,index:103,kind:"exit"}];
 target.scripts["fee-fight"]=[{...site,kind:"encounter",party:f.encounterId,continuation:"fee-after-fight"}];
 target.scripts["fee-after-fight"]=[{...site,...manual()},{...site,index:100,...fee(102)},{...site,index:101,kind:"exit"}];
 for(const key of ["fee-save","fee-fight","fee-after-fight"]){target.scriptPuppetContexts![key]=structuredClone(target.scriptPuppetContexts![target.initializer!]!);(target.scriptSystemFlags??={})[key]={keepBadStatusVisual:false};}
 const start=sealBatchContent(map),next=sealBatchContent(target);world.maps[start.mapId]!.contentHash=start.contentHash;world.maps[next.mapId]!.contentHash=next.contentHash;const wc=sealBatchContent(world);
 const content=await compileFrameworkNewGame({sourceEntry,sourceBattle:f.sourceBattle,sourceMap,world:wc,map:start,battle:sealedBattle,entrance:start.partyEntry!.pointIns[0]!.id}),runtime={battleHandoff:"prepared" as const};
 const game=await GameSession.prepareFrameworkNewGame(content,wc,start,sealedBattle,runtime),flow=new GameFlow(game);flow.start();flow.advance(10,ready);
 return{f,game,flow,start,next,world:wc,battle:sealedBattle,content,runtime,restore:(saved:Parameters<typeof GameSession.restore>[0])=>GameSession.restore(saved,undefined,sealedBattle,{catalog:wc,map:saved.world.location?.mapId===next.mapId?next:start,initialized:{content,initialMap:start}},runtime)};
}
function finishMessage(game:GameSession,flow:GameFlow){for(let n=0;n<20&&game.field.dialogue;n++){flow.advance(10,ready);flow.confirm();}flow.advance(10,ready);}
test("continuous Session keeps fee and Gil owners separate through cancellation, event Storage, battle retry and map return",async()=>{
 const h=await sessionFixture(),initialGil=h.game.gil;assert.equal(h.game.field.sourceMessage.prepareFeeValue().value,"50");h.game.field.startEvent("go-world");h.flow.advance(10,ready);
 const cancel=h.game.world.prepare(h.world,h.next);assert.equal(cancel.field.sourceMessage.prepareFeeValue().value,"80");h.game.world.discard(cancel);assert.equal(h.game.field.sourceMessage.prepareFeeValue().value,"50");assert.equal(h.game.gil,initialGil);
 const current=h.game.world.prepare(h.world,h.next);assert.equal(h.game.world.commit(current),true);h.flow.advance(10,ready);assert.equal(h.game.field.sourceMessage.prepareFeeValue().value,"80");
 h.game.field.startEvent("fee-save");assert.equal(h.game.field.dialogue?.text,"Pay 80?");finishMessage(h.game,h.flow);assert.ok(h.game.eventSaveRequest);assert.equal(h.game.gil,initialGil);
 const request=h.game.eventSaveRequest!,save=h.game.prepareEventSave(request);
 assert.throws(()=>save.commitWith(()=>{throw Error("Controlled storage failure");}),/Controlled storage failure/);assert.equal(h.game.eventSaveRequest,request);assert.equal(h.game.field.sourceMessage.prepareFeeValue().value,"80");assert.equal(h.game.gil,initialGil);
 const bytes=new Map<string,string>(),store=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}}),write=await store.prepareSave(save.checkpoint,0);h.game.prepareEventSave(request).commitWith(()=>write.commit());
 const game=h.restore((await store.load())!.checkpoint),flow=new GameFlow(game);flow.start();flow.advance(20,ready);assert.equal(game.field.sourceMessage.prepareFeeValue().value,"50");assert.equal(game.gil,initialGil-50);assert.equal(game.field.eventState.snapshot().map[0],1);
 game.field.startEvent("fee-fight");flow.advance(10,ready);let fail=true;const handoff=new GameBattleHandoff(flow,{prepareStart:async()=>{if(fail)throw Error("Controlled media failure");},prepareReturn:async()=>undefined,discard(){}}),before=game.state.snapshot();assert.equal((await handoff.start()).status,"failed");assert.deepEqual(game.state.snapshot(),before);assert.equal(game.field.sourceMessage.prepareFeeValue().value,"50");fail=false;assert.equal((await handoff.start()).status,"committed");
 const commands=new GameCommands(flow,game);for(let n=0;n<2000&&game.battle?.phase==="active";n++){const b=game.battle;for(const actor of b.ready){const enemy=b.enemies.find(e=>e.hp>0);if(enemy)commands.command(b,actor.id,10,{kind:"single",id:enemy.id},100);}flow.advance(20,ready);}
 assert.equal(game.battle?.phase,"victory");assert.equal((await handoff.return()).status,"committed");flow.advance(10,ready);assert.equal(game.field.dialogue?.text,"Pay 50?");finishMessage(game,flow);assert.equal(game.field.sourceMessage.prepareFeeValue().value,"80");
 const saved=game.checkpoint(),restored=h.restore(saved);assert.deepEqual(restored.checkpoint(),saved);assert.equal(restored.state.snapshot().completedBattles.length,1);const rf=new GameFlow(restored);rf.start();restored.field.startEvent("world-return");rf.advance(10,ready);const back=restored.world.prepare(h.world,h.start);assert.equal(restored.world.commit(back),true);assert.equal(restored.field.sourceMessage.prepareFeeValue().value,"50");
});
test("failed initialization and changed candidate fee do not replace the live message or economic owners",async()=>{
 const h=await sessionFixture(true);h.game.field.startEvent("go-world");h.flow.advance(10,ready);const state=h.game.state.snapshot(),old=h.game.field,actors=old.nativeActorStateFingerprint;
 assert.throws(()=>h.game.world.prepare(h.world,h.next),/Controlled candidate fails/);assert.deepEqual(h.game.state.snapshot(),state);assert.equal(h.game.field,old);assert.equal(old.nativeActorStateFingerprint,actors);assert.equal(old.sourceMessage.prepareFeeValue().value,"50");
 const clean=await sessionFixture();clean.game.field.startEvent("go-world");clean.flow.advance(10,ready);const p=clean.game.world.prepare(clean.world,clean.next);p.field.sourceMessage.prepareFee(fee()).commit();assert.equal(clean.game.world.commit(p),false);assert.equal(clean.game.field.sourceMessage.prepareFeeValue().value,"50");
});
test("sequence values use the same manager and explicit production Web context",()=>{
 const game=new FieldGame(field(true),undefined,undefined,undefined,{messageFees:catalog(),sourceMessageSequence:createWebFieldMessageSequencePort()});game.startEvent("fee");const seen:string[]=[];
 for(let n=0;n<500&&(!game.checkpointReady);n++){game.advance(10);if(game.sourceMessage.projection)seen.push(game.sourceMessage.projection.text);if(game.sourceMessage.projection?.acceptsInput)game.confirm();}
 assert.equal(game.stop,null);assert.ok(seen.some(s=>s.includes("50")));assert.ok(!seen.some(s=>s.includes("KINGAKU")));
});

for (const event of [false,true]) test(`amount and executed field permissions share the ${event?"event":"stable"} checkpoint without replay`,()=>{
 const content=field(),options={messageFees:catalog(),contentInvalidations:{catalogHash:"b".repeat(64),catalog:battleEntryFixture().catalog}};
 content.scripts.combined=[{...site,index:0,kind:"field-content-invalidation",command:{kind:"add-moving",invalidType:2}},
  {...site,index:1,...fee()},...(event?[{...site,index:2,kind:"event-save" as const}]:[]),
  {...site,index:3,kind:"flag",ref:{category:"ScenarioFlag1",index:7},operation:"set"},{...site,index:4,kind:"exit"}];
 const game=new FieldGame(content,undefined,undefined,undefined,options);assert.equal(game.startEvent("combined"),true);assert.equal(game.stop,null);
 const saved=event?game.eventCheckpoint(game.eventSaveRequest!):game.checkpoint();assert.equal(saved.kind,event?"event-field-v7":"idle-field-v16");
 if(saved.kind!=="idle-field-v16"&&saved.kind!=="event-field-v7")assert.fail("Expected amount-bearing checkpoint");
 assert.ok(saved.contentInvalidations);const restored=FieldGame.restore(content,saved,options);
 assert.equal(restored.sourceMessage.prepareFeeValue().value,"50");assert.deepEqual(restored.contentInvalidationsSnapshot,game.contentInvalidationsSnapshot);
 assert.equal(restored.sourceMessageFeeExecutions.length,0);restored.advance(10);
 assert.equal(restored.eventState.snapshot().scenario[7],1);assert.equal(restored.sourceMessageFeeExecutions.length,0);
 const bad=structuredClone(saved);bad.contentInvalidations!.commands[0]!.instruction.command.invalidType=0;assert.throws(()=>FieldGame.restore(content,bad,options),/trusted source/);
 assert.throws(()=>FieldGame.restore(content,saved,{messageFees:catalog()}),/bound battle catalog/);
});

for(const changed of ["current","candidate"]as const)test(`map publication rejects a same-value ${changed} message transaction and permits a fresh retry`,async()=>{
 const h=await sessionFixture();h.game.field.startEvent("go-world");h.flow.advance(10,ready);const old=h.game.field,state=h.game.state.snapshot(),request=old.stop;
 const pending=h.game.world.prepare(h.world,h.next),owner=changed==="current"?old.sourceMessage:pending.field.sourceMessage,before=owner.snapshot();
 owner.prepareFee(fee(changed==="current"?101:102)).commit();assert.deepEqual(owner.snapshot(),before);
 assert.equal(h.game.world.commit(pending),false);assert.equal(h.game.field,old);assert.equal(old.stop,request);assert.deepEqual(h.game.state.snapshot(),state);
 const retry=h.game.world.prepare(h.world,h.next);assert.equal(h.game.world.commit(retry),true);assert.equal(h.game.field.sourceMessage.prepareFeeValue().value,"80");
});
