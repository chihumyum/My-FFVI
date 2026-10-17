import { int32 } from "../core/script-integer.js";
import type { FieldContentInvalidationOp } from "../core/field-content-invalidations.js";
import { record } from "./content.js";

function values(raw: unknown, type: "integer" | "real" | "string"): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length !== 8 || Reflect.ownKeys(raw).length !== 9)
    throw new Error("Unsupported InvalidateTelepo operand shape");
  const out: unknown[] = [];
  for (let i = 0; i < 8; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d?.enumerable || !("value" in d)) throw new Error("Sparse/accessor InvalidateTelepo operand");
    if (type === "integer") int32(d.value);
    else if (type === "real" ? typeof d.value !== "number" || !Number.isFinite(d.value) : typeof d.value !== "string")
      throw new Error("Invalid InvalidateTelepo operand scalar");
    out.push(d.value);
  }
  return out;
}
/** Exact MainCore family, all reserved source operands retained and checked.
 * Cache mutation and CastTelepo have different consumers and remain blocked. */
export function compileFieldContentInvalidationInstruction(raw: unknown): FieldContentInvalidationOp {
  const instruction = record(raw);
  if (instruction.type !== 1 || instruction.mnemonic !== "InvalidateTelepo")
    throw new Error("Expected MainCore InvalidateTelepo");
  const operands = record(instruction.operands), integers = values(operands.iValues, "integer");
  if (integers.slice(1).some(value => value !== 0) || values(operands.rValues, "real").some(value => value !== 0) ||
      values(operands.sValues, "string").some(value => value !== "")) throw new Error("Unsupported reserved InvalidateTelepo operands");
  return { kind: "field-content-invalidation", command: { kind: "add-moving", invalidType: integers[0] === 0 ? 0 : 2 } };
}
