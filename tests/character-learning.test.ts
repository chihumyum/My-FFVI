import test from "node:test";
import assert from "node:assert/strict";
import { applyObservedLearning, observeLearningAction } from "../src/core/character-learning.js";
import { expectedOwnedGrowth, growCharacter, learnObservedCharacter, validateCharacterGrowth } from "../src/core/character-growth.js";
import { characterLearningFixture } from "./fixtures/character-learning.js";

const context = { battleSerial: 0, participantIndex: 0 };
test("observation selects the first source8 unit and respects all source forbidden condition types", () => {
  const f = characterLearningFixture();
  const observer = { sourceId: 8, conditionTypes: [] as number[], abilities: f.member.abilities };
  assert.deepEqual(observeLearningAction(f.catalog, { id: 142, typeId: 504 }, [observer]), [142]);
  assert.deepEqual(observeLearningAction(f.catalog, { id: 142, typeId: 504 }, [{ ...observer, sourceId: 9 }]), []);
  for (const type of f.catalog.forbiddenConditionTypes)
    assert.deepEqual(observeLearningAction(f.catalog, { id: 142, typeId: 504 },
      [{ ...observer, conditionTypes: [type] }, observer]), [], String(type));
  assert.deepEqual(observeLearningAction(f.catalog, { id: 142, typeId: 504 }, [{ ...observer, conditionTypes: [4,607] }]), [142]);
  assert.deepEqual(observeLearningAction(f.catalog, { id: 142, typeId: 1 }, [observer]), []);
  assert.throws(() => observeLearningAction(f.catalog, { id: 999, typeId: 504 }, [observer]), /Missing source/);
  assert.throws(() => observeLearningAction(f.catalog, { id: 142, typeId: 504 }, [{ ...observer, abilities: null }]), /Missing source/);
});

test("raw recipient ability74 differs from the live observer's skill100 command filter", () => {
  const f = characterLearningFixture();
  const learned = applyObservedLearning(f.catalog, f.member.abilities, [142]);
  assert.equal(learned.abilities.owned.find((a) => a.abilityId === 142)!.skillLevel, 100);
  assert.equal(learned.abilities.owned.find((a) => a.abilityId === 74)!.skillLevel, 0);
  assert.deepEqual(observeLearningAction(f.catalog, { id: 142, typeId: 504 },
    [{ sourceId: 8, conditionTypes: [], abilities: learned.abilities }]), []);
  const noRecipient = structuredClone(f.member.abilities);
  noRecipient.owned = noRecipient.owned.filter((a) => a.abilityId !== 74);
  assert.deepEqual(applyObservedLearning(f.catalog, noRecipient, [142]).abilities, noRecipient);
  assert.deepEqual(observeLearningAction(f.catalog, { id: 142, typeId: 504 },
    [{ sourceId: 8, conditionTypes: [], abilities: noRecipient }]), [142], "observation does not itself require ability74");
});

test("learning uses master order and exchange mapping, without touching acquisition/sort history", () => {
  const f = characterLearningFixture(), before = structuredClone(f.member.abilities);
  const result = applyObservedLearning(f.catalog, f.member.abilities, [1350,161,142]);
  assert.deepEqual(result.ownedMagicToAppend, [742,761,760]);
  assert.deepEqual(result.abilities.owned.slice(-2).map((a) => a.abilityId), [161,160]);
  assert.deepEqual(result.abilities.additionOrder, before.additionOrder);
  assert.deepEqual(result.abilities.sortOrder, before.sortOrder);
  assert.deepEqual(f.member.abilities, before);
  assert.deepEqual(applyObservedLearning(f.catalog, result.abilities, [142]).abilities, result.abilities);
});

test("persistent observation receipts replay between natural-learning levels, with raw owned order intact", () => {
  const f = characterLearningFixture();
  const first = growCharacter(f.plan, f.member, f.progress,
    { kind: "add-experience", amount: 70, context: "battle", observedAbilityIds: [161,142], learningReceipt: context }, f.project);
  assert.equal(first.member.level, 3);
  assert.deepEqual(first.progress.observedLearning, [{ ...context, level: 3, observedAbilityIds: [142,161] }]);
  assert.deepEqual(first.member.abilities.owned.slice(-2).map((a) => a.abilityId), [100,161]);
  const next = growCharacter(f.plan, first.member, first.progress,
    { kind: "add-experience", amount: 20, context: "field" }, f.project);
  assert.deepEqual(next.member.abilities.owned.slice(-3).map((a) => a.abilityId), [100,161,101]);
  assert.deepEqual(next.member.abilities.byCommand.find((c) => c.commandId === 17)!.abilityIds, [142,161]);
  assert.deepEqual(next.learnedAbilityIdsToAppend, []);
  validateCharacterGrowth(f.plan, next.member, JSON.parse(JSON.stringify(next.progress)));
  assert.deepEqual(expectedOwnedGrowth(f.plan, next.progress).abilities, next.member.abilities);
});

test("zero-EXP observation bypasses ordinary equipment/background growth providers and does not heal", () => {
  const f = characterLearningFixture();
  f.plan.hasBattleBackgroundLearning = true;
  f.member.equipment[0] = 207;
  f.member.hp = 0;
  const result = learnObservedCharacter(f.plan, f.member, f.progress, [142], context);
  assert.equal(result.member.hp, 0); assert.equal(result.member.exp, f.member.exp);
  assert.equal(result.member.abilities.owned.find((a) => a.abilityId === 142)!.skillLevel, 100);
  assert.deepEqual(result.progress.additional, f.progress.additional);
  assert.throws(() => growCharacter(f.plan, f.member, f.progress,
    { kind: "add-experience", amount: 0, context: "battle", observedAbilityIds: [142], learningReceipt: context }, f.project), /background learning/);
});

test("restore rejects wrong observation identity, chronology, participant, level and owned projection", () => {
  const f = characterLearningFixture();
  const result = learnObservedCharacter(f.plan, f.member, f.progress, [142,161], context);
  for (const change of [
    (p: typeof result.progress) => { p.observedLearning[0]!.observedAbilityIds = [999]; },
    (p: typeof result.progress) => { p.observedLearning[0]!.observedAbilityIds.reverse(); },
    (p: typeof result.progress) => { p.observedLearning[0]!.participantIndex = 4; },
    (p: typeof result.progress) => { p.observedLearning[0]!.battleSerial = -1; },
    (p: typeof result.progress) => { p.observedLearning[0]!.level++; },
    (p: typeof result.progress) => { p.observedLearning.push(structuredClone(p.observedLearning[0]!)); },
    (p: typeof result.progress) => { p.observedLearning = []; },
  ]) {
    const bad = structuredClone(result.progress); change(bad);
    assert.throws(() => validateCharacterGrowth(f.plan, result.member, bad));
  }
  assert.throws(() => learnObservedCharacter(f.plan, f.member, f.progress, [142], undefined), /receipt/);
  assert.throws(() => learnObservedCharacter(f.plan, f.member, f.progress, [142,142], context), /Duplicate/);
  const unbound = structuredClone(f.plan); delete unbound.observedLearning;
  assert.throws(() => learnObservedCharacter(unbound, f.member, f.progress, [142], context), /Unimplemented observed/);
});
