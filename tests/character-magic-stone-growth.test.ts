import test from "node:test";
import assert from "node:assert/strict";
import { expectedOwnedGrowth, growCharacter, initialCharacterGrowth, learnObservedCharacter,
  projectCharacterMagicStone, validateCharacterGrowth, type CharacterGrowthProgress,
  projectCharacterInventoryMagicStoneRemoval,
  type CharacterGrowthReceipt } from "../src/core/character-growth.js";
import { characterGrowthFixture } from "./fixtures/character-growth.js";
import { magicStoneGrowthFixture } from "./fixtures/magic-stones.js";

const award = (amount: number, magicPoints: number, battleSerial: number, observedAbilityIds: number[] = []) =>
  ({ kind: "add-experience" as const, amount, context: "battle" as const, magicPoints, observedAbilityIds,
    learningReceipt: { battleSerial, participantIndex: 4 } });

test("the capability requires a complete journal while old plans retain the exact legacy progress shape", () => {
  const old = characterGrowthFixture();
  assert.deepEqual(Object.keys(initialCharacterGrowth()).sort(), ["additional", "additionalExp", "observedLearning"]);
  const legacy = growCharacter(old.plan, old.member, old.progress,
    { kind: "add-experience", amount: 70, context: "field" }, old.project);
  assert.equal(Object.hasOwn(legacy.progress, "history"), false);
  validateCharacterGrowth(old.plan, legacy.member, legacy.progress);
  const f = magicStoneGrowthFixture();
  assert.deepEqual(f.progress.history, []); validateCharacterGrowth(f.plan, f.member, f.progress);
  assert.throws(() => validateCharacterGrowth(f.plan, f.member, initialCharacterGrowth()), /fields/);
  assert.throws(() => validateCharacterGrowth(old.plan, old.member, f.progress), /fields/);
  assert.throws(() => projectCharacterMagicStone(old.plan, old.member, old.progress, 901), /capability/);
});

test("equipping alone changes association and command order without stats, skills, resources or the independent128 counter", () => {
  const f = magicStoneGrowthFixture(), member = { ...f.member, magicLearningValue: 128 }, before = structuredClone(member);
  const next = projectCharacterMagicStone(f.plan, member, f.progress, 901);
  assert.deepEqual(next.progress.history, [{ kind: "magic-stone", magicStoneId: 901 }]);
  assert.deepEqual(next.progress.additional, f.progress.additional);
  for (const key of ["hp", "mp", "maxHp", "maxMp", "exp", "level", "magicLearningValue"] as const)
    assert.equal(next.member[key], before[key]);
  assert.deepEqual(next.member.abilities.owned, before.abilities.owned);
  assert.deepEqual(next.member.abilities.commandIds, [...before.abilities.commandIds, 7]);
  const noop = projectCharacterMagicStone(f.plan, next.member, next.progress, 901);
  assert.deepEqual(noop, next); assert.notEqual(noop.member, next.member);
  assert.deepEqual(member, before);
});

test("no-level battle awards learn partial then mastered skills once, and stone removal retains them", () => {
  const f = magicStoneGrowthFixture(), equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const first = growCharacter(f.plan, equipped.member, equipped.progress, award(0, 20, 0), f.project);
  assert.equal(first.member.level, 2); assert.deepEqual(first.steps, []);
  assert.equal(first.member.abilities.owned.find(ability => ability.abilityId === 102)!.skillLevel, 40);
  assert.equal(first.member.abilities.owned.find(ability => ability.abilityId === 100)!.skillLevel, 20);
  assert.equal(first.member.abilities.byCommand.some(command => command.commandId === 7), false);
  const second = growCharacter(f.plan, first.member, first.progress, award(0, 40, 1), f.project);
  assert.equal(second.member.abilities.owned.find(ability => ability.abilityId === 102)!.skillLevel, 100);
  assert.equal(second.member.abilities.owned.find(ability => ability.abilityId === 100)!.skillLevel, 60);
  assert.deepEqual(second.member.abilities.byCommand.find(command => command.commandId === 7)!.abilityIds, [102]);
  assert.deepEqual(second.member.abilities.additionOrder, [603, 601, 606, 604]);
  const removed = projectCharacterMagicStone(f.plan, second.member, second.progress, 0);
  assert.equal(removed.member.magicStoneId, 0); assert.equal(removed.member.abilities.commandIds.includes(7), true);
  assert.deepEqual(removed.member.abilities.owned, second.member.abilities.owned);
  assert.deepEqual(second.learnedAbilityIdsToAppend, [], "Type2 does not append global acquired magic");
  validateCharacterGrowth(f.plan, removed.member, JSON.parse(JSON.stringify(removed.progress)));
  assert.throws(() => growCharacter(f.plan, first.member, first.progress, award(0, 40, 0), f.project), /Repeated or reordered/);
});

