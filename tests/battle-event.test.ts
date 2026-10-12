import test from "node:test";
import assert from "node:assert/strict";
import { EventState, type VariableRef } from "../src/core/event-state.js";
import {
  advanceBattleEvent,
  assertBattleEventExecutable,
  BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT,
  BattleEventError,
  createBattleEventState,
  parseBattleEventProgram,
  type BattleEventContext,
  type BattleEventOp,
  type BattleEventProgram,
  type BattleEventRequest,
  type BattleEventState,
} from "../src/core/battle-event.js";

const immediate = (value: number) => ({ kind: "immediate" as const, value });
const ref = (category: VariableRef["category"], index = 0): VariableRef => ({ category, index });
const variable = (ref: VariableRef) => ({ kind: "variable" as const, ref });
const program = (ops: BattleEventOp[], initialLocals = [0]): BattleEventProgram => ({
  kind: "battle-event-v1", source: null, entry: 0, end: ops.length,
  localNames: initialLocals.map((_, index) => `local-${index}`), initialLocals,
  instructions: ops.map((op) => ({ mnemonic: op.kind, op })), blockers: [],
});
const context = (changes: Partial<BattleEventContext> = {}): BattleEventContext => ({
  clock: 0, timeSeconds: (changes.clock ?? 0) / 100, started: true, aiCoreAlive: false, actionStaging: false, ...changes,
});

test("program parsing keeps a detached diagnostic program; execution refuses unreachable unknown instructions", () => {
  const input = program([{ kind: "exit" }, { kind: "blocked", reason: "SysCall has no host" }]);
  const parsed = parseBattleEventProgram(input);
  input.instructions[1]!.op = { kind: "nop" };
  assert.equal(parsed.instructions[1]!.op.kind, "blocked");
  assert.throws(() => assertBattleEventExecutable(parsed), /Mnemonics\/1: SysCall has no host/);
  assert.throws(() => createBattleEventState(parsed), /SysCall/);
  const header = program([{ kind: "exit" }]);
  header.blockers = ["Unknown SystemFlag"];
  assert.throws(() => createBattleEventState(header), /Unknown SystemFlag/);
});

test("program parser rejects malformed runtime JSON rather than coercing booleans, locals, or addresses", () => {
  const valid = program([{ kind: "end-enabled", enabled: true }, { kind: "exit" }]);
  for (const bad of [
    { ...valid, extra: 1 }, { ...valid, end: 0 }, { ...valid, entry: -1 },
    { ...valid, initialLocals: [] }, { ...valid, initialLocals: [2147483648] },
    { ...valid, instructions: [{ mnemonic: "control", op: { kind: "end-enabled", enabled: 1 } }, valid.instructions[1]] },
    { ...valid, instructions: [{ mnemonic: "call", op: { kind: "call", target: 1 } }, valid.instructions[1]] },
    { ...valid, instructions: [{ mnemonic: "calc", op: { kind: "calc", index: 1, operator: "←", right: immediate(2) } }, valid.instructions[1]] },
    { ...valid, instructions: [{ mnemonic: "calc", op: { kind: "calc", index: 0, operator: "+", right: immediate(2) } }, valid.instructions[1]] },
    { ...valid, source: { objectId: 123 } },
  ]) assert.throws(() => parseBattleEventProgram(bad));
  assert.throws(() => parseBattleEventProgram(program([{ kind: "sync-ai" }, { kind: "exit" }], [])), /local|Local/);
});

