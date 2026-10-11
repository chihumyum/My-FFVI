import test from "node:test";
import assert from "node:assert/strict";
import {
  equipmentAvailability,
  equipmentRegistrations,
  initialEquipmentStock,
  previewEquipmentChange,
  selectEmptyEquipment,
  validateEquipmentLoadout,
  validateEquipmentState,
  type EquipmentStock,
} from "../src/core/equipment.js";
import { equipmentCatalog, equipmentRoster } from "./fixtures/equipment.js";

// Explicit authored CreateItems inputs. Production must compile its own grants.
const grants = (): EquipmentStock[] => [1, 2, 3, 4, 5].map((id) => ({ id, count: 5 }));
function scenario() {
  const catalog = equipmentCatalog();
  const roster = equipmentRoster(catalog);
  const stock = initialEquipmentStock(catalog, roster, grants());
  return { catalog, roster, stock };
}

test("initial ownership applies explicit grants then all six initial slots without inventing empty seeds", () => {
  const { catalog, roster, stock } = scenario();
  assert.deepEqual(stock.filter((s) => catalog.definitions[s.id]!.empty), [
    { id: 1, count: 5 }, { id: 2, count: 5 }, { id: 3, count: 5 },
    { id: 4, count: 5 }, { id: 5, count: 9 },
  ]);
  assert.deepEqual(initialEquipmentStock(catalog, roster, []).filter((s) => catalog.definitions[s.id]!.empty),
    [{ id: 5, count: 4 }]);
  assert.throws(() => initialEquipmentStock(catalog, roster, undefined as never), /Explicit initial/);
  assert.deepEqual(grants(), [1, 2, 3, 4, 5].map((id) => ({ id, count: 5 })));
});

test("initial empty grants merge in call order and AddOwnedItem caps the resulting Count", () => {
  const { catalog, roster } = scenario();
  const seed = [{ id: 5, count: 97 }, { id: 5, count: 1 }];
  const stock = initialEquipmentStock(catalog, roster, seed);
  assert.equal(stock.find((s) => s.id === 5)!.count, 99);
  assert.deepEqual(seed, [{ id: 5, count: 97 }, { id: 5, count: 1 }]);
  assert.throws(() => initialEquipmentStock(catalog, roster, [{ id: 5, count: -1 }]), /integer/);
});

test("default empty selection consumes owned Count and prefers source weapon type over armor", () => {
  const { catalog, stock } = scenario();
  // Compiled diagnostics and input order cannot substitute for the native query.
  catalog.characters[1]!.emptySlots = [999, 999, 999, 999, 999, 999];
  stock.reverse();
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 1), 1);
  stock.find((s) => s.id === 1)!.count = 0;
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 1), 2);
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 2), 2);
  stock.find((s) => s.id === 2)!.count = 0;
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 1), null);
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 3), 3);
  stock.splice(stock.findIndex((s) => s.id === 3), 1);
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 3), null);
});

test("default empty slots use dominant-arm parts and do not add an absent job filter", () => {
  const { catalog, stock } = scenario();
  catalog.definitions[1]!.parts = [true, false, false, false, false, false];
  catalog.definitions[2]!.parts = [false, true, false, false, false, false];
  catalog.definitions[1]!.jobIds = [];
  catalog.definitions[2]!.jobIds = [];
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 1), 1);
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 2), 2);
  assert.equal(selectEmptyEquipment(catalog, stock, 2, 1), 2);
  assert.equal(selectEmptyEquipment(catalog, stock, 2, 2), 1);
  assert.throws(() => selectEmptyEquipment(catalog, stock, 1, 0), /integer/);
});

test("same-type default ambiguity needs original owned order and cannot silently choose by ID", () => {
  const { catalog, stock } = scenario();
  const extra = structuredClone(catalog.definitions[1]!);
  extra.id = 6;
  extra.equipmentId = 1006;
  extra.ordinaryWeapon!.contentId = 6;
  extra.ordinaryWeapon!.weaponId = 1006;
  catalog.definitions[6] = extra;
  stock.push({ id: 6, count: 1 });
  assert.throws(() => selectEmptyEquipment(catalog, stock, 1, 1), /Ambiguous/);
  assert.throws(() => selectEmptyEquipment(catalog, [...stock].reverse(), 1, 1), /Ambiguous/);
  stock.find((s) => s.id === 6)!.count = 0;
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 1), 1);
});

test("ambiguity in a lower source type cannot block the earlier unambiguous default", () => {
  const { catalog, stock } = scenario();
  const extra = structuredClone(catalog.definitions[2]!);
  extra.id = 6;
  extra.equipmentId = 1006;
  catalog.definitions[6] = extra;
  stock.push({ id: 6, count: 1 });
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 1), 1);
  stock.find((s) => s.id === 1)!.count = 0;
  assert.throws(() => selectEmptyEquipment(catalog, stock, 1, 1), /Ambiguous/);
});

