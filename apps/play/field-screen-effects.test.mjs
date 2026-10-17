import test from "node:test";
import assert from "node:assert/strict";
import { screenEffectAmount, clearMapEffects, sceneFadeAlpha } from "./field-screen-effects.js";

test("PR preset start/reverse reaches both authored endpoints including zero duration", () => {
  for (const duration of [0, 0.35, 1.4]) {
    const start = { value: 0, time: 10, duration },
      stop = { value: 1, time: 10, duration };
    assert.ok(Math.abs(screenEffectAmount(start, 10 + duration) - 1) < 1e-12);
    assert.ok(Math.abs(screenEffectAmount(stop, 10 + duration)) < 1e-12);
    if (duration) {
      assert.equal(screenEffectAmount(start, 10), 0);
      assert.equal(screenEffectAmount(stop, 10), 1);
    }
  }
});

test("a flashback filter and water overrides cannot leak into later Figaro maps", () => {
  const state = {
    mapId: 178,
    screenEffects: { 1: { value: 0 } },
    water: { "-1:_WaterColor:R": { to: 1 } },
    waterOrder: 2,
    tone: { rgb: [0, 0, 0], alpha: 1 },
    currentTone: [0, 0, 0, 1],
  };
  assert.equal(clearMapEffects(state, 178), false);
  assert.ok(state.screenEffects[1]);
  assert.equal(state.tone.alpha, 1);
  assert.equal(clearMapEffects(state, 21), true);
  assert.deepEqual(state.screenEffects, {});
  assert.deepEqual(state.water, {});
  assert.equal(state.waterOrder, 0);
  assert.equal(state.tone, null);
  assert.equal(state.currentTone, null);
});

test("a field fade remains intact on the field but cannot cover a separate battle camera", () => {
  const fade = { from: 0, to: 1, start: 5, duration: 0.7 };
  assert.equal(sceneFadeAlpha(fade, 4), 0);
  assert.ok(Math.abs(sceneFadeAlpha(fade, 5.35) - 0.5) < 1e-12);
  assert.equal(sceneFadeAlpha(fade, 8), 1);
  assert.equal(sceneFadeAlpha(fade, 8, true), 0);
  assert.equal(sceneFadeAlpha(fade, 8, false), 1);
});
