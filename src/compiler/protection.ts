import type { ProtectionBehavior } from "../core/protection.js";
import { magicProtectionType, physicalProtectionType } from "../core/protection.js";
import type { BattleRow } from "./battle.js";
import type { ConditionDefinition } from "../core/conditions.js";
import { compileConditionResistances } from "./condition-resistances.js";
import { tableInteger as int } from "./table.js";

function hasProtectionLifecycle(row: Pick<BattleRow, "values">): boolean {
  const v = row.values;
  return [physicalProtectionType, magicProtectionType].includes(int(v.condition_type)) &&
    int(v.system_type) === 2 && int(v.resistance_decision) === 1 &&
    int(v.until_type) === 2 && int(v.battle_effect_shadow_cloning) === 1 &&
    int(v.battle_effect_asset_id) > 0 && int(v.battle_effect_asset_id) <= 0x7fffffff &&
    ["until_value", "overlapped_type", "invalid_type", "target_type",
      "parameter_group_id", "attribute_group_id", "species_group_id",
      "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid",
      "attack_target", "game_over_target", "state_cover_unavailable", "damage_number",
      "field_se_asset_id", "icon_id"].every((key) => int(v[key]) === 0);
}

/** Ordinary spell-application admission. Provider-bearing active conditions
 * are compiled separately below, not granted the ordinary ability path. */
export function hasProtectionBehavior(row: Pick<BattleRow, "values">): boolean {
  return hasProtectionLifecycle(row) && int(row.values.condition_group_id) === 0;
}

export function compileProtectionBehavior(
  row: Pick<BattleRow, "values">,
  name: (key: string) => string,
): ProtectionBehavior | null {
  if (!hasProtectionBehavior(row)) return null;
  return protectionBehavior(row, name);
}

function protectionBehavior(row: Pick<BattleRow, "values">, name: (key: string) => string): ProtectionBehavior {
  const nameKey = row.values.mes_id_name;
  if (!nameKey || nameKey === "None") throw new Error("Missing protection condition name");
  return {
    id: int(row.values.id),
    kind: int(row.values.condition_type) === physicalProtectionType ? "physical-protection" : "magic-protection",
    name: name(nameKey),
    untilType: 2,
  };
}

/** Active condition admission is separate from the ability compiler's ordinary
 * application predicate above. The generic Init provider reads ConditionGroupId
 * as a resistance dictionary (45b450 -> 4dbaf0), never as active membership.
 * Unknown providers leave this master row inactive in the bounded catalog. */
export function compileProtectionCondition(
  reader: Parameters<typeof compileConditionResistances>[0],
  row: BattleRow,
  name: (key: string) => string,
  definitions: readonly ConditionDefinition[],
): { behavior: ProtectionBehavior | null; sources: BattleRow[]; blockers: string[] } {
  const ordinary = compileProtectionBehavior(row, name);
  if (ordinary) return { behavior: ordinary, sources: [], blockers: [] };
  const groupId = int(row.values.condition_group_id);
  if (groupId <= 0 || groupId > 0x7fffffff || !hasProtectionLifecycle(row))
    return { behavior: null, sources: [], blockers: [] };
  try {
    const provider = compileConditionResistances(reader, groupId, definitions);
    const behavior = protectionBehavior(row, name);
    return { behavior: { ...behavior, resistanceProvider: { groupId, conditions: provider.resistances } },
      sources: provider.sources, blockers: [] };
  } catch (error) {
    return { behavior: null, sources: [], blockers: [error instanceof Error ? error.message : String(error)] };
  }
}
