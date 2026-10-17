import type { BattleRow } from "./battle.js";
import type { ConditionDefinition } from "../core/conditions.js";
import { levitateConditionType, validateLevitateBehavior, type LevitateBehavior } from "../core/condition-levitate.js";
import { compileElementResistances } from "./elements.js";
import { compileConditionResistanceProvider, type ActiveConditionCompilation } from "./condition-resistance-provider.js";
import { tableInteger as int } from "./table.js";

/** Enemy Start/Remove return without renderer work (9205e0/920490). Player
 * applicability is gated by the owning action/battle before publication. */
export function compileLevitateCondition(reader: Parameters<typeof compileElementResistances>[0],
  row: BattleRow, name: (key: string) => string, definitions: readonly ConditionDefinition[],
): ActiveConditionCompilation<LevitateBehavior> {
  const v = row.values;
  if (int(v.condition_type) !== levitateConditionType) return { behavior: null, sources: [], blockers: [] };
  try {
    if (int(v.system_type) !== 1 || int(v.resistance_decision) !== 1 || int(v.until_type) !== 3 ||
        int(v.icon_id) <= 0 || int(v.icon_id) > 0x7fffffff || int(v.condition_group_id) < 0 || int(v.attribute_group_id) <= 0 ||
        !v.mes_id_name || v.mes_id_name === "None" ||
        ["until_value", "overlapped_type", "invalid_type", "target_type", "parameter_group_id", "species_group_id",
          "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid", "attack_target", "game_over_target",
          "state_cover_unavailable", "damage_number", "field_se_asset_id", "battle_effect_asset_id", "battle_effect_shadow_cloning",
        ].some(key => int(v[key]) !== 0))
      throw new Error("Unresolved Leviteto lifecycle/provider shape");
    const element = compileElementResistances(reader, int(v.attribute_group_id));
    const behavior: LevitateBehavior = { id: int(v.id), kind: "levitate", name: name(v.mes_id_name), untilType: 3,
      elementProvider: { groupId: int(v.attribute_group_id), resistances: element.resistances } };
    validateLevitateBehavior(behavior);
    const result = compileConditionResistanceProvider(reader, row, behavior, definitions);
    if (!result.behavior) return result;
    const ordinaryIds = definitions.filter(d => d.type === levitateConditionType).map(d => d.id), resistance = result.behavior.resistanceProvider?.conditions;
    if (int(v.condition_group_id) !== 0 && (!resistance || Object.keys(resistance).length !== 1 || !ordinaryIds.includes(Number(Object.keys(resistance)[0])) ||
        Object.values(resistance)[0] !== 1))
      throw new Error("Unresolved Leviteto same-type master resistance provider");
    return { ...result, sources: [...element.sources, ...result.sources] };
  } catch (error) { return { behavior: null, sources: [], blockers: [error instanceof Error ? error.message : String(error)] }; }
}
