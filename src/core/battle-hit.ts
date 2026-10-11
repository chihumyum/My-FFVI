export type BattleRandom = (min: number, max: number) => number;

/** CalcExecuteFF6 .cctor metadata arrays. These are condition TYPES. Knowing
 * their hit arithmetic does not admit their otherwise unimplemented lifecycle. */
export const hitRatePlusConditionTypes = [12, 630, 34, 9, 602, 16] as const;
export const hitRateMinusConditionTypes = [407, 4, 10, 15] as const;

/** Shared ordinary physical/magic target adjustment. A source rate already
 * 255 bypasses the whole branch. Otherwise each list applies at most once,
 * plus first, with integer truncation and an upper cap at each stage. */
export function targetConditionAccuracy(accuracy: number, targetConditionTypes: readonly number[]): number {
  if (!Number.isInteger(accuracy) || accuracy < 0 || accuracy > 0x7fffffff)
    throw new Error("Invalid target condition accuracy");
  if (!Array.isArray(targetConditionTypes) || targetConditionTypes.some((type) =>
    !Number.isInteger(type) || type < 0 || type > 0x7fffffff))
    throw new Error("Invalid target condition types");
  let rate = Math.min(255, accuracy);
  if (rate === 255) return rate;
  if (hitRatePlusConditionTypes.some((type) => targetConditionTypes.includes(type)))
    rate = Math.min(255, Math.trunc(rate * 1.25));
  if (hitRateMinusConditionTypes.some((type) => targetConditionTypes.includes(type)))
    rate = Math.min(255, Math.trunc(rate * 0.75));
  return rate;
}

/** MagicExecution enters its hit branch BEFORE the target corrections. If a
 * correction raises the rate to 255 it still draws once, then forces success.
 * PhysicalExecution instead checks the adjusted rate after its variance draw.
 * AddConditionExection uses accuracyHit directly, without either status list. */
export function magicAccuracyHit(
  accuracy: number, evasion: number, targetConditionTypes: readonly number[], random: BattleRandom,
): boolean {
  const adjusted = targetConditionAccuracy(accuracy, targetConditionTypes);
  if (!Number.isInteger(evasion) || evasion < 0 || evasion > 0x7fffffff)
    throw new Error("Invalid accuracy hit input");
  if (accuracy < 255 && adjusted === 255) {
    drawBattleRandom(random, 0, 255);
    return true;
  }
  return accuracyHit(adjusted, evasion, random);
}

export function drawBattleRandom(
  random: BattleRandom,
  min: number,
  max: number,
) {
  const value = random(min, max);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error("Invalid battle random draw");
  return value;
}

/** Shared arithmetic in FF6 physical and condition calculations, AFTER
 * their distinct immunity, resistance and condition checks. Native evasion is
 * not a percentage. A rate of 255 skips the hit draw entirely. */
export function accuracyHit(
  accuracy: number,
  evasion: number,
  random: BattleRandom,
): boolean {
  for (const value of [accuracy, evasion])
    if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff)
      throw new Error("Invalid accuracy hit input");
  const rate = Math.min(255, accuracy);
  if (rate === 255) return true;
  const chance = Math.trunc(Math.imul((128 - evasion) * 2, rate) / 256);
  const draw = drawBattleRandom(random, 0, 255);
  return chance > Math.trunc((draw * 100) / 256);
}
