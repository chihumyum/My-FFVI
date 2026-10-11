import type { BattleEntryCatalog, BattleItemMenuInput, FieldInvalidContentContext } from "../../src/core/battle-entry.js";
import type { BattleRow } from "../../src/compiler/battle.js";
import type { CorpusAsset } from "../../src/compiler/corpus.js";
import { equipmentCatalog } from "./equipment.js";

/** Invented rows exercise source semantics without distributing game content. */
export function battleEntryFixture() {
  const equipment = equipmentCatalog();
  const catalog: BattleEntryCatalog = {
    kind: "battle-entry-v1",
    maps: [
      { id: 100, sleepingAvailability: 0, movingAvailability: 1 },
      { id: 101, sleepingAvailability: 1, movingAvailability: 0 },
      { id: 102, sleepingAvailability: 0, movingAvailability: 2 },
    ],
    sleepingContents: [10001], movingContents: [{ id: 10002, value2: 0 }, { id: 10003, value2: 1 }],
    transportationContents: [10004], beastFieldContents: [10005], encounterExclusions: "constant-absent",
    items: [
      ...Object.values(equipment.definitions).map((item) => ({ id: item.id, type: item.kind === "weapon" ? 2 as const : 3 as const,
        listType: item.empty ? 2 : 1, throwFlag: 0, battleFunctionGroupId: 0 })),
      { id: 10001, type: 1, listType: 1, throwFlag: 0, battleFunctionGroupId: 8 },
      { id: 10002, type: 1, listType: 1, throwFlag: 1, battleFunctionGroupId: 8 },
      { id: 10003, type: 1, listType: 1, throwFlag: 0, battleFunctionGroupId: 0 },
      { id: 10004, type: 1, listType: 2, throwFlag: 0, battleFunctionGroupId: 8 },
      { id: 10005, type: 1, listType: 1, throwFlag: 0, battleFunctionGroupId: 8 },
    ],
    changeEquipmentSlots: [1, 2], characterItemRestrictions: "empty-source-provider",
  };
  const context: FieldInvalidContentContext = { mapId: 100, transportation: { id: 1, type: 1 }, isSavePoint: false, beastField: false };
  const input: BattleItemMenuInput = { sourceId: 1, equipment: [1, 2, 3, 4, 5, 5], inventory: [] };
  const tables: Record<string, Record<string, string>[]> = {
    "map.csv": catalog.maps.map((r) => ({ id: String(r.id), sleeping_availability: String(r.sleepingAvailability), moving_availability: String(r.movingAvailability) })),
    "game_constant_int.csv": [
      { id: "1", key_name: "FOR_SLEEPING_CONTENTS_DECISION_1", value1: "10001", value2: "0" },
      { id: "2", key_name: "FOR_MOVING_CONTENTS_DECISION_1", value1: "10002", value2: "0" },
      { id: "3", key_name: "FOR_MOVING_CONTENTS_DECISION_2", value1: "10003", value2: "1" },
      { id: "4", key_name: "FOR_SCRIPT_CONTENTS_TRANSPORTATION_IGNORE_1", value1: "10004", value2: "0" },
    ],
    "content.csv": catalog.items.map((r) => ({ id: String(r.id), type_id: String(r.type), type_value: String(r.id) })),
    "item.csv": catalog.items.filter((r) => r.type === 1).map((r) => ({ id: String(r.id), type_id: String(r.listType), throw_flag: String(r.throwFlag), battle_function_group_id: String(r.battleFunctionGroupId) })),
    "weapon.csv": catalog.items.filter((r) => r.type === 2).map((r) => ({ id: String(r.id), type_id: String(r.listType) })),
    "armor.csv": catalog.items.filter((r) => r.type === 3).map((r) => ({ id: String(r.id), type_id: String(r.listType) })),
  };
  const reader = { row(table: string, id: string | number): BattleRow {
    const rows = tables[table]?.filter((r) => r.id === String(id));
    if (rows?.length !== 1) throw new Error("Synthetic missing/ambiguous source row");
    return { values: rows[0]!, source: { file: "synthetic", serializedFile: "synthetic", objectId: "9007199254740997", assetPath: table, rowId: String(id) } };
  } };
  const misc: Pick<CorpusAsset, "source" | "data"> = {
    source: { file: "synthetic", serializedFile: "synthetic", objectId: "9007199254740998", assetPath: "Synthetic/serial_misc_assets.json", sha256: "a".repeat(64) },
    data: { beast_field_battle_command_invalid_table: [10005] },
  };
  return { catalog, equipment, context, input, tables, reader, misc };
}
