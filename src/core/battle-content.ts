import type { AtbRules } from "./atb.js";

/** A deliberately bounded development profile, never a parity certificate. */
export type BattleContent = {
  kind: "opening-battle-development";
  profile: "opening-playability-v1";
  contentHash: string;
  sourceContentHash: string;
  fieldSourceSetHash: string;
  encounterId: number;
  atb: AtbRules;
  initialAtb: { player: [number, number]; enemy: [number, number] };
  gil: number;
  players: CombatantDefinition[];
  enemies: CombatantDefinition[];
  abilities: Record<string, AbilityDefinition>;
  growth: Record<string, { level: number; hp: number; mp: number }[]>;
  experience: { level: number; exp: number }[];
  background: string;
  sprites: Record<string, { file: string; width: number; height: number }>;
  limitations: string[];
};
export type CombatantDefinition = {
  id: string;
  sourceId: number;
  name: string;
  side: "player" | "enemy";
  level: number;
  hp: number;
  mp: number;
  magic: number;
  attack: number;
  defense: number;
  magicDefense: number;
  agility: number;
  weight: number;
  evasion: number;
  exp: number;
  gil: number;
  growthGroup: string | null;
  abilities: number[];
  ai: { ability: number; weight: number }[];
  sprites: { idle: string; mount: string | null };
};
export type AbilityDefinition = {
  id: number;
  name: string;
  kind: "beam" | "heal" | "physical" | "unsupported";
  power: number;
  multiplier: number;
  cost: number;
  wait: number;
  target: "enemy" | "ally";
  attribute: number;
};
