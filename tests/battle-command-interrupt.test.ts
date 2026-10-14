import test from "node:test";
import assert from "node:assert/strict";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";

function content(range: number, selector = 3, queued = false) {
  const supplied = fixture();
  supplied.players.forEach(unit => unit.hp = 2000);
  supplied.enemies.forEach(unit => unit.hp = 2000);
  supplied.initialAtb.enemy = queued ? [100, 100] : [0, 0];
  supplied.enemies[0]!.ai = syntheticAI([
    ["Nop"], ["SyncAI"], ["StartTable", [0]],
    ["CounterActReceiveCommand", [selector, 13], [0, 100]],
    ["Act", [13], [100]], ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  supplied.abilities[13]!.program.range = range;
  supplied.abilities[13]!.plan!.targeting = compileTargetRule(range, 1)!;
  return supplied;
}

test("a command-conditioned interrupt chooses its source self or group scope, independently of the attacker", () => {
  for (const [range, targets] of [[5, ["e1"]], [2, ["e1", "e2"]], [4, ["a", "b"]]] as const) {
    const battle = new BattleGame(content(range), 941);
    assert.ok(battle.command("a", 10, "e1"));
    battle.advance(410);
    const interrupt = battle.pendingActions.find(action => action.kind === "counter")!;
    assert.ok(interrupt);
    assert.equal(interrupt.targeting, "automatic");
    assert.deepEqual(interrupt.targetIds, targets);
    assert.equal(interrupt.charge, 0);
    assert.equal(battle.enemyAIState("e1")!.receivedAbility, null);
    const oldHp = battle.combatants.map(unit => ({ id: unit.id, hp: unit.hp }));
    battle.advance(920);
    assert.equal(battle.action!.kind, "counter");
    assert.deepEqual(battle.action!.targetIds, targets);
    assert.equal(battle.action!.resolved, true);
    for (const unit of oldHp) assert.equal(
      battle.combatants.find(candidate => candidate.id === unit.id)!.hp !== unit.hp,
      targets.some(id => id === unit.id),
    );
  }
});

test("received command is the ability type, not the player's command master identity", () => {
  for (const [selector, emitted] of [[3, true], [100, false]] as const) {
    const battle = new BattleGame(content(5, selector), 942);
    assert.equal(battle.content.abilities[10]!.program.rules.type_id, 3);
    assert.equal(battle.content.players[0]!.commands[0], 100);
    assert.ok(battle.command("a", 10, "e1", 100));
    battle.advance(410);
    assert.equal(battle.pendingActions.some(action => action.kind === "counter"), emitted);
  }
});

test("automatic interrupts retain the queued normal turn and its full gauge", () => {
  const battle = new BattleGame(content(5, 3, true), 943);
  assert.ok(battle.command("a", 10, "e1"));
  battle.advance(410);
  const pending = battle.pendingActions.find(action => action.actor === "e1" && action.kind === "normal")!;
  assert.ok(pending);
  assert.equal(battle.enemies[0]!.atb, 100);
  battle.advance(1410);
  assert.equal(battle.enemies[0]!.atb, 100);
  assert.equal(battle.enemies[0]!.queued, true);
  const kept = battle.pendingActions.find(action => action.actor === "e1" && action.kind === "normal")!;
  assert.ok(kept.charge < pending.charge, "Ordinary chanting continues while the interrupt is presented");
  assert.deepEqual({ ...kept, charge: pending.charge }, pending);
});

test("the automatic interrupt and ordinary continuation replay independently of frame partition", () => {
  const supplied = content(4), once = new BattleGame(structuredClone(supplied), 944), split = new BattleGame(supplied, 944);
  for (const battle of [once, split]) assert.ok(battle.command("a", 10, "e1"));
  once.advance(2200);
  for (const ms of [7, 403, 620, 1170]) split.advance(ms);
  assert.deepEqual(split.combatants, once.combatants);
  assert.deepEqual(split.pendingActions, once.pendingActions);
  assert.deepEqual(split.action, once.action);
  assert.deepEqual(split.enemyAIState("e1"), once.enemyAIState("e1"));
  assert.deepEqual(split.events, once.events);
});
