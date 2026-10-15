import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldConditionCatalog } from "../src/compiler/field-conditions.js";
import { FieldConditions } from "../src/core/field-conditions.js";
import { projectUserConditionPhase } from "../src/core/ability-user-conditions.js";
import { compileEnemyBattleDefinition } from "../src/compiler/enemy-battle-definition.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { compileEnemyInitialConditions } from "../src/compiler/initial-conditions.js";
import { compileLevitateCondition } from "../src/compiler/condition-levitate.js";
import { calculateMagic } from "../src/core/magic.js";
import { projectActionTarget, type ActionParticipant } from "../src/core/action-effects.js";
import type { DevelopmentAbilityPlan } from "../src/core/ability.js";
import { trackSourceConditionReads } from "../src/compiler/source-condition-reader.js";
import { BattleGame } from "../src/core/battle.js";
import { WEB_SCRIPTED_BATTLE_ACTIONS } from "../src/core/scripted-battle-action.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { WEB_BATTLE_EVENT_CONTROLS } from "../src/core/battle-controls.js";
import { battleMessageProgram, battleMessageSessionFixture, messageRaw } from "./fixtures/battle-event-message.js";
import { compileDevelopmentAbility } from "../src/compiler/ability.js";
import { conditionBlindAbilityFixture } from "./fixtures/condition-blind.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { levitateFixture, levitateBattle } from "./fixtures/condition-levitate.js";

const noRng = () => assert.fail("Unexpected random draw");
const participant = (side: "enemy" | "player", ids: number[] = []): ActionParticipant => ({
  id: side, side, hp: 1000, maxHp: 1000, mp: 50, maxMp: 50, level: 10, attack: 40, magic: 20,
  physical: { attack: 40, strength: 30, accuracy: 100, criticalRate: 0 }, attackElements: [4],
  defense: 64, magicDefense: 64, evasion: 0, magicEvasion: 0, elementResistances: {}, conditionResistances: {}, conditionIds: ids,
});
const targeting: DevelopmentAbilityPlan["targeting"] = { life: "alive", relation: "enemy", modes: ["single"], defaultMode: "single", defaultRelation: "enemy", normalFormationOnly: false };
const magic = (elements: number[] = [4]): DevelopmentAbilityPlan => ({ targeting, effects: [{ kind: "magic", slot: 1 }],
  magic: { accuracy: 100, contentFlags: [1], forceDefense: false, elements }, physical: null });
const rows = { actor: "front" as const, target: "front" as const, ignoreActorPenalty: false, ignoreTargetPenalty: false };

test("Leviteto binds both real provider dictionaries and preserves source closure without ordinary application admission", () => {
  const f = levitateFixture(), before = structuredClone(f.tables), compiled = f.compile(), b = compiled.catalog.behaviors.find(b => b.id === 196)!;
  assert.equal(b.kind, "levitate"); assert.deepEqual(b.resistanceProvider, { groupId: 9311, conditions: {117: 1} });
  assert.deepEqual(compiled.providerBlockers, []);
  assert(compiled.sources.some(r => r.source.assetPath.endsWith("attribute_group.csv") && r.source.rowId === "12"));
  assert(compiled.sources.some(r => r.source.assetPath.endsWith("condition_group.csv") && r.source.rowId === "6"));
  assert.deepEqual(f.tables, before);
  for (const field of ["rate_value1", "parameter_group_id", "battle_effect_asset_id"]) {
    const row = structuredClone(f.reader().row("condition.csv", 196)); row.values[field] = "1";
    assert.equal(compileLevitateCondition(f.reader(), row, String, compiled.catalog.rules.definitions).behavior, null);
  }
  const field=new FieldConditions(compileFieldConditionCatalog(f.reader(),compiled.catalog,[101,106]).catalog);
  for(const id of [117,196])assert.throws(()=>field.validateActive([id]),/Unimplemented active field/);
  const engine=new BattleConditions(compiled.catalog);
  assert.throws(()=>projectUserConditionPhase({kind:"user-condition",slot:1,conditionId:117,conditionType:409,operation:"add",phase:"fixed-parameter",rawValues:[117,0,0]},"fixed-parameter",{id:"actor",conditionIds:[]},engine),/Leviteto owner lifecycle/);
  f.tables["attribute_group.csv"]![0]!.type_id = "1";
  assert.equal(f.compile().catalog.behaviors.some(b => b.id === 196), false);
});

