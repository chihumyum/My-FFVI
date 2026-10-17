import { z } from "zod";
import { record } from "./content.js";
import { parseSourceEncounterCommand, type SourceEncounterCommand, type SourceEncounterOp } from "../core/source-encounter.js";
import { int32 } from "../core/script-integer.js";

/** External.Misc.Encount b50dd0 -> Choose b50860/Call b4ebe0 -> callback
 * b555b0. Raw retained by the corpus; this adapter never chooses a battle,
 * reads mutable foot/camera state or grants a presentation provider. */
export function compileSourceEncounterInstruction(raw: unknown): SourceEncounterOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.mnemonic !== "Encount" || instruction.type !== 1)
    throw new Error("Expected source MainCore Encount instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.slice(5).some(value => value !== 0) || reals.some(value => value !== 0) || strings.slice(1).some(value => value !== ""))
    throw new Error("Unassessed source encounter reserved operands");
  const command: SourceEncounterCommand = { kind: "source-encounter", slots: [ints[0]!, ints[1]!, ints[2]!, ints[3]!],
    effectId: ints[4]!, continuation: strings[0]!, footCapture: "before-player-sync" };
  return { kind: "source-encounter", command: parseSourceEncounterCommand(command) };
}

/** Inspection-only dependency discovery. Positive literal identities in the
 * four source-proven slots survive other invalid operands, with exact indices.
 * A blocked/raw candidate is not field/runtime/lottery admission. */
export function sourceEncounterLiteralCandidates(raw: unknown): { slotIndex: 0 | 1 | 2 | 3; partyId: number }[] {
  const instruction = record(raw);
  if (instruction.mnemonic !== "Encount" || instruction.type !== 1) return [];
  const operands = record(instruction.operands), ints = operands.iValues;
  if (!Array.isArray(ints)) return [];
  return Array.from({ length: Math.min(4, ints.length) }, (_, index) => ({ index, value: ints[index] }))
    .flatMap(({ index, value }) => Number.isInteger(value) && value > 0 && value <= 0x7fffffff
      ? [{ slotIndex: index as 0 | 1 | 2 | 3, partyId: value as number }] : []);
}
