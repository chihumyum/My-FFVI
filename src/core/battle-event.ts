import type { BattleAISource } from "./battle-ai.js";
import { int32, integerOperation, isOperator, type Operator } from "./script-integer.js";
import { checkpointInteger, checkpointKeys, checkpointNumber, checkpointRecord } from "./checkpoint-validation.js";

/** BattleGame owns every unit, AI core, action queue, permission, and RNG. This
 * interpreter owns only a detached continuation and script-local integers. */
export type BattleEventValue =
  | { kind: "immediate"; value: number }
  | { kind: "local"; index: number };
export type BattleEventOp =
  | { kind: "nop" | "blank" | "exit" | "return" | "wait-start" | "exec-ai" | "sync-ai" | "sync-action" }
  | { kind: "call" | "jump"; target: number }
  | { kind: "calc"; index: number; operator: Operator; right: BattleEventValue }
  | { kind: "branch"; index: number; operator: Operator; right: BattleEventValue; target: number }
  | { kind: "wait"; seconds: number }
  | { kind: "end-enabled" | "pause" | "interactive"; enabled: boolean }
  | { kind: "blocked"; reason: string };
export type BattleEventProgram = {
  kind: "battle-event-v1";
  source: BattleAISource | null;
  /** Entry is inclusive; end is exclusive. Jump targets name the label before
   * the next executed instruction, as in Internal.Main.Call/Return. */
  entry: number;
  end: number;
  localNames: string[];
  initialLocals: number[];
  instructions: { mnemonic: string; op: BattleEventOp }[];
  blockers: string[];
};
export type BattleEventWait =
  | { kind: "blank" | "start" | "action"; clock: number }
  | { kind: "time"; clock: number; entryTimeSeconds: number };
export type BattleEventState = {
  pc: number;
  stack: number[];
  locals: number[];
  status: "running" | "waiting" | "exited";
  wait: BattleEventWait | null;
  /** Host clock identity also bounds loops that cross request boundaries. */
  clock: number | null;
  clockInstructions: number;
};
export type BattleEventContext = {
  clock: number;
  /** The host's existing simulation time, not a VM-owned countdown. */
  timeSeconds: number;
  started: boolean;
  aiCoreAlive: boolean;
  actionStaging: boolean;
};
export type BattleEventRequest =
  | { kind: "exec-ai" | "sync-ai"; pc: number }
  | { kind: "end-enabled" | "pause" | "interactive"; pc: number; enabled: boolean };
export type BattleEventAdvance = {
  state: BattleEventState;
  /** At most one request. Prepare/apply it inside the BattleGame frame, then
   * resume with fresh context in that same clock. Never drain stale context. */
  requests: BattleEventRequest[];
  visited: number[];
};
export class BattleEventError extends Error {
  constructor(readonly source: BattleAISource | null, readonly pc: number, reason: string) {
    super(`Battle event ${source?.assetPath ?? "synthetic"}#/Mnemonics/${pc}: ${reason}`);
    this.name = "BattleEventError";
  }
}

