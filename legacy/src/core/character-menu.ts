import type { AbilityDefinition } from "./battle-content.js";
import type { CharacterGrowthPlan, CharacterGrowthProgress } from "./character-growth.js";
import { validateOwnedCharacterAbilities, type OwnedAbility, type OwnedCharacterAbilities } from "./owned-character.js";

export type CharacterMenuMember = {
  id: string; sourceId: number; jobId: number; name: string; enabled: boolean;
  level: number; exp: number; hp: number; mp: number; maxHp: number; maxMp: number;
  abilities: OwnedCharacterAbilities | null; growth: CharacterGrowthProgress | null;
};
export type CharacterMenuCatalog = {
  growth: CharacterGrowthPlan | null;
  /** Explicit legacy development curve; a missing level stays unknown. */
  developmentExperience: readonly { level: number; exp: number }[];
  abilities: Readonly<Record<string, AbilityDefinition>>;
  commands: Readonly<Record<string, { name: string }>>;
  equipmentAbilities: readonly OwnedAbility[];
};
export type CharacterMenuModel = {
  id: string; sourceId: number; name: string; enabled: boolean;
  level: number; exp: number; hp: number; mp: number; maxHp: number; maxMp: number;
  experienceToNextLevel: number | null; atMaxLevel: boolean | null;
  additional: CharacterGrowthProgress["additional"] | null;
  commands: { id: number; name: string }[] | null;
  abilities: { index: number; id: number; name: string; skillLevel: number;
    equipment: boolean; effectSupport: "implemented" | "blocked" | "unknown"; blockers: string[] }[] | null;
};

/** Information only. Owned SkillLevel, static effect support and live battle
 * qualification are separate. This projection never grants or executes skills. */
export function projectCharacterMenu(member: CharacterMenuMember, catalog: CharacterMenuCatalog): CharacterMenuModel {
  const plan = catalog.growth;
  if (plan && (plan.sourceId !== member.sourceId || plan.jobId !== member.jobId))
    throw new Error("Character menu growth identity mismatch");
  const next = plan
    ? plan.experience.find((row) => row.level === member.level + 1)?.totalExp
    : catalog.developmentExperience.find((row) => row.level === member.level + 1)?.exp;
  const equipment = catalog.equipmentAbilities.map((ability) => ({ ...ability, used: false }));
  if (member.abilities) validateOwnedCharacterAbilities(member.abilities, catalog.equipmentAbilities);
  const abilities = member.abilities?.owned.map((owned, index) => {
    const passive = equipment.find((ability) => !ability.used && ability.abilityId === owned.abilityId &&
      ability.contentId === owned.contentId && ability.skillLevel === owned.skillLevel);
    if (passive) passive.used = true;
    const definition = catalog.abilities[owned.abilityId];
    return { index, id: owned.abilityId, name: definition?.name || `能力 ${owned.abilityId}`,
      skillLevel: owned.skillLevel, equipment: !!passive,
      effectSupport: !definition ? "unknown" as const : definition.plan ? "implemented" as const : "blocked" as const,
      blockers: definition ? [...definition.blockers] : ["能力说明尚未载入。"] };
  }) ?? null;
  return {
    id: member.id, sourceId: member.sourceId, name: member.name, enabled: member.enabled,
    level: member.level, exp: member.exp, hp: member.hp, mp: member.mp, maxHp: member.maxHp, maxMp: member.maxMp,
    experienceToNextLevel: next === undefined ? null : Math.max(0, next - member.exp),
    atMaxLevel: plan ? member.level >= plan.maxLevel : null,
    additional: member.growth ? structuredClone(member.growth.additional) : null,
    commands: member.abilities?.commandIds.map((id) => ({ id, name: catalog.commands[id]?.name || `指令 ${id}` })) ?? null,
    abilities,
  };
}
