import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import type { SourcePresentationOp } from "../core/source-presentation.js";
import { record } from "./content.js";

export const sourcePresentationSelectors = [
  "アドバタイズデモフラグを設定",
  "アドバタイズデモからタイトル遷移",
] as const;

/** Decode exact native selector identities and operand forms. This does not
 * grant a presentation host or turn missing lifecycle context into absence. */
export function compileSourcePresentationInstruction(
  raw: unknown,
): SourcePresentationOp {
  const instruction = record(raw),
    operands = record(instruction.operands);
  if (instruction.mnemonic !== "SysCall" || instruction.type !== 1)
    throw new Error("Expected source presentation system call");
  const ints = z
    .array(z.unknown())
    .length(8)
    .parse(operands.iValues)
    .map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (
    ints.some((value) => value !== 0) ||
    reals.some((value) => value !== 0) ||
    strings.slice(1).some((value) => value !== "")
  )
    throw new Error("Unsupported source presentation operand shape");
  if (strings[0] === sourcePresentationSelectors[0])
    return {
      kind: "source-presentation",
      command: { kind: "advertisement-probe" },
    };
  if (strings[0] === sourcePresentationSelectors[1])
    return {
      kind: "source-presentation",
      command: { kind: "advertisement-return-to-title" },
    };
  throw new Error("Unknown source presentation selector: " + strings[0]);
}
