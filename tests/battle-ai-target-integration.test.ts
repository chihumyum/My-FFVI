import test from "node:test";
import assert from "node:assert/strict";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { fixture } from "./fixtures/battle-content.js";
import { cyclingAI } from "./fixtures/battle-ai.js";

// Authored mechanism inputs exercise the actual decision, queue and effect
// transaction. These are not source encounters or a native behavior oracle.
function content(range: number, recovery = false) {
  const f = fixture(), ability = f.abilities[10]!;
  f.players.forEach(unit => { unit.hp = 500; });
  f.enemies.forEach(unit => { unit.hp = 500; unit.mp = 10; });
  f.initialAtb = { player: [0, 0], enemy: [0, 0] };
  f.enemies[0]!.abilities = [10];
  f.enemies[0]!.ai = cyclingAI([10]);
  ability.program.range = range;
  ability.plan!.targeting = compileTargetRule(range, recovery ? 2 : 3)!;
  ability.cost = 3;
  ability.power = recovery ? 20 : 1;
  if (recovery) {
    ability.program.rules.system_id = 2;
    ability.plan!.effects = [{ slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" }];
    ability.plan!.magic = null;
  }
  return f;
}
function start(f: ReturnType<typeof content>, seed: number) {
  const battle = new BattleGame(f, seed);
  battle.enemies[0]!.atb = 100;
  return battle;
}
function snapshot(battle: BattleGame) {
  return structuredClone({ units: battle.combatants, action: battle.action,
    queue: battle.pendingActions, events: battle.events, time: battle.time,
    phase: battle.phase, ai: battle.enemyAIState("e1") });
}

test("enemy self and ally-group recovery use the normal AI queue and pay once", () => {
  for (const range of [5, 2]) {
    const battle = start(content(range, true), 1889);
    battle.enemies[0]!.hp = 300;
    battle.enemies[1]!.hp = 400;
    battle.advance(410);
    assert.equal(battle.action!.resolved, true);
    assert.deepEqual(battle.action!.targetIds, range === 5 ? ["e1"] : ["e1", "e2"]);
    assert.equal(battle.enemies[0]!.hp, 320);
    assert.equal(battle.enemies[1]!.hp, range === 5 ? 400 : 420);
    assert.equal(battle.enemies[0]!.mp, 7);
    battle.advance(500);
    assert.equal(battle.enemies[0]!.mp, 7);
    assert.equal(battle.enemyAIState("e1")!.turnCounter, 1);
  }
});

test("enemy side and all-unit actions resolve every current target with one payment", () => {
  for (const range of [4, 9]) {
    const battle = start(content(range), 1901);
    battle.advance(410);
    const ids = range === 4 ? ["a", "b"] : ["a", "b", "e1", "e2"];
    assert.deepEqual(battle.action!.results.map(result => result.target), ids);
    assert.ok(battle.players.every(unit => unit.hp < 500));
    assert.equal(battle.enemies[0]!.mp, 7);
    assert.equal(battle.enemies[1]!.hp < 500, range === 9);
    battle.advance(500);
    assert.equal(battle.enemies[0]!.mp, 7);
  }
});

test("enemy range 20 automatically selects one player despite its side menu default", () => {
  const f = content(20);
  assert.equal(f.abilities[10]!.plan!.targeting.defaultMode, "side");
  const battle = start(f, 1907);
  battle.advance(410);
  assert.equal(battle.action!.selection.kind, "single");
  assert.equal(battle.action!.results.length, 1);
  assert.equal(battle.players.filter(unit => unit.hp < 500).length, 1);
  assert.equal(battle.enemies[0]!.mp, 7);
});

test("range 8 preserves raw cardinality before alive filtering in the real executor", () => {
  for (const rawCount of [1, 2]) {
    const f = content(8);
    if (rawCount === 1) f.players = [f.players[0]!];
    const battle = start(f, 1913);
    if (rawCount === 2) {
      battle.players[1]!.hp = 0;
      battle.players[1]!.conditionIds = [305];
    }
    battle.advance(410);
    assert.equal(battle.action!.selection.kind, rawCount === 1 ? "single" : "side");
    assert.deepEqual(battle.action!.targetIds, ["a"]);
    assert.equal(battle.action!.resolved, true);
    assert.ok(battle.players[0]!.hp < 500);
    assert.equal(battle.enemies[0]!.mp, 7);
  }
});

test("enemy group targets are revalidated at impact instead of damaging a newly fallen member", () => {
  const battle = start(content(4), 1931);
  battle.advance(10);
  assert.deepEqual(battle.action!.targetIds, ["a", "b"]);
  battle.players[1]!.hp = 0;
  battle.players[1]!.conditionIds = [305];
  battle.advance(400);
  assert.deepEqual(battle.action!.results.map(result => result.target), ["a"]);
  assert.equal(battle.players[1]!.hp, 0);
  assert.equal(battle.enemies[0]!.mp, 7);
});

test("a later enemy group effect failure restores payment, earlier effects and random replay", () => {
  const f = content(4), battle = start(f, 1933), clean = start(structuredClone(f), 1933);
  battle.advance(400); clean.advance(400);
  const defense = battle.players[1]!.magicDefense;
  battle.players[1]!.magicDefense = 256;
  const before = snapshot(battle);
  assert.throws(() => battle.advance(10), /outside supported/);
  assert.deepEqual(snapshot(battle), before);
  assert.equal(battle.enemies[0]!.mp, 10);
  assert.equal(battle.players[0]!.hp, 500);
  battle.players[1]!.magicDefense = defense;
  battle.advance(0); clean.advance(10);
  assert.deepEqual(snapshot(battle), snapshot(clean));
});

test("normal single, group and self AI remain deterministic across frame chunks", () => {
  for (const range of [3, 7, 4, 5, 9, 20]) {
    const f = content(range, range === 5), whole = start(f, 1949), chunks = start(structuredClone(f), 1949);
    whole.advance(910);
    for (const elapsed of [7, 103, 200, 99, 501]) chunks.advance(elapsed);
    assert.deepEqual(snapshot(chunks), snapshot(whole));
  }
});
