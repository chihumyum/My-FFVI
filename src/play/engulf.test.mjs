import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Battle } from "./battle.js";
import { PlayGame } from "./game.js";
import { actionBlocked, setCondition } from "./ability-effects.js";

const data = JSON.parse(
  fs.readFileSync(new URL("../../build/web-data/battle.json", import.meta.url)),
);
const field = JSON.parse(
  fs.readFileSync(new URL("../../build/web-data/data.json", import.meta.url)),
);
const party = () =>
  [1, 2, 5, 7].map((id) => ({ id, level: 20, hp: 600, maxHp: 600, mp: 40, maxMp: 40, speed: 30 }));
function makeBattle(players = party()) {
  const ended = [];
  const battle = new Battle({
    data,
    party: players,
    encounterId: 336,
    random: () => 0.99,
    onEnd: (result) => ended.push(result),
  });
  return { battle, ended };
}

test("real PR Engulf removes only its recipient from actions/targets without killing or escaping", () => {
  const { battle } = makeBattle();
  const target = battle.players[0],
    hp = target.hp;
  battle.perform(battle.enemies[0], target, data.abilities[350]);
  battle.checkEnd();
  assert.equal(battle.phase, "active");
  assert.equal(target.hp, hp);
  assert(target.conditions.includes(71));
  assert.equal(target.engulfed, true);
  assert.equal(target.hidden, true);
  assert.equal(target.escaped, false);
  assert.equal(battle.alive(target), false);
  assert.equal(battle.targetable(target), false);
  assert.equal(actionBlocked(data, target), true);
  target.ready = true;
  assert.equal(battle.choose(0, 2), false);
  setCondition(battle, target, 71, false);
  assert.equal(target.engulfed, false);
  assert.equal(target.hidden, false);
});

test("all source participants must be engulfed: death plus partial Engulf remains a real defeat", () => {
  const players = party();
  players[0].hp = 0;
  const { battle } = makeBattle(players);
  for (const target of players.slice(1))
    battle.perform(battle.enemies[0], target, data.abilities[350]);
  battle.checkEnd();
  assert.equal(battle.phase, "defeat");
  assert.equal(battle.result.fieldReturn, undefined);
  assert.equal(battle.result.exp, 0);
});

test("defeating Zone Eater after partial Engulf returns the swallowed member without a cave callback", () => {
  const { battle } = makeBattle();
  battle.perform(battle.enemies[0], battle.players[0], data.abilities[350]);
  battle.enemies[0].hp = 0;
  battle.checkEnd();
  for (let n = 0; n < 10 && battle.phase === "active"; n++) battle.tick(0.1);
  assert.equal(battle.result?.outcome, "victory");
  assert.equal(battle.result.fieldReturn, undefined);
  assert.equal(battle.players[0].hp, 600);
  assert.equal(battle.players[0].hidden, false);
  assert.equal(battle.players[0].engulfed, false);
  assert.equal(battle.players[0].conditions.includes(71), false);
});

test("source Zone Eater AI plus ordinary Defend inputs ends full Engulf without death, victory or rewards", () => {
  const { battle, ended } = makeBattle();
  for (let time = 0; time < 60 && battle.phase === "active"; time += 0.1) {
    battle.tick(0.1);
    for (const [index, unit] of battle.players.entries()) if (unit.ready) battle.choose(index, 2);
  }
  assert.equal(battle.result?.fieldReturn, "engulf");
  assert.equal(battle.result.outcome, "escape");
  assert.equal(battle.result.exp, 0);
  assert.equal(battle.result.gil, 0);
  assert.equal(battle.result.ap, 0);
  assert.equal(battle.enemies[0].hp, data.monsters[370].hp);
  assert(
    battle.players.every(
      (unit) =>
        unit.hp === 600 &&
        !unit.engulfed &&
        !unit.hidden &&
        !unit.escaped &&
        !unit.conditions.includes(71),
    ),
  );
  battle.checkEnd();
  assert.equal(ended.length, 1);
});

test("world battle Engulf invokes the real PR return script; its own opcodes select the cave entrance", async () => {
  const loaded = [],
    events = [];
  const game = new PlayGame({
    data: field,
    battleData: data,
    Battle,
    random: () => 0.99,
    loadMap: async (id) => {
      loaded.push(id);
      return JSON.parse(
        fs.readFileSync(new URL(`../../build/web-data/maps/${id}.json`, import.meta.url)),
      );
    },
    onEvent: (event) => events.push(event),
  });
  game.warn = (_task, message) => game.warnings.push({ message });
  game.mapId = 2;
  game.map = { worldTerrain: {}, entities: [], groups: {} };
  const players = party();
  game.roster = Object.fromEntries(players.map((unit) => [unit.id, unit]));
  game.partySlots = [players.map((unit) => unit.id), [], []];
  const task = { program: null, pc: 0, locals: [], done: false };
  game.encounter(336, "sc_e_0849", task, { randomEncounter: true });
  for (let time = 0; time < 60 && game.battle; time += 0.1) {
    game.tick(0.1);
    for (const [index, unit] of (game.battle?.players || []).entries())
      if (unit.ready) game.battle.choose(index, 2);
  }
  assert.equal(game.over, undefined);
  assert.equal(game.battles.at(-1)?.fieldReturn, "engulf");
  assert.equal(
    game.banks.ScenarioVariable?.[2],
    undefined,
    "battle settlement itself must not inject the area variable",
  );
  assert.equal(game.history.at(-1).script, field.scriptIds[860]);
  assert.equal(
    game.history.some((row) => row.script === "sc_e_0849"),
    false,
  );
  assert(game.warnings.some((row) => /callback association is inferred/.test(row.message)));
  game.tick(0.1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loaded, [500]);
  assert.equal(game.banks.ScenarioVariable[2], 30791);
  assert.equal(game.mapId, 500);
  assert.deepEqual([game.player.x, game.player.y, game.player.layer], [12, 16, 1]);
  assert.equal(game.telepo.length, 1);
  assert(events.some((event) => event.kind === "battle-end" && event.fieldReturn === "engulf"));
});
