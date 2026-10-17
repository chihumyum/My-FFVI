import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";
import type { FadeColor } from "../core/field-fade.js";
import type { FieldScreenEffectOp } from "../core/field-screen-effects.js";

export const fieldScreenEffectMnemonics = ["ColorFade", "Flash"] as const;
/** Fixed-build source ColorFade requires RGBA and a signed duration. Flash
 * uses FaderCommon's nullable color/duration and two-stage wrapper protocol.
 * Raw source instruction/site remains retained by the enclosing compiler. */
export function compileFieldScreenEffectInstruction(raw: unknown): FieldScreenEffectOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || !(fieldScreenEffectMnemonics as readonly unknown[]).includes(instruction.mnemonic))
    throw new Error("Expected source screen-effects instruction");
  const colorFade = instruction.mnemonic === "ColorFade";
  let color: FadeColor | null = null;
  if (operands.iValues !== null && operands.iValues !== undefined) {
    const values = z.array(z.unknown()).parse(operands.iValues).map(int32);
    if (![4, 8].includes(values.length) || values.slice(4).some(v => v !== 0) ||
        values.slice(0, 4).some(v => v < 0 || v > 255)) throw new Error("Unsupported screen-effects RGBA operands");
    color = { r: Math.fround(values[0]! / 255), g: Math.fround(values[1]! / 255),
      b: Math.fround(values[2]! / 255), a: Math.fround(values[3]! / 255) };
  } else if (colorFade) throw new Error("ColorFade requires explicit RGBA operands");
  let seconds = 0;
  if (operands.rValues !== null && operands.rValues !== undefined) {
    const values = z.array(z.number().finite()).parse(operands.rValues);
    if (![1, 8].includes(values.length) || values.slice(1).some(v => v !== 0))
      throw new Error("Unsupported screen-effects duration operands");
    seconds = Math.fround(values[0]!);
    if (!Number.isFinite(seconds)) throw new Error("Screen-effects duration overflows float32");
  } else if (colorFade) throw new Error("ColorFade requires an explicit signed duration");
  if (operands.sValues !== null && operands.sValues !== undefined) {
    const values = z.array(z.string()).parse(operands.sValues);
    if (!(colorFade ? [8] : [0, 8]).includes(values.length) || values.some(v => v !== ""))
      throw new Error("Unsupported screen-effects string operands");
  }
  const policy = "web-field-screen-effects-v1" as const;
  return colorFade ? { kind: "field-color-fade", color: color!, seconds, policy }
    : { kind: "field-flash", color, seconds, policy };
}