test("local program validation preserves strict nested shapes, number ranges and source identity", () => {
  const valid = program([{ kind: "wait", seconds: -1e100 }, { kind: "exit" }]);
  valid.source = { sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64), file: "synthetic.bundle",
    sha256: "c".repeat(64), assetPath: "synthetic-event", serializedFile: "synthetic", objectId: "9007199254740993" };
  const parsed = parseBattleEventProgram(valid);
  assert.deepEqual(parsed, valid);
  parsed.source!.objectId = "7";
  parsed.initialLocals[0] = 5;
  assert.equal(valid.source.objectId, "9007199254740993");
  assert.equal(valid.initialLocals[0], 0);
  const instruction = (op: unknown) => ({ ...valid,
    instructions: [{ mnemonic: "controlled", op }, valid.instructions[1]] });
  for (const bad of [
    { ...valid, source: { ...valid.source, extra: 1 } },
    { ...valid, source: { ...valid.source, sha256: "c".repeat(63) } },
    { ...valid, source: { ...valid.source, objectId: 9007199254740992 } },
    { ...valid, source: { ...valid.source, objectId: "1e10" } },
    { ...valid, instructions: [{ ...valid.instructions[0], extra: 1 }, valid.instructions[1]] },
    { ...valid, initialLocals: [false] }, { ...valid, localNames: [1] }, { ...valid, blockers: [""] },
    { ...valid, instructions: Array(2) },
    instruction({ kind: "wait", seconds: NaN }), instruction({ kind: "wait", seconds: Infinity }),
    instruction({ kind: "wait", seconds: "0" }), instruction({ kind: "nop", ignored: 0 }),
    instruction({ kind: "interactive", enabled: 0 }), instruction({ kind: "blocked", reason: "" }),
    instruction({ kind: "call", target: 0.5 }), instruction({ kind: "jump", target: 2147483648 }),
    instruction({ kind: "calc", index: 0, operator: "←", right: { kind: "immediate", value: -2147483649 } }),
    instruction({ kind: "calc", index: 0, operator: "←", right: { kind: "immediate", value: 0, extra: 1 } }),
    instruction({ kind: "calc", index: 0, operator: "←", right: { kind: "local", index: "0" } }),
    instruction({ kind: "unknown" }),
  ]) assert.throws(() => parseBattleEventProgram(bad));
});

test("local arithmetic is int32, reads the current local bank, and branches after the label", () => {
  const p = program([
    { kind: "calc", index: 0, operator: "＋", right: immediate(1) },
    { kind: "calc", index: 1, operator: "←", right: { kind: "local", index: 0 } },
    { kind: "branch", index: 1, operator: "＝", right: immediate(-2147483648), target: 4 },
    { kind: "calc", index: 1, operator: "←", right: immediate(99) },
    { kind: "nop" },
    { kind: "calc", index: 1, operator: "÷", right: immediate(0) },
    { kind: "exit" },
  ], [2147483647, 0]);
  const start = createBattleEventState(p), saved = structuredClone(start);
  const done = advanceBattleEvent(p, start, context());
  assert.deepEqual(done.state.locals, [-2147483648, -2147483648]);
  assert.deepEqual(done.visited, [0, 1, 2, 5, 6]);
  assert.deepEqual(start, saved);
  assert.equal(done.state.status, "exited");
});

test("nested Call and Return resume after the call and do not execute target labels", () => {
  const p = program([
    { kind: "call", target: 3 },
    { kind: "calc", index: 0, operator: "＋", right: immediate(100) },
    { kind: "exit" },
    { kind: "calc", index: 0, operator: "←", right: immediate(-99) },
    { kind: "call", target: 7 },
    { kind: "calc", index: 0, operator: "＋", right: immediate(10) },
    { kind: "return" },
    { kind: "nop" },
    { kind: "calc", index: 0, operator: "＋", right: immediate(1) },
    { kind: "return" },
  ]);
  const result = advanceBattleEvent(p, createBattleEventState(p), context());
  assert.equal(result.state.locals[0], 111);
  assert.deepEqual(result.state.stack, []);
  assert.deepEqual(result.visited, [0, 4, 8, 9, 5, 6, 1, 2]);
});

test("Branch requires exactly one, not arbitrary nonzero arithmetic, without assigning its lhs", () => {
  for (const result of [-1, 0, 1, 2]) {
    const p = program([
      { kind: "branch", index: 0, operator: "←", right: immediate(result), target: 3 },
      { kind: "calc", index: 1, operator: "←", right: immediate(10) },
      { kind: "exit" }, { kind: "nop" },
      { kind: "calc", index: 1, operator: "←", right: immediate(20) },
      { kind: "exit" },
    ], [7, 0]);
    const advanced = advanceBattleEvent(p, createBattleEventState(p), context());
    assert.deepEqual(advanced.state.locals, [7, result === 1 ? 20 : 10]);
    assert.deepEqual(advanced.visited, result === 1 ? [0, 4, 5] : [0, 1, 2]);
  }
});

test("failed arithmetic or Return never publishes an earlier local write", () => {
  const p = program([
    { kind: "calc", index: 0, operator: "←", right: immediate(-2147483648) },
    { kind: "calc", index: 0, operator: "÷", right: immediate(-1) },
    { kind: "exit" },
  ]);
  const state = createBattleEventState(p), before = structuredClone(state);
  assert.throws(() => advanceBattleEvent(p, state, context()), /Mnemonics\/1: Signed event division overflow/);
  assert.deepEqual(state, before);
  const noCall = program([{ kind: "return" }, { kind: "exit" }]);
  assert.throws(() => advanceBattleEvent(noCall, createBattleEventState(noCall), context()), /matching Call/);
});

