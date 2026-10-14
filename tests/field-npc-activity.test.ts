import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireNpcActivity, captureNpcActivity, completeNpcActivity, createNpcActivity,
  fieldNpcAreaContains, parseFieldNpcActivityProgram, parseNpcActivityProgram, parseNpcActivityState,
  prepareNpcActivity, releaseNpcActivity, restoreNpcActivity, settleNpcActivity,
  sourceNpcSecondsPerCell, validateNpcActivityProposal,
  type FieldNpcActivityInput, type FieldNpcActivityProgram, type FieldNpcActivityState,
} from "../src/core/field-npc-activity.js";

function program(overrides: Partial<FieldNpcActivityProgram> = {}): FieldNpcActivityProgram {
  return { policy: "framework-npc-area-v1", actorId: "entity_default:0:2", group: "entity_default",
    definitionHash: "a".repeat(64), moveArea: { x: -64, y: 64, width: 128, height: 128 },
    layer: 0, updateAttribute: 2, sourceSpeedEnum: 7, baseIntervalMs: 100, moveSteps: 1, firstInterval: true,
    ...overrides };
}
function input(overrides: Partial<FieldNpcActivityInput> = {}): FieldNpcActivityInput {
  return { worldPosition: { x: 0, y: 0 }, direction: "down", motionActive: false, dtMs: 10, updateMask: 3,
    destinations: { up: { x: 0, y: 16 }, right: { x: 16, y: 0 }, down: { x: 0, y: -16 }, left: { x: -16, y: 0 } },
    ...overrides };
}
function initial(def: FieldNpcActivityProgram, seed = 71): FieldNpcActivityState {
  return createNpcActivity(def, { generation: 1, seed, initialDelayMs: 0 });
}
function start(def: FieldNpcActivityProgram, state = initial(def), host = input({ dtMs: 1000 })) {
  const proposal = prepareNpcActivity(def, state, host);
  assert.ok(proposal.intent);
  const started = settleNpcActivity(def, proposal, "started", state, host);
  assert.ok(started.ticket);
  return { state: started.state, ticket: started.ticket, intent: proposal.intent };
}

test("Area policy strictly preserves source world geometry, including its northern y edge", () => {
  const rect = { x: -13.25, y: 7.5, width: 16.5, height: 9.25 };
  assert.equal(fieldNpcAreaContains(rect, { x: -13.25, y: -1.75 }), true);
  assert.equal(fieldNpcAreaContains(rect, { x: 3.25, y: 7.5 }), true);
  assert.equal(fieldNpcAreaContains(rect, { x: 0, y: 7.50001 }), false);
  assert.equal(fieldNpcAreaContains(rect, { x: 0, y: -1.75001 }), false);
  assert.equal(fieldNpcAreaContains(rect, { x: 3.25001, y: 0 }), false);
  assert.throws(() => fieldNpcAreaContains({ ...rect, width: -1 }, { x: 0, y: 0 }));
  assert.throws(() => fieldNpcAreaContains(rect, { x: NaN, y: 0 }));
});

test("program parser is detached and admits only the declared Area shape and source enum", () => {
  const raw = program(), parsed = parseFieldNpcActivityProgram(raw);
  assert.equal(parseNpcActivityProgram, parseFieldNpcActivityProgram);
  raw.moveArea.x = 77;
  assert.equal(parsed.moveArea.x, -64);
  for (const extra of [{ mode: "polyline" }, { position: { x: 1, y: 2 } }, { policy: "source" },
    { sourceSpeedEnum: 9 }, { sourceSpeedEnum: null }, { firstInterval: null }, { moveSteps: 0 },
    { updateAttribute: 8 }, { baseIntervalMs: Infinity }, { definitionHash: "unbound" }])
    assert.throws(() => parseFieldNpcActivityProgram({ ...program(), ...extra }));
  assert.throws(() => parseFieldNpcActivityProgram(Object.defineProperty(program(), "actorId", { get() { throw new Error("accessor ran"); } })),
    error => error instanceof Error && !error.message.includes("accessor ran"));
});

