import test from "node:test";
import assert from "node:assert/strict";
import { projectBattleDrops, validateBattleDropCatalog, type BattleDropCatalog } from "../src/core/battle-rewards.js";
import { compileBattleDropCatalog } from "../src/compiler/battle-rewards.js";
import { battleTableIndex } from "../src/compiler/battle.js";

function catalog(): BattleDropCatalog {
  return { kind: "battle-drops-v1", weights: [88, 12, 0, 0, 0, 0, 0, 0],
    monsters: [{ id: 10, rate: 12, slots: [{ contentId: 20, count: 1 }, { contentId: 21, count: 2 },
      ...Array.from({ length: 6 }, () => ({ contentId: 0, count: 0 }))] }],
    contents: [{ id: 20, kind: "item" }, { id: 21, kind: "equipment" }] };
}
function draws(values: number[]) {
  const calls: [number, number][] = [];
  return { calls, random: (min: number, max: number) => {
    calls.push([min, max]);
    const value = values.shift();
    assert.notEqual(value, undefined, "Unexpected extra reward draw");
    return value!;
  } };
}

test("overall monster drop chance is independent of its weighted content selection", () => {
  const c = catalog(), miss = draws([12]);
  assert.deepEqual(projectBattleDrops(c, [10], miss.random).grants, []);
  assert.deepEqual(miss.calls, [[0, 99]]);
  const common = draws([11, 87]);
  assert.deepEqual(projectBattleDrops(c, [10], common.random).grants,
    [{ kind: "grant-item", id: 20, count: 1 }]);
  assert.deepEqual(common.calls, [[0, 99], [0, 99]]);
  const rare = draws([0, 88]);
  const plan = projectBattleDrops(c, [10], rare.random);
  assert.equal(plan.rolls[0]!.slot, 1);
  assert.deepEqual(plan.grants, [{ kind: "grant-equipment", id: 21, count: 2 }]);
});

test("zero and full drop rates still consume their unconditional chance draw", () => {
  const c = catalog();
  c.monsters[0]!.rate = 0;
  const never = draws([0]);
  assert.deepEqual(projectBattleDrops(c, [10], never.random).drops, []);
  assert.equal(never.calls.length, 1);
  c.monsters[0]!.rate = 100;
  const always = draws([99, 99]);
  assert.equal(projectBattleDrops(c, [10], always.random).rolls[0]!.contentId, 21);
  assert.equal(always.calls.length, 2);
});

test("repeated registrations stay ordered and aggregate only matching content", () => {
  const c = catalog();
  c.monsters[0]!.rate = 100;
  c.monsters.push({ ...structuredClone(c.monsters[0]!), id: 11 });
  const input = [11, 10, 11], before = structuredClone(c);
  const stream = draws([50, 99, 50, 0, 50, 99]);
  const plan = projectBattleDrops(c, input, stream.random);
  assert.deepEqual(plan.registrations, input);
  assert.deepEqual(plan.rolls.map((r) => r.monsterId), [11, 10, 11]);
  assert.deepEqual(plan.drops, [{ id: 21, kind: "equipment", count: 4 }, { id: 20, kind: "item", count: 1 }]);
  assert.deepEqual(c, before);
  plan.registrations.push(123);
  plan.grants[0]!.count = 55;
  assert.deepEqual(input, [11, 10, 11]);
  assert.equal(plan.drops[0]!.count, 4);
});

test("successful empty slots do not reroll and all eight source slots are honored", () => {
  const c = catalog();
  c.monsters[0]!.rate = 100;
  c.weights = [0, 0, 0, 0, 0, 0, 0, 7];
  const empty = draws([0, 6]);
  const plan = projectBattleDrops(c, [10], empty.random);
  assert.deepEqual(plan.grants, []);
  assert.equal(plan.rolls[0]!.slot, 7);
  assert.deepEqual(empty.calls, [[0, 99], [0, 6]]);
  c.monsters[0]!.slots[7] = { contentId: 21, count: 3 };
  assert.deepEqual(projectBattleDrops(c, [10], draws([99, 0]).random).grants,
    [{ kind: "grant-equipment", id: 21, count: 3 }]);
});

test("all enemy identities are checked before advancing reward RNG", () => {
  let count = 0;
  assert.throws(() => projectBattleDrops(catalog(), [10, 404], () => { count++; return 0; }), /registered monster/);
  assert.equal(count, 0);
  assert.deepEqual(projectBattleDrops(catalog(), [], () => { throw new Error("Unexpected draw"); }).drops, []);
});

test("unresolved reachable content cannot be hidden behind a favorable random seed", () => {
  const c = catalog();
  c.monsters[0]!.slots[1]!.contentId = 999;
  let count = 0;
  assert.throws(() => projectBattleDrops(c, [10], () => { count++; return 99; }), /reachable/);
  assert.equal(count, 0);
  c.weights = [100, 0, 0, 0, 0, 0, 0, 0];
  validateBattleDropCatalog(c);
  c.weights[1] = 1;
  c.monsters[0]!.rate = 0;
  validateBattleDropCatalog(c);
});

