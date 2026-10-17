import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import type { FieldTaskControlOp } from "../core/field-task-control.js";
import { record } from "./content.js";

export const fieldTaskControlMnemonics = [
  "Call", "Return", "SetPuppet", "ExecPuppet", "FinishPuppet",
] as const;

/** Exact source operand forms. Format.type=2 includes generated main helpers;
 * it does not establish that a command executes on a PuppetCore. */
export function compileFieldTaskControlInstruction(raw: unknown): FieldTaskControlOp {
  const instruction = record(raw);
  if (instruction.type !== 1 && instruction.type !== 2)
    throw new Error("Unresolved source field task instruction type");
  const operands = record(instruction.operands);
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (reals.some((n) => n !== 0) || strings.some((s) => s !== ""))
    throw new Error("Unsupported field task real/string operands");
  const reserved = (used: readonly number[]) => {
    if (ints.some((value, index) => !used.includes(index) && value !== 0))
      throw new Error("Unsupported field task reserved operands");
  };
  switch (instruction.mnemonic) {
    case "Call":
      reserved([0, 1]);
      if (instruction.type !== 1 || ints[0]! < 0 || (ints[1] !== 0 && ints[1] !== 1))
        throw new Error("Unsupported source Call operands");
      // Native Call reads only i0. i1=1 marks generated source helpers; their
      // ExecPuppet i0=1 supplies the actual asynchronous behavior.
      return { kind: "call", target: ints[0]! };
    case "Return":
      reserved([]);
      return { kind: "return" };
    case "SetPuppet":
      reserved([0, 1, 2]);
      if (ints[0]! < 0 || ints[0]! >= 32 || ints[2]! < 0)
        throw new Error("Unsupported source SetPuppet track or entry");
      return { kind: "puppet", slot: ints[0]!, actor: String(ints[1]!), target: ints[2]! };
    case "ExecPuppet":
      reserved([0]);
      if (ints[0] !== 0 && ints[0] !== 1)
        throw new Error("Unsupported source ExecPuppet asynchronous operand");
      return { kind: "exec-puppets", asynchronous: ints[0] === 1 };
    case "FinishPuppet":
      reserved([]);
      if (instruction.type !== 1)
        throw new Error("Unsupported source FinishPuppet instruction type");
      return { kind: "finish-puppets" };
    default:
      throw new Error("Unknown source field task mnemonic: " + instruction.mnemonic);
  }
}
