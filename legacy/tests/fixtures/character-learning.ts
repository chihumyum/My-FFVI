import { characterGrowthFixture } from "./character-growth.js";
import type { ObservedLearningCatalog } from "../../src/core/character-learning.js";
import { initialCharacterGrowth } from "../../src/core/character-growth.js";

export function observedLearningFixture(): ObservedLearningCatalog {
  return { kind: "observed-learning-v1", observerSourceId: 8, recipientAbilityId: 74, commandId: 17,
    forbiddenConditionTypes: [5,11,9,7,17,34,12,630,410], commandAbilityTypes: [504],
    candidates: [
      { observedAbilityId: 142, abilityId: 142, contentId: 742, typeId: 504, groupId: 11 },
      { observedAbilityId: 161, abilityId: 161, contentId: 761, typeId: 504, groupId: 11 },
      { observedAbilityId: 1350, abilityId: 160, contentId: 760, typeId: 504, groupId: 11 },
    ] };
}
export function characterLearningFixture() {
  const f = characterGrowthFixture(), catalog = observedLearningFixture();
  f.template.initial.sourceId = f.plan.sourceId = f.member.sourceId = 8;
  f.template.equipmentCharacter.sourceId = 8;
  f.plan.observedLearning = catalog;
  f.plan.observedLearningAbilityIds = catalog.candidates.map((r) => r.observedAbilityId);
  f.template.initial.abilities.commandIds.push(17);
  f.template.initial.abilities.owned.push({ abilityId: 74, contentId: 674, skillLevel: 0 },
    { abilityId: 142, contentId: 742, skillLevel: 0 });
  f.plan.initialAbilities = structuredClone(f.template.initial.abilities);
  f.plan.commands.push({ id: 17, abilityTypes: [504] });
  f.plan.abilities.push({ id: 74, contentId: 674, typeId: 0, groupId: 0 },
    ...catalog.candidates.map((r) => ({ id: r.abilityId, contentId: r.contentId, typeId: r.typeId, groupId: r.groupId })));
  f.member.abilities = structuredClone(f.plan.initialAbilities);
  return { ...f, catalog, progress: initialCharacterGrowth() };
}
