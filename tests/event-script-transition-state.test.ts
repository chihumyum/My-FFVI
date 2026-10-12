import assert from "node:assert/strict";
import test from "node:test";
import { EventState, type ScriptLocalFrame } from "../src/core/event-state.js";
import { prepareEventScriptTransition } from "../src/core/event-script-transition.js";
import { itemSelected, localVar, selected } from "./fixtures/event-script-transition.js";

test("hook local frame restores the original bank while retaining both callee selections", () => {
  const state = EventState.initialized();
  state.beginScript({ labels: ["caller"], values: [12] });
  const frame = state.captureScriptLocals();
  state.beginScript({ labels: ["callee"], values: [34] });
  assert.equal(state.read(selected), 0); assert.equal(state.read(itemSelected), 0);
  state.write(selected, 3); state.write(itemSelected, 9);
  state.restoreScriptLocals(frame);
  assert.deepEqual(state.snapshot().scriptLabels, ["caller"]);
  assert.equal(state.read(localVar()), 12);
  assert.equal(state.read(selected), 3); assert.equal(state.read(itemSelected), 9);
});

test("no-local callee keeps writes through the hooked array reference, including a later detached bank", () => {
  const state = EventState.initialized();
  state.beginScript({ labels: ["shared"], values: [4] });
  const frame = state.captureScriptLocals();
  state.beginScript(null); state.write(localVar(), 22);
  state.beginScript({ labels: ["later"], values: [99] });
  state.restoreScriptLocals(frame);
  assert.equal(state.read(localVar()), 22);
  assert.deepEqual(state.snapshot().scriptLabels, ["shared"]);
});

test("local handles cannot copy, forge or cross an EventState owner; null banks restore as null", () => {
  const state = EventState.initialized(), other = EventState.initialized();
  const frame = state.captureScriptLocals();
  state.beginScript({ labels: [], values: [] }); state.write(selected, 2);
  const before = state.snapshot();
  assert.throws(() => state.restoreScriptLocals({ ...frame }), /owner or is invalid/);
  assert.throws(() => state.restoreScriptLocals(other.captureScriptLocals()), /owner or is invalid/);
  assert.throws(() => state.restoreScriptLocals(null as unknown as ScriptLocalFrame), /owner or is invalid/);
  assert.deepEqual(state.snapshot(), before);
  assert.deepEqual(Object.keys(frame), ["kind"]);
  state.restoreScriptLocals(frame);
  assert.equal(state.snapshot().script, null); assert.equal(state.snapshot().scriptLabels, null);
  assert.equal(state.read(selected), 2);
});

test("transition preflight admits only an actual main and explicit source animation metadata", () => {
  const op = { kind: "script-transition", targetScript: "callee", returnToCaller: true } as const;
  const input = { main: true, hooked: false, currentMetadata: { customAnimations: "none" as const },
    targetMetadata: { customAnimations: "none" as const }, targetLength: 5 };
  assert.deepEqual(prepareEventScriptTransition(op, input), { script: "callee", pc: 1, range: { min: 0, max: 4 } });
  assert.throws(() => prepareEventScriptTransition(op, { ...input, main: false }), /puppet/);
  assert.throws(() => prepareEventScriptTransition(op, { ...input, hooked: true }), /hooked caller/);
  for (const targetLength of [0, 1, -1, 1.5, NaN])
    assert.throws(() => prepareEventScriptTransition(op, { ...input, targetLength }), /continuation index 1/);
  assert.throws(() => prepareEventScriptTransition(op, { ...input, currentMetadata: undefined }), /custom-animation/);
  assert.throws(() => prepareEventScriptTransition(op, { ...input, targetMetadata: null }), /custom-animation/);
  assert.equal(prepareEventScriptTransition({ ...op, returnToCaller: false }, { ...input, hooked: true }).pc, 1);
});
