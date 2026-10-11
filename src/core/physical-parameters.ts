import type { PhysicalParameters } from "./physical.js";

export type PhysicalLimits = {
  attack: number;
  strength: number;
  accuracy: number;
  criticalRate: number;
  criticalPercent: number;
};
export type PlayerPhysicalInput = {
  baseAttack: number;
  bareHands: boolean;
  weaponAttack: number;
  weaponAccuracy: number;
  weaponCriticalRate: number;
  strength: {
    base: number;
    additional: number;
    correction: number;
    equipment: number;
  };
  temporary: PhysicalParameters;
};
function int(n: number) {
  if (!Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff)
    throw new Error("Invalid physical parameter input");
  return n;
}
function sum(...values: number[]) {
  return values.reduce((a, b) => (a + int(b)) | 0, 0);
}
function cap(n: number, max: number) {
  return Math.max(0, Math.min(n, max));
}
function checkLimits(limits: PhysicalLimits) {
  for (const key of [
    "attack",
    "strength",
    "accuracy",
    "criticalRate",
    "criticalPercent",
  ] as const)
    if (int(limits[key]) <= 0)
      throw new Error("Invalid physical parameter limit");
}

/** Selected single arm, no condition 601, two-hand or passive strength modifier.
 * Provider inputs are explicit, never inferred from absent save/condition data. */
export function confirmPlayerPhysical(
  input: PlayerPhysicalInput,
  limits: PhysicalLimits,
): PhysicalParameters {
  checkLimits(limits);
  if (typeof input.bareHands !== "boolean")
    throw new Error("Invalid bare-hand input");
  const naturalAttack = cap(
    sum(input.baseAttack, input.bareHands ? 10 : 0),
    limits.attack,
  );
  const naturalStrength = cap(
    sum(
      input.strength.base,
      input.strength.additional,
      input.strength.correction,
    ),
    limits.strength,
  );
  const critical = cap(
    sum(input.weaponCriticalRate, input.temporary.criticalRate),
    limits.criticalRate,
  );
  const f = Math.fround;
  return {
    attack: cap(
      sum(naturalAttack, input.temporary.attack, input.weaponAttack),
      limits.attack,
    ),
    strength: cap(
      sum(naturalStrength, input.temporary.strength, input.strength.equipment),
      limits.strength,
    ),
    // This build's FF6 natural accuracy and critical providers both return zero.
    accuracy: cap(
      sum(input.weaponAccuracy, input.temporary.accuracy),
      limits.accuracy,
    ),
    criticalRate: Math.min(
      limits.criticalPercent,
      Math.trunc(
        Math.min(100, f(f(f(critical) / f(limits.criticalRate)) * 100)),
      ),
    ),
  };
}
export function confirmEnemyPhysical(
  base: PhysicalParameters,
  temporary: PhysicalParameters,
  limits: PhysicalLimits,
): PhysicalParameters {
  checkLimits(limits);
  if (base.strength !== 0 || temporary.strength !== 0)
    throw new Error("Enemy physical calculation does not use strength");
  return {
    attack: cap(sum(base.attack, temporary.attack), limits.attack),
    strength: 0,
    accuracy: cap(sum(base.accuracy, temporary.accuracy), limits.accuracy),
    criticalRate: cap(
      sum(base.criticalRate, temporary.criticalRate),
      limits.criticalRate,
    ),
  };
}
