import test from "node:test";
import assert from "node:assert/strict";
import { projectAbilityCost } from "../src/core/ability-cost.js";
import { applyEquipmentAbilityChange, validateEquipmentAbilityOwnership, previewEquipmentChange,
  initialEquipmentStock, equipmentAvailability, projectEquipmentParameters } from "../src/core/equipment.js";
import { abilityCostFixture } from "./fixtures/ability-cost.js";
import { equipmentContext, equipmentLimits } from "./fixtures/equipment.js";

test("MP provider preserves zero, rounds positive odd costs away from zero and uses float32 input", () => {
  const { catalog, roster } = abilityCostFixture(), loadout = roster[0]!;
  loadout.equipment[4] = 701;
  const owner = { side: "player" as const, catalog, loadout };
  for (const [cost, expected] of [[0, 0], [1, 1], [2, 1], [3, 2], [5, 3], [999, 500], [16777217, 8388608]]) {
    const result = projectAbilityCost({ id: 31, cost: cost! }, owner);
    assert.equal(result.mp, expected);
    assert.equal(result.modifier, cost === 0 ? "none" : "half");
  }
  assert.equal(projectAbilityCost({ id: 31, cost: 5 }, { side: "enemy" }).mp, 5);
  assert.throws(() => projectAbilityCost({ id: 154, cost: 1 }, owner), /Unresolved/);
  for (const cost of [-1, 0.5, NaN, Infinity, 0x80000000])
    assert.throws(() => projectAbilityCost({ id: 31, cost }, owner), /Invalid/);
});

test("one-MP priority is independent of accessory order and duplicate halves do not stack", () => {
  const { catalog, roster } = abilityCostFixture(), loadout = roster[0]!;
  for (const [slots, expected, modifier] of [
    [[5, 5], 5, "none"], [[701, 701], 3, "half"], [[702, 702], 1, "one"],
    [[701, 702], 1, "one"], [[702, 701], 1, "one"],
  ] as const) {
    loadout.equipment.splice(4, 2, ...slots);
    const before = structuredClone(loadout);
    const result = projectAbilityCost({ id: 31, cost: 5 }, { side: "player", catalog, loadout });
    assert.equal(result.mp, expected); assert.equal(result.modifier, modifier);
    assert.deepEqual(loadout, before);
    result.contentIds.splice(0);
    assert.deepEqual(loadout, before);
    assert.equal(projectAbilityCost({ id: 31, cost: 0 }, { side: "player", catalog, loadout }).mp, 0);
  }
});

test("invalid loadout cannot receive a discount even when base cost is zero", () => {
  const { catalog, roster } = abilityCostFixture(), loadout = roster[0]!;
  const owner = { side: "player" as const, catalog, loadout };
  loadout.equipment[2] = 701;
  assert.throws(() => projectAbilityCost({ id: 31, cost: 0 }, owner), /slot mismatch/);
  loadout.equipment[2] = 301; loadout.equipment[4] = 701;
  catalog.definitions[701]!.jobIds = [2];
  assert.throws(() => projectAbilityCost({ id: 31, cost: 5 }, owner), /job mismatch/);
  catalog.definitions[701]!.jobIds = [1]; catalog.definitions[701]!.blockers.push("unknown provider");
  assert.throws(() => projectAbilityCost({ id: 31, cost: 5 }, owner), /Unimplemented equipment/);
});

test("FixedEquip adds one passive per copy and removes only the first matching record", () => {
  const { catalog, roster } = abilityCostFixture(), before = roster[0]!;
  let current = structuredClone(before), owned = [{ abilityId: 31, contentId: 1001, skillLevel: 100 }];
  const history = structuredClone(owned);
  for (const [slot, id] of [[4, 701], [5, 701], [4, 702], [5, 5], [4, 5]]) {
    const next = structuredClone(current); next.equipment[slot!] = id!;
    const oldOwned = structuredClone(owned);
    const result = applyEquipmentAbilityChange(owned, current, next, catalog);
    assert.deepEqual(owned, oldOwned);
    owned = result; current = next;
    validateEquipmentAbilityOwnership(catalog, current, owned);
    assert.equal(owned.filter((a) => a.abilityId === 7011).length, current.equipment.filter((i) => i === 701).length);
    assert.equal(owned.filter((a) => a.abilityId === 7021).length, current.equipment.filter((i) => i === 702).length);
    assert.deepEqual(owned[0], history[0]);
    assert.ok(owned.slice(1).every((a) => a.skillLevel === 0));
  }
  assert.deepEqual(owned, history);
});

test("equipment and passive candidates cancel cleanly, conserve copies across owners and reject stale state", () => {
  const { catalog, roster } = abilityCostFixture();
  const stock = [...initialEquipmentStock(catalog, roster), { id: 701, count: 1 }];
  const initial = structuredClone({ roster, stock });
  const proposal = previewEquipmentChange(catalog, roster, stock, roster[0]!.id, 5, 701);
  const passive = applyEquipmentAbilityChange([], roster[0]!, proposal.roster[0]!, catalog);
  assert.deepEqual({ roster, stock }, initial, "discarding a proposal mutates neither source");
  assert.equal(equipmentAvailability(catalog, proposal.roster, stock).find((i) => i.id === 701)!.available, 0);
  assert.throws(() => previewEquipmentChange(catalog, proposal.roster, stock, roster[1]!.id, 5, 701), /No available/);
  assert.throws(() => applyEquipmentAbilityChange([], proposal.roster[0]!, roster[0]!, catalog), /mismatch/);
  assert.throws(() => validateEquipmentAbilityOwnership(catalog, roster[0]!, passive), /mismatch/);
  assert.throws(() => validateEquipmentAbilityOwnership(catalog, proposal.roster[0]!, [{ ...passive[0]!, skillLevel: 100 }]), /mismatch/);
  assert.deepEqual(applyEquipmentAbilityChange(passive, proposal.roster[0]!, roster[0]!, catalog), []);
});

test("MP passive does not replace direct equipment parameters or physical projection", () => {
  const { catalog, roster } = abilityCostFixture();
  const before = projectEquipmentParameters(catalog, roster[0]!.equipment, equipmentContext(), equipmentLimits);
  roster[0]!.equipment[4] = 701;
  const after = projectEquipmentParameters(catalog, roster[0]!.equipment, equipmentContext(), equipmentLimits);
  assert.equal(after.parameters.weight, before.parameters.weight + 2);
  assert.equal(after.parameters.hp, before.parameters.hp);
  assert.equal(after.parameters.mp, before.parameters.mp);
  assert.deepEqual(after.physicalByArm, before.physicalByArm);
});
