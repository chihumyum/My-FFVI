import test from "node:test";
import assert from "node:assert/strict";
import { prepareFieldCameraPathStep, type FieldCameraPathContext } from "../src/core/field-camera-path.js";
import { createFieldCameraState, fieldCameraCellToWorld } from "../src/core/field-camera.js";
import type { FieldScriptMove, FieldScriptMoveTo } from "../src/core/field-script-motion.js";

const context: FieldCameraPathContext = { mapRange: { x: 10, y: 20, width: 60, height: 40 },
  loop: { horizontal: false, vertical: false }, magnification: 1,
  view: "normal-field", callbacks: "source-absent", raycast: "disabled" };
function state() {
  const camera = createFieldCameraState();
  camera.target = "dummy";
  camera.dummy.position = fieldCameraCellToWorld(context.mapRange, { x: 4, y: 6 }, 1);
  camera.dummy.layer = 10; camera.dummy.direction = "up";
  camera.dummy.entityOffset = { x: 0, y: -6 };
  return camera;
}
const move = (patch: Partial<FieldScriptMove> = {}): FieldScriptMove =>
  ({ kind: "move", direction: "down", steps: 2, speedId: 0, animation: "", ...patch });
const moveTo = (patch: Partial<FieldScriptMoveTo> = {}): FieldScriptMoveTo =>
  ({ kind: "move-to", axis: "x", target: { kind: "direct", value: 16, layer: 0 },
    speedId: 0, animation: "", ...patch });

test("camera Move uses all seven source speeds, nullable default and global map coordinates without another position owner", () => {
  for (const [speedId, duration] of [240, 480, 120, 960, 60, 1920, 160].entries()) {
    const initial = state(), before = structuredClone(initial), command = move({ speedId });
    const first = prepareFieldCameraPathStep(initial, command, context, null, 1000);
    assert.equal(first.flow, "wait");
    assert.equal(first.progress.motion!.duration, duration);
    assert.deepEqual(first.progress.fromCell, { x: 14, y: 26 });
    assert.deepEqual(first.progress.motion!.to, { x: -408, y: 200 });
    assert.deepEqual(first.state.dummy.position, initial.dummy.position);
    assert.equal(first.state.dummy.direction, "down");
    assert.deepEqual(initial, before);
    assert.deepEqual(Object.keys(first.state).sort(), ["dummy", "kind", "target"]);
    assert.deepEqual(first.state.dummy.entityOffset, initial.dummy.entityOffset);
  }
  assert.equal(prepareFieldCameraPathStep(state(), move({ speedId: null }), context, null, 0)
    .progress.motion!.duration, 240);
});

test("multi-stage camera route interpolates one segment, starts the next on another clock, and completes once after its final drain", () => {
  const command = move(), initial = state();
  const first = prepareFieldCameraPathStep(initial, command, context, null, 1000);
  const sameClock = prepareFieldCameraPathStep(first.state, command, context, first.progress, 1000);
  assert.deepEqual(sameClock.progress, first.progress);
  const mid = prepareFieldCameraPathStep(first.state, command, context, first.progress, 1120);
  assert.deepEqual(mid.state.dummy.position, { x: -408, y: 208, z: 249 });
  const reached = prepareFieldCameraPathStep(mid.state, command, context, mid.progress, 1240);
  assert.equal(reached.completedSegment, true); assert.equal(reached.completedRoute, false);
  assert.deepEqual(reached.state.dummy.position, { x: -408, y: 200, z: 249 });
  const nextStart = prepareFieldCameraPathStep(reached.state, command, context, reached.progress, 1250);
  assert.equal(nextStart.progress.motion!.elapsed, 0);
  assert.deepEqual(nextStart.state.dummy.position, reached.state.dummy.position);
  const end = prepareFieldCameraPathStep(nextStart.state, command, context, nextStart.progress, 1490);
  assert.equal(end.flow, "wait");
  assert.deepEqual(end.state.dummy.position, { x: -408, y: 184, z: 249 });
  const drained = prepareFieldCameraPathStep(end.state, command, context, end.progress, 1500);
  assert.equal(drained.flow, "next"); assert.equal(drained.completedRoute, true);
  assert.equal(drained.progress.motion, null);
  assert.deepEqual(drained.state.dummy.entityOffset, initial.dummy.entityOffset);
  const repeated = prepareFieldCameraPathStep(drained.state, command, context, drained.progress, 1510);
  assert.equal(repeated.completedRoute, false); assert.deepEqual(repeated.state, drained.state);
});

test("large frame delta cannot fast-forward several source waypoints", () => {
  const command = move(), first = prepareFieldCameraPathStep(state(), command, context, null, 0);
  const big = prepareFieldCameraPathStep(first.state, command, context, first.progress, 2000);
  assert.deepEqual(big.state.dummy.position, { x: -408, y: 200, z: 249 });
  assert.equal(big.progress.motion!.route!.index, 0);
  assert.equal(big.flow, "wait");
  const next = prepareFieldCameraPathStep(big.state, command, context, big.progress, 2010);
  assert.equal(next.progress.motion!.route!.index, 1);
  assert.equal(next.progress.motion!.elapsed, 0);
});

