import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { autoBattleInput } from "./battle-input.js";
import { Battle, calculateDamage } from "./battle.js";
import { setCondition } from "./ability-effects.js";

test("the last surviving member heals before repeating a low-HP resurrection", () => {
  const actor = { side: "player", hp: 30, maxHp: 100 },
    fallen = { side: "player", hp: 0, maxHp: 100 };
  const used = [],
    commands = [
      { id: "item:10", kind: "item", itemId: 9, revive: true },
      { id: "item:3", kind: "item", itemId: 2, amount: 250 },
    ];
  const battle = {
    players: [actor, fallen],
    enemies: [{ side: "enemy", hp: 100, maxHp: 100 }],
    context: {},
    data: { items: { 2: { battle_function_group_id: 1 }, 9: { battle_function_group_id: 2 } } },
    events: { autoCommand: () => null },
    commandsFor: () => commands,
    supported: () => true,
    targetable: (unit) => unit.hp > 0,
    choose: (index, id, target) => {
      used.push({ index, id, target });
      return true;
    },
  };
  assert.equal(
    autoBattleInput(battle, actor, () => ({ amount: 10 })),
    true,
  );
  assert.equal(used[0].id, "item:3");
  assert.deepEqual(used[0].target, { side: "player", index: 0 });
  actor.hp = 90;
  used.length = 0;
  autoBattleInput(battle, actor, () => ({ amount: 10 }));
  assert.equal(used[0].id, "item:10");
});

test("an otherwise lethal random-enemy final attack requests ordinary escape before killing it", () => {
  const players = [1, 2].map((id) => ({ id, side: "player", hp: 200, maxHp: 200 }));
  const quake = { id: 325, all: true, mp: 20, functions: [{ id: 3, values: [1, 0, 0] }] };
  const enemy = {
    side: "enemy",
    hp: 100,
    maxHp: 1200,
    mp: 50,
    aiState: { program: { ops: [["FinalAttackAct", [325], [100]]] } },
  };
  let escaped = 0,
    attacked = 0;
  const battle = {
    players,
    enemies: [enemy],
    context: { randomEncounter: true },
    canEscape: true,
    data: { abilities: { 325: quake } },
    events: { autoCommand: () => null },
    commandsFor: () => [],
    supported: () => true,
    targetable: (unit) => unit.hp > 0,
    warning: () => {},
    requestEscape: () => {
      escaped++;
      return true;
    },
    choose: () => {
      attacked++;
      return true;
    },
  };
  assert.equal(
    autoBattleInput(battle, players[0], () => ({ amount: 300 })),
    true,
  );
  assert.equal(escaped, 1);
  assert.equal(attacked, 0);
  assert.equal(enemy.hp, 100);
  assert(players.every((unit) => unit.hp === 200));
});

test("command scoring accounts for the PR command counter without advancing live AI or randomness", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 2550, maxHp: 2550, mp: 100, aiName: "counter" } },
    abilities: {
      1: { id: 1, name: "Fight", kind: "physical", range: 3, typeId: 4, functions: [{ id: 2 }] },
      124: {
        id: 124,
        name: "Bushido",
        kind: "physical",
        range: 13,
        typeId: 601,
        functions: [{ id: 2 }],
      },
      306: {
        id: 306,
        name: "Acid Rain",
        kind: "magic",
        range: 16,
        all: true,
        mp: 0,
        functions: [{ id: 3, values: [1] }],
      },
    },
    aiPrograms: {
      counter: {
        name: "counter",
        ops: [
          ["SyncAI"],
          ["CounterActReceiveCommand", [601, 306], [0, 100]],
          ["JumpBattleAI", [0]],
        ],
      },
    },
  };
  let draws = 0;
  const party = [1, 2, 3].map((id) => ({
    id,
    hp: 400,
    maxHp: 400,
    mp: 50,
    maxMp: 50,
    abilities: [124],
  }));
  const battle = new Battle({
    data,
    party,
    encounterId: 1,
    random: () => {
      draws++;
      return 0.5;
    },
  });
  const ai = battle.enemies[0].aiState,
    before = { draws, pc: ai.pc, vars: [...ai.vars], wakes: ai.wakes };
  const commands = [];
  battle.choose = (index, id) => {
    commands.push(id);
    return true;
  };
  autoBattleInput(battle, party[0], (actor, target, ability) => ({
    amount: ability.id === 124 ? 600 : ability.id === 306 ? 250 : 200,
  }));
  assert.deepEqual(commands, [1]);
  assert.equal(draws, before.draws);
  assert.equal(ai.pc, before.pc);
  assert.equal(ai.wakes, before.wakes);
  assert.deepEqual(ai.vars, before.vars);
  assert.equal(battle.aiQueue.length, 0);
});

