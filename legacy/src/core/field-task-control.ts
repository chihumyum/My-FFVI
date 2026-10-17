import { int32 } from "./script-integer.js";

/** FieldGame owns tasks and slots. These projections never start or retain one. */
export type FieldTaskControlOp =
  | { kind: "call"; target: number }
  | { kind: "return" }
  | { kind: "puppet"; slot: number; actor: string; target: number }
  | { kind: "exec-puppets"; asynchronous: boolean }
  | { kind: "finish-puppets" };

/** Inclusive native ProgramCounter bounds; pc/stack use Web next-op addresses. */
export interface FieldTaskRange {
  min: number;
  max: number;
}
export interface FieldTaskCursor {
  pc: number;
  stack: number[];
}
export type FieldPuppetStatus = "sleep" | "awake" | "ready" | "running" | "halt";
export type FieldPuppetCallback = "absent" | "unsupported" | "unknown";
export interface FieldPuppetControlInput {
  kind: "exec" | "finish";
  firstClock: boolean;
  asynchronous: boolean;
  worldMapScript: boolean;
  callback: FieldPuppetCallback;
  /** All 32 source slots, in track order. Missing entries are not sleeping slots. */
  slots: readonly FieldPuppetStatus[];
}
export interface FieldPuppetControlProjection {
  flow: "next" | "wait";
  startSlots: number[];
  collisionEnabled: boolean | null;
  clearAssignments: boolean;
}

function address(value: number): number {
  if (int32(value) < 0) throw new Error("Invalid field instruction address");
  return value;
}
function bounds(range: FieldTaskRange): void {
  address(range.min);
  address(range.max);
  if (range.max < range.min) throw new Error("Invalid field task range");
}
function inRange(value: number, range: FieldTaskRange): void {
  address(value);
  if (value < range.min || value > range.max)
    throw new Error("Field control flow leaves the source task range");
}
function validateStack(stack: readonly number[], range: FieldTaskRange): void {
  for (const nextPc of stack) inRange(nextPc - 1, range);
}
function validateSlots(slots: readonly FieldPuppetStatus[]): void {
  const statuses = new Set(["sleep", "awake", "ready", "running", "halt"]);
  if (slots.length !== 32 || Array.from(slots).some((s) => !statuses.has(s)))
    throw new Error("Expected all 32 source puppet slot statuses");
}

/** Call stores its own native PC; JumpTo + Clock.Next then skip the target label.
 * Stack<T> grows when full. The source kStackSize=256 is not a recursion limit. */
export function prepareFieldCall(input: {
  nextPc: number;
  target: number;
  stack: readonly number[];
  range: FieldTaskRange;
}): FieldTaskCursor {
  bounds(input.range);
  inRange(input.nextPc - 1, input.range);
  inRange(input.target, input.range);
  inRange(input.target + 1, input.range);
  validateStack(input.stack, input.range);
  return { pc: input.target + 1, stack: [...input.stack, input.nextPc] };
}

export function prepareFieldReturn(input: {
  stack: readonly number[];
  range: FieldTaskRange;
}): FieldTaskCursor {
  bounds(input.range);
  validateStack(input.stack, input.range);
  const nextPc = input.stack.at(-1);
  if (nextPc === undefined) throw new Error("Field Return has no matching Call");
  inRange(nextPc, input.range);
  return { pc: nextPc, stack: input.stack.slice(0, -1) };
}

/** Resolving source entity aliases and side effects is a separate host preflight.
 * Entry reserves a sleeping global slot and bounds it at the first source Exit. */
export function prepareFieldPuppetEntry(input: {
  slot: number;
  actor: string;
  target: number;
  slots: readonly FieldPuppetStatus[];
  instructions: readonly { kind: string }[];
}): { slot: number; actor: string; pc: number; range: FieldTaskRange } {
  validateSlots(input.slots);
  if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot >= 32)
    throw new Error("Invalid source puppet track");
  if (input.slots[input.slot] !== "sleep")
    throw new Error("Source puppet track is already occupied");
  if (typeof input.actor !== "string" || input.actor.length === 0)
    throw new Error("Missing source puppet actor identity");
  address(input.target);
  if (input.target >= input.instructions.length)
    throw new Error("Puppet entry is outside the source script");
  const end = input.instructions.findIndex(
    (op, index) => index >= input.target && op.kind === "exit",
  );
  if (end < 0) throw new Error("Puppet entry has no source Exit");
  return {
    slot: input.slot,
    actor: input.actor,
    pc: input.target,
    range: { min: input.target, max: end },
  };
}

/** IsPuppetCoreAlive checks IsReady only; a staged Awake core is not running. */
export function fieldPuppetAlive(slots: readonly FieldPuppetStatus[]): boolean {
  validateSlots(slots);
  return slots.includes("ready");
}

/** Native Ready shows a resolved actor. A source-proven absent actor sleeps;
 * an unresolved Web binding must remain blocked rather than pretend absence. */
export function projectFieldPuppetReady(
  actor: "present" | "absent" | "unknown",
): { status: "ready" | "sleep"; showActor: boolean } {
  if (actor === "present") return { status: "ready", showActor: true };
  if (actor === "absent") return { status: "sleep", showActor: false };
  throw new Error("Unresolved source puppet entity binding");
}

/** First Exec starts every globally Awake core, in slot order. Subsequent Exec
 * and Finish observe all Ready slots; they never start or cancel a pending core. */
export function fieldPuppetControlStep(
  input: FieldPuppetControlInput,
): FieldPuppetControlProjection {
  validateSlots(input.slots);
  if (
    (input.kind !== "exec" && input.kind !== "finish") ||
    typeof input.firstClock !== "boolean" ||
    typeof input.asynchronous !== "boolean" ||
    typeof input.worldMapScript !== "boolean"
  )
    throw new Error("Unresolved source puppet control context");
  if (input.kind === "exec" && input.firstClock) {
    if (input.callback !== "absent")
      throw new Error("Source ExecPuppet callback is not implemented or unknown");
    const startSlots = input.slots.flatMap((state, slot) =>
      state === "awake" ? [slot] : [],
    );
    // ExecutePuppetCores emits WarningFactor when no Awake core was readied.
    // Its alert continuation is not admitted as a silent successful empty Exec.
    if (startSlots.length === 0)
      throw new Error("Source ExecPuppet has no Awake cores (warning path)");
    return {
      flow: input.asynchronous ? "next" : "wait",
      startSlots,
      collisionEnabled: input.worldMapScript ? null : false,
      clearAssignments: true,
    };
  }
  const alive = fieldPuppetAlive(input.slots);
  return {
    flow: alive ? "wait" : "next",
    startSlots: [],
    collisionEnabled: alive || input.worldMapScript ? null : true,
    clearAssignments: false,
  };
}

/** Integrator.Update clocks main first, then slot 0..31 once each. A halted main
 * forces still-Ready puppets out only after that frame's puppet clocks finish.
 * This is a selection helper; FieldGame applies Exit/actor cleanup itself. */
export function fieldPuppetMainEnd(
  slotsAfterFrame: readonly FieldPuppetStatus[],
): { forcedExitSlots: number[] } {
  validateSlots(slotsAfterFrame);
  return {
    forcedExitSlots: slotsAfterFrame.flatMap((status, slot) =>
      status === "ready" ? [slot] : [],
    ),
  };
}
