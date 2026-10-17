import test from "node:test";
import assert from "node:assert/strict";
import {
  projectShopTrade,
  shopBuyOptions,
  shopSellOptions,
  validateShopCatalog,
  type ShopCatalog,
  type ShopInventoryRead,
} from "../src/core/shop.js";
import {
  compileShopCatalog,
  compileShopInteraction,
} from "../src/compiler/shop.js";
import { battleTableIndex } from "../src/compiler/battle.js";

function catalog(): ShopCatalog {
  return {
    kind: "ordinary-shops-v1",
    pricing: "unit-price-times-count",
    itemLimit: 99,
    gilLimit: 9999,
    contents: [
      {
        id: 20,
        kind: "item",
        name: "Potion",
        buy: 50,
        sell: 25,
        sellable: true,
      },
      {
        id: 21,
        kind: "equipment",
        name: "Blade",
        buy: 150,
        sell: 75,
        sellable: true,
      },
      { id: 22, kind: "item", name: "Key", buy: 0, sell: 0, sellable: false },
      {
        id: 23,
        kind: "equipment",
        name: "Unsaleable",
        buy: 20,
        sell: 10,
        sellable: false,
      },
    ],
    products: [
      { id: 100, groupId: 1, contentId: 20, buy: 50, limit: 0 },
      { id: 101, groupId: 2, contentId: 21, buy: 75, limit: 0 },
    ],
    groups: [
      { id: 1, name: "Items", productIds: [100] },
      { id: 2, name: "Weapons", productIds: [101] },
    ],
  };
}
const inventory = (gil = 1000): ShopInventoryRead => ({
  gil,
  entries: [
    { id: 20, kind: "item", count: 98, equipped: 0 },
    { id: 21, kind: "equipment", count: 4, equipped: 3 },
    { id: 22, kind: "item", count: 1, equipped: 0 },
    { id: 23, kind: "equipment", count: 1, equipped: 0 },
  ],
});

test("buy confirmation respects money and total stock including worn equipment", () => {
  const c = catalog(),
    stock = inventory();
  assert.equal(shopBuyOptions(c, 1, stock)[0]!.maxCount, 1);
  assert.equal(shopBuyOptions(c, 2, inventory(74))[0]!.maxCount, 0);
  stock.entries = [{ id: 21, kind: "equipment", count: 98, equipped: 3 }];
  assert.equal(shopBuyOptions(c, 2, stock)[0]!.maxCount, 1);
  assert.throws(
    () =>
      projectShopTrade(c, 2, { kind: "buy", productId: 101, count: 2 }, stock),
    /quantity/,
  );
});

test("buy plan keeps native grant then payment together and never mutates caller state", () => {
  const c = catalog(),
    stock = inventory(),
    before = structuredClone(stock);
  const plan = projectShopTrade(
    c,
    1,
    { kind: "buy", productId: 100, count: 1 },
    stock,
  );
  assert.deepEqual(plan.commands, [
    { kind: "grant-item", id: 20, count: 1 },
    { kind: "pay-gil", amount: 50 },
  ]);
  assert.equal(plan.gilAfter, 950);
  assert.equal(plan.countAfter, 99);
  assert.deepEqual(stock, before);
  plan.commands[0] = { kind: "remove-item", id: 20, count: 40 };
  assert.deepEqual(stock, before);
});

test("sale refuses equipped copies from any enabled roster member", () => {
  const c = catalog(),
    stock = inventory();
  const gear = shopSellOptions(c, 1, stock).find(
    (row) => row.contentId === 21,
  )!;
  assert.equal(gear.maxCount, 1);
  const plan = projectShopTrade(
    c,
    1,
    { kind: "sell", contentId: 21, count: 1 },
    stock,
  );
  assert.deepEqual(plan.commands, [
    { kind: "remove-equipment", id: 21, count: 1 },
    { kind: "grant-gil", amount: 75 },
  ]);
  assert.equal(plan.countAfter, 3);
  assert.throws(
    () =>
      projectShopTrade(c, 1, { kind: "sell", contentId: 21, count: 2 }, stock),
    /quantity/,
  );
});

