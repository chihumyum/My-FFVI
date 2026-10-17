import test from "node:test";
import assert from "node:assert/strict";
import { requestEscape, tickEscape, escapeDifficulty } from "./escape.js";
function fixture({
  boss = false,
  notEscape = false,
  runFactor,
  hard = false,
  second = false,
} = {}) {
  const warnings = [];
  let draws = 0;
  const battle = {
    phase: "active",
    formation: { notEscape },
    data: { conditions: {} },
    players: [
      { id: 2, name: "Locke", hp: 80, maxHp: 140, mp: 8, exp: 123, runFactor },
      ...(second ? [{ id: 7, name: "Celes", hp: 50, maxHp: 150, runFactor: 3 }] : []),
    ],
    enemies: [{ hp: 120, boss, harderToRun: hard }, { hp: 60 }, { hp: 100 }],
    inventory: { 2: 1 },
    result: null,
    outcome: null,
    events: { interactive: true, paused: false },
    random: () => {
      draws++;
      return 0.5;
    },
    warning: (message) => warnings.push(message),
    addLog: () => {},
    checkEnd: () => {
      throw Error("escape input cannot settle battle");
    },
    onEnd: () => {
      throw Error("escape input cannot pay rewards");
    },
  };
  return {
    battle,
    warnings,
    get draws() {
      return draws;
    },
  };
}

test("PR no-escape formations and active bosses refuse ordinary escape input", () => {
  for (const options of [{ boss: true }, { notEscape: true }]) {
    const { battle, warnings } = fixture(options);
    assert.equal(requestEscape(battle), false);
    assert.equal(tickEscape(battle, 60), false);
    assert(!battle.players[0].escaped);
    assert.equal(battle.result, null);
    assert(warnings.some((message) => message.includes("Escape refused")));
  }
  const { battle } = fixture();
  battle.formation = { not_escape: "1" };
  assert.equal(requestEscape(battle), false);
});

test("escape counters use elapsed time and preserve identical rolls across tick rates", () => {
  const a = fixture({ second: true }),
    b = fixture({ second: true });
  requestEscape(a.battle);
  requestEscape(b.battle);
  assert.equal(tickEscape(a.battle, 0.1), false);
  assert.equal(a.draws, 0);
  tickEscape(a.battle, 14.9);
  for (let n = 0; n < 900; n++) tickEscape(b.battle, 1 / 60);
  assert(a.battle.escapeState.complete);
  assert(b.battle.escapeState.complete);
  assert.equal(a.draws, b.draws);
  assert.equal(a.battle.escapeState.completedAt, b.battle.escapeState.completedAt);
  assert.deepEqual(
    a.battle.escapeState.members.map((m) => [m.progress, m.attempts]),
    b.battle.escapeState.members.map((m) => [m.progress, m.attempts]),
  );
  assert(a.battle.escapeState.completedAt >= 4);
  assert(a.battle.escapeState.completedAt < 10);
});

test("successful escape only leaves battle and cannot heal, award experience or force victory", () => {
  const { battle, warnings } = fixture();
  const hp = battle.players[0].hp,
    mp = battle.players[0].mp;
  assert.equal(requestEscape(battle), true);
  assert.equal(tickEscape(battle, 5), true);
  assert.equal(battle.players[0].escaped, true);
  assert.equal(battle.players[0].hidden, true);
  assert.equal(battle.players[0].hp, hp);
  assert.equal(battle.players[0].mp, mp);
  assert.equal(battle.players[0].exp, 123);
  assert.equal(battle.phase, "active");
  assert.equal(battle.outcome, null);
  assert.equal(battle.result, null);
  assert.deepEqual(battle.inventory, { 2: 1 });
  assert(battle.enemies.every((enemy) => enemy.hp > 0));
  assert.equal(
    warnings.filter((message) => message.includes("provisional probability 5")).length,
    1,
  );
});

test("difficulty follows surviving enemies and explicit PR values, while source pauses freeze progress", () => {
  const { battle } = fixture({ runFactor: 5, hard: true });
  assert.equal(escapeDifficulty(battle), 10);
  assert.equal(requestEscape(battle), true);
  battle.events.paused = true;
  tickEscape(battle, 60);
  assert.equal(battle.escapeState.elapsed, 0);
  assert.equal(battle.escapeState.members[0].progress, 0);
  battle.events.paused = false;
  battle.enemies[0].hp = 0;
  assert.equal(escapeDifficulty(battle), 4);
  battle.formation.escapeDifficulty = 2;
  assert.equal(escapeDifficulty(battle), 2);
  assert.equal(tickEscape(battle, 2.2), true);
});

test("source CharProp selector bits decode to the run probability without a fallback warning", () => {
  const { battle, warnings } = fixture();
  battle.players[0].runFactorBits = 1;
  requestEscape(battle);
  assert.equal(battle.escapeState.members[0].factor, 4);
  assert.deepEqual(warnings, []);
});
