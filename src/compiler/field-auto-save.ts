import { z } from "zod";
import { SOURCE_AUTO_SAVE, type FieldEventSaveOp } from "../core/field-auto-save.js";

/** All 95 observed sites use this complete form. Nonempty tails or another
 * source instruction type remain blocked rather than becoming author barriers. */
export function compileFieldAutoSaveInstruction(raw: unknown): FieldEventSaveOp {
  const instruction = z.object({ mnemonic: z.literal("AutoSave"), type: z.literal(1),
    operands: z.object({ iValues: z.array(z.literal(0)).length(8),
      rValues: z.array(z.literal(0)).length(8), sValues: z.array(z.literal("")).length(8) }).strict(),
  }).parse(raw);
  void instruction;
  return { kind: "event-save", sourceAutoSave: SOURCE_AUTO_SAVE };
}
