import { fixtureEquipmentGrants } from "./fixtures/equipment.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  equipmentAvailability,
  equipmentAttackArm,
  equipmentSlotAllowed,
  initialEquipmentStock,
  previewEquipmentChange,
  projectEquipmentParameters,
  validateEquipmentState,
} from "../src/core/equipment.js";
import {
  equipmentCatalog,
  equipmentRoster,
  equipmentContext,
  equipmentLimits,
} from "./fixtures/equipment.js";

test("total ownership includes equipped copies and all roster members reserve stock", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog);
  const stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  assert.deepEqual(stock, [
    { id: 1, count: 5 },
    { id: 2, count: 5 },
    { id: 3, count: 5 },
    { id: 4, count: 5 },
    { id: 5, count: 9 },
    { id: 101, count: 1 },
    { id: 102, count: 1 },
    { id: 201, count: 2 },
    { id: 301, count: 2 },
    { id: 401, count: 2 },
  ]);
  assert.ok(
    equipmentAvailability(catalog, roster, stock).every(
      (s) => s.available === 0,
    ),
  );
  assert.throws(
    () => previewEquipmentChange(catalog, roster, stock, "owner:1", 1, 102),
    /No available/,
  );
  assert.throws(
    () =>
      validateEquipmentState(
        catalog,
        roster,
        stock.map((s) => (s.id === 201 ? { ...s, count: 1 } : s)),
      ),
    /exceeds/,
  );
  assert.throws(
    () => validateEquipmentState(catalog, [roster[0]!, roster[0]!], stock),
    /Duplicate equipment owner/,
  );
});

test("unequip and transfer release reservations without granting or consuming total copies", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog),
    stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  const before = structuredClone({ roster, stock });
  const remove = previewEquipmentChange(
    catalog,
    roster,
    stock,
    "owner:2",
    2,
    1,
  );
  assert.deepEqual(remove.stock, stock);
  assert.equal(
    equipmentAvailability(catalog, remove.roster, stock).find(
      (s) => s.id === 102,
    )!.available,
    1,
  );
  const equip = previewEquipmentChange(
    catalog,
    remove.roster,
    stock,
    "owner:1",
    1,
    102,
  );
  assert.deepEqual(equip.stock, stock);
  assert.equal(
    equipmentAvailability(catalog, equip.roster, stock).find(
      (s) => s.id === 101,
    )!.available,
    1,
  );
  assert.deepEqual({ roster, stock }, before);
  equip.roster[0]!.equipment[0] = 123;
  equip.stock[0]!.count = 0;
  assert.deepEqual({ roster, stock }, before);
});

test("empty placeholders and same-slot confirmations never fabricate ordinary stock", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog),
    stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  const unchanged = previewEquipmentChange(
    catalog,
    roster,
    stock,
    "owner:1",
    1,
    101,
  );
  assert.deepEqual(unchanged.changes, []);
  let next = roster;
  for (let i = 1; i <= 6; i++)
    next = previewEquipmentChange(
      catalog,
      next,
      stock,
      "owner:1",
      i,
      catalog.characters[1]!.emptySlots[i - 1]!,
    ).roster;
  assert.deepEqual(next[0]!.equipment, [1, 1, 3, 4, 5, 5]);
  assert.deepEqual(stock, unchanged.stock);
  assert.throws(
    () =>
      validateEquipmentState(catalog, roster, stock.map((s) => s.id === 1 ? { ...s, count: 100 } : s)),
    /Invalid/,
  );
  assert.throws(
    () => validateEquipmentState(catalog, roster, [...stock, stock[0]!]),
    /Duplicate/,
  );
});

test("ordinary hand conflicts remove the other hand atomically and release its copy", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog),
    stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  stock.find((s) => s.id === 102)!.count++;
  const weapon = previewEquipmentChange(
    catalog,
    roster,
    stock,
    "owner:1",
    2,
    102,
  );
  assert.deepEqual(weapon.roster[0]!.equipment.slice(0, 2), [1, 102]);
  assert.deepEqual(weapon.changes, [
    { slot: 2, from: 201, to: 102 },
    { slot: 1, from: 101, to: 1 },
  ]);
  assert.equal(
    equipmentAvailability(catalog, weapon.roster, stock).find(
      (s) => s.id === 101,
    )!.available,
    1,
  );
  stock.push({ id: 202, count: 1 });
  const shields = previewEquipmentChange(
    catalog,
    roster,
    stock,
    "owner:1",
    1,
    202,
  );
  assert.deepEqual(shields.roster[0]!.equipment.slice(0, 2), [202, 1]);
  assert.deepEqual(shields.stock, stock);
});

