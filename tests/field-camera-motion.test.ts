import test from "node:test";
import assert from "node:assert/strict";
import { createFieldCameraState, fieldCameraActorFromCell, fieldCameraCellToWorld,
  fieldCameraLayerFromLogical, fieldCameraSelectsDummyAtScriptStart, fieldCameraWorldToCell,
  fieldCameraWorldToContinuousCell, projectFieldCameraSetPosition, projectFieldCameraTarget,
  stepFieldCameraLerp, validateFieldCameraLerpProgress, type FieldCameraLerp,
  type FieldCameraMapRange } from "../src/core/field-camera.js";
import { compileFieldCameraMapRange, compileFieldCameraMotionInstruction } from "../src/compiler/field-camera.js";

const map: FieldCameraMapRange = { x: 10, y: 20, width: 60, height: 40 };
const state = () => projectFieldCameraTarget(createFieldCameraState(), { target: "dummy" },
  fieldCameraActorFromCell(map, { x: 19, y: 5 }, 1, "down", { x: 3, y: -2 }), { 10: 249 }).state;
const command = (): FieldCameraLerp => ({ kind: "lerp", x: 29, y: 44, layer: 0, duration: 11, arcHeight: 0 });
const raw = (mnemonic: string) => ({ type: 2, mnemonic, operands: {
  iValues: [29, 25, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });

test("source script admission selects dummy independently of scene-state behavior", () => {
  assert.equal(fieldCameraSelectsDummyAtScriptStart(true), true);
  assert.equal(fieldCameraSelectsDummyAtScriptStart(false), false);
  assert.throws(() => fieldCameraSelectsDummyAtScriptStart(1 as never));
});

test("source cells use centred 16-pixel world coordinates and explicit three-level mapping", () => {
  assert.deepEqual(fieldCameraCellToWorld(map, { x: 0, y: 0 }, 1), { x: -472, y: 312, z: 249 });
  assert.deepEqual(fieldCameraCellToWorld(map, { x: 59, y: 39 }, 0), { x: 472, y: -312, z: 349 });
  assert.deepEqual([0, 1, 2].map(fieldCameraLayerFromLogical),
    [{ layer: 9, layerZ: 349 }, { layer: 10, layerZ: 249 }, { layer: 11, layerZ: 149 }]);
  assert.throws(() => fieldCameraLayerFromLogical(3));
  assert.deepEqual(fieldCameraWorldToCell(map, { x: -471, y: 311 }), { x: 0, y: 0 });
  assert.deepEqual(fieldCameraWorldToCell(map, { x: -481, y: 321 }), { x: -1, y: -1 });
  assert.deepEqual(fieldCameraWorldToContinuousCell(map, { x: -464, y: 304 }), { x: 0.5, y: 0.5 });
});

test("SetPos converts map-range origin before negative-axis retention and preserves dummy identity", () => {
  const before = state(), original = structuredClone(before);
  before.dummy.position.x += 3;
  const plan = projectFieldCameraSetPosition(before, { kind: "set-position", x: 9, y: 28, layer: 0 }, map);
  assert.deepEqual(plan.state.dummy.position, fieldCameraCellToWorld(map, { x: 19, y: 8 }, 1));
  assert.equal(plan.state.dummy.layer, 10);
  assert.equal(plan.state.dummy.direction, "down");
  assert.deepEqual(plan.state.dummy.entityOffset, { x: 3, y: -2 });
  assert.deepEqual(plan.notifySetPosition, { sourceEntityId: 0,
    from: before.dummy.position, to: plan.state.dummy.position });
  assert.equal(before.dummy.position.x, original.dummy.position.x + 3);
});

test("SetPos rejects unknown Z and layer-change rather than preserving a fabricated source layer", () => {
  const s = state(), before = structuredClone(s);
  s.dummy.position.z = 244;
  assert.throws(() => projectFieldCameraSetPosition(s, { kind: "set-position", x: 29, y: 25, layer: 0 }, map), /Z layer/);
  assert.throws(() => projectFieldCameraSetPosition(before, { kind: "set-position", x: 29, y: 25, layer: 1 } as never, map), /layer-change/);
  assert.equal(s.dummy.position.z, 244);
});

test("positive camera Lerp first waits at ratio zero and completes at source time, restoring depth", () => {
  const s = state(), before = structuredClone(s), cmd = command();
  const first = stepFieldCameraLerp(s, cmd, map, null, 100);
  assert.equal(first.flow, "wait");
  assert.deepEqual(first.state.dummy.position, { ...s.dummy.position, z: 244 });
  const halfway = stepFieldCameraLerp(first.state, cmd, map, first.progress, 105.5);
  assert.deepEqual(halfway.state.dummy.position,
    { x: s.dummy.position.x, y: s.dummy.position.y - 152, z: 244 });
  const done = stepFieldCameraLerp(halfway.state, cmd, map, halfway.progress, 111);
  assert.equal(done.flow, "next");
  assert.deepEqual(done.state.dummy.position, fieldCameraCellToWorld(map, { x: 19, y: 24 }, 1));
  assert.deepEqual(s, before);
  assert.deepEqual(done.progress, first.progress);
});

test("zero duration commits its endpoint on first clock; negative duration stays signed", () => {
  const s = state(), cmd = command();
  const zero = stepFieldCameraLerp(s, { ...cmd, duration: 0 }, map, null, 5);
  assert.equal(zero.flow, "next");
  assert.deepEqual(zero.state.dummy.position, fieldCameraCellToWorld(map, { x: 19, y: 24 }, 1));
  const first = stepFieldCameraLerp(s, { ...cmd, duration: -11 }, map, null, 5);
  const later = stepFieldCameraLerp(first.state, { ...cmd, duration: -11 }, map, first.progress, 16);
  assert.equal(later.flow, "wait");
  assert.deepEqual(later.state.dummy.position, { ...s.dummy.position, z: 244 });
});

test("non-sprite camera arc adds native parabola to world Y and vanishes at endpoint", () => {
  const cmd = { ...command(), arcHeight: 40 }, s = state();
  const first = stepFieldCameraLerp(s, cmd, map, null, 0);
  const mid = stepFieldCameraLerp(first.state, cmd, map, first.progress, 5.5);
  assert.equal(mid.state.dummy.position.y, s.dummy.position.y - 152 + 40);
  const done = stepFieldCameraLerp(mid.state, cmd, map, mid.progress, 100);
  assert.equal(done.state.dummy.position.y, fieldCameraCellToWorld(map, { x: 19, y: 24 }, 1).y);
});

test("Lerp checkpoint retains first-clock float time and resumes identically", () => {
  const s = state(), cmd = command(), time = 100.000001;
  const first = stepFieldCameraLerp(s, cmd, map, null, time);
  assert.equal(first.progress.startedAt, Math.fround(time));
  const restored = JSON.parse(JSON.stringify(first));
  validateFieldCameraLerpProgress(restored.progress);
  assert.deepEqual(stepFieldCameraLerp(restored.state, cmd, map, restored.progress, 105),
    stepFieldCameraLerp(first.state, cmd, map, first.progress, 105));
  assert.throws(() => stepFieldCameraLerp(s, cmd, map, first.progress, 99), /clock/);
  assert.throws(() => validateFieldCameraLerpProgress({ ...first.progress, position: { x: 0, y: 0 } } as never));
});

test("camera motion decoder keeps source operands and rejects unresolved hosts", () => {
  assert.deepEqual(compileFieldCameraMotionInstruction(raw("SetPos")), { kind: "field-camera-motion",
    command: { kind: "set-position", x: 29, y: 25, layer: 0 } });
  const lerp = raw("Lerp"); lerp.operands.rValues[0] = -11; lerp.operands.rValues[1] = 3;
  assert.deepEqual(compileFieldCameraMotionInstruction(lerp), { kind: "field-camera-motion",
    command: { kind: "lerp", x: 29, y: 25, layer: 0, duration: -11, arcHeight: 3 } });
  for (const mutate of [(v: typeof lerp) => { v.type = 1; },
    (v: typeof lerp) => { v.operands.iValues[2] = 1; },
    (v: typeof lerp) => { v.operands.iValues[3] = 1; },
    (v: typeof lerp) => { v.operands.sValues[0] = "Walk"; },
    (v: typeof lerp) => { v.operands.rValues[2] = 1; }]) {
    const bad = structuredClone(lerp); mutate(bad);
    assert.throws(() => compileFieldCameraMotionInstruction(bad));
  }
});

test("source map range starts with full tile geometry and uses first type27 in source order", () => {
  const tiles = { width: 42, height: 32, tilewidth: 16, tileheight: 16 };
  const object = (type: number, x: number) => ({ id: 17, x, y: -31, width: 161, height: 95,
    properties: [{ name: "object_type", type: "int", value: type }] });
  assert.deepEqual(compileFieldCameraMapRange(tiles, { layers: [{ objects: [object(0, 0)] }] }),
    { x: 0, y: 0, width: 42, height: 32 });
  const range = compileFieldCameraMapRange(tiles, { layers: [
    { objects: [object(0, 0), object(27, -17), object(27, 64)] }, { objects: [object(27, 96)] }] });
  assert.deepEqual(range, { x: -1, y: -1, width: 10, height: 5 });
  assert.throws(() => compileFieldCameraMapRange(tiles, { layers: [{ objects: [{ properties: [] }] }] }), /object_type/);
  assert.throws(() => compileFieldCameraMapRange({ ...tiles, tilewidth: 32 }, { layers: [] }), /16-pixel/);
  assert.throws(() => compileFieldCameraMapRange(tiles, {}));
});
