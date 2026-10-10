/** Master IDs are signed integers; retain raw CSV rows separately for provenance. */
export function tableId(value: unknown): number {
  if (typeof value === "string") {
    if (!/^[+-]?\d+$/.test(value.trim()))
      throw new Error("Invalid numeric master ID");
    value = Number(value.trim());
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2147483648 ||
    value > 2147483647
  )
    throw new Error("Invalid int32 master ID");
  return value;
}
