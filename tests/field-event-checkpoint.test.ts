import assert from "node:assert/strict";
import test from "node:test";
import { captureFieldEventCheckpoint, restoreFieldEventCheckpoint,
  type FieldEventCheckpointInput, type FieldEventCheckpointContext } from "../src/core/field-event-checkpoint.js";
import { EventState, executeEventControl, validateScriptLocalFrameSnapshot,
  type ScriptLocalFrameSnapshot, type VariableRef } from "../src/core/event-state.js";
import { prepareFieldReturn } from "../src/core/field-task-control.js";
import type { Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const local: VariableRef = { category: "ScriptLocalVariable", index: 0 };
const selected: VariableRef = { category: "MessageSelection", index: 0 };
const itemSelected: VariableRef = { category: "ItemSelection", index: 0 };
const counter: VariableRef = { category: "ScenarioVariable", index: 0 };
const add = (value: number) => ({ kind: "calc", left: counter, operator: "＋",
  right: { kind: "immediate", value } });
const barrier = { kind: "event-save" }, exit = { kind: "exit" }, nop = { kind: "nop" };
const transition = (targetScript: string, returnToCaller: boolean) => ({ kind: "script-transition", targetScript, returnToCaller });

function fixture(scripts: Record<string, object[]> = { main: [add(5), barrier, add(2), exit] }) {
  const content = checkpointFixture().field;
  content.scripts = Object.fromEntries(Object.entries(scripts).map(([name, ops]) => [name,
    ops.map((op, index) => ({ ...op, script: `source-${name}`, index: index + 100,
      source: { file: "synthetic", assetPath: `events/${name}` } } as Op))]));
  content.scriptLocals = Object.fromEntries(Object.keys(scripts).map((name) => [name, null]));
  content.scriptTransitionMetadata = Object.fromEntries(Object.keys(scripts).map((name) => [name,
    { customAnimations: "none" as const }]));
  const state = EventState.initialized();
  const input: FieldEventCheckpointInput = {
    barrier: { script: "main", pc: 1 }, main: { id: 3, script: "main", pc: 2, stack: [], actor: "-1001",
      sourceEntityId: null, range: { min: 0, max: content.scripts.main!.length - 1 } },
    eventRootScript: "main", scriptHook: null, puppetLifecycle: null,
    cameraEventActive: false, entryTaskStarted: false,
  };
  const context = (): FieldEventCheckpointContext => ({ content, eventState: state.snapshot(),
    actorIds: ["-1001", "npc"], nextTask: 4, time: 120, entrySynchronized: null });
  return { content, state, input, context };
}

test("a persisted barrier resumes after its address without replaying prior state writes", () => {
  const f = fixture();
  executeEventControl(f.content.scripts.main![0]!, f.state, { pc: 1 }, 4);
  assert.equal(f.state.read(counter), 5);
  const saved = captureFieldEventCheckpoint(f.input, f.context()), variables = f.state.snapshot();
  assert.equal(saved.barrier.pc, 1);
  assert.equal(f.content.scripts.main![1]!.index, 101, "source index is not the program array address");
  const restored = new EventState(variables);
  const cursor = restoreFieldEventCheckpoint(JSON.parse(JSON.stringify(saved)), {
    ...f.context(), eventState: restored.snapshot(),
  }).main;
  assert.deepEqual(f.state.snapshot(), variables, "a codec never executes events or changes the old owner");
  const op = f.content.scripts[cursor.script]![cursor.pc++]!;
  executeEventControl(op, restored, cursor, f.content.scripts[cursor.script]!.length);
  assert.equal(restored.read(counter), 7, "the pre-barrier write is not replayed");
  assert.equal(f.state.read(counter), 5);
});

test("Call continuations are bound to real caller instructions and return to the saved next address", () => {
  const f = fixture({ main: [{ kind: "call", target: 4 }, add(2), exit, nop, nop, barrier, { kind: "return" }] });
  f.input.barrier.pc = 5; f.input.main.pc = 6; f.input.main.stack = [1];
  const saved = captureFieldEventCheckpoint(f.input, f.context());
  const returned = prepareFieldReturn(restoreFieldEventCheckpoint(saved, f.context()).main);
  assert.deepEqual(returned, { pc: 1, stack: [] });
  for (const stack of [[2], [0], [7], [1.5], [NaN]]) {
    const bad = structuredClone(saved); bad.main.stack = stack;
    assert.throws(() => restoreFieldEventCheckpoint(bad, f.context()));
  }
});

test("checkpoint capture and restore detach all mutable task and hook data", () => {
  const f = fixture({ main: [{ kind: "call", target: 4 }, add(2), exit, nop, nop, barrier, { kind: "return" }] });
  f.input.barrier.pc = 5; f.input.main.pc = 6; f.input.main.stack = [1];
  const saved = captureFieldEventCheckpoint(f.input, f.context()), before = structuredClone(saved);
  f.input.main.stack.push(1); f.input.main.range.max = 0;
  assert.deepEqual(saved, before);
  const restored = restoreFieldEventCheckpoint(saved, f.context());
  restored.main.stack.push(1); restored.barrier.pc = 2;
  assert.deepEqual(saved, before);
});

test("forged identity, addresses, ranges, actors, task IDs and injected instructions are rejected", () => {
  const f = fixture(), saved = captureFieldEventCheckpoint(f.input, f.context());
  const changes: ((x: any) => void)[] = [
    x => { x.kind = "field-event-continuation-v0"; }, x => { x.contentHash = "another-source"; },
    x => { x.main.pc = 1; }, x => { x.main.pc = 99; }, x => { x.main.pc = NaN; },
    x => { x.barrier.script = "missing"; }, x => { x.barrier.pc = 0; x.main.pc = 1; },
    x => { x.main.range.min = 1; }, x => { x.main.range.max = 100; },
    x => { x.main.id = 0; }, x => { x.main.id = 4; }, x => { x.main.id = 1.2; },
    x => { x.main.actor = "npc"; }, x => { x.main.sourceEntityId = -1001; },
    x => { x.eventRootScript = "missing"; }, x => { x.main.stack = null; },
    x => { x.main.instructions = [add(999)]; }, x => { x.barrier.op = barrier; },
    x => { x.main.wait = 20; }, x => { x.cameraEventActive = true; },
    x => { x.entryTaskStarted = true; },
  ];
  for (const change of changes) {
    const bad = structuredClone(saved); change(bad);
    assert.throws(() => restoreFieldEventCheckpoint(bad, f.context()));
  }
  assert.throws(() => restoreFieldEventCheckpoint(saved, { ...f.context(), actorIds: ["npc"] }), /actor binding/);
  assert.throws(() => restoreFieldEventCheckpoint(saved, { ...f.context(), nextTask: 3 }), /integer|number/);
  assert.throws(() => restoreFieldEventCheckpoint(saved, { ...f.context(), time: Infinity }), /number/);
  assert.throws(() => restoreFieldEventCheckpoint(saved, { ...f.context(), isBarrier: () => false }), /barrier/);
  const before = structuredClone(f.content);
  f.content.scripts.main![1] = { ...f.content.scripts.main![1]!, kind: "nop" };
  assert.throws(() => restoreFieldEventCheckpoint(saved, { ...f.context(), isBarrier: () => true }), /barrier/);
  assert.notDeepEqual(f.content, before);
});

function hooked(detached: boolean) {
  const f = fixture({ main: [nop, transition("child", true), add(2), exit], child: [nop, barrier, exit] });
  f.content.scriptLocals!.main = { labels: ["caller"], values: [5] };
  f.state.beginScript(f.content.scriptLocals!.main);
  const frame = f.state.captureScriptLocals();
  if (detached) {
    f.content.scriptLocals!.child = { labels: ["callee"], values: [9] };
    f.state.beginScript(f.content.scriptLocals!.child);
  }
  f.input.main.script = "child"; f.input.main.range.max = 2; f.input.barrier.script = "child";
  f.input.scriptHook = { script: "main", pc: 2, range: { min: 0, max: 3 }, locals: f.state.exportScriptLocalFrame(frame) };
  return f;
}

for (const detached of [false, true]) test(`hook ${detached ? "detached" : "shared"} locals preserve future writes and both selections`, () => {
  const f = hooked(detached), saved = captureFieldEventCheckpoint(f.input, f.context());
  const state = new EventState(f.state.snapshot());
  const restored = restoreFieldEventCheckpoint(saved, { ...f.context(), eventState: state.snapshot() });
  const frame = state.importScriptLocalFrame(restored.scriptHook!.locals);
  state.write(local, 77); state.write(selected, 2); state.write(itemSelected, 3);
  state.restoreScriptLocals(frame);
  assert.equal(state.read(local), detached ? 5 : 77);
  assert.equal(state.read(selected), 2); assert.equal(state.read(itemSelected), 3);
  assert.equal(f.state.read(local), detached ? 9 : 5);
});

test("a hook survives direct replacements and validates whether those replacements split its local bank", () => {
  const f = hooked(false);
  f.content.scripts.child!.splice(1, 1, { ...f.content.scripts.child![1]!, ...transition("later", false) } as Op);
  f.content.scripts.later = [f.content.scripts.child![0]!, { ...f.content.scripts.child![1]!, kind: "event-save" } as Op, f.content.scripts.child![2]!];
  f.content.scriptLocals!.later = { labels: ["later"], values: [8] };
  f.content.scriptTransitionMetadata!.later = { customAnimations: "none" };
  const caller = f.state.captureScriptLocals(); f.state.beginScript(f.content.scriptLocals!.later);
  f.input.main.script = "later"; f.input.barrier.script = "later";
  f.input.scriptHook!.locals = f.state.exportScriptLocalFrame(caller);
  assert.equal(captureFieldEventCheckpoint(f.input, f.context()).scriptHook!.locals.kind, "detached");
  f.input.scriptHook!.locals = { kind: "current" };
  assert.throws(() => captureFieldEventCheckpoint(f.input, f.context()), /alias conflicts/);
});

test("hook caller, return instruction, declaration and bank identity must remain content-bound", () => {
  const f = hooked(true), saved = captureFieldEventCheckpoint(f.input, f.context());
  const changes: ((x: any) => void)[] = [
    x => { x.scriptHook.pc = 1; }, x => { x.scriptHook.range.min = 1; },
    x => { x.scriptHook.script = "child"; }, x => { x.scriptHook.locals = { kind: "current" }; },
    x => { x.scriptHook.locals.labels[0] = "forged"; }, x => { x.scriptHook.locals.values[0] = Infinity; },
    x => { x.scriptHook.locals.values.push(0); }, x => { x.scriptHook.stack = []; },
  ];
  for (const change of changes) { const bad = structuredClone(saved); change(bad); assert.throws(() => restoreFieldEventCheckpoint(bad, f.context())); }
  const current = f.state.snapshot(); current.scriptLabels = ["forged"];
  assert.throws(() => restoreFieldEventCheckpoint(saved, { ...f.context(), eventState: current }), /labels differ/);
  delete f.content.scriptLocals!.child;
  assert.throws(() => restoreFieldEventCheckpoint(saved, f.context()), /alias conflicts/);
});

test("active native lifecycle preserves the root context and explicit camera and entry state", () => {
  const f = fixture();
  f.content.cameraHost = { kind: "source-field-camera-host-v1", mapRange: { x: 0, y: 0, width: 6, height: 4 },
    loop: { horizontal: false, vertical: false }, playerVisualOffset: { x: 0, y: -6 }, callbacks: "fresh-normal-field-v1",
    sources: [{ file: "one", sha256: "a".repeat(64) }, { file: "two", sha256: "b".repeat(64) }] };
  f.content.entry.synchronization = { kind: "map-entry" };
  f.content.scriptPuppetContexts = { main: { skipInitialize: false, keepPlayerPuppet: false,
    keepBadStatusVisual: false, ridingVehicle: false, characteristics: true,
    scriptHash: "a".repeat(64), miscHash: "b".repeat(64) } };
  f.input.puppetLifecycle = { name: "main", leaderId: -1001, assignments: [true, false, true, false, false], finished: false };
  f.input.cameraEventActive = true; f.input.entryTaskStarted = true;
  const ctx = { ...f.context(), entrySynchronized: false };
  const saved = captureFieldEventCheckpoint(f.input, ctx);
  assert.deepEqual(restoreFieldEventCheckpoint(saved, ctx), saved);
  assert.deepEqual(captureFieldEventCheckpoint(f.input, { ...ctx, entrySynchronized: true }), saved);
  const changes: ((x: any) => void)[] = [
    x => { x.puppetLifecycle = null; }, x => { x.puppetLifecycle.finished = true; },
    x => { x.puppetLifecycle.name = "child"; }, x => { x.puppetLifecycle.leaderId = null; },
    x => { x.puppetLifecycle.assignments.pop(); }, x => { x.puppetLifecycle.assignments[0] = 1; },
    x => { x.puppetLifecycle.script = f.content.scriptPuppetContexts!.main; },
    x => { x.cameraEventActive = false; }, x => { x.entryTaskStarted = false; },
  ];
  for (const change of changes) { const bad = structuredClone(saved); change(bad); assert.throws(() => restoreFieldEventCheckpoint(bad, ctx)); }
  assert.throws(() => restoreFieldEventCheckpoint(saved, { ...ctx, entrySynchronized: null }), /entry/);
  const retained = structuredClone(saved.puppetLifecycle!.assignments);
  saved.puppetLifecycle!.assignments[0] = false;
  assert.deepEqual(f.input.puppetLifecycle.assignments, retained);
});

test("frame export/import preserves null and unknown values and cannot mutate either owner through a DTO", () => {
  const owner = new EventState(), empty = owner.captureScriptLocals();
  owner.beginScript({ labels: ["child"], values: [1] });
  const nullBank = owner.exportScriptLocalFrame(empty);
  assert.deepEqual(nullBank, { kind: "detached", labels: null, values: null });
  const restored = new EventState(owner.snapshot());
  const nullFrame = restored.importScriptLocalFrame(nullBank); restored.restoreScriptLocals(nullFrame);
  assert.equal(restored.snapshot().script, null);
  const unknown = { kind: "detached" as const, labels: ["saved"], values: [null] };
  const frame = owner.importScriptLocalFrame(unknown); unknown.labels[0] = "mutation";
  owner.restoreScriptLocals(frame);
  assert.deepEqual(owner.snapshot().scriptLabels, ["saved"]);
  assert.throws(() => owner.read(local), /未知/);
  assert.throws(() => restored.restoreScriptLocals(frame), /another event owner/);
  assert.throws(() => restored.exportScriptLocalFrame(frame), /another event owner/);
});

test("frame DTO rejects extra values on aliases, malformed banks, holes and invalid event numbers", () => {
  const invalid: unknown[] = [null, {}, { kind: "current", values: [] }, { kind: "other" },
    { kind: "detached", labels: null, values: [] }, { kind: "detached", labels: [], values: null },
    { kind: "detached", labels: ["x"], values: [] }, { kind: "detached", labels: [5], values: [1] },
    { kind: "detached", labels: ["x"], values: [0x80000000] },
    { kind: "detached", labels: ["x"], values: [NaN] },
    { kind: "detached", labels: Array(1), values: [1] }, { kind: "detached", labels: ["x"], values: Array(1) }];
  const owner = EventState.initialized(), before = owner.snapshot();
  for (const value of invalid) {
    assert.throws(() => validateScriptLocalFrameSnapshot(value));
    assert.throws(() => owner.importScriptLocalFrame(value as ScriptLocalFrameSnapshot));
    assert.deepEqual(owner.snapshot(), before);
  }
});
