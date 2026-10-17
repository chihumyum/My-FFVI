/** Actual FF6 factory type407. No row ID or English enum name dispatch. */
export type SlipBehavior = { id: number; kind: "slip"; name: string; untilType: 2 };
export type SlipClock = { conditionId: number; elapsedSeconds: number; first: boolean; isTimeStop: boolean };
export type SlipState = SlipClock[];
export function slipCycle(atbSpeed: number, first: boolean): number {
  if (!Number.isFinite(atbSpeed) || atbSpeed <= 0 || !Number.isFinite(Math.fround(atbSpeed)))
    throw Error("Invalid type407 ATB speed");
  const result = Math.fround(Math.fround(6) / Math.fround(atbSpeed));
  const threshold = first ? Math.fround(result * Math.fround(.5)) : result;
  if (!Number.isFinite(threshold) || threshold <= 0) throw Error("Invalid type407 cycle");
  return threshold;
}
function clocks(ids: readonly number[], previous: readonly SlipClock[]): Map<number, SlipClock> {
  if (new Set(ids).size !== ids.length || ids.some(id => !Number.isInteger(id) || id < 1))
    throw Error("Invalid active type407 identities");
  const result = new Map<number, SlipClock>();
  for (const c of previous) {
    if (!c || Object.keys(c).sort().join(',') !== 'conditionId,elapsedSeconds,first,isTimeStop' ||
        !Number.isInteger(c.conditionId) || c.conditionId < 1 || result.has(c.conditionId) ||
        !Number.isFinite(c.elapsedSeconds) || c.elapsedSeconds < 0 || Math.fround(c.elapsedSeconds) !== c.elapsedSeconds ||
        typeof c.first !== 'boolean' || typeof c.isTimeStop !== 'boolean') throw Error('Invalid type407 function clock');
    result.set(c.conditionId, c);
  }
  return result;
}
export function reconcileSlipClocks(ids: readonly number[], previous: readonly SlipClock[]): SlipState {
  const old = clocks(ids, previous);
  return ids.map(conditionId => ({ ...(old.get(conditionId) ?? { conditionId, elapsedSeconds: 0, first: true, isTimeStop: false }) }));
}
export function writeSlipTimeStop(state: readonly SlipClock[], stopped: boolean): SlipState {
  clocks(state.map(c => c.conditionId), state);
  if (typeof stopped !== 'boolean') throw Error('Invalid type407 time-stop writer');
  return state.map(c => ({ ...c, isTimeStop: stopped }));
}
/** Update recomputes threshold on each eligible clock, not on Start. Pending
 * same-tag numbers and game-over prevent any progress and any RNG draw. */
export function advanceSlipClock(clock: Readonly<SlipClock>, seconds: number, atbSpeed: number,
  gameOver: boolean, pendingNumber: boolean): { clock: SlipClock; tick: boolean } {
  clocks([clock.conditionId], [clock]);
  const threshold = slipCycle(atbSpeed, clock.first);
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(Math.fround(seconds)) ||
      typeof gameOver !== 'boolean' || typeof pendingNumber !== 'boolean') throw Error('Invalid type407 update');
  if (gameOver || clock.isTimeStop || pendingNumber) return { clock: { ...clock }, tick: false };
  const elapsedSeconds = Math.fround(clock.elapsedSeconds + Math.fround(seconds));
  if (!Number.isFinite(elapsedSeconds)) throw Error('Type407 elapsed overflow');
  return elapsedSeconds < threshold ? { clock: { ...clock, elapsedSeconds }, tick: false }
    : { clock: { ...clock, elapsedSeconds: 0, first: false }, tick: true };
}
/** GetRateValue(4): every multiplication/division is a native float32 step.
 * The caller owns the one inclusive RNG draw and the actual parameter class. */
export function slipDamage(value: number, maxHp: number, randomInt: (min: number, max: number) => number): number {
  if (![value, maxHp].every(n => Number.isInteger(n) && n >= 0 && n <= 0x7fffffff) || maxHp === 0)
    throw Error('Invalid confirmed type407 parameter');
  const draw = randomInt(90, 110);
  if (!Number.isInteger(draw) || draw < 90 || draw > 110) throw Error('Invalid type407 random draw');
  let amount = Math.fround(Math.fround(draw) * Math.fround(.01));
  amount = Math.fround(amount * Math.fround(Math.fround(maxHp) / Math.fround(1000)));
  amount = Math.fround(amount * Math.fround(value));
  amount = Math.fround(amount * Math.fround(.5));
  return Math.floor(Math.min(127, Math.max(1, amount)));
}
