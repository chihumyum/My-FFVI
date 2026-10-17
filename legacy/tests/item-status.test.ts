import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { recoveryItemFixture } from "./fixtures/items.js";

function setup(extraPlayers = false) {
  const { field, battle } = checkpointFixture();
  const common = battle.common;
  common.conditions.rules.definitions.push(
    { id: 306, type: 6, overlapped: false, eraseGroupId: 3 },
    { id: 405, type: 5, overlapped: false, eraseGroupId: 3 },
    { id: 910, type: 10, overlapped: false, eraseGroupId: 3 },
  );
  common.conditions.behaviors.push(
    { id: 306, kind: "silence", name: "Silent", untilType: 2 },
    { id: 405, kind: "unable-fight", name: "Other fallen", untilType: 3 },
  );
  if (extraPlayers)
    for (const [n, id] of ["c", "d"].entries()) {
      common.players.push({
        ...structuredClone(common.players[0]!),
        id,
        name: id,
        sourceId: 1100 + n,
      });
      battle.gameState.equipment[id] = [...battle.gameState.equipment.a!];
      battle.gameState.rosterLifecycle.initial[id] = {
        ...structuredClone(battle.gameState.rosterLifecycle.initial.a!),
        ownedId: n + 3,
      };
      battle.gameState.initialParty.slots[0][n + 2]!.id = id;
    }
  common.commands[200] = {
    id: 200,
    kind: "item",
    name: "Items",
    abilityIds: [],
    referencedAbility: null,
    forbiddenConditionIds: [],
  };
  common.players.forEach((p) => p.commands.push(200));
  battle.gameState.items[30] = recoveryItemFixture(30, [305, 405], true);
  battle.gameState.items[31] = recoveryItemFixture(31, [910, 306]);
  battle.gameState.initialItems = [
    { id: 30, count: 2 },
    { id: 31, count: 2 },
  ];
  const game = new GameSession(field, battle);
  return { game, field, battle };
}

test("menu revival restores fallen party members at HP boundaries without treating an alive target as healing", () => {
  for (const maxHp of [1, 7, 8, 80, 9999])
    for (const death of [305, 405]) {
      const { game, field, battle } = setup();
      const before = game.state.snapshot(),
        target = before.roster[1]!;
      Object.assign(target, { hp: 0, maxHp, conditionIds: [death] });
      game.state.restore(before);
      assert.deepEqual(game.state.menuItemTargets(30), [target.id]);
      assert.equal(game.useMenuItem(30, "a"), false);
      assert.equal(game.useMenuItem(30, target.id), true);
      const after = game.state.snapshot(),
        revived = after.roster[1]!;
      assert.equal(revived.hp, Math.max(1, Math.trunc(maxHp / 8)));
      assert.equal(revived.mp, target.mp);
      assert.deepEqual(revived.conditionIds, maxHp >= 8 ? [304] : []);
      assert.equal(after.items.find((i) => i.id === 30)!.count, 1);
      assert.equal(game.useMenuItem(30, target.id), false);
      assert.deepEqual(game.state.snapshot(), after);
      assert.deepEqual(
        GameSession.restore(game.checkpoint(), field, battle).checkpoint(),
        game.checkpoint(),
      );
    }
});

test("menu condition cure consumes for a status-only change and leaves unaffected or unsupported targets alone", () => {
  const { game, field, battle } = setup();
  const initial = game.state.snapshot();
  initial.roster[1]!.conditionIds = [306];
  game.state.restore(initial);
  assert.deepEqual(game.state.menuItemTargets(31), ["b"]);
  assert.equal(game.useMenuItem(31, "a"), false);
  assert.equal(game.useMenuItem(31, "missing"), false);
  assert.equal(game.useMenuItem(31, "b"), true);
  const after = game.state.snapshot();
  assert.deepEqual(after.roster[1], { ...initial.roster[1], conditionIds: [] });
  assert.equal(after.items.find((i) => i.id === 31)!.count, 1);
  assert.equal(game.useMenuItem(31, "b"), false);
  const unsupported = structuredClone(after);
  unsupported.roster[1]!.conditionIds = [910];
  assert.throws(() => game.state.restore(unsupported), /Unimplemented active/);
  assert.deepEqual(game.state.snapshot(), after);
  assert.deepEqual(
    GameSession.restore(game.checkpoint(), field, battle).checkpoint(),
    game.checkpoint(),
  );
});

