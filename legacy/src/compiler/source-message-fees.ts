import { z } from "zod";
import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import { tableId } from "./table-id.js";
import type { BattleRow } from "./battle.js";
import { parseSourceMessageFeeCatalog, type SourceGilTagOp, type SourceMessageFeeCatalog } from "../core/source-message-fees.js";

function fee(rows: Record<string, unknown>[], groupId: number) {
  const found = rows.filter(row => tableId(row.group_id) === groupId);
  if (found.length !== 1) throw new Error("Missing or ambiguous source message fee group " + groupId);
  const row = found[0]!, productId = tableId(row.id), amount = tableId(row.coefficient);
  if (productId < 1 || groupId < 1 || tableId(row.content_id) !== 0 || amount < 0)
    throw new Error("Source message fee is not an ordinary nonnegative service fee");
  return { groupId, productId, amount };
}
export function compileSourceGilTagInstruction(raw: unknown, tables: Record<string, unknown>): SourceGilTagOp {
  const op = record(raw), operands = record(op.operands);
  const i = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    r = z.array(z.number().finite()).length(8).parse(operands.rValues), s = z.array(z.string()).length(8).parse(operands.sValues);
  if (op.type !== 1 || op.mnemonic !== "SetGilTag" || i.slice(1).some(v => v !== 0) ||
      r.some(v => v !== 0) || s.some(v => v !== "")) throw new Error("Unsupported source SetGilTag operands");
  const rows = z.array(z.unknown()).parse(tables["product.csv"]).map(record), value = fee(rows, i[0]!);
  return { kind: "source-gil-tag", ...value, dependencies: [{ table: "product.csv", id: value.productId }] };
}
export function compileSourceMessageFees(reader: { row(table: string, id: number): BattleRow },
  tables: Record<string, Record<string, string>[]>, sourceSetHash: string) {
  const rows = tables["product.csv"];
  if (!rows) throw new Error("Complete source Product table is unavailable");
  const ids = [...new Set(rows.filter(row => tableId(row.content_id) === 0).map(row => tableId(row.group_id)))].sort((a, b) => a - b);
  const catalog: SourceMessageFeeCatalog = { kind: "source-message-fees-v1", sourceSetHash, fees: [], blockers: [] },
    blockers: { groupId: number; reason: string }[] = [];
  for (const id of ids) {
    try {
      const value = fee(rows, id), bound = reader.row("product.csv", value.productId);
      if (JSON.stringify(fee([bound.values], id)) !== JSON.stringify(value)) throw new Error("Product reader/source row mismatch");
      catalog.fees.push({ ...value, source: structuredClone(bound.source) });
    } catch (error) { blockers.push({ groupId: id, reason: error instanceof Error ? error.message : String(error) }); }
  }
  catalog.blockers = structuredClone(blockers);
  return { catalog: parseSourceMessageFeeCatalog(catalog), blockers };
}
