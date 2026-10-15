import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { FieldConditions } from "../src/core/field-conditions.js";
import { conditionChantingModifier } from "../src/core/condition-speed.js";
import { physicalAccuracyWithBlind } from "../src/core/condition-blind.js";
import { compileEnemyInitialConditions } from "../src/compiler/initial-conditions.js";
import { compileBlindBehavior, hasBlindBehavior } from "../src/compiler/condition-blind.js";
import { compileSpeedBehavior, hasSpeedBehavior } from "../src/compiler/condition-speed.js";
import { compileConditionResistanceProvider } from "../src/compiler/condition-resistance-provider.js";
import { compileFieldConditionCatalog } from "../src/compiler/field-conditions.js";
import { compileDevelopmentAbility } from "../src/compiler/ability.js";
import { hasPoisonBehavior } from "../src/compiler/conditions.js";
import { conditionBlindAbilityFixture, conditionBlindFixture } from "./fixtures/condition-blind.js";

const noRng = () => assert.fail("Unexpected random draw");
const hit = { accuracy: 100, magicEvasion: 0, fixed: false };

/** Synthetic identities and providers; this fixture tests the common lifecycle,
 * not the content of any original enemy or encounter. */
function fixture() {
  const f = conditionBlindFixture();
  f.special.erase_condition_group_id = "20";
  f.specialBlind.erase_condition_group_id = "14";
  const ordinaryPoison = f.tables["condition.csv"]!.find((row) => row.id === "110")!;
  const poison = { ...ordinaryPoison, id: "188", mes_id_name: "STATE_188",
    condition_group_id: "9303", erase_condition_group_id: "13" };
  const float = { ...f.tables["condition.csv"]![0]!, id: "196", condition_type: "409",
    condition_group_id: "9311", attribute_group_id: "6" };
  f.tables["condition.csv"]!.push(poison, float);
  f.tables["erase_condition_group.csv"]!.push(
    { id: "13", group_id: "13", condition_id: "188", type_id: "3", erase_condition: "110" },
    { id: "14", group_id: "14", condition_id: "189", type_id: "3", erase_condition: "109" },
    { id: "20", group_id: "20", condition_id: "195", type_id: "3", erase_condition: "125" },
  );
  f.tables["condition_group.csv"] = [
    { id: "1", group_id: "910", condition_id: "121", type_id: "1", invocation_rate: "0" },
    { id: "2", group_id: "910", condition_id: "125", type_id: "1", invocation_rate: "0" },
    { id: "3", group_id: "9304", condition_id: "109", type_id: "1", invocation_rate: "0" },
    { id: "4", group_id: "9303", condition_id: "110", type_id: "1", invocation_rate: "0" },
    { id: "5", group_id: "8001", condition_id: "195", type_id: "-12", invocation_rate: "99" },
    { id: "6", group_id: "8002", condition_id: "189", type_id: "1", invocation_rate: "0" },
    { id: "7", group_id: "8003", condition_id: "188", type_id: "1", invocation_rate: "0" },
    { id: "8", group_id: "8004", condition_id: "196", type_id: "1", invocation_rate: "0" },
    { id: "9", group_id: "9311", condition_id: "117", type_id: "1", invocation_rate: "0" },
  ];
  return { ...f, poison };
}

test("generic active providers preserve all three condition identities, erase groups and source references", () => {
  const f = fixture(), before = structuredClone(f.tables), compiled = f.compile();
  const engine = new BattleConditions(compiled.catalog);
  assert.deepEqual(compiled.providerBlockers.filter(b => b.conditionId !== 196), []);
  assert.match(compiled.providerBlockers.find(b => b.conditionId === 196)!.reason, /Leviteto lifecycle/);
  assert.deepEqual(engine.types([195, 189, 188]), [15, 9, 10]);
  for (const [id, kind, eraseGroupId, groupId, conditions] of [
    [195, "haste", 20, 910, { 121: 1, 125: 1 }],
    [189, "blind", 14, 9304, { 109: 1 }],
    [188, "poison", 13, 9303, { 110: 1 }],
  ] as const) {
    const behavior = compiled.catalog.behaviors.find((row) => row.id === id)!;
    assert.equal(behavior.kind, kind);
    assert.deepEqual(behavior.resistanceProvider, { groupId, conditions });
    assert.equal(compiled.catalog.rules.definitions.find((row) => row.id === id)!.eraseGroupId, eraseGroupId);
  }
  for (const id of ["1", "2", "3", "4"])
    assert.ok(compiled.sources.some((row) => row.source.assetPath.endsWith("/condition_group.csv") && row.source.rowId === id));
  assert.deepEqual(f.tables, before);
});