test("automatic Fight does not heal a damaged absorbing enemy when no positive HP attack is available", () => {
  const actor = { side: "player", hp: 300, maxHp: 300 },
    enemy = { side: "enemy", hp: 200, maxHp: 500 };
  const used = [],
    battle = {
      players: [actor],
      enemies: [enemy],
      context: {},
      data: {},
      events: { autoCommand: () => null },
      supported: () => true,
      targetable: (unit) => unit.hp > 0,
      commandsFor: () => [
        { id: 1, kind: "physical", range: 3, functions: [{ id: 2 }] },
        { id: 2, kind: "defend" },
      ],
      choose: (_index, id) => {
        used.push(id);
        return true;
      },
    };
  autoBattleInput(battle, actor, () => ({ amount: -100 }));
  assert.deepEqual(used, [2]);
  assert.equal(enemy.hp, 200);
});

test("a random group capable of killing the party within one action cycle is avoided even with strong offense", () => {
  const players = [1, 2, 3].map((id) => ({
    id,
    side: "player",
    hp: 400,
    maxHp: 500,
    mp: 50,
    maxMp: 100,
  }));
  const water = { id: 43, kind: "magic", mp: 0, all: true, functions: [{ id: 3, values: [1] }] },
    fight = { id: 1, kind: "physical", functions: [{ id: 2 }] };
  const enemies = [1, 2].map((id) => ({
    id,
    side: "enemy",
    hp: 800,
    maxHp: 800,
    mp: 20,
    aiState: { program: { ops: [["Act", [43], [100]]] } },
  }));
  let escapes = 0,
    attacks = 0;
  const battle = {
    players,
    enemies,
    context: { randomEncounter: true },
    canEscape: true,
    data: { abilities: { 1: fight, 43: water } },
    events: { autoCommand: () => null },
    supported: () => true,
    commandsFor: () => [fight],
    targetable: (unit) => unit.hp > 0,
    requestEscape: () => {
      escapes++;
      return true;
    },
    choose: () => {
      attacks++;
      return true;
    },
  };
  autoBattleInput(battle, players[0], (actor, target, ability) => ({
    amount: actor.side === "player" ? 450 : ability.id === 43 ? 250 : 20,
  }));
  assert.equal(escapes, 1);
  assert.equal(attacks, 0);
  battle.context.randomEncounter = false;
  autoBattleInput(battle, players[0], () => ({ amount: 450 }));
  assert.equal(escapes, 1);
  assert.equal(attacks, 1);
});

const sourceData = JSON.parse(
  fs.readFileSync(new URL("../../build/web-data/battle.json", import.meta.url), "utf8"),
);
function sourceBattle(abilities, monsterId = 280, program = null, party = null) {
  const source = sourceData.monsters[monsterId];
  const data = {
    ...sourceData,
    eventPrograms: {},
    aiPrograms: program ? { [source.aiName]: program } : {},
    parties: { 99999: { members: [{ monsterId, slot: 0 }] } },
  };
  let draws = 0;
  const players = party || [
    {
      id: 1,
      hp: 800,
      maxHp: 800,
      mp: 299,
      maxMp: 299,
      level: 22,
      magic: 35,
      attack: 80,
      abilities,
    },
  ];
  const battle = new Battle({
    data,
    party: players,
    encounterId: 99999,
    random: () => {
      draws++;
      return 0.5;
    },
  });
  players[0].ready = true;
  return {
    battle: battle.automaticInputView(),
    actor: players[0],
    enemy: battle.enemies[0],
    calculate: (...args) => calculateDamage(...args, data),
    draws: () => draws,
  };
}

test("owned PR Dispel removes effective Protect/Shell/Haste/Reflect, spending only its real MP and no preview RNG", () => {
  const f = sourceBattle([84, 40]);
  for (const id of [23, 22, 21, 24]) setCondition(f.battle, f.enemy, id, true);
  assert.equal(sourceData.abilities[84].name, "驱魔");
  const before = { mp: f.actor.mp, hp: f.enemy.hp, draws: f.draws() };
  autoBattleInput(f.battle, f.actor, f.calculate);
  assert.equal(f.actor.mp, before.mp - sourceData.abilities[84].mp);
  assert.equal(f.enemy.hp, before.hp);
  for (const id of [23, 22, 21, 24]) assert(!f.enemy.conditions.includes(id));
  assert.equal(f.draws(), before.draws);
  assert.equal(f.enemy.protect, false);
  assert.equal(f.enemy.shell, false);
});

