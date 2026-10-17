import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCollisionMapping,
  fieldCollisionRange,
  redirectAtSlope,
} from "../src/core/collision.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";

test("all four triangle orientations join neighboring floors without opening the triangle cell", () => {
  for (const [id, horizontal, hEdge, vertical, vEdge] of [
    [8, 3, 32, 1, 64],
    [9, 5, 16, 1, 128],
    [10, 5, 64, 7, 32],
    [11, 3, 128, 7, 16],
  ]) {
    const raw = Array(9).fill(0);
    raw[4] = id;
    const m = buildCollisionMapping(raw, 3, 3);
    assert.equal(m[4], 0);
    assert.equal(m[horizontal!], 15 | hEdge!);
    assert.equal(m[vertical!], 15 | vEdge!);
    assert.equal(
      m.reduce((n, v) => n + Number(v > 15), 0),
      2,
    );
  }
  for (const id of [12, 13]) {
    const raw = Array(9).fill(0);
    raw[4] = id;
    const m = buildCollisionMapping(raw, 3, 3);
    assert.equal(m[4], 0);
    assert.equal(m.filter((v) => v > 15).length, 4);
  }
});
test("solid corners, map cropping and unknown data cannot create diagonal shortcuts", () => {
  const raw = Array(25).fill(0);
  raw[12] = 8;
  raw[6] = 1;
  assert.equal(buildCollisionMapping(raw, 5, 5)[11], 15);
  raw[6] = 0;
  assert.equal(buildCollisionMapping(raw, 5, 5)[11], 47);
  const cropped = buildCollisionMapping(raw, 5, 5, {
    x: 2,
    y: 1,
    width: 3,
    height: 4,
  });
  assert.equal(cropped[11], 0);
  assert.equal(cropped[7], 15);
  raw[12] = 14;
  assert.throws(
    () => buildCollisionMapping(raw, 5, 5),
    /Unsupported collision/,
  );
  assert.throws(
    () => buildCollisionMapping(raw.slice(1), 5, 5),
    /Invalid collision grid/,
  );
});
test("native asymmetric endpoint test and crop-local zero-index exception remain intact", () => {
  // V allows up/down but blocks left. Native tests V/V-reverse, not H-reverse/V-reverse.
  const raw = Array(9).fill(0);
  raw[4] = 8;
  raw[1] = 5;
  assert.equal(buildCollisionMapping(raw, 3, 3)[1], 13 | 64);
  const pair = [10, 3, 4, 8];
  assert.deepEqual(buildCollisionMapping(pair, 2, 2), [0, 11, 7, 0]);
  const padded = Array(16).fill(1);
  [padded[5], padded[6], padded[9], padded[10]] = pair;
  const full = buildCollisionMapping(padded, 4, 4);
  assert.equal(full[9], 7 | 32);
  assert.equal(full[6], 11 | 64);
  const crop = buildCollisionMapping(padded, 4, 4, {
    x: 1,
    y: 1,
    width: 2,
    height: 2,
  });
  assert.equal(crop[9], 7);
  assert.equal(crop[6], 11);
});
test("mapping wraps only enabled axes and keeps source coordinates outside the crop blocked", () => {
  const raw = Array(25).fill(0);
  raw[11] = 8;
  const range = { x: 1, y: 1, width: 3, height: 3 };
  assert.equal(buildCollisionMapping(raw, 5, 5, range)[13], 15);
  const wrapped = buildCollisionMapping(raw, 5, 5, range, true);
  assert.equal(wrapped[13], 47);
  assert.equal(wrapped[6], 79);
  assert.equal(wrapped[10], 0);
});
test("keyboard slope redirection respects both input side and Tiled Y direction", () => {
  assert.deepEqual(redirectAtSlope(8, "right"), { x: 1, y: -1 });
  assert.deepEqual(redirectAtSlope(8, "down"), { x: -1, y: 1 });
  assert.equal(redirectAtSlope(8, "left"), null);
  assert.equal(redirectAtSlope(8, "up"), null);
  assert.deepEqual(redirectAtSlope(12, "left"), { x: -1, y: 1 });
  assert.deepEqual(redirectAtSlope(13, "up"), { x: -1, y: -1 });
  assert.equal(redirectAtSlope(1, "right"), null);
});
test("hidden MapRange is metadata; ambiguous and out-of-bounds ranges fail before movement", () => {
  const source = { file: "fixture", assetPath: "entity_default.json" };
  const data = {
    layers: [
      {
        name: "GroundObject",
        objects: [
          {
            visible: false,
            x: 16,
            y: 32,
            width: 48,
            height: 32,
            properties: [{ name: "object_type", value: 27 }],
          },
        ],
      },
    ],
  };
  const group = compileEntityGroup("entity_default", { data, source }, {});
  assert.deepEqual(group.blockers, []);
  assert.deepEqual(fieldCollisionRange(6, 6, group.entities), {
    x: 1,
    y: 2,
    width: 3,
    height: 2,
  });
  assert.throws(() => fieldCollisionRange(3, 3, group.entities), /map range/);
  assert.throws(
    () => fieldCollisionRange(6, 6, [...group.entities, ...group.entities]),
    /Ambiguous/,
  );
  assert.ok(
    compileEntityGroup("event", { data, source }, {}).blockers.some(
      (b) => b.reason === "Unsupported map range placement",
    ),
  );
});