test("initial compositions filter the physical master array, deduplicate membership, and require closed commuting owners", () => {
  const f = levitateFixture(), catalog = f.compile().catalog;
  const ids = [196, 194, 193, 195, 189, 110], group = f.group([...ids, 196]);
  const expected = f.tables["condition.csv"]!.filter(r => ids.includes(Number(r.id))).map(r => Number(r.id));
  assert.deepEqual(compileEnemyInitialConditions(f.reader(), group, catalog).conditionIds, expected);
  f.group([...ids].reverse()); assert.deepEqual(compileEnemyInitialConditions(f.reader(), group, catalog).conditionIds, expected);
  assert.throws(() => compileEnemyInitialConditions({ row:f.reader().row, group:f.reader().group }, group, catalog), /missing ordered/);
  const r = f.reader();
  assert.throws(() => compileEnemyInitialConditions({...r, ordered: table => r.ordered(table).slice(0,-1)}, group, catalog), /Missing ordered/);
  assert.throws(() => compileEnemyInitialConditions({...r, ordered: table => [...r.ordered(table),r.ordered(table)[0]!]}, group, catalog), /Duplicate ordered/);
  const changed = structuredClone(catalog); changed.behaviors.find(b => b.id === 194)!.resistanceProvider!.conditions = {123:1};
  assert.throws(() => compileEnemyInitialConditions(r, group, changed), /colliding providers/);
  f.group([196, 125]); assert.throws(() => compileEnemyInitialConditions(f.reader(), group, catalog), /noncommuting/);
});

test("late source templates keep their explicit initialization phase gate instead of inheriting initial support",()=>{
  const f=levitateFixture(),e=encounterRuntimeFixture(),group=f.group([196]);Object.assign(e.tables,f.tables);
  e.tables["monster.csv"]![0]!.initial_condition=String(group);
  const result=compileEnemyBattleDefinition(e.reader(),{enemy:e.input.encounters[0]!.enemies[0]!,entryPhase:"late",abilities:e.input.abilities,
    conditions:f.compile().catalog,sprites:e.input.sprites,name:e.input.name,parameters:e.input.parameters,physical:e.input.physical,formationPlan:null});
  assert.equal(result.definition,null);assert(result.diagnostics.some(d=>d.code==="enemy-initial-condition" && /late-entry initialization phase/.test(d.reason)));
});

test("ordered source reader retains exact master positions and detects changed enumeration", () => {
  const f = levitateFixture(), reader = f.reader(), physical = { file:"synthetic.bundle", sha256:"a".repeat(64), bytes:1 };
  let order = reader.ordered("condition.csv");
  const tracked = trackSourceConditionReads({...reader, ordered: () => order}, {sourceSetHash:"b".repeat(64),parentSourceSetHash:"c".repeat(64),battleSourceSetHash:"d".repeat(64),physicalSources:[physical]});
  tracked.reader.ordered!("condition.csv");
  assert.deepEqual(tracked.snapshot().orderedViews, [{table:"condition.csv",masterIds:order.map(r=>r.source.rowId)}]);
  assert.equal(tracked.snapshot().rows.length, order.length); order=[...order].reverse();
  assert.throws(() => tracked.reader.ordered!("condition.csv"), /ordered master view changed/);
});