test("queued item revivals keep their target, reset its gauge, and consume a missed second item only once", () => {
  const run = (parts: number[]) => {
    const { game } = setup(true);
    const snapshot = game.state.snapshot();
    for (const id of ["b", "d"])
      Object.assign(
        snapshot.roster.find((p) => p.id === id)!,
        { hp: 0, conditionIds: [305] },
      );
    game.state.restore(snapshot);
    game.field.startEvent("fight");
    game.advance(10);
    const b = game.battle!;
    for (const p of b.players) p.atb = p.hp ? 100 : 0;
    b.enemies.forEach((p) => (p.atb = 0));
    assert.equal(
      b.commandItem("b", 30, { kind: "single", id: "b" }, 200),
      false,
    );
    assert.equal(
      b.commandItem("a", 30, { kind: "single", id: "b" }, 200),
      true,
    );
    assert.equal(
      b.commandItem("c", 30, { kind: "single", id: "b" }, 200),
      true,
    );
    for (const ms of parts) b.advance(ms);
    const revived = b.players.find((p) => p.id === "b")!;
    assert.equal(revived.hp, 10);
    assert.deepEqual(revived.conditionIds, [304]);
    assert.equal(revived.queued, false);
    assert.ok(revived.atb < 100);
    assert.equal(b.players.find((p) => p.id === "d")!.hp, 0);
    assert.equal(b.inventory.find((i) => i.id === 30)!.count, 0);
    assert.ok(b.events.some((e) => e.text.includes("状态未改变")));
    assert.equal(
      game.state.snapshot().items.find((i) => i.id === 30)!.count,
      2,
    );
    return {
      players: structuredClone(b.players),
      inventory: b.inventory,
      events: b.events,
    };
  };
  assert.deepEqual(run([2000]), run(Array(200).fill(10)));
});

test("condition item no-effect consumption, defeat retry and victory checkpoint use one shared inventory", () => {
  const { game, field, battle } = setup();
  const start = game.state.snapshot();
  start.roster[1]!.conditionIds = [306];
  game.state.restore(start);
  game.field.startEvent("fight");
  game.advance(10);
  let b = game.battle!;
  b.players.forEach((p) => (p.atb = 100));
  b.enemies.forEach((p) => (p.atb = 0));
  b.commandItem("a", 31, { kind: "single", id: "b" }, 200);
  b.advance(410);
  assert.deepEqual(b.players[1]!.conditionIds, []);
  assert.equal(b.players[1]!.hp, start.roster[1]!.hp);
  assert.equal(b.inventory.find((i) => i.id === 31)!.count, 1);
  b.players.forEach((p) => {
    p.hp = 0;
    p.conditionIds = [305];
  });
  b.advance(600);
  assert.equal(b.phase, "defeat");
  assert.equal(game.retryBattle(), true);
  b = game.battle!;
  assert.deepEqual(b.players[1]!.conditionIds, [306]);
  assert.equal(b.inventory.find((i) => i.id === 31)!.count, 2);
  b.players.forEach((p) => (p.atb = 100));
  b.enemies.forEach((p) => (p.atb = 0));
  // Battle allows a wasted cure, while the field menu does not consume it.
  b.commandItem("a", 31, { kind: "single", id: "a" }, 200);
  b.advance(410);
  assert.equal(b.action!.results[0]!.effects[0]!.missed, true);
  assert.equal(b.inventory.find((i) => i.id === 31)!.count, 1);
  b.enemies.forEach((p) => {
    p.hp = 0;
    p.conditionIds = [305];
  });
  b.advance(600);
  assert.equal(game.continueVictory(), true);
  game.advance(10);
  assert.equal(game.state.snapshot().items.find((i) => i.id === 31)!.count, 1);
  assert.deepEqual(
    GameSession.restore(game.checkpoint(), field, battle).checkpoint(),
    game.checkpoint(),
  );
});
