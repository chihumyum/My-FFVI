import { battleTableIndex } from "../../src/compiler/battle.js";
import { equipmentCatalog, equipmentRoster, equipmentZero } from "./equipment.js";

/** Synthetic identities deliberately differ from the source content IDs. The
 * runtime consumes a compiled provider, while the compiler tests bind source. */
export function abilityCostFixture() {
  const catalog = equipmentCatalog();
  for (const [id, modifier, abilityId, contentId] of [
    [701, "half", 7011, 7012], [702, "one", 7021, 7022],
  ] as const) {
    catalog.definitions[id] = {
      ...structuredClone(catalog.definitions[501]!), id, equipmentId: id + 1000,
      name: `Synthetic MP provider ${id}`,
      parameter: { kind: "armor", bareHands: false, reversedByCondition601: false,
        values: { ...equipmentZero, weight: 2 } },
      abilityCost: { kind: "equipment-mp-cost", modifier, ability: { abilityId, contentId, skillLevel: 0 } },
    };
  }
  return { catalog, roster: equipmentRoster(catalog) };
}

/** Small authored table fixture. Names/text/media are synthetic; only the
 * numeric provider contract is copied into the declared source adapter shape. */
export function abilityCostCompilerFixture() {
  const row = (values: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
  const group = (id: number, fn: number, value: number) => row({ id,
    ...Object.fromEntries(Array.from({ length: 3 }, (_, i) => i + 1).flatMap((slot) => [
      [`function${slot}_id`, slot === 1 ? fn : 0],
      ...[1, 2, 3].map((arg) => [`function${slot}_value${arg}`, slot === 1 && arg === 1 ? value : 0]),
    ])),
  });
  const tables: Record<string, Record<string, string>[]> = {
    "content.csv": [], "armor.csv": [], "ability.csv": [],
    "function_group.csv": [group(236, 62, 291), group(237, 62, 292), group(234, 75, 1), group(235, 75, 2)],
    "function.csv": [row({ id: 62, type_id: 62, series_id: 0 }), row({ id: 75, type_id: 75, series_id: 0 })],
    "parts_group.csv": [row({ id: 5, equip1_possible: 0, equip2_possible: 0, equip3_possible: 0,
      equip4_possible: 0, equip5_possible: 1, equip6_possible: 1 })],
    "job_group.csv": [row({ id: 1, job1_accept: 1 })],
  };
  for (let i = 0; i < 2; i++) {
    tables["content.csv"]!.push(row({ id: 304 + i, type_id: 3, type_value: 108 + i, mes_id_name: "SYNTHETIC" }),
      row({ id: 1491 + i, type_id: 4, type_value: 291 + i,
        mes_id_name: "None", mes_id_description: "None", mes_id_battle: "None" }));
    tables["armor.csv"]!.push(row({ id: 108 + i, type_id: 1, parts_group_id: 5, equip_job_group_id: 1,
      process_prog: "None", wear_condition_group_id: 0, wear_function_group_id: 236 + i, trigger_ability_id: 0,
      intelligence: 0, spirit: 0, ability_disturbed_rate: 0, resistance_species: 0, resistance_condition: 0,
      resistance_attribute: 0, strength: 0, max_hp_up: 0, max_mp_up: 0, magic: 0, vitality: 0, agility: 0,
      weight: 2, evasion_rate: 0, defense: 0, ability_defense: 0, ability_evasion_rate: 0 }));
    tables["ability.csv"]!.push(row({ id: 291 + i,
      ability_group_id: 0, ability_lv: 0, ability_wait: 0, accuracy_rate: 100, adding_hit_rate: 0,
      attack_count: 0, attribute_group_id: 0, attribute_id: 0, battle_effect_asset_id: 0,
      battle_function_group_id: 0, battle_renge_id: 5, condition_group_id: 0, content_flag_group_id: 0,
      data_a: 0, data_b: 0, data_c: 0, Impact_status: 0, invalid_boss: 0, invalid_reflection: 1,
      menu_function_group_id: 234 + i, menu_renge_id: 0, menu_se_asset_id: 0, process_prog: "None",
      reaction_type: 0, renge_id: 5, resistance_attribute: 0, standard_value: 0, system_id: 2, type_id: 4,
      use_job_group_id: 1, use_value: 0, valid_hit_rate: 0, weak_hit_rate: 0 }));
  }
  const reader = () => battleTableIndex(tables, Object.fromEntries(Object.keys(tables).map((table) => [table, {
    file: "synthetic", assetPath: `synthetic-ability-cost/${table}`, objectId: "9223372036854775807", serializedFile: "synthetic",
  }])));
  return { tables, reader };
}