test("element priority, ordinary same-type identity resistance and removal derive from the current enemy identity without mutating base", () => {
  const engine=new BattleConditions(levitateFixture().compile().catalog), base={4:1 as const,2:2 as const};
  assert.deepEqual(engine.effectiveElements([196],base,"enemy"), {4:3,2:2});
  assert.deepEqual(engine.effectiveElements([196],{4:4},"enemy"), {4:4});
  for(const fixed of [true,false]) assert.equal(engine.add([196],{},117,{accuracy:100,magicEvasion:0,fixed},noRng,"enemy").missed,true);
  const ids=engine.recover([196],[196]).currentIds;
  assert.deepEqual(engine.effectiveElements(ids,base,"enemy"),base); assert.deepEqual(base,{4:1,2:2});
  assert.deepEqual(engine.settleLife(0,[196],false),{hp:0,conditionIds:[5]});
  assert.deepEqual(engine.battleEnd([196,193,194,195]),[196]);
  const original = participant("enemy",[196]), actor = participant("player"), plan: DevelopmentAbilityPlan = {targeting,effects:[{kind:"physical",slot:1}],magic:null,physical:{normalAttack:true,multiplyPercent:null,contentFlags:[]}};
  const roll=[31,0,99];const projected=projectActionTarget(plan,0,actor,original,engine,()=>roll.shift()!,1,0,rows);
  assert.equal(projected.state.hp,1000);assert.equal(projected.effects[0]!.resource,"hp");
  const other={...actor,attackElements:[2]},nextRoll=[31,0,99];assert(projectActionTarget(plan,0,other,original,engine,()=>nextRoll.shift()!,1,0,rows).state.hp<1000);
  assert.throws(()=>engine.validateOwner([196],"player"),/renderer\/field/);
  assert.throws(()=>engine.add([],{},196,{accuracy:100,magicEvasion:0,fixed:true},noRng,"player"),/renderer\/field/);
  assert.throws(()=>engine.validateStableLife(10,[196]),/renderer\/field/);
});

test("magic exact source identities miss before ordinary hit and variance, while unrelated inputs retain original RNG",()=>{
  const engine=new BattleConditions(levitateFixture().compile().catalog), actor=participant("player"),target=participant("enemy",[196]);
  for(const id of [211,226,227]) {
    const result=projectActionTarget(magic([]),30,actor,target,engine,noRng,1,0,undefined,id);
    assert.deepEqual(result.effects,[{slot:1,resource:"hp",amount:0,missed:true,recovery:false}]); assert.equal(result.state.hp,1000);
  }
  const draws:number[][]=[]; const random=(a:number,b:number)=>{draws.push([a,b]);return a;};
  assert.equal(projectActionTarget(magic(),30,actor,target,engine,random,1).state.hp,1000);
  assert.deepEqual(draws,[[0,31]]);
  draws.length=0; assert(projectActionTarget(magic([2]),30,actor,target,engine,random,1,0,undefined,210).state.hp<1000);
  assert.deepEqual(draws,[[0,31]]);
  const invalid=magic(); invalid.magic!.contentFlags=[99];
  assert.throws(()=>projectActionTarget(invalid,30,actor,target,engine,noRng,1,0,undefined,211),/content flag/);
  assert.throws(()=>calculateMagic({abilityId:211,power:NaN,rules:magic().magic!,actor,target:{...target,conditionTypes:[409]},recovery:false,targetCount:1},noRng),/Invalid/);
});

test("closed multis preserve numeric, condition qualification, haste and poison under every permutation",()=>{
  const engine=new BattleConditions(levitateFixture().compile().catalog), actor=participant("player");
  for(const ids of [[193,194,196],[195,196],[189,196],[110,189]]) {
    const run=(current:number[])=>{
      const target=participant("enemy",current),rng=(min:number)=>min;
      const effect=projectActionTarget(magic([2]),30,actor,target,engine,rng,1);
      return {hp:effect.state.hp,types:engine.types(current).sort((a,b)=>a-b),speed:engine.speedPercent(current),
        resistance:engine.effectiveResistances(current,{},"enemy"),elements:engine.effectiveElements(current,{},"enemy"),
        after:engine.battleEnd(current).sort((a,b)=>a-b),poison:engine.reconcilePoisonState(current,[],1)};
    };
    assert.deepEqual(run(ids),run([...ids].reverse()));
  }
});

function battle(abilityId=10,element=4){
  const {content}=levitateBattle();
  if(abilityId!==10){const a=structuredClone(content.abilities[10]!); a.id=abilityId;a.program.abilityId=abilityId;content.abilities[abilityId]=a;
    content.players[0]!.abilities.push(abilityId);content.commands[100]!.abilityIds.push(abilityId);}
  content.abilities[abilityId]!.plan!.magic!.elements=[element];
  return content;
}
function resolve(b:BattleGame){for(let n=0;n<50 && !b.action?.results.length;n++)b.advance(20);assert(b.action?.results.length);}

