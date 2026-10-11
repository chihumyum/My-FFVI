import test from "node:test";
import assert from "node:assert/strict";
import { growCharacter, validateCharacterGrowth } from "../src/core/character-growth.js";
import { validateOwnedCharacterAbilities } from "../src/core/owned-character.js";
import { characterGrowthFixture } from "./fixtures/character-growth.js";

const passive = { abilityId: 801, contentId: 9801, skillLevel: 0 };

test("ordinary growth keeps repeated equipment abilities in place and appends natural learning afterward", () => {
  const f = characterGrowthFixture(), equipment = [passive, passive];
  f.member.abilities.owned.push(...structuredClone(equipment));
  const before = structuredClone(f.member);
  const result = growCharacter(f.plan, f.member, f.progress,
    { kind: "add-experience", amount: 90, context: "battle", observedAbilityIds: [] }, f.project, equipment);
  assert.deepEqual(result.member.abilities.owned.map((a) => a.abilityId), [220, 31, 229, 801, 801, 100, 101]);
  assert.deepEqual(result.member.abilities.owned.filter((a) => a.abilityId === 801), equipment);
  assert.deepEqual(result.member.abilities.additionOrder, [603, 601, 602, 604, 605]);
  assert.deepEqual(result.member.abilities.byCommand, [{ commandId: 41, abilityIds: [220, 100, 101, 31] }]);
  assert.deepEqual(f.member, before);
  const restored = JSON.parse(JSON.stringify(result));
  validateCharacterGrowth(f.plan, restored.member, restored.progress, equipment);
  const split = growCharacter(f.plan, f.member, f.progress,
    { kind: "add-experience", amount: 70, context: "field" }, f.project, equipment);
  const last = growCharacter(f.plan, split.member, split.progress,
    { kind: "add-experience", amount: 20, context: "field" }, f.project, equipment);
  assert.deepEqual(last.member, result.member);
});

test("only exact catalog-supplied passive copies bypass owned identity uniqueness", () => {
  const f = characterGrowthFixture();
  f.member.abilities.owned.push(structuredClone(passive), structuredClone(passive));
  assert.throws(() => validateOwnedCharacterAbilities(f.member.abilities), /Duplicate/);
  assert.throws(() => validateOwnedCharacterAbilities(f.member.abilities, [passive]), /mismatch/);
  validateOwnedCharacterAbilities(f.member.abilities, [passive, passive]);
  f.member.abilities.owned.at(-1)!.skillLevel = 100;
  assert.throws(() => validateOwnedCharacterAbilities(f.member.abilities, [passive, passive]), /mismatch/);
  f.member.abilities.owned.at(-1)!.skillLevel = 0;
  f.member.abilities.owned.at(-1)!.contentId++;
  assert.throws(() => validateOwnedCharacterAbilities(f.member.abilities, [passive, passive]), /mismatch/);
});