test("field and correction invoke Type2 with zero MagicPoint and still create skill0 in source row order", () => {
  const f = magicStoneGrowthFixture(), equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const field = growCharacter(f.plan, equipped.member, equipped.progress,
    { kind: "add-experience", amount: 0, context: "field" }, f.project);
  assert.deepEqual(field.member.abilities.owned.slice(-2).map(ability => [ability.abilityId, ability.skillLevel]), [[102, 0], [100, 0]]);
  assert.deepEqual(field.member.abilities.additionOrder, [603, 601, 606, 604]);
  const corrected = growCharacter(f.plan, equipped.member, equipped.progress,
    { kind: "correct-level", targetLevel: 3 }, f.project);
  assert.equal(corrected.member.level, 4); assert.equal(corrected.progress.additionalExp, 100);
  assert.equal(corrected.member.abilities.owned.find(ability => ability.abilityId === 102)!.skillLevel, 0);
  assert.deepEqual(corrected.steps.map(step => [step.level, step.hp]), [[3, 22], [4, 33]]);
  const receipt = corrected.progress.history!.at(-1)!;
  assert.equal(receipt.kind, "status-up"); if (receipt.kind !== "status-up") throw new Error("Missing StatusUp");
  assert.equal(receipt.magicPoints, 0); assert.equal(receipt.battleSerial, null);
});

test("level bonuses round per gained level and retain the stone actually used before later swaps", () => {
  const f = magicStoneGrowthFixture(); f.plan.growth[2]!.hp = 19; f.plan.growth[3]!.hp = 29;
  const equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const first = growCharacter(f.plan, equipped.member, equipped.progress, award(70, 1, 0), f.project);
  assert.equal(first.progress.additional.hp, 20);
  const other = projectCharacterMagicStone(f.plan, first.member, first.progress, 902);
  const second = growCharacter(f.plan, other.member, other.progress, award(20, 2, 1), f.project);
  assert.equal(second.progress.additional.hp, 49); assert.equal(second.progress.additional.magic, 2);
  const removed = projectCharacterMagicStone(f.plan, second.member, second.progress, 0);
  assert.equal(removed.progress.additional.hp, 49); assert.equal(removed.progress.additional.magic, 2);
  assert.equal(expectedOwnedGrowth(f.plan, removed.progress).additional.hp, 49);
  const bulk = growCharacter(f.plan, equipped.member, equipped.progress, award(90, 1, 0), f.project);
  assert.equal(bulk.progress.additional.hp, 51, "20+31, not one percentage on the summed48");
  const raw = bulk.progress.history!.find((receipt): receipt is Extract<CharacterGrowthReceipt, { kind: "status-up" }> => receipt.kind === "status-up")!;
  assert.deepEqual(raw.steps.map(step => step.additional.hp), [20, 31]);
  validateCharacterGrowth(f.plan, removed.member, JSON.parse(JSON.stringify(removed.progress)));
});

