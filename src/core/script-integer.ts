/** Shared source Internal.Main arithmetic; no field or battle state ownership. */
export const operators = [
  "←",
  "＋",
  "－",
  "×",
  "÷",
  "％",
  "＝",
  "≠",
  "＞",
  "≧",
  "＜",
  "≦",
] as const;
export type Operator = (typeof operators)[number];
export function int32(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2147483648 ||
    value > 2147483647
  )
    throw new Error("Expected signed 32-bit event value");
  return value;
}
export function isOperator(name: string): name is Operator {
  return (operators as readonly string[]).includes(name);
}
/** Internal.Main uses int32 operations; division by zero keeps lhs, modulo by zero returns zero. */
export function integerOperation(
  left: number,
  op: Operator,
  right: number,
): number {
  int32(left);
  int32(right);
  switch (op) {
    case "←":
      return right;
    case "＋":
      return (left + right) | 0;
    case "－":
      return (left - right) | 0;
    case "×":
      return Math.imul(left, right);
    case "÷":
      if (right === 0) return left;
      if (left === -2147483648 && right === -1)
        throw new Error("Signed event division overflow");
      return Math.trunc(left / right) | 0;
    case "％":
      if (left === -2147483648 && right === -1)
        throw new Error("Signed event remainder overflow");
      return right === 0 ? 0 : left % right | 0;
    case "＝":
      return Number(left === right);
    case "≠":
      return Number(left !== right);
    case "＞":
      return Number(left > right);
    case "≧":
      return Number(left >= right);
    case "＜":
      return Number(left < right);
    case "≦":
      return Number(left <= right);
    default:
      throw new Error("Unsupported script integer operator");
  }
}