test("fallthrough beyond program end is an error, not an implicit successful lifecycle", () => {
  const p = program([{ kind: "nop" }]);
  const state = createBattleEventState(p);
  assert.throws(() => advanceBattleEvent(p, state, context()), /no implicit Exit/);
  assert.equal(state.pc, 0);
});

test("Blank stops one host clock and repeated same-clock evaluation cannot consume it", () => {
  const p = program([{ kind: "blank" }, { kind: "calc", index: 0, operator: "＋", right: immediate(1) }, { kind: "exit" }]);
  const first = advanceBattleEvent(p, createBattleEventState(p), context());
  assert.equal(first.state.pc, 0);
  assert.equal(first.state.status, "waiting");
  assert.deepEqual(advanceBattleEvent(p, first.state, context()), { state: first.state, requests: [], visited: [] });
  const next = advanceBattleEvent(p, first.state, context({ clock: 1 }));
  assert.equal(next.state.locals[0], 1);
  assert.equal(next.state.status, "exited");
});

test("Wait uses the host's absolute time, repeats initially, and advances at the exact threshold", () => {
  const p = program([{ kind: "wait", seconds: 0.25 }, { kind: "exit" }]);
  let state = advanceBattleEvent(p, createBattleEventState(p), context({ timeSeconds: 5 })).state;
  assert.deepEqual(state.wait, { kind: "time", clock: 0, entryTimeSeconds: 5 });
  assert.deepEqual(advanceBattleEvent(p, state, context({ timeSeconds: 50 })).state, state);
  state = advanceBattleEvent(p, state, context({ clock: 1, timeSeconds: 5.125 })).state;
  assert.equal(state.status, "waiting");
  assert.deepEqual(state.wait, { kind: "time", clock: 1, entryTimeSeconds: 5 });
  state = advanceBattleEvent(p, state, context({ clock: 2, timeSeconds: 5.25 })).state;
  assert.equal(state.status, "exited");
  const skipped = advanceBattleEvent(p, createBattleEventState(p), context({ timeSeconds: 10 })).state;
  assert.equal(advanceBattleEvent(p, skipped, context({ clock: 9, timeSeconds: 20 })).state.status, "exited");
});

test("zero and negative Wait durations still repeat once, and corrupt time fails atomically", () => {
  for (const seconds of [0, -0.5]) {
    const p = program([{ kind: "wait", seconds }, { kind: "exit" }]);
    const state = advanceBattleEvent(p, createBattleEventState(p), context({ timeSeconds: 2 })).state;
    const before = structuredClone(state);
    assert.equal(state.status, "waiting");
    assert.throws(() => advanceBattleEvent(p, state, context({ clock: 1, timeSeconds: 1 })), /before Wait entry/);
    assert.deepEqual(state, before);
    assert.equal(advanceBattleEvent(p, state, context({ clock: 1, timeSeconds: 2 })).state.status, "exited");
  }
});

test("start and action waits consume only explicit host predicates, with no queue guess", () => {
  const p = program([{ kind: "wait-start" }, { kind: "sync-action" }, { kind: "exit" }]);
  let result = advanceBattleEvent(p, createBattleEventState(p), context({ started: false }));
  assert.equal(result.state.wait?.kind, "start");
  result = advanceBattleEvent(p, result.state, context({ clock: 1, started: true, actionStaging: true }));
  assert.equal(result.state.pc, 1);
  assert.equal(result.state.wait?.kind, "action");
  assert.equal(advanceBattleEvent(p, result.state, context({ clock: 1, actionStaging: false })).state.status, "waiting");
  result = advanceBattleEvent(p, result.state, context({ clock: 2, actionStaging: false }));
  assert.equal(result.state.status, "exited");
});

test("Exec and Sync each return a host boundary; Sync writes !alive and does not wait", () => {
  const p = program([{ kind: "exec-ai" }, { kind: "sync-ai" }, { kind: "exit" }]);
  const original = createBattleEventState(p);
  const exec = advanceBattleEvent(p, original, context({ aiCoreAlive: false }));
  assert.deepEqual(exec.requests, [{ kind: "exec-ai", pc: 0 }]);
  assert.equal(exec.state.pc, 1);
  assert.equal(exec.state.locals[0], 0);
  const sync = advanceBattleEvent(p, exec.state, context({ aiCoreAlive: true }));
  assert.deepEqual(sync.requests, [{ kind: "sync-ai", pc: 1 }]);
  assert.equal(sync.state.locals[0], 0);
  assert.equal(sync.state.status, "running");
  assert.equal(sync.state.pc, 2);
  assert.equal(advanceBattleEvent(p, sync.state, context()).state.status, "exited");
  assert.equal(original.pc, 0);
  const onlySync = program([{ kind: "sync-ai" }, { kind: "exit" }], [99]);
  assert.equal(advanceBattleEvent(onlySync, createBattleEventState(onlySync), context({ aiCoreAlive: false })).state.locals[0], 1);
});

