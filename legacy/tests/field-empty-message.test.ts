import test from "node:test";
import assert from "node:assert/strict";
import { createFieldEmptyMessageLookup, compileFieldEmptyMessage } from "../src/compiler/field-empty-message.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { battleMessageDictionariesInput } from "./fixtures/battle-message-dictionaries.js";
import { createWebFieldMessageWindowReady, prepareWebFieldMessageWindowReady } from "../src/core/field-empty-message.js";
import { SourceMessageState } from "../src/core/source-message.js";
import { createWebFieldMessageSequencePort, type SourceMessageSequenceCommand } from "../src/core/source-message-sequence.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import type { FieldGame } from "../src/core/field.js";
import type { Op, Site } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
const input = () => battleMessageDictionariesInput();
const raw = (key = "", duration = 0, window = 0) => ({ type: 1, mnemonic: "Msg", operands: {
  iValues: [window, 2, 7, 8, 9, 10, 11, 12], rValues: [duration, 1, 2, 3, 4, 5, 6, 7],
  sValues: [key, "retained1", "retained2", "retained3", "retained4", "retained5", "retained6", "retained7"] } });
const empty = (key = "", duration = 0, window = 0) => compileFieldEmptyMessage(raw(key,duration,window), createFieldEmptyMessageLookup(input()))!;
const sequence: SourceMessageSequenceCommand = { kind: "sequence", key: "AUTHORED_EXISTING", speaker: "",
  layout: { window: "frame", anchor: "bottom" }, document: { kind: "source-message-sequence-v1", alignment: "left", tokens: [{ kind: "text", text: "Existing window" }] },
  seconds: -1, bypassSpeed: false, after: "message" };
const sourceSequence = { kind: "source-message", command: sequence } as const;
const hostReady = { visible: true, mediaReady: true, overlayOpen: false };
type Instruction<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
function fixture(instructions: Instruction[]) {
  const f=checkpointFixture(), proof=empty(), surface={}, control:{initialized:boolean;current:FieldGame|null;fail:boolean;mutate:(()=>void)|null}={initialized:false,current:null,fail:false,mutate:null};
  f.field.sourceSetHash=proof.binding.sourceSetHash;f.field.parentSourceSetHash=proof.binding.parentSourceSetHash;
  f.battle.common.fieldSourceSetHash=f.field.sourceSetHash;
  f.field.scripts.empty=instructions.map((op,index)=>({...op,script:'empty',index,source:{file:'authored',assetPath:'empty-message-test'}} as Op));
  const authority=createWebFieldMessageWindowReady(()=>{if(control.fail)throw Error('controlled readiness failure');control.mutate?.();return{
    kind:'web-field-message-window-surface-v1',surface,initialized:control.initialized,owner:control.current?.sourceMessage??null,generation:control.current};});
  const runtime={sourceMessageReady:authority,sourceMessageSequence:createWebFieldMessageSequencePort(),battleHandoff:'prepared' as const,battleEventMessages:'web-source-battle-event-messages-v1' as const},
    game=new GameSession(f.field,f.battle,314,runtime),flow=new GameFlow(game);control.current=game.field;flow.start();flow.advance(0,hostReady);
  return{...f,game,flow,runtime,control,authority};
}

test("complete dictionary evidence alone authorizes Field empty/missing lookup and preserves unused original operands",()=>{
  const lookup=createFieldEmptyMessageLookup(input());
  for(const duration of [-3,0,2])for(const window of [0,1,2,3,999]){
    const original=raw('ABSENT_SYNTHETIC',duration,window),op=compileFieldEmptyMessage(original,lookup)!;
    assert.equal(op.reason,'missing-static-row');assert.deepEqual(op.operands,original.operands);assert.notEqual(op.operands,original.operands);
  }
  assert.equal(compileFieldEmptyMessage(raw('KEY'),lookup),null);assert.equal(compileFieldEmptyMessage(raw('OTHER'),lookup),null);
  assert.throws(()=>createFieldEmptyMessageLookup({messages:{}}),/complete/);
  const partial=input();delete partial.messages.etc_text_zhc;assert.throws(()=>createFieldEmptyMessageLookup(partial),/content\/source mismatch|Expected object/);
  assert.throws(()=>compileFieldEmptyMessage(raw(),{} as never),/lookup authority/);
  const site={script:'authored',index:0,source:{file:'authored',assetPath:'field-empty'}};
  assert.equal(decodeFieldOp(raw(),site,{}, {},{nextMnemonic:'Exit'}).kind,'blocked');
  assert.equal(decodeFieldOp(raw(),site,{}, {},{nextMnemonic:'Exit',emptyMessages:lookup}).kind,'field-empty-message-stop');
});

