import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldScreenEffectInstruction } from "../src/compiler/field-screen-effects.js";
import { FieldFadeState, DEVELOPMENT_TRANSPARENT_FADE, fieldFadeOverlay } from "../src/core/field-fade.js";
import { FieldColorFilterState, WEB_CLEAR_COLOR_FILTER, startFieldFlash, pollFieldFlash,
  type FieldColorFadeOp, type FieldFlashOp, type FieldScreenEffectsBinding } from "../src/core/field-screen-effects.js";

const binding: FieldScreenEffectsBinding = { kind: "web-field-screen-effects-v1", sourceSetHash: "a".repeat(64), host: "ordinary-field" };
const red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 };
const colorOp = (seconds: number, color = red): FieldColorFadeOp => ({ kind: "field-color-fade", seconds, color,
  policy: "web-field-screen-effects-v1" });
const flashOp = (seconds: number): FieldFlashOp => ({ kind: "field-flash", seconds, color: red,
  policy: "web-field-screen-effects-v1" });
const raw = (mnemonic: string, duration: number, rgba = [255, 0, 0, 255]) => ({ type: 1, mnemonic,
  operands: { iValues: [...rgba, 0, 0, 0, 0], rValues: [duration, 0, 0, 0, 0, 0, 0, 0], sValues: Array(8).fill("") } });

test("screen compiler preserves float32 color and signed duration while refusing unknown source shapes", () => {
  const op = compileFieldScreenEffectInstruction(raw("ColorFade", -0.7, [25, 128, 255, 0]));
  assert.deepEqual(op, { kind: "field-color-fade", seconds: Math.fround(-0.7),
    color: { r: Math.fround(25 / 255), g: Math.fround(128 / 255), b: 1, a: 0 }, policy: "web-field-screen-effects-v1" });
  assert.equal(compileFieldScreenEffectInstruction(raw("Flash", -1)).kind, "field-flash");
  assert.equal(compileFieldScreenEffectInstruction({ type: 1, mnemonic: "Flash",
    operands: { iValues: [255, 255, 255, 255], rValues: [0.1], sValues: [] } }).kind, "field-flash");
  for (const bad of [raw("ColorFade", Infinity), raw("ColorFade", 1e50), raw("ColorFade", 0, [-1, 0, 0, 0]),
    { ...raw("ColorFade", 0), type: 2 }, { type: 1, mnemonic: "ColorFade", operands: { iValues: null, rValues: [0] } }])
    assert.throws(() => compileFieldScreenEffectInstruction(bad));
  const extra = raw("Flash", 0); extra.operands.iValues[7] = 1;
  assert.throws(() => compileFieldScreenEffectInstruction(extra));
});

test("ColorFade zero completes immediately, negative keeps animating asynchronously, positive waits for its owner", () => {
  const state = new FieldColorFilterState(binding, WEB_CLEAR_COLOR_FILTER);
  assert.equal(state.start(colorOp(0)), "next"); assert.deepEqual(state.projection, red);
  assert.equal(state.start(colorOp(-1, blue)), "next"); assert.equal(state.active, true);
  state.advance(0.5); assert.deepEqual(state.projection, { r: 0.5, g: 0, b: 0.5, a: 1 });
  state.advance(0.5); assert.equal(state.poll(), "next"); assert.deepEqual(state.projection, blue);
  assert.equal(state.start(colorOp(1)), "wait"); assert.equal(state.poll(), "wait");
  state.advance(1); assert.equal(state.poll(), "next"); assert.deepEqual(state.projection, red);
});

test("invalid requests and unknown initial host cannot partially publish color state", () => {
  const state = new FieldColorFilterState(binding, WEB_CLEAR_COLOR_FILTER), before = state.snapshot();
  for (const op of [colorOp(Infinity), colorOp(1, { ...red, a: 2 }), { ...colorOp(1), policy: "native" }]) {
    assert.throws(() => state.start(op as FieldColorFadeOp)); assert.deepEqual(state.snapshot(), before);
  }
  assert.throws(() => state.advance(-1)); assert.deepEqual(state.snapshot(), before);
  const unknown = new FieldColorFilterState(binding, null);
  assert.throws(() => unknown.start(colorOp(0)), /Unknown/); assert.equal(unknown.snapshot(), null);
  assert.throws(() => new FieldColorFilterState({ ...binding, host: "bird" } as never, red), /profile/);
});

