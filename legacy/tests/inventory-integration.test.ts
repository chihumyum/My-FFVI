import test from "node:test";
import assert from "node:assert/strict";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { GameSession } from "../src/core/game-session.js";
import type { Op } from "../src/field/types.js";
import type { FieldInventoryCommand } from "../src/core/inventory-event.js";

const site = {
  script: "inventory-fixture",
  index: 0,
  source: { file: "synthetic", assetPath: "inventory-integration" },
};
const inventory = (command: FieldInventoryCommand): Op => ({
  ...site,
  kind: "inventory",
  command,
  result:
    command.kind === "pay-gil"
      ? { category: "MapLocalVariable", index: 0 }
      : null,
  dependencies: [],
});
const exit: Op = { ...site, kind: "exit" };

test("field inventory transactions reject stale, duplicate and battle-owned writes", () => {
  const { game } = checkpointFixture(),
    state = game.state;
  const before = state.snapshot();
  const grant = state.fieldInventory.prepare({
    kind: "grant-item",
    id: 10,
    count: 4,
  });
  const stale = state.fieldInventory.prepare({ kind: "pay-gil", amount: 20 });
  assert.equal(stale.result, true);
  assert.deepEqual(state.snapshot(), before);
  grant.commit();
  assert.equal(state.snapshot().items[0]!.count, 4);
  assert.throws(grant.commit, /Stale/);
  assert.throws(stale.commit, /Stale/);
  state.fieldInventory
    .prepare({ kind: "remove-item", id: 10, count: 99 })
    .commit();
  assert.equal(state.snapshot().items[0]!.count, 0);
  state.fieldInventory
    .prepare({ kind: "grant-item", id: 10, count: 1000 })
    .commit();
  assert.equal(state.snapshot().items[0]!.count, 99);
  const invalid = state.snapshot();
  assert.throws(
    () =>
      state.fieldInventory.prepare({ kind: "grant-item", id: 999, count: 1 }),
    /Unimplemented/,
  );
  assert.deepEqual(state.snapshot(), invalid);
  const late = state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 });
  game.field.startEvent("fight");
  game.advance(10);
  assert.throws(late.commit, /reserved/);
  assert.throws(
    () =>
      state.fieldInventory.prepare({ kind: "remove-item", id: 10, count: 1 }),
    /reserved/,
  );
  assert.equal(game.battle!.inventory[0]!.count, 99);
});

test("field grants, menu consumption, saturated removal and affordable fees share owned state and checkpoints", () => {
  const f = checkpointFixture(),
    game = f.game;
  f.field.scripts.grant = [
    inventory({ kind: "grant-item", id: 10, count: 2 }),
    exit,
  ];
  f.field.scripts.pay = [inventory({ kind: "pay-gil", amount: 50 }), exit];
  f.field.scripts.remove = [
    inventory({ kind: "remove-item", id: 10, count: 8 }),
    exit,
  ];
  game.field.startEvent("grant");
  assert.equal(game.state.snapshot().items[0]!.count, 2);
  const hurt = game.state.snapshot();
  hurt.roster[0]!.hp = 1;
  game.state.restore(hurt);
  game.advance(10);
  assert.equal(game.useMenuItem(10, "a"), true);
  assert.equal(game.state.snapshot().items[0]!.count, 1);
  game.field.startEvent("pay");
  game.advance(10);
  assert.equal(game.gil, 40);
  assert.equal(
    game.field.eventState.read({ category: "MapLocalVariable", index: 0 }),
    1,
  );
  game.field.startEvent("pay");
  game.advance(10);
  assert.equal(game.gil, 40);
  assert.equal(
    game.field.eventState.read({ category: "MapLocalVariable", index: 0 }),
    0,
  );
  game.field.startEvent("remove");
  game.advance(10);
  assert.equal(game.state.snapshot().items[0]!.count, 0);
  const restored = GameSession.restore(game.checkpoint(), f.field, f.battle);
  assert.deepEqual(restored.checkpoint(), game.checkpoint());
  restored.field.startEvent("grant");
  restored.advance(10);
  assert.equal(restored.state.snapshot().items[0]!.count, 2);
  assert.equal(game.state.snapshot().items[0]!.count, 0);
});

