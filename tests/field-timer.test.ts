import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldTimerInstruction } from "../src/compiler/field-timer.js";
import { WEB_FIELD_TIMER_POLICY, createFieldTimer, prepareFieldTimerCommand, advanceFieldTimer,
  pendingFieldTimerCallback, acknowledgeFieldTimerCallback, cloneFieldTimer, restoreFieldTimer,
  fieldTimerProjection, type FieldTimerStartBinding, type FieldTimerOp } from "../src/core/field-timer.js";

const sha = "a".repeat(64), otherSha = "b".repeat(64);
const evidence = { file: "fixture.bundle", assetPath: "Assets/Fixture/start.json",
  objectId: "-9127841932506724402", sha256: sha };
const binding: FieldTimerStartBinding = { sourceSetHash: sha, mapId: 1, mapContentHash: otherSha,
  site: { script: "start", index: 7, source: evidence },
  callback: { name: "timeout", source: { ...evidence, assetPath: "Assets/Fixture/timeout.json",
    objectId: "9127841932506724402" } } };
function raw(mnemonic: string, ints: number[] = [], reals: number[] = [], strings: string[] = []) {
  return { mnemonic, type: 1, operands: { iValues: [...ints, ...Array(8 - ints.length).fill(0)],
    rValues: [...reals, ...Array(8 - reals.length).fill(0)],
    sValues: [...strings, ...Array(8 - strings.length).fill("")] } };
}
const start = (ints = [0, 0, 0, 1], seconds = 300) =>
  compileFieldTimerInstruction(raw("SetTimer", ints, [seconds], ["timeout"]));
const control = (kind: "finish" | "pause" | "resume" | "change-script-if-expired"): FieldTimerOp =>
  ({ kind: "field-timer", command: { kind } });
const seed = () => createFieldTimer(WEB_FIELD_TIMER_POLICY, sha);
const running = (ints = [0, 0, 0, 1], seconds = 300) =>
  prepareFieldTimerCommand(seed(), start(ints, seconds), binding).snapshot;

test("source timer selectors preserve clock states rather than treating all four integers as booleans in the same direction", () => {
  const decoded = start([0, 0, 0, 1]);
  assert.equal(decoded.command.kind, "set");
  if (decoded.command.kind !== "set") return;
  assert.deepEqual(decoded.command.updateStates, ["player", "battle", "event", "gimmick"]);
  assert.equal(decoded.command.displayUI, true);
  const second = start([1, 1, 1, 0]);
  if (second.command.kind !== "set") throw new Error("Expected source timer");
  assert.deepEqual(second.command.updateStates, ["player", "message"]);
  assert.equal(second.command.displayUI, false);
  assert.deepEqual(decoded.command.sourceSelectors, { display: 0, battle: 0, message: 0, event: 1 });
  assert.deepEqual(compileFieldTimerInstruction(raw("SysCall", [], [], ["タイマー一時停止"])), control("pause"));
  assert.deepEqual(compileFieldTimerInstruction(raw("SysCall", [], [], ["タイマー一時停止解除"])), control("resume"));
  assert.deepEqual(compileFieldTimerInstruction(raw("FinishTimer")), control("finish"));
});

test("logical countdown respects every scene dimension and pause/resume never consumes excluded time", () => {
  const initial = running([0, 0, 0, 1], 5), before = structuredClone(initial);
  let timer = advanceFieldTimer(initial, 1000, "player");
  for (const scene of ["message", "menu", "transition", "inactive"] as const)
    assert.deepEqual(advanceFieldTimer(timer, 90000, scene), timer);
  timer = advanceFieldTimer(timer, 1000, "battle");
  timer = advanceFieldTimer(timer, 1000, "event");
  timer = prepareFieldTimerCommand(timer, control("pause")).snapshot;
  assert.equal(timer.active!.elapsedMs, 3000);
  assert.deepEqual(advanceFieldTimer(timer, 90000, "gimmick"), timer);
  assert.deepEqual(prepareFieldTimerCommand(timer, control("pause")).snapshot, timer);
  timer = prepareFieldTimerCommand(timer, control("resume")).snapshot;
  timer = advanceFieldTimer(timer, 1000, "gimmick");
  assert.equal(timer.active!.elapsedMs, 4000);
  assert.deepEqual(initial, before, "Candidates must not mutate the existing owner");
  const noBattle = running([1, 1, 1, 0], 5);
  assert.deepEqual(advanceFieldTimer(noBattle, 5000, "battle"), noBattle);
  assert.equal(advanceFieldTimer(noBattle, 1000, "message").active!.elapsedMs, 1000);
});

