import { z } from "zod";
import type { FieldFadeOp, FadeColor } from "../core/field-fade.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

/** Source immediate forms, including nullable color/duration in the source sandbox. */
export function compileFieldFadeInstruction(raw: unknown): FieldFadeOp {
  const instruction = record(raw),
    operands = record(instruction.operands);
  if (
    instruction.type !== 1 ||
    !["FadeIn", "FadeOut"].includes(String(instruction.mnemonic))
  )
    throw new Error("Expected source field fade instruction");
  let color: FadeColor | null = null;
  if (operands.iValues !== undefined && operands.iValues !== null) {
    const ints = z.array(z.unknown()).parse(operands.iValues).map(int32);
    if (![4, 8].includes(ints.length) || ints.slice(4).some((v) => v !== 0))
      throw new Error("Unsupported field fade integer operand shape");
    if (ints.slice(0, 4).some((v) => v < 0 || v > 255))
      throw new Error(
        "Field fade RGBA outside 0..255 needs a native color-range provider",
      );
    color = {
      r: Math.fround(ints[0]! / 255),
      g: Math.fround(ints[1]! / 255),
      b: Math.fround(ints[2]! / 255),
      a: Math.fround(ints[3]! / 255),
    };
  }
  let seconds = 0;
  if (operands.rValues !== undefined && operands.rValues !== null) {
    const reals = z.array(z.number().finite()).parse(operands.rValues);
    if (![1, 8].includes(reals.length) || reals.slice(1).some((v) => v !== 0))
      throw new Error("Unsupported field fade real operand shape");
    seconds = Math.fround(reals[0]!);
    if (!Number.isFinite(seconds))
      throw new Error("Field fade duration overflows float32");
  }
  if (operands.sValues !== undefined && operands.sValues !== null) {
    const strings = z.array(z.string()).parse(operands.sValues);
    if (strings.length !== 8 || strings.some((v) => v !== ""))
      throw new Error("Unsupported field fade string operand shape");
  }
  return {
    kind: "field-fade",
    direction: instruction.mnemonic === "FadeIn" ? "in" : "out",
    seconds,
    color,
  };
}