test("versioned Ready has no default or serializable brand and revokes a stale owner/generation",()=>{
  const owner=new SourceMessageState(),other=new SourceMessageState(),surface={},generation={},state={current:owner,initialized:false};
  assert.throws(()=>createWebFieldMessageWindowReady(undefined as never),/explicit/);
  const authority=createWebFieldMessageWindowReady(()=>({kind:'web-field-message-window-surface-v1',surface,generation,owner:state.current,initialized:state.initialized}));
  const no=prepareWebFieldMessageWindowReady(authority,owner);assert.equal(no.ready,false);state.initialized=true;assert.throws(no.validate,/Stale/);
  const yes=prepareWebFieldMessageWindowReady(authority,owner);assert.equal(yes.ready,true);state.current=other;assert.throws(yes.validate,/Stale/);
  for(const fake of [undefined,JSON.parse(JSON.stringify(authority)),Object.create(Object.getPrototypeOf(authority)),new Proxy(authority,{})])
    assert.throws(()=>prepareWebFieldMessageWindowReady(fake,owner),/genuine/);
});

test("dedicated Stop and missing warning share the actual message frame and retire old tickets without group12",()=>{
  const state=new SourceMessageState();state.prepare(sourceSequence,createWebFieldMessageSequencePort().prepare().context).commit();
  const prior=state.snapshot(),ticket=state.projection!.windowTicket!,old=state.prepare({kind:'source-message',command:{kind:'close'}});
  const rejected=state.prepareFrame(),stop=rejected.state.prepareEmptyStop(empty('MISSING'));assert.deepEqual(stop.effects,[]);stop.commit();
  assert.equal(rejected.state.active,false);assert.equal(rejected.state.emptyStopJournal.length,1);rejected.discard();assert.deepEqual(state.snapshot(),prior);assert.equal(state.emptyStopJournal.length,0);
  const frame=state.prepareFrame();frame.state.prepareEmptyStop(empty('MISSING')).commit();frame.prepareCommit().commit();
  assert.equal(state.active,false);assert.equal(state.emptyStopJournal[0]!.warning,'missing-static-source-message');assert.equal(state.emptyStopJournal[0]!.retiredTicket,ticket);
  assert.throws(()=>state.sequenceStatus(ticket),/Stale/);assert.throws(old.commit,/Stale/);
  state.prepareEmptyStop(empty()).commit();assert.equal(state.emptyStopJournal[1]!.warning,null);
});

test("actual Session waits notReady on the same Msg, preserves the old window/Core/group, then Stop reaches an event-save barrier",()=>{
  const f=fixture([sourceSequence,empty('MISSING',3,999),{kind:'event-save'},{kind:'exit'}]);
  assert(f.game.field.startEvent('empty'));const field=f.game.field,ticket=field.sourceMessage.projection!.windowTicket!;
  assert.equal(field.updateAttributeMask,9);assert.equal(field.sourceMessage.emptyStopJournal.length,0);
  for(let n=0;n<3;n++)f.flow.advance(10,hostReady);
  assert.equal(field.stop,null);assert.equal(field.sourceMessage.projection?.key,sequence.key);assert.equal(field.sourceMessage.projection?.windowTicket,ticket);
  assert.equal(field.updateAttributeMask,9);assert.equal(f.game.eventSaveRequest,null);
  f.control.initialized=true;f.flow.advance(10,hostReady);assert.equal(field.sourceMessage.active,false);assert.equal(field.updateAttributeMask,9);
  for(let n=0;n<3&&!field.stop;n++)f.flow.advance(10,hostReady);
  assert.equal(f.game.eventSaveRequest,null);assert.match(JSON.stringify(field.stop),/Empty-message Stop requires native update-mask checkpoint/);
  assert.equal(field.updateAttributeMask,9);assert.equal(field.sourceMessage.emptyStopJournal.length,1);
});

