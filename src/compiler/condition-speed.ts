import {
  hasteConditionType,
  slowConditionType,
  validateSpeedBehavior,
  type SpeedBehavior,
} from "../core/condition-speed.js";
import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";

/** Ordinary duration-until-battle-end providers only. The type15 record with
 * condition_group_id=1310 is not the ordinary Heist provider closure. Native
 * particle effects remain source-backed presentation omissions in development. */
export function hasSpeedBehavior(row: Pick<BattleRow, "values">): boolean {
  const v = row.values, type = int(v.condition_type);
  return (type === hasteConditionType || type === slowConditionType) &&
    int(v.system_type) === (type === hasteConditionType ? 2 : 3) &&
    int(v.resistance_decision) === 1 && int(v.until_type) === 2 &&
    int(v.rate_type1) === 2 && int(v.rate_value1) > 0 && int(v.rate_value1) <= 0x7fffffff &&
    int(v.battle_effect_shadow_cloning) === 1 &&
    int(v.battle_effect_asset_id) > 0 && int(v.battle_effect_asset_id) <= 0x7fffffff &&
    ["until_value", "overlapped_type", "invalid_type", "target_type", "condition_group_id",
      "parameter_group_id", "attribute_group_id", "species_group_id", "rate_type2", "rate_value2",
      "recovery_invalid", "attack_target", "game_over_target", "state_cover_unavailable",
      "damage_number", "field_se_asset_id", "icon_id"].every((key) => int(v[key]) === 0);
}

export function compileSpeedBehavior(
  row: Pick<BattleRow, "values">,
  name: (key: string) => string,
): SpeedBehavior | null {
  if (!hasSpeedBehavior(row)) return null;
  const nameKey = row.values.mes_id_name;
  if (!nameKey || nameKey === "None") throw new Error("Missing speed condition name");
  const haste = int(row.values.condition_type) === hasteConditionType;
  const behavior: SpeedBehavior = {
    id: int(row.values.id),
    kind: haste ? "haste" : "slow",
    name: name(nameKey),
    untilType: 2,
    speedDelta: int(row.values.rate_value1) * (haste ? 1 : -1),
  };
  validateSpeedBehavior(behavior);
  return behavior;
}
