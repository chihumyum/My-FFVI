import {
  validateElementResistances,
  type ElementResistances,
} from "./elements.js";

export type PoisonDefinition = { id: number; hpDivisor: number };
/** Battle-local runtime state. Stable field saves retain condition identities,
 * not these clocks; a newly started battle calls StartSub again. */
export type PoisonState = {
  conditionId: number;
  elapsedSeconds: number;
  thresholdSeconds: number;
}[];
export type PoisonTick = {
  conditionId: number;
  amount: number;
  recovery: boolean;
  hpBefore: number;
  hpAfter: number;
};
export type PoisonAdvanceInput = {
  conditionIds: readonly number[];
  state: Readonly<PoisonState>;
  hp: number;
  maxHp: number;
  elementResistances: ElementResistances;
  seconds: number;
  atbSpeed: number;
  isTimeStopped: boolean;
};

/** CalcATBProgressCycleForVital(unit, 1), despite its name, uses only the
 * condition cycle coefficient and ATBSpeed. Haste/slow providers are not yet
 * admitted by BattleConditions; the source neutral coefficient is 16. */
function cycle(atbSpeed: number): number {
  const speed = Math.fround(atbSpeed);
  const result = Math.fround(16 / speed);
  if (
    !Number.isFinite(atbSpeed) ||
    !Number.isFinite(speed) ||
    speed <= 0 ||
    !Number.isFinite(result) ||
    result <= 0 ||
    Math.fround(result * 0.5) <= 0
  )
    throw new Error("Invalid poison ATB speed");
  return result;
}

function definitions(values: readonly PoisonDefinition[]) {
  const result = new Map<number, PoisonDefinition>();
  for (const value of values) {
    if (
      !Number.isInteger(value.id) ||
      value.id < 1 ||
      value.id > 0x7fffffff ||
      !Number.isInteger(value.hpDivisor) ||
      value.hpDivisor < 1 ||
      value.hpDivisor > 0x7fffffff ||
      result.has(value.id)
    )
      throw new Error("Invalid poison definition");
    result.set(value.id, value);
  }
  return result;
}

function activeIds(
  all: Map<number, PoisonDefinition>,
  conditionIds: readonly number[],
) {
  const result = conditionIds.filter((id) => all.has(id));
  if (new Set(result).size !== result.length)
    throw new Error("Duplicate active poison condition");
  return result;
}

function validateState(
  all: Map<number, PoisonDefinition>,
  state: Readonly<PoisonState>,
) {
  if (!Array.isArray(state)) throw new Error("Invalid poison clock state");
  const result = new Map<number, PoisonState[number]>();
  for (const clock of state) {
    if (
      !clock ||
      typeof clock !== "object" ||
      Array.isArray(clock) ||
      Object.keys(clock).length !== 3 ||
      !all.has(clock.conditionId) ||
      result.has(clock.conditionId) ||
      !Number.isFinite(clock.elapsedSeconds) ||
      clock.elapsedSeconds < 0 ||
      Math.fround(clock.elapsedSeconds) !== clock.elapsedSeconds ||
      !Number.isFinite(clock.thresholdSeconds) ||
      clock.thresholdSeconds <= 0 ||
      Math.fround(clock.thresholdSeconds) !== clock.thresholdSeconds ||
      clock.elapsedSeconds >= clock.thresholdSeconds
    )
      throw new Error("Invalid poison clock state");
    result.set(clock.conditionId, clock);
  }
  return result;
}

/** PoisonConditionFunction.StartSub 0x92cee0 halves only the first cycle.
 * A surviving condition keeps its progress; cure/death drops its clock. */
export function reconcilePoisonClocks(
  behaviors: readonly PoisonDefinition[],
  conditionIds: readonly number[],
  previousState: Readonly<PoisonState>,
  atbSpeed: number,
): PoisonState {
  const thresholdSeconds = Math.fround(cycle(atbSpeed) * 0.5);
  const all = definitions(behaviors);
  const previous = validateState(all, previousState);
  return activeIds(all, conditionIds).map((conditionId) => {
    const clock = previous.get(conditionId);
    return clock
      ? { ...clock }
      : { conditionId, elapsedSeconds: 0, thresholdSeconds };
  });
}

