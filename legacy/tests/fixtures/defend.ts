import { battleTableIndex } from "../../src/compiler/battle.js";
import { ConditionRules, type ConditionCatalog } from "../../src/core/conditions.js";
import type { DefendCatalog } from "../../src/core/defend.js";

/** Synthetic identities deliberately differ from the source build. */
export function defendFixture() {
  const catalog: DefendCatalog = { conditionId: 901, conditionType: 1, untilType: 1 };
  const definitions: ConditionCatalog = {
    definitions: [
      { id: 901, type: 1, overlapped: false, eraseGroupId: 1 },
      { id: 902, type: 607, overlapped: false, eraseGroupId: 1 },
      { id: 903, type: 5, overlapped: false, eraseGroupId: 3 },
      { id: 904, type: 506, overlapped: false, eraseGroupId: 1 },
      { id: 905, type: 10, overlapped: false, eraseGroupId: 1 },
    ],
    eraseRules: [
      { id: 1, groupId: 1, conditionId: 0, type: 2, eraseConditionId: 0 },
      { id: 2, groupId: 3, conditionId: 0, type: 5, eraseConditionId: 902 },
    ],
  };
  const condition: Record<string, string> = {
    id: "901", condition_type: "1", system_type: "4", resistance_decision: "1",
    until_type: "1", erase_condition_group_id: "1", mes_id_name: "None",
    mes_id_description: "None",
    ...Object.fromEntries(["until_value", "overlapped_type", "invalid_type", "target_type",
      "condition_group_id", "parameter_group_id", "attribute_group_id", "species_group_id",
      "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid", "attack_target",
      "game_over_target", "state_cover_unavailable", "damage_number", "battle_effect_asset_id",
      "battle_effect_shadow_cloning", "field_se_asset_id", "icon_id"].map((key) => [key, "0"])),
  };
  const ability: Record<string, string> = {
    id: "801", battle_function_group_id: "81", process_prog: "None",
    data_a: "0", data_b: "0", data_c: "0", battle_renge_id: "5",
    standard_value: "0", use_value: "0", ability_wait: "0", attribute_id: "0",
    type_id: "5", system_id: "2", accuracy_rate: "100", invalid_reflection: "1",
    ...Object.fromEntries(["condition_group_id", "content_flag_group_id", "attribute_group_id",
      "attack_count", "Impact_status", "invalid_boss", "resistance_attribute", "adding_hit_rate",
      "valid_hit_rate", "weak_hit_rate", "reaction_type"].map((key) => [key, "0"])),
  };
  const group: Record<string, string> = { id: "81", ...Object.fromEntries(
    [1, 2, 3].flatMap((slot) => [[`function${slot}_id`, slot === 1 ? "501" : "0"],
      ...[1, 2, 3].map((value) => [`function${slot}_value${value}`, "0"])]) ) };
  const tables: Record<string, Record<string, string>[]> = {
    "condition.csv": [condition],
    "erase_condition_group.csv": [{ id: "1", group_id: "1", condition_id: "0", type_id: "2", erase_condition: "0" }],
    "ability.csv": [ability], "function_group.csv": [group],
    "function.csv": [{ id: "501", type_id: "15", series_id: "0" }],
  };
  const source = { file: "synthetic.bundle", objectId: "1", serializedFile: "synthetic.serialized" };
  const reader = () => battleTableIndex(tables,
    Object.fromEntries(Object.keys(tables).map((table) => [table, { ...source, assetPath: "synthetic/" + table }])));
  return { catalog, definitions, rules: new ConditionRules(definitions), condition, ability, group, tables, reader };
}
