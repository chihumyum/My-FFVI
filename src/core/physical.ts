import {
  drawBattleRandom,
  accuracyHit,
  type BattleRandom,
} from "./battle-hit.js";
import {
  physicalElementDamage,
  validateElements,
  validateElementResistances,
  type ElementResistances,
} from "./elements.js";
import { physicalProtectionDamage, physicalProtectionType } from "./protection.js";
import { validatePhysicalRows, type PhysicalRowContext } from "./battle-row.js";

export type PhysicalRules = {
  normalAttack: boolean;
  /** Source data_a percent. Null means no multiply process. */
  multiplyPercent: number | null;
  contentFlags: number[];
};
export type PhysicalParameters = {
  /** Selected-arm attack for a player; confirmed attack for an enemy. */
  attack: number;
  /** Player strength. Enemy physical calculation does not use it. */
  strength: number;
  accuracy: number;
  criticalRate: number;
};
export type PhysicalInput = {
  rules: PhysicalRules;
  rows: PhysicalRowContext;
  power: number;
  actor: PhysicalParameters & {
    side: "player" | "enemy";
    level: number;
    attackElements: number[];
  };
  target: {
    side: "player" | "enemy";
    defense: number;
    evasion: number;
    elementResistances: ElementResistances;
    /** Derived live condition types, distinct from master row identities. */
    conditionTypes?: readonly number[];
  };
  targetCount: number;
};
const f = Math.fround;
function baseDamage(input: PhysicalInput, enemyDraw: number) {
  const { actor, rules } = input;
  const power =
    input.power +
    (actor.side === "enemy" || rules.normalAttack ? actor.attack : 0);
  if (actor.side === "enemy")
    return Math.trunc(
      f(f(f(56 + enemyDraw + 4 * power) * f(f(actor.level) ** 2)) / 256),
    );
  const sum = Math.min(255, 2 * actor.strength) + power;
  // Native fmodf(x, 65536), not a clamp or integer remainder before scaling.
  const scaled = f(f(f(f(actor.level * actor.level) * f(sum)) / 256) * 1.5);
  return Math.trunc(f(f(scaled % 65536) + f(power)));
}

/** PhysicalExecution 0xa97b20, explicit rows and affinities, correction=1,
 * Defend type 1 and Proteus type 19 only; no other numerical conditions, accessory/weapon procs,
 * species, counters or copies.
 * The compiler/profile must establish that context. Silence is allowed.
 */
export function validatePhysical(input: PhysicalInput): void {
  const { actor, target, rules, power, targetCount } = input;
  if (!rules || !Array.isArray(rules.contentFlags))
    throw new Error("Missing physical calculation rules");
  validatePhysicalRows(input.rows);
  validateElements(actor.attackElements);
  validateElementResistances(target.elementResistances);
  if (target.conditionTypes !== undefined &&
      (!Array.isArray(target.conditionTypes) || target.conditionTypes.some((type) =>
        !Number.isInteger(type) || type < 0 || type > 0x7fffffff)))
    throw new Error("Invalid physical condition types");
  for (const value of [
    power,
    actor.level,
    actor.attack,
    actor.strength,
    actor.accuracy,
    actor.criticalRate,
    target.defense,
    target.evasion,
    targetCount,
  ])
    if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff)
      throw new Error("Invalid physical calculation input");
  if (
    !targetCount ||
    typeof rules.normalAttack !== "boolean" ||
    !["player", "enemy"].includes(actor.side) ||
    !["player", "enemy"].includes(target.side) ||
    (rules.multiplyPercent !== null &&
      (!Number.isInteger(rules.multiplyPercent) ||
        rules.multiplyPercent <= 0 ||
        rules.multiplyPercent > 0x7fffffff))
  )
    throw new Error("Invalid physical calculation context");
  if (rules.contentFlags.some((id) => ![1, 2, 5].includes(id)))
    throw new Error("Unimplemented physical content flag");
  // Reject overflow before any draws. The base must stay nonnegative;
  // absorption changes the sign later. Native overflow and special weapons are blocked.
  const rawPower = power + actor.attack;
  const rawUpper = baseDamage(input, 7);
  const upper = input.rows.actor === "back" && !input.rows.ignoreActorPenalty
    ? Math.trunc(rawUpper * 0.5) : rawUpper;
  const product = upper * (rules.multiplyPercent ?? 100);
  const multiplied =
    rules.multiplyPercent === null ? upper : Math.trunc(product * 0.01);
  if (
    target.defense > 255 ||
    target.evasion > 255 ||
    actor.criticalRate > 100 ||
    actor.strength * 2 > 0x7fffffff ||
    actor.level * actor.level > 0x7fffffff ||
    63 + 4 * rawPower > 0x7fffffff ||
    !Number.isSafeInteger(product) ||
    (rules.multiplyPercent !== null && product > 0x7fffffff) ||
    upper < 0 ||
    multiplied * 255 > 0x7fffffff
  )
    throw new Error("Physical arithmetic outside supported nonnegative range");
}

