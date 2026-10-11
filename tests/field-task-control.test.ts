import test from "node:test";
import assert from "node:assert/strict";
import {
  fieldPuppetAlive,
  fieldPuppetControlStep,
  fieldPuppetMainEnd,
  prepareFieldCall,
  prepareFieldPuppetEntry,
  prepareFieldReturn,
  projectFieldPuppetReady,
  type FieldPuppetControlInput,
  type FieldPuppetStatus,
} from "../src/core/field-task-control.js";
import { compileFieldTaskControlInstruction } from "../src/compiler/field-task-control.js";

const slots = (...entries: [number, FieldPuppetStatus][]): FieldPuppetStatus[] => {
  const result = Array<FieldPuppetStatus>(32).fill("sleep");
  for (const [slot, status] of entries) result[slot] = status;
  return result;
};
const control = (changes: Partial<FieldPuppetControlInput> = {}): FieldPuppetControlInput => ({
  kind: "exec",
  firstClock: true,
  asynchronous: false,
  worldMapScript: false,
  callback: "absent",
  slots: slots([4, "awake"]),
  ...changes,
});
const instruction = (mnemonic: string, values: number[] = [], type = 1) => ({
  type,
  mnemonic,
  operands: {
    iValues: [...values, ...Array<number>(8 - values.length).fill(0)],
    rValues: Array<number>(8).fill(0),
    sValues: Array<string>(8).fill(""),
  },
});

test("source Call marker i1 does not make a child; Exec i0 owns asynchronous behavior", () => {
  assert.deepEqual(compileFieldTaskControlInstruction(instruction("Call", [10, 1])),
    compileFieldTaskControlInstruction(instruction("Call", [10, 0])));
  assert.deepEqual(compileFieldTaskControlInstruction(instruction("ExecPuppet", [1], 2)),
    { kind: "exec-puppets", asynchronous: true });
  assert.deepEqual(compileFieldTaskControlInstruction(instruction("ExecPuppet", [0], 2)),
    { kind: "exec-puppets", asynchronous: false });
});

test("generated type-2 main helpers retain SetPuppet and Return", () => {
  assert.deepEqual(compileFieldTaskControlInstruction(instruction("SetPuppet", [31, -1001, 12], 2)),
    { kind: "puppet", slot: 31, actor: "-1001", target: 12 });
  assert.deepEqual(compileFieldTaskControlInstruction(instruction("Return", [], 2)), { kind: "return" });
  assert.deepEqual(compileFieldTaskControlInstruction(instruction("FinishPuppet")), { kind: "finish-puppets" });
});

test("operand decoders reject malformed legacy arrays and unknown parameter forms", () => {
  for (const raw of [
    instruction("Call", [1, 2]),
    instruction("Call", [1], 3),
    instruction("Call", [-1]),
    instruction("SetPuppet", [32, 500, 5]),
    instruction("SetPuppet", [0, 500, -1]),
    instruction("SetPuppet", [0, 2147483648, 5]),
    instruction("ExecPuppet", [-1]),
    instruction("ExecPuppet", [1, 1]),
    instruction("Return", [1]),
    instruction("FinishPuppet", [], 2),
    instruction("Join"),
    { type: 1, mnemonic: "ExecPuppet" },
    { type: 1, mnemonic: "SetPuppet", operands: { iValues: [0, 500, 5] } },
  ]) assert.throws(() => compileFieldTaskControlInstruction(raw));
  const nonzero = instruction("Return");
  nonzero.operands.rValues[0] = 0.5;
  assert.throws(() => compileFieldTaskControlInstruction(nonzero));
  nonzero.operands.rValues[0] = 0;
  nonzero.operands.sValues[0] = "unknown";
  assert.throws(() => compileFieldTaskControlInstruction(nonzero));
});

test("Call skips a source label; Return resumes exactly once after the calling opcode", () => {
  const stack: number[] = [];
  const first = prepareFieldCall({ nextPc: 4, target: 10, stack, range: { min: 0, max: 30 } });
  assert.deepEqual(first, { pc: 11, stack: [4] });
  const nested = prepareFieldCall({ nextPc: 14, target: 20, stack: first.stack, range: { min: 0, max: 30 } });
  assert.deepEqual(nested, { pc: 21, stack: [4, 14] });
  const returned = prepareFieldReturn({ stack: nested.stack, range: { min: 0, max: 30 } });
  assert.deepEqual(returned, { pc: 14, stack: [4] });
  assert.deepEqual(prepareFieldReturn({ stack: returned.stack, range: { min: 0, max: 30 } }),
    { pc: 4, stack: [] });
  assert.deepEqual(stack, []);
  assert.deepEqual(nested.stack, [4, 14]);
});

test("native Stack grows past its 256 capacity; failed ranges and underflow do not mutate it", () => {
  const stack = Array<number>(256).fill(4);
  assert.equal(prepareFieldCall({ nextPc: 4, target: 10, stack, range: { min: 0, max: 30 } }).stack.length, 257);
  const snapshot = [...stack];
  for (const target of [-1, 30, 31]) assert.throws(() =>
    prepareFieldCall({ nextPc: 4, target, stack, range: { min: 0, max: 30 } }));
  assert.deepEqual(stack, snapshot);
  assert.throws(() => prepareFieldReturn({ stack: [], range: { min: 0, max: 30 } }), /matching Call/);
  assert.throws(() => prepareFieldReturn({ stack: [31], range: { min: 0, max: 30 } }), /range/);
});

