import test from "node:test";
import assert from "node:assert/strict";
import { compileEquipmentAbilityCost } from "../src/compiler/ability-cost.js";
import { compileEquipment } from "../src/compiler/equipment.js";
import { compileParameterEquipment } from "../src/compiler/parameters.js";
import { abilityCostCompilerFixture } from "./fixtures/ability-cost.js";

test("compiler binds content -> armor -> AddEquipAbility -> passive -> menu reduction and all sources", () => {
  const { reader } = abilityCostCompilerFixture();
  for (const [id, modifier, abilityId, contentId] of [[304, "half", 291, 1491], [305, "one", 292, 1492]] as const) {
    const compiled = compileEquipment(reader(), id, "Synthetic");
    assert.deepEqual(compiled.definition.abilityCost, { kind: "equipment-mp-cost", modifier,
      ability: { abilityId, contentId, skillLevel: 0 } });
    assert.deepEqual(compiled.definition.blockers, []);
    assert.equal(compiled.definition.parameter!.values.weight, 2);
    const pure = compileEquipmentAbilityCost(reader(), id);
    assert.equal(pure.sources.length, 8);
    for (const source of pure.sources) assert.equal(source.objectId, "9223372036854775807");
    assert.deepEqual(compileParameterEquipment(reader(), [{ slot: 5, contentId: id }]).equipment[0]!.values,
      compiled.definition.parameter!.values);
  }
});

test("unresolved wear conditions, extra functions and altered passive behavior remain blocked atomically", () => {
  for (const [table, id, key, value] of [
    ["armor.csv", 108, "wear_condition_group_id", "8"],
    ["armor.csv", 108, "wear_function_group_id", "0"],
    ["function_group.csv", 236, "function2_id", "62"],
    ["function_group.csv", 234, "function1_value2", "1"],
    ["function.csv", 62, "series_id", "6"],
    ["ability.csv", 291, "condition_group_id", "8"],
    ["ability.csv", 291, "battle_function_group_id", "8"],
    ["ability.csv", 291, "ability_group_id", "2"],
    ["content.csv", 1491, "type_value", "292"],
    ["content.csv", 304, "type_value", "109"],
  ] as const) {
    const { tables, reader } = abilityCostCompilerFixture();
    tables[table]!.find((r) => r.id === String(id))![key] = value;
    const before = structuredClone(tables);
    assert.throws(() => compileEquipmentAbilityCost(reader(), 304), /Unresolved/);
    const result = compileEquipment(reader(), 304, "Synthetic");
    assert.ok(result.definition.blockers.length);
    assert.equal(result.definition.parameter, null);
    assert.throws(() => compileParameterEquipment(reader(), [{ slot: 5, contentId: 304 }]), /Unresolved/);
    assert.deepEqual(tables, before);
  }
});

test("same menu function on a different content identity does not inherit hardcoded FF6 MP reduction", () => {
  const { tables, reader } = abilityCostCompilerFixture();
  tables["content.csv"]!.push({ ...tables["content.csv"]![0]!, id: "900" });
  assert.throws(() => compileEquipmentAbilityCost(reader(), 900), /content: 900/);
  const result = compileEquipment(reader(), 900, "Synthetic");
  assert.ok(result.definition.blockers.some((b) => b.includes("wear_function_group_id=236")));
  assert.equal(result.definition.abilityCost, undefined);
});
