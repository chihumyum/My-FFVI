export function tableInteger(value: string | undefined): number {
  if (
    value === undefined ||
    !/^-?(0|[1-9]\d*)$/.test(value.trim()) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error(`Invalid table integer: ${String(value)}`);
  return Number(value);
}