test("Dispel is not wasted on Float without Earth offense or used to undo a useful enemy Stop", () => {
  const f = sourceBattle([84, 40]),
    used = [];
  f.battle.choose = (_index, id) => {
    used.push(id);
    return true;
  };
  autoBattleInput(f.battle, f.actor, f.calculate);
  assert.notEqual(used[0], 84);
  setCondition(f.battle, f.enemy, 23, true);
  setCondition(f.battle, f.enemy, 26, true, { force: true });
  used.length = 0;
  autoBattleInput(f.battle, f.actor, f.calculate);
  assert.notEqual(used[0], 84);
  assert(f.enemy.conditions.includes(26));
});

test("an owned Shell is chosen for substantial source magic damage and not for ignore-defense ninja scrolls", () => {
  const program = (id) => ({
    name: "fixture",
    ops: [["SyncAI"], ["Act", [id], [100]], ["JumpBattleAI", [0]]],
  });
  const f = sourceBattle([77, 40], 280, program(40));
  autoBattleInput(f.battle, f.actor, f.calculate);
  assert(f.actor.conditions.includes(22));
  assert.equal(f.actor.mp, 299 - sourceData.abilities[77].mp);
  const ninja = sourceBattle([77, 40], 4, program(196)),
    used = [];
  ninja.battle.choose = (_index, id) => {
    used.push(id);
    return true;
  };
  autoBattleInput(ninja.battle, ninja.actor, ninja.calculate);
  assert.notEqual(used[0], 77);
});

test("ordinary multi-target Cure pays once and is chosen when its actual total healing exceeds single-target healing", () => {
  const party = [1, 2, 3].map((id, n) => ({
    id,
    hp: 50 + n * 30,
    maxHp: 500,
    mp: 100,
    maxMp: 100,
    level: 20,
    magic: 35,
    abilities: [31],
  }));
  const f = sourceBattle([31], 1, null, party),
    before = party.map((p) => p.hp);
  autoBattleInput(f.battle, f.actor, f.calculate);
  assert.equal(f.actor.mp, 100 - sourceData.abilities[31].mp);
  assert(party.every((p, n) => p.hp > before[n]));
  const single = sourceBattle(
    [31],
    1,
    null,
    [1, 2, 3].map((id, n) => ({
      id,
      hp: n ? 490 : 50,
      maxHp: 500,
      mp: 100,
      maxMp: 100,
      level: 20,
      magic: 35,
      abilities: [31],
    })),
  );
  autoBattleInput(single.battle, single.actor, single.calculate);
  assert(single.actor.hp > 50);
  assert.equal(single.battle.players[1].hp, 490);
  assert.equal(single.battle.players[2].hp, 490);
});

test("MP scoring rejects a costly marginal single-target summon but preserves efficient total AoE damage", () => {
  const actor = { side: "player", hp: 500, maxHp: 500, mp: 200, maxMp: 200 },
    used = [];
  const fight = { id: 1, kind: "physical", range: 3, mp: 0, functions: [{ id: 2 }] },
    summon = {
      id: 100,
      kind: "magic",
      range: 4,
      all: true,
      mp: 27,
      functions: [{ id: 3, values: [1] }],
    };
  const enemy = () => ({ side: "enemy", hp: 1000, maxHp: 1000, mp: 20 }),
    battle = {
      players: [actor],
      enemies: [enemy()],
      context: {},
      data: {},
      events: { autoCommand: () => null },
      supported: () => true,
      targetable: (u) => u.hp > 0,
      commandsFor: () => [fight, summon],
      choose: (_index, id) => {
        used.push(id);
        return true;
      },
    };
  const calculate = (_a, _t, ability) => ({ amount: ability.id === 100 ? 250 : 150 });
  autoBattleInput(battle, actor, calculate);
  assert.deepEqual(used, [1]);
  battle.enemies.push(enemy(), enemy());
  used.length = 0;
  autoBattleInput(battle, actor, calculate);
  assert.deepEqual(used, [100]);
});

