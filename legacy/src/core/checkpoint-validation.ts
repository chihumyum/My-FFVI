/** Small validation helpers for versioned, externally loaded checkpoint data. */
export function checkpointRecord(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid checkpoint record");
}
export function checkpointKeys(value: unknown, expected: string): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== expected.split(",").sort().join(",")
  )
    throw new Error("Invalid checkpoint fields");
}
export function checkpointNumber(
  value: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error("Invalid checkpoint number");
}
export function checkpointInteger(
  value: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): void {
  checkpointNumber(value, min, max);
  if (!Number.isSafeInteger(value))
    throw new Error("Invalid checkpoint integer");
}
export function checkpointIds(values: readonly string[]): void {
  if (
    !Array.isArray(values) ||
    values.some((v) => typeof v !== "string") ||
    new Set(values).size !== values.length
  )
    throw new Error("Invalid checkpoint identities");
}
export function checkpointSameIds(
  actual: readonly string[],
  expected: readonly string[],
): void {
  checkpointIds(actual);
  if (
    actual.length !== expected.length ||
    actual.some((id) => !expected.includes(id))
  )
    throw new Error("Checkpoint dependency identities changed");
}