test("readiness failure or attempted public window mutation cannot close the reserved original window",()=>{
  for(const attempt of ['throw','late-throw','late-generation','owner-write','reentrant-clock','raw-mutation'] as const){
    const f=fixture([sourceSequence,empty(),{kind:'exit'}]);f.game.field.startEvent('empty');const field=f.game.field;
    const ticket=field.sourceMessage.projection!.windowTicket;f.control.initialized=true;
    if(attempt==='throw')f.control.fail=true;
    let calls=0;if(attempt==='late-throw')f.control.mutate=()=>{if(++calls===2)throw Error('controlled validation failure');};
    if(attempt==='late-generation')f.control.mutate=()=>{if(++calls===2)f.control.current=null;};
    if(attempt==='owner-write')f.control.mutate=()=>{field.sourceMessage.prepare({kind:'source-message',command:{kind:'close'}}).commit();};
    if(attempt==='reentrant-clock')f.control.mutate=()=>field.advance(10);
    if(attempt==='raw-mutation')f.control.mutate=()=>{(field.content.scripts.empty![1] as Extract<Op,{kind:'field-empty-message-stop'}>).operands.rValues[0]=77;};
    f.flow.advance(10,hostReady);assert.equal(field.stop?.kind,'unsupported',attempt);assert.equal(field.sourceMessage.active,true,attempt);
    assert.equal(field.sourceMessage.projection!.windowTicket,ticket);assert.equal(field.updateAttributeMask,9);assert.deepEqual(field.sourceMessage.emptyStopJournal,[]);
  }
});

test("stable Storage does not replay Stop or restore a readiness authority",async()=>{
  const f=fixture([empty(),{kind:'exit'}]);f.control.initialized=true;f.game.field.startEvent('empty');assert(f.game.checkpointReady);
  const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});
  await storage.save(f.game.checkpoint(),0);const saved=(await storage.load())!.checkpoint;
  const restored=GameSession.restore(saved,f.field,f.battle,undefined,f.runtime);f.control.current=restored.field;
  assert.deepEqual(restored.field.sourceMessage.emptyStopJournal,[]);assert.deepEqual(restored.checkpoint(),saved);
  restored.field.startEvent('empty');assert.equal(restored.field.stop,null);assert.equal(restored.field.sourceMessage.emptyStopJournal.length,1);
  const absent=GameSession.restore(saved,f.field,f.battle);absent.field.startEvent('empty');assert.match(absent.field.stop?.message??'',/readiness authority/);
  assert.equal(absent.field.sourceMessage.emptyStopJournal.length,0);
});


test("World candidate waits for the published DOM owner without preventing map commit, while discard revokes its lease",()=>{
  const f=fixture([{kind:'exit'}]),proof=empty();
  f.world.sourceSetHash=f.target.sourceSetHash=proof.binding.sourceSetHash;
  f.world.parentSourceSetHash=f.target.parentSourceSetHash=proof.binding.parentSourceSetHash;
  f.target.scripts.init=[{...empty('MISSING'),script:'init',index:0,source:{file:'authored',assetPath:'candidate-empty'}},
    {kind:'exit',script:'init',index:1,source:{file:'authored',assetPath:'candidate-empty'}}];
  f.control.initialized=true;const old=f.game.field,lease=prepareWebFieldMessageWindowReady(f.authority,old.sourceMessage);
  old.previewMap(2,1);const discarded=f.game.world.prepare(f.world,f.target);f.game.world.discard(discarded);
  assert.equal(f.game.field,old);assert.equal(old.sourceMessage.emptyStopJournal.length,0);
  const candidate=f.game.world.prepare(f.world,f.target);assert.equal(f.game.world.commit(candidate),true);
  const current=f.game.field;assert.notEqual(current,old);assert.equal(current.stop,null);
  assert.equal(current.sourceMessage.emptyStopJournal.length,0,'unpublished candidate must not claim old Field readiness');
  f.control.current=current;assert.throws(lease.validate,/Stale/);f.flow.advance(10,hostReady);
  assert.equal(current.stop,null);assert.equal(current.sourceMessage.emptyStopJournal.length,1);assert(f.game.checkpointReady);
  assert.equal(f.game.world.commit(candidate),false);assert.equal(old.sourceMessage.emptyStopJournal.length,0);
});

