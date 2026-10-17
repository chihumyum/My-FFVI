import { checkpointKeys } from "./checkpoint-validation.js";

/** Explicit Web random stream for field actions. Formula inputs and ranges are
 * source-bound separately; this is not Unity's global generator identity. */
export type FieldRandomState = { kind: "web-field-random-v1"; state: number; draws: number };

export function validateFieldRandom(value: FieldRandomState): void {
  checkpointKeys(value, "kind,state,draws");
  if (value.kind !== "web-field-random-v1" || !Number.isInteger(value.state) ||
      value.state < 1 || value.state > 0xffffffff || !Number.isSafeInteger(value.draws) || value.draws < 0)
    throw new Error("Invalid field random state");
}
export function createFieldRandom(seed: number): FieldRandomState {
  const value: FieldRandomState = { kind: "web-field-random-v1", state: seed, draws: 0 };
  validateFieldRandom(value);
  return value;
}
/** The caller supplies a private transaction candidate; menu previews never
 * call this. Validation happens before either stream field is changed. */
export function drawFieldRandom(value: FieldRandomState, min: number, max: number): number {
  validateFieldRandom(value);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max > 0x7fffffff ||
      min > max || value.draws === Number.MAX_SAFE_INTEGER)
    throw new Error("Invalid field random draw");
  let next = value.state;
  next ^= next << 13; next ^= next >>> 17; next ^= next << 5;
  value.state = next >>> 0;
  value.draws++;
  return min + Math.floor(value.state / 0x100000000 * (max - min + 1));
}
