import test from "node:test";
import assert from "node:assert/strict";
import { Battle, calculateDamage, atbRate } from "./battle.js";

const actor = { side: "player", level: 3, strength: 31, magic: 39, attack: 42, criticalRate: 0 };
const target = { defense: 100, magicDefense: 155, evasion: 0, magicEvasion: 0 };
const fight = { kind: "physical", power: 0, accuracy: 100 };
const fire = { kind: "magic", power: 60, accuracy: 100, flags: [1], elements: [1] };

test("ordinary physical damage uses level, strength, attack, variance and target defense", () => {
  assert.equal(calculateDamage(actor, target, fight, () => 0.5).amount, 28);
  assert.equal(calculateDamage({ ...actor, level: 6 }, target, fight, () => 0.5).amount, 37);
  assert.equal(calculateDamage(actor, { ...target, defense: 255 }, fight, () => 0.5).amount, 1);
});

test("PR beam power is used with SNES magic scaling and elemental priority", () => {
  assert.equal(calculateDamage(actor, target, fire, () => 0.5).amount, 169);
  assert.equal(
    calculateDamage(actor, { ...target, elementResistances: { 1: 1 } }, fire, () => 0.5).amount,
    338,
  );
  assert.equal(
    calculateDamage(actor, { ...target, elementResistances: { 1: 4 } }, fire, () => 0.5).amount,
    -169,
  );
  assert.equal(
    calculateDamage(actor, { ...target, elementResistances: { 1: 3 } }, fire, () => 0.5).amount,
    0,
  );
  assert.equal(
    calculateDamage(actor, { ...target, elementResistances: { 1: 2 } }, fire, () => 0.5).amount,
    84,
  );
});

test("PR initial status providers apply to monsters and Float supplies its Earth immunity", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 100, maxHp: 100, initialConditions: [93, 96] } },
    conditions: { 93: { condition_type: 19 }, 96: { condition_type: 409, attribute_group_id: 6 } },
    attributeGroups: [{ group_id: 6, attribute_id: 4, type_id: 3 }],
  };
  const battle = new Battle({
    data,
    party: [{ id: 1, hp: 100, maxHp: 100 }],
    encounterId: 1,
    random: () => 0.5,
  });
  const enemy = battle.enemies[0];
  assert(enemy.protect);
  assert.deepEqual(enemy.conditions, [93, 96]);
  const earth = { ...fire, elements: [4] };
  assert.equal(calculateDamage(actor, enemy, earth, () => 0.5, 1, data).amount, 0);
  assert(
    calculateDamage(actor, { ...enemy, conditions: [] }, earth, () => 0.5, 1, data).amount > 0,
  );
  assert.equal(data.monsters[1].conditions, undefined);
});

test("evasion can prevent ordinary hits and unblockable attacks bypass it", () => {
  assert.equal(calculateDamage(actor, { ...target, evasion: 128 }, fight, () => 0.5).missed, true);
  assert.equal(
    calculateDamage(actor, { ...target, magicEvasion: 128 }, fire, () => 0.5).missed,
    false,
  );
});

test("healing ignores defense and critical multipliers", () => {
  const healing = { kind: "heal", power: 50, accuracy: 100 };
  assert.equal(calculateDamage(actor, target, healing, () => 0.5).amount, 359);
  assert.equal(
    calculateDamage(actor, { ...target, magicDefense: 0 }, healing, () => 0.5).amount,
    359,
  );
});

test("ATB fills in SNES two-frame updates, with player and enemy speed scaling", () => {
  assert.equal(atbRate({ speed: 33, side: "player" }), 14.556884765625);
  assert.ok(atbRate({ speed: 33, side: "enemy" }) < atbRate({ speed: 33, side: "player" }));
  assert.ok(atbRate({ speed: 50, side: "player" }) > atbRate({ speed: 33, side: "player" }));
});

