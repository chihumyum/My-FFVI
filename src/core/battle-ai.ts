/** Source BattleAI control flow. Readiness is supplied by the battle scheduler;
 * an unknown instruction is never an implicit fallthrough. */
import {
  copyEnemyBehavior,
  enemyVariableCount,
  type EnemyBehaviorState,
} from "./enemy-behavior.js";
import { integerOperation, int32, type Operator } from "./script-integer.js";

export type BattleAISource = {
  sourceSetHash: string;
  battleSourceSetHash: string;
  file: string;
  sha256: string;
  assetPath: string;
  serializedFile: string;
  objectId: string;
};
export type BattleAIOp =
  | { kind: "nop" | "sync" | "exit" | "end-table" }
  | { kind: "jump"; target: number }
  | { kind: "condition"; conditionId: number; target: number }
  | { kind: "level"; side: "player" | "enemy"; minimum: number; target: number }
  | { kind: "variable-assign"; index: number; value: number }
  | { kind: "variable-calc"; index: number; value: number; operator: Operator }
  | {
      kind: "variable-branch";
      index: number;
      value: number;
      operator: Operator;
      target: number;
    }
  | {
      kind: "resource-branch";
      resource: "hp" | "mp";
      value: number;
      operator: Operator;
      target: number;
    }
  | { kind: "mode-count" }
  | { kind: "mode-set"; value: number }
  | { kind: "mode-branch"; value: number; equal: boolean; target: number }
  | { kind: "start-table"; tableId: number | null }
  | { kind: "act" | "counter-act"; abilities: number[]; weights: number[] }
  | { kind: "loop-act"; abilities: number[]; counts: number[] }
  | { kind: "blocked"; reason: string };
export type BattleAIInstruction = { mnemonic: string; op: BattleAIOp };
export type BattleAIProgram = {
  kind: "battle-ai-v4";
  source: BattleAISource | null;
  entry: number;
  end: number;
  instructions: BattleAIInstruction[];
  blockers: string[];
};
export type BattleAIState = {
  pc: number;
  status: "running" | "waiting" | "exited";
  tableId: number;
  actTurn: number;
  turnCounter: number;
  /** Native action-controller accounting, separate from the action-table row. */
  advancedActCount: number;
  guardianActIsDadaluma: boolean;
};
export type BattleAIContext = {
  self: {
    hp: number;
    mp: number;
    monsterId: number;
    behavior: EnemyBehaviorState;
  };
  conditionIds: readonly number[];
  /** Native IsLevelCheck includes fallen units. */
  players: readonly { level: number }[];
  enemies: readonly { level: number }[];
};
export type BattleAIAct = {
  pc: number;
  selected: boolean;
} & (
  | { kind: "act" | "counter-act"; abilities: number[]; weights: number[] }
  | { kind: "loop-act"; abilities: number[]; counts: number[] }
);
export type BattleAITurn = {
  trigger: "initial" | "normal" | "reaction";
  state: BattleAIState;
  behavior: EnemyBehaviorState;
  acts: BattleAIAct[];
  visited: number[];
};
export type BattleAIReaction = {
  /** A missed/Non calculation wakes received-ability AI, without counter readiness. */
  counterReady: boolean;
  receivedSystemId: number;
};
export class BattleAIError extends Error {
  constructor(
    readonly source: BattleAISource | null,
    readonly pc: number,
    reason: string,
  ) {
    super(
      `Battle AI ${source?.assetPath ?? "synthetic"}#/Mnemonics/${pc}: ${reason}`,
    );
    this.name = "BattleAIError";
  }
}

/** Build a deterministic route without drawing RNG or mutating live state.
 * The caller must admit every ability on this reached route before committing
 * a decision. This conservatively checks future rows of the same action table. */
