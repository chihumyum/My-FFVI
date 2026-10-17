import test from "node:test";
import assert from "node:assert/strict";
import { Battle } from "./battle.js";
import { PlayGame } from "./game.js";
import {
  openColosseum,
  colosseumWagers,
  selectColosseumWager,
  selectColosseumChallenger,
  confirmColosseum,
  cancelColosseum,
} from "./colosseum.js";

function host() {
  const battleData = {
    colosseum: {
      wagers: { 10: { rewardId: 20, formationId: 1000 } },
      special: { contentId: 135, formationId: 1021, requiredFlag: 116, absentFlag: 119 },
    },
    parties: { 1000: { members: [{ monsterId: 1 }], ap: 9 } },
    monsters: {
      1: {
        id: 1,
        name: "Opponent",
        hp: 1,
        maxHp: 1,
        exp: 999,
        gil: 99,
        drops: [{ id: 30 }],
        dropRate: 100,
      },
    },
    commands: { 1: { id: 1, ability_id: 1 } },
    abilities: {
      1: { id: 1, name: "Fight", kind: "physical", power: 100, mp: 0, target: "enemy", flags: [1] },
    },
    contents: { 10: { type_id: 1 }, 20: { type_id: 1 } },
  };
  const game = new PlayGame({
    data: { programs: {}, init: [] },
    battleData,
    Battle,
    random: () => 0,
  });
  game.partySlots = [[1]];
  for (const id of [1, 2])
    game.roster[id] = {
      id,
      name: "Challenger",
      level: 10,
      hp: 1000,
      maxHp: 1000,
      mp: 10,
      maxMp: 10,
      commands: [1],
      enabled: true,
      conditions: [],
    };
  game.inventory = { 10: 2 };
  return { game, task: { locals: [], waitFor: null } };
}
function start(game, task) {
  openColosseum(game, task);
  assert.equal(selectColosseumWager(game, 10), true);
  assert.equal(selectColosseumChallenger(game, 2), true);
  assert.equal(confirmColosseum(game), true);
}

test("a colosseum wager is consumed only on explicit confirmation, with one actually available challenger", () => {
  const { game, task } = host();
  openColosseum(game, task);
  assert.equal(selectColosseumWager(game, 99), false);
  assert.equal(selectColosseumWager(game, 10), true);
  assert.equal(selectColosseumChallenger(game, 13), false);
  assert.equal(selectColosseumChallenger(game, 2), true);
  assert.equal(game.inventory[10], 2);
  cancelColosseum(game);
  assert.equal(game.inventory[10], 2);
  assert.equal(task.waitFor, null);
  start(game, task);
  assert.equal(game.inventory[10], 1);
  assert.deepEqual(
    game.battle.players.map((u) => u.id),
    [2],
  );
  assert.deepEqual(
    game.partySlots,
    [[1]],
    "choosing a reserve fighter must not change the field party",
  );
  assert.deepEqual(
    game.battle.readyPlayers,
    [],
    "the compulsory fight must not expose player commands",
  );
});

test("colosseum rules act without regression auto input and award only one wager prize", () => {
  const { game, task } = host();
  start(game, task);
  for (let i = 0; i < 300 && game.battle; i++) game.tick(0.1, { auto: false });
  assert.equal(game.battle, null);
  assert.equal(game.battles.at(-1).outcome, "victory");
  assert.equal(game.inventory[20], 1);
  assert.equal(game.inventory[30], undefined);
  assert.deepEqual(
    [game.battles.at(-1).exp, game.battles.at(-1).ap, game.battles.at(-1).gil],
    [0, 0, 0],
  );
  assert.equal(game.roster[2].hp, game.roster[2].maxHp);
  assert.equal(game.roster[2].mp, game.roster[2].maxMp);
});

test("defeat forfeits the wager, returns from colosseum without field game-over and cannot award the prize", () => {
  const { game, task } = host();
  start(game, task);
  game.battle.players[0].hp = 0;
  game.battle.checkEnd();
  assert.equal(game.battle, null);
  assert.equal(game.battles.at(-1).outcome, "defeat");
  assert.equal(game.inventory[10], 1);
  assert.equal(game.inventory[20], undefined);
  assert.equal(game.over, undefined);
  assert.match(game.dialogue.text, /失去押注/);
  game.confirm();
  assert.equal(task.waitFor, null);
});

test("special Shadow pairing requires the actual rescued flag and disappears after actual recruitment", () => {
  const { game } = host();
  game.battleData.colosseum.wagers[135] = { rewardId: 135, formationId: 1086 };
  game.battleData.parties[1086] = { members: [] };
  game.battleData.parties[1021] = { members: [] };
  game.inventory[135] = 1;
  assert.equal(colosseumWagers(game).find((w) => w.contentId === 135).formationId, 1086);
  game.banks.ScenarioFlag2 = { 116: 1 };
  assert.equal(colosseumWagers(game).find((w) => w.contentId === 135).formationId, 1021);
  game.banks.ScenarioFlag2[119] = 1;
  assert.equal(colosseumWagers(game).find((w) => w.contentId === 135).formationId, 1086);
});

test("living enemies retreating through a PR effect cannot grant victory rewards", () => {
  const { game } = host();
  game.encounter(1000, null, { waitFor: null });
  game.battle.enemies[0].escaped = true;
  game.battle.checkEnd();
  assert.equal(game.battles.at(-1).outcome, "escape");
  assert.equal(game.battles.at(-1).exp, 0);
  assert.equal(game.battles.at(-1).gil, 0);
});

test("a battle-owned timer pause cannot freeze the field countdown after victory", () => {
  for (const alreadyPaused of [false, true]) {
    const { game } = host();
    game.banks.PlaySystems = { timer: { remaining: 100, paused: alreadyPaused } };
    game.battleData.parties[1000].script = "timer";
    game.battleData.scriptNames = { timer: "sc_b_timer" };
    game.battleData.eventPrograms = {
      sc_b_timer: {
        name: "sc_b_timer",
        locals: [],
        ops: [
          ["SysCall", [], [], ["タイマー一時停止"]],
          ["Exit", [], [], []],
        ],
      },
    };
    game.encounter(1000, null, { waitFor: null });
    assert.equal(game.banks.PlaySystems.timer.paused, true);
    game.battle.enemies[0].hp = 0;
    game.battle.checkEnd();
    assert.equal(game.banks.PlaySystems.timer.paused, alreadyPaused);
    assert.equal(game.banks.PlaySystems.timer.remaining, 100);
  }
});

test("a mixed encounter still wins when an enemy is defeated, but a surviving runaway grants no rewards", () => {
  const { game } = host();
  game.battleData.parties[1000].members.push({ monsterId: 1 });
  game.encounter(1000, null, { waitFor: null });
  game.battle.enemies[0].hp = 0;
  game.battle.enemies[1].escaped = true;
  game.battle.checkEnd();
  assert.equal(game.battles.at(-1).outcome, "victory");
  assert.equal(game.battles.at(-1).exp, 999);
  assert.equal(game.battles.at(-1).gil, 99);
});
