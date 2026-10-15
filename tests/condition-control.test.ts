import test from "node:test";
import assert from "node:assert/strict";
import { createControlRecoveryState, createDoomClock, projectControlRecovery, projectDoomClock,
  type SleepBehavior, type ConfusionBehavior, type TemptationBehavior, type DoomBehavior } from "../src/core/condition-control.js";

const sleep: SleepBehavior = { id: 7, kind: "sleep", name: "Sleep", untilType: 9, untilValue: 30 };
const confusion: ConfusionBehavior = { id: 12, kind: "confusion", name: "Confusion", untilType: 8, untilValue: 1 };
const temptation: TemptationBehavior = { id: 70, kind: "temptation", name: "Temptation", untilType: 17, untilValue: 0 };
// An explicitly authored short counter exercises the real decrement/deferral
// contract; it is not a source condition row or a readiness grant.
const doom: DoomBehavior = { id: 1404, kind: "doom", name: "Controlled Doom", untilType: 2,
  untilValue: 2, pauseConditionTypes: [17] };

test("sleep natural recovery keeps the strict time boundary, physical-hit path and common RNG draw", () => {
  const original = { ...createControlRecoveryState(sleep, "attacker"), elapsedSeconds: 29 };
  const calls: [number, number][] = [], random = (min: number, max: number) => { calls.push([min, max]); return 100; };
  const boundary = projectControlRecovery(sleep, original,
    { normalAttackAdded: false, progress: true, durationSeconds: 1, targetedUnitGameOver: null }, random);
  assert.deepEqual(boundary.naturalRemovals, []); assert.equal(boundary.state.elapsedSeconds, 30);
  const expired = projectControlRecovery(sleep, { ...boundary.state, physicalHits: 1 },
    { normalAttackAdded: false, progress: true, durationSeconds: Math.fround(.01), targetedUnitGameOver: null }, random);
  assert.deepEqual(expired.naturalRemovals, ["physical-hit", "elapsed-time"]);
  assert.deepEqual(calls, [[0, 100], [0, 100]]); assert.equal(original.elapsedSeconds, 29);
  const paused = projectControlRecovery(sleep, { ...expired.state, physicalHits: 1 },
    { normalAttackAdded: false, progress: false, durationSeconds: 0, targetedUnitGameOver: null }, () => { throw new Error("Unexpected draw"); });
  assert.deepEqual(paused.naturalRemovals, ["physical-hit"], "paused recovery uses a local zero for its time branch");
  assert.equal(paused.state.elapsedSeconds, expired.state.elapsedSeconds);
  const excluded = projectControlRecovery(sleep, { ...expired.state, physicalHits: 1 },
    { normalAttackAdded: true, progress: true, durationSeconds: 9, targetedUnitGameOver: null },
    () => { throw new Error("Excluded native normal-attack provider must not draw"); });
  assert.deepEqual(excluded, { state: { ...expired.state, physicalHits: 1 }, naturalRemovals: [] });
});

test("confusion recovery consumes counted source physical events without inferring them from time or HP", () => {
  const state = createControlRecoveryState(confusion, null);
  assert.deepEqual(projectControlRecovery(confusion, state,
    { normalAttackAdded: false, progress: true, durationSeconds: 99, targetedUnitGameOver: null }, () => 0).naturalRemovals, []);
  assert.deepEqual(projectControlRecovery(confusion, { ...state, physicalHits: 1 },
    { normalAttackAdded: false, progress: false, durationSeconds: 0, targetedUnitGameOver: null }, () => { throw new Error("Unexpected draw"); }).naturalRemovals,
  ["physical-hit"]);
  assert.equal(state.physicalHits, 0);
});

test("temptation captures the related unit identity and refuses an unknown game-over observation", () => {
  assert.throws(() => createControlRecoveryState(temptation, null), /LastTargetedUnit/);
  const state = createControlRecoveryState(temptation, "original-attacker");
  const input = { normalAttackAdded: false, progress: false, durationSeconds: 0, targetedUnitGameOver: null };
  assert.throws(() => projectControlRecovery(temptation, state, input, () => 0), /Unknown targeted-unit/);
  assert.deepEqual(projectControlRecovery(temptation, state, { ...input, targetedUnitGameOver: true }, () => 0),
    { state, naturalRemovals: ["targeted-unit-game-over"] });
  assert.equal(state.targetedUnitId, "original-attacker");
});

test("Doom performs one decrement with overshoot and defers death until a later unstaged update", () => {
  const initial = createDoomClock(doom);
  const first = projectDoomClock(doom, initial, { conditionTypes: [], seconds: 5, actionStaging: false });
  assert.equal(first.state.remainingCount, 1); assert.equal(first.state.progressSeconds, 3); assert.equal(first.requestsDeath, false);
  const second = projectDoomClock(doom, first.state, { conditionTypes: [], seconds: 0, actionStaging: false });
  assert.equal(second.state.remainingCount, 0); assert.equal(second.state.progressSeconds, 1); assert.equal(second.requestsDeath, false);
  const staging = projectDoomClock(doom, second.state, { conditionTypes: [], seconds: 0, actionStaging: true });
  assert.equal(staging.requestsDeath, false);
  assert.equal(projectDoomClock(doom, staging.state, { conditionTypes: [], seconds: 0, actionStaging: false }).requestsDeath, true);
  assert.deepEqual(initial, createDoomClock(doom));
});

test("Doom honors its bound pause predicate and Haste priority and can observe an already dead unit before initialization", () => {
  const initial = createDoomClock(doom);
  assert.deepEqual(projectDoomClock(doom, initial, { conditionTypes: [17], seconds: 9, actionStaging: false }),
    { state: initial, requestsDeath: false });
  const delta = Math.fround(1.3333334);
  const haste = projectDoomClock(doom, initial, { conditionTypes: [15, 16], seconds: delta, actionStaging: false });
  assert.equal(haste.state.remainingCount, 1); assert.equal(haste.state.progressSeconds, 0);
  const dead = projectDoomClock(doom, initial, { conditionTypes: [5], seconds: 0, actionStaging: false });
  assert.equal(dead.state.dead, true); assert.equal(dead.state.firstUpdate, true);
  assert.deepEqual(projectDoomClock(doom, dead.state, { conditionTypes: [], seconds: 10, actionStaging: false }),
    { state: dead.state, requestsDeath: false });
});