test("natural then stone then observed learning preserves chronology across later natural levels", () => {
  const f = magicStoneGrowthFixture(true);
  f.catalog.stones[901]!.learning.push({ id: 205, contentId: 742, abilityId: 142, rate: 1 });
  const equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const first = growCharacter(f.plan, equipped.member, equipped.progress, award(70, 50, 0, [161, 142]), f.project);
  assert.deepEqual(first.member.abilities.owned.slice(-3).map(ability => ability.abilityId), [100, 102, 161]);
  assert.equal(first.member.abilities.owned.find(ability => ability.abilityId === 100)!.skillLevel, 100, "natural learning precedes the lower-rate stone row");
  assert.equal(first.member.abilities.owned.find(ability => ability.abilityId === 142)!.skillLevel, 100, "observation follows partial stone learning");
  assert.deepEqual(first.member.abilities.additionOrder, [603, 601, 602, 604, 606, 742]);
  assert.equal(first.member.abilities.additionOrder.includes(761), false, "observed new skills do not enter source acquisition order");
  assert.deepEqual(first.progress.observedLearning, [{ battleSerial: 0, participantIndex: 4, level: 3, observedAbilityIds: [142, 161] }]);
  const next = growCharacter(f.plan, first.member, first.progress,
    { kind: "add-experience", amount: 20, context: "field" }, f.project);
  assert.deepEqual(next.member.abilities.owned.slice(-4).map(ability => ability.abilityId), [100, 102, 161, 101]);
  validateCharacterGrowth(f.plan, next.member, JSON.parse(JSON.stringify(next.progress)));
});

test("experience-ineligible observation has no stone-learning or ordinary-provider side effects", () => {
  const f = magicStoneGrowthFixture(true), equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  f.plan.hasBattleBackgroundLearning = true; equipped.member.equipment[0] = 207; equipped.member.hp = 0;
  const result = learnObservedCharacter(f.plan, equipped.member, equipped.progress, [161], { battleSerial: 0, participantIndex: 7 });
  assert.equal(result.member.hp, 0); assert.deepEqual(result.progress.additional, equipped.progress.additional);
  assert.equal(result.member.abilities.owned.some(ability => ability.abilityId === 102), false);
  assert.equal(result.progress.history!.at(-1)!.kind, "observed-learning");
  validateCharacterGrowth(f.plan, result.member, result.progress);
  assert.throws(() => growCharacter(f.plan, equipped.member, equipped.progress, award(0, 5, 1), f.project), /battle background/);
});

test("association receipts restore removed initialization command7 at its new append position and preserve command31", () => {
  const f = magicStoneGrowthFixture();
  for (const abilities of [f.plan.initialAbilities, f.member.abilities]) abilities.commandIds.unshift(7);
  const equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const removed = projectCharacterMagicStone(f.plan, equipped.member, equipped.progress, 0);
  assert.deepEqual(removed.member.abilities.commandIds, f.member.abilities.commandIds.slice(1));
  const again = projectCharacterMagicStone(f.plan, removed.member, removed.progress, 902);
  assert.equal(again.member.abilities.commandIds.at(-1), 7);
  assert.notDeepEqual(again.member.abilities.commandIds, f.plan.initialAbilities.commandIds);
  validateCharacterGrowth(f.plan, again.member, JSON.parse(JSON.stringify(again.progress)));
  const other = magicStoneGrowthFixture();
  for (const abilities of [other.plan.initialAbilities, other.member.abilities]) abilities.commandIds.push(31);
  const withAlternative = projectCharacterMagicStone(other.plan, other.member, other.progress, 901);
  assert.equal(withAlternative.member.abilities.commandIds.includes(7), false);
  const without = projectCharacterMagicStone(other.plan, withAlternative.member, withAlternative.progress, 0);
  assert.equal(without.member.abilities.commandIds.at(-1), 31);
});

test("partial skills survive across different stones sharing the same ability and do not create duplicate skill owners", () => {
  const f = magicStoneGrowthFixture(), firstStone = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const first = growCharacter(f.plan, firstStone.member, firstStone.progress, award(0, 15, 0), f.project);
  const different = projectCharacterMagicStone(f.plan, first.member, first.progress, 904);
  const next = growCharacter(f.plan, different.member, different.progress, award(0, 20, 1), f.project);
  assert.equal(next.member.abilities.owned.find(ability => ability.abilityId === 102)!.skillLevel, 90);
  assert.equal(next.member.abilities.owned.filter(ability => ability.abilityId === 102).length, 1);
  assert.equal(next.member.abilities.additionOrder.filter(id => id === 606).length, 1);
});