// Core is loaded directly as browser ESM. Keep runtime validation local and
// reconstruct each accepted object rather than depending on a Node schema host.
function record(raw: unknown, keys: string): Record<string, unknown> {
  checkpointKeys(raw, keys);
  return raw as Record<string, unknown>;
}
function text(raw: unknown, empty = false): string {
  if (typeof raw !== "string" || !empty && raw.length === 0)
    throw new Error("Invalid battle event text");
  return raw;
}
function integer(raw: unknown, minimum = 0, maximum = 2147483647): number {
  if (typeof raw !== "number") throw new Error("Invalid battle event integer");
  checkpointInteger(raw, minimum, maximum);
  return raw;
}
function finite(raw: unknown, minimum = -Number.MAX_VALUE): number {
  if (typeof raw !== "number") throw new Error("Invalid battle event number");
  checkpointNumber(raw, minimum, Number.MAX_VALUE);
  return raw;
}
function boolean(raw: unknown): boolean {
  if (typeof raw !== "boolean") throw new Error("Invalid battle event boolean");
  return raw;
}
function array<T>(raw: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(raw)) throw new Error("Invalid battle event array");
  // Array.from visits sparse entries too; missing data is not an empty slot.
  return Array.from(raw, parse);
}
function parseValue(raw: unknown): BattleEventValue {
  checkpointRecord(raw);
  const value = raw as Record<string, unknown>;
  if (value.kind === "immediate") {
    checkpointKeys(value, "kind,value");
    return { kind: "immediate", value: int32(value.value) };
  }
  if (value.kind === "local") {
    checkpointKeys(value, "kind,index");
    return { kind: "local", index: integer(value.index) };
  }
  throw new Error("Invalid battle event operand");
}
function parseOp(raw: unknown): BattleEventOp {
  checkpointRecord(raw);
  const value = raw as Record<string, unknown>, kind = value.kind;
  switch (kind) {
    case "nop": case "blank": case "exit": case "return":
    case "wait-start": case "exec-ai": case "sync-ai": case "sync-action":
      checkpointKeys(value, "kind");
      return { kind };
    case "call": case "jump":
      checkpointKeys(value, "kind,target");
      return { kind, target: integer(value.target) };
    case "calc": case "branch": {
      checkpointKeys(value, kind === "calc" ? "kind,index,operator,right" : "kind,index,operator,right,target");
      const operator = text(value.operator);
      if (!isOperator(operator)) throw new Error("Invalid battle event operator");
      const common = { index: integer(value.index), operator, right: parseValue(value.right) };
      return kind === "calc" ? { kind, ...common } : { kind, ...common, target: integer(value.target) };
    }
    case "wait":
      checkpointKeys(value, "kind,seconds");
      return { kind, seconds: finite(value.seconds) };
    case "end-enabled": case "pause": case "interactive":
      checkpointKeys(value, "kind,enabled");
      return { kind, enabled: boolean(value.enabled) };
    case "blocked":
      checkpointKeys(value, "kind,reason");
      return { kind, reason: text(value.reason) };
    default: throw new Error("Invalid battle event instruction");
  }
}
function parseSource(raw: unknown): BattleAISource | null {
  if (raw === null) return null;
  const value = record(raw, "sourceSetHash,battleSourceSetHash,file,sha256,assetPath,serializedFile,objectId");
  const hash = (raw: unknown) => {
    const value = text(raw);
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid battle event source hash");
    return value;
  };
  const objectId = text(value.objectId);
  if (!/^-?\d+$/.test(objectId)) throw new Error("Invalid battle event source object identity");
  return { sourceSetHash: hash(value.sourceSetHash), battleSourceSetHash: hash(value.battleSourceSetHash),
    file: text(value.file), sha256: hash(value.sha256), assetPath: text(value.assetPath),
    serializedFile: text(value.serializedFile), objectId };
}

/** Structural parsing deliberately retains blockers, so failed source programs
 * remain inspectable. Execution is a separate, full-program admission check. */
export function parseBattleEventProgram(raw: unknown): BattleEventProgram {
  const value = record(raw, "kind,source,entry,end,localNames,initialLocals,instructions,blockers");
  if (value.kind !== "battle-event-v1") throw new Error("Invalid battle event program kind");
  const program: BattleEventProgram = {
    kind: "battle-event-v1", source: parseSource(value.source), entry: integer(value.entry), end: integer(value.end),
    localNames: array(value.localNames, name => text(name, true)), initialLocals: array(value.initialLocals, int32),
    instructions: array(value.instructions, raw => {
      const instruction = record(raw, "mnemonic,op");
      return { mnemonic: text(instruction.mnemonic), op: parseOp(instruction.op) };
    }), blockers: array(value.blockers, value => text(value)),
  };
  const fail = (pc: number, reason: string): never => { throw new BattleEventError(program.source, pc, reason); };
  if (program.entry >= program.end || program.end > program.instructions.length)
    fail(program.entry, "invalid program range");
  if (program.initialLocals.length !== program.localNames.length)
    fail(program.entry, "script-local names and values do not match");
  for (const [pc, { op }] of program.instructions.entries()) {
    if ("target" in op && (op.target < program.entry || op.target + 1 >= program.end))
      fail(pc, "target label has no instruction inside the program range");
    if ((op.kind === "calc" || op.kind === "branch") &&
        (op.index >= program.localNames.length || op.right.kind === "local" && op.right.index >= program.localNames.length))
      fail(pc, "script-local index is outside the declared bank");
    if (op.kind === "sync-ai" && program.localNames.length === 0)
      fail(pc, "SyncBattleAI requires ScriptLocalVariable[0]");
  }
  return program;
}

