import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { validateOwnedConditionCommand, type OwnedConditionEventOp } from "../core/owned-condition.js";
import { record } from "./content.js";
import { hasMagitekBehavior } from "./conditions.js";
import { tableId } from "./table-id.js";

/** Complete field instruction decoder. Unsupported type 0 removal is not a
 * generic clear: it invokes script-specific NotRemoveConditionWhenAll hooks. */
export function compileOwnedConditionInstruction(
  raw: unknown, tables: Record<string, unknown>,
): OwnedConditionEventOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || !["AddCondition", "RemoveCondition"].includes(String(instruction.mnemonic)))
    throw new Error("Expected source owned condition instruction");
  const values = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (values.slice(2).some((value) => value !== 0) || reals.some((value) => value !== 0) ||
      strings.some((value) => value !== "")) throw new Error("Unsupported owned condition operand shape");
  const command = { kind: instruction.mnemonic === "AddCondition" ? "add-condition" as const : "remove-condition" as const,
    conditionType: values[0]!, target: values[1]! };
  validateOwnedConditionCommand(command);
  const data = z.array(z.record(z.string(), z.string())).parse(tables["condition.csv"]);
  const rows = data.filter((row) => tableId(row.condition_type) === command.conditionType);
  if (rows.length !== 1 || !hasMagitekBehavior({ values: rows[0]! }))
    throw new Error("Unresolved owned Magitek condition provider");
  const dependencies = [{ table: "condition.csv", id: tableId(rows[0]!.id) }];
  if (command.target > 0) {
    const characters = z.array(z.record(z.string(), z.string())).parse(tables["character_status.csv"]);
    if (characters.filter((row) => tableId(row.id) === command.target).length !== 1)
      throw new Error("Missing or ambiguous owned character source reference");
    dependencies.push({ table: "character_status.csv", id: command.target });
  }
  return { kind: "owned-condition", command, dependencies };
}