test("initial membership activates the source master directly and never its resistance targets", () => {
  const f = fixture(), catalog = f.compile().catalog;
  f.tables["condition_group.csv"]!.push({ id: "10", group_id: "8001", condition_id: "195", type_id: "0", invocation_rate: "0" });
  for (const [group, id] of [[8001, 195], [8002, 189], [8003, 188]]) {
    const initial = compileEnemyInitialConditions(f.reader(), group!, catalog);
    assert.deepEqual(initial.conditionIds, [id]);
    assert.ok(initial.sources.some((row) => row.source.assetPath.endsWith("/condition.csv") && Number(row.values.id) === id));
  }
  assert.throws(() => compileEnemyInitialConditions(f.reader(), 8004, catalog), /Unimplemented active.*196/);
  f.tables["condition_group.csv"]!.push({ id: "11", group_id: "8001", condition_id: "189", type_id: "1", invocation_rate: "0" });
  assert.throws(() => compileEnemyInitialConditions({ row: f.reader().row, group: f.reader().group }, 8001, catalog), /multiple.*activation order/);
});

test("temporary resistance blocks ordinary and fixed attempts before hit RNG without changing the active owner", () => {
  const engine = new BattleConditions(fixture().compile().catalog);
  for (const [active, targets] of [[195, [121, 125]], [189, [109]], [188, [110]]] as const) {
    const currentIds = [53, active], before = [...currentIds];
    for (const incomingId of targets) for (const fixed of [false, true]) {
      const base = { [incomingId]: 0, 6: 1 };
      assert.deepEqual(engine.add(currentIds, base, incomingId, { ...hit, fixed }, noRng, "enemy"),
        { currentIds: before, added: [], removed: [], missed: true });
      assert.deepEqual(base, { [incomingId]: 0, 6: 1 });
    }
    assert.deepEqual(currentIds, before);
    assert.deepEqual(engine.recover(currentIds, targets).currentIds, before);
  }
});

test("removal drops only the temporary dictionary, retaining permanent resistance and ordinary reapplication", () => {
  const engine = new BattleConditions(fixture().compile().catalog);
  for (const [active, incomingId] of [[195, 121], [189, 109], [188, 110]] as const) {
    const currentIds = [active], base = { [incomingId]: 0, 6: 1 };
    assert.equal(engine.effectiveResistances(currentIds, base, "enemy")[incomingId], 1);
    const recovered = engine.recover(currentIds, [active]);
    assert.deepEqual(recovered.removed, [active]);
    assert.deepEqual(engine.effectiveResistances(recovered.currentIds, base, "enemy"), base);
    assert.equal(engine.add(recovered.currentIds, base, incomingId, hit, noRng, "enemy").missed, true);
    assert.deepEqual(engine.add(recovered.currentIds, base, incomingId, { ...hit, fixed: true }, noRng, "enemy").currentIds, [incomingId]);
    assert.deepEqual(currentIds, [active]);
  }
});

test("existing numeric behavior and clocks consume types while retaining each active master identity", () => {
  const engine = new BattleConditions(fixture().compile().catalog);
  assert.equal(engine.speedPercent([195]), engine.speedPercent([121]));
  assert.equal(conditionChantingModifier(engine.types([195])), conditionChantingModifier(engine.types([121])));
  assert.equal(physicalAccuracyWithBlind(101, engine.types([189]), false), 50);
  assert.equal(physicalAccuracyWithBlind(101, engine.types([189]), false),
    physicalAccuracyWithBlind(101, engine.types([109]), false));
  const currentIds = [188, 195], clocks = engine.reconcilePoisonState(currentIds, [], 1);
  assert.deepEqual(clocks, [{ conditionId: 188, elapsedSeconds: 0, thresholdSeconds: 4 }]);
  const input = { conditionIds: currentIds, state: clocks, hp: 160, maxHp: 160, elementResistances: {},
    seconds: 4, atbSpeed: 1, isTimeStopped: false };
  const changed = engine.advancePoison(input);
  assert.equal(changed.hp, 150);
  assert.deepEqual(changed.ticks, [{ conditionId: 188, amount: 10, recovery: false, hpBefore: 160, hpAfter: 150 }]);
  assert.deepEqual(changed.state, [{ conditionId: 188, elapsedSeconds: 0, thresholdSeconds: 8 }]);
  assert.deepEqual(engine.reconcilePoisonState([195], changed.state, 1), []);
  assert.deepEqual(currentIds, [188, 195]);
  assert.deepEqual(clocks, [{ conditionId: 188, elapsedSeconds: 0, thresholdSeconds: 4 }]);
});

