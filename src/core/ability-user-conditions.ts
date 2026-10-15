import type { BattleConditions } from "./battle-conditions.js";

export type UserConditionPhase = "fixed-parameter" | "update-parameter";
/** Function38 operates on the user, independently of the nominal target and
 * its accuracy/resistance. The raw tuple remains bound to its phase/operation. */
export type UserConditionEffect = {
  kind: "user-condition";
  slot: number;
  conditionId: number;
  conditionType: number;
  phase: UserConditionPhase;
  operation: "add" | "remove";
  rawValues: [number, 0 | 1, 0 | 1];
};
/** RemoveCondition does not replace FunctionBase's result. Non is distinct
 * from Miss, Hit and an absent primary result dictionary. */
export type UserConditionCalcResult = {
  value: 0;
  hitType: -1 | 0 | 2;
  hitCount: 0;
  conditions: null;
  recovery: false;
};
export type UserConditionProjection = {
  executed: boolean;
  currentIds: number[];
  added: number[];
  removed: number[];
  calcResult: UserConditionCalcResult;
};
export type UniqueNoneEffect = {
  slot: number;
  kind: "unique-none";
  primaryResult: "empty-dictionary";
};
export type UniqueNoneEffectResult = {
  slot: number;
  resource: "none";
  primaryResult: "empty-dictionary";
  calcResult: null;
  /** Absent at runtime. Empty dictionary is not HitType.Miss. */
  missed?: never;
};
type Conditions = Pick<BattleConditions,
  "validateReferences" | "validateActive" | "referenceTypes">;

function positive(value: number) {
  return Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
}
export function validateUserConditionEffect(effect: UserConditionEffect): void {
  if (effect.kind !== "user-condition" || !Number.isInteger(effect.slot) ||
      effect.slot < 1 || effect.slot > 3 || !positive(effect.conditionId) ||
      !Number.isInteger(effect.conditionType) || effect.conditionType < 0 ||
      effect.conditionType > 0x7fffffff || !Array.isArray(effect.rawValues) ||
      effect.rawValues.length !== 3 || effect.rawValues[0] !== effect.conditionId ||
      ![0, 1].includes(effect.rawValues[1]) || ![0, 1].includes(effect.rawValues[2]) ||
      effect.phase !== (effect.rawValues[1] === 0 ? "fixed-parameter" : "update-parameter") ||
      effect.operation !== (effect.rawValues[2] === 0 ? "add" : "remove"))
    throw new Error("Invalid user-condition function binding");
}
function result(hitType: -1 | 0 | 2): UserConditionCalcResult {
  return { value: 0, hitType, hitCount: 0, conditions: null, recovery: false };
}
export function initialUserConditionCalcResult(): UserConditionCalcResult {
  return result(-1);
}
function validateResult(value: UserConditionCalcResult): void {
  if (value.value !== 0 || ![-1, 0, 2].includes(value.hitType) ||
      value.hitCount !== 0 || value.conditions !== null || value.recovery !== false)
    throw new Error("Unresolved user-condition calculator result");
}

/** One native invocation, not a whole-action executor. FixedParameter is
 * called inside the nominal-target loop; the host threads ONE private user
 * projection through those calls, then publishes user/targets/cost together.
 *
 * 906010/906080 select phase 0/1; 905f20 directly appends or removes one exact
 * master record. This deliberately does not use ordinary add/recover/conflict
 * helpers or their hit/RNG rules. Lifecycle settlement belongs to the host.
 * Type501 needs its separate staged Manipulate guard and remains blocked. */
export function projectUserConditionPhase(
  effect: UserConditionEffect,
  phase: UserConditionPhase,
  user: { id: string; conditionIds: readonly number[] },
  conditions: Conditions,
  previousResult: UserConditionCalcResult = initialUserConditionCalcResult(),
): UserConditionProjection {
  validateUserConditionEffect(effect);
  validateResult(previousResult);
  if (!["fixed-parameter", "update-parameter"].includes(phase) ||
      typeof user.id !== "string" || !user.id || !Array.isArray(user.conditionIds))
    throw new Error("Invalid user-condition phase owner");
  conditions.validateReferences([effect.conditionId]);
  if (conditions.referenceTypes([effect.conditionId])[0] !== effect.conditionType)
    throw new Error("User-condition master/type mismatch");
  conditions.validateActive(user.conditionIds);
  const currentIds = [...user.conditionIds];
  const unchanged: UserConditionProjection = { executed: false, currentIds,
    added: [], removed: [], calcResult: { ...previousResult } };
  if (phase !== effect.phase) return unchanged;
  if (effect.operation === "remove") {
    const index = currentIds.indexOf(effect.conditionId);
    if (index >= 0) currentIds.splice(index, 1);
    return { ...unchanged, executed: true,
      removed: index < 0 ? [] : [effect.conditionId] };
  }
  if (effect.conditionType === 409)
    throw new Error("Unresolved user-condition Leviteto owner lifecycle");
  if (effect.conditionType === 501)
    throw new Error("Unresolved user-condition Manipulate guard");
  // Non-501 CheckHittable is source true, but does not authorize an unported
  // active behavior. In particular a known 682 marker cannot be fabricated.
  conditions.validateActive([effect.conditionId]);
  currentIds.push(effect.conditionId);
  return { executed: true, currentIds, added: [effect.conditionId], removed: [],
    calcResult: result(0) };
}

/** The compiler binds the explicit FF6 native empty-dictionary branch. It is
 * not a zero-damage hit or a Miss and must not create a target reaction. */
export function projectUniqueNoneEffect(effect: UniqueNoneEffect): UniqueNoneEffectResult {
  if (effect.kind !== "unique-none" || !Number.isInteger(effect.slot) ||
      effect.slot < 1 || effect.slot > 3 || effect.primaryResult !== "empty-dictionary")
    throw new Error("Unresolved Unique None calculation");
  return { slot: effect.slot, resource: "none", primaryResult: "empty-dictionary", calcResult: null };
}
