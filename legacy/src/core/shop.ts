import type { FieldInventoryCommand } from "./inventory-event.js";

export type ShopContent = {
  id: number;
  kind: "item" | "equipment";
  name: string;
  buy: number;
  sell: number;
  /** Important items and empty equipment slots are not normal sell-list stock. */
  sellable: boolean;
};
export type ShopProduct = {
  id: number;
  groupId: number;
  contentId: number;
  /** Base table price plus Product.Coefficient, not a percentage. */
  buy: number;
  /** This catalog admits the source's zero-limit ordinary product rows. */
  limit: 0;
};
export type ShopCatalog = {
  kind: "ordinary-shops-v1";
  /** FF6 has no concrete ShopDiscountData provider in the supplied assembly. */
  pricing: "unit-price-times-count";
  itemLimit: number;
  gilLimit: number;
  groups: { id: number; name: string; productIds: number[] }[];
  products: ShopProduct[];
  contents: ShopContent[];
};
export type ShopInventoryRead = {
  gil: number;
  /** The owner's complete item/equipment snapshot; omitted means not held.
   * Count includes equipped copies, and equipped is the full enabled roster. */
  entries: readonly {
    id: number;
    kind: "item" | "equipment";
    count: number;
    equipped: number;
  }[];
};
export type ShopTradeRequest =
  | { kind: "buy"; productId: number; count: number }
  | { kind: "sell"; contentId: number; count: number };
export type ShopTradePlan = {
  groupId: number;
  kind: "buy" | "sell";
  contentId: number;
  count: number;
  unitPrice: number;
  totalPrice: number;
  gilAfter: number;
  countAfter: number;
  /** Native order, published together by the owning GameState transaction. */
  commands: FieldInventoryCommand[];
};
export type ShopBuyOption = {
  productId: number;
  contentId: number;
  name: string;
  unitPrice: number;
  count: number;
  equipped: number;
  maxCount: number;
};
export type ShopSellOption = Omit<ShopBuyOption, "productId">;

const integer = (value: number, minimum = 0) =>
  Number.isInteger(value) && value >= minimum && value <= 0x7fffffff;

export function validateShopCatalog(catalog: ShopCatalog): void {
  if (
    !catalog ||
    catalog.kind !== "ordinary-shops-v1" ||
    catalog.pricing !== "unit-price-times-count" ||
    !integer(catalog.itemLimit, 1) ||
    !integer(catalog.gilLimit, 1) ||
    !Array.isArray(catalog.contents) ||
    !Array.isArray(catalog.products) ||
    !Array.isArray(catalog.groups)
  )
    throw new Error("Invalid ordinary shop catalog");
  const contents = new Map<number, ShopContent>();
  for (const content of catalog.contents) {
    if (
      !integer(content.id, 1) ||
      contents.has(content.id) ||
      !["item", "equipment"].includes(content.kind) ||
      typeof content.name !== "string" ||
      !content.name ||
      !integer(content.buy) ||
      !integer(content.sell) ||
      typeof content.sellable !== "boolean" ||
      (content.sellable && content.sell === 0)
    )
      throw new Error("Invalid or unresolved shop content");
    contents.set(content.id, content);
  }
  const products = new Map<number, ShopProduct>();
  for (const product of catalog.products) {
    if (
      !integer(product.id, 1) ||
      products.has(product.id) ||
      !integer(product.groupId, 1) ||
      !contents.has(product.contentId) ||
      !integer(product.buy, 1) ||
      product.limit !== 0
    )
      throw new Error("Invalid or unresolved shop product");
    products.set(product.id, product);
  }
  const groups = new Set<number>(),
    references = new Set<number>();
  for (const group of catalog.groups) {
    if (
      !integer(group.id, 1) ||
      groups.has(group.id) ||
      typeof group.name !== "string" ||
      !group.name ||
      !Array.isArray(group.productIds) ||
      !group.productIds.length
    )
      throw new Error("Invalid or unresolved shop group");
    groups.add(group.id);
    for (const id of group.productIds) {
      if (products.get(id)?.groupId !== group.id || references.has(id))
        throw new Error("Ambiguous shop product group membership");
      references.add(id);
    }
  }
  if (references.size !== products.size) throw new Error("Orphan shop product");
}

