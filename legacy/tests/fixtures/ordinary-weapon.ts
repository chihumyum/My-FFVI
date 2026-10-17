import { equipmentCatalog } from "./equipment.js";
import { equipmentGameFixture } from "./equipment-game.js";
import { battleTableIndex } from "../../src/compiler/battle.js";
import type { BattleRowCatalog } from "../../src/core/battle-row.js";
import type { EquipmentCatalog } from "../../src/core/equipment.js";

/** Authored, controlled ranged weapon; no source game grant. */
export function ordinaryWeaponEquipment() {
  const catalog = equipmentCatalog();
  catalog.definitions[162] = {
    ...structuredClone(catalog.definitions[101]!), id: 162, equipmentId: 70,
    name: "Synthetic ranged weapon", ordinaryWeapon: {
      kind: "ordinary-weapon-v1", contentId: 162, weaponId: 70, typeId: 1, backFlag: 1,
    },
  };
  return catalog;
}

export function ordinaryWeaponRows(catalog: EquipmentCatalog): BattleRowCatalog {
  return {
    kind: "battle-row-v1",
    abilities: [{ id: 1, typeId: 3, ignoreRearguardAttack: false }],
    equipment: Object.values(catalog.definitions).map((item) => ({ contentId: item.id,
      weapon: item.ordinaryWeapon ? {
        typeId: item.ordinaryWeapon.typeId, backFlag: item.ordinaryWeapon.backFlag,
      } : null })),
  };
}

export function ordinaryWeaponGameFixture() {
  const fixture = equipmentGameFixture();
  const equipment = ordinaryWeaponEquipment();
  fixture.catalog.gameState.equipmentSystem!.catalog.definitions[162] = equipment.definitions[162]!;
  fixture.catalog.common.battleRows = ordinaryWeaponRows(fixture.catalog.gameState.equipmentSystem!.catalog);
  fixture.catalog.common.battleRows.abilities.push({ id: 13, typeId: 3, ignoreRearguardAttack: false });
  fixture.catalog.common.commands[100]!.abilityIds.push(13);
  fixture.catalog.common.players.forEach((player) => player.abilities.push(13));
  return fixture;
}

export function ordinaryWeaponReader(overrides: Record<string, string> = {}) {
  const numbers = ["wear_condition_group_id", "wear_function_group_id", "trigger_ability_id",
    "attribute_group_id", "attribute_id", "vitality", "intelligence", "spirit",
    "ability_disturbed_rate", "weak_attribute", "effective_species", "two_handed_flag",
    "additional_condition_group_id", "strength", "max_hp_up", "max_mp_up", "magic", "agility",
    "weight", "evasion_rate"];
  const weapon: Record<string, string> = {
    ...Object.fromEntries(numbers.map((column) => [column, "0"])), id: "70", type_id: "1",
    back_flag: "1", process_prog: "None", attack: "86", accuracy_rate: "100", critical_rate: "3",
    parts_group_id: "1", equip_job_group_id: "1", ...overrides,
  };
  const tables: Record<string, Record<string, string>[]> = {
    "content.csv": [{ id: "162", type_id: "2", type_value: weapon.id!, mes_id_name: "SYNTHETIC_RANGED" }],
    "weapon.csv": [weapon],
    "parts_group.csv": [{ id: "1", equip1_possible: "1", equip2_possible: "1",
      equip3_possible: "0", equip4_possible: "0", equip5_possible: "0", equip6_possible: "0" }],
    "job_group.csv": [{ id: "1", job1_accept: "1", job2_accept: "0" }],
  };
  const sources = Object.fromEntries(Object.keys(tables).map((table) => [table,
    { file: "synthetic-ordinary-weapon", assetPath: table, objectId: "1", serializedFile: "fixture" }]));
  return { tables, reader: battleTableIndex(tables, sources), weapon };
}