test("empty registration can exceed Count without becoming a material-copy budget", () => {
  const { catalog, roster, stock } = scenario();
  stock.find((s) => s.id === 5)!.count = 1;
  validateEquipmentState(catalog, roster, stock);
  const registration = equipmentRegistrations(catalog, roster, stock).find((s) => s.id === 5)!;
  assert.equal(registration.count, 1);
  assert.equal(registration.equipped, 4);
  assert.deepEqual(registration.slots, [
    { ownerId: "owner:1", slot: 5 }, { ownerId: "owner:1", slot: 6 },
    { ownerId: "owner:2", slot: 5 }, { ownerId: "owner:2", slot: 6 },
  ]);
  assert.ok(equipmentAvailability(catalog, roster, stock).every((s) => !catalog.definitions[s.id]!.empty));
  registration.slots[0]!.slot = 1;
  assert.equal(equipmentRegistrations(catalog, roster, stock).find((s) => s.id === 5)!.slots[0]!.slot, 5);
});

test("already worn zero-count empty identity remains valid but cannot be newly selected", () => {
  const { catalog, roster, stock } = scenario();
  stock.find((s) => s.id === 5)!.count = 0;
  validateEquipmentLoadout(catalog, roster[0]!);
  validateEquipmentState(catalog, roster, stock);
  assert.equal(selectEmptyEquipment(catalog, stock, 1, 5), null);
  assert.deepEqual(previewEquipmentChange(catalog, roster, stock, "owner:1", 5, 5).changes, []);
  stock.push({ id: 501, count: 1 });
  const worn = previewEquipmentChange(catalog, roster, stock, "owner:1", 5, 501);
  const before = structuredClone(worn);
  assert.throws(() => previewEquipmentChange(catalog, worn.roster, worn.stock, "owner:1", 5, 5), /No owned empty/);
  assert.deepEqual(worn, before);
  validateEquipmentState(catalog, roster, stock.filter((s) => s.id !== 5));
});

test("SetEquip changes registration while preserving every Count including shared empty copies", () => {
  const { catalog, roster, stock } = scenario();
  stock.find((s) => s.id === 1)!.count = 1;
  const before = structuredClone({ roster, stock });
  let next = previewEquipmentChange(catalog, roster, stock, "owner:1", 1, 1);
  next = previewEquipmentChange(catalog, next.roster, next.stock, "owner:2", 2, 1);
  assert.deepEqual(next.stock, stock);
  assert.equal(equipmentRegistrations(catalog, next.roster, next.stock).find((s) => s.id === 1)!.equipped, 2);
  assert.equal(equipmentAvailability(catalog, next.roster, next.stock).find((s) => s.id === 101)!.available, 1);
  assert.deepEqual({ roster, stock }, before);
});

test("automatic other-hand removal needs an owned default and fails atomically without one", () => {
  const { catalog, roster, stock } = scenario();
  stock.find((s) => s.id === 102)!.count++;
  for (const id of [1, 2]) stock.find((s) => s.id === id)!.count = 0;
  const before = structuredClone({ roster, stock });
  assert.throws(() => previewEquipmentChange(catalog, roster, stock, "owner:1", 2, 102), /No owned empty/);
  assert.deepEqual({ roster, stock }, before);
  stock.find((s) => s.id === 2)!.count = 1;
  const next = previewEquipmentChange(catalog, roster, stock, "owner:1", 2, 102);
  assert.deepEqual(next.roster[0]!.equipment.slice(0, 2), [2, 102]);
  assert.deepEqual(next.changes, [{ slot: 2, from: 201, to: 102 }, { slot: 1, from: 101, to: 2 }]);
  assert.deepEqual(next.stock, stock);
});

test("equipping a shield resets the other Armor pointer even when it was an empty shield", () => {
  const { catalog, roster, stock } = scenario();
  roster[0]!.equipment[0] = 2;
  stock.push({ id: 202, count: 1 });
  const before = structuredClone({ roster, stock });
  const changed = previewEquipmentChange(catalog, roster, stock, "owner:1", 2, 202);
  assert.deepEqual(changed.roster[0]!.equipment.slice(0, 2), [1, 202]);
  assert.deepEqual(changed.changes, [{ slot: 2, from: 201, to: 202 }, { slot: 1, from: 2, to: 1 }]);
  assert.deepEqual(changed.stock, stock);
  assert.deepEqual({ roster, stock }, before);
  for (const id of [1, 2]) stock.find((s) => s.id === id)!.count = 0;
  const missing = structuredClone({ roster, stock });
  assert.throws(() => previewEquipmentChange(catalog, roster, stock, "owner:1", 2, 202), /No owned empty/);
  assert.deepEqual({ roster, stock }, missing);
});

test("empty ownership records retain the same strict identity/count validation as ordinary stock", () => {
  const { catalog, roster, stock } = scenario();
  for (const count of [-1, 100, Number.NaN, 1.5]) {
    const malformed = stock.map((s) => s.id === 1 ? { ...s, count } : s);
    assert.throws(() => validateEquipmentState(catalog, roster, malformed), /integer/);
    assert.throws(() => selectEmptyEquipment(catalog, malformed, 1, 1), /integer/);
  }
  assert.throws(() => validateEquipmentState(catalog, roster, [...stock, { id: 1, count: 1 }]), /Duplicate/);
  assert.throws(() => selectEmptyEquipment(catalog, [{ id: 999, count: 1 }], 1, 1), /Unknown/);
  const malformed = stock.map((s) => ({ ...s, available: 1 }));
  assert.throws(() => validateEquipmentState(catalog, roster, malformed), /stock record/);
});
