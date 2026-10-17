import test from "node:test";
import assert from "node:assert/strict";
import { magicStoneGrowthIncrement, projectAcquireMagicStone, projectEquipMagicStone,
  projectRemoveMagicStone, projectRemoveOwnedMagicStone, validateMagicStoneCatalog,
  projectRemoveInventoryMagicStone,
  validateMagicStoneOwnership, type MagicStoneMember } from "../src/core/magic-stones.js";
import { magicStoneCatalogFixture, magicStoneGrowthFixture } from "./fixtures/magic-stones.js";

function fixture() {
  const f = magicStoneGrowthFixture();
  const roster = [f.member, { ...structuredClone(f.member), id: "other-owner", sourceId: 3 }];
  return { ...f, roster, owned: [902, 901, 904] };
}

test("acquisition is a detached ordered content set; removal never fabricates equipped cleanup", () => {
  const f = fixture(), before = structuredClone(f.owned);
  assert.deepEqual(projectAcquireMagicStone(f.catalog, f.owned, 903), [902, 901, 904, 903]);
  const duplicate = projectAcquireMagicStone(f.catalog, f.owned, 901);
  assert.deepEqual(duplicate, before); assert.notEqual(duplicate, f.owned);
  assert.deepEqual(projectRemoveOwnedMagicStone(f.catalog, f.owned, f.roster, 901), [902, 904]);
  assert.throws(() => projectRemoveOwnedMagicStone(f.catalog, f.owned, f.roster, 903), /not held/);
  f.roster[0]!.magicStoneId = 901;
  assert.throws(() => projectRemoveOwnedMagicStone(f.catalog, f.owned, f.roster, 901), /separate lifecycle/);
  assert.deepEqual(f.owned, before);
  assert.throws(() => projectAcquireMagicStone(f.catalog, f.owned, 999), /Unknown/);
});

test("equip and enabled-owner transfer preserve all character resources and partial skills", () => {
  const f = fixture(), before = structuredClone(f.roster), id = f.roster[0]!.id;
  const first = projectEquipMagicStone(f.catalog, f.owned, f.roster, { ownedId: id, contentId: 901 }, f.plan.abilities);
  assert.deepEqual(first.changedIds, [id]);
  assert.equal(first.roster[0]!.magicStoneId, 901);
  assert.deepEqual(first.roster[0]!.abilities.commandIds, [...before[0]!.abilities.commandIds, 7]);
  assert.deepEqual(first.roster[0]!.abilities.owned, before[0]!.abilities.owned);
  assert.equal(first.roster[0]!.abilities.owned.some(ability => ability.abilityId === 9101), false, "summon is not a persistent grant");
  const transferred = projectEquipMagicStone(f.catalog, f.owned, first.roster,
    { ownedId: "other-owner", contentId: 901 }, f.plan.abilities);
  assert.deepEqual(transferred.changedIds, [id, "other-owner"]);
  assert.equal(transferred.roster[0]!.magicStoneId, 0); assert.equal(transferred.roster[1]!.magicStoneId, 901);
  assert.deepEqual(transferred.roster[0]!.abilities.commandIds, before[0]!.abilities.commandIds);
  for (const [index, member] of transferred.roster.entries()) {
    assert.equal(member.hp, before[index]!.hp); assert.equal(member.mp, before[index]!.mp);
    assert.equal(member.exp, before[index]!.exp); assert.deepEqual(member.equipment, before[index]!.equipment);
    assert.deepEqual(member.abilities.owned, before[index]!.abilities.owned);
  }
  assert.deepEqual(f.roster, before);
});

