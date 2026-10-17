import {battleTableIndex} from "../../src/compiler/battle.js";
import {parameterLimitKeys} from "../../src/compiler/parameters.js";
import {physicalLimitKeys} from "../../src/compiler/physical-parameters.js";
import {equipmentLimits} from "./equipment.js";
export function ownedCharacterFixture() {
  const row = (values: Record<string, number | string>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
  const piece = (
    id: number,
    parts: number,
    empty: boolean,
    values: Record<string, number | string> = {},
  ) =>
    row({
      id,
      type_id: empty ? 2 : 1,
      parts_group_id: parts,
      equip_job_group_id: 8,
      process_prog: "None",
      wear_condition_group_id: 0,
      wear_function_group_id: 0,
      trigger_ability_id: 0,
      attribute_group_id: 0,
      attribute_id: 0,
      vitality: 0,
      intelligence: 0,
      spirit: 0,
      ability_disturbed_rate: 0,
      weak_attribute: 0,
      effective_species: 0,
      two_handed_flag: 0,
      back_flag: 0,
      additional_condition_group_id: 0,
      resistance_species: 0,
      resistance_condition: 0,
      resistance_attribute: 0,
      strength: 0,
      accuracy_rate: 100,
      critical_rate: 3,
      max_hp_up: 0,
      max_mp_up: 0,
      magic: 0,
      agility: 0,
      weight: 0,
      evasion_rate: 0,
      attack: 0,
      defense: 0,
      ability_defense: 0,
      ability_evasion_rate: 0,
      ...values,
    });
  const content = (id: number, type: number, value: number) =>
    row({
      id,
      type_id: type,
      type_value: value,
      mes_id_name: "SYNTHETIC_" + id,
    });
  const parts = (id: number, allowed: number[]) =>
    row({
      id,
      ...Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [
          "equip" + (i + 1) + "_possible",
          Number(allowed.includes(i + 1)),
        ]),
      ),
    });
  const slots = [101, 201, 3, 4, 5, 5];
  const character = (id: number, dominant: number) =>
    row({
      id,
      dominant_arm: dominant,
      job_id: 12,
      initial_condition_group: 0,
      hp: 100,
      mp: 25,
      magic: 40,
      vitality: 25,
      attack: 20,
      strength: 30,
      defense: 30,
      ability_defense: 20,
      agility: 30,
      evasion_rate: 0,
      magic_evasion_rate: 0,
      ...Object.fromEntries(slots.map((v, i) => ["content_id" + (i + 1), v])),
    });
  const constants = new Map<string, number>([["MAX_ITEM", 99]]);
  for (const [key, name] of Object.entries(parameterLimitKeys))
    constants.set(
      name,
      equipmentLimits.parameters[key as keyof typeof parameterLimitKeys],
    );
  for (const [key, name] of Object.entries(physicalLimitKeys))
    constants.set(
      name,
      equipmentLimits.physical[key as keyof typeof equipmentLimits.physical],
    );
  const tables: Record<string, Record<string, string>[]> = {
    "content.csv": [
      content(1, 2, 1),
      content(2, 3, 1),
      content(3, 3, 2),
      content(4, 3, 3),
      content(5, 3, 4),
      content(101, 2, 7),
      content(201, 3, 7),
    ],
    "weapon.csv": [
      piece(1, 1, true),
      piece(7, 1, false, { attack: 30, attribute_id: 1 }),
    ],
    "armor.csv": [
      piece(1, 1, true),
      piece(2, 2, true),
      piece(3, 3, true),
      piece(4, 4, true),
      piece(7, 1, false, {
        defense: 15,
        ability_defense: 10,
        resistance_attribute: 9,
      }),
    ],
    "parts_group.csv": [
      parts(1, [1, 2]),
      parts(2, [3]),
      parts(3, [4]),
      parts(4, [5, 6]),
    ],
    "job_group.csv": [
      row({ id: 8, job1_accept: 0, job12_accept: 1, job99_accept: 0 }),
    ],
    "attribute.csv": [row({ id: 1 })],
    "attribute_group.csv": [
      row({ id: 33, group_id: 9, attribute_id: 1, type_id: 2 }),
    ],
    "character_status.csv": [character(1, 1), character(14, 2)],
    "game_constant_int.csv": [...constants].map(([key_name, value1], i) =>
      row({ id: i + 1, key_name, value1 }),
    ),
  };
  const source = {
    file: "synthetic",
    assetPath: "equipment",
    serializedFile: "fixture",
    objectId: "9223372036854775807",
  };
  const reader = () =>
    battleTableIndex(
      tables,
      Object.fromEntries(
        Object.keys(tables).map((t) => [t, { ...source, assetPath: t }]),
      ),
    );
  Object.assign(tables["character_status.csv"]![0]!, row({
    lv: 90, exp: 30, intelligence: 4, spirit: 5, luck: 0,
    mes_id_name: "SYNTHETIC_OWNER", ability_random_group_id: 22,
    command_id1: 41, command_id2: 42, command_id3: 0, command_id4: 0, command_id5: 0, command_id6: 0,
    ...Object.fromEntries(Array.from({length:8}, (_,i)=>["magical_times"+(i+1), 0]))
  }));
  tables["character_status.csv"]![0]!.id = "2";
  tables["character_default_name.csv"] = [row({id:1,character_id:2,tag_name:"OWNER_TAG",mes_id_name:"UNUSED_DEFAULT_NAME"})];
  tables["job.csv"] = [row({id:12,initial_condition:0,change_command_1:0,change_command_2:0,change_command_3:0,change_command_4:0,change_command_5:0}),row({id:1})];
  tables["ability_random_group.csv"] = [row({id:1,group_id:22,ability_id:220}),row({id:2,group_id:22,ability_id:31}),row({id:3,group_id:22,ability_id:229})];
  tables["ability.csv"] = [row({id:220,type_id:604,ability_group_id:7}),row({id:31,type_id:1,ability_group_id:1}),row({id:229,type_id:620,ability_group_id:0})];
  tables["content.csv"]!.push(content(601,4,220),content(602,4,31),content(603,4,229));
  tables["command.csv"] = [row({id:41,command_type:1,ability_group_id:7}),row({id:42,command_type:1,ability_group_id:8}),row({id:43,command_type:2,ability_group_id:0}),row({id:44,command_type:5,ability_group_id:0}),row({id:45,command_type:6,ability_group_id:0})];
  tables["sub_command.csv"] = [row({id:1,command_id:44,type_id:3}),row({id:2,command_id:45,type_id:1})];
  tables["ability_group.csv"] = [row({id:1,group_id:7,type_id:77}),row({id:2,group_id:8,type_id:78})];
  tables["chanting.csv"] = [row({id:77,ability_type_id:604}),row({id:78,ability_type_id:620})];
  tables["intermediate_growth_curve.csv"] = [row({id:1,character_id:2,job_id:12,exp_table_group_id:5})];
  tables["exp_table.csv"] = [row({id:1,group_id:5,type_id:1,total_exp:0,lv:1}),row({id:2,group_id:5,type_id:1,total_exp:30,lv:2}),row({id:3,group_id:5,type_id:1,total_exp:100,lv:3})];
  tables["game_constant_int.csv"]!.push(row({id:200,key_name:"MAX_EXP",value1:15000000}),row({id:201,key_name:"MAX_LV",value1:99}));
  return {tables,reader};
}
