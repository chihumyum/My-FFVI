import { blindConditionType, validateBlindBehavior, type BlindBehavior } from "../core/condition-blind.js";
import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";

/** Ordinary Blind provider only. The alternate type9 row with a condition
 * group is not this lifecycle even though its numerical type is the same. */
export function hasBlindBehavior(row: Pick<BattleRow, "values">): boolean {
  const v = row.values;
  return int(v.condition_type) === blindConditionType && int(v.system_type) === 1 &&
    int(v.resistance_decision) === 1 && int(v.until_type) === 3 &&
    int(v.battle_effect_asset_id) > 0 && int(v.battle_effect_asset_id) <= 0x7fffffff &&
    int(v.icon_id) > 0 && int(v.icon_id) <= 0x7fffffff &&
    ["until_value", "overlapped_type", "invalid_type", "target_type", "condition_group_id",
      "parameter_group_id", "attribute_group_id", "species_group_id", "rate_type1", "rate_type2",
      "rate_value1", "rate_value2", "recovery_invalid", "attack_target", "game_over_target",
      "state_cover_unavailable", "damage_number", "field_se_asset_id", "battle_effect_shadow_cloning",
    ].every((key) => int(v[key]) === 0);
}

export function compileBlindBehavior(
  row: Pick<BattleRow, "values">,
  name: (key: string) => string,
): BlindBehavior | null {
  if (!hasBlindBehavior(row)) return null;
  const key = row.values.mes_id_name;
  if (!key || key === "None") throw new Error("Missing Blind condition name");
  const behavior: BlindBehavior = { id: int(row.values.id), kind: "blind", name: name(key),
    untilType: 3, effectAssetId: int(row.values.battle_effect_asset_id), iconId: int(row.values.icon_id) };
  validateBlindBehavior(behavior);
  return behavior;
}

/** Preserve the effect and sound providers even in the explicit development
 * presentation-omission lane. A missing source reference is not no effect. */
export function compileBlindPresentation(
  reader: { row(table: string, id: number): BattleRow },
  behavior: BlindBehavior,
): BattleRow[] {
  validateBlindBehavior(behavior);
  const effect = reader.row("battle_effect_asset.csv", behavior.effectAssetId), v = effect.values;
  if (!v.asset_name || v.asset_name === "None" || int(v.position_type) !== 5 ||
      int(v.display_type) !== 0 || int(v.critical_se_asset_id) !== 0 || int(v.se_asset_id_2) !== 0 ||
      int(v.se_asset_id) < 0)
    throw new Error("Unresolved Blind effect provider");
  return int(v.se_asset_id) > 0 ? [effect, reader.row("se_asset.csv", int(v.se_asset_id))] : [effect];
}
