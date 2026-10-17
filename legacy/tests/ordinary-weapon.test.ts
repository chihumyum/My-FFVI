import { fixtureEquipmentGrants } from "./fixtures/equipment.js";
import test from "node:test";
import assert from "node:assert/strict";
import { compileEquipment } from "../src/compiler/equipment.js";
import { compileOrdinaryWeapon, compileOrdinaryWeaponEffects } from "../src/compiler/ordinary-weapon.js";
import { validateOrdinaryWeapon } from "../src/core/ordinary-weapon.js";
import {
  equipmentAttackArm, initialEquipmentStock, previewEquipmentChange, projectEquipmentParameters,
  validateEquipmentBattleRows, validateEquipmentState,
} from "../src/core/equipment.js";
import { projectPhysicalRows } from "../src/core/battle-row.js";
import { calculatePhysical } from "../src/core/physical.js";
import { equipmentContext, equipmentLimits, equipmentRoster, fixtureWeaponEffects } from "./fixtures/equipment.js";
import { ordinaryWeaponEquipment, ordinaryWeaponReader, ordinaryWeaponRows } from "./fixtures/ordinary-weapon.js";

test("ordinary ranged compilation retains source identity, physical values, rights and backFlag", () => {
  const { reader } = ordinaryWeaponReader();
  const compiled = compileEquipment(reader, 162, "Synthetic", fixtureWeaponEffects());
  assert.deepEqual(compiled.definition.blockers, []);
  assert.deepEqual(compiled.definition.ordinaryWeapon,
    { kind: "ordinary-weapon-v1", contentId: 162, weaponId: 70, typeId: 1, backFlag: 1 });
  assert.equal(compiled.definition.parameter!.values.attack, 86);
  assert.deepEqual(compiled.definition.parts, [true, true, false, false, false, false]);
  assert.deepEqual(compiled.definition.jobIds, [1]);
  assert.ok(compiled.sources.some((source) => source.rowId === "70"));
});

test("backFlag is an explicit 0/1 provider, not an inferred missing false value", () => {
  for (const backFlag of [0, 1]) {
    const { reader } = ordinaryWeaponReader({ back_flag: String(backFlag) });
    assert.equal(compileOrdinaryWeapon(reader, 162, fixtureWeaponEffects()).provider!.backFlag, backFlag);
  }
  for (const overrides of [{ back_flag: "2" }, { type_id: "2", back_flag: "1" }, { type_id: "3" }]) {
    const { reader } = ordinaryWeaponReader(overrides);
    const result = compileOrdinaryWeapon(reader, 162, fixtureWeaponEffects());
    assert.equal(result.provider, null); assert.ok(result.blockers.length);
  }
  const { reader, weapon } = ordinaryWeaponReader();
  delete weapon.back_flag;
  assert.throws(() => compileOrdinaryWeapon(reader, 162, fixtureWeaponEffects()));
});

test("process, added conditions, two-hand, affinities and hardcoded weapon branches remain blocked", () => {
  const changes: Record<string, string>[] = [
    { process_prog: "ADD_MAGIC" }, { process_prog: "DICE" }, { process_prog: "UNKNOWN" },
    ...["attribute_group_id", "weak_attribute", "effective_species", "two_handed_flag",
      "additional_condition_group_id"].map((column) => ({ [column]: "1" })),
    { id: "11" }, { id: "30" },
  ];
  for (const change of changes) {
    const { reader } = ordinaryWeaponReader(change);
    const result = compileOrdinaryWeapon(reader, 162, fixtureWeaponEffects());
    assert.equal(result.provider, null, JSON.stringify(change));
    assert.ok(result.blockers.length, JSON.stringify(change));
  }
  for (const weaponId of [11, 30]) assert.throws(() => validateOrdinaryWeapon({
    kind: "ordinary-weapon-v1", contentId: weaponId + 92, weaponId, typeId: 1, backFlag: 0,
  }), /special physical weapon/);
  for (const column of ["wear_condition_group_id", "wear_function_group_id", "trigger_ability_id",
    "intelligence", "spirit", "ability_disturbed_rate"]) {
    const { reader } = ordinaryWeaponReader({ [column]: "1" });
    assert.ok(compileEquipment(reader, 162, "Synthetic", fixtureWeaponEffects()).definition.blockers.some((b) => b.includes(column)), column);
  }
});

test("additional attacks require the independent source list, preserve its order, and block even zero chance", () => {
  const { reader, tables } = ordinaryWeaponReader();
  tables["ability.csv"] = [{ id: "263" }, { id: "264" }];
  const raw = { add_ability_weapon: [
    { weapon_id: 70, ability_id: 263, ability_per: 0 },
    { weapon_id: 70, ability_id: 264, ability_per: 25 },
  ] };
  // Add the explicit synthetic provenance for this extra table.
  const tracked = { row: (table: string, id: string | number) => table === "ability.csv" ? {
    values: tables[table]!.find((row) => row.id === String(id))!,
    source: { file: "synthetic-ordinary-weapon", assetPath: table, objectId: "1", serializedFile: "fixture", rowId: String(id) },
  } : reader.row(table, id) };
  const compiled = compileOrdinaryWeaponEffects(tracked, raw);
  assert.deepEqual(compiled.catalog.additionalAbilities, [
    { weaponId: 70, abilityId: 263, chance: 0 }, { weaponId: 70, abilityId: 264, chance: 25 },
  ]);
  assert.equal(compiled.sources.length, 4);
  const result = compileOrdinaryWeapon(reader, 162, compiled.catalog);
  assert.equal(result.provider, null); assert.equal(result.blockers.length, 2);
  assert.ok(result.blockers[0]!.includes("chance=0"));
  for (const missing of [null, {}, { add_ability_weapon: null }, { add_ability_weapon: [{ weapon_id: 70, ability_id: 263 }] }])
    assert.throws(() => compileOrdinaryWeaponEffects(tracked, missing));
  assert.throws(() => compileOrdinaryWeapon(reader, 162, undefined as never), /additional-ability provider/);
  const catalog = ordinaryWeaponEquipment(), owner = equipmentRoster(catalog)[0]!;
  owner.equipment[0] = 162;
  catalog.ordinaryWeaponEffects = compiled.catalog;
  assert.throws(() => validateEquipmentBattleRows(catalog, owner, ordinaryWeaponRows(catalog)), /additional ability/);
});