test("control requests are ordered and remain battle-host ownership", () => {
  const p = program([
    { kind: "end-enabled", enabled: false }, { kind: "pause", enabled: true },
    { kind: "interactive", enabled: false }, { kind: "pause", enabled: false },
    { kind: "end-enabled", enabled: true }, { kind: "exit" },
  ]);
  let state = createBattleEventState(p);
  const requests: BattleEventRequest[] = [];
  while (state.status !== "exited") {
    const advanced = advanceBattleEvent(p, state, context());
    assert.ok(advanced.requests.length <= 1);
    requests.push(...advanced.requests);
    state = advanced.state;
  }
  assert.deepEqual(requests, [
    { kind: "end-enabled", enabled: false, pc: 0 }, { kind: "pause", enabled: true, pc: 1 },
    { kind: "interactive", enabled: false, pc: 2 }, { kind: "pause", enabled: false, pc: 3 },
    { kind: "end-enabled", enabled: true, pc: 4 },
  ]);
  assert.equal("endEnabled" in state, false);
  assert.equal("paused" in state, false);
});

test("a complete lifecycle polls AI across Blank clocks, then waits staging before permitting results", () => {
  const p = program([
    { kind: "end-enabled", enabled: false }, { kind: "wait-start" }, { kind: "exec-ai" },
    { kind: "nop" }, { kind: "blank" }, { kind: "sync-ai" },
    { kind: "branch", index: 0, operator: "＝", right: immediate(0), target: 3 },
    { kind: "sync-action" }, { kind: "end-enabled", enabled: true }, { kind: "exit" },
  ]);
  let state = createBattleEventState(p), alive = false, endEnabled = true, execs = 0, syncs = 0;
  const clock = (number: number, started: boolean, actionStaging: boolean) => {
    while (state.status !== "exited") {
      const step = advanceBattleEvent(p, state, context({ clock: number, started, actionStaging, aiCoreAlive: alive }));
      state = step.state;
      for (const request of step.requests) {
        if (request.kind === "exec-ai") { execs++; alive = true; }
        if (request.kind === "sync-ai") syncs++;
        if (request.kind === "end-enabled") endEnabled = request.enabled;
      }
      if (!step.requests.length) break;
    }
  };
  clock(0, false, false);
  assert.equal(endEnabled, false);
  assert.equal(execs, 0);
  clock(1, true, false);
  assert.equal(execs, 1);
  clock(2, true, false);
  assert.equal(syncs, 1);
  assert.equal(state.locals[0], 0);
  assert.equal(endEnabled, false);
  alive = false;
  clock(3, true, true);
  assert.equal(state.locals[0], 1);
  assert.equal(state.wait?.kind, "action");
  assert.equal(endEnabled, false);
  clock(4, true, false);
  assert.equal(endEnabled, true);
  assert.equal(state.status, "exited");
  assert.equal(execs, 1);
  assert.equal(syncs, 2);
});

test("local infinite loops and request-boundary loops share a per-clock safety limit", () => {
  const localLoop = program([{ kind: "nop" }, { kind: "jump", target: 0 }, { kind: "exit" }]);
  assert.throws(() => advanceBattleEvent(localLoop, createBattleEventState(localLoop), context()), /without yielding/);
  const p = program([{ kind: "nop" }, { kind: "exec-ai" }, { kind: "jump", target: 0 }, { kind: "exit" }]);
  let state = createBattleEventState(p), requests = 0;
  assert.throws(() => {
    while (true) {
      const next = advanceBattleEvent(p, state, context());
      state = next.state;
      requests += next.requests.length;
    }
  }, /instruction budget/);
  assert.ok(requests > 0 && requests < BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT);
});

