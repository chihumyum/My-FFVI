import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../src/core/game-state.js";
import { GameSession } from "../src/core/game-session.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";
import type { ShopCatalog } from "../src/core/shop.js";

function fixture() {
  const { field, catalog } = equipmentGameFixture();
  const gear = catalog.gameState.equipmentSystem!.catalog;
  const shops: ShopCatalog = {
    kind: "ordinary-shops-v1", pricing: "unit-price-times-count",
    itemLimit: catalog.gameState.limits.item, gilLimit: catalog.gameState.limits.gil,
    groups: [{ id: 7, name: "Synthetic shop", productIds: [1001, 1002] }],
    products: [
      { id: 1001, groupId: 7, contentId: 10, buy: 30, limit: 0 },
      { id: 1002, groupId: 7, contentId: 101, buy: 40, limit: 0 },
    ],
    contents: [
      { id: 10, kind: "item", name: "Synthetic item", buy: 30, sell: 15, sellable: true },
      ...Object.values(gear.definitions).map((definition) => ({
        id: definition.id, kind: "equipment" as const, name: definition.name,
        buy: 40, sell: 20, sellable: !definition.empty,
      })),
    ],
  };
  catalog.gameState.shops = shops;
  const create = () => new GameState(catalog.gameState, catalog.common.players,
    catalog.contentHash, catalog.common.conditions);
  return { field, catalog, create, state: create() };
}

test("shop buy publishes stock and payment together exactly once and survives owned restore", () => {
  const { state, create } = fixture(), before = state.snapshot();
  const trade = state.prepareShopTrade(7, { kind: "buy", productId: 1001, count: 2 });
  assert.deepEqual(state.snapshot(), before);
  assert.equal(trade.plan.totalPrice, 60);
  trade.commit();
  const after = state.snapshot();
  assert.equal(after.gil, 30);
  assert.deepEqual(after.items, [{ id: 10, count: 2 }]);
  assert.equal(after.totalGil, before.totalGil);
  assert.throws(trade.commit, /Stale/);
  assert.deepEqual(state.snapshot(), after);
  const restored = create();
  restored.restore(JSON.parse(JSON.stringify(after)));
  assert.deepEqual(restored.snapshot(), after);
});

test("shop cannot sell equipped copies, releases only spare copies, and credits source total Gil", () => {
  const { state } = fixture();
  const before = state.snapshot();
  assert.throws(() => state.prepareShopTrade(7, { kind: "sell", contentId: 101, count: 1 }), /available quantity/);
  assert.deepEqual(state.snapshot(), before);
  state.prepareShopTrade(7, { kind: "buy", productId: 1002, count: 1 }).commit();
  assert.equal(state.shopOptions(7).sell.find((row) => row.contentId === 101)!.maxCount, 1);
  state.prepareShopTrade(7, { kind: "sell", contentId: 101, count: 1 }).commit();
  const after = state.snapshot();
  assert.deepEqual(after.equipmentStock, before.equipmentStock);
  assert.deepEqual(after.roster, before.roster);
  assert.equal(after.gil, 70);
  assert.equal(after.totalGil, before.totalGil + 20);
});

test("stale quotes, insufficient money, unknown groups and battle leases cannot publish shop state", () => {
  const { state } = fixture();
  const quote = state.prepareShopTrade(7, { kind: "buy", productId: 1001, count: 1 });
  state.fieldInventory.prepare({ kind: "pay-gil", amount: 70 }).commit();
  const before = state.snapshot();
  assert.throws(quote.commit, /Stale/);
  assert.throws(() => state.prepareShopTrade(7, { kind: "buy", productId: 1001, count: 1 }), /available quantity/);
  assert.throws(() => state.prepareShopTrade(99, { kind: "buy", productId: 1001, count: 1 }), /group/);
  const lease = state.openBattle(1000);
  assert.throws(() => state.shopOptions(7), /reserved/);
  assert.throws(() => state.prepareShopTrade(7, { kind: "buy", productId: 1001, count: 1 }), /reserved/);
  state.cancelBattle(lease);
  assert.deepEqual(state.snapshot(), before);
});

test("shop respects full-stack and Gil headroom before preparing any owned command", () => {
  const { state, catalog } = fixture();
  const saved = state.snapshot();
  saved.items = [{ id: 10, count: catalog.gameState.limits.item }];
  saved.gil = catalog.gameState.limits.gil - 14;
  state.restore(saved);
  assert.equal(state.shopOptions(7).buy.find((row) => row.productId === 1001)!.maxCount, 0);
  assert.equal(state.shopOptions(7).sell.find((row) => row.contentId === 10)!.maxCount, 0);
  assert.throws(() => state.prepareShopTrade(7, { kind: "buy", productId: 1001, count: 1 }), /available quantity/);
  assert.throws(() => state.prepareShopTrade(7, { kind: "sell", contentId: 10, count: 1 }), /available quantity/);
  assert.deepEqual(state.snapshot(), saved);
});

test("field candidates use their own inventory and no session trade bypasses a closed shop", () => {
  const { field, catalog, state } = fixture();
  const candidate = state.prepareFieldState();
  candidate.ports.inventory.prepare({ kind: "grant-item", id: 10, count: 1 }).commit();
  candidate.ports.shop.validate(7);
  assert.equal(state.snapshot().items.length, 0);
  assert.equal(candidate.commit(), true);
  assert.equal(state.snapshot().items[0]!.count, 1);
  const session = new GameSession(field, catalog);
  const before = session.state.snapshot();
  assert.throws(() => session.shopOptions(), /No ordinary shop/);
  assert.throws(() => session.tradeShop({ kind: "buy", productId: 1001, count: 1 }), /No ordinary shop/);
  assert.equal(session.closeShop(), false);
  assert.deepEqual(session.state.snapshot(), before);
});