test("NPC source speeds include enum7 and enum8 without changing Puppet speed admission", () => {
  for (const [id, value] of [0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16, 0.096, 0.08].entries())
    assert.equal(sourceNpcSecondsPerCell(id), Math.fround(value));
  assert.equal(sourceNpcSecondsPerCell(7, 2), Math.fround(Math.fround(0.096) / 2));
  for (const invalid of [-1, 9, 1.5, NaN]) assert.throws(() => sourceNpcSecondsPerCell(invalid));
  for (const invalid of [0, -1, Infinity, Number.MIN_VALUE]) assert.throws(() => sourceNpcSecondsPerCell(7, invalid));
});

test("initial lag is explicit and separate from the sampled source interval envelope", () => {
  const def = program(), state = initial(def);
  assert.ok(state.waitMs >= 80 && state.waitMs < 120);
  const delayed = createNpcActivity(def, { generation: 1, seed: 71, initialDelayMs: 50 });
  assert.equal(delayed.waitMs, state.waitMs + 50);
  assert.equal(delayed.rngState, state.rngState);
  assert.equal(delayed.rngDraws, 1);
  assert.throws(() => createNpcActivity(program({ firstInterval: false }), { generation: 1, seed: 71, initialDelayMs: 1 }));
  assert.throws(() => createNpcActivity(def, { generation: 1, seed: 0, initialDelayMs: 0 }));
});

test("prepare and rejected host work never change live random, wait, command or actor input", () => {
  const def = program(), state = initial(def), host = input({ dtMs: 1000 });
  const before = structuredClone(state), beforeInput = structuredClone(host);
  const a = prepareNpcActivity(def, state, host), b = prepareNpcActivity(def, state, host);
  assert.deepEqual(a, b);
  assert.deepEqual(state, before); assert.deepEqual(host, beforeInput);
  assert.ok(a.intent); assert.ok(a.nextState.rngDraws > state.rngDraws);
  assert.throws(() => { (a.nextState as FieldNpcActivityState).rngState = 99; }, TypeError);
  assert.throws(() => { (a.intent as { direction: string }).direction = "left"; }, TypeError);
  assert.throws(() => settleNpcActivity(def, a, "idle", state, host), /settlement/);
  assert.deepEqual(state, before);
});

test("proposal rejects late input, definition, state identity and state value changes", () => {
  const def = program(), state = structuredClone(initial(def)), host = input({ dtMs: 1000 });
  const proposal = prepareNpcActivity(def, state, host);
  validateNpcActivityProposal(def, proposal, state, structuredClone(host));
  for (const changed of [input({ dtMs: 999 }), input({ dtMs: 1000, worldPosition: { x: 0.5, y: 0 } }),
    input({ dtMs: 1000, motionActive: true }), input({ dtMs: 1000, direction: "left" }),
    input({ dtMs: 1000, destinations: { ...host.destinations, up: { x: 0, y: 15 } } })])
    assert.throws(() => settleNpcActivity(def, proposal, "started", state, changed), /Stale/);
  assert.throws(() => settleNpcActivity({ ...def, baseIntervalMs: 101 }, proposal, "started", state, host), /Stale/);
  assert.throws(() => settleNpcActivity(def, proposal, "started", structuredClone(state), host), /Stale/);
  state.waitMs += 1;
  assert.throws(() => settleNpcActivity(def, proposal, "started", state, host), /Stale/);
  state.waitMs -= 1;
  assert.throws(() => settleNpcActivity(def, structuredClone(proposal), "started", state, host), /foreign/);
});

test("settlement is an idempotent private candidate; newer published state invalidates old proposal", () => {
  const def = program(), state = initial(def), host = input({ dtMs: 1000 });
  const proposal = prepareNpcActivity(def, state, host);
  const ready = settleNpcActivity(def, proposal, "started", state, host);
  validateNpcActivityProposal(def, proposal, state, host); // final containing transaction validation
  assert.equal(settleNpcActivity(def, proposal, "started", state, host), ready);
  assert.throws(() => settleNpcActivity(def, proposal, "blocked", state, host), /different outcome/);
  assert.throws(() => settleNpcActivity(def, proposal, "started", ready.state, host), /Stale/);
  assert.equal(state.pending, null);
  assert.equal(ready.ticket!.commandId, 1);
});