test("Berserk boosts physical damage and Trance reduces incoming magic only", () => {
  const damage = (source, recipient, ability) =>
    calculateDamage(source, recipient, ability, () => 0.5).amount;
  assert(damage({ ...actor, berserk: true }, target, fight) > damage(actor, target, fight));
  assert.equal(damage({ ...actor, berserk: true }, target, fire), damage(actor, target, fire));
  assert(damage(actor, { ...target, trance: true }, fire) < damage(actor, target, fire));
  assert.equal(damage(actor, { ...target, trance: true }, fight), damage(actor, target, fight));
  assert.equal(damage(actor, { ...target, conditions: [61] }, fire), damage(actor, target, fire));
});

test("a normal escape completes as escape with no experience, Gil or victory reward", () => {
  const party = [{ id: 2, hp: 200, maxHp: 200, mp: 20, maxMp: 20, exp: 50 }];
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 500, maxHp: 500, exp: 1000, gil: 500 } },
  };
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  const hpBefore = party[0].hp;
  assert.equal(battle.requestEscape(), true);
  battle.tick(5);
  assert.equal(battle.phase, "escape");
  assert.equal(battle.result.code, 1);
  assert.equal(battle.result.exp, 0);
  assert.equal(battle.result.gil, 0);
  assert.equal(party[0].exp, 50);
  assert(party[0].hp > 0 && party[0].hp <= hpBefore);
  const next = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  assert.equal(next.phase, "active");
  assert.equal(next.players[0].escaped, false);
  assert.equal(next.players[0].removed, false);
});

test("a source final Snort that ejects the living party returns escape rather than a fabricated defeat or victory", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 100, maxHp: 100, exp: 100, gil: 100, aiName: "snort" } },
    abilities: {
      1322: { id: 1322, name: "Snort", range: 4, all: true, functions: [{ id: 16, values: [2] }] },
    },
    aiPrograms: {
      snort: {
        name: "snort",
        ops: [["SyncAI"], ["FinalAttackAct", [1322], [100]], ["JumpBattleAI", [0]]],
      },
    },
  };
  const party = [1, 2, 3].map((id) => ({ id, hp: 200, maxHp: 200 }));
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  const enemy = battle.enemies[0];
  enemy.hp = 0;
  enemy.aiState.wake("final");
  battle.drainAI();
  battle.checkEnd();
  assert.equal(battle.phase, "escape");
  assert.equal(battle.result.code, 1);
  assert.equal(battle.result.exp, 0);
  assert.equal(battle.result.gil, 0);
  assert(party.every((unit) => unit.hp === 200 && unit.escaped));
});

test("a real all-party escape item spends one unit and respects source escape prohibitions", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 1000, maxHp: 1000, exp: 1000, gil: 500 } },
    contents: { 23: { type_id: 1, type_value: 22 } },
    items: { 22: { id: 22, battle_function_group_id: 16, battle_renge_id: 2, destroy_rate: 100 } },
    functions: { 16: { function1_id: 16, function1_value1: 2 } },
  };
  const party = [1, 2, 3].map((id) => ({ id, hp: 200, maxHp: 200 })),
    inventory = { 23: 2 };
  const battle = new Battle({ data, party, inventory, encounterId: 1, random: () => 0.5 });
  party[0].ready = true;
  assert(battle.useItem(0, 23));
  assert.equal(inventory[23], 1);
  assert.equal(battle.phase, "escape");
  assert.equal(battle.result.code, 1);
  assert.equal(battle.result.exp, 0);
  assert.equal(battle.result.gil, 0);
  assert(party.every((unit) => unit.hp === 200 && unit.escaped));
  const blocked = new Battle({
    data: { ...data, parties: { 1: { ...data.parties[1], notEscape: true } } },
    party,
    inventory,
    encounterId: 1,
    random: () => 0.5,
  });
  party[0].ready = true;
  assert(blocked.useItem(0, 23));
  assert.equal(inventory[23], 0);
  assert.equal(blocked.phase, "active");
  assert(party.every((unit) => !unit.escaped));
  assert([...blocked.warnings].some((message) => message.includes("forbids escape")));
});