function route(
  program: BattleAIProgram,
  current: BattleAIState,
  context: BattleAIContext,
  wake: "initial" | "normal" | BattleAIReaction,
): BattleAITurn {
  const normalReady = wake === "normal";
  const trigger = typeof wake === "string" ? wake : "reaction";
  const state = { ...current },
    acts: BattleAIAct[] = [],
    visited: number[] = [];
  const fail = (reason: string): never => {
    throw new BattleAIError(program.source, state.pc, reason);
  };
  const guarded = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
  const behavior = guarded(() => copyEnemyBehavior(context.self.behavior));
  guarded(() => int32(state.advancedActCount));
  if (typeof state.guardianActIsDadaluma !== "boolean")
    fail("invalid action-controller loop state");
  const variableIndex = (index: number) => {
    guarded(() => int32(index));
    // Native operands <= 0 address the first cell, not a field variable bank.
    if (index >= enemyVariableCount) fail("enemy variable index out of bounds");
    return Math.max(0, index);
  };
  const calculate = (left: number, operator: Operator, right: number) =>
    guarded(() => integerOperation(left, operator, right));
  if (program.kind !== "battle-ai-v4") fail("unsupported AI format");
  if (typeof wake !== "string") {
    guarded(() => int32(wake.receivedSystemId));
    if (wake.receivedSystemId < 0 || typeof wake.counterReady !== "boolean")
      fail("invalid reaction readiness");
  }
  if (program.blockers.length) fail(program.blockers.join("; "));
  if (
    !Number.isInteger(program.entry) ||
    !Number.isInteger(program.end) ||
    program.entry < 0 ||
    program.end <= program.entry ||
    program.end > program.instructions.length
  )
    fail("invalid program segment");
  if (state.status === "exited") fail("AI already exited");
  if (wake !== "initial") {
    if (
      state.status !== "waiting" ||
      program.instructions[state.pc]?.op.kind !== "sync"
    )
      fail("AI readiness requires a suspended SyncAI");
    state.pc++;
    state.status = "running";
  } else if (state.status !== "running") fail("invalid AI initialization");
  // A variable loop can revisit a PC and still make progress. Detect recurring
  // control/parameter states, and bound growing loops independently. This is a
  // host safety limit, not an inferred original-game instruction budget.
  const seen = new Set<string>();
  while (true) {
    if (state.pc < program.entry || state.pc >= program.end)
      fail("PC outside program segment");
    const signature = JSON.stringify([
      state.pc,
      state.tableId,
      state.actTurn,
      state.turnCounter,
      state.advancedActCount,
      state.guardianActIsDadaluma,
      behavior.mode,
      behavior.variables,
    ]);
    if (seen.has(signature)) fail("cycle without SyncAI");
    if (visited.length >= 10000)
      fail("AI route exceeded host instruction budget before SyncAI");
    seen.add(signature);
    visited.push(state.pc);
    const op = program.instructions[state.pc]!.op;
    switch (op.kind) {
      case "blocked":
        fail(op.reason);
      case "sync":
        state.status = "waiting";
        return { trigger, state, behavior, acts, visited };
      case "exit":
        state.status = "exited";
        return { trigger, state, behavior, acts, visited };
      case "jump":
        // The instruction sets the source label address, then Core.Clock's
        // ForwardStep advances once. Do not execute the label instruction.
        state.pc = op.target + 1;
        continue;
      case "condition":
        if (context.conditionIds.includes(op.conditionId)) {
          state.pc = op.target + 1;
          continue;
        }
        break;
      case "level": {
        const units = op.side === "player" ? context.players : context.enemies;
        if (units.some((u) => !Number.isInteger(u.level) || u.level < 0))
          fail("invalid unit level");
        if (normalReady && units.some((u) => u.level >= op.minimum)) {
          state.pc = op.target + 1;
          continue;
        }
        break;
      }
      case "variable-assign":
        behavior.variables[variableIndex(op.index)] = guarded(() =>
          int32(op.value),
        );
        break;
      case "variable-calc": {
        const index = variableIndex(op.index);
        behavior.variables[index] = calculate(
          behavior.variables[index]!,
          op.operator,
          op.value,
        );
        break;
      }
      case "variable-branch":
        if (
          calculate(
            behavior.variables[variableIndex(op.index)]!,
            op.operator,
            op.value,
          ) === 1
        ) {
          state.pc = op.target + 1;
          continue;
        }
        break;
      case "resource-branch":
        if (calculate(context.self[op.resource], op.operator, op.value) === 1) {
          state.pc = op.target + 1;
          continue;
        }
        break;
      case "mode-count":
        behavior.mode = (behavior.mode + 1) | 0;
        break;
      case "mode-set":
        behavior.mode = guarded(() => int32(op.value));
        break;
      case "mode-branch":
        if ((behavior.mode === op.value) === op.equal) {
          state.pc = op.target + 1;
          continue;
        }
        break;
      case "start-table":
        if (op.tableId !== null && state.tableId !== op.tableId) {
          state.tableId = op.tableId;
          state.actTurn = 0;
        }
        state.turnCounter = 0;
        break;
      case "act":
        if (normalReady) {
          acts.push({
            kind: "act",
            pc: state.pc,
            abilities: [...op.abilities],
            weights: [...op.weights],
            selected: state.actTurn === state.turnCounter,
          });
          state.turnCounter++;
        }
        break;
      case "counter-act":
        // CounterAct 0x81fd50 uses counter readiness, living HP and received
        // ability SYSTEM ID. It neither reads nor advances a normal table row.
        if (
          typeof wake !== "string" &&
          wake.counterReady &&
          context.self.hp > 0 &&
          ![2, 5].includes(wake.receivedSystemId)
        )
          acts.push({
            kind: "counter-act",
            pc: state.pc,
            selected: true,
            abilities: [...op.abilities],
            weights: [...op.weights],
          });
        break;
      case "loop-act":
        if (normalReady) {
          guarded(() => validateBattleAILoop(op));
          const selected = state.actTurn === state.turnCounter;
          acts.push({
            kind: "loop-act",
            pc: state.pc,
            abilities: [...op.abilities],
            counts: [...op.counts],
            selected,
          });
          if (selected) {
            const id = guarded(() => int32(context.self.monsterId));
            if (id <= 0) fail("invalid source monster identity for LoopAct");
            const count = op.counts.reduce((sum, n) => (sum + n) | 0, 0);
            // FF6 AddAdvancedActCounter: the constructor starts this flag true.
            // 0x113 is a source monster rule, not an encounter/template ID.
            if (!state.guardianActIsDadaluma) {
              state.advancedActCount = (state.advancedActCount + count) | 0;
              state.guardianActIsDadaluma = true;
            } else if (id === 0x113) {
              state.advancedActCount =
                (state.advancedActCount + Math.imul(count, 2)) | 0;
              state.guardianActIsDadaluma = false;
            }
          }
          state.turnCounter++;
        }
        break;
      case "end-table":
        if (normalReady)
          state.actTurn =
            state.actTurn + 1 < state.turnCounter ? state.actTurn + 1 : 0;
        break;
      case "nop":
        break;
      default:
        fail("unsupported compiled AI instruction");
    }
    state.pc++;
  }
}