test("invalid or reversed host clocks and forged continuations cannot silently advance", () => {
  const p = program([{ kind: "blank" }, { kind: "exit" }]);
  const state = advanceBattleEvent(p, createBattleEventState(p), context({ clock: 5 })).state;
  const before = structuredClone(state);
  assert.throws(() => advanceBattleEvent(p, state, context({ clock: 4 })), /backwards/);
  assert.throws(() => advanceBattleEvent(p, state, context({ aiCoreAlive: undefined as unknown as boolean })));
  for (const changed of [
    { ...state, pc: 1 }, { ...state, locals: [] }, { ...state, stack: [p.end] },
    { ...state, status: "running" as const }, { ...state, wait: null },
    { ...state, wait: { kind: "blank" as const, clock: 4 } },
  ]) assert.throws(() => advanceBattleEvent(p, changed, context({ clock: 6 })));
  assert.deepEqual(state, before);
});

test("local state and context validation rejects unknown fields and coercions without publishing", () => {
  const p = program([{ kind: "wait", seconds: 1 }, { kind: "exit" }]);
  const state = advanceBattleEvent(p, createBattleEventState(p), context()).state;
  const before = structuredClone(state), next = context({ clock: 1 });
  const states: unknown[] = [
    { ...state, extra: 1 }, { ...state, pc: "0" }, { ...state, pc: -1 },
    { ...state, stack: [false] }, { ...state, locals: [2147483648] },
    { ...state, locals: Array(1) }, { ...state, status: "unknown" },
    { ...state, clock: Number.MAX_SAFE_INTEGER + 1 }, { ...state, clockInstructions: 0.5 },
    { ...state, clockInstructions: BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT + 1 },
    { ...state, wait: { ...state.wait, extra: 1 } },
    { ...state, wait: { kind: "time", clock: 0, entryTimeSeconds: Infinity } },
    { ...state, wait: { kind: "time", clock: 0, entryTimeSeconds: -1 } },
    { ...state, wait: { kind: "time", clock: false, entryTimeSeconds: 0 } },
    { ...state, wait: { kind: "unknown", clock: 0 } },
  ];
  for (const bad of states) assert.throws(() => advanceBattleEvent(p, bad as BattleEventState, next));
  const contexts: unknown[] = [
    { ...next, extra: 1 }, { ...next, clock: 0.5 }, { ...next, clock: Number.MAX_SAFE_INTEGER + 1 },
    { ...next, timeSeconds: NaN }, { ...next, timeSeconds: -1 }, { ...next, timeSeconds: "1" },
    { ...next, started: 1 }, { ...next, aiCoreAlive: "false" }, { ...next, actionStaging: null },
  ];
  for (const bad of contexts) assert.throws(() => advanceBattleEvent(p, state, bad as BattleEventContext));
  assert.deepEqual(state, before);
  const waiting = advanceBattleEvent(p, state, next).state;
  assert.notEqual(waiting.wait, state.wait);
  assert.deepEqual(state, before);
});

test("retry starts from declared locals; exited states are detached and cannot repeat requests", () => {
  const p = program([{ kind: "calc", index: 0, operator: "＋", right: immediate(1) }, { kind: "exit" }], [7]);
  const first = advanceBattleEvent(p, createBattleEventState(p), context()).state;
  const retry = advanceBattleEvent(p, createBattleEventState(p), context()).state;
  assert.deepEqual(retry, first);
  const done = advanceBattleEvent(p, first, context({ clock: 1 }));
  assert.deepEqual(done.requests, []);
  assert.deepEqual(done.visited, []);
  done.state.locals[0] = 999;
  assert.equal(first.locals[0], 8);
});

test("execution errors retain the bound source and exact failing PC", () => {
  const p = program([{ kind: "nop" }, { kind: "return" }, { kind: "exit" }]);
  p.source = { sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64), file: "synthetic.bundle",
    sha256: "c".repeat(64), assetPath: "synthetic-battle-event", serializedFile: "synthetic", objectId: "9007199254740993" };
  assert.throws(() => advanceBattleEvent(p, createBattleEventState(p), context()), (error: unknown) =>
    error instanceof BattleEventError && error.pc === 1 && error.source?.objectId === "9007199254740993" && /matching Call/.test(error.message));
});