test("blocked collision settles this draw without a motion or command and waits before retry", () => {
  const def = program(), state = initial(def), host = input({ dtMs: 1000 });
  const proposal = prepareNpcActivity(def, state, host);
  const blocked = settleNpcActivity(def, proposal, "blocked", state, host);
  assert.equal(blocked.ticket, null); assert.equal(blocked.state.pending, null);
  assert.equal(blocked.state.commandId, 0); assert.equal(blocked.state.remainingSteps, 0);
  assert.equal(blocked.state.direction, null);
  assert.equal(blocked.state.rngState, proposal.nextState.rngState);
  assert.ok(blocked.state.waitMs >= 80 && blocked.state.waitMs < 120);
  const waiting = prepareNpcActivity(def, blocked.state, input());
  assert.equal(waiting.intent, null);
  assert.equal(waiting.nextState.rngDraws, blocked.state.rngDraws);
  assert.equal(waiting.nextState.waitMs, blocked.state.waitMs - 10);
});

test("direction candidates use supplied world points and exhaust outside points without granting a move", () => {
  const def = program({ moveArea: { x: -8, y: 8, width: 16, height: 16 } });
  const state = initial(def), host = input({ dtMs: 1000 });
  const proposal = prepareNpcActivity(def, state, host);
  assert.equal(proposal.intent, null);
  assert.equal(proposal.nextState.rngDraws, state.rngDraws + 5); // next timer plus four removed directions
  const waited = settleNpcActivity(def, proposal, "idle", state, host);
  assert.equal(waited.state.pending, null);
  const one = input({ dtMs: 1000, destinations: { ...host.destinations, left: { x: -7.5, y: 0.25 } } });
  assert.equal(prepareNpcActivity(def, state, one).intent!.direction, "left");
  assert.throws(() => prepareNpcActivity(def, state, input({ worldPosition: { x: 9, y: 0 } })), /return to its move area/);
});

test("multi-step burst uses one actor command at a time and does not resample between cells", () => {
  const def = program({ moveSteps: 2 }), a = start(def);
  assert.equal(a.state.remainingSteps, 2);
  assert.throws(() => prepareNpcActivity(def, a.state, input()), /ownership disagree/);
  const waiting = prepareNpcActivity(def, a.state, input({ motionActive: true }));
  assert.equal(waiting.intent, null); assert.deepEqual(waiting.nextState, a.state);
  const done = completeNpcActivity(def, a.state, a.ticket);
  assert.equal(done.remainingSteps, 1); assert.equal(done.pending, null);
  const b = start(def, done, input());
  assert.equal(b.intent.direction, a.intent.direction);
  assert.equal(b.state.rngState, a.state.rngState); assert.equal(b.state.waitMs, a.state.waitMs);
  assert.equal(b.ticket.commandId, 2);
  assert.throws(() => completeNpcActivity(def, b.state, a.ticket), /Stale/);
  const finished = completeNpcActivity(def, b.state, b.ticket);
  assert.equal(finished.remainingSteps, 0); assert.equal(finished.direction, null);
  assert.throws(() => completeNpcActivity(def, finished, b.ticket), /Stale/);
});

test("a burst stops at the source boundary without changing position or taking another direction", () => {
  const def = program({ moveSteps: 2 }), a = start(def), done = completeNpcActivity(def, a.state, a.ticket);
  const host = input(); host.destinations[a.intent.direction] = { x: 1000, y: 1000 };
  const proposal = prepareNpcActivity(def, done, host);
  assert.equal(proposal.intent, null); assert.equal(proposal.nextState.remainingSteps, 0);
  assert.equal(proposal.nextState.rngDraws, done.rngDraws);
});

test("update mask2 pauses during messages while mask10 continues; zero dt never catches up", () => {
  for (const [attribute, mask, paused] of [[2, 9, true], [10, 9, false], [2, 0, true]] as const) {
    const def = program({ updateAttribute: attribute }), state = initial(def), host = input({ updateMask: mask });
    const proposal = prepareNpcActivity(def, state, host);
    assert.equal(proposal.nextState.waitMs, state.waitMs - (paused ? 0 : 10));
    assert.equal(proposal.nextState.rngState, state.rngState);
  }
  const def = program({ baseIntervalMs: 0 }), state = initial(def);
  assert.deepEqual(prepareNpcActivity(def, state, input({ dtMs: 0 })).nextState, state);
  const a = start(def, state);
  assert.equal(a.state.commandId, 1); // even a large elapsed input does not loop/start multiple cells
  assert.equal(a.intent.steps, 1);
});

