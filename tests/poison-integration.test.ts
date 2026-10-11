import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { BattleGame } from "../src/core/battle.js";
import { encounterContent } from "../src/core/battle-content.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { recoveryItemFixture } from "./fixtures/items.js";

function setup() {
  const { field, battle: catalog } = checkpointFixture();
  catalog.common.conditions.rules.definitions.push({
    id: 310,
    type: 10,
    overlapped: false,
    eraseGroupId: 3,
  });
  catalog.common.conditions.behaviors.push({
    id: 310,
    kind: "poison",
    name: "Poison",
    untilType: 3,
    hpDivisor: 16,
  });
  catalog.common.players[0]!.conditionIds = [310];
  catalog.encounters[1000]!.enemies.forEach((e) => {
    e.hp = 9999;
    e.agility = 0;
    e.weight = 21;
  });
  catalog.gameState.items[30] = recoveryItemFixture(30, [310]);
  catalog.gameState.initialItems = [{ id: 30, count: 1 }];
  const game = new GameSession(field, catalog);
  return { game, field, catalog };
}

test("poison advances during action presentation without dispatching received-ability AI", () => {
  const { catalog } = setup();
  const battle = new BattleGame(encounterContent(catalog, 1000)!, 1);
  battle.advance(7900);
  assert.equal(battle.players[0]!.hp, 80);
  const ai = battle.enemies.map((e) => battle.enemyAIState(e.id));
  battle.command("a", 10, "e1");
  battle.advance(200);
  assert.equal(battle.players[0]!.hp, 75);
  assert.ok(battle.action);
  assert.equal(battle.conditionClockState("a")[0]!.thresholdSeconds, 16);
  assert.deepEqual(
    battle.enemies.map((e) => battle.enemyAIState(e.id)),
    ai,
  );
  const copy = battle.conditionClockState("a");
  copy.length = 0;
  assert.equal(battle.conditionClockState("a").length, 1);
});

test("lethal poison cancels a charging action and erases its condition clock", () => {
  const { catalog } = setup();
  const content = encounterContent(catalog, 1000)!;
  content.abilities[10]!.wait = 30;
  const battle = new BattleGame(content, 2);
  battle.players[0]!.hp = 1;
  battle.command("a", 10, "e1");
  battle.advance(8100);
  assert.equal(battle.players[0]!.hp, 0);
  assert.deepEqual(battle.players[0]!.conditionIds, [305]);
  assert.deepEqual(battle.conditionClockState("a"), []);
  assert.ok(!battle.pendingActions.some((a) => a.actor === "a"));
  assert.equal(battle.players[0]!.queued, false);
});

test("source BattleMainUpdate settles poison on the action-completion frame before end judgment", () => {
  // BattleMainUpdate 0x1588930 orders UpdateExection, Progress.Update,
  // then EndJudgment. Poison.UpdateSub 0x92d200 fires at its threshold.
  // Completing presentation cannot skip the same frame's condition update.
  for (const hp of [1, 10]) {
    const { catalog } = setup();
    const content = encounterContent(catalog, 1000)!;
    content.players = content.players.slice(0, 1);
    content.enemies = content.enemies.slice(0, 1);
    content.enemies[0]!.hp = 10;
    const battle = new BattleGame(content, 1);
    battle.players[0]!.hp = hp;
    battle.advance(7090);
    assert.equal(battle.command("a", 10, "e1"), true);
    battle.advance(900);
    assert.equal(battle.time, 7990);
    assert.equal(battle.action?.elapsed, 890);
    assert.equal(battle.enemies[0]!.hp, 0);
    assert.ok(battle.conditionClockState("a")[0]!.elapsedSeconds < 8);
    battle.advance(10);
    assert.equal(battle.players[0]!.hp, Math.max(0, hp - 5));
    assert.equal(battle.phase, hp === 1 ? "defeat" : "victory");
    assert.equal(battle.action, null);
    const damage = battle.events.findIndex((e) =>
      e.text.includes("因中毒受到 5"),
    );
    const ending = battle.events.findIndex((e) =>
      /队伍倒下|战斗胜利/.test(e.text),
    );
    assert.ok(damage >= 0 && damage < ending);
    if (hp === 1) assert.equal(battle.reward, null);
    else assert.deepEqual(battle.reward?.recipients, ["a"]);
  }
});

test("poison persists through victory and checkpoint, while menu cure permits field movement", () => {
  const { game, field, catalog } = setup();
  assert.equal(game.field.move("down"), false);
  assert.equal(game.field.stop, null);
  assert.equal(game.checkpointReady, true);
  game.field.startEvent("fight");
  game.advance(10);
  game.battle!.enemies.forEach((e) => {
    e.hp = 0;
  });
  game.advance(10);
  assert.equal(game.continueVictory(), true);
  game.advance(10);
  assert.deepEqual(game.state.snapshot().roster[0]!.conditionIds, [310]);
  const saved = game.checkpoint();
  const restored = GameSession.restore(saved, field, catalog);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.match(restored.field.movementBlocker!, /中毒/);
  assert.equal(restored.useMenuItem(30, "a"), true);
  assert.equal(restored.field.movementBlocker, null);
  assert.equal(restored.field.move("down"), true);
  assert.equal(restored.state.snapshot().items[0]!.count, 0);
});

test("restore rejects a dead poisoned owner without publishing a state that cannot be cured", () => {
  const { game } = setup();
  const before = game.state.snapshot();
  const invalid = structuredClone(before);
  invalid.roster[0]!.hp = 0;
  invalid.roster[0]!.conditionIds = [305, 310];
  assert.throws(() => game.state.restore(invalid), /death.*poison/i);
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(game.useMenuItem(30, "a"), true);
  assert.equal(game.field.movementBlocker, null);
});

test("a bad later poison projection rolls back earlier clocks, HP and logical time", () => {
  const { catalog } = setup();
  catalog.common.players[1]!.conditionIds = [310];
  const battle = new BattleGame(encounterContent(catalog, 1000)!, 3);
  battle.advance(7990);
  const clocks = battle.players.map((p) => battle.conditionClockState(p.id));
  const hp = battle.players.map((p) => p.hp),
    time = battle.time;
  battle.players[1]!.maxHp = 0;
  assert.throws(() => battle.advance(10), /Invalid poison HP/);
  assert.equal(battle.time, time);
  assert.deepEqual(
    battle.players.map((p) => p.hp),
    hp,
  );
  assert.deepEqual(
    battle.players.map((p) => battle.conditionClockState(p.id)),
    clocks,
  );
  battle.players[1]!.maxHp = 80;
  battle.advance(0); // Re-execute the retained failed frame exactly once.
  assert.equal(battle.time, time + 10);
});