test("actual native source Session keeps group9 through Stop, event barrier and Storage without saving Ready authority",async()=>{
  const {sourceNewGameFixture}=await import('./fixtures/source-new-game.js'),{NewGameFieldEntry}=await import('../src/core/new-game-field-entry.js');
  const f=sourceNewGameFixture(),proof=empty('MISSING'),surface={},control:{current:FieldGame|null;ready:boolean}={current:null,ready:true};
  for(const value of [f.map,f.world,f.content]){value.sourceSetHash=proof.binding.sourceSetHash;value.parentSourceSetHash=proof.binding.parentSourceSetHash;}
  f.map.scriptPuppetContexts!.read={...f.map.scriptPuppetContexts!.reserved!,scriptHash:'d'.repeat(64)};
  f.map.scripts.read=[sourceSequence,proof,{kind:'event-save'},{kind:'exit'}].map((op,index)=>({...op,script:'read',index,source:f.source} as Op));
  const authority=createWebFieldMessageWindowReady(()=>({kind:'web-field-message-window-surface-v1',surface,initialized:control.ready,
    owner:control.current?.sourceMessage??null,generation:control.current})),runtime={sourceMessageReady:authority,sourceMessageSequence:createWebFieldMessageSequencePort()};
  const entry=new NewGameFieldEntry(f.content.entry,f.presentation),start=entry.prepareStart(f.fade,{active:true,callbacks:'absent'});start.commit();
  let fade=start.fade;fade.advance(.5);for(let n=0;n<3;n++){const step=entry.prepareResume(fade,true)!;step.commit();fade=step.fade;}
  const game=GameSession.prepareNewGame(f.content,f.world,f.map,f.battle,fade,f.presentation,runtime);
  const launch=entry.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(launch.launch);launch.commit();control.current=game.field;game.advance(10);
  assert(game.checkpointReady);game.field.startEvent('read');assert.equal(game.field.updateAttributeMask,9);
  for(let n=0;n<4&&!game.eventSaveRequest;n++)game.advance(10);assert(game.eventSaveRequest,game.field.stop?.message);
  const prepared=game.prepareEventSave(game.eventSaveRequest!);assert.equal(prepared.checkpoint.world.field.native!.updateMask,9);
  assert('execution'in prepared.checkpoint.world.field);
  const task=(game.field as unknown as{tasks:{generalRegisters:{r:number[]}}[]}).tasks[0]!;assert.deepEqual(task.generalRegisters.r,[0,0,-1,0]);
  prepared.commitWith(()=>{});game.advance(10);assert(game.checkpointReady);
  const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});
  await storage.save(game.checkpoint(),0);const saved=(await storage.load())!.checkpoint;assert.equal(saved.world.field.native!.updateMask,9);
  assert(!JSON.stringify(saved).includes('web-field-message-window-ready'));
  const initial=checkpointFixture().field;initial.parentSourceSetHash=f.content.parentSourceSetHash;
  const deps={catalog:f.world,map:f.map,source:{content:f.content,initialMap:f.map}};
  const restored=GameSession.restore(saved,initial,f.battle,deps,runtime);control.current=restored.field;
  assert.equal(restored.field.updateAttributeMask,9);assert.deepEqual(restored.checkpoint(),saved);
  assert.equal(restored.field.sourceMessage.emptyStopJournal.length,0);restored.field.startEvent('read');restored.advance(10);
  assert.equal(restored.field.sourceMessage.emptyStopJournal.length,1);assert.equal(restored.field.updateAttributeMask,9);
  const absent=GameSession.restore(saved,initial,f.battle,deps,{sourceMessageSequence:runtime.sourceMessageSequence});absent.field.startEvent('read');absent.advance(10);
  assert.match(absent.field.stop?.message??'',/readiness authority/);assert.equal(absent.field.sourceMessage.emptyStopJournal.length,0);
});


test("a second task cannot Stop a positive-time Msg wrapper or erase its Core/timer obligation",()=>{
  const f=fixture([{kind:'puppet',slot:0,actor:'npc',target:5},{kind:'exec-puppets',asynchronous:true},
    {kind:'source-message',command:{...sequence,seconds:2}},
    {kind:'flag',ref:{category:'ScenarioFlag1',index:13},operation:'set'},{kind:'exit'},empty(),{kind:'exit'}]);
  f.control.initialized=true;f.game.field.eventState.write({category:'ScenarioFlag1',index:13},0);f.game.field.startEvent('empty');const field=f.game.field;
  assert.match(field.stop?.message??'',/cannot retire an active synchronous message wrapper\/timer/);
  assert.equal(field.sourceMessage.active,true);assert.equal(field.updateAttributeMask,9);
  assert.equal(field.sourceMessage.emptyStopJournal.length,0);assert.equal(field.eventState.read({category:'ScenarioFlag1',index:13}),0);
  const tasks=(field as unknown as{tasks:{sourceMessageWait:unknown;generalRegisters:unknown}[]}).tasks;
  assert.equal(tasks.filter(t=>t.sourceMessageWait!==null).length,1);assert.match(JSON.stringify(tasks),/pageSeconds/);
});