test("same-stone selection removes while partial skills remain and exactly mastered ordinary magic retains command7", () => {
  const f = fixture(), id = f.roster[0]!.id;
  const equipped = projectEquipMagicStone(f.catalog, f.owned, f.roster, { ownedId: id, contentId: 901 }, f.plan.abilities);
  equipped.roster[0]!.abilities.owned.find(ability => ability.abilityId === 31)!.skillLevel = 99;
  const partial = projectEquipMagicStone(f.catalog, f.owned, equipped.roster, { ownedId: id, contentId: 901 }, f.plan.abilities);
  assert.equal(partial.roster[0]!.magicStoneId, 0);
  assert.equal(partial.roster[0]!.abilities.commandIds.includes(7), false);
  assert.equal(partial.roster[0]!.abilities.owned.find(ability => ability.abilityId === 31)!.skillLevel, 99);
  equipped.roster[0]!.abilities.owned.find(ability => ability.abilityId === 31)!.skillLevel = 100;
  const mastered = projectRemoveMagicStone(f.catalog, f.owned, equipped.roster, id, f.plan.abilities);
  assert.equal(mastered.roster[0]!.magicStoneId, 0); assert.equal(mastered.roster[0]!.abilities.commandIds.includes(7), true);
  assert.deepEqual(mastered.roster[0]!.abilities.owned, equipped.roster[0]!.abilities.owned);
});

test("alternative command31 suppresses insertion7 and removed command7 re-enters at the tail", () => {
  const f = fixture(), id = f.roster[0]!.id;
  f.roster[0]!.abilities.commandIds = [7, ...f.roster[0]!.abilities.commandIds];
  f.roster[0]!.magicStoneId = 901;
  const removed = projectRemoveMagicStone(f.catalog, f.owned, f.roster, id, f.plan.abilities);
  const equipped = projectEquipMagicStone(f.catalog, f.owned, removed.roster, { ownedId: id, contentId: 901 }, f.plan.abilities);
  assert.equal(equipped.roster[0]!.abilities.commandIds.at(-1), 7);
  removed.roster[0]!.abilities.commandIds.push(31);
  const alternative = projectEquipMagicStone(f.catalog, f.owned, removed.roster, { ownedId: id, contentId: 901 }, f.plan.abilities);
  assert.equal(alternative.roster[0]!.abilities.commandIds.includes(7), false);
  assert.equal(alternative.roster[0]!.abilities.commandIds.at(-1), 31);
});

test("source13/14, unheld stones, disabled owners and disabled associations stay explicit without partial transfer", () => {
  const f = fixture();
  for (const sourceId of [13, 14]) {
    const roster = structuredClone(f.roster); roster[0]!.sourceId = sourceId;
    assert.throws(() => projectEquipMagicStone(f.catalog, f.owned, roster,
      { ownedId: roster[0]!.id, contentId: 901 }, f.plan.abilities), /cannot equip/);
  }
  assert.throws(() => projectEquipMagicStone(f.catalog, f.owned, f.roster,
    { ownedId: f.roster[0]!.id, contentId: 903 }, f.plan.abilities), /not held/);
  const disabled = structuredClone(f.roster); disabled[1]!.enabled = false; disabled[1]!.magicStoneId = 901;
  const before = structuredClone(disabled);
  assert.throws(() => projectEquipMagicStone(f.catalog, f.owned, disabled,
    { ownedId: disabled[0]!.id, contentId: 901 }, f.plan.abilities), /Disabled.*separate lifecycle/);
  assert.throws(() => projectRemoveMagicStone(f.catalog, f.owned, disabled, "other-owner", f.plan.abilities), /enabled owned/);
  assert.deepEqual(disabled, before);
  disabled[0]!.magicStoneId = 901;
  validateMagicStoneOwnership(f.catalog, f.owned, disabled); // Does not invent all-held native uniqueness.
  disabled[1]!.enabled = true;
  assert.throws(() => validateMagicStoneOwnership(f.catalog, f.owned, disabled), /Duplicate enabled/);
});

