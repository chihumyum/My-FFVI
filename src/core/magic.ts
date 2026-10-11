import {
  drawBattleRandom,
  accuracyHit,
  type BattleRandom,
} from "./battle-hit.js";

export type MagicRules = {
  accuracy: number;
  /** Source content_flag_id values, never content_flag_group_id. */
  contentFlags: number[];
  forceDefense: boolean;
};
export type MagicParticipant = { side: "player" | "enemy" };
export type NeutralMagicInput = {
  rules: MagicRules;
  power: number;
  actor: MagicParticipant & { level: number; magic: number };
  target: MagicParticipant & { magicDefense: number; magicEvasion: number };
  recovery: boolean;
  targetCount: number;
};

/** Scalar FF6 MagicExecution 0xa94480, fixType=0. The caller must establish
 * neutral affinities, no modifying conditions/accessories, no critical magic,
 * weapon/scroll carrier, counter-stat substitution or provider overrides.
 * Silence does not modify this arithmetic. This is not a complete spell action.
 */
export function validateNeutralMagic(input: NeutralMagicInput): number {
  const { rules, actor, target, power, recovery, targetCount } = input;
  if (!rules || !Array.isArray(rules.contentFlags))
    throw new Error("Missing magic calculation rules");
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
  // This neutral branch represents nonnegative damage/recovery. Reject native
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

export function calculateNeutralMagic(
  input: NeutralMagicInput,
  random: BattleRandom,
) {
  const base = validateNeutralMagic(input);
  const { rules, target, actor, recovery, targetCount } = input;
  if (
    !accuracyHit(
      rules.contentFlags.includes(1) ? 255 : rules.accuracy,
      target.magicEvasion,
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
  if (!recovery && actor.side === "player" && target.side === "player")
    amount = Math.trunc(amount * 0.5);
  amount = Math.min(amount, 65535);
  if (rules.contentFlags.includes(2) && amount > 0)
    amount = Math.max(amount, 1);
  else if (targetCount > 1 && amount > 0)
    amount = Math.max(Math.trunc(amount * 0.5), 1);
  return { amount: Math.min(amount, 9999), missed: false };
}