test("source character commands expose Runic and it absorbs an entire area spell once", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 1000, maxHp: 1000, mp: 50, maxMp: 50 } },
    commands: { 16: { ability_id: 11 } },
    conditions: { 57: { condition_type: 612 } },
    abilities: {
      11: { id: 11, name: "Runic", range: 5, mp: 0, functions: [{ id: 9, values: [57, 1, 0] }] },
      40: {
        id: 40,
        name: "Fire",
        range: 4,
        all: true,
        mp: 4,
        kind: "magic",
        power: 20,
        flags: [3],
        functions: [{ id: 3, values: [1, 0, 0] }],
      },
    },
  };
  const party = [
    { id: 7, hp: 300, maxHp: 300, mp: 10, maxMp: 50, commands: [16] },
    { id: 2, hp: 300, maxHp: 300 },
  ];
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.25 });
  assert(battle.actionsFor(0).some((command) => command.id === 11));
  party[0].ready = true;
  assert.equal(battle.choose(0, 11), true);
  battle.queueAIAction({
    actor: battle.enemies[0],
    abilityId: 40,
    all: true,
    script: "fixture",
    index: 0,
  });
  battle.drainAI();
  assert.deepEqual(
    party.map((unit) => unit.hp),
    [300, 300],
  );
  assert.equal(party[0].mp, 14);
  assert.equal(party[0].runic, false);
  assert(!party[0].conditions.includes(57));
});

test("Throw is a selectable owned inventory command and cannot consume an equipped or absent weapon", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 1000, maxHp: 1000 } },
    contents: { 100: { type_id: 2, type_value: 4 } },
    weapons: { 4: { id: 4, throw_flag: 1, attack: 40 } },
    abilities: { 10: { id: 10, range: 3, mp: 0, functions: [{ id: 51, values: [0, 0, 0] }] } },
  };
  const party = [{ id: 4, hp: 300, maxHp: 300, abilities: [10], equipment: [100] }],
    inventory = { 100: 1 };
  const battle = new Battle({ data, party, inventory, encounterId: 1, random: () => 0.25 });
  assert(battle.actionsFor(0).some((command) => command.id === "throw:100"));
  party[0].ready = true;
  assert.equal(battle.choose(0, "throw:999", 0), false);
  assert.equal(inventory[100], 1);
  assert.equal(battle.choose(0, "throw:100", 0), true);
  assert.equal(inventory[100], 0);
  assert.equal(party[0].equipment[0], 100);
  assert(battle.enemies[0].hp < 1000);
  assert(!battle.actionsFor(0).some((command) => command.id === "throw:100"));
});

test("Berserk owns an ordinary ready turn even with automatic play switched off", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 1000, maxHp: 1000, speed: 0 } },
    conditions: { 91: { condition_type: 410 } },
    abilities: {
      1: { id: 1, kind: "physical", range: 3, power: 0, functions: [{ id: 2, values: [0, 0, 0] }] },
    },
  };
  const party = [{ id: 2, hp: 300, maxHp: 300, speed: 100, attack: 40, conditions: [91] }];
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.25 });
  battle.tick(5, false);
  assert(battle.enemies[0].hp < 1000);
  assert(battle.turns > 0);
});

test("equipment conditions apply on entry and temporary conditions expire at the battle boundary", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 100, maxHp: 100 } },
    conditions: {
      10: { condition_type: 10, until_type: 3 },
      56: { condition_type: 621, until_type: 2 },
      93: { condition_type: 19, until_type: 2 },
    },
  };
  const party = [
    {
      id: 2,
      hp: 200,
      maxHp: 200,
      mp: 20,
      maxMp: 20,
      conditions: [10, 56],
      permanentConditions: [93],
    },
  ];
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.25 });
  assert(party[0].protect);
  assert(party[0].trance);
  assert(party[0].conditions.includes(93));
  battle.enemies[0].hp = 0;
  battle.checkEnd();
  assert.equal(battle.phase, "victory");
  assert.deepEqual(party[0].conditions, [10]);
  assert.equal(party[0].protect, false);
  assert.equal(party[0].trance, false);
  const next = new Battle({ data, party, encounterId: 1, random: () => 0.25 });
  assert(next.players[0].protect);
  assert(next.players[0].conditions.includes(10));
});

