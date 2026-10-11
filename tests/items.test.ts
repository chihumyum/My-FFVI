import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { GameState, type GameStateContent } from "../src/core/game-state.js";
import { GameSession } from "../src/core/game-session.js";
import { battleTableIndex } from "../src/compiler/battle.js";
import { compileItem } from "../src/compiler/items.js";
import { fixture } from "./fixtures/battle-content.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { itemFixture } from "./fixtures/items.js";

function stateFixture() {
  const battle = fixture();
  battle.commands[200] = {
    id: 200,
    kind: "item",
    name: "Items",
    abilityIds: [],
    forbiddenConditionIds: [],
  };
  battle.players.forEach((p) => p.commands.push(200));
  const content: GameStateContent = {
    kind: "game-state-development-v1",
    initialGil: 0,
    limits: { gil: 999, item: 99, hp: 9999, mp: 999, level: 99, exp: 15000000 },
    items: { 10: itemFixture(), 20: itemFixture(20, true) },
    initialItems: [
      { id: 10, count: 1 },
      { id: 20, count: 1 },
    ],
    equipment: Object.fromEntries(
      battle.players.map((p) => [p.id, [1, 2, 3, 4, 5, 6]]),
    ),
  };
  const owned = new GameState(
    content,
    battle.players,
    "fixture",
    battle.conditions,
  );
  return { battle, content, owned };
}
function combat(count = 1) {
  const f = stateFixture();
  if (count > 1) f.owned.changeItems([{ id: 10, count: count - 1 }], "grant");
  const lease = f.owned.openBattle(f.battle.encounterId);
  const b = new BattleGame(
    f.battle,
    43,
    f.owned.battlePlayers(lease),
    f.owned.battleInventory(lease),
  );
  b.players.forEach((p) => {
    p.atb = 100;
    p.hp = 1;
  });
  b.enemies.forEach((p) => {
    p.atb = 0;
  });
  return { ...f, lease, b };
}
test("menu item confirmation changes resources and stock atomically; full/fallen/key targets do not consume", () => {
  const { owned } = stateFixture(),
    initial = owned.snapshot();
  assert.deepEqual(owned.menuItemTargets(10), []);
  assert.equal(owned.useMenuItem(10, "a"), false);
  assert.equal(owned.useMenuItem(20, "a"), false);
  assert.deepEqual(owned.snapshot(), initial);
  initial.roster[0]!.hp = 1;
  initial.roster[1]!.hp = 0;
  initial.roster[1]!.conditionIds = [305];
  owned.restore(initial);
  assert.deepEqual(owned.menuItemTargets(10), ["a"]);
  assert.equal(owned.useMenuItem(10, "b"), false);
  assert.equal(owned.useMenuItem(10, "missing"), false);
  assert.equal(owned.useMenuItem(10, "a"), true);
  assert.equal(owned.snapshot().roster[0]!.hp, 51);
  assert.equal(owned.snapshot().items[0]!.count, 0);
  const used = owned.snapshot();
  assert.equal(owned.useMenuItem(10, "a"), false);
  assert.deepEqual(owned.snapshot(), used);
});
test("item reservations prevent two actors from selecting the last stock and retain carrier identity", () => {
  const { b } = combat();
  assert.equal(b.commandItem("a", 10, { kind: "single", id: "a" }, 200), true);
  assert.equal(b.commandItem("a", 10, { kind: "single", id: "a" }, 200), false);
  assert.deepEqual(b.pendingActions[0]!.source, { kind: "item", id: 10 });
  assert.deepEqual(b.inventory[0], { id: 10, count: 1, available: 0 });
  assert.equal(b.commandItem("b", 10, { kind: "single", id: "b" }, 200), false);
  b.advance(410);
  assert.equal(b.players[0]!.hp, 51);
  assert.equal(b.players[0]!.mp, b.players[0]!.maxMp);
  assert.deepEqual(b.inventory[0], { id: 10, count: 0, available: 0 });
  b.advance(100);
  assert.equal(b.players[0]!.hp, 51);
  assert.equal(b.inventory[0]!.count, 0);
});
test("separate owned copies preserve pre-battle inventory; retry restores both resources and stock", () => {
  const { b, owned, lease, battle } = combat();
  const before = owned.snapshot();
  assert.throws(() => owned.useMenuItem(10, "a"), /reserved/);
  b.commandItem("a", 10, { kind: "single", id: "a" }, 200);
  b.advance(410);
  assert.deepEqual(owned.snapshot(), before);
  const retry = new BattleGame(
    battle,
    43,
    owned.battlePlayers(lease),
    owned.battleInventory(lease),
  );
  assert.equal(retry.inventory[0]!.count, 1);
  assert.equal(retry.players[0]!.hp, before.roster[0]!.hp);
  const projected = owned.battleInventory(lease);
  projected.stacks[0]!.count = 99;
  assert.equal(owned.battleInventory(lease).stacks[0]!.count, 1);
});
test("stock reservations release on actor death; enemy and unknown targets are not admitted", () => {
  const { b } = combat();
  assert.equal(
    b.commandItem("a", 10, { kind: "single", id: b.enemies[0]!.id }, 200),
    false,
  );
  assert.equal(
    b.commandItem("a", 10, { kind: "single", id: "unknown" }, 200),
    false,
  );
  assert.equal(b.commandItem("a", 10, { kind: "single", id: "a" }, 100), false);
  b.commandItem("a", 10, { kind: "single", id: "a" }, 200);
  b.players[0]!.hp = 0;
  b.players[0]!.conditionIds = [305];
  b.advance(10);
  assert.deepEqual(b.inventory[0], { id: 10, count: 1, available: 1 });
  assert.equal(b.commandItem("b", 10, { kind: "single", id: "b" }, 200), true);
});
test("a later target projection failure leaves every resource and reserved item uncommitted", () => {
  const { b } = combat();
  const plan = b.items[10]!.uses.battle.plan!;
  plan.targeting = {
    ...plan.targeting,
    relation: "ally",
    modes: ["side"],
    defaultMode: "side",
  };
  b.commandItem("a", 10, { kind: "side", side: "player" }, 200);
  b.advance(400);
  const before = structuredClone(b.combatants),
    stock = b.inventory;
  b.players[1]!.maxMp = NaN;
  assert.throws(() => b.advance(10), /Invalid action target resource/);
  assert.equal(b.players[0]!.hp, before[0]!.hp);
  assert.equal(b.players[1]!.hp, before[1]!.hp);
  assert.deepEqual(b.inventory, stock);
  assert.equal(b.action!.resolved, false);
  b.players[1]!.maxMp = before[1]!.maxMp;
  b.advance(10);
  assert.equal(b.inventory[0]!.count, 0);
  assert.deepEqual(
    b.players.map((p) => p.hp),
    [51, 51],
  );
});
test("full-resource battle targets still consume one item; frame partition does not duplicate consumption", () => {
  const run = (steps: number[]) => {
    const { b } = combat(2);
    b.players.forEach((p) => {
      p.hp = p.maxHp;
    });
    assert.equal(
      b.commandItem("a", 10, { kind: "single", id: "a" }, 200),
      true,
    );
    assert.equal(
      b.commandItem("b", 10, { kind: "single", id: "b" }, 200),
      true,
    );
    for (const step of steps) b.advance(step);
    assert.equal(b.inventory[0]!.count, 0);
    return {
      units: b.combatants,
      inventory: b.inventory,
      events: b.events,
      queue: b.pendingActions,
    };
  };
  assert.deepEqual(run([2000]), run(Array(200).fill(10)));
});
test("victory commits item consumption once; invalid receipts cannot partially update players or rewards", () => {
  const { owned, lease, b } = combat();
  const players = owned.battlePlayers(lease),
    before = owned.snapshot();
  players[0]!.hp = 1;
  assert.throws(
    () =>
      owned.prepareVictory(lease, {
        players,
        gil: 1,
        consumedItems: [{ id: 10, count: 2 }],
      }),
    /consumption/,
  );
  assert.throws(
    () =>
      owned.prepareVictory(lease, {
        players,
        gil: 1,
        consumedItems: [{ id: 20, count: 1 }],
      }),
    /consumption/,
  );
  assert.deepEqual(owned.snapshot(), before);
  b.commandItem("a", 10, { kind: "single", id: "a" }, 200);
  b.advance(410);
  b.enemies.forEach((p) => {
    p.hp = 0;
    p.conditionIds = [305];
  });
  b.advance(600);
  const result = b.previewVictory()!;
  assert.deepEqual(result.consumedItems, [{ id: 10, count: 1 }]);
  const commit = owned.prepareVictory(lease, result);
  commit();
  assert.equal(owned.snapshot().items[0]!.count, 0);
  assert.equal(owned.snapshot().roster[0]!.hp, b.players[0]!.hp);
  assert.throws(commit, /Stale/);
});
test("menu use respects stable session boundaries and survives a complete checkpoint restore", () => {
  const { field, battle } = checkpointFixture();
  const game = new GameSession(field, battle);
  const snapshot = game.state.snapshot();
  snapshot.roster[0]!.hp = 1;
  game.state.restore(snapshot);
  game.state.changeItems([{ id: 10, count: 2 }], "grant");
  assert.equal(game.useMenuItem(10, "a"), true);
  const saved = game.checkpoint(),
    restored = GameSession.restore(saved, field, battle);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.state.snapshot().items[0]!.count, 1);
  assert.equal(restored.state.snapshot().roster[0]!.hp, 51);
  restored.field.move("right");
  assert.equal(restored.useMenuItem(10, "a"), false);
  assert.equal(restored.state.snapshot().items[0]!.count, 1);
});