test("late missing ability metadata and conflicting cross-owner metadata preserve the entire candidate input", () => {
  const f = fixture(), id = f.roster[0]!.id;
  const initial = projectEquipMagicStone(f.catalog, f.owned, f.roster, { ownedId: id, contentId: 901 }, f.plan.abilities);
  const before = structuredClone(initial.roster);
  assert.throws(() => projectEquipMagicStone(f.catalog, f.owned, initial.roster,
    { ownedId: "other-owner", contentId: 901 }, f.plan.abilities.filter(row => row.id !== 229)), /Unknown owned ability type/);
  assert.deepEqual(initial.roster, before);
  assert.throws(() => projectEquipMagicStone(f.catalog, f.owned, initial.roster,
    { ownedId: "other-owner", contentId: 901 }, [...f.plan.abilities, { id: 31, typeId: 999 }]), /Conflicting/);
  assert.deepEqual(initial.roster, before);
});

test("only supplied equipment passive copies bypass identity duplicates; removal keeps them intact", () => {
  const f = fixture(), id = f.roster[0]!.id, passive = { abilityId: 801, contentId: 9801, skillLevel: 0 };
  f.roster[0]!.abilities.owned.push(structuredClone(passive), structuredClone(passive));
  const passives = { [id]: [passive, passive] }, metadata = [...f.plan.abilities, { id: 801, typeId: 12 }];
  assert.throws(() => validateMagicStoneOwnership(f.catalog, f.owned, f.roster), /Duplicate/);
  const equipped = projectEquipMagicStone(f.catalog, f.owned, f.roster, { ownedId: id, contentId: 901 }, metadata, passives);
  const removed = projectRemoveMagicStone(f.catalog, f.owned, equipped.roster, id, metadata, passives);
  assert.deepEqual(removed.roster[0]!.abilities.owned.filter(ability => ability.abilityId === 801), [passive, passive]);
});

test("level bonuses use each increment and source parameter enum without current-max or additive-percent confusion", () => {
  const catalog = magicStoneCatalogFixture();
  assert.deepEqual(magicStoneGrowthIncrement(catalog, 901, 19, 5), { hp: 20, mp: 5, strength: 0, vitality: 0, agility: 0, magic: 0 });
  assert.deepEqual(magicStoneGrowthIncrement(catalog, 902, 19, 5), { hp: 19, mp: 5, strength: 0, vitality: 0, agility: 0, magic: 2 });
  assert.equal(magicStoneGrowthIncrement(catalog, 903, 19, 5).mp, 7);
  assert.equal(magicStoneGrowthIncrement(catalog, 904, 19, 5).strength, 1);
  const unchanged = magicStoneGrowthIncrement(catalog, 0, 19, 5);
  assert.equal(unchanged.hp, 19); assert.equal(unchanged.mp, 5);
  assert.throws(() => magicStoneGrowthIncrement(catalog, 901, 0x7fffffff, 1), /integer/);
});

test("catalog and held lists reject holes, accessors, identity drift, duplicate rows and unsupported summon claims", () => {
  const catalog = magicStoneCatalogFixture(); validateMagicStoneCatalog(catalog);
  for (const change of [
    (c: typeof catalog) => { c.stones[901]!.contentId = 902; },
    (c: typeof catalog) => { c.stones[901]!.learning.push(structuredClone(c.stones[901]!.learning[0]!)); },
    (c: typeof catalog) => { c.stones[901]!.summonBlockers = []; },
    (c: typeof catalog) => { c.stones[901]!.bonus.value = 0x80000000; },
    (c: typeof catalog) => { c.rules.excludedSourceIds.reverse(); },
    (c: typeof catalog) => { delete c.stones[901]!.learning[0]; },
  ]) { const bad = structuredClone(catalog); change(bad); assert.throws(() => validateMagicStoneCatalog(bad)); }
  let read = false;
  const bad = structuredClone(catalog);
  Object.defineProperty(bad.stones[901]!.bonus, "value", { enumerable: true, get() { read = true; return 10; } });
  assert.throws(() => validateMagicStoneCatalog(bad), /fields/); assert.equal(read, false);
  const sparse = [901, 902]; delete sparse[0];
  assert.throws(() => projectAcquireMagicStone(catalog, sparse, 903), /list/);
  assert.throws(() => projectAcquireMagicStone(catalog, [901, 901], 903), /Duplicate/);
  assert.throws(() => validateMagicStoneOwnership(catalog, [901], [{ id: "not-owned" } as MagicStoneMember]));
});