test("equipped magicite exposes its source summon once per battle and charges real MP", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 1000, maxHp: 1000 } },
    magicStones: { 62: { summonAbilityId: 88 } },
    abilities: {
      88: {
        id: 88,
        name: "Ramuh",
        kind: "magic",
        range: 3,
        mp: 25,
        power: 20,
        functions: [{ id: 3, values: [1, 0, 0] }],
      },
    },
  };
  const party = [{ id: 2, hp: 200, maxHp: 200, mp: 80, maxMp: 80, magicite: 62 }];
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.25 });
  assert(battle.actionsFor(0).some((command) => command.id === 88));
  party[0].ready = true;
  assert.equal(battle.choose(0, 88, 0), true);
  assert.equal(party[0].mp, 55);
  assert(!battle.actionsFor(0).some((command) => command.id === 88));
  party[0].ready = true;
  assert.equal(battle.choose(0, 88, 0), false);
  assert.equal(party[0].mp, 55);
  const next = new Battle({ data, party, encounterId: 1, random: () => 0.25 });
  assert(next.actionsFor(0).some((command) => command.id === 88));
});

test("battle items use fixed PR recovery, shared content stock and an ordinary action turn", () => {
  const inventory = { 2: 2, 10: 1 };
  const data = {
    functions: {
      1: { function1_id: 1, function1_value1: 1, function1_value2: 2 },
      2: {
        function1_id: 12,
        function1_value1: 428,
        function2_id: 34,
        function2_value1: 2,
        function2_value2: 5,
        function2_value3: 8,
      },
    },
    conditionGroups: [{ group_id: 428, condition_id: 5 }],
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 500, maxHp: 500 } },
    contents: { 2: { type_id: 1, type_value: 1 }, 10: { type_id: 1, type_value: 9 } },
    items: {
      1: { id: 1, battle_function_group_id: 1, battle_renge_id: 7, standard_value: 50 },
      9: { id: 9, battle_function_group_id: 2, battle_renge_id: 7 },
    },
  };
  const party = [
    { id: 2, hp: 20, maxHp: 100, magic: 99 },
    { id: 19, hp: 0, maxHp: 80, conditions: [5] },
  ];
  const battle = new Battle({ data, party, encounterId: 1, inventory, random: () => 0.5 });
  party[0].ready = true;
  party[0].atb = 100;
  assert.equal(battle.choose(0, "item:2", 0), true);
  assert.equal(party[0].hp, 70);
  assert.equal(inventory[2], 1);
  assert.equal(battle.useItem(0, 2, 0), false);
  assert.equal(inventory[2], 1);
  party[0].ready = true;
  party[0].atb = 100;
  assert.equal(battle.useItem(0, 10, 1), true);
  assert.equal(party[1].hp, 10);
  assert.equal(inventory[10], 0);
  assert.deepEqual(party[1].conditions, []);
});

test("Dried Meat uses its PR item/content IDs and targets the actual enemy receiving it", () => {
  const inventory = { 24: 2, 26: 1 },
    data = {
      parties: { 1: { members: [{ monsterId: 549, slot: 2 }] } },
      monsters: { 549: { id: 549, hp: 50000, maxHp: 50000 } },
      contents: { 24: { type_id: 1, type_value: 23 }, 26: { type_id: 1, type_value: 25 } },
      items: {
        23: { id: 23, battle_function_group_id: 1, standard_value: 150, battle_renge_id: 7 },
        25: { id: 25, battle_function_group_id: 19, standard_value: 100, battle_renge_id: 4 },
      },
    };
  const party = [{ id: 6, hp: 100, maxHp: 100 }];
  const battle = new Battle({ data, party, encounterId: 1, inventory, random: () => 0.5 });
  const received = [];
  battle.enemies[0].aiState.wake = (kind, action) => received.push({ kind, action });
  party[0].ready = true;
  assert.equal(battle.itemsFor(0).find((item) => item.itemId === 23).target, "enemy");
  assert.equal(battle.choose(0, "item:24", { side: "enemy", index: 0 }), true);
  assert.equal(inventory[24], 1);
  assert.equal(inventory[26], 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].kind, "reaction");
  assert.equal(received[0].action.item.itemId, 23);
  assert.equal(received[0].action.item.contentId, 24);
  assert.equal(received[0].action.target, battle.enemies[0]);
  party[0].ready = true;
  assert.equal(battle.useItem(0, 24, { side: "player", index: 0 }), true);
  assert.equal(received.at(-1).kind, "observer");
  assert.equal(received.at(-1).action.target, party[0]);
});

