import type { InventoryEventOp } from "../core/inventory-event.js";
import { record } from "./content.js";
import { tableId } from "./table-id.js";

/** The caller has already checked the instruction's complete operand shape. */
export function compileInventoryEvent(
  mnemonic: "GetItem" | "RemoveItem" | "RemoveGil",
  values: readonly number[],
  tables: Record<string, unknown>,
): InventoryEventOp {
  const rows = (table: string) => {
    const data = tables[table];
    if (!Array.isArray(data))
      throw new Error(`Missing inventory table ${table}`);
    return data.map(record);
  };
  const row = (table: string, id: number) => {
    const found = rows(table).filter((r) => tableId(r.id) === id);
    if (found.length !== 1)
      throw new Error(
        `Missing or ambiguous inventory dependency ${table}:${id}`,
      );
    return found[0]!;
  };
  const id = tableId(values[0]);
  if (id <= 0) throw new Error("Invalid inventory event reference");
  if (mnemonic === "RemoveGil") {
    // External.Misc.RemoveGil queries Product.GroupId, then reads Coefficient.
    // Reject an ambiguous group instead of relying on native dictionary order.
    const found = rows("product.csv").filter((r) => tableId(r.group_id) === id);
    if (found.length !== 1)
      throw new Error(`Missing or ambiguous field payment group ${id}`);
    const product = found[0]!,
      amount = tableId(product.coefficient);
    if (tableId(product.content_id) !== 0 || amount < 0)
      throw new Error("Field payment is not an ordinary nonnegative fee");
    return {
      kind: "inventory",
      command: { kind: "pay-gil", amount },
      result: { category: "MapLocalVariable", index: 0 },
      dependencies: [{ table: "product.csv", id: tableId(product.id) }],
    };
  }
  const count = tableId(values[1]);
  if (count <= 0) throw new Error("Field item count must be positive");
  const content = row("content.csv", id),
    type = tableId(content.type_id);
  const dependencies = [{ table: "content.csv", id }];
  if (type === 5 && mnemonic === "GetItem")
    return {
      kind: "inventory",
      command: { kind: "grant-gil", amount: count },
      result: null,
      dependencies,
    };
  if (type !== 1)
    throw new Error(`Field inventory content type ${type} is not implemented`);
  const itemId = tableId(content.type_value),
    item = row("item.csv", itemId);
  if (![1, 2].includes(tableId(item.type_id)))
    throw new Error("Unsupported field item ownership type");
  dependencies.push({ table: "item.csv", id: itemId });
  return {
    kind: "inventory",
    command: {
      kind: mnemonic === "GetItem" ? "grant-item" : "remove-item",
      id,
      count,
    },
    result: null,
    dependencies,
  };
}
