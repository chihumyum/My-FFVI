import {
  drawBattleRandom,
  accuracyHit,
  type BattleRandom,
} from "./battle-hit.js";

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
export type NeutralPhysicalInput = {
  rules: PhysicalRules;
  power: number;
  actor: PhysicalParameters & { side: "player" | "enemy"; level: number };
  target: { side: "player" | "enemy"; defense: number; evasion: number };
  targetCount: number;
};
const f = Math.fround;
function baseDamage(input: NeutralPhysicalInput, enemyDraw: number) {
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

/** PhysicalExecution 0xa97b20, front rows, neutral affinities, correction=1,
 * no numerical conditions, accessory/weapon procs, species, counters or copies.
 * The compiler/profile must establish that context. Silence is allowed.
 */
export function validateNeutralPhysical(input: NeutralPhysicalInput): void {
  const { actor, target, rules, power, targetCount } = input;
  if (!rules || !Array.isArray(rules.contentFlags))
    throw new Error("Missing physical calculation rules");
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
  // Reject overflow before any draws. This lane only represents nonnegative
  // damage; native signed-overflow/healing and special weapons need other lanes.
  const rawPower = power + actor.attack;
  const upper = baseDamage(input, 7);
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

export function calculateNeutralPhysical(
  input: NeutralPhysicalInput,
  random: BattleRandom,
) {
  validateNeutralPhysical(input);
  const { actor, target, rules, targetCount } = input;
  let base = baseDamage(
    input,
    actor.side === "enemy" ? drawBattleRandom(random, 0, 7) : 0,
  );
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
    amount = Math.trunc(((255 - target.defense) * amount) / 256) + 1;
    if (actor.side === "player" && target.side === "player")
      amount = Math.trunc(amount * 0.5);
  }
  // Native consumes this even when the confirmed rate is zero.
  const critical = drawBattleRandom(random, 0, 99) < actor.criticalRate;
  if (critical) amount *= 2;
  amount = Math.trunc(f(amount)); // attackPointCorrection=1 still converts to float32.
  if (rules.contentFlags.includes(2) && amount > 0)
    amount = Math.max(1, amount);
  else if (targetCount > 1 && amount > 0)
    amount = Math.max(1, Math.trunc(amount * 0.5));
  return { amount: Math.min(9999, amount), missed: false, critical };
}
