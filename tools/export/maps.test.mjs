import test from "node:test";
import assert from "node:assert/strict";
import { compileMap } from "./maps.mjs";

test("PR collider entities retain their passage and transportation properties", () => {
  const source = {
    map: { data: { width: 8, height: 8, tilewidth: 16, layers: [], tilesets: [] } },
    entities: {
      data: {
        layers: [
          {
            name: "GroundObject",
            objects: [
              {
                x: 32,
                y: 48,
                gid: 1006,
                width: 16,
                height: 16,
                properties: Object.entries({
                  object_type: 19,
                  entity_id: 202,
                  collision_type: 1,
                  through_condition_type: 0,
                  target_transportation_ids: "1,3",
                }).map(([name, value]) => ({ name, value })),
              },
            ],
          },
        ],
      },
    },
  };
  const map = compileMap(
    { id: 3 },
    {
      pack: { data: {}, source: { file: "test" } },
      declaration: { tilemap: "map", entity_default: "entities" },
      assetAt: (name) => source[name],
      assetPath: (name) => name,
    },
    {},
    { textures: [] },
    {},
  );
  const barrier = map.entities[0];
  assert.deepEqual([barrier.x, barrier.y, barrier.layer], [2, 2, 1]);
  assert.deepEqual(barrier.collider, { type: 1, throughCondition: 0, transportationIds: [1, 3] });
});

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