test("ADD_VARIABLE_CALC advances the acting PR monster variable without a Fight fallback", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 550 }] } },
    monsters: { 550: { id: 550, hp: 50000, maxHp: 50000 } },
  };
  const battle = new Battle({
    data,
    party: [{ id: 6, hp: 100, maxHp: 100 }],
    encounterId: 1,
    random: () => 0.5,
  });
  const gau = battle.enemies[0];
  battle.perform(gau, gau, {
    id: 1199,
    functions: [
      { id: 19, values: [0, 0, 0] },
      { id: 23, values: [0, 0, 0] },
    ],
    process: "ADD_VARIABLE_CALC",
    dataA: 0,
    dataB: 0,
    dataC: 1,
  });
  assert.equal(gau.aiState.vars[0], 1);
  assert.equal(gau.hp, 50000);
  assert.equal(battle.players[0].hp, 100);
  assert.equal(battle.warnings.has("Ability 1199 effect is not implemented; using Fight."), false);
  battle.perform(gau, gau, {
    id: 1202,
    functions: [{ id: 19 }, { id: 23 }],
    process: "ADD_VARIABLE_CALC",
    dataA: 0,
    dataB: 3,
    dataC: 1,
  });
  assert.equal(gau.aiState.vars[3], 1);
  assert.equal(gau.aiState.vars[0], 1);
  assert.equal(battle.supported({ process: "ADD_VARIABLE_CALC", dataB: 15, dataC: 1 }), false);
});

test("the PR variable companion runs once for an area action without discarding its damage", () => {
  const ability = {
    id: 333,
    functions: [{ id: 2 }, { id: 23 }],
    kind: "physical",
    range: 4,
    power: 0,
    accuracy: 255,
    process: "ADD_VARIABLE_CALC",
    dataA: 0,
    dataB: 2,
    dataC: 1,
  };
  const battle = new Battle({
    data: {
      parties: { 1: { members: [{ monsterId: 1 }] } },
      monsters: { 1: { id: 1, hp: 500, maxHp: 500, attack: 40 } },
      abilities: { 333: ability },
    },
    party: [
      { id: 1, hp: 1000, maxHp: 1000 },
      { id: 2, hp: 1000, maxHp: 1000 },
    ],
    encounterId: 1,
    random: () => 0.5,
  });
  const enemy = battle.enemies[0];
  battle.queueAIAction({ actor: enemy, abilityId: 333, script: "fixture", index: 0 });
  battle.drainAI();
  assert.equal(enemy.aiState.vars[2], 1);
  assert(battle.players.every((unit) => unit.hp < 1000));
});

test("an ordinary MP-draining sword transfers actual MP without damaging HP", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 500, maxHp: 500, mp: 20, maxMp: 20 } },
    contents: { 100: { type_id: 2, type_value: 24 } },
    weapons: { 24: { id: 24, type_id: 1, wear_function_group_id: 100 } },
    functions: { 100: { function1_id: 13, function1_value1: 2, function1_value2: 100 } },
    abilities: {
      1: { id: 1, kind: "physical", range: 3, power: 0, accuracy: 255, functions: [{ id: 2 }] },
    },
  };
  const party = [
    { id: 2, hp: 100, maxHp: 200, mp: 10, maxMp: 20, attack: 100, level: 20, equipment: [100] },
  ];
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  battle.perform(party[0], battle.enemies[0], data.abilities[1]);
  assert.equal(party[0].hp, 100);
  assert.equal(party[0].mp, 20);
  assert.equal(battle.enemies[0].hp, 500);
  assert.equal(battle.enemies[0].mp, 10);
});

