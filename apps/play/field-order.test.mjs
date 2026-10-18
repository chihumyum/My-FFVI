import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  fieldTileOrder,
  fieldActorOrder,
  fieldTilePlane,
  fieldActorPosition,
  fieldBodyOrder,
  fieldBodySegments,
  fieldFloorOrder,
  fieldTileIsFloor,
} from "./field-order.js";

test("PR separate head/body passes straddle their furniture plane and stay below the ceiling", () => {
  const upper = fieldTileOrder({ name: "UpperLayer" }),
    ceiling = fieldTileOrder({ name: "CeilLayer" });
  // Terra's real bed actor on map395 and the shopkeepers on map107/108 use 2.
  for (const actor of [{ layer: 2 }, { layer: 2, y: 11 }]) {
    assert(fieldActorOrder(actor) > upper);
    assert(fieldBodyOrder(actor) < upper);
    assert(fieldBodyOrder(actor) > fieldTileOrder({ name: "GroundLayer" }));
    assert(fieldActorOrder(actor) < ceiling);
  }
  assert(fieldActorOrder({ layer: 1 }) < upper, "the lower floor stays below upper-floor art");
});

test("real cave walking floors cannot cover the body, while beds and upper bridges retain occlusion", async () => {
  const map = async (id) =>
    JSON.parse(await readFile(new URL(`../../build/web-data/maps/${id}.json`, import.meta.url)));
  for (const [id, x, y] of [
    [336, 45, 25],
    [340, 54, 13],
  ]) {
    const source = await map(id),
      layer = source.layers.find((layer) => layer.name === "GroundLayer");
    assert.equal(fieldTileIsFloor(source, layer, x, y), true, `Map${id}: walkable cave terrain`);
    assert(fieldFloorOrder(layer) < fieldBodyOrder({ layer: 1 }));
    assert(fieldBodyOrder({ layer: 1 }) < fieldTileOrder(layer));
  }
  for (const [id, name, x, y] of [
    [17, "GroundLayer", 13, 10],
    [395, "UpperLayer", 81, 17],
  ]) {
    const source = await map(id),
      layer = source.layers.find((layer) => layer.name === name);
    assert.equal(
      fieldTileIsFloor(source, layer, x, y),
      false,
      `Map${id}: bed furniture remains in front of body`,
    );
  }
  assert(
    fieldActorOrder({ layer: 1 }) < fieldFloorOrder({ name: "UpperLayer" }),
    "An upper walking floor still covers the lower-floor character",
  );
});

test("source body thresholds split one image without losing rows or changing its anchor", () => {
  for (const threshold of [12, 13, 16, 32]) {
    const segments = fieldBodySegments({ asset: "mo_ff6_p001", height: 32, threshold });
    assert.equal(
      segments.reduce((sum, row) => sum + row.height, 0),
      32,
    );
    const head = segments.find((row) => row.name === "head");
    const body = segments.find((row) => row.name === "body");
    assert.equal(body.height, threshold);
    assert.equal(body.top, head?.height ?? 0);
  }
  for (const variant of [
    { asset: "mo_ff6_b062" },
    { asset: "mo_ff6_p001", vehicle: 6 },
    { asset: "mo_ff6_p001", hideFeet: 8 },
  ])
    assert.deepEqual(fieldBodySegments({ height: 32, threshold: 16, ...variant }), [
      { name: "whole", top: 0, height: 32 },
    ]);
});

test("stairs change rendering floors without raising every character above every foreground", () => {
  assert(fieldActorOrder({ layer: 0 }) < fieldTileOrder({ name: "GroundLayer" }));
  assert(fieldActorOrder({ layer: 1 }) > fieldTileOrder({ name: "GroundLayer" }));
  assert(fieldActorOrder({ layer: 1 }) < fieldTileOrder({ name: "UpperLayer" }));
  assert(fieldActorOrder({ layer: 2 }) > fieldTileOrder({ name: "UpperLayer" }));
  assert(fieldActorOrder({ layer: 2 }) < fieldTileOrder({ name: "CeilLayer" }));
  assert.equal(fieldTilePlane({ name: "BottomWater" }), 0);
  assert.equal(fieldTilePlane({ name: "UpperWater" }), 2);
});

test("field sprite pivots use PR cell centers, keeping shopkeepers' feet behind counters", () => {
  assert.deepEqual(fieldActorPosition({ x: 8, y: 12 }, 16), { x: 136, y: 200 });
  // Map611's source route starts at pixel (392,296), matching actor (24,18).
  assert.deepEqual(fieldActorPosition({ x: 24, y: 18 }, 16), { x: 392, y: 296 });
  assert.deepEqual(fieldActorPosition({ x: 24.5, y: 18.25 }, 16), { x: 400, y: 300 });
});

test("water composites after ordinary tiles independently of the preceding map's container order", () => {
  for (const prefix of ["Bottom", "Ground", "Upper", "Ceil"]) {
    const tile = { name: prefix + "Layer", sourceGroup: "TileGroup" },
      water = { name: prefix + "Water", sourceGroup: "WaterGroup" };
    for (const previous of [
      [tile, water],
      [water, tile],
    ])
      assert.deepEqual(
        [...previous].sort((a, b) => fieldTileOrder(a) - fieldTileOrder(b)),
        [tile, water],
      );
    assert.ok(fieldTileOrder(water) > fieldTileOrder(tile));
    assert.ok(fieldTileOrder(water) < fieldActorOrder({ layer: fieldTilePlane(tile) }));
  }
});
