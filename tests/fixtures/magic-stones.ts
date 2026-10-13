import { initialCharacterGrowth } from "../../src/core/character-growth.js";
import type { MagicStoneCatalog } from "../../src/core/magic-stones.js";
import { characterGrowthFixture } from "./character-growth.js";
import { characterLearningFixture } from "./character-learning.js";

/** Synthetic dictionaries/learning rows exercise the shared consumer. These
 * content identities are authored test data, not a copy of the source 27. */
export function magicStoneCatalogFixture(): MagicStoneCatalog {
  const rules: MagicStoneCatalog["rules"] = { kind: "magic-stone-rules-v1", maxSkillLevel: 100,
    excludedSourceIds: [13, 14], magicCommandId: 7, alternativeMagicCommandId: 31 };
  return { kind: "magic-stones-v1", rules, stones: {
    901: { contentId: 901, name: "Authored HP stone", summonAbilityId: 9101,
      bonus: { parameter: 2, value: 10 }, learning: [
        { id: 201, contentId: 606, abilityId: 102, rate: 2 },
        { id: 202, contentId: 604, abilityId: 100, rate: 1 },
      ], summonBlockers: ["Authored fixture has no summon execution"] },
    902: { contentId: 902, name: "Authored magic stone", summonAbilityId: 9102,
      bonus: { parameter: 14, value: 2 },
      learning: [{ id: 203, contentId: 607, abilityId: 103, rate: 3 }],
      summonBlockers: ["Authored fixture has no summon execution"] },
    903: { contentId: 903, name: "Authored MP stone", summonAbilityId: 9103,
      bonus: { parameter: 3, value: 50 }, learning: [],
      summonBlockers: ["Authored fixture has no summon execution"] },
    904: { contentId: 904, name: "Authored strength stone", summonAbilityId: 9104,
      bonus: { parameter: 4, value: 1 },
      learning: [{ id: 204, contentId: 606, abilityId: 102, rate: 3 }],
      summonBlockers: ["Authored fixture has no summon execution"] },
  } };
}

export function magicStoneGrowthFixture(observed = false) {
  const f = observed ? characterLearningFixture() : characterGrowthFixture(), catalog = magicStoneCatalogFixture();
  f.plan.magicStones = catalog;
  f.plan.abilities.push({ id: 102, contentId: 606, typeId: 1, groupId: 7 },
    { id: 103, contentId: 607, typeId: 2, groupId: 7 });
  // The historical fixture directly compiled only source command slots.
  // Declare its extra held UI commands as empty authored filters for this plan.
  for (const id of f.plan.initialAbilities.commandIds)
    if (!f.plan.commands.some(command => command.id === id)) f.plan.commands.push({ id, abilityTypes: [] });
  f.plan.commands.push({ id: 7, abilityTypes: [1, 2] }, { id: 31, abilityTypes: [1, 2] });
  return { ...f, catalog, progress: initialCharacterGrowth(f.plan) };
}