test("death and battle-end lifecycle do not replace special states by ordinary condition IDs", () => {
  const engine = new BattleConditions(fixture().compile().catalog), currentIds = [53, 195, 189, 188];
  assert.deepEqual(engine.settleLife(0, currentIds, false), { hp: 0, conditionIds: [53, 5] });
  assert.deepEqual(engine.effectiveResistances([53, 5], { 6: 1 }, "enemy"), { 6: 1 });
  // Until3 remains battle data; this is not permission to persist an enemy-only provider in the field.
  assert.deepEqual(engine.battleEnd(currentIds), [53, 189, 188]);
  const after = engine.battleEnd(currentIds);
  assert.deepEqual(engine.effectiveResistances(after, {}, "enemy"), { 109: 1, 110: 1 });
  assert.deepEqual(currentIds, [53, 195, 189, 188]);
});

test("later active providers overwrite earlier keys and enemy temporary selectors take precedence over permanent ones", () => {
  const f = fixture();
  Object.assign(f.tables["condition_group.csv"]![2]!, { condition_id: "121", type_id: "0" });
  const engine = new BattleConditions(f.compile().catalog), base = { 121: 2, 6: 1 };
  assert.deepEqual(engine.effectiveResistances([195, 189], base, "enemy"), { 121: 0, 125: 1, 6: 1 });
  assert.deepEqual(engine.effectiveResistances([189, 195], base, "enemy"), { 121: 1, 125: 1, 6: 1 });
  assert.equal(engine.add([189], base, 121, hit, noRng, "enemy").missed, true);
  assert.equal(engine.add([189], base, 121, { ...hit, fixed: true }, noRng, "enemy").missed, false);
  for (const owner of [undefined, "player"] as const)
    assert.throws(() => engine.effectiveResistances([189], base, owner), /precedence/);
  assert.deepEqual(base, { 121: 2, 6: 1 });
});

test("ordinary ability application and field persistence cannot borrow active provider admission", () => {
  const f = fixture(), compiled = f.compile(), reader = f.reader();
  assert.equal(hasSpeedBehavior(reader.row("condition.csv", 195)), false);
  assert.equal(hasBlindBehavior(reader.row("condition.csv", 189)), false);
  assert.equal(hasPoisonBehavior(reader.row("condition.csv", 188)), false);
  assert.equal(compileSpeedBehavior(reader.row("condition.csv", 195), String), null);
  assert.equal(compileBlindBehavior(reader.row("condition.csv", 189), String), null);
  const abilityFixture = conditionBlindAbilityFixture();
  abilityFixture.tables["condition_group.csv"] = structuredClone(f.tables["condition_group.csv"]!);
  for (const id of ["195", "189", "188"]) {
    const source = f.tables["condition.csv"]!.find((row) => row.id === id)!;
    const existing = abilityFixture.tables["condition.csv"]!.find((row) => row.id === id);
    if (existing) Object.assign(existing, source);
    else abilityFixture.tables["condition.csv"]!.push({ ...source });
    abilityFixture.group.function1_value1 = id;
    assert.equal(compileDevelopmentAbility(abilityFixture.reader(), 801, "Unadmitted special application").plan, null);
  }
  const field = compileFieldConditionCatalog(reader, compiled.catalog, [101, 106]);
  assert.deepEqual(field.catalog.definitions, compiled.catalog.rules.definitions.map(({ id, type }) => ({ id, type })));
  const fieldEngine = new FieldConditions(field.catalog);
  for (const id of [195, 189, 188]) assert.throws(() => fieldEngine.validateActive([id]), /Unimplemented active field/);
  for (const id of [109, 110]) fieldEngine.validateActive([id]);
  for (const id of [189, 188]) assert.ok(field.sources.some((row) => row.source.assetPath.endsWith("/condition.csv") && Number(row.values.id) === id));
});