test("equipment copies retain placement through the new journal and learned stone abilities cannot alias passives", () => {
  const f = magicStoneGrowthFixture(), passive = { abilityId: 801, contentId: 9801, skillLevel: 0 }, passives = [passive, passive];
  f.member.abilities.owned.push(...structuredClone(passives));
  const equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901, passives);
  const next = growCharacter(f.plan, equipped.member, equipped.progress, award(70, 10, 0), f.project, passives);
  assert.deepEqual(next.member.abilities.owned.map(ability => ability.abilityId), [220, 31, 229, 801, 801, 100, 102]);
  assert.deepEqual(next.member.abilities.owned.filter(ability => ability.abilityId === 801), passives);
  validateCharacterGrowth(f.plan, next.member, next.progress, passives);
  const conflicting = [...passives, { abilityId: 102, contentId: 606, skillLevel: 0 }];
  assert.throws(() => validateCharacterGrowth(f.plan, next.member, next.progress, conflicting), /mismatch|conflicts/);
});

test("strict restore refuses omitted, reordered or forged growth/association/award details", () => {
  const f = magicStoneGrowthFixture(), equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const good = growCharacter(f.plan, equipped.member, equipped.progress, award(70, 25, 0), f.project);
  const status = (progress: CharacterGrowthProgress) => progress.history![1] as Extract<CharacterGrowthReceipt, { kind: "status-up" }>;
  for (const change of [
    (copy: typeof good) => { delete copy.progress.history; },
    (copy: typeof good) => { copy.progress.history!.reverse(); },
    (copy: typeof good) => { status(copy.progress).magicStoneId = 902; },
    (copy: typeof good) => { status(copy.progress).magicPoints++; },
    (copy: typeof good) => { status(copy.progress).steps[0]!.additional.hp++; },
    (copy: typeof good) => { status(copy.progress).steps[0]!.learnedAbilityIds.reverse(); },
    (copy: typeof good) => { status(copy.progress).battleSerial = -1; },
    (copy: typeof good) => { copy.progress.history!.push(structuredClone(status(copy.progress))); },
    (copy: typeof good) => { copy.progress.additional.magic++; },
    (copy: typeof good) => { copy.member.magicStoneId = 902; },
    (copy: typeof good) => { copy.member.abilities.owned.find(ability => ability.abilityId === 102)!.skillLevel++; },
    (copy: typeof good) => { delete copy.progress.history![0]; },
  ]) {
    const copy = structuredClone(good); change(copy);
    assert.throws(() => validateCharacterGrowth(f.plan, copy.member, copy.progress));
  }
  let accessed = false;
  const bad = structuredClone(good.progress);
  Object.defineProperty(status(bad), "magicPoints", { enumerable: true, get() { accessed = true; return 25; } });
  assert.throws(() => expectedOwnedGrowth(f.plan, bad), /history fields/); assert.equal(accessed, false);
  validateCharacterGrowth(f.plan, JSON.parse(JSON.stringify(good.member)), JSON.parse(JSON.stringify(good.progress)));
});

test("missing battle awards, unsupported providers, late parameter faults and overflow never mutate the original owners", () => {
  const f = magicStoneGrowthFixture(), equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const before = structuredClone(equipped);
  assert.throws(() => growCharacter(f.plan, equipped.member, equipped.progress,
    { kind: "add-experience", amount: 0, context: "battle", observedAbilityIds: [] }, f.project), /MagicPoint/);
  assert.throws(() => growCharacter(f.plan, equipped.member, equipped.progress, award(70, 5, 0), (member, progress) => {
    member.abilities.owned.splice(0); progress.history!.splice(0); throw new Error("Controlled late parameter fault");
  }), /late parameter fault/);
  assert.deepEqual(equipped, before);
  const overflowing = structuredClone(f.plan); overflowing.magicStones!.stones[901]!.learning[0]!.rate = 0x7fffffff;
  assert.throws(() => growCharacter(overflowing, equipped.member, equipped.progress, award(0, 2, 0), f.project), /integer/);
  assert.deepEqual(equipped, before);
  const equipment = { ...equipped.member, equipment: [207] };
  assert.throws(() => growCharacter(f.plan, equipment, equipped.progress,
    { kind: "add-experience", amount: 0, context: "field" }, f.project), /equipment learning/);
  for (const sourceId of [13, 14]) {
    const plan = { ...f.plan, sourceId }, member = { ...f.member, sourceId };
    assert.throws(() => projectCharacterMagicStone(plan, member, f.progress, 901), /association history/);
  }
});