test("item compiler preserves independent three-slot menu/battle programs and blocks unreviewed carriers", () => {
  const item: Record<string, string> = Object.fromEntries(
    Object.entries({
      id: 71,
      type_id: 1,
      system_id: 1,
      standard_value: 50,
      accuracy_rate: 100,
      destroy_rate: 100,
      invalid_reflection: 1,
      attribute_id: 0,
      period_id: 0,
      throw_flag: 0,
      preparation_flag: 0,
      drink_flag: 0,
      machine_flag: 0,
      condition_group_id: 0,
      menu_function_group_id: 1,
      battle_function_group_id: 2,
      menu_renge_id: 7,
      battle_renge_id: 2,
    }).map(([k, v]) => [k, String(v)]),
  );
  const group = (id: number, slot: number, resource: number) => ({
    id: String(id),
    ...Object.fromEntries(
      [1, 2, 3].flatMap((n) => [
        [`function${n}_id`, n === slot ? "91" : "0"],
        ...[1, 2, 3].map((v) => [
          `function${n}_value${v}`,
          n === slot ? String([1, resource, 0][v - 1]) : "0",
        ]),
      ]),
    ),
  });
  const tables = {
    "content.csv": [{ id: "601", type_id: "1", type_value: "71" }],
    "item.csv": [item],
    "function_group.csv": [group(1, 1, 2), group(2, 3, 3)],
    "function.csv": [{ id: "91", type_id: "1", series_id: "0" }],
  };
  const source = {
    file: "synthetic",
    assetPath: "items",
    objectId: "9223372036854775807",
    serializedFile: "synthetic",
  };
  const reader = () =>
    battleTableIndex(
      tables,
      Object.fromEntries(Object.keys(tables).map((t) => [t, source])),
    );
  const decoded = compileItem(reader(), 601, "Synthetic");
  assert.equal(decoded.definition.id, 601);
  assert.equal(decoded.definition.itemId, 71);
  assert.deepEqual(decoded.definition.uses.menu.plan!.effects, [
    { slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" },
  ]);
  assert.deepEqual(decoded.definition.uses.battle.plan!.effects, [
    { slot: 3, kind: "recovery", resource: "mp", calculation: "fixed" },
  ]);
  assert.equal(decoded.sources[0]!.source.objectId, source.objectId);
  item.destroy_rate = "50";
  assert.equal(
    compileItem(reader(), 601, "Synthetic").definition.uses.battle.plan,
    null,
  );
  item.destroy_rate = "100";
  item.battle_function_group_id = "999";
  assert.throws(() => compileItem(reader(), 601, "Synthetic"), /Unresolved/);
});
