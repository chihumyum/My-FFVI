/** Normal-action BattleAI control flow. Counter/interrupt triggers are separate
 * capabilities; an unknown instruction is never an implicit fallthrough. */
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
  | { kind: "start-table"; tableId: number | null }
  | { kind: "act"; abilities: number[]; weights: number[] }
  | { kind: "blocked"; reason: string };
export type BattleAIInstruction = { mnemonic: string; op: BattleAIOp };
export type BattleAIProgram = {
  kind: "battle-ai-normal-v1";
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
};
export type BattleAIContext = {
  conditionIds: readonly number[];
  /** Native IsLevelCheck includes fallen units. */
  players: readonly { level: number }[];
  enemies: readonly { level: number }[];
};
export type BattleAIAct = {
  pc: number;
  abilities: number[];
  weights: number[];
  selected: boolean;
};
export type BattleAITurn = {
  state: BattleAIState;
  acts: BattleAIAct[];
  visited: number[];
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
  normalReady: boolean,
): BattleAITurn {
  const state = { ...current },
    acts: BattleAIAct[] = [],
    visited: number[] = [];
  const fail = (reason: string): never => {
    throw new BattleAIError(program.source, state.pc, reason);
  };
  if (program.kind !== "battle-ai-normal-v1") fail("unsupported AI format");
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
  if (normalReady) {
    if (
      state.status !== "waiting" ||
      program.instructions[state.pc]?.op.kind !== "sync"
    )
      fail("normal readiness requires a suspended SyncAI");
    state.pc++;
    state.status = "running";
  } else if (state.status !== "running") fail("invalid AI initialization");
  // No admitted instruction changes branch inputs within a route. Revisiting
  // a PC therefore cannot reach a new SyncAI; fail instead of hanging a frame.
  const seen = new Set<number>();
  while (true) {
    if (state.pc < program.entry || state.pc >= program.end)
      fail("PC outside program segment");
    if (seen.has(state.pc)) fail("cycle without SyncAI");
    seen.add(state.pc);
    visited.push(state.pc);
    const op = program.instructions[state.pc]!.op;
    switch (op.kind) {
      case "blocked":
        fail(op.reason);
      case "sync":
        state.status = "waiting";
        return { state, acts, visited };
      case "exit":
        state.status = "exited";
        return { state, acts, visited };
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
            pc: state.pc,
            abilities: [...op.abilities],
            weights: [...op.weights],
            selected: state.actTurn === state.turnCounter,
          });
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
    },
    context,
    false,
  ).state;
}
export function planBattleAITurn(
  program: BattleAIProgram,
  state: BattleAIState,
  context: BattleAIContext,
) {
  return route(program, state, context, true);
}

export type BattleAIRandom = {
  integer: (minimum: number, maximum: number) => number;
  /** Native float Range admits both endpoints. RNG algorithm remains host-owned. */
  float: (minimum: number, maximum: number) => number;
};
export function drawBattleAIAbility(act: BattleAIAct, random: BattleAIRandom) {
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