test("shared variable references admit only the supported banks and preserve signed flag aliases", () => {
  const supported: VariableRef[] = [
    ref("ScenarioFlag1", 1023), ref("ScenarioFlag2", -256), ref("ScenarioFlag3", 0), ref("ScenarioFlag4", 255),
    ref("TreasureFlag1", 0), ref("TreasureFlag2", 767), ref("TreasureFlag3", -512), ref("TreasureFlag4", -768),
    ref("ScenarioVariable", 15), ref("ScriptLocalVariable", 0),
  ];
  for (const left of supported) {
    const p = program([{ kind: "variable-calc", left, operator: "←", right: immediate(1) }, { kind: "exit" }]);
    const parsed = parseBattleEventProgram(p);
    assert.deepEqual(parsed, p);
    const op = parsed.instructions[0]!.op;
    if (op.kind !== "variable-calc") throw new Error("unreachable");
    op.left.index = 17;
    assert.deepEqual(p.instructions[0]!.op, { kind: "variable-calc", left, operator: "←", right: immediate(1) });
  }
  const invalid: unknown[] = [
    ref("AreaLocalVariable"), ref("MapLocalVariable"), ref("MessageSelection"), ref("ItemSelection"),
    ref("ScenarioFlag1", -1), ref("ScenarioFlag4", 256), ref("TreasureFlag2", -257),
    ref("ScenarioVariable", 16), ref("ScriptLocalVariable", -1), ref("ScriptLocalVariable", 1),
    { category: "ScenarioFlag5", index: 0 }, { category: "ScenarioVariable", index: "0" },
    { category: "ScenarioVariable", index: 0.5 }, { category: "ScenarioVariable", index: 0, extra: 1 },
  ];
  for (const bad of invalid) for (const part of ["left", "right", "flag"] as const) {
    const op = part === "flag" ? { kind: "variable-flag", ref: bad, operation: "set" }
      : { kind: "variable-calc", left: part === "left" ? bad : ref("ScriptLocalVariable"), operator: "←",
        right: part === "right" ? { kind: "variable", ref: bad } : immediate(1) };
    const p = program([{ kind: "nop" }, { kind: "exit" }, { kind: "exit" }]);
    const raw = { ...p, instructions: [p.instructions[0], { mnemonic: "invalid", op }, p.instructions[2]] };
    assert.throws(() => parseBattleEventProgram(raw), (e: unknown) => e instanceof BattleEventError && e.pc === 1);
  }
  const branch = program([{ kind: "variable-branch", left: ref("ScenarioVariable"), operator: "＝",
    right: immediate(1), target: 1 }, { kind: "exit" }]);
  assert.throws(() => parseBattleEventProgram(branch), /target label/);
});

test("shared writes yield detached requests and the same clock resumes against the host's current bank", () => {
  const global = ref("ScenarioVariable"), reads: VariableRef[] = [], events = new EventState();
  const p = program([
    { kind: "variable-calc", left: global, operator: "←", right: variable(ref("ScriptLocalVariable")) },
    { kind: "variable-calc", left: ref("ScriptLocalVariable", 1), operator: "←", right: variable(global) },
    { kind: "variable-calc", left: global, operator: "＋", right: immediate(5) },
    { kind: "variable-branch", left: global, operator: "＝", right: immediate(12), target: 5 },
    { kind: "calc", index: 0, operator: "←", right: immediate(-99) }, { kind: "nop" },
    { kind: "variable-calc", left: ref("ScriptLocalVariable"), operator: "＋", right: variable(global) },
    { kind: "exit" },
  ], [7, 0]);
  const input = createBattleEventState(p), before = structuredClone(input);
  const currentContext = () => context({ variables: { read: value => { reads.push({ ...value }); return events.read(value); } } });
  const first = advanceBattleEvent(p, input, currentContext());
  assert.deepEqual(first.requests, [{ kind: "write-variable", pc: 0, ref: global, value: 7 }]);
  assert.equal(first.state.pc, 1);
  assert.equal(reads.length, 0);
  assert.throws(() => events.read(global), /未知事件状态/);
  events.write(global, 7);
  const second = advanceBattleEvent(p, first.state, currentContext());
  assert.deepEqual(second.state.locals, [7, 7]);
  assert.deepEqual(second.requests, [{ kind: "write-variable", pc: 2, ref: global, value: 12 }]);
  assert.equal(events.read(global), 7, "the VM cannot commit its own shared writes");
  const request = second.requests[0]!;
  if (request.kind !== "write-variable") throw new Error("unreachable");
  events.write(request.ref, request.value);
  request.ref.index = 15;
  assert.equal(global.index, 0);
  const final = advanceBattleEvent(p, second.state, currentContext());
  assert.deepEqual(final.state.locals, [19, 7]);
  assert.equal(final.state.status, "exited");
  assert.deepEqual(final.requests, []);
  assert.ok(reads.every(value => value.category === "ScenarioVariable" && value.index === 0));
  assert.deepEqual(input, before);
});

