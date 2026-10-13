import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { validateFieldRecoveryCommand, type FieldRecoveryEventOp } from "../core/field-recovery.js";
import { record } from "./content.js";
import { tableId } from "./table-id.js";

/** Decode the complete source operand banks. MP count recovery is a different
 * resource provider and cannot be represented as ordinary owned scalar MP. */
export function compileFieldRecoveryInstruction(
  raw: unknown, tables: Record<string, unknown>,
): FieldRecoveryEventOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (Object.keys(operands).sort().join(",") !== "iValues,rValues,sValues")
    throw new Error("Unsupported field recovery operand banks");
  if (instruction.type !== 1 || !["RecoveryHP", "RecoveryMP"].includes(String(instruction.mnemonic)))
    throw new Error("Expected source field recovery instruction");
  const values = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  // Explicit admission uses the observed Boolean/resource domain. Native
  // flags compare ==1 and MP compares !=0; unevidenced other integers are not
  // automatically admitted as equivalent source content.
  if (![0, 1].includes(values[1]!) || ![0, 1].includes(values[2]!) ||
      values.slice(5).some(value => value !== 0) || reals.some(value => value !== 0) ||
      strings.some(value => value !== "")) throw new Error("Unsupported field recovery operand shape");
  const hp = instruction.mnemonic === "RecoveryHP";
  if (hp ? values[3] !== 0 : values[3] !== 1)
    throw new Error(hp ? "Unsupported HP recovery resource mode" : "MP count recovery provider is unavailable");
  const command = { kind: hp ? "recover-hp" as const : "recover-mp" as const,
    amount: values[0]!, target: values[4]!, allowUnableFight: values[1] === 1,
    allowMineralization: values[2] === 1 };
  validateFieldRecoveryCommand(command);
  const dependencies: FieldRecoveryEventOp["dependencies"] = [];
  // These are predicate/removal identities, not permission to persist or
  // simulate otherwise unimplemented active conditions (including row 100).
  const types = [...(hp ? [4] : []), ...(hp || !command.allowUnableFight ? [5] : []),
    ...(!command.allowMineralization ? [11] : [])];
  if (types.length) {
    const data = z.array(z.record(z.string(), z.string())).parse(tables["condition.csv"]);
    const identities = data.map(row => tableId(row.id));
    if (identities.some(id => id <= 0) || new Set(identities).size !== identities.length)
      throw new Error("Ambiguous or invalid field recovery condition identity");
    for (const type of types) {
      const rows = data.filter(row => tableId(row.condition_type) === type);
      if (!rows.length) throw new Error("Missing field recovery condition type reference: " + type);
      const ids = rows.map(row => tableId(row.id));
      for (const id of ids) dependencies.push({ table: "condition.csv", id });
    }
  }
  if (command.target > 0) {
    const characters = z.array(z.record(z.string(), z.string())).parse(tables["character_status.csv"]);
    if (characters.filter(row => tableId(row.id) === command.target).length !== 1)
      throw new Error("Missing or ambiguous owned character source reference");
    dependencies.push({ table: "character_status.csv", id: command.target });
  }
  return { kind: "field-recovery", command, dependencies };
}
