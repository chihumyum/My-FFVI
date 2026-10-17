import test from "node:test";
import assert from "node:assert/strict";
import { resolveFieldScriptMoveToTarget, type FieldScriptMoveTo } from "../src/core/field-script-motion.js";
import { fieldCameraCellToWorld } from "../src/core/field-camera.js";

const map = { x: 17, y: 25, width: 25, height: 27 };
const owner = fieldCameraCellToWorld(map, { x: 3, y: 4 }, 0);
const command = (target: FieldScriptMoveTo["target"], axis: "x" | "y" = "x"): FieldScriptMoveTo =>
  ({ kind: "move-to", axis, target, speedId: null, animation: "" });

test("MoveTo direct targets retain source global coordinates and the opposite owner axis", () => {
  const input = structuredClone(owner);
  assert.deepEqual(resolveFieldScriptMoveToTarget(command({ kind: "direct", value: 26, layer: 0 }), map, owner),
    { point: { x: 26, y: 29 }, logicalLayer: 0 });
  assert.deepEqual(resolveFieldScriptMoveToTarget(command({ kind: "direct", value: 33, layer: 0 }, "y"), map, owner),
    { point: { x: 20, y: 33 }, logicalLayer: 0 });
  assert.deepEqual(owner, input);
});

test("MoveTo negative direct targets are real coordinates, not SetPos kept-axis sentinels", () => {
  assert.deepEqual(resolveFieldScriptMoveToTarget(command({ kind: "direct", value: -2, layer: 0 }), map, owner),
    { point: { x: -2, y: 29 }, logicalLayer: 0 });
});

test("MoveTo uses source world-to-cell flooring with the half-cell anchor", () => {
  const between = fieldCameraCellToWorld(map, { x: 3.75, y: 4.25 }, 0);
  assert.equal(resolveFieldScriptMoveToTarget(command({ kind: "direct", value: 21, layer: 0 }), map, between), null);
  assert.deepEqual(resolveFieldScriptMoveToTarget(command({ kind: "direct", value: 23, layer: 0 }), map, between),
    { point: { x: 23, y: 29 }, logicalLayer: 0 });
});

test("MoveTo nullable-empty occurs before direct layer selection", () => {
  const same = command({ kind: "direct", value: 20, layer: 3 });
  assert.equal(resolveFieldScriptMoveToTarget(same, map, owner), null);
  // Equality needs no GetChangeLayerValue call, even when source Z would be unsupported.
  assert.equal(resolveFieldScriptMoveToTarget(same, map, { ...owner, z: 0 }), null);
  assert.throws(() => resolveFieldScriptMoveToTarget(command({ kind: "direct", value: 21, layer: 0 }), map,
    { ...owner, z: 0 }), /Z layer/);
});

test("MoveTo layer requests 1,2,3 select source Bottom, Ground, Upper independently", () => {
  for (const layer of [1, 2, 3]) {
    assert.equal(resolveFieldScriptMoveToTarget(command({ kind: "direct", value: 21, layer }), map, owner)!.logicalLayer,
      layer - 1);
  }
  const ground = fieldCameraCellToWorld(map, { x: 3, y: 4 }, 1);
  assert.equal(resolveFieldScriptMoveToTarget(command({ kind: "direct", value: 21, layer: 0 }), map, ground)!.logicalLayer, 1);
});

test("MoveTo entity captures only its selected axis, signed cell offset and source target layer", () => {
  const target = fieldCameraCellToWorld(map, { x: 8, y: 10 }, 1), saved = structuredClone(target);
  assert.deepEqual(resolveFieldScriptMoveToTarget(command({ kind: "entity", selector: -1001, offset: -1 }), map, owner, target),
    { point: { x: 24, y: 29 }, logicalLayer: 1 });
  assert.deepEqual(resolveFieldScriptMoveToTarget(command({ kind: "entity", selector: -1001, offset: 2 }, "y"), map, owner, target),
    { point: { x: 20, y: 37 }, logicalLayer: 1 });
  assert.deepEqual(target, saved);
});

test("MoveTo entity equality precedes offset and does not compare original world Z", () => {
  const target = fieldCameraCellToWorld(map, { x: 3, y: 10 }, 1);
  assert.equal(resolveFieldScriptMoveToTarget(command({ kind: "entity", selector: -1001, offset: 7 }), map, owner, target), null);
  const different = fieldCameraCellToWorld(map, { x: 4, y: 10 }, 0);
  assert.deepEqual(resolveFieldScriptMoveToTarget(command({ kind: "entity", selector: -1001, offset: -1 }), map, owner, different),
    { point: { x: 20, y: 29 }, logicalLayer: 0 });
});

test("MoveTo missing target, forged operands and unknown layers stay explicit failures", () => {
  const entity = command({ kind: "entity", selector: -1001, offset: 0 });
  assert.throws(() => resolveFieldScriptMoveToTarget(entity, map, owner), /target entity owner/);
  for (const malformed of [
    { ...entity, speedId: 7 }, { ...entity, axis: "z" },
    command({ kind: "direct", value: 21, layer: 4 }), command({ kind: "direct", value: 21.5, layer: 0 }),
    { ...entity, guessed: true },
  ]) assert.throws(() => resolveFieldScriptMoveToTarget(malformed as FieldScriptMoveTo, map, owner, owner));
  assert.throws(() => resolveFieldScriptMoveToTarget(entity, map, owner, { ...owner, z: Number.NaN }));
});
