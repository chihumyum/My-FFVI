import test from "node:test";
import assert from "node:assert/strict";
import { palettePlaneProperties } from "./water-controls.mjs";

test("water palette speed survives PR package paths with or without TextAsset extension", () => {
  const source = "Assets/Map/Map_20300/tilemap";
  const sources = new Map([
    [
      source + ".json",
      {
        layers: [
          {
            name: "TileGroup",
            layers: [
              { name: "BottomLayer", properties: [{ name: "pal_anim_speed", value: 0.38 }] },
              { name: "GroundLayer" },
            ],
          },
        ],
      },
    ],
  ]);
  for (const path of [source, source + ".json"]) {
    assert.deepEqual(palettePlaneProperties(sources, path, "BottomWater"), {
      layer: "BottomLayer",
      properties: { pal_anim_speed: 0.38 },
    });
    assert.deepEqual(palettePlaneProperties(sources, path, "GroundWater"), {
      layer: "GroundLayer",
      properties: {},
    });
  }
  assert.deepEqual(palettePlaneProperties(sources, "missing", "BottomWater"), {
    layer: null,
    properties: {},
  });
});
