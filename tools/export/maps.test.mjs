import test from "node:test";
import assert from "node:assert/strict";
import { compileMap } from "./maps.mjs";

test("PR polyline and polygon vertices retain their source geometry in actor cell coordinates", () => {
  const object = (shape, entityId) => ({
    x: 392,
    y: 296,
    width: 0,
    height: 0,
    [shape]: [
      { x: 0, y: 0 },
      { x: 16, y: 0 },
    ],
    properties: [
      { name: "object_type", value: 14 },
      { name: "object_id", value: 1 },
      { name: "entity_id", value: entityId },
    ],
  });
  const assets = {
    map: { data: { width: 40, height: 40, tilewidth: 16, layers: [], tilesets: [] } },
    entities: {
      data: {
        layers: [{ name: "GroundObject", objects: [object("polyline", 8), object("polygon", 9)] }],
      },
    },
  };
  const map = compileMap(
    { id: 611 },
    {
      pack: { data: {}, source: { file: "test" } },
      declaration: { tilemap: "map", entity_default: "entities" },
      assetAt: (name) => assets[name],
      assetPath: (name) => name,
    },
    {},
    { textures: [] },
    {},
  );
  assert.deepEqual(map.entities[0].polyline, {
    closed: false,
    points: [
      { x: 24, y: 18 },
      { x: 25, y: 18 },
    ],
  });
  assert.deepEqual(map.entities[1].polyline, {
    closed: true,
    points: [
      { x: 24, y: 18 },
      { x: 25, y: 18 },
    ],
  });
});
