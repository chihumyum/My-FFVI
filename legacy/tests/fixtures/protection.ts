import { battleTableIndex } from "../../src/compiler/battle.js";
import { compileBattleConditionCatalog } from "../../src/compiler/conditions.js";

/** Redistributable synthetic rows. Protection identities intentionally differ
 * from both their source IDs and their condition types. */
export function protectionFixture() {
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
  const protection = { system_type: "2", until_type: "2", battle_effect_shadow_cloning: "1" };
  const physical = row(123, 19, { ...protection, battle_effect_asset_id: "827" });
  const magic = row(122, 412, { ...protection, battle_effect_asset_id: "828" });
  const special = row(193, 19, { ...protection, battle_effect_asset_id: "827", condition_group_id: "908" });
  const tables: Record<string, Record<string, string>[]> = {
    "condition.csv": [row(4, 4), row(5, 5, { erase_condition_group_id: "3", attack_target: "1",
      game_over_target: "1", recovery_invalid: "1", state_cover_unavailable: "1" }),
      row(6, 6, { until_type: "2" }), row(53, 607, { system_type: "4", mes_id_name: "None" }),
      row(901, 1, { system_type: "4", until_type: "1", mes_id_name: "None" }), physical, magic, special],
    "erase_condition_group.csv": [
      { id: "1", group_id: "1", condition_id: "0", type_id: "2", erase_condition: "0" },
      { id: "2", group_id: "3", condition_id: "0", type_id: "5", erase_condition: "53" },
    ],
    "game_constant_int.csv": [{ id: "1", key_name: "RATE_HAVE_NEAR_DEATH", value1: "8" }],
    "transportation.csv": [{ id: "106", type_id: "12" }],
  };
  const source = { file: "synthetic.bundle", objectId: "1", serializedFile: "synthetic.serialized" };
  const reader = () => battleTableIndex(tables,
    Object.fromEntries(Object.keys(tables).map((table) => [table, { ...source, assetPath: "synthetic/" + table }])));
  const compile = () => compileBattleConditionCatalog(reader(), tables["condition.csv"]!.map((r) => Number(r.id)), (key) => key);
  return { tables, physical, magic, special, reader, compile };
}

export function protectionAbilityFixture() {
  const f = protectionFixture();
  const ability: Record<string, string> = {
    ...Object.fromEntries(["condition_group_id", "attribute_group_id", "attack_count", "Impact_status",
      "invalid_boss", "resistance_attribute", "adding_hit_rate", "valid_hit_rate", "weak_hit_rate",
      "reaction_type", "data_a", "data_b", "data_c", "standard_value", "attribute_id", "ability_lv"].map((key) => [key, "0"])),
    id: "801", type_id: "1", system_id: "2", accuracy_rate: "100", battle_function_group_id: "81",
    content_flag_group_id: "91", invalid_reflection: "0", process_prog: "None", battle_renge_id: "7",
    use_value: "12", ability_wait: "30",
  };
  const group: Record<string, string> = { id: "81", ...Object.fromEntries([1, 2, 3].flatMap((slot) => [
    [`function${slot}_id`, slot === 1 ? "501" : "0"],
    [`function${slot}_value1`, slot === 1 ? "123" : "0"],
    [`function${slot}_value2`, "0"], [`function${slot}_value3`, "0"],
  ])) };
  Object.assign(f.tables, {
    "ability.csv": [ability], "function_group.csv": [group],
    "function.csv": [{ id: "501", type_id: "9", series_id: "0" }],
    "condition_group.csv": [], "attribute_group.csv": [],
    "content_flag_group.csv": [
      { id: "1", group_id: "91", content_flag_id: "1" },
      { id: "2", group_id: "91", content_flag_id: "3" },
    ],
  });
  return { ...f, ability, group };
}