test("sale confirmation caps quantity before MAX_GIL instead of losing overflow proceeds", () => {
  const c = catalog(),
    stock = inventory(9950);
  assert.equal(
    shopSellOptions(c, 1, stock).find((row) => row.contentId === 20)!.maxCount,
    1,
  );
  assert.equal(
    shopSellOptions(c, 1, stock).find((row) => row.contentId === 21)!.maxCount,
    0,
  );
  assert.throws(
    () =>
      projectShopTrade(c, 1, { kind: "sell", contentId: 20, count: 2 }, stock),
    /quantity/,
  );
  assert.equal(
    projectShopTrade(c, 1, { kind: "sell", contentId: 20, count: 1 }, stock)
      .gilAfter,
    9975,
  );
});

test("all ordinary shops accept saleable inventory independently of their own buy list", () => {
  const c = catalog(),
    stock = inventory();
  assert.deepEqual(
    shopSellOptions(c, 1, stock).map((row) => row.contentId),
    [20, 21],
  );
  assert.throws(
    () =>
      projectShopTrade(c, 1, { kind: "buy", productId: 101, count: 1 }, stock),
    /offer/,
  );
  for (const id of [22, 23])
    assert.throws(
      () =>
        projectShopTrade(
          c,
          1,
          { kind: "sell", contentId: id, count: 1 },
          stock,
        ),
      /offer/,
    );
});

test("absence is zero ownership while unresolved or damaged snapshot entries are rejected", () => {
  const c = catalog();
  assert.equal(shopBuyOptions(c, 1, { gil: 100, entries: [] })[0]!.maxCount, 2);
  const invalid: ShopInventoryRead[] = [
    { gil: -1, entries: [] },
    { gil: 10000, entries: [] },
    { gil: 50, entries: [{ id: 404, kind: "item", count: 1, equipped: 0 }] },
    {
      gil: 50,
      entries: [{ id: 20, kind: "equipment", count: 1, equipped: 0 }],
    },
    { gil: 50, entries: [{ id: 20, kind: "item", count: 1, equipped: 1 }] },
    {
      gil: 50,
      entries: [{ id: 21, kind: "equipment", count: 1, equipped: 2 }],
    },
    { gil: 50, entries: [{ id: 20, kind: "item", count: 100, equipped: 0 }] },
  ];
  const duplicate = inventory();
  duplicate.entries = [...duplicate.entries, duplicate.entries[0]!];
  invalid.push(duplicate);
  for (const stock of invalid) assert.throws(() => shopBuyOptions(c, 1, stock));
});

test("unknown shop, zero/negative quantities and forged pricing modes cannot prepare a trade", () => {
  const c = catalog();
  for (const count of [0, -1, 1.5, 0x80000000])
    assert.throws(() =>
      projectShopTrade(
        c,
        1,
        { kind: "buy", productId: 100, count },
        inventory(),
      ),
    );
  assert.throws(() => shopSellOptions(c, 404, inventory()), /group/);
  const changed = structuredClone(c) as unknown as Record<string, unknown>;
  changed.pricing = "story-discount";
  assert.throws(() => validateShopCatalog(changed as ShopCatalog), /catalog/);
  c.products[0]!.buy = 0;
  assert.throws(() => validateShopCatalog(c), /product/);
});

