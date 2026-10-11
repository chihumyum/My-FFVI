import { ownedCharacterFixture } from "./owned-character.js";

export function newGameFixture() {
  const fixture = ownedCharacterFixture();
  const row = (value: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
  fixture.tables["initialize_data.csv"] = [
    row({ id: 1, key_name: "INIT_PARTY_1", value1: 2, value2: 0 }),
    row({ id: 2, key_name: "INIT_GIL", value1: 100, value2: 0 }),
    row({ id: 3, key_name: "INIT_ITEM_1", value1: 701, value2: 2 }),
    row({ id: 4, key_name: "INT_JOB_1", value1: 1, value2: 0 }),
    row({ id: 5, key_name: "INT_START_MAP_ID", value1: 901, value2: 22 }),
    row({ id: 6, key_name: "INT_MAP_POINTIN", value1: 7, value2: 0 }),
    row({ id: 7, key_name: "INIT_CORPS_1", value1: 2, value2: 0 }),
  ];
  fixture.tables["content.csv"]!.push(
    row({ id: 701, type_id: 1, type_value: 1, mes_id_name: "SYNTHETIC_ITEM" }),
  );
  fixture.tables["item.csv"] = [row({ id: 1, type_id: 3 })];
  fixture.tables["game_constant_int.csv"]!.push(
    row({ id: 301, key_name: "MAX_GIL", value1: 999 }),
  );
  fixture.tables["transportation.csv"] = [
    row({ id: 1, type_id: 1, asset_id: 0, release_flag: 700 }),
    row({ id: 9, type_id: 12, asset_id: 31, release_flag: 701 }),
  ];
  fixture.tables["map.csv"] = [
    row({
      id: 901,
      map_name: "Map_Synthetic",
      asset_name: "map_synthetic",
      script_id: 902,
    }),
  ];
  fixture.tables["script.csv"] = [
    row({ id: 22, script_name: "synthetic_new_game" }),
  ];
  const scripts = [
    {
      source: {
        file: "synthetic.bundle",
        assetPath:
          "Assets/GameAssets/Serial/Res/Map/Map_Synthetic/Map_Synthetic/synthetic_new_game.json",
        serializedFile: "synthetic",
        objectId: "9223372036854775807",
        sha256: "0".repeat(64),
      },
      data: { Name: "synthetic_new_game", Mnemonics: [], ScriptLocal: [] },
    },
  ];
  return { ...fixture, scripts };
}