test("expiry is clamped and pending until the callback is published once through its exact source binding", () => {
  const active = running([], 5);
  const expired = advanceFieldTimer(active, Number.MAX_SAFE_INTEGER, "player");
  assert.equal(expired.active!.elapsedMs, 5000);
  assert.equal(expired.active!.expired, true);
  assert.deepEqual(advanceFieldTimer(expired, 50000, "player"), expired);
  const request = pendingFieldTimerCallback(expired)!;
  assert.deepEqual(request.binding, binding);
  const failedPreparation = cloneFieldTimer(expired);
  assert.deepEqual(pendingFieldTimerCallback(failedPreparation), request, "No acknowledgement occurs for a failed map/script candidate");
  const published = acknowledgeFieldTimerCallback(expired, request);
  assert.equal(pendingFieldTimerCallback(published), null);
  assert.equal(pendingFieldTimerCallback(expired)!.binding.callback.source.objectId, "9127841932506724402");
  assert.throws(() => acknowledgeFieldTimerCallback(published, request), /duplicate|Stale/);
  assert.throws(() => acknowledgeFieldTimerCallback(expired, { ...request,
    binding: { ...request.binding, mapContentHash: sha } }), /mismatched|Stale/);
});

test("finish and replacement cancel old callback generations; a paused-state change rejects a stale prepared publication", () => {
  const expired = advanceFieldTimer(running([], 3), 3000, "player"), request = pendingFieldTimerCallback(expired)!;
  const finished = prepareFieldTimerCommand(expired, control("finish")).snapshot;
  assert.equal(finished.active, null);
  assert.equal(pendingFieldTimerCallback(finished), null);
  assert.throws(() => acknowledgeFieldTimerCallback(finished, request), /Stale/);
  const replacement = prepareFieldTimerCommand(expired, start([], 5), binding).snapshot;
  assert.equal(replacement.active!.elapsedMs, 0);
  assert.equal(replacement.sequence, expired.sequence + 1);
  assert.throws(() => acknowledgeFieldTimerCallback(replacement, request), /Stale/);
  const paused = prepareFieldTimerCommand(expired, control("pause")).snapshot;
  assert.throws(() => acknowledgeFieldTimerCallback(paused, request), /Stale/);
  assert.ok(pendingFieldTimerCallback(paused));
});

test("timeout script replacement checks an existing expired timer and shares the once-only callback transaction", () => {
  const timeout = compileFieldTimerInstruction(raw("SysCall", [], [], ["時間切れでスクリプト変更"]));
  assert.deepEqual(timeout, control("change-script-if-expired"));
  assert.throws(() => prepareFieldTimerCommand(seed(), timeout), /known active/);
  const initial = running([], 3);
  assert.equal(prepareFieldTimerCommand(initial, timeout).callback, null);
  const expired = advanceFieldTimer(initial, 3000, "player"), automatic = pendingFieldTimerCallback(expired)!;
  const replacement = prepareFieldTimerCommand(expired, timeout).callback!;
  assert.equal(replacement.mode, "replace-script");
  assert.deepEqual(replacement.binding, automatic.binding);
  const published = acknowledgeFieldTimerCallback(expired, replacement);
  assert.equal(prepareFieldTimerCommand(published, timeout).callback, null);
  assert.throws(() => acknowledgeFieldTimerCallback(published, automatic), /Stale/);
});