export function assertBattleEventExecutable(program: BattleEventProgram): void {
  const parsed = parseBattleEventProgram(program);
  if (parsed.blockers.length)
    throw new BattleEventError(parsed.source, parsed.entry, parsed.blockers.join("; "));
  for (const [pc, { op }] of parsed.instructions.entries())
    if (op.kind === "blocked") throw new BattleEventError(parsed.source, pc, op.reason);
}

export function createBattleEventState(program: BattleEventProgram): BattleEventState {
  assertBattleEventExecutable(program);
  return {
    pc: program.entry,
    stack: [],
    locals: [...program.initialLocals],
    status: "running",
    wait: null,
    clock: null,
    clockInstructions: 0,
  };
}

/** A Web safety bound, not a claim about the native interpreter's capacity. It
 * spans all request/resume segments in one host clock, preventing an Exec loop
 * from evading the same protection as a purely local Jump loop. */
export const BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT = 4096;
const clockNumber = (raw: unknown) => integer(raw, 0, Number.MAX_SAFE_INTEGER);
function parseWait(raw: unknown): BattleEventWait | null {
  if (raw === null) return null;
  checkpointRecord(raw);
  const value = raw as Record<string, unknown>, kind = value.kind;
  if (kind === "blank" || kind === "start" || kind === "action") {
    checkpointKeys(value, "kind,clock");
    return { kind, clock: clockNumber(value.clock) };
  }
  if (kind === "time") {
    checkpointKeys(value, "kind,clock,entryTimeSeconds");
    return { kind, clock: clockNumber(value.clock), entryTimeSeconds: finite(value.entryTimeSeconds, 0) };
  }
  throw new Error("Invalid battle event wait kind");
}
function parseState(raw: unknown): BattleEventState {
  const value = record(raw, "pc,stack,locals,status,wait,clock,clockInstructions"), status = value.status;
  if (status !== "running" && status !== "waiting" && status !== "exited")
    throw new Error("Invalid battle event status");
  return { pc: integer(value.pc), stack: array(value.stack, value => integer(value)), locals: array(value.locals, int32),
    status, wait: parseWait(value.wait), clock: value.clock === null ? null : clockNumber(value.clock),
    clockInstructions: integer(value.clockInstructions, 0, BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT) };
}
function parseContext(raw: unknown): BattleEventContext {
  const value = record(raw, "clock,timeSeconds,started,aiCoreAlive,actionStaging");
  return { clock: clockNumber(value.clock), timeSeconds: finite(value.timeSeconds, 0),
    started: boolean(value.started), aiCoreAlive: boolean(value.aiCoreAlive), actionStaging: boolean(value.actionStaging) };
}

/** Advance one source clock until it yields, exits, or needs the battle host.
 * No callback runs here. A thrown error leaves the input state untouched. The
 * host must transact all returned requests and resumed segments in its tick. */
