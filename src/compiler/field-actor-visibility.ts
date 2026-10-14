import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

export const fieldActorVisibilityMnemonics = ["Show", "Hide"] as const;

export type FieldActorVisibilityInstruction = {
  kind: "actor-visibility";
  visible: boolean;
};

/** Only the immediate Puppet wrappers are admitted here. The current task
 * selects its actor; decoding grants neither a MainCore alias nor a host for
 * child propagation, fade duration, delay or a different entity family. */
export function compileFieldActorVisibilityInstruction(raw: unknown): FieldActorVisibilityInstruction {
  const instruction = record(raw);
  if (instruction.type !== 2 ||
      instruction.mnemonic !== "Show" && instruction.mnemonic !== "Hide")
    throw new Error("Expected source Puppet Show or Hide instruction");
  const operands = z.object({
    iValues: z.array(z.unknown()).length(8),
    rValues: z.array(z.number().finite()).length(8),
    sValues: z.array(z.string()).length(8),
  }).strict().parse(instruction.operands);
  const integers = operands.iValues.map(int32);
  if (integers.some(value => value !== 0) || operands.rValues.some(value => value !== 0) ||
      operands.sValues.some(value => value !== ""))
    throw new Error("Source Puppet visibility duration, delay or reserved operands are not admitted");
  return { kind: "actor-visibility", visible: instruction.mnemonic === "Show" };
}
