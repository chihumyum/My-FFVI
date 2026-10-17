import { z } from "zod";
import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import type { FieldNativePosition } from "../core/field-native-position.js";

export function compileFieldNativePosition(raw: unknown): FieldNativePosition {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 2 || instruction.mnemonic !== "SetPos")
    throw new Error("Expected source actor SetPos");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  const mode = ints[3]!;
  if (!([0, 1, 2, 3].includes(ints[2]!)) || ![0, 1].includes(mode) ||
      mode === 0 && ints[4] !== 0 || ints.slice(5).some((v) => v !== 0) ||
      reals.some((v) => v !== 0) || strings.slice(1).some((v) => v !== ""))
    throw new Error("Unsupported source actor SetPos mode/layer/operand shape");
  const common = { x: ints[0]!, y: ints[1]!, layer: ints[2] as FieldNativePosition["layer"], animation: strings[0]! };
  return mode === 1 ? { ...common, mode: 1, referenceEntityId: ints[4]! } : common;
}