test("empty Move retains its mandatory first wait; nullable-empty MoveTo immediately advances and ignores the source offset after equality", () => {
  const initial = state(), command = move({ steps: 0 });
  const first = prepareFieldCameraPathStep(initial, command, context, null, 0);
  assert.equal(first.flow, "wait"); assert.equal(first.progress.motion, null);
  assert.deepEqual(first.state, initial);
  assert.equal(prepareFieldCameraPathStep(first.state, command, context, first.progress, 0).flow, "wait");
  const next = prepareFieldCameraPathStep(first.state, command, context, first.progress, 10);
  assert.equal(next.flow, "next"); assert.equal(next.completedRoute, true);
  const sameAxis = moveTo({ target: { kind: "entity", selector: 27, offset: 99 } });
  const skipped = prepareFieldCameraPathStep(initial, sameAxis, {
    ...context, targetEntity: { ...initial.dummy.position, y: initial.dummy.position.y - 200 },
  }, null, 0);
  assert.equal(skipped.flow, "next"); assert.equal(skipped.progress.move, null);
  assert.deepEqual(skipped.state, initial);
});

test("direct MoveTo preserves nonzero map origin and negative source coordinates; entity target is frozen once", () => {
  const first = prepareFieldCameraPathStep(state(), moveTo(), context, null, 0);
  assert.deepEqual(first.progress.move, { kind: "move", direction: "right", steps: 2, speedId: 0, animation: "" });
  assert.deepEqual(first.progress.motion!.route!.points, [{ x: -392, y: 216 }, { x: -376, y: 216 }]);
  const negative = prepareFieldCameraPathStep(state(), moveTo({ target: { kind: "direct", value: 3, layer: 0 } }), context, null, 0);
  assert.equal(negative.progress.move!.direction, "left"); assert.equal(negative.progress.move!.steps, 11);
  assert.deepEqual(negative.progress.motion!.route!.points.at(-1), { x: -584, y: 216 });
  const entityCommand = moveTo({ target: { kind: "entity", selector: 27, offset: 1 } });
  const entity = fieldCameraCellToWorld(context.mapRange, { x: 6, y: 6 }, 1);
  const selected = prepareFieldCameraPathStep(state(), entityCommand, { ...context, targetEntity: entity }, null, 0);
  assert.equal(selected.progress.move!.steps, 3);
  const advanced = prepareFieldCameraPathStep(selected.state, entityCommand, {
    ...context, targetEntity: { ...entity, x: 9999 },
  }, selected.progress, 240);
  assert.equal(advanced.progress.move!.steps, 3);
  assert.deepEqual(advanced.progress.motion!.route!.points.at(-1), { x: -360, y: 216 });
});

test("unknown animation, callback, raycast, loop, bird and layer providers remain explicit gates without transform publication", () => {
  const initial = state(), before = structuredClone(initial);
  for (const input of [{ ...context, view: "bird" as const }, { ...context, callbacks: "unknown" as const },
    { ...context, raycast: "active" as const }, { ...context, raycast: "unknown" as const },
    { ...context, loop: { horizontal: true, vertical: false } }, { ...context, magnification: 2 }])
    assert.throws(() => prepareFieldCameraPathStep(initial, move(), input, null, 0), /provider|context|disposition/);
  assert.throws(() => prepareFieldCameraPathStep(initial, move({ animation: "Mystery" }), context, null, 0), /animation/);
  assert.throws(() => prepareFieldCameraPathStep(createFieldCameraState(), move(), context, null, 0), /source Z/);
  assert.throws(() => prepareFieldCameraPathStep(initial, moveTo({ target: { kind: "direct", value: 16, layer: 1 } }), context, null, 0), /layer/);
  assert.throws(() => prepareFieldCameraPathStep(initial, moveTo({ target: { kind: "entity", selector: 27, offset: 0 } }), context, null, 0), /target entity/);
  assert.deepEqual(initial, before);
});

test("stale transform, clock, command or map and forged waypoint registers cannot overwrite the camera owner", () => {
  const command = move(), first = prepareFieldCameraPathStep(state(), command, context, null, 1000);
  const beforeState = structuredClone(first.state), beforeProgress = structuredClone(first.progress);
  const changed = structuredClone(first.state); changed.dummy.position.x += 1;
  assert.throws(() => prepareFieldCameraPathStep(changed, command, context, first.progress, 1010), /outside its task/);
  assert.throws(() => prepareFieldCameraPathStep(first.state, command, context, first.progress, 999), /logical clock/);
  assert.throws(() => prepareFieldCameraPathStep(first.state, move({ steps: 3 }), context, first.progress, 1010), /command\/map/);
  assert.throws(() => prepareFieldCameraPathStep(first.state, command, {
    ...context, mapRange: { ...context.mapRange, x: 0 },
  }, first.progress, 1010), /command\/map/);
  const forged = structuredClone(first.progress); forged.motion!.route!.points[0]!.x += 1;
  assert.throws(() => prepareFieldCameraPathStep(first.state, command, context, forged, 1010), /waypoints/);
  assert.deepEqual(first.state, beforeState); assert.deepEqual(first.progress, beforeProgress);
});