test("missing or conflicting provider references cannot grant active state or mutate source input", () => {
  for (const change of ["missing", "unknown", "negative", "duplicate", "identity"] as const) {
    const f = fixture();
    if (change === "missing") f.tables["condition_group.csv"] = f.tables["condition_group.csv"]!.filter((row) => row.group_id !== "910");
    if (change === "unknown") f.tables["condition_group.csv"]![0]!.condition_id = "999";
    if (change === "negative") f.tables["condition_group.csv"]![0]!.type_id = "-1";
    if (change === "duplicate") f.tables["condition_group.csv"]!.push({ ...f.tables["condition_group.csv"]![0]!, id: "10", type_id: "0" });
    const before = structuredClone(f.tables), reader = f.reader();
    const alteredReader = change !== "identity" ? reader : { ...reader,
      group: (...args: Parameters<typeof reader.group>) => reader.group(...args).map((row) => ({ ...row,
        source: { ...row.source, rowId: "999" } })) };
    const definitions = f.compile().catalog.rules.definitions;
    const result = compileConditionResistanceProvider(alteredReader, reader.row("condition.csv", 195),
      { id: 195, kind: "haste" as const, name: "Synthetic", untilType: 2 as const, speedDelta: 50 }, definitions);
    assert.equal(result.behavior, null, change);
    assert.ok(result.blockers.length, change);
    assert.deepEqual(result.sources, [], change);
    assert.deepEqual(f.tables, before, change);
    if (change !== "identity") {
      const compiled = f.compile();
      assert.ok(compiled.providerBlockers.some((blocker) => blocker.conditionId === 195));
      assert.throws(() => new BattleConditions(compiled.catalog).validateActive([195]), /Unimplemented active/);
    }
  }
});

test("admitted catalogs and derived resistance dictionaries are detached and malformed providers are rejected", () => {
  const f = fixture(), catalog = f.compile().catalog, engine = new BattleConditions(catalog);
  const provider = catalog.behaviors.find((row) => row.id === 195)!.resistanceProvider!;
  provider.conditions[121] = 0;
  const effective = engine.effectiveResistances([195], {}, "enemy");
  assert.deepEqual(effective, { 121: 1, 125: 1 });
  effective[121] = 7;
  assert.deepEqual(engine.effectiveResistances([195], {}, "enemy"), { 121: 1, 125: 1 });
  for (const conditions of [{ "0121": 1 }, { 999: 1 }, { 121: -1 }, {}]) {
    const changed = f.compile().catalog;
    changed.behaviors.find((row) => row.id === 195)!.resistanceProvider = { groupId: 910, conditions };
    assert.throws(() => new BattleConditions(changed), /resistance|Unknown battle condition/);
  }
  const forged = f.compile().catalog;
  forged.behaviors.find((row) => row.id === 53)!.resistanceProvider = { groupId: 910, conditions: { 121: 1 } };
  assert.throws(() => new BattleConditions(forged), /Unsupported condition resistance provider/);
});

test("unknown secondary providers and field row corruption remain explicit failures", () => {
  for (const [id, field] of [[195, "parameter_group_id"], [189, "attribute_group_id"], [188, "species_group_id"]] as const) {
    const f = fixture();
    f.tables["condition.csv"]!.find((row) => Number(row.id) === id)![field] = "1";
    const engine = new BattleConditions(f.compile().catalog);
    assert.throws(() => engine.validateActive([id]), /Unimplemented active/);
  }
  const f = fixture(), catalog = f.compile().catalog;
  const blind = f.tables["condition.csv"]!.find((row) => row.id === "109")!;
  const specialBlind = f.tables["condition.csv"]!.find((row) => row.id === "189")!;
  blind.damage_number = "1";
  assert.throws(() => compileFieldConditionCatalog(f.reader(), catalog, [101, 106]), /Unresolved active field/);
  blind.damage_number = "0";
  specialBlind.attribute_group_id = "1";
  assert.throws(() => compileFieldConditionCatalog(f.reader(), catalog, [101, 106]), /Changed battle-only condition provider/);
  f.tables["condition.csv"] = f.tables["condition.csv"]!.filter((row) => row.id !== "189");
  assert.throws(() => compileFieldConditionCatalog(f.reader(), catalog, [101, 106]), /Unresolved table row/);
});
