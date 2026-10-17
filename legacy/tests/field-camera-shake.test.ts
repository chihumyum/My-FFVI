import assert from "node:assert/strict";
import test from "node:test";
import { FieldCameraShakeState, createWebFieldCameraShakePolicy, fieldShakePeriod, parseFieldShakeCommand,
  projectFieldShakeCameraOffset,
  type FieldShakeCommand, type FieldShakeBinding } from "../src/core/field-camera-shake.js";
import { compileFieldShakeInstruction } from "../src/compiler/field-shake.js";
import { decodeFieldOp } from "../src/compiler/field.js";

const sourceSet = "a".repeat(64), policy = createWebFieldCameraShakePolicy(1234),
  origin: FieldShakeBinding = { mapId: 7, mapContentHash: "b".repeat(64), script: "Resident/earthquake", webPc: 3 };
const play = (axis: 0 | 1 | 2 = 0, strength: 0 | 1 = 0, intervalScale = 0, reexecute = 0): FieldShakeCommand =>
  ({ kind: "play", axis, strength, intervalScale: Math.fround(intervalScale), reexecute });
const raw = (i = [1, 0, 0, 0, 0, 0, 0, 0], r = [0, 0, 0, 0, 0, 0, 0, 0]) =>
  ({ type: 1, mnemonic: "Shake", operands: { iValues: i, rValues: r, sValues: Array<string>(8).fill("") } });

test("the whole six-type family retains interval, zero-default and nonboolean re-execute semantics", () => {
  for (const axis of [0, 1, 2] as const) for (const strength of [0, 1] as const)
    for (const scale of [0, 0.5, 1, 2, 3, 5]) for (const reexecute of [0, 1, 30]) {
      const op = compileFieldShakeInstruction(raw([1, axis, strength, reexecute, 0, 0, 0, 0], [scale, 0, 0, 0, 0, 0, 0, 0]));
      assert.deepEqual(op, { kind: "field-shake", command: play(axis, strength, scale, reexecute) });
      assert.equal(fieldShakePeriod(op.command as Extract<FieldShakeCommand, { kind: "play" }>),
        Math.fround(Math.fround(Math.fround(1 / 30) / (strength + 1)) * (scale || 1)));
    }
  for (const i of [[0], [0, 2, 1, 0, 0, 0, 0, 0]])
    assert.deepEqual(compileFieldShakeInstruction({ type: 1, mnemonic: "Shake", operands: { iValues: i } }),
      { kind: "field-shake", command: { kind: "stop" } });
});

test("source namespace, reserved arrays and missing consumed i3 remain blocked in the real decoder", () => {
  const site = { script: "earthquake", index: 99, source: { file: "controlled", assetPath: "controlled/shake" } };
  assert.equal(decodeFieldOp(raw(), site, {}).kind, "field-shake");
  for (const value of [{ ...raw(), type: 0 }, { ...raw(), type: 2 }, { ...raw(), type: 3 },
    { mnemonic: "Shake", operands: raw().operands }, raw([1, 0, 0]), raw([1, 3, 0, 0, 0, 0, 0, 0]),
    raw([1, 0, 2, 0, 0, 0, 0, 0]), raw([1, 0, 0, 0, 0, 0, 0, 1]), raw(undefined, [1, 1, 0, 0, 0, 0, 0, 0]),
    raw(undefined, [-1, 0, 0, 0, 0, 0, 0, 0]), raw(undefined, [1e50, 0, 0, 0, 0, 0, 0, 0])]) {
    assert.equal(decodeFieldOp(value, site, {}).kind, "blocked");
    assert.throws(() => compileFieldShakeInstruction(value));
  }
  let getter = 0;
  const sparse = raw(); delete (sparse.operands.iValues as Partial<number[]>)[1];
  assert.throws(() => compileFieldShakeInstruction(sparse));
  const data = raw(); Object.defineProperty(data.operands.iValues, "1", { enumerable: true, get() { getter++; return 0; } });
  assert.throws(() => compileFieldShakeInstruction(data)); assert.equal(getter, 0);
});

test("samples continue indefinitely, at strict intervals with one pair of draws per fixed step", () => {
  const state = new FieldCameraShakeState(sourceSet, policy); state.start(play(), origin);
  for (let i = 0; i < 3; i++) state.advance();
  assert.deepEqual(state.projection, { x: 0, y: 0 }); assert.equal(state.snapshot()!.samples, 0);
  state.advance(); assert.equal(state.snapshot()!.samples, 1); assert.notEqual(state.snapshot()!.active!.scale.x, 0);
  assert.equal(state.projection.x, 0, "the first subpixel source sample rounds at the actual camera callback");
  assert.equal(state.projection.y, 0, "zero-range Y still has its own draw");
  for (let i = 0; i < 10000; i++) state.advance();
  assert.ok(state.snapshot()!.active, "the source interval is not a total lifetime");
  assert.equal(state.snapshot()!.samples, 2501);
  const state2 = new FieldCameraShakeState(sourceSet, policy); state2.start(play(2, 1, .5), origin);
  state2.advance(); assert.equal(state2.snapshot()!.samples, 1, "a small interval does not create catch-up draws");
  const original = state.snapshot()!; state.start({ kind: "stop" }, null);
  assert.deepEqual(state.projection, { x: 0, y: 0 }); assert.equal(state.snapshot()!.active, null);
  assert.equal(state.snapshot()!.rngState, original.rngState);
  state.advance(); assert.equal(state.snapshot()!.samples, original.samples);
});

