import test from "node:test";
import assert from "node:assert/strict";
import { createFieldTimer, prepareFieldTimerCommand, advanceFieldTimer, fieldTimerProjection, cloneFieldTimer, restoreFieldTimer,
  prepareFieldScenarioTimer, fieldTimerRemainingSeconds, fieldScenarioTimerBindings, settleFieldShadowTimerTick,
  pendingFieldShadowCallback, acknowledgeFieldShadowCallback, WEB_FIELD_TIMER_POLICY, SOURCE_SHADOW_CALLBACK,
  type FieldScenarioTimerCommand, type FieldScenarioTimerOp, type FieldTimerSnapshot, type FieldTimerStartBinding,
  type FieldCidTimerBinding, type FieldShadowTimerBinding } from "../src/core/field-timer.js";
import { compileFieldScenarioTimerInstruction, fieldScenarioTimerSelectors } from "../src/compiler/field-timer.js";
import { compileFieldUiInstruction } from "../src/compiler/field-ui.js";
import { FieldUiState } from "../src/core/field-ui.js";
import { fieldInstructionRequirements, assessFieldRequirements } from "../src/core/field-content-admission.js";
import type { Op, Site } from "../src/field/types.js";
const sourceSet = "a".repeat(64), site: Site = {script: "synthetic", index: 7,
  source: {file: "synthetic.bundle", assetPath: "synthetic/timer.json", objectId: "9007199254740993"}};
const base = {sourceSetHash: sourceSet, mapId: 777, mapContentHash: "b".repeat(64), site};
const op = (command: FieldScenarioTimerCommand): FieldScenarioTimerOp & Site => ({...site, kind: "field-scenario-timer", command});
const counterBinding = (value: number, command: "cid-resume" | "cid-check" = "cid-resume"): FieldCidTimerBinding => ({...base, kind: "source-cid-counter-v1", value, command});
const shadowBinding = (seconds: number): FieldShadowTimerBinding => ({...base, kind: "source-shadow-timer-v1", seconds,
  callback: {name: SOURCE_SHADOW_CALLBACK, source: {...site.source, objectId: "9007199254740995"}}});
