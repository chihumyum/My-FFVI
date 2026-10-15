import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { compileEnemyInitialConditions } from "../src/compiler/initial-conditions.js";
import { compileProtectionCondition, hasProtectionBehavior } from "../src/compiler/protection.js";
import { projectActionTarget, type ActionParticipant } from "../src/core/action-effects.js";
import { initialProtectionFixture } from "./fixtures/initial-protection.js";

const noRng = () => assert.fail("Unexpected random draw");
const hit = { accuracy: 100, magicEvasion: 0, fixed: false };

test("both protection families preserve active identity and bind their distinct resistance providers", () => {
  const f = initialProtectionFixture(), result = f.compile(), engine = new BattleConditions(result.catalog);
  assert.deepEqual(engine.types([193, 194]), [19, 412]);
  assert.deepEqual(result.catalog.behaviors.find((b) => b.id === 193), {
    id: 193, kind: "physical-protection", name: "STATE_193", untilType: 2,
    resistanceProvider: { groupId: 908, conditions: { 123: 1 } },
  });
  assert.equal(hasProtectionBehavior(f.reader().row("condition.csv", 193)), false);
  assert.deepEqual(engine.effectiveResistances([193, 194], {}), { 123: 1, 122: 1 });
  assert.ok(result.sources.some((row) => row.source.assetPath.endsWith("condition_group.csv") && row.values.id === "11"));
  assert.deepEqual(result.providerBlockers, []);
});

test("active protection rejects ordinary and fixed application of its referenced condition without RNG", () => {
  const engine = new BattleConditions(initialProtectionFixture().compile().catalog);
  for (const [current, incoming] of [[193, 123], [194, 122]] as const) {
    for (const fixed of [false, true]) {
      const before = [current];
      assert.deepEqual(engine.add(before, {}, incoming, { ...hit, fixed }, noRng, "enemy"),
        { currentIds: before, added: [], removed: [], missed: true });
      assert.deepEqual(before, [current]);
    }
    assert.deepEqual(engine.recover([current], [incoming]).currentIds, [current]);
  }
});

test("removal, death and battle end remove the temporary provider rather than changing base resistance", () => {
  const engine = new BattleConditions(initialProtectionFixture().compile().catalog), base = { 123: 0, 6: 1 };
  assert.deepEqual(engine.effectiveResistances([193], base, "enemy"), { 123: 1, 6: 1 });
  assert.equal(engine.add([193], base, 123, { ...hit, fixed: true }, noRng, "enemy").missed, true);
  const after = engine.recover([193], [193]).currentIds;
  assert.deepEqual(after, []);
  assert.deepEqual(engine.effectiveResistances(after, base, "enemy"), base);
  assert.deepEqual(engine.add(after, base, 123, { ...hit, fixed: true }, noRng, "enemy").currentIds, [123]);
  assert.deepEqual(engine.settleLife(0, [53, 193, 194], false), { hp: 0, conditionIds: [53, 5] });
  assert.deepEqual(engine.battleEnd([53, 193, 194]), [53]);
  assert.deepEqual(engine.admitAtbAction([193, 194], [{ id: 800, type: 4 }]), [193, 194]);
  assert.deepEqual(base, { 123: 0, 6: 1 });
});

test("temporary selectors preserve dictionary values and later active functions override earlier ones", () => {
  const f = initialProtectionFixture();
  f.tables["condition_group.csv"]![1]!.condition_id = "123";
  f.tables["condition_group.csv"]![1]!.type_id = "0";
  const engine = new BattleConditions(f.compile().catalog);
  assert.deepEqual(engine.effectiveResistances([193, 194], { 123: 2 }, "enemy"), { 123: 0 });
  assert.deepEqual(engine.effectiveResistances([194, 193], { 123: 2 }, "enemy"), { 123: 1 });
  assert.equal(engine.add([194], {}, 123, hit, noRng, "enemy").missed, true);
  assert.equal(engine.add([194], {}, 123, { ...hit, fixed: true }, noRng, "enemy").missed, false);
  for (const owner of [undefined, "player"] as const)
    assert.throws(() => engine.effectiveResistances([193], { 123: 0 }, owner), /precedence/);
});

test("provider catalog and output are detached and malformed or unknown references cannot grant behavior", () => {
  const f = initialProtectionFixture(), { catalog } = f.compile(), engine = new BattleConditions(catalog);
  const behavior = catalog.behaviors.find((b) => b.id === 193)!;
  assert.ok(behavior.kind === "physical-protection");
  behavior.resistanceProvider!.conditions[123] = 0;
  const effective = engine.effectiveResistances([193], {}, "enemy");
  assert.deepEqual(effective, { 123: 1 }); effective[123] = 9;
  assert.deepEqual(engine.effectiveResistances([193], {}, "enemy"), { 123: 1 });
  for (const conditions of [{ "0123": 1 }, { 999: 1 }, { 123: -1 }, {}]) {
    const changed = f.compile().catalog;
    Object.assign(changed.behaviors.find((b) => b.id === 193)!, { resistanceProvider: { groupId: 908, conditions } });
    assert.throws(() => new BattleConditions(changed), /resistance|Unknown battle condition/);
  }
  f.tables["condition_group.csv"]![0]!.condition_id = "999";
  const failed = compileProtectionCondition(f.reader(), f.reader().row("condition.csv", 193), String, catalog.rules.definitions);
  assert.equal(failed.behavior, null); assert.ok(failed.blockers.length);
});

