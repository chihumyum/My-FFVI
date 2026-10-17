import test from "node:test";
import assert from "node:assert/strict";
import { compileSourceEnemyMpParameter } from "../src/compiler/source-enemy-mp-parameter.js";
import { BattleEnemyMpParameters, parseSourceEnemyMpParameter } from "../src/core/source-enemy-mp-parameter.js";
import { battleTableIndex } from "../src/compiler/battle.js";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { absorptionContent } from "./fixtures/resource-absorption.js";
import { sourceFinalReady } from "../src/core/battle-final-attack.js";
import { compileEnemyBattleDefinition } from "../src/compiler/enemy-battle-definition.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";

const parameter = (sourceId: number, isUnableMP: boolean) =>
  ({ kind: "source-enemy-mp-parameter-v1" as const, sourceId, isUnableMP });
function source() {
  const tables = { "monster.csv": [{ id: "7001", monster_flag_group_id: "9001" }],
    "monster_flag_group.csv": [{ id: "8001", group_id: "9001", monster_flag_id: "2" },
      { id: "8002", group_id: "9001", monster_flag_id: "4" }] };
  const sources = Object.fromEntries(Object.keys(tables).map(table => [table,
    { file: "authored.bundle", serializedFile: "authored", assetPath: "Authored/" + table, objectId: "9007199254740997" }]));
  return { tables, sources, reader: () => battleTableIndex(tables, sources) };
}
test("source constructor flag4 is independent of undead; empty, changed and missing groups retain complete identity", () => {
  const f = source(), yes = compileSourceEnemyMpParameter(f.reader(), 7001);
  assert.deepEqual(yes.metadata, parameter(7001, true));
  assert.deepEqual(yes.sources.map(row => row.source.rowId), ["7001", "8001", "8002"]);
  f.tables["monster_flag_group.csv"].pop(); assert.equal(compileSourceEnemyMpParameter(f.reader(), 7001).metadata.isUnableMP, false);
  f.tables["monster.csv"][0]!.monster_flag_group_id = "0";
  assert.equal(compileSourceEnemyMpParameter(f.reader(), 7001).metadata.isUnableMP, false);
  f.tables["monster.csv"][0]!.monster_flag_group_id = "9001"; f.tables["monster_flag_group.csv"] = [];
  assert.throws(() => compileSourceEnemyMpParameter(f.reader(), 7001), /group/);
  f.sources["monster.csv"]!.assetPath = "Authored/character_status.csv";
  assert.throws(() => compileSourceEnemyMpParameter(f.reader(), 7001), /Unbound/);
});
test("exact metadata and actual objects fence side, source, replacement, mutation and rollback; absent is unknown", () => {
  for (const raw of [undefined, {}, { ...parameter(1, false), sourceId: 2 }, { ...parameter(1, false), authority: true }])
    assert.throws(() => parseSourceEnemyMpParameter(raw, 1), /binding/);
  const unit = { sourceId: 1, side: "enemy" as const, mpParameter: parameter(1, false) }, owner = new BattleEnemyMpParameters<typeof unit>();
  owner.bind(unit); assert.equal(owner.query(unit, true), false);
  assert.throws(() => owner.query({ ...unit }, true), /actual IsUnableMP/);
  const before = owner.snapshot(); owner.retire(unit); assert.throws(() => owner.query(unit, true), /actual IsUnableMP/);
  owner.restore(before); assert.equal(owner.query(unit, true), false);
  unit.mpParameter.isUnableMP = true; assert.throws(() => owner.query(unit), /Changed/);
  const player = { sourceId: 1, side: "player" as const, mpParameter: parameter(1, false) };
  assert.throws(() => new BattleEnemyMpParameters<typeof player>().bind(player), /player override/);
  assert.throws(() => new BattleEnemyMpParameters().query({ sourceId: 1, side: "enemy" }, true), /actual IsUnableMP/);
});
function finalContent(bit?: boolean, mp = 3) {
  const c = fixture(), a = structuredClone(c.abilities[11]!);
  Object.assign(a, { id: 601, name: "Authored MP Final", power: 1, cost: 3, wait: 0 });
  a.program.abilityId = 601; a.program.range = 3; a.plan!.targeting = compileTargetRule(3, 3)!;
  a.plan!.effects = [{ slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" }]; a.plan!.magic = null;
  c.abilities[601] = a; c.players.forEach(p => p.hp = 2000);
  c.enemies.forEach((e, i) => { Object.assign(e, { sourceId: 41 + i, hp: 10, mp, agility: 0, abilities: [13, 601],
    ai: syntheticAI([["Nop"], ["SyncAI"], ["StartTable", [0]], ["FinalAttackAct", [601], [100]], ["Act", [13]], ["EndTable"], ["JumpBattleAI", [0]]]) });
    if (bit !== undefined) e.mpParameter = parameter(e.sourceId, bit);
  }); return c;
}
const snap = (b: BattleGame) => structuredClone({ units: b.combatants, pending: b.pendingActions, action: b.action,
  final: b.finalAttackExecution, events: b.events, time: b.time, random: Reflect.get(b, "randomState") });
for (const bit of [false, true]) test(`actual Final fee-to-zero keeps poison and exact tickets until drain, bit=${bit}`, () => {
  const c = finalContent(bit); c.conditions.rules.definitions.push({ id: 310, type: 10, overlapped: false, eraseGroupId: 3 });
  c.conditions.behaviors.push({ id: 310, kind: "poison", name: "Poison", untilType: 3, hpDivisor: 16 }); c.enemies[0]!.conditionIds = [310];
  const b = new BattleGame(c, 233); assert(b.command("a", 10, "e1")); b.advance(410);
  assert.equal(b.finalAttackExecution.length, 1); assert(!b.enemies[0]!.conditionIds.includes(305));
  b.advance(910); assert.equal(b.enemies[0]!.mp, 0); assert.equal(b.finalAttackExecution.length, 1);
  assert(b.enemies[0]!.conditionIds.includes(310)); assert(!b.enemies[0]!.conditionIds.includes(305));
  b.advance(500); assert.deepEqual(b.finalAttackExecution, []); assert(b.enemies[0]!.conditionIds.includes(305));
  assert(!b.enemies[0]!.conditionIds.includes(310));
});
test("legacy Final MP0 remains reached unknown with whole parent action rollback", () => {
  const b = new BattleGame(finalContent(), 223); assert(b.command("a", 10, "e1")); b.advance(400); const before = snap(b);
  assert.throws(() => b.advance(10), /actual IsUnableMP/); assert.deepEqual(snap(b), before);
});
test("fresh MP0 on legacy/false stays alive, proved true uses the same death and condition owner", () => {
  for (const bit of [undefined, false, true]) {
    const c = fixture(); c.enemies[0]!.mp = 0;
    if (bit !== undefined) c.enemies[0]!.mpParameter = parameter(c.enemies[0]!.sourceId, bit);
    const b = new BattleGame(c, 401); assert.equal(b.enemies[0]!.hp === 0, bit === true);
    assert.equal(b.enemies[0]!.conditionIds.includes(305), bit === true);
  }
});
test("ordinary enemy fee uses the joint caster life projection, without granting player or legacy MP death", () => {
  for (const bit of [undefined, false, true]) {
    const c = fixture(); c.enemies = c.enemies.slice(0, 1); c.enemies[0]!.hp = 200; c.enemies[0]!.mp = 3;
    if (bit !== undefined) c.enemies[0]!.mpParameter = parameter(c.enemies[0]!.sourceId, bit);
    c.initialAtb.enemy = [100, 100]; c.abilities[13]!.cost = 3; const b = new BattleGame(c, 409);
    b.advance(1000); assert.equal(b.enemies[0]!.mp, 0); assert.equal(b.enemies[0]!.hp === 0, bit === true);
  }
});
for (const bit of [false, true]) test(`MP absorption shares target/caster transaction and current-resource death, bit=${bit}`, () => {
  const c = absorptionContent("mp"); c.enemies[0]!.mp = 3;
  c.enemies[0]!.mpParameter = parameter(c.enemies[0]!.sourceId, bit); const b = new BattleGame(c, 314);
  b.players[0]!.mp = 3; assert(b.command("a", 901, "e1")); b.advance(410);
  assert.equal(b.enemies[0]!.mp, 0); assert.equal(b.players[0]!.mp, 4);
  assert.equal(b.enemies[0]!.hp === 0, bit); assert.equal(b.enemies[0]!.conditionIds.includes(305), bit);
});
test("MP-only Final is a qualified targeted ticket; stale parameter fails before joint absorption/payment/RNG commit", () => {
  for (const mode of ["phase", "stale"] as const) {
    const c = absorptionContent("mp"); c.enemies[0]!.mp = 3; c.enemies[0]!.mpParameter = parameter(c.enemies[0]!.sourceId, true);
    if (mode === "phase") c.enemies[0]!.ai = finalContent(true).enemies[0]!.ai;
    if (mode === "phase") { c.enemies[0]!.abilities.push(601); c.abilities[601] = finalContent(true).abilities[601]!; }
    const b = new BattleGame(c, 314); b.players[0]!.mp = 3; assert(b.command("a", 901, "e1")); b.advance(400);
    if (mode === "stale") b.enemies[0]!.mpParameter!.isUnableMP = false;
    const before = snap(b);
    if (mode === "phase") {
      b.advance(10); assert.equal(b.enemies[0]!.hp, 200); assert.equal(b.enemies[0]!.mp, 0);
      assert.equal(b.finalAttackExecution.length, 1); assert(!b.enemies[0]!.conditionIds.includes(305));
      assert.equal(b.canUse("e1",13),false); assert.equal(b.enemies[0]!.atb,0);
      b.advance(1600); assert(b.enemies[0]!.conditionIds.includes(305)); assert.equal(b.enemies[0]!.hp, 0);
    } else { assert.throws(() => b.advance(10), /Changed actual/); assert.deepEqual(snap(b), before); }

  }
});
test("MP-zero constructor, ordinary fee and condition clocks never manufacture a targeted Final ticket", () => {
  for (const mode of ["initial", "fee", "clock"] as const) {
    const c = finalContent(true, mode === "initial" ? 0 : 3); c.enemies = c.enemies.slice(0, 1);
    if (mode === "fee") { c.initialAtb.enemy = [100, 100]; c.abilities[13]!.cost = 3; }
    const b = new BattleGame(c, 419);
    if (mode === "clock") b.enemies[0]!.mp = 0;
    b.advance(mode === "fee" ? 1000 : 10);
    assert.equal(b.enemies[0]!.hp, 0); assert(b.enemies[0]!.conditionIds.includes(305));
    assert.deepEqual(b.finalAttackExecution, []); assert(!b.pendingActions.some(action => action.kind === "final"));
  }
});
test("MP Final drains using current HP/MP; resource recovery before registration is not type5 removal", () => {
  const c = absorptionContent("mp"); c.enemies[0]!.mp = 3; c.enemies[0]!.mpParameter = parameter(c.enemies[0]!.sourceId, true);
  c.enemies[0]!.ai = finalContent(true).enemies[0]!.ai; c.enemies[0]!.abilities.push(601);
  c.abilities[601] = finalContent(true).abilities[601]!; c.abilities[601]!.cost = 0;
  const b = new BattleGame(c, 314); b.players[0]!.mp = 3; assert(b.command("a", 901, "e1")); b.advance(1320);
  assert.equal(b.enemies[0]!.mp, 0); assert(b.enemies[0]!.hp > 0); assert.equal(b.finalAttackExecution.length, 1);
  b.enemies[0]!.mp = 1; b.advance(600);
  assert.deepEqual(b.finalAttackExecution, []); assert(b.enemies[0]!.hp > 0); assert(!b.enemies[0]!.conditionIds.includes(305));
});
test("MP Final keeps the same miss, incoming-interrupt, primary-result and explicit-type5 exclusions", () => {
  const input = { hp: 12, mpUnableFight: true, conditionTypes: [] as number[], incomingInterrupt: false, primarySlot: 1,
    effects: [{ slot: 1, resource: "mp" as const, recovery: false, amount: 3, missed: false }] };
  assert(sourceFinalReady(input)); assert(!sourceFinalReady({ ...input, mpUnableFight: false }));
  assert(!sourceFinalReady({ ...input, incomingInterrupt: true }));
  assert(!sourceFinalReady({ ...input, effects: [{ ...input.effects[0]!, missed: true }] }));
  for (const type of [5, 659, 660, 502]) assert(!sourceFinalReady({ ...input, conditionTypes: [type] }));
});

test("self-target Hit cannot manufacture MP Final from its parent's later fee", () => {
  const c = finalContent(true); c.enemies = c.enemies.slice(0, 1); c.initialAtb.enemy = [100, 100];
  c.abilities[601]!.program.range = 5; c.abilities[601]!.plan!.targeting = compileTargetRule(5, 3)!;
  c.enemies[0]!.ai = syntheticAI([["Nop"], ["SyncAI"], ["StartTable", [0]], ["FinalAttackAct", [601], [100]],
    ["Act", [601]], ["EndTable"], ["JumpBattleAI", [0]]]);
  const b = new BattleGame(c, 457); b.advance(1000);
  assert.equal(b.enemies[0]!.mp, 0); assert.equal(b.enemies[0]!.hp, 0);
  assert(b.enemies[0]!.conditionIds.includes(305)); assert.deepEqual(b.finalAttackExecution, []);
  assert(!b.pendingActions.some(action => action.kind === "final"));
});
test("known MP-death caster self MP plus fee keeps a reached order gate and rolls back the whole frame", () => {
  const c = finalContent(true); c.enemies = c.enemies.slice(0, 1); c.initialAtb.enemy = [100, 100];
  c.abilities[601]!.program.range = 5; c.abilities[601]!.plan!.targeting = compileTargetRule(5, 3)!;
  c.abilities[601]!.plan!.effects = [{ slot: 1, kind: "recovery", resource: "mp", calculation: "fixed" }];
  c.enemies[0]!.ai = syntheticAI([["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [601]], ["EndTable"], ["JumpBattleAI", [0]]]);
  const b = new BattleGame(c, 461); b.advance(400); const before = snap(b);
  assert.throws(() => b.advance(10), /positive-fee MP self-write order/); assert.deepEqual(snap(b), before);
});
test("shared initial/late enemy compiler exposes the precise MP fee phase without granting legacy metadata", () => {
  for (const bit of [undefined, false, true]) {
    const f = encounterRuntimeFixture(), enemy = f.input.encounters[0]!.enemies[0]!, ability = f.input.abilities[13]!;
    if (bit !== undefined) {
      f.tables["monster.csv"]![0]!.monster_flag_group_id = bit ? "9001" : "0";
      f.tables["monster_flag_group.csv"] = [{ id: "8001", group_id: "9001", monster_flag_id: "4" }];
    }
    ability.cost = 3; ability.program.range = 5; ability.plan!.targeting = compileTargetRule(5, 1)!;
    ability.plan!.effects = [{ slot: 1, kind: "recovery", resource: "mp", calculation: "fixed" }];
    for (const entryPhase of ["initial", "late"] as const) {
      const result = compileEnemyBattleDefinition(f.reader(), { enemy, entryPhase, abilities: f.input.abilities,
        conditions: f.input.conditions, sprites: f.input.sprites, name: f.input.name,
        parameters: f.input.parameters, physical: f.input.physical, formationPlan: null });
      assert(result.definition, JSON.stringify(result.diagnostics));
      assert.equal(result.diagnostics.some(d => d.kind === "runtime-dependency" && d.code === "enemy-mp-fee-phase"), bit === true);
      assert.equal(result.definition.mpParameter?.isUnableMP, bit);
    }
  }
});
