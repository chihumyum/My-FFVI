export type BattleRandom = (min: number, max: number) => number;

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

/** Shared arithmetic in FF6 MagicExecution and AddConditionExection, AFTER
 * their distinct immunity, resistance and condition checks. Native MEva is
 * not a percentage. A rate of 255 skips the hit draw entirely. */
export function magicHit(
  accuracy: number,
  magicEvasion: number,
  random: BattleRandom,
): boolean {
  for (const value of [accuracy, magicEvasion])
    if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff)
      throw new Error("Invalid magic hit input");
  const rate = Math.min(255, accuracy);
  if (rate === 255) return true;
  const chance = Math.trunc(Math.imul((128 - magicEvasion) * 2, rate) / 256);
  const draw = drawBattleRandom(random, 0, 255);
  return chance > Math.trunc((draw * 100) / 256);
}