test("inventory manager removal of an absent held stone is a detached no-op rather than a direct-client failure", () => {
  const f = fixture(), before = structuredClone(f.roster), held = [902, 904];
  const result = projectRemoveInventoryMagicStone(f.catalog, held, f.roster, 901);
  assert.deepEqual(result, { heldIds: held, roster: before, changedIds: [] });
  assert.notEqual(result.heldIds, held); assert.notEqual(result.roster, f.roster);
  result.roster[0]!.hp = 0; result.heldIds.splice(0);
  assert.deepEqual(f.roster, before); assert.deepEqual(held, [902, 904]);
  assert.throws(() => projectRemoveOwnedMagicStone(f.catalog, held, f.roster, 901), /not held/);
});

test("inventory manager removes held order and only the first actual owner association, including a disabled owner", () => {
  const f = fixture(), first = f.roster[0]!;
  first.enabled = false; first.magicStoneId = 901; first.abilities.commandIds.push(7);
  f.roster[1]!.magicStoneId = 902;
  const before = structuredClone(f.roster), result = projectRemoveInventoryMagicStone(f.catalog, f.owned, f.roster, 901);
  assert.deepEqual(result.heldIds, [902, 904]); assert.deepEqual(result.changedIds, [first.id]);
  assert.equal(result.roster[0]!.magicStoneId, 0); assert.equal(result.roster[0]!.enabled, false);
  assert.deepEqual(result.roster[0]!.abilities, before[0]!.abilities, "association setter does not run menu command cleanup");
  assert.deepEqual(result.roster[1], before[1]);
  assert.deepEqual(f.roster, before); assert.deepEqual(f.owned, [902, 901, 904]);
  const noAssociation = projectRemoveInventoryMagicStone(f.catalog, f.owned, fixture().roster, 901);
  assert.deepEqual(noAssociation.heldIds, [902, 904]); assert.deepEqual(noAssociation.changedIds, []);
});

test("inventory manager and UI removal preserve their distinct command7 semantics for the same owned member", () => {
  const f = fixture(), id = f.roster[0]!.id;
  const equipped = projectEquipMagicStone(f.catalog, f.owned, f.roster, { ownedId: id, contentId: 901 }, f.plan.abilities);
  const inventory = projectRemoveInventoryMagicStone(f.catalog, f.owned, equipped.roster, 901);
  const menu = projectRemoveMagicStone(f.catalog, f.owned, equipped.roster, id, f.plan.abilities);
  assert.equal(inventory.roster[0]!.magicStoneId, 0); assert.equal(menu.roster[0]!.magicStoneId, 0);
  assert.equal(inventory.roster[0]!.abilities.commandIds.includes(7), true);
  assert.equal(menu.roster[0]!.abilities.commandIds.includes(7), false);
  assert.deepEqual(inventory.roster[0]!.abilities.owned, menu.roster[0]!.abilities.owned);
});

test("inventory removal cannot silently clear further associations or publish an unheld retained owner", () => {
  const f = fixture(); f.roster[0]!.enabled = false; f.roster[0]!.magicStoneId = 901;
  f.roster[1]!.magicStoneId = 901;
  validateMagicStoneOwnership(f.catalog, f.owned, f.roster); // Enabled-scope uniqueness alone permits this boundary.
  const before = structuredClone({ held: f.owned, roster: f.roster });
  assert.throws(() => projectRemoveInventoryMagicStone(f.catalog, f.owned, f.roster, 901), /leaves another association.*separate lifecycle/);
  assert.deepEqual({ held: f.owned, roster: f.roster }, before);
});
