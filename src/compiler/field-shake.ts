import { int32 } from "../core/script-integer.js";
import { parseFieldShakeCommand, type FieldShakeOp } from "../core/field-camera-shake.js";
import { record } from "./content.js";

function array(raw: unknown, lengths: number[], kind: "integer" | "real" | "string"): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || !lengths.includes(raw.length) ||
      Reflect.ownKeys(raw).length !== raw.length + 1) throw new Error("Unsupported Shake operand array");
  for (let i = 0; i < raw.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("Unsupported sparse/accessor Shake operand");
    if (kind === "integer") int32(descriptor.value);
    else if (kind === "real" ? typeof descriptor.value !== "number" || !Number.isFinite(descriptor.value)
      : typeof descriptor.value !== "string") throw new Error("Invalid Shake operand scalar");
  }
  return raw;
}
/** Complete native Misc.Shake reads i3 after Play. Short three-int starts are
 * therefore retained blocked, not padded. Stop reads only i0; its original
 * one-int form is valid without inventing unused operands. */
export function compileFieldShakeInstruction(raw: unknown): FieldShakeOp {
  const instruction = record(raw);
  if (instruction.type !== 1 || instruction.mnemonic !== "Shake") throw new Error("Expected source MainCore Shake");
  const operands = record(instruction.operands), integers = array(operands.iValues, [1, 3, 8], "integer") as number[];
  if (![0, 1].includes(integers[0]!)) throw new Error("Unsupported Shake start/stop selector");
  if (integers.length === 8 && integers.slice(4).some(value => value !== 0))
    throw new Error("Unsupported reserved Shake integer operands");
  let intervalScale = 0;
  if (operands.rValues !== undefined && operands.rValues !== null) {
    const reals = array(operands.rValues, [8], "real") as number[];
    if (reals.slice(1).some(value => value !== 0)) throw new Error("Unsupported reserved Shake real operands");
    intervalScale = Math.fround(reals[0]!);
    if (!Number.isFinite(intervalScale) || intervalScale < 0) throw new Error("Unsupported Shake interval scale");
  }
  if (operands.sValues !== undefined && operands.sValues !== null &&
      array(operands.sValues, [8], "string").some(value => value !== "")) throw new Error("Unsupported Shake string operands");
  if (integers[0] === 0) {
    if (integers.length !== 1 && (integers.length !== 8 || integers[1]! < 0 || integers[1]! > 2 ||
        ![0, 1].includes(integers[2]!) || integers[3] !== 0)) throw new Error("Unsupported unused Shake stop operands");
    return { kind: "field-shake", command: { kind: "stop" } };
  }
  if (integers.length !== 8) throw new Error("Source Shake Play reads i3; missing operand normalization is unresolved");
  return { kind: "field-shake", command: parseFieldShakeCommand({ kind: "play", axis: integers[1] as 0 | 1 | 2,
    strength: integers[2] as 0 | 1, intervalScale, reexecute: integers[3]! }) };
}