test("event acquisition retains a pending motion command, freezes timers, and rejects old completion", () => {
  const def = program({ moveSteps: 2 }), started = start(def), before = structuredClone(started.state);
  const held = acquireNpcActivity(def, started.state, "task:3");
  assert.deepEqual(held.state.pending, before.pending);
  assert.equal(held.state.remainingSteps, 2); assert.equal(held.state.waitMs, before.waitMs);
  assert.equal(held.state.rngState, before.rngState);
  assert.throws(() => completeNpcActivity(def, held.state, started.ticket), /paused/);
  assert.throws(() => acquireNpcActivity(def, held.state, "task:4"), /already held/);
  const paused = prepareNpcActivity(def, held.state, input({ dtMs: 10000, motionActive: true }));
  assert.equal(paused.intent, null); assert.deepEqual(paused.nextState, held.state);
  const resumed = releaseNpcActivity(def, held.state, held.lease);
  assert.equal(resumed.ticket!.commandId, started.ticket.commandId);
  assert.ok(resumed.ticket!.revision > started.ticket.revision);
  assert.equal(resumed.state.waitMs, before.waitMs); assert.equal(resumed.state.rngState, before.rngState);
  assert.throws(() => completeNpcActivity(def, resumed.state, started.ticket), /Stale/);
  assert.equal(completeNpcActivity(def, resumed.state, resumed.ticket!).remainingSteps, 1);
  assert.throws(() => releaseNpcActivity(def, resumed.state, held.lease), /Stale/);
});

test("release does not resurrect a completed command or a lease from another actor/generation", () => {
  const def = program(), started = start(def), done = completeNpcActivity(def, started.state, started.ticket);
  const held = acquireNpcActivity(def, done, "task:3");
  for (const wrong of [{ ...held.lease, actorId: "other" }, { ...held.lease, generation: 2 }, { ...held.lease, revision: 999 }])
    assert.throws(() => releaseNpcActivity(def, held.state, wrong), /Stale/);
  const resumed = releaseNpcActivity(def, held.state, held.lease);
  assert.equal(resumed.ticket, null); assert.equal(resumed.state.pending, null);
  assert.throws(() => completeNpcActivity(def, resumed.state, started.ticket), /Stale/);
});

test("checkpoint saves only autonomous metadata and restores a fresh completion generation", () => {
  const def = program(), a = start(def), saved = captureNpcActivity(def, a.state);
  assert.equal(Object.hasOwn(saved.state, "position"), false); assert.equal(Object.hasOwn(saved.state, "motion"), false);
  const restored = restoreNpcActivity(def, saved, { generation: 2 });
  assert.equal(restored.state.rngState, a.state.rngState);
  assert.equal(restored.state.waitMs, a.state.waitMs);
  assert.equal(restored.ticket!.commandId, a.ticket.commandId);
  assert.throws(() => completeNpcActivity(def, restored.state, a.ticket), /Stale/);
  assert.equal(completeNpcActivity(def, restored.state, restored.ticket!).pending, null);
  assert.throws(() => restoreNpcActivity(def, saved, { generation: 1 }));
  assert.throws(() => restoreNpcActivity({ ...def, definitionHash: "b".repeat(64) }, saved, { generation: 2 }), /different definition/);
  saved.state.rngState = 42;
  assert.notEqual(a.state.rngState, 42);
  assert.notEqual(restored.state.rngState, 42);
});

test("event-held, malformed, or unbound checkpoint rows cannot grant ownership", () => {
  const def = program(), a = start(def), held = acquireNpcActivity(def, a.state, "task:9");
  assert.throws(() => captureNpcActivity(def, held.state), /Event-held/);
  assert.throws(() => restoreNpcActivity(def, { kind: "field-npc-activity-checkpoint-v1", state: held.state }, { generation: 2 }), /Event-held/);
  for (const invalid of [{ ...a.state, position: { x: 1, y: 2 } }, { ...a.state, rngState: 0 },
    { ...a.state, remainingSteps: 0 }, { ...a.state, pending: { ...a.state.pending!, commandId: 999 } },
    { ...a.state, pending: { ...a.state.pending!, revision: a.state.revision + 1 } }])
    assert.throws(() => parseNpcActivityState(def, invalid));
  assert.throws(() => prepareNpcActivity(def, initial(def), input({ motionActive: true })), /ownership disagree/);
});