test("PR zero-MP death affects flagged monsters after MP damage or their own cost and retains final actions", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }, { monsterId: 2 }] } },
    monsters: {
      1: { id: 1, hp: 1000, maxHp: 1000, mp: 5, maxMp: 5, diesAtZeroMp: true, aiName: "final" },
      2: { id: 2, hp: 1000, maxHp: 1000, mp: 5, maxMp: 5 },
    },
    abilities: {
      71: {
        id: 71,
        name: "Rasp",
        kind: "magic",
        power: 10,
        flags: [1],
        functions: [{ id: 3, values: [2] }],
      },
      10: { id: 10, name: "Final", range: 3, functions: [{ id: 69, values: [1, 1] }] },
    },
    aiPrograms: {
      final: {
        name: "final",
        ops: [["SyncAI"], ["FinalAttackAct", [10], [100]], ["JumpBattleAI", [0]]],
      },
    },
  };
  const party = [{ id: 1, hp: 100, maxHp: 100 }],
    battle = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  battle.perform(party[0], battle.enemies[0], data.abilities[71]);
  assert.equal(battle.enemies[0].mp, 0);
  assert.equal(battle.enemies[0].hp, 0);
  assert(battle.enemies[0].aiState.finalDone);
  assert.equal(party[0].hp, 99);
  battle.perform(party[0], battle.enemies[1], data.abilities[71]);
  assert.equal(battle.enemies[1].mp, 0);
  assert.equal(battle.enemies[1].hp, 1000);
  const own = new Battle({
    data,
    party: [{ id: 1, hp: 100, maxHp: 100 }],
    encounterId: 1,
    random: () => 0.5,
  });
  own.enemies[0].mp = 0;
  own.checkEnd();
  own.checkEnd();
  assert.equal(own.enemies[0].hp, 0);
  assert.equal(own.players[0].hp, 99);
});

test("a failed Hawk Eye proc is not rolled again inside the damage calculator", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 1000, maxHp: 1000 } },
    contents: { 100: { type_id: 2, type_value: 75 } },
    weapons: { 75: { id: 75, type_id: 1, process_prog: "HAWK_EYE" } },
    abilities: {
      1: { id: 1, kind: "physical", range: 3, power: 0, accuracy: 255, functions: [{ id: 2 }] },
    },
  };
  const party = [{ id: 2, hp: 100, maxHp: 100, attack: 40, equipment: [100], criticalRate: 0 }];
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  let draws = 0;
  battle.random = () => {
    draws++;
    return 0.75;
  };
  battle.perform(party[0], battle.enemies[0], data.abilities[1]);
  assert.equal(draws, 3); // one proc, variance, ordinary critical check
});

test("spell drain is limited by actual supply and capacity, with undead reversing the transfer", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 500, maxHp: 500, mp: 100, maxMp: 100 } },
    abilities: {
      81: {
        id: 81,
        name: "Osmose",
        kind: "magic",
        power: 26,
        flags: [1],
        functions: [
          { id: 69, values: [2] },
          { id: 13, values: [2, 100] },
        ],
      },
    },
  };
  const party = [{ id: 1, hp: 100, maxHp: 100, mp: 45, maxMp: 50, magic: 30, level: 20 }],
    battle = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  const target = battle.enemies[0];
  battle.perform(party[0], target, data.abilities[81]);
  assert.equal(target.hp, 500);
  assert.equal(target.mp, 95);
  assert.equal(party[0].mp, 50);
  battle.perform(party[0], target, data.abilities[81]);
  assert.equal(target.mp, 95);
  target.undead = true;
  target.mp = 98;
  battle.perform(party[0], target, data.abilities[81]);
  assert.equal(target.mp, 100);
  assert.equal(party[0].mp, 48);
  assert.equal(calculateDamage(party[0], target, data.abilities[81], () => 0.5).resource, "mp");
});