export function advanceBattleEvent(
  program: BattleEventProgram,
  current: BattleEventState,
  context: BattleEventContext,
): BattleEventAdvance {
  let failurePc = current.pc;
  const fail = (reason: string, pc = failurePc): never => {
    throw new BattleEventError(program.source, pc, reason);
  };
  const guarded = <T>(operation: () => T): T => {
    try { return operation(); }
    catch (error) {
      if (error instanceof BattleEventError) throw error;
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
  guarded(() => assertBattleEventExecutable(program));
  const state = guarded(() => parseState(current));
  context = guarded(() => parseContext(context));
  const inRange = (pc: number) => pc >= program.entry && pc < program.end;
  if (state.locals.length !== program.initialLocals.length)
    fail("script-local state does not match the declared bank");
  if (state.stack.some((pc) => !inRange(pc))) fail("Call stack leaves the program range");
  if ((state.status === "waiting") !== (state.wait !== null)) fail("inconsistent event wait state");
  if (state.clock === null && (state.clockInstructions !== 0 || state.wait !== null))
    fail("unclocked event has a continuation");
  if (state.clock !== null && context.clock < state.clock) fail("host clock moved backwards");
  if (state.wait && state.wait.clock !== state.clock) fail("wait and event clocks disagree");
  if (state.status === "exited") {
    if (state.pc <= program.entry || state.pc > program.end || program.instructions[state.pc - 1]?.op.kind !== "exit")
      fail("exited event has no matching Exit");
    return { state, requests: [], visited: [] };
  }
  if (!inRange(state.pc)) fail("PC outside the program range");
  if (state.wait) {
    const expected = { blank: "blank", start: "wait-start", action: "sync-action", time: "wait" }[state.wait.kind];
    if (program.instructions[state.pc]?.op.kind !== expected) fail("wait does not match its instruction");
    if (state.wait.clock === context.clock) return { state, requests: [], visited: [] };
  }
  if (state.clock !== context.clock) {
    state.clock = context.clock;
    state.clockInstructions = 0;
  }
  const requests: BattleEventRequest[] = [], visited: number[] = [];
  const result = (): BattleEventAdvance => ({ state, requests, visited });
  const next = () => { state.pc++; state.status = "running"; state.wait = null; };
  const yieldClock = (kind: "blank" | "start" | "action") => {
    state.status = "waiting";
    state.wait = { kind, clock: context.clock };
    return result();
  };
  const local = (index: number): number => {
    guarded(() => int32(index));
    const value = state.locals[index];
    if (index < 0 || value === undefined) return fail("script-local index outside the current bank", state.pc);
    return value;
  };
  const value = (operand: BattleEventValue) => operand.kind === "immediate"
    ? guarded(() => int32(operand.value)) : local(operand.index);
  const jump = (target: number) => {
    if (!inRange(target) || !inRange(target + 1)) fail("jump leaves the program range", state.pc);
    state.pc = target + 1;
    state.status = "running";
    state.wait = null;
  };
  const seen = new Set<string>();
  while (true) {
    if (!inRange(state.pc)) fail("PC outside the program range; no implicit Exit", state.pc);
    const signature = JSON.stringify([state.pc, state.stack, state.locals, state.wait]);
    if (seen.has(signature)) fail("event repeats without yielding or making progress", state.pc);
    seen.add(signature);
    if (state.clockInstructions >= BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT)
      fail("event exceeded the Web instruction budget for one host clock", state.pc);
    state.clockInstructions++;
    const pc = state.pc, op = program.instructions[pc]!.op;
    failurePc = pc;
    visited.push(pc);
    switch (op.kind) {
      case "nop": next(); break;
      case "exit": next(); state.status = "exited"; return result();
      case "jump": jump(op.target); break;
      case "call":
        if (!inRange(pc + 1)) fail("Call has no return instruction", pc);
        state.stack.push(pc + 1);
        jump(op.target);
        break;
      case "return": {
        const target = state.stack.pop();
        if (target === undefined) fail("Return has no matching Call", pc);
        state.pc = target!;
        state.status = "running";
        state.wait = null;
        break;
      }
      case "calc":
        state.locals[op.index] = guarded(() => integerOperation(local(op.index), op.operator, value(op.right)));
        next();
        break;
      case "branch": {
        const condition = guarded(() => integerOperation(local(op.index), op.operator, value(op.right)));
        // Internal.Main.ComparisonOperation callback 0x2ca840 branches only
        // for exactly 1, including when authored with an arithmetic operator.
        if (condition === 1) jump(op.target); else next();
        break;
      }
      case "sync-ai":
        local(0);
        state.locals[0] = Number(!context.aiCoreAlive);
        next();
        // The host commits the same pure alive projection used for context:
        // retiring ended AI cores and disabling progress are not VM-local.
        requests.push({ kind: "sync-ai", pc });
        return result();
      case "wait-start":
        if (!context.started) return yieldClock("start");
        next();
        break;
      case "sync-action":
        if (context.actionStaging) return yieldClock("action");
        next();
        break;
      case "exec-ai":
        next();
        requests.push({ kind: "exec-ai", pc });
        return result();
      case "end-enabled": case "pause": case "interactive":
        next();
        requests.push({ kind: op.kind, enabled: op.enabled, pc });
        return result();
      case "blank":
        if (state.wait?.kind !== "blank") return yieldClock("blank");
        next();
        break;
      case "wait":
        if (state.wait?.kind !== "time") {
          // Internal.Wait always records the entry time and repeats once,
          // including finite zero or negative source durations.
          state.status = "waiting";
          state.wait = { kind: "time", clock: context.clock, entryTimeSeconds: context.timeSeconds };
          return result();
        }
        if (context.timeSeconds < state.wait.entryTimeSeconds)
          return fail("host time moved before Wait entry", pc);
        if (context.timeSeconds - state.wait.entryTimeSeconds < op.seconds) {
          state.wait.clock = context.clock;
          return result();
        }
        next();
        break;
      case "blocked":
        return fail(op.reason, pc);
    }
  }
}