function fixture() {
  const tables: Record<string, Record<string, string>[]> = {
    "game_constant_int.csv": [
      { id: "1", key_name: "MAX_ITEM", value1: "99" },
      { id: "2", key_name: "MAX_GIL", value1: "9999" },
    ],
    "content.csv": [
      { id: "20", type_id: "1", type_value: "10", mes_id_name: "POTION" },
      { id: "21", type_id: "2", type_value: "11", mes_id_name: "BLADE" },
      { id: "22", type_id: "1", type_value: "12", mes_id_name: "KEY" },
    ],
    "item.csv": [
      {
        id: "10",
        type_id: "1",
        buy: "50",
        sell: "25",
        sales_not_possible: "0",
      },
      { id: "12", type_id: "2", buy: "0", sell: "0", sales_not_possible: "0" },
    ],
    "weapon.csv": [
      {
        id: "11",
        type_id: "1",
        buy: "150",
        sell: "75",
        sales_not_possible: "0",
      },
    ],
    "armor.csv": [],
    "product_group.csv": [
      { id: "1", mes_id_name: "ITEMS" },
      { id: "2", mes_id_name: "WEAPONS" },
    ],
    "product.csv": [
      {
        id: "100",
        group_id: "1",
        content_id: "20",
        coefficient: "10",
        purchase_limit: "0",
      },
      {
        id: "101",
        group_id: "2",
        content_id: "21",
        coefficient: "-75",
        purchase_limit: "0",
      },
      {
        id: "102",
        group_id: "101",
        content_id: "0",
        coefficient: "80",
        purchase_limit: "0",
      },
    ],
    "action.csv": [{ id: "8", action_name: "Shop" }],
  };
  const compile = () =>
    compileShopCatalog(
      battleTableIndex(
        tables,
        Object.fromEntries(
          Object.keys(tables).map((table) => [
            table,
            {
              file: "synthetic",
              assetPath: table,
              objectId: "90071992547409931",
              serializedFile: "synthetic",
            },
          ]),
        ),
      ),
      tables,
      (key) => key,
    );
  return { tables, compile };
}

test("source price uses additive coefficient and source sell value without applying buy discount to resale", () => {
  const { compile } = fixture(),
    result = compile();
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(
    result.catalog.products.map((p) => p.buy),
    [60, 75],
  );
  assert.equal(result.catalog.contents.find((c) => c.id === 21)!.sell, 75);
  assert.deepEqual(
    result.excludedProducts.map((p) => p.id),
    [102],
  );
  assert.ok(result.sources.every((s) => s.objectId === "90071992547409931"));
});

test("an unresolved product blocks its entire group without shortening or reordering other groups", () => {
  const f = fixture();
  f.tables["product.csv"]!.push({
    id: "103",
    group_id: "1",
    content_id: "999",
    coefficient: "0",
    purchase_limit: "0",
  });
  const result = f.compile();
  assert.deepEqual(
    result.catalog.groups.map((g) => g.id),
    [2],
  );
  assert.deepEqual(
    result.catalog.products.map((p) => p.id),
    [101],
  );
  assert.match(result.blockers[0]!.reason, /content 999/);
});

test("nonzero purchase limits, important-item sales paths and empty equipment purchases stay explicit blockers", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.tables["product.csv"]![0]!.purchase_limit = "1";
    },
    (f: ReturnType<typeof fixture>) => {
      f.tables["product.csv"]![0]!.content_id = "22";
      f.tables["product.csv"]![0]!.coefficient = "10";
    },
    (f: ReturnType<typeof fixture>) => {
      f.tables["weapon.csv"]![0]!.type_id = "2";
    },
  ]) {
    const f = fixture();
    change(f);
    assert.equal(f.compile().catalog.groups.length, 1);
    assert.equal(f.compile().blockers.length, 1);
  }
});

test("ordinary interaction preserves optional before/after messages and excludes script shop selectors", () => {
  const f = fixture(),
    messages = {
      story_mes_zhc: { START: "Welcome", CLOSE: "Goodbye" },
      story_cha_zhc: { START: "", CLOSE: "" },
    };
  const p = {
    action_id: 8,
    product_group_id: 1,
    message_key: "START",
    close_message_key: "CLOSE",
  };
  const result = compileShopInteraction(p, f.tables, messages);
  assert.equal(result.start!.text, "Welcome");
  assert.equal(result.close!.text, "Goodbye");
  assert.deepEqual(
    compileShopInteraction(
      { ...p, message_key: "", close_message_key: "" },
      f.tables,
      messages,
    ),
    { kind: "shop", groupId: 1, start: null, close: null },
  );
  assert.throws(
    () => compileShopInteraction({ ...p, action_id: 2 }, f.tables, messages),
    /action/,
  );
  assert.throws(
    () =>
      compileShopInteraction(
        { ...p, product_group_id: 101 },
        f.tables,
        messages,
      ),
    /source/,
  );
  messages.story_mes_zhc.START = "<UNKNOWN>";
  assert.throws(
    () => compileShopInteraction(p, f.tables, messages),
    /inline control/,
  );
});