function checked(
  catalog: ShopCatalog,
  groupId: number,
  inventory: ShopInventoryRead,
) {
  validateShopCatalog(catalog);
  const group = catalog.groups.find((row) => row.id === groupId);
  if (!group) throw new Error("Unknown or blocked shop group");
  if (
    !inventory ||
    !integer(inventory.gil) ||
    inventory.gil > catalog.gilLimit ||
    !Array.isArray(inventory.entries)
  )
    throw new Error("Invalid shop inventory snapshot");
  const contents = new Map(catalog.contents.map((row) => [row.id, row]));
  const stock = new Map<number, ShopInventoryRead["entries"][number]>();
  for (const row of inventory.entries) {
    if (
      !integer(row.id, 1) ||
      stock.has(row.id) ||
      contents.get(row.id)?.kind !== row.kind ||
      !integer(row.count) ||
      row.count > catalog.itemLimit ||
      !integer(row.equipped) ||
      row.equipped > row.count ||
      (row.kind === "item" && row.equipped !== 0)
    )
      throw new Error("Invalid or unresolved shop stock ownership");
    stock.set(row.id, row);
  }
  return { group, contents, stock };
}

/** The native buy confirmation caps the quantity using total Count, not the
 * unequipped count. The UI does not offer an over-capacity purchase. */
export function shopBuyOptions(
  catalog: ShopCatalog,
  groupId: number,
  inventory: ShopInventoryRead,
): ShopBuyOption[] {
  const { group, contents, stock } = checked(catalog, groupId, inventory);
  const products = new Map(catalog.products.map((row) => [row.id, row]));
  return group.productIds.map((id) => {
    const product = products.get(id)!,
      content = contents.get(product.contentId)!;
    const owned = stock.get(content.id),
      count = owned?.count ?? 0;
    return {
      productId: id,
      contentId: content.id,
      name: content.name,
      unitPrice: product.buy,
      count,
      equipped: owned?.equipped ?? 0,
      maxCount: Math.min(
        catalog.itemLimit - count,
        Math.floor(inventory.gil / product.buy),
      ),
    };
  });
}

/** Any admitted ordinary shop accepts normal saleable owned content, even if
 * that content is absent from the shop's buy list. Preserve owner list order. */
export function shopSellOptions(
  catalog: ShopCatalog,
  groupId: number,
  inventory: ShopInventoryRead,
): ShopSellOption[] {
  const { contents } = checked(catalog, groupId, inventory);
  return inventory.entries
    .filter((row) => row.count > 0 && contents.get(row.id)!.sellable)
    .map((row) => {
      const content = contents.get(row.id)!;
      return {
        contentId: row.id,
        name: content.name,
        unitPrice: content.sell,
        count: row.count,
        equipped: row.equipped,
        maxCount: Math.min(
          row.count - row.equipped,
          Math.floor((catalog.gilLimit - inventory.gil) / content.sell),
        ),
      };
    });
}

/** Projects the reachable native confirmation path. The host must verify its
 * active field shop, run every command on one private owned candidate, and
 * reject a stale/repeated commit. No inventory is retained in this module. */
export function projectShopTrade(
  catalog: ShopCatalog,
  groupId: number,
  request: ShopTradeRequest,
  inventory: ShopInventoryRead,
): ShopTradePlan {
  if (!request || !integer(request.count, 1))
    throw new Error("Invalid shop trade quantity");
  let option: ShopBuyOption | ShopSellOption | undefined;
  if (request.kind === "buy") {
    option = shopBuyOptions(catalog, groupId, inventory).find(
      (row) => row.productId === request.productId,
    );
  } else if (request.kind === "sell") {
    option = shopSellOptions(catalog, groupId, inventory).find(
      (row) => row.contentId === request.contentId,
    );
  } else throw new Error("Unknown shop trade kind");
  if (!option) throw new Error("Shop does not offer this trade");
  if (request.count > option.maxCount)
    throw new Error("Shop trade exceeds affordable or available quantity");
  const totalPrice = option.unitPrice * request.count;
  if (!integer(totalPrice, 1))
    throw new Error("Shop price overflow is not admitted");
  const content = catalog.contents.find((row) => row.id === option.contentId)!;
  const buying = request.kind === "buy";
  const itemCommand: FieldInventoryCommand = {
    kind: buying
      ? content.kind === "item"
        ? "grant-item"
        : "grant-equipment"
      : content.kind === "item"
        ? "remove-item"
        : "remove-equipment",
    id: content.id,
    count: request.count,
  };
  return {
    groupId,
    kind: request.kind,
    contentId: content.id,
    count: request.count,
    unitPrice: option.unitPrice,
    totalPrice,
    gilAfter: inventory.gil + (buying ? -totalPrice : totalPrice),
    countAfter: option.count + (buying ? request.count : -request.count),
    commands: [
      itemCommand,
      buying
        ? { kind: "pay-gil", amount: totalPrice }
        : { kind: "grant-gil", amount: totalPrice },
    ],
  };
}