test("inventory association removal retains partial skills and command7, while later growth uses zero stone", () => {
  const f = magicStoneGrowthFixture(), equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const partial = growCharacter(f.plan, equipped.member, equipped.progress, award(0, 10, 0), f.project);
  const before = structuredClone(partial);
  const inventory = projectCharacterInventoryMagicStoneRemoval(f.plan, partial.member, partial.progress);
  assert.equal(inventory.member.magicStoneId, 0);
  assert.deepEqual(inventory.member.abilities, partial.member.abilities);
  assert.deepEqual(inventory.progress.history!.at(-1), { kind: "inventory-remove-magic-stone" });
  const ui = projectCharacterMagicStone(f.plan, partial.member, partial.progress, 0);
  assert.equal(inventory.member.abilities.commandIds.includes(7), true); assert.equal(ui.member.abilities.commandIds.includes(7), false);
  const later = growCharacter(f.plan, inventory.member, inventory.progress,
    { kind: "add-experience", amount: 70, context: "field" }, f.project);
  assert.equal(later.progress.additional.hp, 20, "new level has no removed HP stone bonus");
  assert.equal(later.member.abilities.owned.find(ability => ability.abilityId === 102)!.skillLevel, 20);
  assert.deepEqual(partial, before);
  validateCharacterGrowth(f.plan, inventory.member, JSON.parse(JSON.stringify(inventory.progress)));
  validateCharacterGrowth(f.plan, later.member, JSON.parse(JSON.stringify(later.progress)));
});

test("inventory removal preserves earned per-level increments and works on an actual disabled holder", () => {
  const f = magicStoneGrowthFixture(), equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const gained = growCharacter(f.plan, equipped.member, equipped.progress, award(70, 5, 0), f.project);
  gained.member.enabled = false;
  const removed = projectCharacterInventoryMagicStoneRemoval(f.plan, gained.member, gained.progress);
  assert.equal(removed.member.enabled, false); assert.equal(removed.progress.additional.hp, 22);
  assert.deepEqual(removed.member.abilities, gained.member.abilities);
  const next = growCharacter(f.plan, removed.member, removed.progress,
    { kind: "add-experience", amount: 20, context: "field" }, f.project);
  assert.equal(next.progress.additional.hp, 52, "old22 stays; next level adds base30");
  validateCharacterGrowth(f.plan, next.member, JSON.parse(JSON.stringify(next.progress)));
});

test("inventory history cannot be relabelled as UI cleanup, repeated on an empty association, or extended with invented fields", () => {
  const f = magicStoneGrowthFixture(), equipped = projectCharacterMagicStone(f.plan, f.member, f.progress, 901);
  const removed = projectCharacterInventoryMagicStoneRemoval(f.plan, equipped.member, equipped.progress);
  const uiRelabel = structuredClone(removed.progress);
  uiRelabel.history![1] = { kind: "magic-stone", magicStoneId: 0 };
  assert.throws(() => validateCharacterGrowth(f.plan, removed.member, uiRelabel), /disagrees/);
  const duplicate = structuredClone(removed.progress);
  duplicate.history!.push({ kind: "inventory-remove-magic-stone" });
  assert.throws(() => validateCharacterGrowth(f.plan, removed.member, duplicate), /No-op inventory/);
  const invented = structuredClone(removed.progress);
  Object.assign(invented.history![1]!, { commandId: 7 });
  assert.throws(() => validateCharacterGrowth(f.plan, removed.member, invented), /fields/);
  const noop = projectCharacterInventoryMagicStoneRemoval(f.plan, removed.member, removed.progress);
  assert.deepEqual(noop, removed); assert.notEqual(noop.member, removed.member);
});
