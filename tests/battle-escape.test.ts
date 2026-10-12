import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { parseBattleEscapePolicy } from "../src/core/battle-escape.js";
import { fixture } from "./fixtures/battle-content.js";
import { itemFixture } from "./fixtures/items.js";

function setup() {
  const content = fixture();
  content.escapePolicy = { kind: "framework-battle-escape-v1", id: "synthetic-retreat" };
  content.commands[200] = { id: 200, name: "Items", kind: "item", abilityIds: [],
    forbiddenConditionIds: [], referencedAbility: null };
  content.players.forEach(p => p.commands.push(200));
  const inventory = { definitions: { 20: itemFixture(20) }, stacks: [{ id: 20, count: 2 }], limit: 99 };
  return { content, inventory, battle: new BattleGame(content, 53, undefined, inventory) };
}
const clock = { paused: false, helpPaused: false, progressEnabled: true, uiWaiting: false, forceWaiting: false };

test("retreat requires a detached explicit policy; malformed and getter-based policies fail", () => {
  assert.equal(new BattleGame(fixture(), 53).requestEscape(), false);
  for (const raw of [null, [], { kind: "framework-battle-escape-v2", id: "x" },
    { kind: "framework-battle-escape-v1", id: "x", rewards: true },
    { kind: "framework-battle-escape-v1", get id() { throw new Error("getter must not run"); } }])
    assert.throws(() => parseBattleEscapePolicy(raw), /Invalid development/);
  const { content, battle } = setup();
  content.escapePolicy!.kind = "unknown" as "framework-battle-escape-v1";
  assert.equal(battle.requestEscape(), true, "Construction owns a detached admitted rule");
  assert.equal(battle.requestEscape(), false);
  assert.equal(battle.escapePending, true); assert.deepEqual(battle.ready, []);
  battle.advance(10);
  assert.equal(battle.phase, "escaped"); assert.equal(battle.reward, null);
  assert.equal(battle.previewVictory(), null);
  const result = battle.previewEscape()!; result.players[0]!.hp = 1;
  assert.equal(battle.previewEscape()!.players[0]!.hp, 80);
  assert.ok(battle.takeEscape()); assert.equal(battle.takeEscape(), null);
});

test("retreat finishes the executing item and releases a second unstarted reservation without charging it", () => {
  const { battle } = setup();
  battle.players[0]!.hp = 20;
  assert.equal(battle.commandItem("a", 20, { kind: "single", id: "a" }, 200), true);
  battle.advance(10); assert.equal(battle.action!.actor, "a");
  assert.equal(battle.commandItem("b", 20, { kind: "single", id: "b" }, 200), true);
  assert.equal(battle.inventory[0]!.available, 0);
  assert.equal(battle.requestEscape(), true);
  assert.equal(battle.command("b", 11, "b"), false);
  battle.advance(390); assert.equal(battle.phase, "active");
  assert.equal(battle.players[0]!.hp, 20, "The already executing effect has not reached its hit frame");
  battle.advance(10); assert.equal(battle.players[0]!.hp, 70);
  assert.equal(battle.escapePending, true);
  battle.advance(500);
  assert.equal(battle.phase, "escaped"); assert.equal(battle.action, null);
  assert.deepEqual(battle.previewEscape()!.consumedItems, [{ id: 20, count: 1 }]);
  assert.equal(battle.inventory[0]!.available, 1);
  assert.equal(battle.players[1]!.mp, 8);
  const terminal = JSON.stringify([battle.combatants, battle.events, battle.time]);
  battle.advance(60000); assert.equal(JSON.stringify([battle.combatants, battle.events, battle.time]), terminal);
});

test("WAIT menu cannot trap an accepted retreat, while pause and host timing still stop it", () => {
  const { battle } = setup(); battle.setPreferences({ mode: "wait", speedIndex: 2 });
  battle.setClockInput({ ...clock, paused: true }); assert.equal(battle.requestEscape(), false);
  battle.setClockInput({ ...clock, uiWaiting: true }); assert.equal(battle.requestEscape(), true);
  for (const blocked of [{ ...clock, paused: true }, { ...clock, helpPaused: true },
    { ...clock, progressEnabled: false }, { ...clock, forceWaiting: true }]) {
    battle.setClockInput(blocked); battle.advance(100); assert.equal(battle.phase, "active");
  }
  battle.setClockInput({ ...clock, uiWaiting: true }); battle.advance(10);
  assert.equal(battle.phase, "escaped");
});

test("an executing last kill or party wipe settles victory or defeat ahead of retreat", () => {
  for (const outcome of ["victory", "defeat"] as const) {
    const { battle, content } = setup();
    if (outcome === "victory") {
      battle.enemies[1]!.hp = 0; battle.enemies[1]!.conditionIds = [305];
      assert.equal(battle.command("a", 10, "e1"), true);
      battle.advance(10);
    } else {
      battle.players.forEach(p => { p.atb = 0; p.hp = 1; });
      battle.players[1]!.hp = 0; battle.players[1]!.conditionIds = [305];
      battle.enemies[0]!.atb = 100;
      battle.enemies[0]!.physical!.accuracy = 100;
      for (let n = 0; n < 100 && !battle.action; n++) battle.advance(10);
    }
    assert.ok(battle.action); assert.equal(battle.requestEscape(), true);
    battle.advance(1000); assert.equal(battle.phase, outcome);
    assert.equal(battle.escapePending, false); assert.equal(battle.previewEscape(), null);
  }
});

test("failed in-flight effect rolls back its frame and leaves the same retreat retryable", () => {
  const { battle, content } = setup();
  assert.equal(battle.command("a", 11, "a"), true); battle.advance(10);
  assert.equal(battle.requestEscape(), true); battle.advance(390);
  const plan = content.abilities[11]!.plan; content.abilities[11]!.plan = null;
  const before = JSON.stringify({ units: battle.combatants, action: battle.action, time: battle.time, events: battle.events });
  assert.throws(() => battle.advance(10));
  assert.equal(JSON.stringify({ units: battle.combatants, action: battle.action, time: battle.time, events: battle.events }), before);
  assert.equal(battle.escapePending, true); assert.equal(battle.phase, "active");
  content.abilities[11]!.plan = plan; battle.advance(510);
  assert.equal(battle.phase, "escaped"); assert.equal(battle.players[0]!.mp, 6);
});

test("retreat is deterministic across frame slicing and keeps its battle-end condition contract", () => {
  const run = (slices: number[]) => {
    const { battle } = setup();
    assert.equal(battle.command("a", 11, "a"), true); battle.advance(10);
    assert.equal(battle.requestEscape(), true);
    for (const step of slices) battle.advance(step);
    return { result: battle.previewEscape(), events: battle.events, time: battle.time };
  };
  assert.deepEqual(run([900]), run(Array(90).fill(10)));
});