test("source switchable spells offer an ordinary side cast, charge MP once and retain spread scaling", () => {
  const data = {
    parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 5000, maxHp: 5000 } },
    abilities: {
      31: {
        id: 31,
        name: "Cure",
        range: 6,
        kind: "heal",
        power: 10,
        mp: 5,
        flags: [1],
        target: "ally",
        functions: [{ id: 1, values: [2, 2] }],
      },
      68: {
        id: 68,
        name: "Protect",
        range: 7,
        kind: "magic",
        mp: 12,
        functions: [{ id: 9, values: [23] }],
      },
    },
    conditions: { 23: { condition_type: 19 } },
  };
  const party = [1, 2, 3].map((id) => ({
    id,
    hp: 10,
    maxHp: 1000,
    mp: 50,
    maxMp: 50,
    level: 20,
    magic: 30,
    abilities: [31, 68],
  }));
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  const half = calculateDamage(party[0], party[1], data.abilities[31], () => 0.5, 3).amount;
  party[0].ready = true;
  assert(battle.choose(0, 31, { side: "player", index: 0, all: true }));
  assert(party.every((unit) => unit.hp === 10 + half));
  assert.equal(party[0].mp, 45);
  party[0].ready = true;
  assert.equal(battle.choose(0, 68, { side: "player", index: 0, all: true }), false);
  assert.equal(party[0].mp, 45);
  assert(party.every((unit) => !unit.protect));
  assert(battle.choose(0, 68, { side: "player", index: 0 }));
  assert(party[0].protect);
});

test("final reserve order reaches the source replacement handler and cannot recycle departed members", () => {
  const units = {
    1: { id: 1, hp: 100, maxHp: 100 },
    2: { id: 2, hp: 35, maxHp: 100, removed: true, escaped: true },
    3: { id: 3, hp: 50, maxHp: 100 },
  };
  const battle = new Battle({
    data: {
      parties: { 1: { members: [{ monsterId: 1 }] } },
      monsters: { 1: { id: 1, hp: 500, maxHp: 500 } },
    },
    party: [units[1]],
    finalParty: [1, 2, 3],
    character: (id) => units[id],
    encounterId: 1,
    random: () => 0.5,
  });
  units[1].removed = true;
  battle.events.syscall("LB:プレイヤーパーティ変更", [], []);
  assert.equal(battle.players[0], units[2]);
  assert.equal(units[2].hp, 35);
  assert.equal(units[2].removed, false);
  assert.equal(units[2].escaped, false);
  units[2].removed = true;
  battle.events.syscall("LB:プレイヤーパーティ変更", [], []);
  assert.equal(battle.players[0], units[3]);
  assert.equal(units[3].hp, 50);
});

test("a source final-party replacement during the end check cannot settle the previous defeat", () => {
  const units = { 1: { id: 1, hp: 100, maxHp: 100 }, 2: { id: 2, hp: 35, maxHp: 100 } };
  let exits = 0;
  const battle = new Battle({
    data: {
      parties: { 1: { members: [{ monsterId: 1 }] } },
      monsters: { 1: { id: 1, hp: 500, maxHp: 500 } },
    },
    party: [units[1]],
    finalParty: [1, 2],
    character: (id) => units[id],
    encounterId: 1,
    random: () => 0.5,
    onEnd: () => exits++,
  });
  battle.events.beforeEnd = (outcome) => {
    assert.equal(outcome, "defeat");
    battle.events.syscall("LB:プレイヤーパーティ変更", [], []);
    return true;
  };
  units[1].hp = 0;
  battle.checkEnd();
  assert.equal(battle.players[0], units[2]);
  assert.equal(units[2].hp, 35);
  assert.equal(battle.phase, "active");
  assert.equal(battle.result, null);
  assert.equal(exits, 0);
});

test("a source Gau return clears the previous leap removal without fabricating a heal", () => {
  const gau = {
    id: 12,
    enabled: false,
    veldtLeapt: true,
    removed: true,
    escaped: true,
    hp: 24,
    maxHp: 100,
  };
  const battle = new Battle({
    data: {
      parties: { 1: { members: [{ monsterId: 1 }] } },
      monsters: { 1: { id: 1, hp: 100, maxHp: 100 } },
    },
    party: [{ id: 6, hp: 100, maxHp: 100 }],
    encounterId: 1,
    character: (id) => (id === 12 ? gau : { id }),
    random: () => 0.5,
  });
  battle.events.syscall("バトル加入：ガウ", [], []);
  assert.equal(battle.players.at(-1), gau);
  assert.equal(gau.removed, false);
  assert.equal(gau.escaped, false);
  assert.equal(gau.enabled, true);
  assert.equal(gau.veldtLeapt, false);
  assert.equal(gau.hp, 24);
});
