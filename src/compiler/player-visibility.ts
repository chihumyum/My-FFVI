import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import type { PlayerVisibilityOp } from "../core/player-visibility.js";
import { record } from "./content.js";

export const playerVisibilityMnemonics = ["HidePlayer", "ShowPlayer"] as const;

/** Both native wrappers ignore MainCore and have no actor/operand selection.
 * Admit the exact observed instruction shape; an extra operand is not granted
 * an invented duration, target, party scope or conditional visibility meaning. */
export function compilePlayerVisibilityInstruction(raw: unknown): PlayerVisibilityOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 ||
      (instruction.mnemonic !== "HidePlayer" && instruction.mnemonic !== "ShowPlayer"))
    throw new Error("Expected source player visibility instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.some((value) => value !== 0) || reals.some((value) => value !== 0) ||
      strings.some((value) => value !== ""))
    throw new Error("Unsupported source player visibility operand shape");
  return {
    kind: "player-visibility",
    command: { kind: instruction.mnemonic === "HidePlayer" ? "hide-player" : "show-player" },
  };
}