test("ranged gear swaps either hand atomically, selects that arm and conserves total ownership", () => {
  const catalog = ordinaryWeaponEquipment(), roster = equipmentRoster(catalog);
  const stock = [...initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog)), { id: 162, count: 1 }];
  const before = structuredClone({ roster, stock });
  const changed = previewEquipmentChange(catalog, roster, stock, "owner:1", 2, 162);
  assert.deepEqual(changed.roster[0]!.equipment.slice(0, 2), [1, 162]);
  assert.deepEqual(changed.changes, [{ slot: 2, from: 201, to: 162 }, { slot: 1, from: 101, to: 1 }]);
  assert.equal(equipmentAttackArm(catalog, 1, changed.roster[0]!.equipment), 2);
  assert.deepEqual(changed.stock, stock); assert.deepEqual({ roster, stock }, before);
  const projection = projectEquipmentParameters(catalog, changed.roster[0]!.equipment, equipmentContext(), equipmentLimits);
  assert.equal(projection.physicalByArm[1].attack, 20);
  assert.equal(projection.physicalByArm[2].attack, 50);
  assert.throws(() => previewEquipmentChange(catalog, changed.roster, stock, "owner:2", 1, 162), /No available equipment copy/);
  const unequipped = previewEquipmentChange(catalog, changed.roster, stock, "owner:1", 2, 1);
  const restored = previewEquipmentChange(catalog, unequipped.roster, stock, "owner:1", 1, 162);
  assert.deepEqual(restored.roster[0]!.equipment.slice(0, 2), [162, 1]);
  assert.equal(equipmentAttackArm(catalog, 1, restored.roster[0]!.equipment), 1);
  validateEquipmentState(catalog, restored.roster, stock);
});

test("weapon metadata cannot drift between equipment and row catalogs or disappear during projection", () => {
  const catalog = ordinaryWeaponEquipment(), owner = equipmentRoster(catalog)[0]!;
  owner.equipment[0] = 162;
  const rows = ordinaryWeaponRows(catalog);
  validateEquipmentBattleRows(catalog, owner, rows);
  const before = structuredClone({ catalog, owner, rows });
  for (const alter of [
    () => { rows.equipment.find((e) => e.contentId === 162)!.weapon!.backFlag = 0; },
    () => { rows.equipment.find((e) => e.contentId === 162)!.weapon!.typeId = 2; },
    () => { rows.equipment = rows.equipment.filter((e) => e.contentId !== 162); },
  ]) {
    Object.assign(rows, structuredClone(before.rows)); alter();
    assert.throws(() => validateEquipmentBattleRows(catalog, owner, rows), /provider mismatch/);
  }
  Object.assign(rows, structuredClone(before.rows));
  catalog.definitions[162]!.ordinaryWeapon = null;
  assert.throws(() => validateEquipmentBattleRows(catalog, owner, rows), /ordinary weapon provider/);
  assert.throws(() => projectEquipmentParameters(catalog, owner.equipment, equipmentContext(), equipmentLimits), /ordinary weapon provider/);
  catalog.definitions[162]!.ordinaryWeapon = { ...before.catalog.definitions[162]!.ordinaryWeapon!, weaponId: 71 };
  assert.throws(() => validateEquipmentBattleRows(catalog, owner, rows), /identity mismatch/);
});

test("ranged damage bypasses both row penalties using actual hand slots without additional random draws", () => {
  const catalog = ordinaryWeaponEquipment(), rowCatalog = ordinaryWeaponRows(catalog);
  const owner = equipmentRoster(catalog)[0]!; owner.equipment[0] = 162;
  validateEquipmentBattleRows(catalog, owner, rowCatalog);
  const results: number[] = [];
  for (const actorRow of ["front", "back"] as const) for (const targetRow of ["front", "back"] as const) {
    const rows = projectPhysicalRows(rowCatalog, { abilityId: 1,
      actor: { side: "player", row: actorRow, equipment: owner.equipment, conditionTypes: [] }, targetRow });
    assert.equal(rows.ignoreActorPenalty, true); assert.equal(rows.ignoreTargetPenalty, true);
    const draws = [31, 0, 99];
    const result = calculatePhysical({ rows, power: 0,
      rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] },
      actor: { side: "player", level: 10, attack: 50, strength: 30, accuracy: 100, criticalRate: 3,
        attackElements: [], conditionTypes: [] },
      target: { side: "enemy", defense: 64, evasion: 0, elementResistances: {}, conditionTypes: [] },
      targetCount: 1,
    }, () => draws.shift()!);
    results.push(result.amount); assert.equal(draws.length, 0);
  }
  assert.deepEqual(results, [85, 85, 85, 85]);
  owner.equipment[0] = 101;
  const rows = projectPhysicalRows(rowCatalog, { abilityId: 1,
    actor: { side: "player", row: "back", equipment: owner.equipment, conditionTypes: [] }, targetRow: "back" });
  assert.deepEqual(rows, { actor: "back", target: "back", ignoreActorPenalty: false, ignoreTargetPenalty: false });
});