function start(seconds: number) {
  const binding: FieldTimerStartBinding = {...base, callback: {name: "timeout", source: site.source}};
  return prepareFieldTimerCommand(createFieldTimer(WEB_FIELD_TIMER_POLICY, sourceSet), {kind: "field-timer", command: {kind: "set", seconds: Math.fround(seconds),
    displayUI: true, sourceSelectors: {display: 0, battle: 0, message: 0, event: 1}, updateStates: ["player", "battle", "event", "gimmick"], callbackScripts: ["timeout"]}}, binding).snapshot;
}
const scenario = (state: FieldTimerSnapshot) => {assert.equal(state.kind, "web-field-timer-v2"); return state.kind === "web-field-timer-v2" ? state.scenario : assert.fail();};
test("Cid checks truncate live remaining, absent/finished write zero, suspend removes only a live global", () => {
  const state = advanceFieldTimer(start(31.75), 1000, "player");
  assert.equal(prepareFieldScenarioTimer(state, op("cid-hp")).variable2, 30);
  const suspended = prepareFieldScenarioTimer(state, op("cid-suspend")); assert.equal(suspended.variable2, 30);
  assert.equal(fieldTimerRemainingSeconds(suspended.snapshot), null);
  assert.equal(prepareFieldScenarioTimer(suspended.snapshot, op("cid-hp")).variable2, 0);
  const expired = advanceFieldTimer(start(1), 1000, "player"), finished = prepareFieldScenarioTimer(expired, op("cid-suspend"));
  assert.equal(finished.variable2, 0); assert.deepEqual(finished.snapshot.active, expired.active, "finished source global is not removed");
});
test("Cid uses one callback-free global, exact ranges and Player-only clock without inventing a callback", () => {
  for (const value of [30, 255]) {
    const created = prepareFieldScenarioTimer(start(99), op("cid-check"), value, counterBinding(value, "cid-check")).snapshot;
    assert.equal(created.active, null); assert.equal(fieldTimerProjection(created).visible, false);
    for (const phase of ["battle", "message", "event", "gimmick", "menu", "transition", "inactive"] as const)
      assert.equal(fieldTimerRemainingSeconds(advanceFieldTimer(created, 1000, phase)), value);
    assert.equal(fieldTimerRemainingSeconds(advanceFieldTimer(created, 1000, "player")), value - 1);
  }
  for (const value of [-1, 0, 29, 256]) assert.equal(fieldTimerRemainingSeconds(prepareFieldScenarioTimer(start(99), op("cid-check"), value).snapshot), null);
  const state = prepareFieldScenarioTimer(start(99), op("cid-resume"), 1, counterBinding(1)).snapshot;
  const expired = advanceFieldTimer(state, 1000, "player"); assert.equal(scenario(expired).counter!.expired, true);
  assert.equal(expired.active, null); assert.equal(pendingFieldShadowCallback(expired), null);
  assert.equal(prepareFieldScenarioTimer(state, op("cid-resume"), 0).snapshot.active, null);
  assert.throws(() => prepareFieldScenarioTimer(state, op("cid-resume"), -1), /negative.*provider/);
  assert.throws(() => restoreFieldTimer(state, {policy: WEB_FIELD_TIMER_POLICY, sourceSetHash: sourceSet}), /trusted origin/);
  assert.deepEqual(restoreFieldTimer(state, {policy: WEB_FIELD_TIMER_POLICY, sourceSetHash: sourceSet, scenarioBindings: fieldScenarioTimerBindings(state)}), state);
  const dual = structuredClone(state); dual.active = start(1).active; assert.throws(() => cloneFieldTimer(dual), /second global/);
});
test("Shadow key collision does not reset; reset then setup in the same frame returns the old timer until update end", () => {
  let state = prepareFieldScenarioTimer(start(10), op("shadow-setup"), undefined, shadowBinding(5)).snapshot;
  state = settleFieldShadowTimerTick(advanceFieldTimer(state, 1000, "player"));
  const old = structuredClone(scenario(state).shadow);
  state = prepareFieldScenarioTimer(state, op("shadow-setup"), undefined, shadowBinding(4)).snapshot;
  assert.deepEqual(scenario(state).shadow, old);
  state = prepareFieldScenarioTimer(state, op("shadow-reset")).snapshot;
  state = prepareFieldScenarioTimer(state, op("shadow-setup"), undefined, shadowBinding(4)).snapshot;
  assert.deepEqual(scenario(state).shadow, old); assert.equal(scenario(state).removeShadow, true);
  state = settleFieldShadowTimerTick(advanceFieldTimer(state, 10, "player")); assert.equal(scenario(state).shadow, null);
  state = prepareFieldScenarioTimer(state, op("shadow-setup"), undefined, shadowBinding(Math.fround(fieldTimerRemainingSeconds(state)! - 5))).snapshot;
  assert.equal(scenario(state).shadow!.elapsedMs, 0); assert.ok(scenario(state).shadow!.sequence > old!.sequence);
});
test("Shadow samples flag/cell exactly at deadline, consumes a miss, retains an accepted request and acknowledges once", () => {
  const initial = prepareFieldScenarioTimer(start(6), op("shadow-setup"), undefined, shadowBinding(1)).snapshot;
  for (const sample of [{flag: 0}, {flag: 1, cell: {x: 111, y: 23}}]) {
    const missed = settleFieldShadowTimerTick(advanceFieldTimer(initial, 1000, "battle"), sample);
    assert.equal(scenario(missed).shadow, null); assert.equal(pendingFieldShadowCallback(missed), null);
    const later = settleFieldShadowTimerTick(advanceFieldTimer(missed, 1000, "player"), {flag: 1, cell: {x: 112, y: 23}});
    assert.equal(pendingFieldShadowCallback(later), null, "A future condition cannot replay a consumed miss");
  }
  const atDeadline = advanceFieldTimer(initial, 1000, "battle"), pin = JSON.stringify(atDeadline);
  assert.throws(() => settleFieldShadowTimerTick(atDeadline, {flag: 1}), /actual flag and player cell/);
  assert.equal(JSON.stringify(atDeadline), pin);
  const accepted = settleFieldShadowTimerTick(atDeadline, {flag: 1, cell: {x: 112.9, y: 23.9}}), request = pendingFieldShadowCallback(accepted)!;
  assert.ok(request); assert.equal(scenario(accepted).shadow, null);
  const afterClock = advanceFieldTimer(accepted, 1000, "player"); assert.deepEqual(pendingFieldShadowCallback(afterClock), request);
  const ack = acknowledgeFieldShadowCallback(afterClock, request); assert.equal(pendingFieldShadowCallback(ack), null);
  assert.throws(() => acknowledgeFieldShadowCallback(ack, request), /Stale or duplicate/);
});
test("deferred removal still lets the source update evaluate a due callback, independent of global removal/replacement", () => {
  let state = prepareFieldScenarioTimer(start(6), op("shadow-setup"), undefined, shadowBinding(1)).snapshot;
  state = prepareFieldScenarioTimer(state, op("shadow-reset")).snapshot;
  state = prepareFieldTimerCommand(state, {kind: "field-timer", command: {kind: "finish"}}).snapshot;
  state = settleFieldShadowTimerTick(advanceFieldTimer(state, 1000, "event"), {flag: 1, cell: {x: 115, y: 25}});
  assert.equal(fieldTimerRemainingSeconds(state), null); assert.ok(pendingFieldShadowCallback(state));
});
test("all six source selectors preserve exact zero banks; ShowTimer uses versioned UI view without changing MainGame state", () => {
  const raw = (selector: string) => ({type: 1, mnemonic: "SysCall", operands: {iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: [selector, ...Array(7).fill("")]}});
  for (const [selector, command] of Object.entries(fieldScenarioTimerSelectors)) {
    const compiled = compileFieldScenarioTimerInstruction(raw(selector)); assert.deepEqual(compiled, {kind: "field-scenario-timer", command});
    const req = fieldInstructionRequirements({...compiled, ...site} as Op);
    assert.equal(assessFieldRequirements(req, {providers: {}, actorKind: "unknown"}).status, "conditional");
    const bad = raw(selector); bad.operands.rValues[4] = 1; assert.throws(() => compileFieldScenarioTimerInstruction(bad), /operands/);
  }
  const ui = new FieldUiState(sourceSet), old = ui.snapshot();
  ui.prepare({kind: "event"}).commit(); ui.prepare(compileFieldUiInstruction(raw("タイマー表示"), {}).command).commit();
  assert.equal(ui.snapshot().kind, "source-field-ui-state-v2"); assert.equal(ui.snapshot().view, "timer"); assert.equal(ui.snapshot().mainGameState, 12);
  assert.deepEqual(FieldUiState.restore(ui.snapshot(), sourceSet).snapshot(), ui.snapshot());
  assert.deepEqual(FieldUiState.restore(old, sourceSet).snapshot(), old);
  assert.throws(() => FieldUiState.restore({...ui.snapshot(), kind: "source-field-ui-state-v1"}, sourceSet), /identity/);
});