test("controlled replay window requires mount and actual publication, revokes retired Fields and never defaults Ready",async()=>{
  const module=await import(String(new URL('../../scripts/source-web-replay-runtime.mjs',import.meta.url))),
    controller=module.createSourceWebReplayMessageWindowController({createAuthority:createWebFieldMessageWindowReady});
  assert.equal('sourceMessageReady'in module.sourceWebReplayRuntimePorts(),false);
  assert.throws(()=>module.sourceWebReplayRuntimePorts({messageWindow:{}}),/actual controlled/);
  const f=fixture([{kind:'exit'}]),runtime={...f.runtime,...module.sourceWebReplayRuntimePorts({messageWindow:controller})},
    game=new GameSession(f.field,f.battle,314,runtime);
  assert.equal(prepareWebFieldMessageWindowReady(controller.authority,game.field.sourceMessage).ready,false);
  assert.throws(()=>controller.publish(game.field),/not mounted/);controller.mount();assert.throws(()=>controller.mount(),/twice/);
  assert.equal(prepareWebFieldMessageWindowReady(controller.authority,game.field.sourceMessage).ready,false);
  controller.publish(game.field);assert.equal(prepareWebFieldMessageWindowReady(controller.authority,game.field.sourceMessage).ready,true);
  const saved=game.checkpoint(),restored=GameSession.restore(saved,f.field,f.battle,undefined,runtime),old=game.field;
  controller.publish(restored.field);assert.equal(prepareWebFieldMessageWindowReady(controller.authority,old.sourceMessage).ready,false);
  assert.throws(()=>controller.publish(old),/actual current/);assert.equal(controller.evidence().presentation,'no-pixels');
  controller.unpublish(restored.field);assert.equal(prepareWebFieldMessageWindowReady(controller.authority,restored.field.sourceMessage).ready,false);
  assert.throws(()=>controller.publish(restored.field),/actual current/);controller.dispose();
  assert.throws(()=>controller.publish(new GameSession(f.field,f.battle,314,runtime).field),/not mounted/);
  assert.throws(()=>controller.mount(),/after disposal/);assert.equal(prepareWebFieldMessageWindowReady(controller.authority,old.sourceMessage).ready,false);
});


test("Battle retains the same real window owner through cancelled return and unique commit before Field empty Stop",async()=>{
  const {battleMessageContent}=await import('./fixtures/battle-event-message.js'),{GameBattleHandoff}=await import('../src/core/game-battle-handoff.js');
  const f=fixture([{kind:'exit'}]),content=battleMessageContent();f.battle.common.battleEvents=content.battleEvents!;
  f.battle.encounters[1000]!.lifecycle=content.lifecycle!;
  f.field.scripts.after=[empty(),{kind:'exit'}].map((op,index)=>({...op,script:'after',index,source:{file:'authored',assetPath:'after-battle-empty'}} as Op));
  f.control.initialized=true;f.game.field.startEvent('fight');f.game.advance(10);assert(f.game.battleStartRequest);
  assert.equal(f.game.prepareBattleStart()!.commit(),true);const battle=f.game.battle!,owner=f.game.field.sourceMessage;
  assert.equal(battle.sourceMessage,owner);let confirmations=0;
  for(let n=0;n<30000&&battle.phase==='active';n++){
    if(owner.projection?.acceptsInput){assert(battle.confirmMessage());confirmations++;}
    if(!battle.messageInputPending)for(const actor of battle.ready){const target=battle.targets(actor.id,10)[0];if(target)battle.command(actor.id,10,target.id);}
    f.flow.advance(10,hostReady);
  }
  assert.equal(battle.phase,'victory');assert(confirmations>0);assert.equal(owner.emptyStopJournal.length,0);
  let resolve!:(value:null)=>void;const handoff=new GameBattleHandoff(f.flow,{async prepareStart(){return null;},prepareReturn(){return new Promise<null>(r=>{resolve=r;});},discard(){}});
  const cancelled=handoff.return();handoff.cancel();resolve(null);assert.equal((await cancelled).status,'cancelled');assert.equal(f.game.battle,battle);
  const prepared=f.game.prepareBattleReturn()!;assert.equal(prepared.commit(),true);assert.equal(prepared.commit(),false);f.flow.advance(10,hostReady);
  assert.equal(f.game.field.sourceMessage,owner);assert.equal(owner.emptyStopJournal.length,1);assert.equal(owner.active,false);assert.equal(f.game.field.updateAttributeMask,3);
  assert.equal(f.game.state.snapshot().completedBattles.length,1);assert.throws(()=>battle.advance(10),/Retired/);
  const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});
  await storage.save(f.game.checkpoint(),0);const saved=(await storage.load())!.checkpoint;
  const restored=GameSession.restore(saved,f.field,f.battle,undefined,f.runtime);f.control.current=restored.field;
  assert.deepEqual(restored.checkpoint(),saved);assert.equal(restored.state.snapshot().completedBattles.length,1);assert.equal(restored.field.sourceMessage.emptyStopJournal.length,0);
});
