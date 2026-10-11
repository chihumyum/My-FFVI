import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import { tableId } from "./table-id.js";
import { record } from "./content.js";
import { compileMessage } from "./message.js";
import type { FieldMessage } from "../field/types.js";
import {
  validateShopCatalog,
  type ShopCatalog,
  type ShopContent,
  type ShopProduct,
} from "../core/shop.js";

type Tables = Record<string, Record<string, string>[]>;
type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
  matching(table: string, key: string, value: string | number): BattleRow[];
};
export type ShopCompilation = {
  catalog: ShopCatalog;
  sources: BattleRow["source"][];
  blockers: { groupId?: number; contentId?: number; reason: string }[];
  /** Product rows without a ProductGroup are used by other services (inns,
   * auctions, etc.). They are not empty ordinary shops and are not admitted. */
  excludedProducts: { id: number; groupId: number; reason: string }[];
};

/** Source row order is retained within each product group. One unresolved
 * product blocks that group; we never publish a silently shortened buy list. */
export function compileShopCatalog(
  reader: Reader,
  tables: Tables,
  resolveName: (key: string) => string,
): ShopCompilation {
  const sources: BattleRow["source"][] = [],
    blockers: ShopCompilation["blockers"] = [];
  const row = (table: string, id: string | number) => {
    const result = reader.row(table, id);
    sources.push(result.source);
    return result.values;
  };
  const required = (name: string) => {
    const rows = tables[name];
    if (!Array.isArray(rows))
      throw new Error("Missing shop source table " + name);
    return rows;
  };
  const constant = (key: string) => {
    const result = reader.unique("game_constant_int.csv", "key_name", key);
    sources.push(result.source);
    return int(result.values.value1);
  };
  const name = (key: string | undefined) => {
    if (!key) throw new Error("Missing shop source name key");
    const value = resolveName(key);
    if (typeof value !== "string" || !value)
      throw new Error("Unresolved shop source name " + key);
    return value;
  };
  const catalog: ShopCatalog = {
    kind: "ordinary-shops-v1",
    pricing: "unit-price-times-count",
    itemLimit: constant("MAX_ITEM"),
    gilLimit: constant("MAX_GIL"),
    groups: [],
    products: [],
    contents: [],
  };
  const knownContents = new Map<number, ShopContent>();
  const purchasable = new Set<number>();
  for (const sourceContent of required("content.csv")) {
    const contentId = int(sourceContent.id),
      type = int(sourceContent.type_id);
    if (![1, 2, 3].includes(type)) continue;
    try {
      const content = row("content.csv", contentId),
        value = int(content.type_value);
      const table =
        type === 1 ? "item.csv" : type === 2 ? "weapon.csv" : "armor.csv";
      const data = row(table, value),
        itemType = int(data.type_id);
      if (![1, 2].includes(itemType))
        throw new Error("Unresolved shop ownership subtype");
      const aliases = reader
        .matching("content.csv", "type_value", value)
        .filter((r) => int(r.values.type_id) === type);
      sources.push(...aliases.map((r) => r.source));
      if (aliases.length !== 1)
        throw new Error("Ambiguous shop owned content identity");
      const saleNotPossible = int(data.sales_not_possible);
      if (![0, 1].includes(saleNotPossible))
        throw new Error("Unresolved shop sale restriction");
      const compiled: ShopContent = {
        id: contentId,
        kind: type === 1 ? "item" : "equipment",
        name: name(content.mes_id_name),
        buy: int(data.buy),
        sell: int(data.sell),
        sellable: itemType === 1 && saleNotPossible !== 1,
      };
      // Zero-price normal sales reach a native division by zero. Do not turn
      // that unsupported path into a free disposal operation in the browser.
      validateShopCatalog({ ...catalog, contents: [compiled] });
      if (knownContents.has(contentId))
        throw new Error("Duplicate shop content identity");
      knownContents.set(contentId, compiled);
      if (itemType === 1) purchasable.add(contentId);
      catalog.contents.push(compiled);
    } catch (error) {
      blockers.push({
        contentId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const groupIds = new Set<number>();
  for (const sourceGroup of required("product_group.csv")) {
    const groupId = int(sourceGroup.id);
    try {
      if (groupIds.has(groupId))
        throw new Error("Duplicate shop group identity");
      groupIds.add(groupId);
      const groupRow = row("product_group.csv", groupId),
        products: ShopProduct[] = [];
      for (const sourceProduct of required("product.csv").filter(
        (p) => int(p.group_id) === groupId,
      )) {
        const product = row("product.csv", int(sourceProduct.id)),
          contentId = int(product.content_id);
        const content = knownContents.get(contentId);
        if (!content)
          throw new Error("Unresolved shop product content " + contentId);
        if (!purchasable.has(contentId))
          throw new Error(
            "Important-item or empty-equipment shop purchase is not admitted",
          );
        const limit = int(product.purchase_limit);
        if (limit !== 0)
          throw new Error("Nonzero shop purchase limit is not admitted");
        const buy = content.buy + int(product.coefficient);
        products.push({
          id: int(product.id),
          groupId,
          contentId,
          buy,
          limit: 0,
        });
      }
      const group = {
        id: groupId,
        name: name(groupRow.mes_id_name),
        productIds: products.map((p) => p.id),
      };
      const candidate = {
        ...catalog,
        groups: [...catalog.groups, group],
        products: [...catalog.products, ...products],
      };
      validateShopCatalog(candidate);
      catalog.groups.push(group);
      catalog.products.push(...products);
    } catch (error) {
      blockers.push({
        groupId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const excludedProducts = required("product.csv")
    .filter((p) => !groupIds.has(int(p.group_id)))
    .map((p) => {
      row("product.csv", int(p.id));
      return {
        id: int(p.id),
        groupId: int(p.group_id),
        reason: "No ordinary ProductGroup; separate service path not admitted",
      };
    });
  validateShopCatalog(catalog);
  return {
    catalog,
    blockers,
    excludedProducts,
    sources: [
      ...new Map(
        sources.map((source) => [JSON.stringify(source), source]),
      ).values(),
    ],
  };
}

export type CompiledShopInteraction = {
  kind: "shop";
  groupId: number;
  start: FieldMessage | null;
  close: FieldMessage | null;
};

/** PropertyTalk -> EventAction.ShowShop. Script SysCall selectors deliberately
 * do not use this adapter; their fixed groups/continuations need separate proof.
 * Caller retains PropertyTalk eligibility, entity provenance and NPC behavior. */
export function compileShopInteraction(
  properties: Record<string, unknown>,
  tables: Record<string, unknown>,
  messages: Record<string, unknown>,
): CompiledShopInteraction {
  const rows = (table: string) => {
    if (!Array.isArray(tables[table]))
      throw new Error("Missing shop source table " + table);
    return (tables[table] as unknown[]).map(record);
  };
  const row = (table: string, id: number) => {
    const found = rows(table).filter((r) => tableId(r.id) === id);
    if (found.length !== 1)
      throw new Error(`Missing or ambiguous shop source ${table}:${id}`);
    return found[0]!;
  };
  const actionId = properties.action_id,
    groupId = properties.product_group_id;
  if (actionId !== 8 || row("action.csv", actionId).action_name !== "Shop")
    throw new Error("Unsupported ordinary shop action binding");
  if (
    typeof groupId !== "number" ||
    !Number.isInteger(groupId) ||
    groupId <= 0 ||
    groupId > 0x7fffffff
  )
    throw new Error("Invalid shop product group");
  row("product_group.csv", groupId);
  const products = rows("product.csv").filter(
    (p) => tableId(p.group_id) === groupId,
  );
  if (!products.length) throw new Error("Missing shop products");
  for (const product of products) {
    if (tableId(product.purchase_limit) !== 0)
      throw new Error("Nonzero shop purchase limit is not admitted");
    const content = row("content.csv", tableId(product.content_id)),
      type = tableId(content.type_id);
    if (![1, 2, 3].includes(type))
      throw new Error("Unsupported shop product ownership");
    const data = row(
      type === 1 ? "item.csv" : type === 2 ? "weapon.csv" : "armor.csv",
      tableId(content.type_value),
    );
    if (
      tableId(data.type_id) !== 1 ||
      tableId(data.buy) + tableId(product.coefficient) <= 0
    )
      throw new Error("Unsupported shop product quantity or price path");
  }
  const message = (value: unknown) => {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new Error("Invalid shop message key");
    return compileMessage(value, messages);
  };
  return {
    kind: "shop",
    groupId,
    start: message(properties.message_key),
    close: message(properties.close_message_key),
  };
}
