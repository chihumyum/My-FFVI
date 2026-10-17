import { analyzeBatchEncounters } from "../src/compiler/content-batch-battle.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { WEB_BATTLE_EVENT_CONDITIONS, parseBattleEventCondition } from "../src/core/battle-event-condition.js";
import { classifyDeferredBattleInstruction } from "../src/core/battle-branch-execution.js";
import { BattleGame } from "../src/core/battle.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { WEB_BATTLE_EVENT_CONTROLS } from "../src/core/battle-controls.js";
import { WEB_BATTLE_EVENT_EFFECTS, type BattleEventEffectHost } from "../src/core/battle-event-effect.js";
import { battleMessageProgram, battleMessageContent, battleMessageSessionFixture, messageRaw } from "./fixtures/battle-event-message.js";
import { authoredBattleEffect } from "./fixtures/battle-event-effect.js";

const raw = (side = 1, id = 1000, condition = 302, add = 1) => ({ type: 1, mnemonic: "BattleCondition", operands: {
  iValues: [side, id, condition, add, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
function content(program = battleMessageProgram([raw(), messageRaw("Wait", .1), raw(1,1000,302,0), messageRaw("BattleForceExit"), messageRaw("Exit")])) {
  const result = battleMessageContent(program);
  result.conditions.rules.definitions.push(...[{id:301,type:6},{id:302,type:10},{id:79,type:665},{id:80,type:666},{id:5,type:5}].map(row =>
    ({ ...row, overlapped:false, eraseGroupId:600 })));
  result.conditions.rules.eraseRules.push({id:600,groupId:600,conditionId:0,type:1,eraseConditionId:0});
  result.conditions.behaviors.push({id:301,kind:"silence",name:"Silence",untilType:2},
    {id:302,kind:"poison",name:"Poison",untilType:3,hpDivisor:4});
  result.battleEvents!.conditions.push({id:301,type:6,attackTarget:0,gameOverTarget:0},
    {id:302,type:10,attackTarget:0,gameOverTarget:0},{id:79,type:665,attackTarget:0,gameOverTarget:0},
    {id:80,type:666,attackTarget:0,gameOverTarget:0},{id:5,type:5,attackTarget:1,gameOverTarget:1});
  return result;
}
function setup(program?: ReturnType<typeof battleMessageProgram>) {
  const c = content(program), f = battleMessageSessionFixture(c.lifecycle!.mode === "script" ? c.lifecycle!.program : undefined);
  f.battle.common.conditions = c.conditions; f.battle.common.battleEvents = c.battleEvents!;
  f.field.entry.initialEventValues = [{ref:{category:"ScenarioVariable",index:0},value:0},{ref:{category:"ScenarioFlag1",index:8},value:0}];
  f.field.scripts["go-next"] = [{kind:"change-map",script:"go-next",index:0,source:f.field.map.source,
    request:{mapId:2,entrance:1,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:"script"}}];
  const runtime = {...f.runtime,battleEventConditions:WEB_BATTLE_EVENT_CONDITIONS,battleEventControls:WEB_BATTLE_EVENT_CONTROLS};
  const game = new GameSession(f.field,f.battle,314,runtime), flow = new GameFlow(game); flow.start();
  flow.advance(0,{visible:true,mediaReady:true,overlayOpen:false}); assert(game.field.startEvent("fight")); game.advance(10);
  return {...f,runtime,game,flow};
}
const hosts = {conditions:WEB_BATTLE_EVENT_CONDITIONS,controls:WEB_BATTLE_EVENT_CONTROLS};

test("complete source operand mapping keeps row identity and malformed known forms hard", () => {
  for (const side of [1,2]) for (const action of [0,1]) {
    const row = raw(side,0,79,action), op = battleMessageProgram([row,messageRaw("Exit")]).instructions[0]!.op;
    assert.deepEqual(op,{kind:"condition-list",target:{side:side===1?"player":"enemy",id:0},conditionId:79,action:action===0?"recover":"add"});
  }
  for (const mutate of [(m:ReturnType<typeof raw>)=>{m.operands.iValues[3]=2;},(m:ReturnType<typeof raw>)=>{m.operands.iValues[5]=1;},
    (m:ReturnType<typeof raw>)=>{m.operands.sValues[0]="guess";},(m:ReturnType<typeof raw>)=>{m.operands.iValues[2]=0;}]) {
    const row=raw();mutate(row);assert.equal(battleMessageProgram([row,messageRaw("Exit")]).instructions[0]!.op.kind,"blocked");
    assert.equal(classifyDeferredBattleInstruction(row),null);
  }
  assert.throws(()=>parseBattleEventCondition({kind:"condition-list",target:{side:"player",id:1},conditionId:79,action:"add",skip:true}));
});

test("direct list owner bypasses skill hit/resistance and never substitutes Conflict or duplicate filtering", () => {
  const engine=new BattleConditions(content().conditions);
  assert.deepEqual(engine.eventListChange([],301,"add","player"),{currentIds:[301],added:[301],removed:[],missed:false});
  assert.deepEqual(engine.eventListChange([301,301],301,"recover","player"),{currentIds:[301],added:[],removed:[301],missed:false});
  assert.deepEqual(engine.eventListChange([],79,"recover","player"),{currentIds:[],added:[],removed:[],missed:true});
  assert.throws(()=>engine.eventListChange([],79,"add","player"),/Unimplemented active/);
  assert.throws(()=>engine.eventListChange([79],79,"recover","player"),/Unimplemented active/);
  assert.throws(()=>engine.eventListChange([],99999,"recover","player"),/Unknown battle condition/);
  assert.throws(()=>engine.eventListChange([301],301,"add","player"),/duplicate lifecycle/);
});

test("actual Session source-shaped append starts the real poison clock, recovery removes it, then forced return and Storage preserve one result", async () => {
  const f=setup(),{game}=f; assert(game.prepareBattleStart()!.commit()); const b=game.battle!,actor=b.players[0]!,mp=actor.mp;
  assert.equal(b.conditionExecution.length,0);game.advance(10);assert.deepEqual(actor.conditionIds,[302]);assert.equal(b.conditionClockState(actor.id).length,1);
  game.advance(50);assert(b.conditionClockState(actor.id)[0]!.elapsedSeconds>0);assert.equal(actor.mp,mp);
  for(let i=0;i<100&&b.phase==="active";i++)game.advance(10);
  assert.equal(b.phase,"forced");assert.deepEqual(actor.conditionIds,[]);assert.deepEqual(b.conditionClockState(actor.id),[]);assert.equal(b.conditionExecution.length,2);
  assert(game.prepareBattleReturn()!.commit());game.advance(10);assert.equal(game.state.snapshot().completedBattles.length,1);assert.throws(()=>b.advance(10),/Retired/);
  const bytes=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>bytes.get(k)??null,setItem:(k,v)=>{bytes.set(k,v);}});
  await storage.save(game.checkpoint(),0);const loaded=(await storage.load())!,restored=GameSession.restore(loaded.checkpoint,f.field,f.battle,undefined,f.runtime);
  assert.deepEqual(restored.checkpoint(),loaded.checkpoint);assert(restored.field.startEvent("go-next"));restored.advance(10);
  const next=restored.world.prepare(f.world,f.target);assert(restored.world.commit(next));restored.advance(10);assert(restored.checkpointReady);
});

test("unknown active, unknown master, absent target, special enemy down phase and missing runtime authority stop before publication", () => {
  for(const [row,pattern] of [[raw(1,1000,79,1),/Unimplemented active/],[raw(1,1000,99999,0),/Unknown battle condition/],
    [raw(1,99,302,1),/absent or ambiguous/],[raw(2,1,5,1),/down-animation synchronization/]] as const) {
    const p=battleMessageProgram([row,messageRaw("BattleForceExit"),messageRaw("Exit")]),b=new BattleGame(content(p),99,undefined,undefined,undefined,undefined,undefined,undefined,hosts);
    const before=structuredClone(b.combatants);assert.throws(()=>b.advance(10),pattern);assert.deepEqual(b.combatants,before);assert.equal(b.time,0);assert.deepEqual(b.conditionExecution,[]);
  }
  const b=new BattleGame(content(),99,undefined,undefined,undefined,undefined,undefined,undefined,{controls:WEB_BATTLE_EVENT_CONTROLS});assert.throws(()=>b.advance(10),/Missing or unbound explicit/);assert.equal(b.time,0);
  assert.throws(()=>new BattleGame(content(),99,undefined,undefined,undefined,undefined,undefined,undefined,{conditions:"unknown" as typeof WEB_BATTLE_EVENT_CONDITIONS}),/Unknown Web/);
});

test("same-frame message, scenario bank and condition changes roll back on a later effect failure and publish once on retry", () => {
  const p=battleMessageProgram([raw(),messageRaw("Msg",-1,"ASYNC"),messageRaw("BattleForceExit"),messageRaw("Exit")]);
  p.instructions.splice(1,0,{mnemonic:"Calc",op:{kind:"variable-calc",left:{category:"ScenarioVariable",index:0},operator:"＋",right:{kind:"immediate",value:1}}},
    {mnemonic:"PlayBattleEffect",op:authoredBattleEffect(1,1000)});p.end+=2;
  const f=setup(p);let fail=true;
  const effects:BattleEventEffectHost={policy:WEB_BATTLE_EVENT_EFFECTS,prepare(){return{validate(){if(fail)throw Error("Controlled condition frame failure");},status(){return"ready";},commit(){},discard(){}};}};
  const game=new GameSession(f.field,f.battle,314,{...f.runtime,battleEventEffects:effects});assert(game.field.startEvent("fight"));game.advance(10);assert(game.prepareBattleStart()!.commit());const b=game.battle!,before=structuredClone(b.combatants),message=game.field.sourceMessage.projection;
  assert.throws(()=>game.advance(10),/Controlled condition frame failure/);assert.deepEqual(b.combatants,before);assert.deepEqual(b.conditionExecution,[]);assert.deepEqual(b.conditionClockState(b.players[0]!.id),[]);assert.deepEqual(game.field.sourceMessage.projection,message);assert.equal(b.eventSharedReturn!.candidate.global[0],0);
  fail=false;game.advance(10);assert.equal(b.phase,"forced");assert.equal(b.conditionExecution.length,1);assert.equal(b.eventSharedReturn!.candidate.global[0],1);assert.equal(game.field.eventState.read({category:"ScenarioVariable",index:0}),0);
  assert(game.prepareBattleReturn()!.commit());assert.equal(game.field.eventState.read({category:"ScenarioVariable",index:0}),1);assert.equal(game.state.snapshot().completedBattles.length,1);
});

test("cancelled media return and defeat retry retain the committed condition state, then retire the old instance", async () => {
  const p=battleMessageProgram([raw(),messageRaw("BattleForceExit"),messageRaw("Exit")]),f=setup(p),{game,flow}=f;
  assert(game.prepareBattleStart()!.commit());game.advance(10);const old=game.battle!,before=structuredClone(old.combatants);
  let enter!:(v:null)=>void,release!:(v:null)=>void;const waiting=new Promise<null>(r=>{enter=r;});
  const handoff=new GameBattleHandoff(flow,{async prepareStart(){return null;},async prepareReturn(){enter(null);return new Promise<null>(r=>{release=r;});},discard(){}}),pending=handoff.return();
  await waiting;handoff.cancel();release(null);assert.equal((await pending).status,"cancelled");assert.equal(game.battle,old);assert.deepEqual(old.combatants,before);assert.equal(old.conditionExecution.length,1);
  assert(game.prepareBattleReturn()!.commit());game.advance(10);assert.throws(()=>old.advance(10),/Retired/);assert.equal(game.state.snapshot().completedBattles.length,1);
  const retrying=setup(battleMessageProgram([raw(),messageRaw("Wait",100),messageRaw("Exit")]));assert(retrying.game.prepareBattleStart()!.commit());retrying.game.advance(10);const defeated=retrying.game.battle!;
  for(const player of defeated.players){player.hp=0;player.conditionIds=[...player.conditionIds,305];}retrying.game.advance(10);assert.equal(defeated.phase,"defeat");
  const owned=retrying.game.state.snapshot(),cancelled=retrying.game.prepareBattleRetry()!;cancelled.discard();assert.equal(retrying.game.battle,defeated);
  assert(retrying.game.prepareBattleRetry()!.commit());const replacement=retrying.game.battle!;assert.equal(replacement.conditionExecution.length,0);assert.throws(()=>defeated.advance(10),/Retired/);
  retrying.game.advance(10);assert.equal(replacement.conditionExecution.length,1);assert.equal(replacement.conditionClockState(replacement.players[0]!.id).length,1);assert.deepEqual(retrying.game.state.snapshot(),owned);
});


test("whole encounter compilation keeps unknown active and runtime target/host dependencies rather than dropping the former unknown-op gate", () => {
  const f=encounterRuntimeFixture(),data={Name:"authored condition caller",Title:{main:"",sub:""},
    Mnemonics:[raw(1,1000,79,1),messageRaw("Exit")],Segments:[{Label:"Main",EntryPoint:0,Count:2}],
    ScriptLocal:["BattleAIFlag"],ScriptLocalValue:[0],SystemFlag:{KeepBadStatusVisual:0,KeepPlayerPuppet:0,RidingVehicle:0,SkipInitialize:0},Animations:[]};
  f.input.conditions=content().conditions;f.tables["condition.csv"]=[{id:"79",condition_type:"665"}];
  f.input.encounters[0]!.metadata.scriptId=8010;f.input.encounters[0]!.script={data,source:{...f.aiIdentity,sourceSetHash:"a".repeat(64)}};
  const result=compileBattleEncounterRuntime(f.reader(),f.input),own=result.diagnostics.filter(row=>row.partyId===9201);
  assert(own.some(row=>row.code==="battle-event-condition-host"&&row.kind==="runtime-dependency"));
  assert(own.some(row=>row.code==="battle-event-condition-target"&&row.kind==="runtime-dependency"));
  assert(own.some(row=>row.code==="battle-event-condition-behavior"&&row.kind==="runtime-dependency"&&row.dependency?.id===79));
  f.tables["condition.csv"]=[];const absent=compileBattleEncounterRuntime(f.reader(),f.input);
  assert.equal(absent.encounters[9201],undefined);assert(absent.diagnostics.some(row=>row.partyId===9201&&row.code==="battle-script"&&row.kind==="blocked"));
});

test("one late target failure leaves every earlier prepared target and existing condition clock unchanged", () => {
  const p=battleMessageProgram([raw(1,0,302,1),messageRaw("BattleForceExit"),messageRaw("Exit")]),c=content(p);
  c.players[1]!.conditionIds=[302];const b=new BattleGame(c,99,undefined,undefined,undefined,undefined,undefined,undefined,hosts);
  const before=structuredClone(b.combatants),clock=b.conditionClockState(b.players[1]!.id);
  assert.throws(()=>b.advance(10),/duplicate lifecycle/);assert.deepEqual(b.combatants,before);assert.deepEqual(b.conditionClockState(b.players[1]!.id),clock);assert.deepEqual(b.conditionExecution,[]);assert.equal(b.time,0);
});


test("batch consumers independently preserve typed condition ownership gates when source diagnostics are unavailable or stripped", () => {
  const c=content(battleMessageProgram([raw(1,1000,79,1),messageRaw("Exit")])),f=battleMessageSessionFixture(c.lifecycle!.mode === "script" ? c.lifecycle!.program : undefined);
  f.battle.common.conditions=c.conditions;f.battle.common.battleEvents=c.battleEvents!;
  f.battle.encounterDiagnostics=[];
  const result=analyzeBatchEncounters(f.battle,[1000]).encounters[0]!;
  assert(result.runtimeDependencies.some(row=>row.code==="battle-event-condition-host"));
  assert(result.runtimeDependencies.some(row=>row.code==="battle-event-condition-target"));
  assert(result.runtimeDependencies.some(row=>row.code==="battle-event-condition-behavior"));
  assert.notEqual(result.status,"ready");
  f.battle.common.conditions.rules.definitions=f.battle.common.conditions.rules.definitions.filter(row=>row.id!==79);
  f.battle.common.battleEvents!.conditions=f.battle.common.battleEvents!.conditions.filter(row=>row.id!==79);
  assert(analyzeBatchEncounters(f.battle,[1000]).encounters[0]!.blockers.some(row=>row.code==="battle-event-condition-reference"));
});


test("actual event list application ignores skill resistance, costs no MP and does not draw the battle RNG", () => {
  const p=battleMessageProgram([raw(1,1000,301,1),messageRaw("Wait",100),messageRaw("Exit")]),c=content(p);
  c.players[0]!.conditionResistances[301]=1;
  const b=new BattleGame(c,99,undefined,undefined,undefined,undefined,undefined,undefined,hosts),mp=b.players[0]!.mp,
    rng=(b as unknown as {randomState:number}).randomState;
  b.advance(10);assert.deepEqual(b.players[0]!.conditionIds,[301]);assert.equal(b.players[0]!.mp,mp);
  assert.equal((b as unknown as {randomState:number}).randomState,rng);assert.equal(b.conditionExecution.length,1);
});
