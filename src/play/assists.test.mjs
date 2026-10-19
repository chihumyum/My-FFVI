import test from "node:test";
import assert from "node:assert/strict";
import { executeAbilityEffects, setCondition, tickConditions } from "./ability-effects.js";
import { PlayGame } from "./game.js";

function fixture() {
  const assists = { invincible: true };
  const player = {
    id: 1,
    side: "player",
    hp: 80,
    maxHp: 100,
    mp: 20,
    maxMp: 30,
    level: 3,
    strength: 31,
    conditions: [],
  };
  const enemy = { id: 2, side: "enemy", hp: 100, maxHp: 100, level: 3, conditions: [] };
  const host = {
    context: { assists },
    data: {
      conditions: {
        5: { condition_type: 5 },
        11: { condition_type: 11 },
        86: { condition_type: 628 },
      },
    },
    random: () => 0,
    players: [player],
    enemies: [enemy],
    captures: new Map(),
    elapsed: 0,
    warning() {},
    addLog() {},
    event() {},
    events: { beforeDamage: (_a, _t, _s, n) => n },
  };
  const cast = (target, functions) =>
    executeAbilityEffects(
      host,
      enemy,
      target,
      { id: 1000, kind: "magic", functions },
      1,
      {},
      () => ({ amount: 30, missed: false, critical: false }),
    );
  return { host, assists, player, enemy, cast };
}

test("invincibility prevents ordinary and fixed HP loss, keeps real stats, healing and enemies normal, and switches off immediately", () => {
  const { assists, player, enemy, cast } = fixture();
  const stats = {
    level: player.level,
    strength: player.strength,
    maxHp: player.maxHp,
    mp: player.mp,
  };
  assert.equal(cast(player, [{ id: 3, values: [] }]).amount, 0);
  assert.equal(cast(player, [{ id: 56, values: [1, 1] }]).amount, 0);
  assert.equal(player.hp, 80);
  cast(player, [{ id: 56, values: [1, 95] }]);
  assert.equal(player.hp, 95, "Healing still works");
  assert.equal(cast(enemy, [{ id: 3, values: [] }]).amount, 30);
  assert.deepEqual(
    { level: player.level, strength: player.strength, maxHp: player.maxHp, mp: player.mp },
    stats,
  );
  assists.invincible = false;
  assert.equal(cast(player, [{ id: 3, values: [] }]).amount, 30);
  assert.equal(player.hp, 65);
});

test("instant death, petrify and zombie are protected without changing condition immunities; disabling restores the source rule", () => {
  const { host, assists, player } = fixture();
  for (const id of [5, 11, 86])
    assert.equal(setCondition(host, player, id, true, { force: true }), false);
  assert.equal(player.hp, 80);
  assert.deepEqual(player.conditions, []);
  assert.equal(player.conditionImmunities, undefined);
  assists.invincible = false;
  assert.equal(setCondition(host, player, 5, true), true);
  assert.equal(player.hp, 0);
});

test("poison and sap cannot chip protected HP; disabling resumes their existing clocks", () => {
  const { host, assists, player } = fixture();
  host.data.conditions[10] = { condition_type: 10, rate_type1: 3, rate_value1: 8 };
  player.conditions = [10];
  tickConditions(host, player, 30);
  assert.equal(player.hp, 80);
  assists.invincible = false;
  tickConditions(host, player, 30);
  assert(player.hp < 80);
});

test("battle and dialogue automation are separate tick inputs; legacy regression auto remains compatible", () => {
  const game = new PlayGame({ data: {}, battleData: {}, loadMap: async () => ({}) });
  const input = [];
  game.battle = { tick: (_dt, auto) => input.push(auto) };
  const position = { ...game.player };
  game.tick(0.1, { autoDialogue: true, autoBattle: false });
  game.tick(0.1, { autoBattle: true, autoEvents: false });
  game.tick(0.1, { auto: true });
  assert.deepEqual(input, [false, true, true]);
  assert.deepEqual(game.player, position);
});

test("story inputs do not skip dialogue; dialogue-only automation does not choose a plot branch", () => {
  const game = new PlayGame({ data: {}, battleData: {}, loadMap: async () => ({}) });
  game.checkTriggers = () => {};
  game.tickNpc = () => {};
  let confirmed = 0;
  game.confirm = () => {
    confirmed++;
    game.dialogue = null;
  };
  game.dialogue = { text: "对白", elapsed: 0 };
  game.tick(1, { autoEvents: true, autoDialogue: false });
  assert.equal(confirmed, 0);
  game.tick(1, { autoDialogue: true, autoEvents: false });
  assert.equal(confirmed, 1);
  game.dialogue = { text: "选择", elapsed: 0, choices: ["是", "否"] };
  game.tick(1, { autoDialogue: true, autoEvents: false });
  assert.equal(confirmed, 1);
  assert(game.dialogue);
});
