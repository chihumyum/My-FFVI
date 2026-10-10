import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import type {
  BattleContent,
  CombatantDefinition,
} from "../src/core/battle-content.js";
function fixture(): BattleContent {
  const unit: CombatantDefinition = {
    id: "a",
    sourceId: 1000,
    name: "Synthetic ally",
    side: "player",
    level: 2,
    hp: 80,
    mp: 8,
    magic: 20,
    attack: 20,
    defense: 30,
    magicDefense: 30,
    agility: 40,
    weight: 0,
    evasion: 0,
    exp: 0,
    gil: 0,
    growthGroup: "g",
    abilities: [10, 11, 12],
    ai: [],
    sprites: { idle: "synthetic", mount: null },
  };
  return {
    kind: "opening-battle-development",
    profile: "opening-playability-v1",
    contentHash: "synthetic",
    sourceContentHash: "synthetic",
    fieldSourceSetHash: "synthetic",
    encounterId: 1000,
    atb: {
      coefficient: 21,
      enemyCoefficient: 12,
      total: 550,
      maxHighSpeed: 50,
      maxLowSpeed: 50,
    },
    initialAtb: { player: [100, 100], enemy: [0, 0] },
    gil: 0,
    players: [unit, { ...structuredClone(unit), id: "b", name: "Second ally" }],
    enemies: [
      {
        ...structuredClone(unit),
        id: "e1",
        name: "Enemy",
        side: "enemy",
        hp: 10,
        exp: 9,
        gil: 7,
        abilities: [13],
        ai: [{ ability: 13, weight: 1 }],
      },
      {
        ...structuredClone(unit),
        id: "e2",
        name: "Enemy",
        side: "enemy",
        hp: 10,
        exp: 9,
        gil: 7,
        abilities: [13],
        ai: [{ ability: 13, weight: 1 }],
      },
    ],
    abilities: {
      10: {
        id: 10,
        name: "Beam",
        kind: "beam",
        power: 30,
        multiplier: 1,
        cost: 0,
        wait: 0,
        target: "enemy",
        attribute: 0,
      },
      11: {
        id: 11,
        name: "Heal",
        kind: "heal",
        power: 20,
        multiplier: 1,
        cost: 2,
        wait: 0,
        target: "ally",
        attribute: 0,
      },
      12: {
        id: 12,
        name: "Unsupported",
        kind: "unsupported",
        power: 0,
        multiplier: 1,
        cost: 0,
        wait: 0,
        target: "enemy",
        attribute: 0,
      },
      13: {
        id: 13,
        name: "Physical",
        kind: "physical",
        power: 0,
        multiplier: 1,
        cost: 0,
        wait: 0,
        target: "enemy",
        attribute: 0,
      },
    },
    growth: { g: [] },
    experience: [{ level: 2, exp: 0 }],
    background: "synthetic",
    sprites: {},
    limitations: [],
  };
}
test("invalid commands do not spend turns; unsupported abilities cannot execute", () => {
  const b = new BattleGame(fixture(), 7),
    before = structuredClone(b.combatants);
  for (const args of [
    ["a", 12, "e1"],
    ["a", 10, "b"],
    ["a", 13, "e1"],
    ["unknown", 10, "e1"],
    ["a", 10, "unknown"],
  ] as const)
    assert.equal(b.command(args[0], args[1], args[2]), false);
  assert.deepEqual(b.combatants, before);
  assert.equal(b.command("a", 10, "e1"), true);
  assert.equal(b.command("a", 10, "e2"), false);
});
test("queued attacks retarget a defeated enemy, settle rewards once, and replay across frame partitions", () => {
  const run = (parts: number[]) => {
    const b = new BattleGame(fixture(), 5);
    b.command("a", 10, "e1");
    b.command("b", 10, "e1");
    for (const dt of parts) b.advance(dt);
    return b;
  };
  const a = run([4000]),
    b = run(Array(400).fill(10));
  assert.equal(a.phase, "victory");
  assert.deepEqual(a.combatants, b.combatants);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.reward, b.reward);
  assert.equal(a.reward?.gil, 14);
  assert.equal(a.reward?.each, 9);
  assert.ok(a.enemies.every((e) => e.hp === 0));
  assert.equal(a.takeVictory()?.gil, 14);
  assert.equal(a.takeVictory(), null);
  const after = structuredClone(a.combatants);
  a.advance(5000);
  assert.deepEqual(a.combatants, after);
});
test("healing uses a living ally, consumes MP at execution, and clamps to max HP", () => {
  const f = fixture();
  f.enemies.forEach((e) => (e.agility = 0));
  const b = new BattleGame(f, 7);
  b.players[1]!.hp = 7;
  assert.equal(b.command("a", 11, "b"), true);
  assert.equal(b.players[0]!.mp, 8);
  b.advance(1200);
  assert.equal(b.players[1]!.hp, b.players[1]!.maxHp);
  assert.equal(b.players[0]!.mp, 6);
});
test("enemy actions can defeat the party; defeat never grants victory or rewards", () => {
  const f = fixture();
  f.players.forEach((p) => (p.hp = 1));
  f.enemies.forEach((e) => {
    e.level = 10;
    e.attack = 80;
  });
  f.initialAtb.enemy = [100, 100];
  const b = new BattleGame(f, 20);
  for (let n = 0; n < 5 && b.phase === "active"; n++) b.advance(60000);
  assert.equal(b.phase, "defeat");
  assert.equal(b.reward, null);
  assert.equal(b.takeVictory(), null);
  assert.ok(b.players.every((p) => p.hp === 0));
});
