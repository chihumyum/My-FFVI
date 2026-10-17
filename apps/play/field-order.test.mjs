import test from "node:test";
import assert from "node:assert/strict";
import {
  fieldTileOrder,
  fieldActorOrder,
  fieldTilePlane,
  fieldActorPosition,
} from "./field-order.js";

test("PR upper-floor beds and counter NPCs appear above UpperLayer but below the ceiling", () => {
  const upper = fieldTileOrder({ name: "UpperLayer" }),
    ceiling = fieldTileOrder({ name: "CeilLayer" });
  // Terra's real bed actor on map395 and the shopkeepers on map107/108 use 2.
  for (const actor of [{ layer: 2 }, { layer: 2, y: 11 }]) {
    assert(fieldActorOrder(actor) > upper);
    assert(fieldActorOrder(actor) < ceiling);
  }
  assert(fieldActorOrder({ layer: 1 }) < upper, "the lower floor stays below upper-floor art");
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
