import { battleTableIndex } from "../../src/compiler/battle.js";
import { compileBattleConditionCatalog } from "../../src/compiler/conditions.js";

/** Redistributable synthetic rows. IDs differ from both native IDs and types. */
export function conditionSpeedFixture() {
  const row = (id: number, type: number, values: Record<string, string> = {}) => ({
    ...Object.fromEntries(["attack_target", "attribute_group_id", "battle_effect_asset_id",
      "battle_effect_shadow_cloning", "condition_group_id", "damage_number", "field_se_asset_id",
      "game_over_target", "icon_id", "invalid_type", "overlapped_type", "parameter_group_id",
      "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid", "species_group_id",
      "state_cover_unavailable", "target_type", "until_value"].map((key) => [key, "0"])),
    id: String(id), condition_type: String(type), erase_condition_group_id: "1",
    mes_id_name: "STATE_" + id, mes_id_description: "None", system_type: "1",
    resistance_decision: "1", until_type: "3", ...values,
  });
  const speed = { until_type: "2", battle_effect_shadow_cloning: "1", rate_type1: "2", rate_value1: "50" };
  const haste = row(121, 15, { ...speed, system_type: "2", battle_effect_asset_id: "833", erase_condition_group_id: "8" });
  const slow = row(125, 16, { ...speed, system_type: "3", battle_effect_asset_id: "834", erase_condition_group_id: "9" });
  const special = row(195, 15, { ...speed, system_type: "2", battle_effect_asset_id: "833", condition_group_id: "910" });
  const stop = row(117, 17, { system_type: "3", until_type: "9", until_value: "12" });
  const tables: Record<string, Record<string, string>[]> = {
    "condition.csv": [row(4, 4), row(5, 5, { erase_condition_group_id: "3", attack_target: "1",
      game_over_target: "1", recovery_invalid: "1", state_cover_unavailable: "1" }),
      row(6, 6, { until_type: "2" }), row(53, 607, { system_type: "4", mes_id_name: "None" }),
      row(110, 10, { rate_type1: "3", rate_value1: "16", damage_number: "32" }),
      haste, slow, special, stop],
    "erase_condition_group.csv": [
      { id: "1", group_id: "1", condition_id: "0", type_id: "2", erase_condition: "0" },
      { id: "2", group_id: "3", condition_id: "5", type_id: "5", erase_condition: "53" },
      { id: "3", group_id: "8", condition_id: "121", type_id: "3", erase_condition: "125" },
      { id: "4", group_id: "9", condition_id: "125", type_id: "3", erase_condition: "121" },
    ],
    "game_constant_int.csv": [{ id: "1", key_name: "RATE_HAVE_NEAR_DEATH", value1: "8" }],
    "transportation.csv": [{ id: "106", type_id: "12" }],
  };
  const source = { file: "synthetic.bundle", objectId: "1", serializedFile: "synthetic.serialized" };
  const reader = () => battleTableIndex(tables,
    Object.fromEntries(Object.keys(tables).map((table) => [table, { ...source, assetPath: "synthetic/" + table }])));
  const compile = () => compileBattleConditionCatalog(reader(), tables["condition.csv"]!.map((r) => Number(r.id)), (key) => key);
  return { tables, haste, slow, special, stop, reader, compile };
}

export function conditionSpeedAbilityFixture(kind: "haste" | "slow") {
  const f = conditionSpeedFixture();
  const ability: Record<string, string> = {
    ...Object.fromEntries(["condition_group_id", "attribute_group_id", "attack_count", "Impact_status",
      "invalid_boss", "resistance_attribute", "adding_hit_rate", "valid_hit_rate", "weak_hit_rate",
      "reaction_type", "data_a", "data_b", "data_c", "standard_value", "attribute_id", "ability_lv"].map((key) => [key, "0"])),
    id: "801", type_id: "1", system_id: kind === "haste" ? "2" : "5", accuracy_rate: "120",
    battle_function_group_id: "81", content_flag_group_id: "91", invalid_reflection: "0",
    process_prog: "None", battle_renge_id: "7", use_value: "10", ability_wait: "5",
  };
  const group: Record<string, string> = { id: "81", ...Object.fromEntries([1, 2, 3].flatMap((slot) => [
    [`function${slot}_id`, slot === 1 ? "501" : "0"],
    [`function${slot}_value1`, slot === 1 ? (kind === "haste" ? "121" : "125") : "0"],
    [`function${slot}_value2`, "0"], [`function${slot}_value3`, "0"],
  ])) };
  Object.assign(f.tables, {
    "ability.csv": [ability], "function_group.csv": [group],
    "function.csv": [{ id: "501", type_id: "9", series_id: "0" }],
    "condition_group.csv": [], "attribute_group.csv": [],
    "content_flag_group.csv": [
      ...(kind === "haste" ? [{ id: "1", group_id: "91", content_flag_id: "1" }] : []),
      { id: "2", group_id: "91", content_flag_id: "3" },
    ],
  });
  return { ...f, ability, group };
}
