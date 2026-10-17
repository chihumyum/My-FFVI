/** Condition types, not master row IDs. Heist is the native class spelling. */
export const hasteConditionType = 15;
export const slowConditionType = 16;

export type SpeedBehavior = {
  id: number;
  kind: "haste" | "slow";
  name: string;
  untilType: 2;
  /** Heist.Start stores RateValue1; Slow.Start stores its integer negation. */
  speedDelta: number;
};

/** Slow.Update has a battle-local elapsed field even though ordinary until2
 * does not use it to expire the condition. It is not an ATB multiplier. */
export type SlowState = { conditionId: number; elapsedSeconds: number }[];

function integer(value: number, minimum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error(`Invalid ${label}`);
}

export function validateSpeedBehavior(behavior: SpeedBehavior): void {
  integer(behavior.id, 1, "speed condition identity");
  if (
    (behavior.kind !== "haste" && behavior.kind !== "slow") ||
    behavior.untilType !== 2 ||
    typeof behavior.name !== "string" ||
    !behavior.name ||
    !Number.isInteger(behavior.speedDelta) ||
    Math.abs(behavior.speedDelta) < 1 ||
    Math.abs(behavior.speedDelta) > 0x7fffffff ||
    (behavior.kind === "haste") !== (behavior.speedDelta > 0)
  )
    throw new Error("Invalid speed condition behavior");
}

function definitions(behaviors: readonly SpeedBehavior[]) {
  const result = new Map<number, SpeedBehavior>();
  for (const behavior of behaviors) {
    validateSpeedBehavior(behavior);
    if (result.has(behavior.id)) throw new Error("Duplicate speed condition definition");
    result.set(behavior.id, behavior);
  }
  return result;
}

function active(
  all: ReadonlyMap<number, SpeedBehavior>,
  conditionIds: readonly number[],
) {
  const seen = new Set<number>();
  return conditionIds.flatMap((id) => {
    integer(id, 1, "active condition identity");
    const definition = all.get(id);
    if (!definition) return [];
    if (seen.has(id)) throw new Error("Duplicate active speed condition");
    seen.add(id);
    return [definition];
  });
}

/** ATBCalc 0x675950 sums IATBSpeedDiameter instances, starting at 100.
 * The existing atbIncrement owns the source upper/lower clamps. The caller
 * first validates all active identities; this module owns only speed providers. */
export function conditionAtbSpeedPercent(
  behaviors: readonly SpeedBehavior[],
  conditionIds: readonly number[],
): number {
  let result = 100;
  for (const behavior of active(definitions(behaviors), conditionIds)) {
    result += behavior.speedDelta;
    if (result < -0x80000000 || result > 0x7fffffff)
      throw new Error("Unsupported ATB condition sum overflow");
  }
  return result;
}

function validateTypes(conditionTypes: readonly number[]) {
  for (const type of conditionTypes) integer(type, 0, "confirmed condition type");
}

/** GetChantingTime 0x6765d0 checks presence, not RateValue1 or multiplicity.
 * Both types together yield one. The host computes this only on act admission;
 * later status changes do not recalculate an already stored chanting duration. */
export function conditionChantingModifier(conditionTypes: readonly number[]): number {
  validateTypes(conditionTypes);
  let result = conditionTypes.includes(hasteConditionType) ? 2 : 1;
  if (conditionTypes.includes(slowConditionType)) result = Math.fround(result * 0.5);
  return result;
}

/** GetProgressCycleCoefficient 0x766a00 / CalcATBProgressCycleForVital(unit,1)
 * 0x7620e0. Haste wins when both types exist; this is intentionally different
 * from the chanting product and additive ATB percentages. It neither admits
 * unknown conditions nor implements Stop, Quick, or other cycle callers. */
export function conditionProgressCycleSeconds(
  conditionTypes: readonly number[],
  atbSpeed: number,
): number {
  validateTypes(conditionTypes);
  const coefficient = conditionTypes.includes(hasteConditionType)
    ? 8
    : conditionTypes.includes(slowConditionType) ? 32 : 16;
  const speed = Math.fround(atbSpeed);
  const result = Math.fround(coefficient / speed);
  if (!Number.isFinite(atbSpeed) || !Number.isFinite(speed) || speed <= 0 ||
      !Number.isFinite(result) || result <= 0)
    throw new Error("Invalid condition cycle ATB speed");
  return result;
}

function validateState(
  all: ReadonlyMap<number, SpeedBehavior>,
  state: Readonly<SlowState>,
) {
  if (!Array.isArray(state)) throw new Error("Invalid slow clock state");
  const result = new Map<number, SlowState[number]>();
  for (const clock of state) {
    if (!clock || typeof clock !== "object" || Array.isArray(clock) ||
        Object.keys(clock).length !== 2 || all.get(clock.conditionId)?.kind !== "slow" ||
        result.has(clock.conditionId) || !Number.isFinite(clock.elapsedSeconds) ||
        clock.elapsedSeconds < 0 || Math.fround(clock.elapsedSeconds) !== clock.elapsedSeconds)
      throw new Error("Invalid slow clock state");
    result.set(clock.conditionId, clock);
  }
  return result;
}

/** Native construction starts elapsedTime at zero. An already existing Slow
 * retains its field; removal drops it and re-application creates a new one. */
export function reconcileSlowClocks(
  behaviors: readonly SpeedBehavior[],
  conditionIds: readonly number[],
  previousState: Readonly<SlowState>,
): SlowState {
  const all = definitions(behaviors), previous = validateState(all, previousState);
  return active(all, conditionIds).filter((b) => b.kind === "slow").map(({ id }) =>
    previous.has(id) ? { ...previous.get(id)! } : { conditionId: id, elapsedSeconds: 0 });
}

/** Slow.Update 0x51a890 adds Unity deltaTime as float32. The caller owns
 * ConditionController gating and rollback. This method has no ATBSpeed,
 * isTimeStop, Haste/Slow multiplier or automatic expiration branch. */
export function advanceSlowClocks(
  behaviors: readonly SpeedBehavior[],
  conditionIds: readonly number[],
  state: Readonly<SlowState>,
  seconds: number,
): SlowState {
  const all = definitions(behaviors), clocks = validateState(all, state);
  const slow = active(all, conditionIds).filter((b) => b.kind === "slow");
  if (clocks.size !== slow.length || slow.some((b) => !clocks.has(b.id)))
    throw new Error("Slow clocks require explicit reconciliation");
  const delta = Math.fround(seconds);
  if (!Number.isFinite(seconds) || !Number.isFinite(delta) || seconds < 0)
    throw new Error("Invalid slow clock update");
  return slow.map(({ id }) => {
    const elapsedSeconds = Math.fround(clocks.get(id)!.elapsedSeconds + delta);
    if (!Number.isFinite(elapsedSeconds)) throw new Error("Unsupported slow elapsed overflow");
    return { conditionId: id, elapsedSeconds };
  });
}
