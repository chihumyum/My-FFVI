import { battleTableIndex } from "../../src/compiler/battle.js";

/** Redistributable synthetic source rows; none are original game text/data. */
export function battleAbilityContentFixture() {
  const ability: Record<string, string> = {
    id: "901", ability_lv: "0", battle_function_group_id: "81", process_prog: "None",
    data_a: "0", data_b: "0", data_c: "0", battle_renge_id: "7",
    standard_value: "50", use_value: "2", ability_wait: "3", attribute_id: "0",
    type_id: "3", system_id: "1", accuracy_rate: "100", condition_group_id: "0",
    content_flag_group_id: "0", attribute_group_id: "0", attack_count: "0",
    Impact_status: "0", invalid_boss: "0", invalid_reflection: "1",
    resistance_attribute: "0", adding_hit_rate: "0", valid_hit_rate: "0",
    weak_hit_rate: "0", reaction_type: "0",
  };
  const group: Record<string, string> = {
    id: "81", function1_id: "801", function1_value1: "1", function1_value2: "2", function1_value3: "0",
    function2_id: "0", function2_value1: "0", function2_value2: "0", function2_value3: "0",
    function3_id: "0", function3_value1: "0", function3_value2: "0", function3_value3: "0",
  };
  const content: Record<string, string> = {
    id: "401", type_id: "4", type_value: "901", mes_id_name: "SYNTHETIC_ABILITY_NAME",
    mes_id_battle: "None", mes_id_description: "None", icon_id: "0",
  };
  const tables: Record<string, Record<string, string>[]> = {
    "ability.csv": [ability], "function_group.csv": [group],
    "function.csv": [{ id: "801", type_id: "1", series_id: "0" }],
    "content.csv": [content],
  };
  const messages: Record<string, string> = { SYNTHETIC_ABILITY_NAME: "Synthetic recovery" };
  const source = { file: "synthetic.bundle", objectId: "9223372036854775807", serializedFile: "synthetic.serialized" };
  const reader = () => battleTableIndex(tables,
    Object.fromEntries(Object.keys(tables).map((table) => [table, { ...source, assetPath: "synthetic/" + table }])));
  return { ability, group, content, tables, messages, reader,
    resolveName: (key: string) => messages[key] ?? null };
}
