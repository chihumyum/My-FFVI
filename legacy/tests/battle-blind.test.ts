import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { BattleGame } from "../src/core/battle.js";
import { encounterContent } from "../src/core/battle-content.js";
import { compileFieldConditionCatalog } from "../src/compiler/field-conditions.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { conditionBlindFixture } from "./fixtures/condition-blind.js";
import { recoveryItemFixture } from "./fixtures/items.js";

function setup() {
  const { field, battle } = checkpointFixture(), f = conditionBlindFixture();
  battle.common.conditions = f.compile().catalog;
  battle.gameState.fieldConditions = compileFieldConditionCatalog(f.reader(), battle.common.conditions, [101, 106]).catalog;
  battle.gameState.items[39] = recoveryItemFixture(39, [109, 189]);
  battle.gameState.initialItems = [{ id: 39, count: 2 }];
  battle.common.commands[200] = { id: 200, kind: "item", name: "Items", abilityIds: [], referencedAbility: null, forbiddenConditionIds: [] };
  battle.common.players.forEach((p) => { p.physical = null; p.commands.push(200); });
  for (const encounter of Object.values(battle.encounters)) for (const p of encounter.enemies) {
    p.agility = 0; p.weight = battle.common.atb.coefficient;
  }
  const game = new GameSession(field, battle), initial = game.state.snapshot();
  initial.roster[1]!.conditionIds = [109]; game.state.restore(initial);
  return { game, field, battle, initial };
}

test("owned Blind survives field step/checkpoint and a menu cure commits only a real condition change", () => {
  const { game, field, battle, initial } = setup();
  const step = game.state.fieldSteps.prepareStep(101);
  assert.deepEqual(step.result.damage, []); assert.equal(step.result.soundId, null);
  step.commit(); assert.deepEqual(game.state.snapshot(), initial);
  assert.deepEqual(GameSession.restore(game.checkpoint(), field, battle).state.snapshot(), initial);
  assert.deepEqual(game.state.menuItemTargets(39), ["b"]);
  assert.equal(game.useMenuItem(39, "a"), false);
  assert.equal(game.useMenuItem(39, "b"), true);
  const after = game.state.snapshot();
  assert.deepEqual(after.roster[1]!.conditionIds, []);
  assert.equal(after.roster[1]!.hp, initial.roster[1]!.hp);
  assert.equal(after.items[0]!.count, 1);
  assert.equal(game.useMenuItem(39, "b"), false); assert.deepEqual(game.state.snapshot(), after);
  assert.deepEqual(GameSession.restore(game.checkpoint(), field, battle).state.snapshot(), after);
});

test("malformed death/Blind and unsupported alternate status restores reject atomically", () => {
  const { game, initial } = setup();
  for (const conditionIds of [[5, 109], [189]]) {
    const changed = structuredClone(initial);
    Object.assign(changed.roster[1]!, { hp: conditionIds.includes(5) ? 0 : 80, conditionIds });
    assert.throws(() => game.state.restore(changed), /death\/condition|Unimplemented active/);
    assert.deepEqual(game.state.snapshot(), initial);
  }
  const dead = structuredClone(initial); Object.assign(dead.roster[1]!, { hp: 0, conditionIds: [5] });
  game.state.restore(dead); assert.deepEqual(game.state.snapshot(), dead);
});

test("battle item cure, defeat retry and victory persistence use the same Blind identity and inventory", () => {
  const { game, field, battle, initial } = setup();
  game.field.startEvent("fight"); game.advance(10);
  let b = game.battle!;
  b.players.forEach((p) => p.atb = 100);
  assert.equal(b.commandItem("a", 39, { kind: "single", id: "b" }, 200), true);
  b.advance(410);
  assert.deepEqual(b.players[1]!.conditionIds, []);
  assert.equal(b.inventory[0]!.count, 1); assert.deepEqual(game.state.snapshot(), initial);
  b.players.forEach((p) => { p.hp = 0; p.conditionIds = [5]; }); b.advance(600);
  assert.equal(b.phase, "defeat"); assert.equal(game.retryBattle(), true);
  b = game.battle!; assert.deepEqual(b.players[1]!.conditionIds, [109]); assert.equal(b.inventory[0]!.count, 2);
  // Controlled victory without curing must persist untilType3 into owned state.
  b.enemies.forEach((p) => { p.hp = 0; p.conditionIds = [5]; }); b.advance(10);
  assert.equal(b.phase, "victory"); assert.equal(game.continueVictory(), true); game.advance(10);
  assert.deepEqual(game.state.snapshot().roster[1]!.conditionIds, [109]);
  assert.equal(game.state.snapshot().items[0]!.count, 2);
  assert.deepEqual(GameSession.restore(game.checkpoint(), field, battle).checkpoint(), game.checkpoint());
});

test("late multi-target numerical failure rolls back hit draws, resources and action before retry", () => {
  function battle() {
    const f = setup(), lease = f.game.state.openBattle(1000);
    const content = encounterContent(f.battle, 1000, 917)!;
    const ability = content.abilities[10]!;
    ability.plan!.targeting.modes = ["side"]; ability.plan!.targeting.defaultMode = "side";
    for (const target of content.enemies) { target.hp = 1000; target.conditionIds = [109]; }
    return new BattleGame(content, 917, f.game.state.battlePlayers(lease), f.game.state.battleInventory(lease));
  }
  const changed = battle(), control = battle();
  for (const b of [changed, control]) {
    b.players[0]!.atb = 100;
    assert.equal(b.command("a", 10, { kind: "side", side: "enemy" }), true); b.advance(400);
    assert.equal(b.action?.resolved, false);
  }
  const originalDefense = changed.enemies[1]!.magicDefense;
  changed.enemies[1]!.magicDefense = 256;
  const before = { units: structuredClone(changed.combatants), action: structuredClone(changed.action), time: changed.time, events: structuredClone(changed.events) };
  assert.throws(() => changed.advance(10), /Magic arithmetic/);
  assert.deepEqual(changed.combatants, before.units); assert.deepEqual(changed.action, before.action);
  assert.deepEqual(changed.events, before.events); assert.equal(changed.time, before.time);
  changed.enemies[1]!.magicDefense = originalDefense;
  changed.advance(0); control.advance(10);
  assert.deepEqual(changed.combatants, control.combatants);
  assert.deepEqual(changed.action, control.action); assert.deepEqual(changed.events, control.events);
});
