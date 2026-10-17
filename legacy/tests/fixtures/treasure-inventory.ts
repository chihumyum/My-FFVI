import type { TreasureInventorySource } from "../../src/compiler/treasure-inventory.js";

export const treasureSource: TreasureInventorySource = {
  sourceSetHash: "1".repeat(64), file: "synthetic.bundle", assetPath: "synthetic/entity.json",
  objectId: "9223372036854775806", serializedFile: "synthetic-serialized", sha256: "2".repeat(64),
  pointer: "/layers/0/objects/1",
};
export function treasureTables() {
  return {
    "content.csv": [
      { id: "101", type_id: "1", type_value: "51", mes_id_name: "SYN_ITEM" },
      { id: "102", type_id: "1", type_value: "52", mes_id_name: "SYN_KEY" },
      { id: "201", type_id: "2", type_value: "71", mes_id_name: "SYN_WEAPON" },
      { id: "301", type_id: "3", type_value: "81", mes_id_name: "SYN_ARMOR" },
      { id: "501", type_id: "5", type_value: "1", mes_id_name: "SYN_GIL" },
      { id: "901", type_id: "9", type_value: "1", mes_id_name: "SYN_STONE" },
    ],
    "item.csv": [{ id: "51", type_id: "1" }, { id: "52", type_id: "2" }],
    "weapon.csv": [{ id: "71", type_id: "1" }],
    "armor.csv": [{ id: "81", type_id: "1" }],
    "action.csv": [{ id: "6", action_name: "OpenTresureBox" }],
    "transportation.csv": [
      { id: "1", type_id: "1", asset_id: "0" },
      { id: "6", type_id: "12", asset_id: "38" },
      { id: "8", type_id: "8", asset_id: "40" },
    ],
    "field_character_asset.csv": [
      { id: "38", asset_name: "synthetic-armor" },
      { id: "40", asset_name: "synthetic-airship" },
    ],
    "script.csv": [{ id: "31", script_name: "synthetic-treasure" }],
    "message_conclusion.csv": [
      { id: "71", key_name: "NO_TREASURE_BOX_CONTENT", message_id: "SYN_EMPTY" },
      { id: "72", key_name: "MAX_POSSESSION_TREASURE_BOX_CONTENT", message_id: "SYN_FULL" },
    ],
    "game_constant_int.csv": [
      { id: "100", key_name: "MAX_ITEM", value1: "99" },
      { id: "101", key_name: "MAX_GIL", value1: "9999999" },
    ],
  };
}
export function treasureEntityAsset(properties: Record<string, unknown> = {}, geometry = {}) {
  return { source: treasureSource, data: { layers: [{ name: "GroundObject", objects: [{
    x: 32, y: 48, width: 16, height: 16, gid: 999, ...geometry,
    properties: Object.entries(treasureProperties({ asset_id: 0, object_id: 77, collision: true,
      birdview_puppet: false, accept_action_direction: 15, talk_target_transportation_ids: "",
      target_transportation_ids: "", gimmick: false, ...properties,
    })).map(([name, value]) => ({ name, value })),
  }] }] } };
}
export function treasureProperties(change: Record<string, unknown> = {}) {
  return {
    object_type: 7, action_id: 6, entity_id: 42, content_id: 101, content_num: 1,
    flag_id: 260, script_id: 0, pick_up: false, se_id: 909,
    link_object_id: 100, message_key: "SYNTHETIC_TREASURE", ...change,
  };
}
export function treasureInstruction(values = [42, 0, 0]) {
  return { mnemonic: "TreasureBox", type: 1, operands: {
    iValues: [...values, ...Array(8 - values.length).fill(0)],
    rValues: Array(8).fill(0), sValues: Array(8).fill(""),
  } };
}
