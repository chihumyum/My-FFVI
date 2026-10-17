import {
  hasteConditionType,
  slowConditionType,
  validateSpeedBehavior,
  type SpeedBehavior,
} from "../core/condition-speed.js";
import type { BattleRow } from "./battle.js";
import type { ConditionDefinition } from "../core/conditions.js";
import { compileConditionResistanceProvider } from "./condition-resistance-provider.js";
import { tableInteger as int } from "./table.js";

function hasSpeedLifecycle(row: Pick<BattleRow, "values">): boolean {
  const v = row.values, type = int(v.condition_type);
  return (type === hasteConditionType || type === slowConditionType) &&
    int(v.system_type) === (type === hasteConditionType ? 2 : 3) &&
    int(v.resistance_decision) === 1 && int(v.until_type) === 2 &&
    int(v.rate_type1) === 2 && int(v.rate_value1) > 0 && int(v.rate_value1) <= 0x7fffffff &&
    int(v.battle_effect_shadow_cloning) === 1 &&
    int(v.battle_effect_asset_id) > 0 && int(v.battle_effect_asset_id) <= 0x7fffffff &&
    ["until_value", "overlapped_type", "invalid_type", "target_type",
      "parameter_group_id", "attribute_group_id", "species_group_id", "rate_type2", "rate_value2",
      "recovery_invalid", "attack_target", "game_over_target", "state_cover_unavailable",
      "damage_number", "field_se_asset_id", "icon_id"].every((key) => int(v[key]) === 0);
}

/** Ordinary ability application remains narrower than active-state admission. */
export function hasSpeedBehavior(row: Pick<BattleRow, "values">): boolean {
  return hasSpeedLifecycle(row) && int(row.values.condition_group_id) === 0;
}

export function compileSpeedBehavior(
  row: Pick<BattleRow, "values">,
  name: (key: string) => string,
): SpeedBehavior | null {
  if (!hasSpeedBehavior(row)) return null;
  return speedBehavior(row, name);
}

function speedBehavior(row: Pick<BattleRow, "values">, name: (key: string) => string): SpeedBehavior {
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

/** Same Start/Update and timing consumers, with the separately bound generic
 * resistance dictionary. Source master and erase-group identities survive. */
export function compileSpeedCondition(
  reader: Parameters<typeof compileConditionResistanceProvider>[0], row: BattleRow,
  name: (key: string) => string, definitions: readonly ConditionDefinition[],
) {
  return compileConditionResistanceProvider(reader, row,
    hasSpeedLifecycle(row) ? speedBehavior(row, name) : null, definitions);
}