test("catalog rejects zero weights, duplicate identities, Gil masquerading and nonpositive grants", () => {
  const mutations: ((c: BattleDropCatalog) => void)[] = [
    (c) => { c.weights.fill(0); },
    (c) => { c.weights[0] = -1; },
    (c) => { c.monsters.push(structuredClone(c.monsters[0]!)); },
    (c) => { c.contents.push(structuredClone(c.contents[0]!)); },
    (c) => { c.contents[0]!.id = 1; },
    (c) => { c.monsters[0]!.slots[0]!.count = 0; },
    (c) => { c.monsters[0]!.rate = 101; },
  ];
  for (const mutate of mutations) {
    const c = catalog(); mutate(c);
    assert.throws(() => validateBattleDropCatalog(c));
  }
  assert.throws(() => projectBattleDrops(catalog(), [10], () => 100), /random draw/);
});

test("reward selection preserves rolled quantity for owned capacity handling", () => {
  const c = catalog();
  c.monsters[0]!.slots[0]!.count = 150;
  assert.equal(projectBattleDrops(c, [10, 10], draws([0, 0, 0, 0]).random).grants[0]!.count, 300);
  c.monsters[0]!.slots[0]!.count = 0x7fffffff;
  assert.throws(() => projectBattleDrops(c, [10, 10], draws([0, 0, 0, 0]).random), /overflow/);
});

function fixture() {
  const monster: Record<string, string> = { id: "10", drop_rate: "12" };
  for (let i = 1; i <= 8; i++) {
    monster[`drop_content_id${i}`] = i === 1 ? "20" : i === 2 ? "21" : "0";
    monster[`drop_content_id${i}_value`] = i <= 2 ? "1" : "0";
  }
  const tables: Record<string, Record<string, string>[]> = {
    "game_constant_int.csv": [88, 12, 0, 0, 0, 0, 0, 0].map((value, i) =>
      ({ id: String(i + 1), key_name: `MONSTER_DROP_RATE_${i + 1}`, value1: String(value), value2: "0" })),
    "monster.csv": [monster],
    "content.csv": [{ id: "20", type_id: "1", type_value: "100" }, { id: "21", type_id: "2", type_value: "200" }],
    "item.csv": [{ id: "100", type_id: "1" }],
    "weapon.csv": [{ id: "200", type_id: "1" }], "armor.csv": [],
  };
  const sources = Object.fromEntries(Object.keys(tables).map((table) => [table,
    { file: "synthetic", assetPath: table, objectId: "90071992547409931", serializedFile: "synthetic" }]));
  return { tables, monster, reader: () => battleTableIndex(tables, sources) };
}

test("compiler binds source quantities, ownership kind and exact table provenance", () => {
  const f = fixture(), result = compileBattleDropCatalog(f.reader(), [10]);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.catalog.weights, [88, 12, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(result.catalog.contents, [{ id: 20, kind: "item" }, { id: 21, kind: "equipment" }]);
  assert.ok(result.sources.some((s) => s.assetPath === "weapon.csv" && s.rowId === "200"));
  assert.ok(result.sources.every((s) => s.objectId === "90071992547409931"));
});

test("compiler reports unsupported monsters without discarding other definitions", () => {
  const f = fixture();
  f.tables["monster.csv"]!.push({ ...f.monster, id: "11", drop_content_id2: "999" });
  const result = compileBattleDropCatalog(f.reader(), [10, 11]);
  assert.deepEqual(result.catalog.monsters.map((m) => m.id), [10]);
  assert.equal(result.blockers[0]!.monsterId, 11);
  assert.match(result.blockers[0]!.reason, /content.csv:999/);
  assert.throws(() => projectBattleDrops(result.catalog, [11], () => 99), /registered/);
});

test("unreachable source slots do not invent ownership dependencies", () => {
  const f = fixture();
  f.monster.drop_content_id8 = "999"; f.monster.drop_content_id8_value = "1";
  assert.equal(compileBattleDropCatalog(f.reader(), [10]).blockers.length, 0);
  f.monster.drop_content_id2 = "999";
  assert.equal(compileBattleDropCatalog(f.reader(), [10]).blockers.length, 1);
  f.monster.drop_rate = "0";
  const result = compileBattleDropCatalog(f.reader(), [10]);
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(result.catalog.contents, []);
});

test("duplicate source aliases and empty equipment remain explicit admission blockers", () => {
  const f = fixture();
  f.tables["content.csv"]!.push({ id: "22", type_id: "2", type_value: "200" });
  assert.match(compileBattleDropCatalog(f.reader(), [10]).blockers[0]!.reason, /Ambiguous/);
  f.tables["content.csv"]!.pop();
  f.tables["weapon.csv"]![0]!.type_id = "0";
  assert.match(compileBattleDropCatalog(f.reader(), [10]).blockers[0]!.reason, /empty/);
  f.tables["weapon.csv"]![0]!.type_id = "1";
  f.tables["content.csv"]![1]!.type_id = "7";
  assert.match(compileBattleDropCatalog(f.reader(), [10]).blockers[0]!.reason, /type 7/);
});
