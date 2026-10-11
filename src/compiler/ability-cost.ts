import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import type { EquipmentAbilityCost } from "../core/equipment.js";

type Reader = { row(table: string, id: string | number): BattleRow };

/** FF6 GetMPDiameter uses these two CONTENT ids, not generic reduction rows.
 * Resolve their full AddEquipAbility -> passive Ability -> menu function chain
 * before admitting the wearable effect or its direct parameter projection. */
export function compileEquipmentAbilityCost(reader: Reader, contentId: number): {
  provider: EquipmentAbilityCost; sources: BattleRow["source"][];
} {
  const binding = contentId === 304
    ? { armor: 108, wear: 236, ability: 291, content: 1491, menu: 234, reduction: 1, modifier: "half" as const }
    : contentId === 305
      ? { armor: 109, wear: 237, ability: 292, content: 1492, menu: 235, reduction: 2, modifier: "one" as const }
      : null;
  if (!binding) throw new Error("Unresolved equipment MP cost content: " + contentId);
  const rows: BattleRow[] = [];
  const row = (table: string, id: number) => {
    const value = reader.row(table, id);
    if (int(value.values.id) !== id) throw new Error("Equipment MP provider row identity mismatch");
    rows.push(value); return value;
  };
  const requireValues = (value: BattleRow, expected: Record<string, string | number>) => {
    for (const [key, expectedValue] of Object.entries(expected))
      if (value.values[key] !== String(expectedValue))
        throw new Error(`Unresolved equipment MP provider ${value.values.id} ${key}=${value.values[key]}`);
  };
  requireValues(row("content.csv", contentId), { type_id: 3, type_value: binding.armor });
  requireValues(row("armor.csv", binding.armor), {
    type_id: 1, wear_condition_group_id: 0, wear_function_group_id: binding.wear,
    trigger_ability_id: 0, process_prog: "None",
  });
  const group = (id: number, functionId: number, value: number) => {
    const values: Record<string, number> = {};
    for (let slot = 1; slot <= 3; slot++) {
      values[`function${slot}_id`] = slot === 1 ? functionId : 0;
      for (let arg = 1; arg <= 3; arg++) values[`function${slot}_value${arg}`] = slot === 1 && arg === 1 ? value : 0;
    }
    requireValues(row("function_group.csv", id), values);
    requireValues(row("function.csv", functionId), { type_id: functionId, series_id: 0 });
  };
  group(binding.wear, 62, binding.ability);
  requireValues(row("content.csv", binding.content), {
    type_id: 4, type_value: binding.ability, mes_id_name: "None", mes_id_description: "None", mes_id_battle: "None",
  });
  const ability = row("ability.csv", binding.ability);
  requireValues(ability, {
    ability_group_id: 0, ability_lv: 0, ability_wait: 0, accuracy_rate: 100,
    adding_hit_rate: 0, attack_count: 0, attribute_group_id: 0, attribute_id: 0,
    battle_effect_asset_id: 0, battle_function_group_id: 0, battle_renge_id: 5,
    condition_group_id: 0, content_flag_group_id: 0, data_a: 0, data_b: 0, data_c: 0,
    Impact_status: 0, invalid_boss: 0, invalid_reflection: 1,
    menu_function_group_id: binding.menu, menu_renge_id: 0, menu_se_asset_id: 0,
    process_prog: "None", reaction_type: 0, renge_id: 5, resistance_attribute: 0,
    standard_value: 0, system_id: 2, type_id: 4, use_job_group_id: 1, use_value: 0,
    valid_hit_rate: 0, weak_hit_rate: 0,
  });
  group(binding.menu, 75, binding.reduction);
  return {
    provider: { kind: "equipment-mp-cost", modifier: binding.modifier,
      ability: { abilityId: binding.ability, contentId: binding.content, skillLevel: 0 } },
    sources: rows.map((value) => value.source),
  };
}