test("slot, job and accessory-only restrictions apply at confirmation", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog),
    stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  stock.push({ id: 501, count: 1 });
  assert.throws(
    () => previewEquipmentChange(catalog, roster, stock, "owner:1", 3, 501),
    /slot mismatch/,
  );
  catalog.definitions[501]!.jobIds = [2];
  assert.throws(
    () => previewEquipmentChange(catalog, roster, stock, "owner:1", 5, 501),
    /job mismatch/,
  );
  assert.equal(
    previewEquipmentChange(catalog, roster, stock, "owner:2", 6, 501).roster[1]!
      .equipment[5],
    501,
  );
  catalog.characters[1]!.accessoriesOnly = true;
  assert.throws(
    () => previewEquipmentChange(catalog, roster, stock, "owner:1", 1, 1),
    /fixed/,
  );
  const piece = structuredClone(catalog.definitions[101]!);
  piece.parts = [true, false, false, false, false, false];
  assert.equal(equipmentSlotAllowed(piece, 1, catalog.characters[1]!), true);
  assert.equal(equipmentSlotAllowed(piece, 1, catalog.characters[2]!), false);
  assert.equal(equipmentSlotAllowed(piece, 2, catalog.characters[2]!), true);
});

test("missing effects, providers and final hand dependencies cannot partially change equipment", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog),
    stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  stock.push({ id: 501, count: 1 });
  const original = structuredClone({ roster, stock });
  catalog.definitions[501]!.blockers = ["unknown wear function"];
  assert.throws(
    () => previewEquipmentChange(catalog, roster, stock, "owner:1", 5, 501),
    /Unimplemented equipment effects/,
  );
  catalog.characters[1]!.hasTwoSwordStyle = true;
  assert.throws(
    () => previewEquipmentChange(catalog, roster, stock, "owner:1", 3, 3),
    /provider/,
  );
  catalog.characters[1]!.hasTwoSwordStyle = false;
  // Default empty identity comes from actual eligible ownership.
  for (const entry of stock) if ([1, 2].includes(entry.id)) entry.count = 0;
  stock.find((s) => s.id === 102)!.count++;
  const beforeFailure = structuredClone(stock);
  assert.throws(
    () => previewEquipmentChange(catalog, roster, stock, "owner:1", 2, 102),
    /No owned empty equipment/,
  );
  assert.deepEqual(roster, original.roster);
  assert.deepEqual(stock, beforeFailure);
});

test("equipment reprojection preserves explicit growth, cap ordering, both physical arms and elements", () => {
  const catalog = equipmentCatalog(),
    context = equipmentContext(),
    slots = [101, 201, 301, 401, 501, 5];
  catalog.definitions[101]!.strength = 3;
  catalog.definitions[101]!.attackElements = [1];
  catalog.definitions[201]!.elementResistances = { 1: 2 };
  const result = projectEquipmentParameters(
    catalog,
    slots,
    context,
    equipmentLimits,
  );
  assert.equal(result.parameters.hp, 130);
  assert.equal(result.parameters.mp, 28);
  assert.equal(result.parameters.magic, 47);
  assert.equal(result.parameters.defense, 55);
  assert.deepEqual(result.physicalByArm[1], {
    attack: 50,
    strength: 35,
    accuracy: 100,
    criticalRate: 3,
  });
  assert.deepEqual(result.physicalByArm[2], {
    attack: 20,
    strength: 35,
    accuracy: 0,
    criticalRate: 0,
  });
  assert.deepEqual(result.attackElementsByArm, { 1: [1], 2: [] });
  assert.deepEqual(result.elementResistances, { 1: 2 });
  context.parameters.base.magic = 120;
  context.parameters.additional.magic = 20;
  catalog.definitions[501]!.parameter!.values.magic = -10;
  assert.equal(
    projectEquipmentParameters(catalog, slots, context, equipmentLimits)
      .parameters.magic,
    118,
  );
  assert.equal(context.parameters.additional.hp, 20);
  assert.equal(
    projectEquipmentParameters(
      catalog,
      [1, 1, 3, 4, 5, 5],
      context,
      equipmentLimits,
    ).physicalByArm[1].attack,
    30,
  );
  context.parameters.twoHandMultiplier = 2;
  assert.throws(
    () => projectEquipmentParameters(catalog, slots, context, equipmentLimits),
    /provider/,
  );
});

test("ordinary attack follows the real weapon, then the only weapon record, then dominance", () => {
  const catalog = equipmentCatalog();
  const slots = (right: number, left: number) => [right, left, 3, 4, 5, 5];
  for (const sourceId of [1, 2]) {
    assert.equal(equipmentAttackArm(catalog, sourceId, slots(101, 1)), 1);
    assert.equal(equipmentAttackArm(catalog, sourceId, slots(1, 102)), 2);
    assert.equal(equipmentAttackArm(catalog, sourceId, slots(101, 201)), 1);
    assert.equal(equipmentAttackArm(catalog, sourceId, slots(201, 102)), 2);
    assert.equal(equipmentAttackArm(catalog, sourceId, slots(1, 201)), 1);
    assert.equal(equipmentAttackArm(catalog, sourceId, slots(201, 1)), 2);
    assert.equal(equipmentAttackArm(catalog, sourceId, slots(1, 1)), sourceId);
  }
  assert.throws(
    () => equipmentAttackArm(catalog, 1, slots(101, 102)),
    /hand conflict/,
  );
  assert.throws(
    () => equipmentAttackArm(catalog, 1, slots(201, 202)),
    /hand conflict/,
  );
  catalog.characters[1]!.hasTwoHand = true;
  assert.throws(
    () => equipmentAttackArm(catalog, 1, slots(101, 1)),
    /provider/,
  );
});