test("low-MP caster uses owned PR Osmose and transfers only the actual enemy supply", () => {
  const f = sourceBattle([81], 4, null, [
    { id: 9, hp: 600, maxHp: 600, mp: 10, maxMp: 260, level: 20, magic: 35, abilities: [81] },
  ]);
  const before = { actor: f.actor.mp, enemy: f.enemy.mp, hp: f.enemy.hp };
  autoBattleInput(f.battle, f.actor, f.calculate);
  const taken = before.enemy - f.enemy.mp;
  assert(taken > 0);
  assert(taken <= before.enemy);
  assert.equal(f.actor.mp, before.actor - sourceData.abilities[81].mp + taken);
  assert.equal(f.enemy.hp, before.hp);
});

test("Osmose avoids undead reverse transfer and an empty enemy MP pool", () => {
  const f = sourceBattle([81], 4, null, [
      { id: 9, hp: 600, maxHp: 600, mp: 10, maxMp: 260, level: 20, magic: 35, abilities: [81] },
    ]),
    used = [];
  f.battle.choose = (_index, id) => {
    used.push(id);
    return true;
  };
  f.enemy.undead = true;
  autoBattleInput(f.battle, f.actor, f.calculate);
  assert.notEqual(used[0], 81);
  f.enemy.undead = false;
  f.enemy.mp = 0;
  used.length = 0;
  autoBattleInput(f.battle, f.actor, f.calculate);
  assert.notEqual(used[0], 81);
});

test("Rasp output is valued against actual remaining MP only for source MP-death enemies", () => {
  const actor = { side: "player", hp: 500, maxHp: 500, mp: 200, maxMp: 200 },
    enemy = { side: "enemy", hp: 1000, maxHp: 1000, mp: 40, diesAtZeroMp: true },
    used = [];
  const battle = {
    players: [actor],
    enemies: [enemy],
    context: {},
    data: sourceData,
    events: { autoCommand: () => null },
    supported: () => true,
    targetable: (u) => u.hp > 0,
    commandsFor: () => [sourceData.abilities[1], sourceData.abilities[66]],
    choose: (_index, id) => {
      used.push(id);
      return true;
    },
  };
  const calculate = (_a, _t, ability) => ({
    amount: ability.id === 66 ? 30 : 25,
    ...(ability.id === 66 ? { resource: "mp" } : {}),
  });
  autoBattleInput(battle, actor, calculate);
  assert.deepEqual(used, [66]);
  enemy.diesAtZeroMp = false;
  used.length = 0;
  autoBattleInput(battle, actor, calculate);
  assert.deepEqual(used, [1]);
});

test("selectable Blizzard compares real side damage in both danger estimation and target choice, including overkill caps", () => {
  const actor = { side: "player", hp: 500, maxHp: 500, mp: 200, maxMp: 200 },
    used = [];
  const fight = sourceData.abilities[1],
    blizzard = { ...sourceData.abilities[41], all: false, selectableAll: true };
  const enemies = Array.from({ length: 4 }, () => ({
    side: "enemy",
    hp: 300,
    maxHp: 1000,
    mp: 20,
    aiState: { program: { ops: [["Act", [1], [100]]] } },
  }));
  let escapes = 0;
  const counts = [];
  const battle = {
    players: [actor],
    enemies,
    context: { randomEncounter: true },
    canEscape: true,
    data: sourceData,
    events: { autoCommand: () => null },
    supported: () => true,
    targetable: (u) => u.hp > 0,
    commandsFor: () => [fight, blizzard],
    requestEscape: () => {
      escapes++;
      return true;
    },
    choose: (_index, id, target) => {
      used.push({ id, target });
      return true;
    },
  };
  const calculate = (source, _target, ability, _random, count) => {
    if (source.side === "enemy") return { amount: 100 };
    if (ability.id !== 41) return { amount: 80 };
    counts.push(count);
    return { amount: count > 1 ? 300 : 600 };
  };
  autoBattleInput(battle, actor, calculate);
  assert.equal(escapes, 0);
  assert.equal(used[0].id, 41);
  assert.deepEqual(used[0].target, { side: "enemy", index: 0, all: true });
  assert(counts.includes(1));
  assert(counts.includes(4));
  battle.context.randomEncounter = false;
  enemies.forEach((enemy, n) => (enemy.hp = n ? 1 : 1000));
  used.length = 0;
  autoBattleInput(battle, actor, calculate);
  assert.equal(used[0].id, 41);
  assert.deepEqual(used[0].target, { side: "enemy", index: 0, all: false });
});
