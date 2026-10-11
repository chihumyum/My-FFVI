import type { PhysicalParameters } from "./physical.js";
import type { AtbRules } from "./atb.js";
import type { ParameterValues } from "./parameters.js";
import type { AbilityProgram, DevelopmentAbilityPlan } from "./ability.js";
import type { BattleConditionCatalog } from "./battle-conditions.js";
import type { ElementResistances } from "./elements.js";
import type { BattleAIProgram } from "./battle-ai.js";
import type { BattleReactionRules } from "./battle-reactions.js";

export type BattleCommandDefinition = {
  id: number;
  name: string;
  abilityIds: number[];
  forbiddenConditionIds: number[];
};

/** A deliberately bounded development profile, never a parity certificate. */
export type BattleContent = {
  kind: "opening-battle-development";
  profile: "narshe-playability-v13";
  contentHash: string;
  sourceContentHash: string;
  fieldSourceSetHash: string;
  encounterId: number;
  formation: "normal" | "opposed";
  atb: AtbRules;
  reactions: BattleReactionRules;
  initialAtb: { player: [number, number]; enemy: [number, number] };
  gil: number;
  players: CombatantDefinition[];
  enemies: CombatantDefinition[];
  abilities: Record<string, AbilityDefinition>;
  commands: Record<string, BattleCommandDefinition>;
  conditions: BattleConditionCatalog;
  growth: Record<string, { level: number; hp: number; mp: number }[]>;
  experience: { level: number; exp: number }[];
  background: string;
  sprites: Record<string, { file: string; width: number; height: number }>;
  limitations: string[];
};
export type CombatantDefinition = ParameterValues & {
  id: string;
  sourceId: number;
  name: string;
  side: "player" | "enemy";
  level: number;
  physical: PhysicalParameters | null;
  attackElements: number[];
  elementResistances: ElementResistances;
  exp: number;
  gil: number;
  growthGroup: string | null;
  abilities: number[];
  commands: number[];
  conditionIds: number[];
  conditionResistances: Record<string, number>;
  ai: BattleAIProgram | null;
  placement: { x: number; y: number; group: number } | null;
  sprites: { idle: string; mount: string | null };
};

export type BattleEncounter = Pick<
  BattleContent,
  "encounterId" | "enemies" | "background" | "formation"
>;
export type BattleCatalog = {
  kind: "narshe-battle-catalog";
  contentHash: string;
  common: Omit<BattleContent, keyof BattleEncounter | "contentHash">;
  encounters: Record<string, BattleEncounter>;
};
export function encounterContent(
  catalog: BattleCatalog,
  id: number,
): BattleContent | null {
  const encounter = catalog.encounters[String(id)];
  return encounter
    ? { ...catalog.common, ...encounter, contentHash: catalog.contentHash }
    : null;
}
export type AbilityDefinition = {
  id: number;
  name: string;
  program: AbilityProgram;
  plan: DevelopmentAbilityPlan | null;
  blockers: string[];
  limitations: string[];
  /** Presentation only. Logic dispatches the complete admitted effect plan. */
  presentation: "beam" | "heal" | "physical" | "condition" | "unsupported";
  power: number;
  cost: number;
  wait: number;
  attribute: number;
};