export function calculatePhysical(input: PhysicalInput, random: BattleRandom) {
  validatePhysical(input);
  const { actor, target, rules, targetCount } = input;
  let base = baseDamage(
    input,
    actor.side === "enemy" ? drawBattleRandom(random, 0, 7) : 0,
  );
  // Actor-row correction precedes multiply, variance and even a flag5 defense
  // bypass. Native truncates here, not after multiplying the final damage.
  if (input.rows.actor === "back" && !input.rows.ignoreActorPenalty)
    base = Math.trunc(base * 0.5);
  if (rules.multiplyPercent !== null)
    base = Math.trunc(base * rules.multiplyPercent * 0.01);
  const factor = 224 + drawBattleRandom(random, 0, 31);
  let amount = Math.trunc(
    f(f(Math.trunc(base / 256) * factor) + f(f((base % 256) * factor) / 256)),
  );
  // Physical variance precedes hit; a miss skips defense and the critical draw.
  if (
    !accuracyHit(
      rules.contentFlags.includes(1) ? 255 : actor.accuracy,
      target.evasion,
      random,
    )
  )
    return { amount: 0, missed: true, critical: false };
  if (!rules.contentFlags.includes(5)) {
    if (target.conditionTypes?.includes(physicalProtectionType))
      amount = physicalProtectionDamage(amount);
    amount = Math.trunc(((255 - target.defense) * amount) / 256) + 1;
    // Target-row correction is inside the defense branch, after its +1 and
    // before Defend, friendly-fire, critical and elemental resolution.
    if (input.rows.target === "back" && !input.rows.ignoreTargetPenalty)
      amount = Math.trunc(amount * 0.5);
    // Source type 1 is checked inside the defense branch, before player-vs-
    // player halving, critical, elements and target-count correction.
    if (target.conditionTypes?.includes(1)) amount = Math.trunc(amount * 0.5);
    if (actor.side === "player" && target.side === "player")
      amount = Math.trunc(amount * 0.5);
  }
  // Native consumes this even when the confirmed rate is zero.
  const critical = drawBattleRandom(random, 0, 99) < actor.criticalRate;
  if (critical) amount *= 2;
  const elemental = physicalElementDamage(
    amount,
    actor.side === "enemy" || rules.normalAttack ? actor.attackElements : [],
    target.elementResistances,
  );
  if (elemental.nullified)
    return { amount: 0, missed: false, critical, nullified: true };
  amount = elemental.damage;
  amount = Math.trunc(f(amount)); // attackPointCorrection=1 still converts to float32.
  if (rules.contentFlags.includes(2) && amount > 0)
    amount = Math.max(1, amount);
  else if (targetCount > 1 && amount > 0)
    amount = Math.max(1, Math.trunc(amount * 0.5));
  // Unlike magic, absorbed physical damage is not halved for multiple targets.
  return {
    amount: Math.max(-9999, Math.min(9999, amount)),
    missed: false,
    critical,
  };
}