test("shared assignment and flag set/reset establish unknown cells without reading them", () => {
  const events = new EventState(), global = ref("ScenarioVariable"), alias = ref("ScenarioFlag2", -256);
  const p = program([
    { kind: "variable-calc", left: global, operator: "←", right: immediate(2147483647) },
    { kind: "variable-flag", ref: alias, operation: "set" },
    { kind: "variable-flag", ref: ref("TreasureFlag4", 255), operation: "reset" },
    { kind: "exit" },
  ]);
  let state = createBattleEventState(p);
  const ctx = context({ variables: { read: () => { throw new Error("lhs must not be read"); } } });
  for (const expectedPc of [0, 1, 2]) {
    const result = advanceBattleEvent(p, state, ctx), request = result.requests[0]!;
    assert.equal(request.pc, expectedPc);
    if (request.kind !== "write-variable") throw new Error("unreachable");
    events.write(request.ref, request.value);
    state = result.state;
  }
  assert.equal(events.read(global), 2147483647);
  assert.equal(events.read(ref("ScenarioFlag1")), 1);
  assert.equal(events.read(ref("TreasureFlag1", 1023)), 0);
  assert.equal(advanceBattleEvent(p, state, ctx).state.status, "exited");
});

test("shared arithmetic uses int32 and rereads owner-normalized flag values before flipping", () => {
  const events = EventState.initialized(), global = ref("ScenarioVariable"), flag = ref("TreasureFlag1");
  events.write(global, 2147483647);
  const p = program([
    { kind: "variable-calc", left: global, operator: "＋", right: immediate(1) },
    { kind: "variable-calc", left: flag, operator: "←", right: immediate(2) },
    { kind: "variable-flag", ref: flag, operation: "flip" },
    { kind: "variable-flag", ref: flag, operation: "flip" }, { kind: "exit" },
  ]);
  let state = createBattleEventState(p);
  const writes: number[] = [];
  while (state.status !== "exited") {
    const result = advanceBattleEvent(p, state, context({ variables: { read: value => events.read(value) } }));
    for (const request of result.requests) {
      if (request.kind !== "write-variable") throw new Error("unreachable");
      writes.push(request.value); events.write(request.ref, request.value);
    }
    state = result.state;
  }
  assert.deepEqual(writes, [-2147483648, 2, 0, 1]);
  assert.equal(events.read(global), -2147483648);
  assert.equal(events.read(flag), 1);
});

test("new variable operations never delegate local banks and preserve exact-one Branch semantics", () => {
  const scriptLocal = ref("ScriptLocalVariable"), events = EventState.initialized();
  events.beginScript({ labels: ["field-local"], values: [99] });
  for (const compared of [-1, 0, 1, 2]) {
    const p = program([
      { kind: "variable-calc", left: scriptLocal, operator: "＋", right: variable(scriptLocal) },
      { kind: "variable-flag", ref: scriptLocal, operation: "flip" },
      { kind: "variable-branch", left: ref("ScenarioVariable"), operator: "←", right: immediate(compared), target: 5 },
      { kind: "variable-flag", ref: scriptLocal, operation: "set" }, { kind: "exit" }, { kind: "nop" },
      { kind: "variable-calc", left: scriptLocal, operator: "←", right: immediate(7) }, { kind: "exit" },
    ], [2]);
    const ctx = context({ variables: { read: () => { throw new Error("local or assignment lhs was delegated"); } } });
    const result = advanceBattleEvent(p, createBattleEventState(p), ctx);
    assert.deepEqual(result.requests, []);
    assert.deepEqual(result.state.locals, [compared === 1 ? 7 : 1]);
    assert.equal(events.read(scriptLocal), 99);
  }
  const p = program([{ kind: "variable-flag", ref: scriptLocal, operation: "reset" }, { kind: "exit" }], [9]);
  assert.deepEqual(advanceBattleEvent(p, createBattleEventState(p), context()).state.locals, [0]);
});

