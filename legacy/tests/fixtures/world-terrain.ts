import { battleTableIndex } from "../../src/compiler/battle.js";
import type { WorldTerrainCompilationInput } from "../../src/compiler/world-terrain.js";

/** Redistributable control data. Raw Foot IDs intentionally differ from their
 * master TypeIds; transport ID9 is the player, not TypeId1 or GroupId6. */
export function worldTerrainFixture(): WorldTerrainCompilationInput {
  const source = (assetPath: string, objectId: string) => ({ file: "synthetic.bundle", assetPath, objectId,
    serializedFile: "synthetic-cab", sha256: "a".repeat(64) });
  const packageAsset = { source: source("Synthetic/Map/package.json", "-9007199254740999"), data: {
    asset_group_name: "synthetic-world", map: [{ name: "Map_W", attribute: "Map_W/attribute", transportation: "Map_W/transportation" }],
  } };
  const layer = (id: number, name: string, data: number[]) => ({ id, name, type: "tilelayer", width: 3, height: 2, x: 0, y: 0, data });
  const assets = [packageAsset,
    { source: source("Synthetic/Map/Map_W/attribute.json", "-9007199254740998"),
      data: { type: "group", x: 0, y: 0, layers: [layer(12, "BottomAttribute", [7, 21, 7, 21, 7, 21])] } },
    { source: source("Synthetic/Map/Map_W/transportation.json", "-9007199254740997"),
      data: { type: "group", x: 0, y: 0, layers: [layer(6, "Transportation06", [0, 1, 0, 1, 0, 1]),
        layer(1, "Transportation01", [1, 0, 1, 0, 1, 0]), layer(2, "Transportation02", [0, 0, 0, 0, 0, 0])] } },
  ];
  const flags = Object.fromEntries(Array.from({ length: 32 }, (_, index) =>
    [index < 3 ? `type${index + 1}` : `type_${index + 1}`, "1"]));
  const tables: Record<string, Record<string, string>[]> = {
    "map.csv": [{ id: "40", area_id: "3", map_name: "Map_W", asset_name: "synthetic-world", loop_type: "3" }],
    "area.csv": [{ id: "3", map_type: "0", area_name: "CONTROL_WORLD" }],
    "foot_information.csv": [
      { id: "7", type_id: "16", subtract_steps: "2", battle_background_asset_id: "11" },
      { id: "21", type_id: "2", subtract_steps: "3", battle_background_asset_id: "12" },
    ],
    "transportation.csv": [
      { id: "9", type_id: "1", transportation_group_id: "6" },
      { id: "6", type_id: "12", transportation_group_id: "1" },
      { id: "1", type_id: "2", transportation_group_id: "2" },
    ],
    "transportation_group.csv": [1, 2, 6].map(id => ({ id: String(id), ...flags })),
  };
  const tableSources = Object.fromEntries(Object.keys(tables).map((name, index) => [name, {
    file: "synthetic-tables.bundle", assetPath: `Synthetic/Data/${name}`, objectId: String(-9100000 - index), serializedFile: "synthetic-tables-cab",
  }]));
  return { mapId: 40, mapName: "Map_W", sourceSetHash: "c".repeat(64), parentSourceSetHash: "d".repeat(64),
    width: 3, height: 2, mapRange: { x: 0, y: 0, width: 3, height: 2 }, packageAsset, assets, tables,
    reader: battleTableIndex(tables, tableSources),
    sources: [{ file: "synthetic.bundle", sha256: "a".repeat(64) }, { file: "synthetic-tables.bundle", sha256: "b".repeat(64) }] };
}