test("SetPuppet reserves a global sleeping slot and executes its own label within first Exit bounds", () => {
  const status = slots([0, "ready"]);
  const ops = ["end", "nop", "wait", "exit", "nop", "exit"].map((kind) => ({ kind }));
  assert.deepEqual(prepareFieldPuppetEntry({ slot: 1, actor: "500", target: 1, slots: status, instructions: ops }),
    { slot: 1, actor: "500", pc: 1, range: { min: 1, max: 3 } });
  // Native tracks are independent. Two tracks may resolve to the same actor;
  // action arbitration remains a separate host dependency.
  assert.doesNotThrow(() => prepareFieldPuppetEntry({ slot: 2, actor: "500", target: 1, slots: status, instructions: ops }));
  assert.equal(status[1], "sleep");
  for (const occupied of ["awake", "ready", "running", "halt"] as const) {
    assert.throws(() => prepareFieldPuppetEntry({ slot: 0, actor: "500", target: 1, slots: slots([0, occupied]), instructions: ops }), /occupied/);
  }
  assert.throws(() => prepareFieldPuppetEntry({ slot: 1, actor: "500", target: 1, slots: status, instructions: [{ kind: "end" }, { kind: "nop" }] }), /Exit/);
});

test("Exec starts every Awake slot globally in source order and does not restart Ready tasks", () => {
  const statuses = slots([19, "awake"], [2, "ready"], [4, "awake"]);
  const result = fieldPuppetControlStep(control({ slots: statuses }));
  assert.deepEqual(result, { flow: "wait", startSlots: [4, 19], collisionEnabled: false, clearAssignments: true });
  assert.equal(statuses[4], "awake");
  assert.equal(statuses[2], "ready");
});

test("synchronous Exec yields even when every newly readied actor is source-proven absent", () => {
  const first = fieldPuppetControlStep(control());
  assert.equal(first.flow, "wait");
  assert.deepEqual(projectFieldPuppetReady("absent"), { status: "sleep", showActor: false });
  const resumed = fieldPuppetControlStep(control({ firstClock: false, slots: slots() }));
  assert.deepEqual(resumed, { flow: "next", startSlots: [], collisionEnabled: true, clearAssignments: false });
});

test("asynchronous Exec advances immediately; Finish waits other global tasks and never starts Awake ones", () => {
  const first = fieldPuppetControlStep(control({ asynchronous: true }));
  assert.equal(first.flow, "next");
  assert.equal(first.collisionEnabled, false);
  const waiting = fieldPuppetControlStep(control({ kind: "finish", slots: slots([27, "ready"], [4, "awake"]) }));
  assert.deepEqual(waiting, { flow: "wait", startSlots: [], collisionEnabled: null, clearAssignments: false });
  const done = fieldPuppetControlStep(control({ kind: "finish", slots: slots([4, "awake"]) }));
  assert.deepEqual(done, { flow: "next", startSlots: [], collisionEnabled: true, clearAssignments: false });
  assert.equal(fieldPuppetAlive(slots([4, "awake"])), false);
});

test("world-map script mode preserves collisions on start and completion", () => {
  assert.equal(fieldPuppetControlStep(control({ worldMapScript: true })).collisionEnabled, null);
  assert.equal(fieldPuppetControlStep(control({ kind: "finish", worldMapScript: true, slots: slots() })).collisionEnabled, null);
});

test("callback and actor context are mandatory before any Exec start effects are publishable", () => {
  for (const callback of ["unsupported", "unknown"] as const) {
    const input = control({ callback });
    const before = structuredClone(input);
    assert.throws(() => fieldPuppetControlStep(input), /callback/);
    assert.deepEqual(input, before);
    // Finish and a resumed Exec do not invoke the callback again.
    assert.equal(fieldPuppetControlStep({ ...input, kind: "finish", slots: slots() }).flow, "next");
    assert.equal(fieldPuppetControlStep({ ...input, firstClock: false, slots: slots() }).flow, "next");
  }
  assert.throws(() => projectFieldPuppetReady("unknown"), /binding/);
  assert.deepEqual(projectFieldPuppetReady("present"), { status: "ready", showActor: true });
});

test("empty Exec retains the native warning boundary instead of succeeding as a no-op", () => {
  for (const states of [slots(), slots([0, "ready"])])
    assert.throws(() => fieldPuppetControlStep(control({ slots: states })), /warning path/);
  assert.equal(fieldPuppetControlStep(control({ kind: "finish", slots: slots() })).flow, "next");
});

test("main End cancellation happens after the frame and selects only still-Ready tasks", () => {
  assert.deepEqual(fieldPuppetMainEnd(slots([0, "ready"], [4, "awake"], [7, "halt"], [9, "ready"])),
    { forcedExitSlots: [0, 9] });
  // A task completed during this frame has already passed Core.Exit -> Sleep.
  assert.deepEqual(fieldPuppetMainEnd(slots([0, "sleep"], [9, "ready"])), { forcedExitSlots: [9] });
});

test("unknown or partial global slot tables never become source absence", () => {
  for (const statuses of [[], slots().slice(0, 31), Array<FieldPuppetStatus>(32)]) {
    assert.throws(() => fieldPuppetControlStep(control({ slots: statuses })), /32/);
    assert.throws(() => fieldPuppetMainEnd(statuses), /32/);
  }
});