/** GeneratePoisonDamage 0x92c8d0 + GetRateValue 0x45b140. Affinity uses
 * confirmed poison element key 6; half resistance has a source minimum of 1,
 * unlike the generic physical/magic elemental helpers. */
function tickHp(
  conditionId: number,
  hpDivisor: number,
  hp: number,
  maxHp: number,
  elementResistances: ElementResistances,
): PoisonTick | undefined {
  let amount = Math.floor(
    Math.fround(Math.fround(maxHp) / Math.fround(hpDivisor)),
  );
  const affinity = elementResistances[6];
  if (affinity === 1) amount *= 2;
  if (affinity === 2) amount = Math.max(1, Math.trunc(amount / 2));
  if (affinity === 3) amount = 0;
  const recovery = affinity === 4;
  if (recovery && hp < 1) return undefined;
  const result = recovery ? hp + amount : hp - amount;
  // The source uses signed int32 HP arithmetic. Unsupported overflow must not
  // be silently replaced by JavaScript's wider arithmetic or clamping.
  if (amount > 0x7fffffff || result > 0x7fffffff || result < -0x80000000)
    throw new Error("Unsupported poison HP overflow");
  return {
    conditionId,
    amount,
    recovery,
    hpBefore: hp,
    hpAfter: recovery ? Math.min(maxHp, result) : Math.max(0, result),
  };
}

/** One native UpdateSub 0x92d200. Its caller owns pause/wait/out-of-battle
 * gating. Do not freeze poison just because an action is being presented.
 * Exactly one tick can occur per update; overshoot is discarded, not carried.
 * The host settles dying/death/conflicts after this pure HP projection. */
export function advancePoisonClocks(
  behaviors: readonly PoisonDefinition[],
  input: PoisonAdvanceInput,
): { hp: number; state: PoisonState; ticks: PoisonTick[] } {
  const nextThreshold = cycle(input.atbSpeed);
  const all = definitions(behaviors);
  const active = activeIds(all, input.conditionIds);
  const clocks = validateState(all, input.state);
  if (clocks.size !== active.length || active.some((id) => !clocks.has(id)))
    throw new Error("Poison clocks require explicit reconciliation");
  if (
    !Number.isInteger(input.hp) ||
    !Number.isInteger(input.maxHp) ||
    input.hp < 0 ||
    input.maxHp < 1 ||
    input.hp > input.maxHp ||
    input.maxHp > 0x7fffffff
  )
    throw new Error("Invalid poison HP");
  if (
    !Number.isFinite(input.seconds) ||
    input.seconds < 0 ||
    !Number.isFinite(Math.fround(input.seconds)) ||
    typeof input.isTimeStopped !== "boolean"
  )
    throw new Error("Invalid poison clock update");
  validateElementResistances(input.elementResistances);
  const ticks: PoisonTick[] = [];
  let hp = input.hp;
  const state = active.map((conditionId) => {
    const current = clocks.get(conditionId)!;
    if (input.isTimeStopped) return { ...current };
    const elapsedSeconds = Math.fround(
      current.elapsedSeconds + Math.fround(input.seconds),
    );
    if (!Number.isFinite(elapsedSeconds))
      throw new Error("Unsupported poison elapsed overflow");
    if (elapsedSeconds < current.thresholdSeconds)
      return { ...current, elapsedSeconds };
    const tick = tickHp(
      conditionId,
      all.get(conditionId)!.hpDivisor,
      hp,
      input.maxHp,
      input.elementResistances,
    );
    if (tick) {
      hp = tick.hpAfter;
      ticks.push(tick);
    }
    return {
      conditionId,
      elapsedSeconds: 0,
      thresholdSeconds: nextThreshold,
    };
  });
  return { hp, state, ticks };
}