test("failed map preparation discards early inventory writes and affordability results", () => {
  const f = checkpointFixture(),
    game = f.game;
  f.target.scripts.init = [
    inventory({ kind: "grant-item", id: 10, count: 2 }),
    inventory({ kind: "pay-gil", amount: 50 }),
    { ...site, kind: "blocked", mnemonic: "unknown", reason: "Not migrated" },
  ];
  game.field.previewMap(2, 1);
  const before = game.state.snapshot(),
    variables = game.field.eventState.snapshot(),
    field = game.field;
  assert.throws(() => game.world.prepare(f.world, f.target), /Not migrated/);
  assert.deepEqual(game.state.snapshot(), before);
  assert.deepEqual(game.field.eventState.snapshot(), variables);
  assert.equal(game.field, field);
});

test("map publication commits a private inventory draft once and rebinds later events to the live owner", () => {
  const f = checkpointFixture(),
    game = f.game;
  f.target.scripts.init = [
    inventory({ kind: "grant-item", id: 10, count: 2 }),
    inventory({ kind: "pay-gil", amount: 50 }),
    exit,
  ];
  f.target.scripts.later = [
    inventory({ kind: "grant-item", id: 10, count: 1 }),
    exit,
  ];
  game.field.previewMap(2, 1);
  const before = game.state.snapshot();
  const a = game.world.prepare(f.world, f.target),
    b = game.world.prepare(f.world, f.target);
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(
    a.field.eventState.read({ category: "MapLocalVariable", index: 0 }),
    1,
  );
  assert.equal(game.world.commit(a), true);
  assert.equal(game.world.commit(b), false);
  assert.equal(game.world.commit(a), false);
  game.advance(10);
  assert.equal(game.gil, 40);
  assert.equal(game.state.snapshot().items[0]!.count, 2);
  game.field.startEvent("later");
  game.advance(10);
  assert.equal(game.state.snapshot().items[0]!.count, 3);
  const copy = GameSession.restore(game.checkpoint(), f.field, f.battle, {
    catalog: f.world,
    map: f.target,
  });
  assert.deepEqual(copy.checkpoint(), game.checkpoint());
  copy.field.startEvent("later");
  copy.advance(10);
  assert.equal(copy.state.snapshot().items[0]!.count, 4);
  assert.equal(game.state.snapshot().items[0]!.count, 3);
});

test("late map loads cannot overwrite intervening owned state, and draft ports cannot replay before publication", () => {
  const f = checkpointFixture(),
    game = f.game;
  f.target.scripts.init = [
    inventory({ kind: "grant-item", id: 10, count: 2 }),
    exit,
  ];
  game.field.previewMap(2, 1);
  const prepared = game.world.prepare(f.world, f.target),
    from = game.field;
  game.state.changeItems([{ id: 10, count: 1 }], "grant");
  assert.equal(game.world.commit(prepared), false);
  assert.equal(game.field, from);
  assert.equal(game.state.snapshot().items[0]!.count, 1);
  const draft = game.state.prepareFieldState();
  const late = draft.ports.inventory.prepare({ kind: "grant-gil", amount: 15 });
  draft.ports.inventory.prepare({ kind: "pay-gil", amount: 0 }).commit();
  assert.throws(late.commit, /Stale/);
  const beforePublish = draft.ports.inventory.prepare({
    kind: "grant-gil",
    amount: 16,
  });
  assert.equal(draft.commit(), true);
  assert.throws(beforePublish.commit, /Stale/);
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 17 }).commit();
  assert.equal(game.gil, 107);
});