export function startBattleAI(
  program: BattleAIProgram,
  context: BattleAIContext,
) {
  return route(
    program,
    {
      pc: program.entry,
      status: "running",
      tableId: 0,
      actTurn: 0,
      turnCounter: 0,
      advancedActCount: 0,
      guardianActIsDadaluma: true,
    },
    context,
    "initial",
  );
}
export function planBattleAITurn(
  program: BattleAIProgram,
  state: BattleAIState,
  context: BattleAIContext,
) {
  return route(program, state, context, "normal");
}
export function planBattleAIReaction(
  program: BattleAIProgram,
  state: BattleAIState,
  context: BattleAIContext,
  reaction: BattleAIReaction,
) {
  return route(program, state, context, reaction);
}

export type BattleAIRandom = {
  integer: (minimum: number, maximum: number) => number;
  /** Native float Range admits both endpoints. RNG algorithm remains host-owned. */
  float: (minimum: number, maximum: number) => number;
};
export function drawBattleAIAbility<
  T extends { abilities: number[]; weights: number[] },
>(act: T, random: BattleAIRandom) {
  if (
    !act.abilities.length ||
    act.abilities.some((id) => !Number.isInteger(id) || id <= 0)
  )
    throw new Error("Invalid AI ability list");
  if (!act.weights.length) {
    const index = random.integer(0, act.abilities.length - 1);
    if (!Number.isInteger(index) || index < 0 || index >= act.abilities.length)
      throw new Error("Invalid AI integer draw");
    return act.abilities[index]!;
  }
  const weights = act.weights.map(Math.fround);
  if (
    weights.length !== act.abilities.length ||
    weights.some((w) => !Number.isFinite(w) || w < 0)
  )
    throw new Error("Invalid AI weights");
  // This build's Enumerable.Sum(float) uses float32 addition at each step.
  const total = weights.reduce((sum, w) => Math.fround(sum + w), 0);
  if (!Number.isFinite(total) || total <= 0)
    throw new Error("Invalid AI weight total");
  const draw = random.float(0, total);
  if (!Number.isFinite(draw) || draw < 0 || draw > total)
    throw new Error("Invalid AI float draw");
  let remaining = Math.fround(draw);
  for (let index = 0; index < weights.length; index++) {
    remaining = Math.fround(remaining - weights[index]!);
    if (remaining < 0) return act.abilities[index]!;
  }
  return act.abilities.at(-1)!;
}

/** The importer admits paired int32 repeat counts. No probability draw belongs
 * to LoopAct, including an unselected row. Expansion is separately host-bounded. */
function validateBattleAILoop(act: { abilities: number[]; counts: number[] }) {
  if (
    !act.abilities.length ||
    act.abilities.length !== act.counts.length ||
    new Set(act.abilities).size !== act.abilities.length ||
    act.abilities.some(
      (id) => !Number.isInteger(id) || id <= 0 || id > 0x7fffffff,
    ) ||
    act.counts.some(
      (n) => !Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff,
    )
  )
    throw new Error("Invalid AI loop operands");
}

export function selectBattleAIAbilities(
  act: BattleAIAct,
  random: BattleAIRandom,
): number[] {
  if (act.kind !== "loop-act") {
    // Native Act consumes its draw even when another table row is selected.
    const id = drawBattleAIAbility(act, random);
    return act.selected ? [id] : [];
  }
  validateBattleAILoop(act);
  if (!act.selected) return [];
  const total = act.counts.reduce((sum, n) => sum + Math.max(0, n), 0);
  if (total > 1000) throw new Error("AI loop exceeded host action budget");
  return act.abilities.flatMap(
    (id, index) => Array(Math.max(0, act.counts[index]!)).fill(id) as number[],
  );
}