test("active color snapshots fork and restore only the same source Web profile without shared mutation", () => {
  const state = new FieldColorFilterState(binding, WEB_CLEAR_COLOR_FILTER);
  state.start(colorOp(1)); state.advance(0.25);
  const saved = state.snapshot()!, copy = state.fork(), restored = FieldColorFilterState.restore(saved, binding);
  assert.deepEqual(restored.snapshot(), saved);
  copy.start(colorOp(0, blue)); assert.notDeepEqual(copy.projection, state.projection);
  restored.advance(0.75); assert.deepEqual(restored.projection, red);
  assert.equal(state.active, true); saved.color.a = 1;
  assert.notEqual(state.projection!.a, 1);
  assert.throws(() => FieldColorFilterState.restore(saved, binding), /tween checkpoint/);
  assert.throws(() => FieldColorFilterState.restore(state.snapshot(), { ...binding, sourceSetHash: "b".repeat(64) }), /profile mismatch/);
  const projection = state.projection!; projection.r = 1; assert.notEqual(state.projection!.r, 1);
});

test("replacement color fades begin at the currently projected color and final sampling is exact", () => {
  const state = new FieldColorFilterState(binding, WEB_CLEAR_COLOR_FILTER);
  state.start(colorOp(1)); state.advance(0.5);
  const halfway = state.projection; state.start(colorOp(1, blue)); assert.deepEqual(state.projection, halfway);
  state.advance(0.25); assert.deepEqual(state.projection, { r: 0.375, g: 0, b: 0.25, a: 0.625 });
  state.advance(100); assert.deepEqual(state.projection, blue); assert.equal(state.active, false);
});

test("Flash delegates both stages to the existing FadeManager and waits even for signed-negative duration", () => {
  for (const duration of [1, -1]) {
    const fader = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE), task = startFieldFlash(fader, flashOp(duration));
    assert.equal(task.phase, "out"); assert.equal(pollFieldFlash(fader, task), "wait");
    fader.advance(1); assert.deepEqual(fieldFadeOverlay(fader.projection), red);
    assert.equal(pollFieldFlash(fader, task), "wait"); assert.equal(task.phase, "in");
    fader.advance(1); assert.equal(pollFieldFlash(fader, task), "next"); assert.equal(task.phase, "done");
    assert.equal(fieldFadeOverlay(fader.projection)!.a, 0);
    const done = fader.snapshot(); assert.equal(pollFieldFlash(fader, task), "next"); assert.deepEqual(fader.snapshot(), done);
  }
});

test("zero Flash retains its two stage clocks rather than becoming a no-op", () => {
  const fader = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE), task = startFieldFlash(fader, flashOp(0));
  assert.equal(task.phase, "out"); assert.equal(fieldFadeOverlay(fader.projection)!.a, 1);
  assert.equal(pollFieldFlash(fader, task), "wait"); assert.equal(task.phase, "in");
  assert.equal(fieldFadeOverlay(fader.projection)!.a, 0); assert.equal(pollFieldFlash(fader, task), "next");
});

test("Flash validates before touching the shared fader and cannot transfer a task to another owner", () => {
  const fader = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE), before = fader.snapshot();
  assert.throws(() => startFieldFlash(fader, flashOp(Infinity))); assert.deepEqual(fader.snapshot(), before);
  assert.throws(() => startFieldFlash(new FieldFadeState(null), flashOp(0)), /Unknown/);
  const task = startFieldFlash(fader, flashOp(1));
  assert.throws(() => pollFieldFlash(fader.fork(), task), /another fader/);
  assert.throws(() => pollFieldFlash(fader, { ...task }), /another fader/);
});
