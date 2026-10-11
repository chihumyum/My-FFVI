import type { ProtectionBehavior } from "../core/protection.js";
import { magicProtectionType, physicalProtectionType } from "../core/protection.js";
import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";

/** Ordinary FF6 protection only. Rows with a condition-group provider (source
 * 93/94), permanent equipment, parameter/rate changes or other lifecycle inputs
 * are not interchangeable with the ordinary records. The particle asset stays
 * in the source row; the development renderer does not reproduce that effect. */
export function hasProtectionBehavior(row: Pick<BattleRow, "values">): boolean {
  const v = row.values;
  return [physicalProtectionType, magicProtectionType].includes(int(v.condition_type)) &&
    int(v.system_type) === 2 && int(v.resistance_decision) === 1 &&
    int(v.until_type) === 2 && int(v.battle_effect_shadow_cloning) === 1 &&
    int(v.battle_effect_asset_id) > 0 && int(v.battle_effect_asset_id) <= 0x7fffffff &&
    ["until_value", "overlapped_type", "invalid_type", "target_type",
      "condition_group_id", "parameter_group_id", "attribute_group_id", "species_group_id",
      "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid",
      "attack_target", "game_over_target", "state_cover_unavailable", "damage_number",
      "field_se_asset_id", "icon_id"].every((key) => int(v[key]) === 0);
}

export function compileProtectionBehavior(
  row: Pick<BattleRow, "values">,
  name: (key: string) => string,
): ProtectionBehavior | null {
  if (!hasProtectionBehavior(row)) return null;
  const nameKey = row.values.mes_id_name;
  if (!nameKey || nameKey === "None") throw new Error("Missing protection condition name");
  return {
    id: int(row.values.id),
    kind: int(row.values.condition_type) === physicalProtectionType ? "physical-protection" : "magic-protection",
    name: name(nameKey),
    untilType: 2,
  };
}