test("actual BattleGame ordinary and scripted commands use the same live immunity and exact miss boundary",()=>{
  for(const id of [10,211,226,227]){
    const c=battle(id,id===10?4:2),b=new BattleGame(c,314);
    assert(b.command(b.players[0]!.id,id,b.enemies[0]!.id));resolve(b);
    assert.equal(b.enemies[0]!.hp,1000);assert.equal(b.action!.results[0]!.effects[0]!.missed,id!==10);
  }
  const c=battle(211,2);c.lifecycle={kind:"battle-lifecycle-v1",mode:"script",scriptId:9000,program:battleMessageProgram([messageRaw("Wait",.001),messageRaw("Exit")])};
  c.lifecycle.program.instructions[0]!.op={kind:"script-action",sourceActorKind:1,sourceTargetKind:2,asynchronous:true,
    actor:{side:"player",id:1000},target:{side:"enemy",id:1},abilityId:211};
  const b=new BattleGame(c,5,undefined,undefined,undefined,undefined,undefined,undefined,{scriptedActions:WEB_SCRIPTED_BATTLE_ACTIONS});resolve(b);
  assert.equal(b.action!.results[0]!.effects[0]!.missed,true);assert.equal(b.enemies[0]!.hp,1000);
});

test("player initial lifecycle is rejected and a same-frame later target failure restores RNG, MP and all targets",()=>{
  const c=battle();c.players[0]!.conditionIds=[196];assert.throws(()=>new BattleGame(c,1),/renderer\/field/);
  const good=battle(10,2);good.abilities[10]!.cost=2;const bad=structuredClone(good);
  for(const c of [good,bad]){const a=c.abilities[10]!;a.plan!.targeting=compileTargetRule(4,3)!;a.program.range=4;}
  const b=new BattleGame(bad,314),clean=new BattleGame(good,314);
  assert(b.command(b.players[0]!.id,10,{kind:"side",side:"enemy"}));assert(clean.command(clean.players[0]!.id,10,{kind:"side",side:"enemy"}));
  b.advance(400);clean.advance(400);b.enemies[1]!.elementResistances={4:9} as never;const before=JSON.stringify(b.combatants),queue=JSON.stringify(b.pendingActions);
  assert.throws(()=>b.advance(10),/elemental resistance/);assert.equal(JSON.stringify(b.combatants),before);assert.equal(JSON.stringify(b.pendingActions),queue);
  b.enemies[1]!.elementResistances={};b.advance(0);clean.advance(10);
  assert.deepEqual(b.action?.results,clean.action?.results);assert.deepEqual(b.combatants,clean.combatants);
});

test("unclosed player application stays blocked in the source compiler and before actual battle publication",()=>{
  const f=levitateFixture(),ability=conditionBlindAbilityFixture();Object.assign(ability.tables,f.tables);
  for(const id of [117,196]){ability.group.function1_value1=String(id);assert.equal(compileDevelopmentAbility(ability.reader(),801,"unclosed float").plan,null);}
  const c=battle(),a=c.abilities[11]!;a.plan!.effects=[{kind:"add-condition",slot:1,conditionId:117,accuracy:100,fixedHit:true}];
  const b=new BattleGame(c,2);assert(b.command("a",11,"b"));b.advance(400);
  const before={units:structuredClone(b.combatants),action:structuredClone(b.action),queue:b.pendingActions,time:b.time,events:structuredClone(b.events)};
  assert.throws(()=>b.advance(10),/renderer\/field/);
  assert.deepEqual({units:b.combatants,action:b.action,queue:b.pendingActions,time:b.time,events:b.events},before);
});

