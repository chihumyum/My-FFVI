/** Conditions whose source behavior controls actions or owns a countdown.
 * Identity lists remain on BattleGame's combatants. These definitions do not
 * grant an automatic-action provider, elapsed time or active field behavior. */
type ControlConditionBase = { id: number; name: string; untilValue: number };
export type SleepBehavior = ControlConditionBase & { kind: "sleep"; untilType: 9 };
export type ConfusionBehavior = ControlConditionBase & { kind: "confusion"; untilType: 8 };
export type TemptationBehavior = ControlConditionBase & { kind: "temptation"; untilType: 17 };
export type DoomBehavior = ControlConditionBase & {
  kind: "doom";
  untilType: 2;
  /** Complete original DoomConditionFunction static predicate array. */
  pauseConditionTypes: readonly number[];
};
export type ControlConditionBehavior = SleepBehavior | ConfusionBehavior | TemptationBehavior | DoomBehavior;

export const controlConditionTypes = { sleep: 7, confusion: 12, temptation: 630, doom: 404 } as const;

export function validateControlBehavior(behavior: ControlConditionBehavior): void {
  if (!behavior || !Number.isInteger(behavior.id) || behavior.id < 1 || behavior.id > 0x7fffffff ||
      typeof behavior.name !== "string" || !Number.isInteger(behavior.untilValue) ||
      behavior.untilValue < 0 || behavior.untilValue > 0x7fffffff)
    throw new Error("Invalid action-control condition definition");
  const until = { sleep: 9, confusion: 8, temptation: 17, doom: 2 } as const;
  if (!Object.hasOwn(until, behavior.kind) || behavior.untilType !== until[behavior.kind] ||
      (behavior.kind === "temptation" ? behavior.untilValue !== 0 : behavior.untilValue < 1))
    throw new Error("Unsupported action-control condition lifecycle");
  if (behavior.kind === "doom" && (!Array.isArray(behavior.pauseConditionTypes) ||
      !behavior.pauseConditionTypes.length || behavior.pauseConditionTypes.some(type =>
        !Number.isInteger(type) || type < 0 || type > 0x7fffffff) ||
      new Set(behavior.pauseConditionTypes).size !== behavior.pauseConditionTypes.length))
    throw new Error("Doom requires its exact admitted pause-condition types");
}

/** Battle-local function fields, never a second condition/resource owner. */
export type ControlRecoveryState = {
  conditionId: number;
  elapsedSeconds: number;
  physicalHits: number;
  targetedUnitId: string | null;
};
export type DoomClockState = {
  conditionId: number;
  firstUpdate: boolean;
  remainingCount: number;
  progressSeconds: number;
  dead: boolean;
};

function integer(value: number, min: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > 0x7fffffff) throw new Error("Invalid " + label);
}
function seconds(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || Math.fround(value) !== value) throw new Error("Invalid " + label);
}
export function validateControlRecoveryState(behavior: ControlConditionBehavior, state: Readonly<ControlRecoveryState>): void {
  validateControlBehavior(behavior);
  if (!state || state.conditionId !== behavior.id ||
      !(state.targetedUnitId === null || typeof state.targetedUnitId === "string" && state.targetedUnitId.length > 0))
    throw new Error("Action-control recovery identity mismatch");
  integer(state.physicalHits, 0, "condition physical hit count"); seconds(state.elapsedSeconds, "condition recovery elapsed");
  if (behavior.kind === "temptation" && state.targetedUnitId === null)
    throw new Error("Temptation requires its captured LastTargetedUnit identity");
}
export function createControlRecoveryState(behavior: ControlConditionBehavior, targetedUnitId: string | null): ControlRecoveryState {
  const state = { conditionId: behavior.id, elapsedSeconds: 0, physicalHits: 0, targetedUnitId };
  validateControlRecoveryState(behavior, state); return state;
}

/** UpdateCondtitonRecovery 0x45c5b0, only the independently bound Until8/9/17
 * branches. The caller supplies the actual FF6 duration delta and counted hit
 * events; this function does not infer them from HP, frame time or a name. */