test("all six ranges include source high cross-axis values without touching any logical position", () => {
  const expected = [[2, 0], [4, 1], [0, 2], [1, 4], [2, 2], [4, 4]];
  for (const axis of [0, 1, 2] as const) for (const strength of [0, 1] as const) {
    const state = new FieldCameraShakeState(sourceSet, policy); state.start(play(axis, strength), origin);
    for (let i = 0; i < 4; i++) state.advance();
    const active = state.snapshot()!.active!, range = expected[axis * 2 + strength]!;
    assert.deepEqual(state.projection, projectFieldShakeCameraOffset({ x: Math.fround(active.scale.x * range[0]!),
      y: Math.fround(active.scale.y * range[1]!) }));
    assert.ok(!("position" in active)); assert.ok(!("camera" in active));
  }
  assert.deepEqual(projectFieldShakeCameraOffset({ x: -.5, y: .5 }), { x: 0, y: 0 });
  assert.deepEqual(projectFieldShakeCameraOffset({ x: -1.5, y: 1.5 }), { x: -2, y: 2 });
});

test("save/restore continues the exact stream and does not reinitialize or draw; policy cannot come from the save", () => {
  const state = new FieldCameraShakeState(sourceSet, policy); state.start(play(1, 1, 2, 30), origin);
  for (let i = 0; i < 27; i++) state.advance();
  const saved = state.snapshot()!, seen: unknown[] = [], restored = FieldCameraShakeState.restore(saved, sourceSet, policy,
    (binding, command) => { seen.push({ binding, command }); assert.deepEqual(binding, origin); });
  assert.equal(seen.length, 1); assert.deepEqual(restored.snapshot(), saved);
  for (let i = 0; i < 400; i++) { state.advance(); restored.advance(); }
  assert.deepEqual(restored.snapshot(), state.snapshot());
  saved.active!.scale.x = 1; assert.notEqual(state.snapshot()!.active!.scale.x, 1);
  for (const change of [
    (value: typeof saved) => { value.sourceSetHash = "c".repeat(64); },
    (value: typeof saved) => { value.policy.seed++; },
    (value: typeof saved) => { value.rngState = 0; },
    (value: typeof saved) => { value.active!.counter = Math.fround(100); },
    (value: typeof saved) => { value.active!.scale.x = 2; },
  ]) {
    const forged = state.snapshot()!; change(forged);
    assert.throws(() => FieldCameraShakeState.restore(forged, sourceSet, policy, () => {}));
  }
  assert.throws(() => FieldCameraShakeState.restore(state.snapshot()!, sourceSet, policy, () => { throw new Error("changed origin"); }));
});

test("battle resume preserves the stream and only retained shakes restart after successful publication", () => {
  for (const reexecute of [0, 1, 30]) {
    const state = new FieldCameraShakeState(sourceSet, policy); state.start(play(2, 1, 3, reexecute), origin);
    for (let i = 0; i < 19; i++) state.advance();
    const prior = state.snapshot()!, resumed = state.afterBattle();
    assert.deepEqual(state.snapshot(), prior);
    assert.equal(resumed.snapshot()!.rngState, prior.rngState); assert.equal(resumed.snapshot()!.samples, prior.samples);
    if (reexecute) {
      assert.ok(resumed.snapshot()!.active); assert.equal(resumed.snapshot()!.active!.counter, 0);
      assert.deepEqual(resumed.projection, { x: 0, y: 0 });
    } else assert.equal(resumed.snapshot()!.active, null);
  }
});

test("invalid command and source binding fail before changing the existing shake", () => {
  const state = new FieldCameraShakeState(sourceSet, policy); state.start(play(), origin); state.advance();
  const before = state.snapshot();
  for (const command of [play(3 as 0), play(0, 2 as 0), play(0, 0, -1), { kind: "stop", unsafe: true }]) {
    assert.throws(() => state.start(command as FieldShakeCommand, origin)); assert.deepEqual(state.snapshot(), before);
  }
  assert.throws(() => state.start(play(), { ...origin, mapContentHash: "wrong" })); assert.deepEqual(state.snapshot(), before);
  assert.throws(() => state.start(play(), null)); assert.deepEqual(state.snapshot(), before);
  let reads = 0;
  assert.throws(() => parseFieldShakeCommand({ get kind() { reads++; return "stop" as const; } })); assert.equal(reads, 0);
  assert.throws(() => createWebFieldCameraShakePolicy(0));
});
