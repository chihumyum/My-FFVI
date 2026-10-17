import test from "node:test";
import assert from "node:assert/strict";
import { applyDefend, clearDefendOnAdmission, type DefendAdmission } from "../src/core/defend.js";
import { ConditionRules } from "../src/core/conditions.js";
import { compileDefendCatalog, compileDefendEffect, hasDefendBehavior } from "../src/compiler/defend.js";
import { compileAbilityProgram } from "../src/compiler/ability.js";
import { defendFixture } from "./fixtures/defend.js";

const ordinary: DefendAdmission = { route: "atb", abilities: [{ id: 800, type: 4 }], nativeChain: "empty" };
test("Defend resolves function type and condition type instead of hardcoded row identities", () => {
  const f = defendFixture(), reader = f.reader();
  const { program } = compileAbilityProgram(reader, 801);
  const compiled = compileDefendEffect(reader, program);
  assert.deepEqual(compiled.effect, { slot: 1, kind: "defend", conditionId: 901 });
  assert.deepEqual(compiled.catalog, f.catalog);
  assert.deepEqual(compiled.sources.map((row) => row.source.rowId), ["801", "81", "501", "901", "1"]);
});
test("Defend condition requires the active system-4 behavior and exact lifecycle inputs", () => {
  const f = defendFixture();
  assert.equal(hasDefendBehavior({ values: f.condition }), true);
  for (const [key, value] of [["system_type", "1"], ["until_type", "3"], ["overlapped_type", "1"],
    ["parameter_group_id", "4"], ["battle_effect_asset_id", "2"], ["invalid_type", "1"]]) {
    const row = { values: { ...f.condition, [key!]: value! } };
    assert.equal(hasDefendBehavior(row), false, key);
  }
  f.tables["condition.csv"]!.push({ ...f.condition, id: "906" });
  assert.throws(() => compileDefendCatalog(f.reader()), /Unresolved Defend condition provider/);
});
test("Defend action rejects source composition, targeting, process and resource drift", () => {
  const mutations: [string, string][] = [
    ["battle_renge_id", "1"], ["type_id", "4"], ["system_id", "1"], ["accuracy_rate", "99"],
    ["process_prog", "multiply"], ["invalid_reflection", "0"], ["reaction_type", "1"],
    ["standard_value", "10"], ["use_value", "1"], ["ability_wait", "1"],
  ];
  for (const [key, value] of mutations) {
    const f = defendFixture(); f.ability[key] = value;
    const reader = f.reader(), { program } = compileAbilityProgram(reader, 801);
    assert.throws(() => compileDefendEffect(reader, program), /Unresolved Defend/, key);
  }
  const f = defendFixture(); f.group.function1_value1 = "1";
  let reader = f.reader();
  assert.throws(() => compileDefendEffect(reader, compileAbilityProgram(reader, 801).program), /Unresolved Defend/);
  f.group.function1_value1 = "0"; f.group.function2_id = "501"; reader = f.reader();
  assert.throws(() => compileDefendEffect(reader, compileAbilityProgram(reader, 801).program), /Unresolved Defend/);
});
test("Defend directly appends then conflicts without the ordinary IsAddable precheck", () => {
  const f = defendFixture(), ids = [902, 901];
  assert.equal(f.rules.isAddable(ids, 901), false);
  assert.deepEqual(applyDefend(f.catalog, f.rules, ids, "actor", "actor"), {
    currentIds: [902, 901], added: [901], removed: [901], missed: false,
  });
  assert.deepEqual(ids, [902, 901]);
  assert.throws(() => applyDefend(f.catalog, f.rules, ids, "actor", "other"), /self target/);
  assert.deepEqual(ids, [902, 901]);
});
test("ordinary ATB admission removes Defend before a later action, including another Defend or item", () => {
  const f = defendFixture(), ids = [902, 901, 905];
  for (const abilities of [ordinary.abilities, [{ id: 801, type: 5 }], []]) {
    assert.deepEqual(clearDefendOnAdmission(f.catalog, f.rules, ids, { ...ordinary, abilities }), {
      currentIds: [902, 905], added: [], removed: [901], missed: false,
    });
  }
  assert.deepEqual(ids, [902, 901, 905]);
});
test("direct counters do not expire Defend and irrelevant unresolved chain state does not block", () => {
  const f = defendFixture();
  assert.deepEqual(clearDefendOnAdmission(f.catalog, f.rules, [901, 904], {
    ...ordinary, route: "direct", nativeChain: "unresolved", abilities: [{ id: 83, type: 8 }],
  }).currentIds, [901, 904]);
  assert.deepEqual(clearDefendOnAdmission(f.catalog, f.rules, [902], {
    ...ordinary, nativeChain: "unresolved",
  }).currentIds, [902]);
});
test("native special ATB branches are atomic blockers while defending", () => {
  const f = defendFixture(), ids = [902, 901];
  for (const abilities of [[{ id: 17, type: 4 }], [{ id: 83, type: 4 }],
    ...[8, 40, 41].map((type) => [{ id: 800, type }])]) {
    assert.throws(() => clearDefendOnAdmission(f.catalog, f.rules, ids, { ...ordinary, abilities }), /chain\/selection/);
  }
  assert.throws(() => clearDefendOnAdmission(f.catalog, f.rules, ids, { ...ordinary, nativeChain: "unresolved" }), /chain\/selection/);
  assert.throws(() => clearDefendOnAdmission(f.catalog, f.rules, [...ids, 904], ordinary), /chain\/selection/);
  assert.deepEqual(ids, [902, 901]);
});
test("death conflict removes Defend and preserves the separately sourced Magitek state", () => {
  const f = defendFixture();
  const result = f.rules.resolveConflict({ currentIds: [902, 901, 903], equipmentIds: [], incomingId: 903 });
  assert.deepEqual(result.currentIds, [902, 903]);
  assert.deepEqual(result.removed, [{ id: 901, reason: "replace" }]);
});
test("Defend lifecycle rejects unknown IDs and alternative condition-type identities", () => {
  const f = defendFixture();
  assert.throws(() => clearDefendOnAdmission(f.catalog, f.rules, [999], ordinary), /Unresolved condition/);
  f.definitions.definitions.push({ id: 906, type: 1, overlapped: false, eraseGroupId: 1 });
  assert.throws(() => applyDefend(f.catalog, new ConditionRules(f.definitions), [906], "actor", "actor"), /alternative/);
  assert.throws(() => clearDefendOnAdmission(f.catalog, f.rules, [901], { ...ordinary, abilities: [{ id: 0, type: 4 }] }), /Invalid Defend/);
});
