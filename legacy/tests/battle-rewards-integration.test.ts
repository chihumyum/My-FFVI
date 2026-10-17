import test from "node:test";
import assert from "node:assert/strict";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { fixture } from "./fixtures/battle-content.js";

function rewardsFixture(count = 1) {
  const content = fixture();
  content.enemies.forEach((enemy, index) => { enemy.sourceId = 41 + index; });
  content.drops = { kind: "battle-drops-v1", weights: [88, 12, 0, 0, 0, 0, 0, 0],
    monsters: [41, 42].map((id) => ({ id, rate: 100, slots: Array.from({ length: 8 }, (_, index) =>
      ({ contentId: index < 2 ? 20 : 0, count: index < 2 ? count : 0 })) })),
    contents: [{ id: 20, kind: "item" }] };
  return content;
}

test("ordinary kills register in execution order rather than enemy formation order", () => {
  const battle = new BattleGame(rewardsFixture(), 23);
  assert.equal(battle.command("a", 10, "e2"), true);
  battle.advance(910);
  assert.deepEqual(battle.registeredDropMonsters, [42]);
  assert.equal(battle.command("b", 10, "e1"), true);
  battle.advance(910);
  assert.equal(battle.phase, "victory");
  assert.deepEqual(battle.reward!.dropPlan!.registrations, [42, 41]);
  assert.deepEqual(battle.reward!.drops, [{ id: 20, kind: "item", count: 2 }]);
  const first = battle.previewVictory()!;
  assert.deepEqual(first.dropGrants, [{ kind: "grant-item", id: 20, count: 2 }]);
  first.dropGrants[0]!.count = 99;
  assert.equal(battle.previewVictory()!.dropGrants[0]!.count, 2);
  assert.ok(battle.takeVictory());
  assert.equal(battle.takeVictory(), null);
});

test("a new death start after controlled revival registers again, but repeated dead ticks do not", () => {
  const battle = new BattleGame(rewardsFixture(), 29), enemy = battle.enemies[0]!;
  enemy.hp = 0;
  battle.advance(20);
  assert.deepEqual(battle.registeredDropMonsters, [41]);
  // Controlled lifecycle probe; this does not admit an enemy-revival ability.
  enemy.hp = 10; enemy.conditionIds = [];
  battle.advance(10);
  enemy.hp = 0;
  battle.advance(20);
  assert.deepEqual(battle.registeredDropMonsters, [41, 41]);
  battle.enemies[1]!.hp = 0;
  battle.advance(10);
  assert.deepEqual(battle.reward!.dropPlan!.registrations, [41, 41, 42]);
  assert.equal(battle.reward!.dropPlan!.grants[0]!.count, 3);
});

test("late drop aggregation failure restores victory, random stream, time and registration state", () => {
  const invalid = rewardsFixture(0x7fffffff), valid = rewardsFixture();
  const battle = new BattleGame(invalid, 31), control = new BattleGame(valid, 31);
  for (const game of [battle, control]) game.enemies.forEach((enemy) => { enemy.hp = 0; });
  const before = structuredClone({ units: battle.combatants, events: battle.events });
  assert.throws(() => battle.advance(10), /quantity overflow/);
  assert.equal(battle.phase, "active"); assert.equal(battle.reward, null); assert.equal(battle.time, 0);
  assert.deepEqual({ units: battle.combatants, events: battle.events }, before);
  assert.deepEqual(battle.registeredDropMonsters, []);
  invalid.drops = structuredClone(valid.drops);
  battle.advance(0); control.advance(10);
  assert.deepEqual(battle.reward, control.reward);
  assert.deepEqual(battle.previewVictory(), control.previewVictory());
});

test("missing enemy drop identity blocks entry even if a seed might have produced no item", () => {
  const content = rewardsFixture(); content.drops!.monsters.splice(1);
  assert.throws(() => new BattleGame(content, 37), /Missing enemy drop definition/);
});