test("missing shared providers and unknown values fail at the requesting PC without publishing earlier locals", () => {
  const global = ref("ScenarioVariable"), read = ref("ScenarioFlag1");
  const operations: BattleEventOp[] = [
    { kind: "variable-calc", left: global, operator: "←", right: immediate(7) },
    { kind: "variable-calc", left: global, operator: "＋", right: immediate(1) },
    { kind: "variable-calc", left: ref("ScriptLocalVariable"), operator: "←", right: variable(read) },
    { kind: "variable-branch", left: global, operator: "＝", right: immediate(0), target: 2 },
    { kind: "variable-flag", ref: read, operation: "set" },
    { kind: "variable-flag", ref: read, operation: "reset" },
    { kind: "variable-flag", ref: read, operation: "flip" },
  ];
  for (const op of operations) {
    const p = program([{ kind: "calc", index: 0, operator: "＋", right: immediate(1) }, op,
      { kind: "nop" }, { kind: "exit" }]);
    const state = createBattleEventState(p), before = structuredClone(state);
    assert.throws(() => advanceBattleEvent(p, state, context()), (error: unknown) =>
      error instanceof BattleEventError && error.pc === 1 && /variable provider/.test(error.message));
    assert.deepEqual(state, before);
  }
  const p = program([{ kind: "nop" }, { kind: "variable-calc", left: global, operator: "＋", right: immediate(1) }, { kind: "exit" }]);
  const state = createBattleEventState(p), before = structuredClone(state);
  for (const invalid of [null, undefined, false, "0", NaN, Infinity, 0.5, 2147483648]) {
    const ctx = context({ variables: { read: () => invalid as unknown as number } });
    assert.throws(() => advanceBattleEvent(p, state, ctx), (error: unknown) => error instanceof BattleEventError && error.pc === 1);
    assert.deepEqual(state, before);
  }
  const unknown = new EventState();
  assert.throws(() => advanceBattleEvent(p, state, context({ variables: { read: value => unknown.read(value) } })),
    (error: unknown) => error instanceof BattleEventError && error.pc === 1 && /未知事件状态/.test(error.message));
});

test("shared integer failure leaves the current continuation and owner unchanged", () => {
  const events = EventState.initialized(), global = ref("ScenarioVariable");
  events.write(global, -2147483648);
  const p = program([{ kind: "calc", index: 0, operator: "＋", right: immediate(1) },
    { kind: "variable-calc", left: global, operator: "÷", right: immediate(-1) }, { kind: "exit" }]);
  const state = createBattleEventState(p), before = structuredClone(state), ownerBefore = events.snapshot();
  assert.throws(() => advanceBattleEvent(p, state, context({ variables: { read: value => events.read(value) } })),
    (error: unknown) => error instanceof BattleEventError && error.pc === 1 && /division overflow/.test(error.message));
  assert.deepEqual(state, before);
  assert.deepEqual(events.snapshot(), ownerBefore);
});

test("shared-write request loops cannot reset the per-clock instruction budget", () => {
  const p = program([{ kind: "nop" }, { kind: "variable-flag", ref: ref("ScenarioFlag1"), operation: "set" },
    { kind: "jump", target: 0 }, { kind: "exit" }]);
  const ctx = context({ variables: { read: () => { throw new Error("set must not read"); } } });
  let state = createBattleEventState(p), requests = 0, failedInput = structuredClone(state);
  assert.throws(() => {
    while (true) {
      failedInput = structuredClone(state);
      const advanced = advanceBattleEvent(p, state, ctx);
      assert.equal(advanced.requests[0]?.kind, "write-variable");
      requests++;
      state = advanced.state;
    }
  }, /instruction budget/);
  assert.deepEqual(state, failedInput);
  assert.ok(requests > 0 && requests < BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT);
});

test("players-ended writes only local zero on true and needs an explicit predicate only when executed", () => {
  const p = program([{ kind: "nop" }, { kind: "players-ended" }, { kind: "exit" }], [17, 23]);
  const input = createBattleEventState(p), before = structuredClone(input);
  for (const playersEnded of [false, true]) {
    const result = advanceBattleEvent(p, input, context({ playersEnded }));
    assert.deepEqual(result.state.locals, [playersEnded ? -1 : 17, 23]);
    assert.deepEqual(result.requests, []);
    assert.equal(result.state.status, "exited");
  }
  assert.throws(() => advanceBattleEvent(p, input, context()), (error: unknown) =>
    error instanceof BattleEventError && error.pc === 1 && /players-ended provider/.test(error.message));
  assert.deepEqual(input, before);
  assert.throws(() => parseBattleEventProgram(program([{ kind: "players-ended" }, { kind: "exit" }], [])), /Local/);
  const skipped = program([{ kind: "exit" }, { kind: "players-ended" }]);
  assert.equal(advanceBattleEvent(skipped, createBattleEventState(skipped), context()).state.status, "exited");
  for (const playersEnded of [null, 1, "false"])
    assert.throws(() => advanceBattleEvent(p, input, context({ playersEnded: playersEnded as unknown as boolean })));
});
