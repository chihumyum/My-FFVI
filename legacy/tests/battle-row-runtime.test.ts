import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { calculateDevelopmentEffects } from "../src/core/ability.js";
import { battleEntryRuntimeFixture } from "./fixtures/battle-entry-runtime.js";

function sourceFixture() {
  const result = battleEntryRuntimeFixture();
  result.content.players.forEach((player) => { player.hp = 5000; });
  result.content.enemies.forEach((enemy) => { enemy.hp = 5000; enemy.agility = 0; });
  return result;
}

test("production source battle accepts an owned rear player and applies the source row projection", () => {
  const front = sourceFixture(), rear = sourceFixture();
  rear.content.players[0]!.row = "back";
  const a = new BattleGame(front.content, 1901, undefined, front.inventory);
  const b = new BattleGame(rear.content, 1901, undefined, rear.inventory);
  assert.equal(b.canUse("a", 13, 1), true);
  assert.equal(a.command("a", 13, "e1", 1), true);
  assert.equal(b.command("a", 13, "e1", 1), true);
  a.advance(410); b.advance(410);
  assert.equal(b.action?.resolved, true);
  const frontDamage = 5000 - a.enemies[0]!.hp, rearDamage = 5000 - b.enemies[0]!.hp;
  assert.ok(frontDamage > rearDamage && rearDamage > 0);
  assert.equal(b.players[0]!.row, "back");
  assert.deepEqual(b.action?.source, a.action?.source);
});

test("production source physical actions reject missing catalog or frozen equipment without changing resources", () => {
  for (const missing of ["catalog", "equipment"] as const) {
    const { content, inventory } = sourceFixture();
    if (missing === "catalog") delete content.battleRows;
    else delete inventory.qualification;
    const battle = new BattleGame(content, 1907, undefined, inventory);
    const before = structuredClone(battle.combatants);
    assert.equal(battle.canUse("a", 13, 1), false);
    assert.equal(battle.command("a", 13, "e1", 1), false);
    assert.deepEqual(battle.combatants, before);
    assert.deepEqual(battle.pendingActions, []);
    // Numerical magic has no row dependence.
    assert.equal(battle.canUse("a", 10, 7), true);
  }
});

test("production row ownership mismatch fails construction instead of falling back to an empty weapon", () => {
  const { content, inventory } = sourceFixture();
  inventory.qualification!.members[0]!.sourceId++;
  assert.throws(() => new BattleGame(content, 1913, undefined, inventory), /member mismatch/);
});

test("entry equipment is frozen while current combatant rows are observed at execution", () => {
  const { content, inventory } = sourceFixture();
  const battle = new BattleGame(content, 1931, undefined, inventory);
  inventory.qualification!.members[0]!.equipment = [999, 999, 999, 999, 999, 999];
  assert.equal(battle.canUse("a", 13, 1), true);
  assert.equal(battle.command("a", 13, "e1", 1), true);
  battle.players[0]!.row = "back";
  battle.advance(410);
  assert.equal(battle.action?.resolved, true);
  assert.ok(battle.enemies[0]!.hp < 5000);
});

test("invalid target row rejects time admission and preserves resources, queue and RNG for retry", () => {
  const first = sourceFixture(), second = sourceFixture();
  const broken = new BattleGame(first.content, 1933, undefined, first.inventory);
  const control = new BattleGame(second.content, 1933, undefined, second.inventory);
  for (const battle of [broken, control]) {
    battle.command("a", 13, "e1", 1); battle.advance(400);
  }
  broken.enemies[0]!.row = "unknown" as never;
  const snapshot = (battle: BattleGame) => structuredClone({ units: battle.combatants,
    action: battle.action, events: battle.events, time: battle.time, queue: battle.pendingActions });
  const before = snapshot(broken);
  assert.throws(() => broken.advance(10), /battle row/);
  assert.deepEqual(snapshot(broken), before);
  broken.enemies[0]!.row = "front";
  broken.advance(10); control.advance(10);
  assert.deepEqual(snapshot(broken), snapshot(control));
});

test("native enemy Front rule holds for both construction and a live target", () => {
  const { content, inventory } = sourceFixture();
  content.enemies[0]!.row = "back";
  assert.throws(() => new BattleGame(content, 1949, undefined, inventory), /enemy battle row/);
  content.enemies[0]!.row = "front";
  const battle = new BattleGame(content, 1949, undefined, inventory);
  battle.enemies[0]!.row = "back";
  const before = structuredClone({ units: battle.combatants, time: battle.time, events: battle.events });
  assert.throws(() => battle.advance(10), /enemy battle row/);
  assert.deepEqual({ units: battle.combatants, time: battle.time, events: battle.events }, before);
});

test("shared numerical physical projection requires explicit row context before RNG; nonphysical does not", () => {
  const { content } = sourceFixture(), actor = { ...content.players[0]!, conditionTypes: [] }, target = content.enemies[0]!;
  const physical = content.abilities[13]!;
  assert.throws(() => calculateDevelopmentEffects(physical.plan!, physical.power, actor, target,
    () => assert.fail("Unknown row consumed RNG")), /physical row context/);
  const before = structuredClone({ actor, target });
  const result = calculateDevelopmentEffects(physical.plan!, physical.power, actor, target, () => 0, 1,
    { actor: "back", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false });
  assert.equal(result.length, 1);
  assert.deepEqual({ actor, target }, before);
  const magic = content.abilities[10]!;
  assert.equal(calculateDevelopmentEffects(magic.plan!, magic.power, actor, target, () => 0).length, 1);
});
