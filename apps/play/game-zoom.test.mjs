import assert from "node:assert/strict";
import test from "node:test";
import { zoomAt } from "./game-zoom.js";

test("pinch scales around its world anchor and can pan without scaling the UI", () => {
  const first = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 0.5, y: 0.4 });
  assert.deepEqual(first, { scale: 2, x: -0.5, y: -0.4 });
  const moved = zoomAt(first, 2, { x: 0.6, y: 0.5 }, { x: 0.5, y: 0.4 });
  assert.equal(moved.scale, 2);
  assert.ok(Math.abs(moved.x + 0.4) < 1e-9);
  assert.ok(Math.abs(moved.y + 0.3) < 1e-9);
});

test("zoom never exposes an empty border and restoring scale one removes all pan", () => {
  const original = { scale: 1, x: 0, y: 0 };
  assert.deepEqual(zoomAt(original, 8, { x: 0.5, y: 0.5 }), {
    scale: 3,
    x: -1,
    y: -1,
  });
  assert.deepEqual(zoomAt(original, 2, { x: -10, y: 10 }), {
    scale: 2,
    x: 0,
    y: -1,
  });
  assert.deepEqual(zoomAt({ scale: 3, x: -1, y: -1 }, 0, { x: 0.2, y: 0.8 }), {
    scale: 1,
    x: 0,
    y: 0,
  });
});
