import { z } from "zod";
import type { FieldPartyQueryOp } from "../core/field-party-queries.js";
import { int32, isOperator } from "../core/script-integer.js";
import { record } from "./content.js";

export const fieldPartyQueryMnemonics = ["BranchByNumOfMember"] as const;

/** This build's complete source forms have Format.type=1 and eight operands per
 * bank. The shared field compiler attaches provenance and checks dependencies;
 * decoding this read does not grant a roster provider or story reachability. */
export function compileFieldPartyQueryInstruction(raw: unknown): FieldPartyQueryOp {
  const instruction = record(raw);
  if (instruction.type !== 1)
    throw new Error("Unsupported field party query instruction type");
  if (instruction.mnemonic !== "BranchByNumOfMember")
    throw new Error("Unknown field party query mnemonic: " + instruction.mnemonic);
  const operands = record(instruction.operands);
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.slice(3).some((value) => value !== 0) ||
      reals.some((value) => value !== 0) || strings.slice(1).some((value) => value !== ""))
    throw new Error("Unsupported field party query reserved operands");
  const operator = strings[0]!;
  if (!isOperator(operator) || ints[2]! < 0)
    throw new Error("Unsupported field party query comparison or address");
  return {
    kind: "field-party-query",
    query: { kind: "member-count", scope: ints[0] === 0 ? "current-party" : "enabled-roster" },
    operator,
    value: ints[1]!,
    target: ints[2]!,
  };
}