export function projectControlRecovery(behavior: ControlConditionBehavior, state: Readonly<ControlRecoveryState>, input: {
  progress: boolean;
  /** Actual BattleConditionFunction normalAttackAddConditions membership.
   * This source exclusion precedes the shared random/time update. */
  normalAttackAdded: boolean;
  durationSeconds: number;
  targetedUnitGameOver: boolean | null;
}, randomInt: (min: number, max: number) => number): {
  state: ControlRecoveryState;
  naturalRemovals: ("physical-hit" | "elapsed-time" | "targeted-unit-game-over")[];
} {
  validateControlRecoveryState(behavior, state);
  if (!input || typeof input.progress !== "boolean" || typeof input.normalAttackAdded !== "boolean" ||
      !(input.targetedUnitGameOver === null || typeof input.targetedUnitGameOver === "boolean") ||
      typeof randomInt !== "function") throw new Error("Invalid condition recovery context");
  seconds(input.durationSeconds, "condition recovery duration");
  const next = { ...state }, naturalRemovals: ("physical-hit" | "elapsed-time" | "targeted-unit-game-over")[] = [];
  if (input.normalAttackAdded) return { state: next, naturalRemovals };
  if (input.progress) {
    // The native common wrapper consumes this draw even for Until8/9/17,
    // whose own branches do not inspect it. Use the one existing battle RNG.
    const draw = randomInt(0, 100); integer(draw, 0, "condition recovery draw");
    if (draw > 100) throw new Error("Condition recovery draw out of range");
    next.elapsedSeconds = Math.fround(state.elapsedSeconds + input.durationSeconds);
    seconds(next.elapsedSeconds, "condition recovery elapsed");
  }
  if (behavior.untilType === 8 && next.physicalHits >= behavior.untilValue) naturalRemovals.push("physical-hit");
  if (behavior.untilType === 9) {
    if (next.physicalHits > 0) naturalRemovals.push("physical-hit");
    // fVar24 is the local zero when progress is false, not the saved bank.
    if (input.progress && next.elapsedSeconds > behavior.untilValue) naturalRemovals.push("elapsed-time");
  }
  if (behavior.untilType === 17) {
    if (input.targetedUnitGameOver === null) throw new Error("Unknown targeted-unit game-over state");
    if (input.targetedUnitGameOver) naturalRemovals.push("targeted-unit-game-over");
  }
  return { state: next, naturalRemovals };
}

export function createDoomClock(behavior: DoomBehavior): DoomClockState {
  validateControlBehavior(behavior);
  return { conditionId: behavior.id, firstUpdate: true, remainingCount: 0, progressSeconds: 0, dead: false };
}
export function validateDoomClock(behavior: DoomBehavior, state: Readonly<DoomClockState>): void {
  validateControlBehavior(behavior);
  if (!state || state.conditionId !== behavior.id || typeof state.firstUpdate !== "boolean" || typeof state.dead !== "boolean")
    throw new Error("Invalid Doom clock identity");
  integer(state.remainingCount, 0, "remaining Doom count"); seconds(state.progressSeconds, "Doom progress");
  if (state.remainingCount > behavior.untilValue ||
      state.firstUpdate && (state.remainingCount !== 0 || state.progressSeconds !== 0))
    throw new Error("Doom first-update state mismatch");
}

/** Doom.Update 0x6aeeb0: one decrement per update with retained overshoot.
 * Reaching zero returns first; the following update may request death when
 * no action is staging. The owning BattleGame must execute the exact source
 * non-undead/undead branch atomically before marking the request complete. */
export function projectDoomClock(behavior: DoomBehavior, state: Readonly<DoomClockState>, input: {
  conditionTypes: readonly number[];
  seconds: number;
  actionStaging: boolean;
}): { state: DoomClockState; requestsDeath: boolean } {
  validateDoomClock(behavior, state);
  if (!input || !Array.isArray(input.conditionTypes) || typeof input.actionStaging !== "boolean")
    throw new Error("Invalid Doom update context");
  for (const type of input.conditionTypes) integer(type, 0, "Doom current condition type");
  seconds(input.seconds, "Doom time");
  const next = { ...state };
  if (next.dead || behavior.pauseConditionTypes.some(type => input.conditionTypes.includes(type)))
    return { state: next, requestsDeath: false };
  if (input.conditionTypes.includes(5)) return { state: { ...next, dead: true }, requestsDeath: false };
  if (next.firstUpdate) { next.remainingCount = behavior.untilValue; next.firstUpdate = false; }
  const cycle = input.conditionTypes.includes(15) ? Math.fround(1.3333334) : input.conditionTypes.includes(16) ? 4 : 2;
  next.progressSeconds = Math.fround(next.progressSeconds + input.seconds);
  seconds(next.progressSeconds, "Doom progress");
  if (next.remainingCount > 0) {
    if (next.progressSeconds >= cycle) {
      next.remainingCount--;
      next.progressSeconds = Math.fround(next.progressSeconds - cycle);
    }
    return { state: next, requestsDeath: false };
  }
  return { state: next, requestsDeath: !input.actionStaging };
}