test("actual counter and random-derived child retain their own source ability identity at the common miss boundary",()=>{
  const c=battle(211,2),counter=c.abilities[211]!;counter.program.range=5;counter.plan!.targeting=compileTargetRule(5,3)!;
  c.enemies[0]!.abilities=[13,211];c.enemies[0]!.ai=syntheticAI([["Nop"],["SyncAI"],["StartTable",[0]],
    ["CounterActReceiveCommand",[3,211],[0,100]],["Act",[13],[100]],["EndTable"],["JumpBattleAI",[0]]]);
  const b=new BattleGame(c,941);assert(b.command("a",10,"e1"));b.advance(410);assert(b.pendingActions.some(a=>a.kind==="counter"));b.advance(920);
  assert.equal(b.action!.kind,"counter");assert.equal(b.action!.source.id,211);assert.equal(b.action!.results[0]!.effects[0]!.missed,true);
  const d=battle(211,2),child=d.abilities[211]!;child.program.range=5;child.plan!.targeting=compileTargetRule(5,3)!;
  const parent=structuredClone(child);parent.id=900;parent.program.abilityId=900;parent.power=0;parent.plan!.effects=[{
    kind:"random-ability",slot:1,rawValues:[46,0,1],groupId:46,fallbackAbilityId:0,retarget:true,
    rows:[{rowId:1,abilityId:211,invocationRate:100,conditionGroupId:0,conditionIds:[]}],primaryResult:{hitType:0,value:0},
    child:{actType:5,useType:1,commandId:null,armType:0,actAbilityType:0,continuousCommandCount:1,isCounter:false}}];
  d.abilities[900]=parent;d.enemies[0]!.abilities=[900,211];d.enemies[0]!.ai=syntheticAI([["Nop"],["SyncAI"],["StartTable",[0]],["Act",[900],[100]],["EndTable"],["JumpBattleAI",[0]]]);
  d.initialAtb.enemy=[100,100];const derived=new BattleGame(d,951);derived.advance(410);assert(derived.pendingActions.some(a=>a.kind==="derived"));
  derived.advance(920);assert.equal(derived.action!.kind,"derived");assert.equal(derived.action!.source.id,211);assert.equal(derived.action!.results[0]!.effects[0]!.missed,true);assert.equal(derived.enemies[0]!.hp,1000);
});

test("real Session forced discard, failed/cancelled handoff, stable save/load and a second battle never persist enemy conditions",async()=>{
  const p=battleMessageProgram([messageRaw("Wait",.02),messageRaw("BattleForceExit"),messageRaw("Wait",.02),messageRaw("Exit")]),f=battleMessageSessionFixture(p),c=levitateBattle().content;
  f.battle.common.conditions=c.conditions;for(const e of f.battle.encounters[1000]!.enemies){e.conditionIds=[196];e.hp=1000;e.ai=null;e.abilities=[];}
  const runtime={...f.runtime,battleEventControls:WEB_BATTLE_EVENT_CONTROLS},game=new GameSession(f.field,f.battle,314,runtime),flow=new GameFlow(game),ready={visible:true,mediaReady:true,overlayOpen:false};
  flow.start();flow.advance(0,ready);assert(game.field.startEvent("fight"));flow.advance(10,ready);assert(game.prepareBattleStart()!.commit());
  const owned=game.state.snapshot();game.advance(40);assert.equal(game.battle!.phase,"forced");assert(game.battle!.enemies.every(e=>e.conditionIds.includes(196)));
  const candidate=game.prepareBattleReturn()!;candidate.discard();assert.deepEqual(game.state.snapshot(),owned);
  let fail=true;const handoff=new GameBattleHandoff(flow,{async prepareStart(){return null;},async prepareReturn(){if(fail)throw Error("fixture refusal");return null;},discard(){}});
  assert.equal((await handoff.return()).status,"failed");assert.deepEqual(game.state.snapshot(),owned);fail=false;assert.equal((await handoff.return()).status,"committed");
  game.advance(10);assert(game.state.snapshot().roster.every(p=>!p.conditionIds.includes(196)));
  const values=new Map<string,string>(),storage=new CheckpointStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}});
  await storage.save(game.checkpoint(),1000);const saved=(await storage.load())!;const restored=GameSession.restore(saved.checkpoint,f.field,game.battleCatalog,undefined,runtime);
  assert.deepEqual(restored.checkpoint(),saved.checkpoint);assert(restored.field.startEvent("fight"));restored.advance(10);assert(restored.prepareBattleStart()!.commit());
  assert(restored.battle!.enemies.every(e=>e.conditionIds.includes(196)));restored.advance(40);assert(restored.prepareBattleReturn()!.commit());assert.equal(restored.state.snapshot().completedBattles.length,2);
});
