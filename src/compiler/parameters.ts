import { tableInteger as int } from "./table.js";
import type { BattleRow } from "./battle.js";
import { compileEquipmentAbilityCost } from "./ability-cost.js";
import {
  confirmPlayerParameters,
  confirmEnemyParameters,
  type ParameterValues,
  type ParameterEquipment,
  type ParameterLimits,
  type PlayerParameterInput,
} from "../core/parameters.js";

export const parameterLimitKeys = {
  hp: "MAX_HP",
  mp: "MAX_MP",
  naturalMagic: "MAX_MAGIC",
  magic: "MAX_ABILITY_ATTACK",
  vitality: "MAX_VITALITY",
  attack: "MAX_ATTACK",
  defense: "MAX_DEFENSE",
  magicDefense: "MAX_ABILITY_DEFENSE",
  agility: "MAX_AGILITY",
  evasion: "MAX_EVASION_RATE",
  magicEvasion: "MAX_ABILITY_EVASION_RATE",
  evasionPercent: "MAX_EVASION_RATE_PERCENTAGE",
  magicEvasionPercent: "MAX_ABILITY_EVASION_RATE_PERCENTAGE",
} as const;
type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
};
export function compileParameterLimits(reader: Reader) {
  const rows = Object.fromEntries(
    Object.entries(parameterLimitKeys).map(([key, name]) => [
      key,
      reader.unique("game_constant_int.csv", "key_name", name),
    ]),
  );
  return {
    values: Object.fromEntries(
      Object.entries(rows).map(([k, r]) => [k, int(r.values.value1)]),
    ) as ParameterLimits,
    sources: Object.values(rows).map((r) => r.source),
  };
}
const commonColumns = {
  hp: "hp",
  mp: "mp",
  attack: "attack",
  defense: "defense",
  magicDefense: "ability_defense",
  agility: "agility",
  vitality: "vitality",
  evasion: "evasion_rate",
} as const;
function baseValues(row: BattleRow, player: boolean): ParameterValues {
  return {
    ...Object.fromEntries(
      Object.entries(commonColumns).map(([k, c]) => [k, int(row.values[c])]),
    ),
    // Enemy constructor 0x4AFB70 switches to AbilityAttack for series 6.
    magic: int(row.values[player ? "magic" : "ability_attack"]),
    // SetBaseParameter 0x52B7B0 passes baseWeight=0 for a player.
    weight: player ? 0 : int(row.values.weight),
    magicEvasion: int(row.values.magic_evasion_rate),
  } as ParameterValues;
}
export function compileParameterEquipment(
  reader: Reader,
  slots: readonly { slot: number; contentId: number }[],
) {
  const sources: BattleRow["source"][] = [];
  const equipment: ParameterEquipment[] = slots.map(({ slot, contentId }) => {
    const content = reader.row("content.csv", contentId);
    const kind = { "2": "weapon", "3": "armor" }[content.values.type_id!] as
      "weapon" | "armor" | undefined;
    if (!kind)
      throw new Error(`Unresolved equipment content type: ${contentId}`);
    const item = reader.row(kind + ".csv", content.values.type_value!);
    sources.push(content.source, item.source);
    const r = item.values;
    // Wear functions and conditions must be resolved by their own providers before
    // the resulting equipment/state can use this direct-row adapter.
    if (int(r.wear_condition_group_id) !== 0)
      throw new Error(`Unresolved ${kind}:${r.id} wear_condition_group_id=${r.wear_condition_group_id}`);
    if ([304, 305].includes(contentId) || int(r.wear_function_group_id) !== 0) {
      try {
        sources.push(...compileEquipmentAbilityCost(reader, contentId).sources);
      } catch (error) {
        throw new Error(`Unresolved ${kind}:${r.id} wear_function_group_id=${r.wear_function_group_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      slot,
      kind,
      bareHands: kind === "weapon" && int(r.type_id) === 2,
      // 0x8597B0: weapon 38; metadata @0x4DF454: armor 16,46,71.
      reversedByCondition601:
        kind === "weapon" ? int(r.id) === 38 : [16, 46, 71].includes(int(r.id)),
      values: {
        hp: int(r.max_hp_up),
        mp: int(r.max_mp_up),
        magic: int(r.magic),
        vitality: int(r.vitality),
        agility: int(r.agility),
        weight: int(r.weight),
        evasion: int(r.evasion_rate),
        attack: kind === "weapon" ? int(r.attack) : 0,
        defense: kind === "armor" ? int(r.defense) : 0,
        magicDefense: kind === "armor" ? int(r.ability_defense) : 0,
        magicEvasion: kind === "armor" ? int(r.ability_evasion_rate) : 0,
      },
    };
  });
  return { equipment, sources };
}
export type PlayerParameterContext = Omit<
  PlayerParameterInput,
  "base" | "equipment"
>;
export function compilePlayerParameters(
  reader: Reader,
  characterId: number,
  context: PlayerParameterContext,
  limits: ParameterLimits,
) {
  const row = reader.row("character_status.csv", characterId);
  if (int(row.values.initial_condition_group) !== 0)
    throw new Error(`Unresolved character initial conditions: ${characterId}`);
  const gear = compileParameterEquipment(
    reader,
    Array.from({ length: 6 }, (_, i) => ({
      slot: i + 1,
      contentId: int(row.values[`content_id${i + 1}`]),
    })),
  );
  const input: PlayerParameterInput = {
    ...context,
    base: baseValues(row, true),
    equipment: gear.equipment,
  };
  return {
    input,
    confirmed: confirmPlayerParameters(input, limits),
    sources: [row.source, ...gear.sources],
  };
}
export function compileEnemyParameters(
  reader: Reader,
  monsterId: number,
  temporary: ParameterValues,
  limits: ParameterLimits,
) {
  const row = reader.row("monster.csv", monsterId);
  const base = baseValues(row, false);
  // This only confirms supplied numeric inputs; initial/status effects are not applied here.
  return {
    base,
    temporary: { ...temporary },
    confirmed: confirmEnemyParameters(base, temporary, limits),
    sources: [row.source],
  };
}
