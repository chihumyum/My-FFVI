import { levitateForcesMagicMiss } from "./condition-levitate.js";
import {
  drawBattleRandom,
  magicAccuracyHit,
  type BattleRandom,
} from "./battle-hit.js";
import {
  magicElementDamage,
  validateElements,
  validateElementResistances,
  type ElementResistances,
} from "./elements.js";
import { magicProtectionDamage, magicProtectionType } from "./protection.js";

export type MagicRules = {
  accuracy: number;
  /** Source content_flag_id values, never content_flag_group_id. */
  contentFlags: number[];
  forceDefense: boolean;
  elements: number[];
};
export type MagicParticipant = { side: "player" | "enemy" };
export type MagicInput = {
  /** Source ability carrier, absent for menu/item calculators. */
  abilityId?: number;
  rules: MagicRules;
  power: number;
  actor: MagicParticipant & { level: number; magic: number };
  target: MagicParticipant & {
    magicDefense: number;
    magicEvasion: number;
    elementResistances: ElementResistances;
    /** Derived live condition types, distinct from master row identities. */
    conditionTypes?: readonly number[];
  };
  recovery: boolean;
  targetCount: number;
};

/** Scalar FF6 MagicExecution 0xa94480, fixType=0. The caller must establish
 * explicit affinities, admitted target hit modifiers and Shell type 412, no accessories/critical magic,
 * weapon/scroll carrier, counter-stat substitution or provider overrides.
 * Silence does not modify this arithmetic. This is not a complete spell action.
 */
export function validateMagic(input: MagicInput): number {
  const { rules, actor, target, power, recovery, targetCount } = input;
  levitateForcesMagicMiss(input.abilityId, target.conditionTypes ?? []);
  if (!rules || !Array.isArray(rules.contentFlags))
    throw new Error("Missing magic calculation rules");
  validateElements(rules.elements);
  validateElementResistances(target.elementResistances);
  if (target.conditionTypes !== undefined &&
      (!Array.isArray(target.conditionTypes) || target.conditionTypes.some((type) =>
        !Number.isInteger(type) || type < 0 || type > 0x7fffffff)))
    throw new Error("Invalid magic condition types");
  // Bound repeated weakness multiplication even for synthetic malformed carriers.
  if (rules.elements.length > 8)
    throw new Error("Unreviewed magic element count");
  for (const value of [
    power,
    actor.level,
    actor.magic,
    rules.accuracy,
    target.magicDefense,
    target.magicEvasion,
    targetCount,
  ])
    if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff)
      throw new Error("Invalid magic calculation input");
  if (
    !targetCount ||
    typeof recovery !== "boolean" ||
    typeof rules.forceDefense !== "boolean" ||
    !["player", "enemy"].includes(actor.side) ||
    !["player", "enemy"].includes(target.side)
  )
    throw new Error("Invalid magic calculation context");
  if (rules.contentFlags.some((id) => ![1, 2, 5].includes(id)))
    throw new Error("Unimplemented magic content flag");
  // The base arithmetic represents nonnegative damage/recovery. Reject native
  // overflow inputs before RNG rather than accidentally treating them as healing.
  const product = actor.level * actor.magic * power;
  const scaled =
    actor.side === "enemy"
      ? Math.fround(
          Math.fround(
            Math.fround(actor.level) * Math.fround(actor.magic * power),
          ) * Math.fround(1.5),
        )
      : product;
  if (
    !Number.isSafeInteger(product) ||
    product > 0x7fffffff ||
    scaled > 0x7fffffff ||
    power * 4 + Math.trunc(scaled / 32) > 0x7fffffff ||
    target.magicDefense > 255
  )
    throw new Error("Magic arithmetic outside supported nonnegative range");
  return Math.min(65535, Math.trunc(Math.trunc(scaled) / 32) + power * 4);
}

export function calculateMagic(input: MagicInput, random: BattleRandom) {
  const base = validateMagic(input);
  const { rules, target, actor, recovery, targetCount } = input;
  if (levitateForcesMagicMiss(input.abilityId, target.conditionTypes ?? [])) return { amount: 0, missed: true };
  if (
    !magicAccuracyHit(
      rules.contentFlags.includes(1) ? 255 : rules.accuracy,
      target.magicEvasion,
      target.conditionTypes ?? [],
      random,
    )
  )
    return { amount: 0, missed: true };
  const varied =
    Math.trunc((base * (drawBattleRandom(random, 0, 31) + 224)) / 256) + 1;
  const ignoreDefense =
    rules.contentFlags.includes(5) || (recovery && !rules.forceDefense);
  let amount = ignoreDefense
    ? varied
    : Math.trunc(((255 - target.magicDefense) * varied) / 256) + 1;
  if (!ignoreDefense && target.conditionTypes?.includes(magicProtectionType))
    amount = magicProtectionDamage(amount);
  if (!recovery && actor.side === "player" && target.side === "player")
    amount = Math.trunc(amount * 0.5);
  const elemental = magicElementDamage(
    amount,
    rules.elements,
    target.elementResistances,
  );
  if (elemental.nullified) return { amount: 0, missed: false, nullified: true };
  amount = elemental.damage;
  amount = Math.min(amount, 65535);
  if (rules.contentFlags.includes(2) && amount > 0)
    amount = Math.max(amount, 1);
  else if (targetCount > 1 && amount > 0)
    amount = Math.max(Math.trunc(amount * 0.5), 1);
  else if (targetCount > 1 && amount < 0)
    amount = Math.min(Math.trunc(amount * 0.5), -1);
  // Native only caps positive magic here. Resource application clamps to max HP/MP.
  return { amount: Math.min(amount, 9999), missed: false };
}
