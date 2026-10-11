import { fixtureEquipmentGrants } from "./fixtures/equipment.js";
import test from "node:test";
import assert from "node:assert/strict";
import { projectEquipmentOwnership } from "../src/core/inventory-ownership.js";
import {
  equipmentAvailability,
  initialEquipmentStock,
  previewEquipmentChange,
} from "../src/core/equipment.js";
import { equipmentCatalog, equipmentRoster } from "./fixtures/equipment.js";

test("source equipment grants add to total ownership, including worn copies, without changing loadouts", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog);
  const stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  const before = structuredClone({ catalog, roster, stock });
  const next = projectEquipmentOwnership(catalog, roster, stock, {
    kind: "grant-equipment",
    id: 101,
    count: 2,
  });
  assert.deepEqual(
    equipmentAvailability(catalog, roster, next).find(
      (entry) => entry.id === 101,
    ),
    { id: 101, count: 3, equipped: 1, available: 2 },
  );
  assert.deepEqual({ catalog, roster, stock }, before);
  next[0]!.count = 99;
  assert.deepEqual({ catalog, roster, stock }, before);
  const capped = projectEquipmentOwnership(catalog, roster, stock, {
    kind: "grant-equipment",
    id: 101,
    count: 0x7fffffff,
  });
  assert.equal(capped.find((entry) => entry.id === 101)!.count, 99);
  assert.equal(
    equipmentAvailability(catalog, roster, capped).find(
      (entry) => entry.id === 101,
    )!.available,
    98,
  );
});

test("equipment receipt feeds the existing swap transaction without creating a second inventory", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog);
  const stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  assert.throws(
    () => previewEquipmentChange(catalog, roster, stock, "owner:1", 1, 102),
    /No available/,
  );
  const received = projectEquipmentOwnership(catalog, roster, stock, {
    kind: "grant-equipment",
    id: 102,
    count: 1,
  });
  const swapped = previewEquipmentChange(
    catalog,
    roster,
    received,
    "owner:1",
    1,
    102,
  );
  assert.deepEqual(swapped.stock, received);
  assert.equal(swapped.roster[0]!.equipment[0], 102);
  assert.deepEqual(
    equipmentAvailability(catalog, swapped.roster, swapped.stock).find(
      (entry) => entry.id === 102,
    ),
    { id: 102, count: 2, equipped: 2, available: 0 },
  );
});

test("equipment removal exhausts spare stock but blocks unimplemented worn-count deficits atomically", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog);
  const stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  const received = projectEquipmentOwnership(catalog, roster, stock, {
    kind: "grant-equipment",
    id: 102,
    count: 1,
  });
  const removed = projectEquipmentOwnership(catalog, roster, received, {
    kind: "remove-equipment",
    id: 102,
    count: 1,
  });
  assert.deepEqual(removed, stock);
  const before = structuredClone({ roster, received });
  for (const count of [2, 99, 0x7fffffff])
    assert.throws(
      () =>
        projectEquipmentOwnership(catalog, roster, received, {
          kind: "remove-equipment",
          id: 102,
          count,
        }),
      /Unimplemented removal of equipped ownership/,
    );
  assert.deepEqual(
    { roster, received },
    before,
    "non-active roster ownership must not be silently unequipped or clamped",
  );
  const spare = projectEquipmentOwnership(catalog, roster, stock, {
    kind: "grant-equipment",
    id: 202,
    count: 2,
  });
  const exhausted = projectEquipmentOwnership(catalog, roster, spare, {
    kind: "remove-equipment",
    id: 202,
    count: 9,
  });
  assert.equal(exhausted.find((entry) => entry.id === 202)!.count, 0);
  assert.deepEqual(
    projectEquipmentOwnership(catalog, roster, stock, {
      kind: "remove-equipment",
      id: 202,
      count: 9,
    }),
    stock,
  );
});

test("unsupported wear effects may be held but receipt does not authorize equipping", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog);
  catalog.definitions[202]!.blockers = ["synthetic unimplemented wear effect"];
  catalog.definitions[202]!.parameter = null;
  const stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  const received = projectEquipmentOwnership(catalog, roster, stock, {
    kind: "grant-equipment",
    id: 202,
    count: 1,
  });
  assert.equal(received.find((entry) => entry.id === 202)!.count, 1);
  assert.throws(
    () => previewEquipmentChange(catalog, roster, received, "owner:1", 2, 202),
    /Unimplemented equipment effects/,
  );
  assert.equal(
    projectEquipmentOwnership(catalog, roster, received, {
      kind: "remove-equipment",
      id: 202,
      count: 1,
    }).find((entry) => entry.id === 202)!.count,
    0,
  );
});

test("equipment ownership rejects empty placeholders, unknown identities and malformed amounts", () => {
  const catalog = equipmentCatalog(),
    roster = equipmentRoster(catalog);
  const stock = initialEquipmentStock(catalog, roster, fixtureEquipmentGrants(catalog));
  const before = structuredClone({ catalog, roster, stock });
  for (const id of [0, 1, 2, 3, 4, 5, 999])
    assert.throws(() =>
      projectEquipmentOwnership(catalog, roster, stock, {
        kind: "grant-equipment",
        id,
        count: 1,
      }),
    );
  for (const count of [-1, 0, 0.5, NaN, 0x80000000])
    assert.throws(() =>
      projectEquipmentOwnership(catalog, roster, stock, {
        kind: "remove-equipment",
        id: 101,
        count,
      }),
    );
  assert.deepEqual({ catalog, roster, stock }, before);
});
