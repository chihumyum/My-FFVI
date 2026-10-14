import { z } from "zod";
import type { EventContextBranchOp } from "../core/event-context-branch.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

export const eventContextBranchMnemonics = [
  "BranchByCharacter", "BranchByPlayerDirection", "BranchByLeader",
] as const;

/** Source Format.type=1 forms only; unsupported operands remain explicit stops
 * in the shared compiler, which attaches the instruction's provenance. */
export function compileEventContextBranchInstruction(raw: unknown): EventContextBranchOp {
  const instruction = record(raw);
  if (instruction.type !== 1) throw new Error("Unsupported event context branch instruction type");
  const operands = record(instruction.operands);
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.slice(4).some((value) => value !== 0) ||
      reals.some((value) => value !== 0) || strings.some((value) => value !== ""))
    throw new Error("Unsupported event context branch reserved operands");
  switch (instruction.mnemonic) {
    case "BranchByCharacter":
      if (ints[0]! <= 0 || ![0, 1].includes(ints[1]!) ||
          ![0, 1].includes(ints[2]!) || ints[3]! < 0)
        throw new Error("Unsupported source character branch operands");
      return {
        kind: "branch-character",
        sourceId: ints[0]!,
        presence: ints[1] === 0 ? "present" : "absent",
        scope: ints[2] === 0 ? "current-party" : "enabled-roster",
        target: ints[3]!,
      };
    case "BranchByPlayerDirection":
      if (ints.slice(0, 4).some((value) => value < 0))
        throw new Error("Unsupported source player-direction branch address");
      return { kind: "branch-player-direction", targets: [ints[0]!, ints[1]!, ints[2]!, ints[3]!] };
    case "BranchByLeader":
      if (ints[0]! <= 0 || ints[1]! < 0 || ints.slice(2).some((value) => value !== 0))
        throw new Error("Unsupported source leader branch operands");
      return { kind: "branch-leader", sourceId: ints[0]!, target: ints[1]! };
    default:
      throw new Error("Unknown event context branch mnemonic: " + instruction.mnemonic);
  }
}