test("cross-map fork and trusted restore continue the same remaining timer and preserve pending delivery without granting a new script", () => {
  let timer = advanceFieldTimer(running([], 5), 1500, "player");
  timer = prepareFieldTimerCommand(timer, control("pause")).snapshot;
  const candidate = cloneFieldTimer(timer);
  assert.deepEqual(candidate, timer);
  assert.notEqual(candidate.active, timer.active);
  const restored = restoreFieldTimer(JSON.parse(JSON.stringify(timer)), {
    sourceSetHash: sha, policy: WEB_FIELD_TIMER_POLICY, binding,
  });
  assert.equal(restored.active!.elapsedMs, 1500);
  assert.equal(restored.active!.paused, true);
  assert.throws(() => restoreFieldTimer(timer, { sourceSetHash: sha, policy: WEB_FIELD_TIMER_POLICY }), /trusted callback/);
  assert.throws(() => restoreFieldTimer(timer, { sourceSetHash: sha, policy: WEB_FIELD_TIMER_POLICY,
    binding: { ...binding, mapId: 2 } }), /binding mismatch/);
  assert.throws(() => restoreFieldTimer(timer, { sourceSetHash: otherSha, policy: WEB_FIELD_TIMER_POLICY, binding }), /source\/policy/);
  const continued = advanceFieldTimer(prepareFieldTimerCommand(restored, control("resume")).snapshot, 3500, "player");
  const savedPending = restoreFieldTimer(continued, { sourceSetHash: sha, policy: WEB_FIELD_TIMER_POLICY, binding });
  assert.ok(pendingFieldTimerCallback(savedPending));
  const delivered = acknowledgeFieldTimerCallback(savedPending, pendingFieldTimerCallback(savedPending)!);
  assert.equal(pendingFieldTimerCallback(restoreFieldTimer(delivered, { sourceSetHash: sha,
    policy: WEB_FIELD_TIMER_POLICY, binding })), null);
});

test("unknown selectors, operand dimensions, clocks, source identities and callback lotteries remain explicit failures", () => {
  assert.throws(() => compileFieldTimerInstruction(raw("SysCall", [], [], ["シドタイマー：再開"])), /Unsupported.*selector/);
  assert.throws(() => compileFieldTimerInstruction(raw("SetTimer", [0, 0, 0, 0, 1], [3], ["timeout"])), /reserved/);
  assert.throws(() => compileFieldTimerInstruction(raw("SetTimer", [0, 2], [3], ["timeout"])), /selector/);
  assert.throws(() => compileFieldTimerInstruction(raw("SetTimer", [], [-3], ["timeout"])), /duration/);
  assert.throws(() => prepareFieldTimerCommand(seed(), start([], 3)), /exact source/);
  assert.throws(() => prepareFieldTimerCommand(seed(), start([], 3), { ...binding,
    callback: { ...binding.callback, name: "other" } }), /binding mismatch/);
  assert.throws(() => prepareFieldTimerCommand(seed(), { ...start([], 3), ...binding.site,
    index: 8 }, binding), /binding mismatch/);
  const lottery = compileFieldTimerInstruction(raw("SetTimer", [], [3], ["timeout", "second"]));
  if (lottery.command.kind !== "set") throw new Error("Expected timer");
  assert.deepEqual(lottery.command.callbackScripts, ["timeout", "second"]);
  assert.throws(() => prepareFieldTimerCommand(seed(), lottery, binding), /lottery/);
  assert.throws(() => advanceFieldTimer(running([], 3), 0.5, "player"), /logical clock/);
  assert.throws(() => advanceFieldTimer(running([], 3), 10, "unknown" as "player"), /scene dimension/);
  const forged = running([], 3);
  forged.active!.expired = true;
  assert.throws(() => cloneFieldTimer(forged), /completion checkpoint/);
});

test("an absent known timer is a source-backed safe pause/resume, and presentation never maintains another clock", () => {
  assert.deepEqual(prepareFieldTimerCommand(seed(), control("pause")).snapshot, seed());
  assert.deepEqual(prepareFieldTimerCommand(seed(), control("resume")).snapshot, seed());
  assert.deepEqual(fieldTimerProjection(seed()), { visible: false, paused: false, expired: false, remainingMs: 0, minutes: 0, seconds: 0 });
  const timer = advanceFieldTimer(running([], 65), 4500, "player");
  assert.deepEqual(fieldTimerProjection(timer), { visible: true, paused: false, expired: false,
    remainingMs: 60500, minutes: 1, seconds: 1 });
});