test("initial membership is direct, deduplicated and source-bound, never converted to its resistance target", () => {
  const f = initialProtectionFixture(), catalog = f.compile().catalog;
  f.tables["condition_group.csv"]!.push({ id: "15", group_id: "1007", condition_id: "193", type_id: "-12", invocation_rate: "99" });
  const initial = compileEnemyInitialConditions(f.reader(), 1007, catalog);
  assert.deepEqual(initial.conditionIds, [193]);
  assert.equal(initial.sources.filter((row) => row.source.assetPath.endsWith("condition_group.csv")).length, 2);
  initial.conditionIds.length = 0; initial.sources[0]!.values.condition_id = "999";
  assert.deepEqual(compileEnemyInitialConditions(f.reader(), 1007, catalog).conditionIds, [193]);
  assert.deepEqual(compileEnemyInitialConditions(f.reader(), 1008, catalog).conditionIds, [194]);
  assert.deepEqual(compileEnemyInitialConditions({ row: noRng, group: noRng }, 0, catalog), { conditionIds: [], sources: [] });
});

test("initial membership retains explicit missing, unsupported, ambiguous-order and binding failures", () => {
  const f = initialProtectionFixture(), catalog = f.compile().catalog;
  assert.throws(() => compileEnemyInitialConditions(f.reader(), -1, catalog), /Invalid/);
  assert.throws(() => compileEnemyInitialConditions(f.reader(), 998, catalog), /Unresolved table group/);
  assert.throws(() => compileEnemyInitialConditions(f.reader(), 193, catalog), /collision/);
  const first = f.tables["condition_group.csv"]![2]!;
  first.condition_id = "999";
  assert.throws(() => compileEnemyInitialConditions(f.reader(), 1007, catalog), /Unresolved table row/);
  first.condition_id = "193";
  const mismatch = structuredClone(catalog); mismatch.rules.definitions.find((row) => row.id === 193)!.type = 412;
  assert.throws(() => compileEnemyInitialConditions(f.reader(), 1007, mismatch), /disagrees/);
  const unsupported = structuredClone(catalog); unsupported.behaviors = unsupported.behaviors.filter((b) => b.id !== 193);
  assert.throws(() => compileEnemyInitialConditions(f.reader(), 1007, unsupported), /Unimplemented active/);
  f.tables["condition_group.csv"]!.push({ id: "15", group_id: "1007", condition_id: "194", type_id: "1", invocation_rate: "0" });
  assert.throws(() => compileEnemyInitialConditions({ row: f.reader().row, group: f.reader().group }, 1007, catalog), /multiple.*order/);
  const reader = f.reader();
  assert.throws(() => compileEnemyInitialConditions({ ...reader, group: (table, key, value) =>
    reader.group(table, key, value).map((row) => ({ ...row, source: { ...row.source, rowId: "999" } })) }, 1007, catalog), /source identity/);
});

test("provider-bearing protection uses the existing numerical type rules once, preserving active row IDs", () => {
  const engine = new BattleConditions(initialProtectionFixture().compile().catalog);
  const actor: ActionParticipant = { id: "a", side: "player", level: 10, attack: 40, magic: 20,
    physical: { attack: 40, strength: 30, accuracy: 100, criticalRate: 3 }, attackElements: [],
    defense: 64, magicDefense: 64, evasion: 0, magicEvasion: 0, hp: 1000, maxHp: 1000, mp: 50, maxMp: 50,
    conditionIds: [], conditionResistances: {}, elementResistances: {} };
  const targeting = { life: "alive" as const, relation: "enemy" as const, modes: ["single" as const],
    defaultMode: "single" as const, defaultRelation: "enemy" as const, normalFormationOnly: false };
  const physical = (ids: number[]) => {
    const random = [31, 0, 99];
    return projectActionTarget({ effects: [{ slot: 1, kind: "physical" }], targeting,
      physical: { normalAttack: true, multiplyPercent: null, contentFlags: [] }, magic: null }, 0,
    actor, { ...actor, id: "e", side: "enemy", conditionIds: ids }, engine, () => random.shift()!, 1, 0,
    { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false });
  };
  assert.equal(physical([193]).state.hp, physical([123]).state.hp);
  assert.equal(physical([193, 123]).state.hp, physical([193]).state.hp);
  assert.deepEqual(physical([193]).state.conditionIds, [193]);
  const magic = (ids: number[]) => {
    const random = [0, 31];
    return projectActionTarget({ effects: [{ slot: 1, kind: "magic" }], targeting, physical: null,
      magic: { accuracy: 100, contentFlags: [], elements: [], forceDefense: false } }, 30,
    actor, { ...actor, id: "e", side: "enemy", conditionIds: ids }, engine, () => random.shift()!, 1);
  };
  assert.equal(magic([194]).state.hp, magic([122]).state.hp);
  assert.equal(magic([194, 122]).state.hp, magic([194]).state.hp);
  assert.deepEqual(magic([194]).state.conditionIds, [194]);
});
