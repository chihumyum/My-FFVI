import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { validateOwnedConditionCommand, type OwnedConditionEventOp } from "../core/owned-condition.js";
import { record } from "./content.js";
import { hasMagitekBehavior } from "./conditions.js";
import { tableId } from "./table-id.js";

/** Complete instruction decoder. Type0 uses the pinned Current hook's exact
 * retained row IDs and requires a shared MainCore at runtime. */
export function compileOwnedConditionInstruction(
  raw: unknown, tables: Record<string, unknown>,
): OwnedConditionEventOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if(Object.keys(operands).sort().join(",")!=="iValues,rValues,sValues")
    throw new Error("Unsupported owned condition operand banks");
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
  if(!Object.hasOwn(tables,'condition.csv'))throw new Error('Missing owned condition master');
  const data = z.array(z.record(z.string(), z.string())).parse(tables["condition.csv"]);
  if (command.kind === "remove-condition" && command.conditionType === 0) {
    for (const [id, type] of [[53, 607], [79, 665], [80, 666]]) {
      const matches = data.filter(row => tableId(row.id) === id);
      if (matches.length !== 1 || tableId(matches[0]!.condition_type) !== type ||
          id === 53 && !hasMagitekBehavior({ values: matches[0]! }))
        throw new Error("Unresolved source retained condition row identity");
    }
    const dependencies = [53, 79, 80].map(id => ({ table: "condition.csv", id }));
    if (command.target > 0) {
      const characters = z.array(z.record(z.string(), z.string())).parse(tables["character_status.csv"]);
      if (characters.filter(row => tableId(row.id) === command.target).length !== 1)
        throw new Error("Missing or ambiguous owned character source reference");
      dependencies.push({ table: "character_status.csv", id: command.target });
    }
    return { kind: "owned-condition", command, dependencies };
  }
  const rows = data.filter((row) => tableId(row.condition_type) === command.conditionType);
  if (command.kind === "remove-condition" && command.conditionType > 0) {
    const ids = data.map(row => tableId(row.id));
    if (new Set(ids).size !== ids.length) throw new Error("Ambiguous owned condition master identity");
    if (!rows.length) throw new Error("Missing owned condition type");
    // Retain EVERY matching source row as an identity dependency. This does
    // not authorize an unknown active lifecycle, even when this instruction
    // would delete it. The actual GameState requires a valid prior snapshot.
    const dependencies = rows.map(row => ({ table: "condition.csv", id: tableId(row.id) }));
    if (command.target > 0) {
      const characters = z.array(z.record(z.string(), z.string())).parse(tables["character_status.csv"]);
      if (characters.filter(row => tableId(row.id) === command.target).length !== 1)
        throw new Error("Missing or ambiguous owned character source reference");
      dependencies.push({ table: "character_status.csv", id: command.target });
    }
    return { kind: "owned-condition", command, dependencies };
  }
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
