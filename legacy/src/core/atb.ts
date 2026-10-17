/** FFVI PR ATBCalc, RVA 0x675950. This is meter arithmetic, not the battle scheduler.
 * Inputs must be confirmed character stats and resolved condition modifiers.
 * Native source binding and call-site evidence: docs/battle-migration.md.
 */
export type AtbRules = {
  coefficient: number;
  enemyCoefficient: number;
  total: number;
  maxHighSpeed: number;
  maxLowSpeed: number;
};
export type AtbInput = {
  agility: number;
  weight: number;
  enemy: boolean;
  speedPercent: number;
  battleSpeed: number;
  seconds: number;
};
const f = Math.fround;
export function atbIncrement(rules: AtbRules, input: AtbInput): number {
  for (const value of [...Object.values(rules), ...Object.values(input)])
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("Non-finite ATB input");
  if (rules.coefficient <= 0 || rules.enemyCoefficient <= 0 || rules.total < 0 ||
      rules.maxHighSpeed < 0 || rules.maxLowSpeed < 0 || rules.maxLowSpeed > 100 ||
      input.seconds < 0 || input.battleSpeed < 0)
    throw new Error("Unsupported ATB input range");
  for (const value of [input.agility, input.weight, input.speedPercent, ...Object.values(rules)])
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
      throw new Error("ATB stat must be a native integer");
  const difference = input.agility - input.weight;
  if (difference < -2147483648 || difference > 2147483647)
    throw new Error("ATB stat difference overflows native integer");
  let rate = f(f(f(input.agility - input.weight) / f(rules.coefficient)) + 1);
  if (input.enemy) rate = f(rate / f(f(rules.enemyCoefficient) / 10));
  const modifier = Math.max(100 - rules.maxLowSpeed,
    Math.min(100 + rules.maxHighSpeed, input.speedPercent));
  const totalCoefficient = rules.total === 0 ? 1 : f(100 / f(rules.total));
  // Preserve the scalar SSE single-precision operation order.
  const result = f(f(f(f(f(f(input.seconds) * 30) * rate) * f(input.battleSpeed)) *
    f(f(modifier) / 100)) * totalCoefficient);
  if (!Number.isFinite(result)) throw new Error("ATB arithmetic overflow");
  return result;
}
