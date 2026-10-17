import test from "node:test";
import assert from "node:assert/strict";
import {
  createCharacter,
  applyBattleRewards,
  correctJoinLevel,
  abilityMpCost,
} from "./progression.js";
import { equip, equipMagicite, useFieldItem, useFieldAbility } from "./resources.js";
import { openShop, buyFromShop, sellToShop } from "./event-systems.js";
import { PlayGame } from "./game.js";

test("an explicit boosted checkpoint continuation preserves the normal save and its story state", async () => {
  const data = {
      init: [],
      programs: { 0: { name: "init", ops: [["Exit"]] } },
      byMap: {},
      global: { init: 0 },
    },
    map = { width: 3, height: 3, initializer: "init", entities: [], layers: [], entrances: [] };
  const source = new PlayGame({ data });
  Object.assign(source, { mapId: 1, map });
  const saved = structuredClone(source.snapshot()),
    before = JSON.stringify(saved);
  const game = new PlayGame({ data, loadMap: async () => map });
  await game.restore(saved, { testBoost: true });
  assert.equal(game.testBoost, true);
  assert.equal(game.party[0].level, 99);
  assert.equal(game.party[0].hp, 999999);
  assert.equal(game.unit(9).testBoost, true);
  assert.deepEqual(game.banks, saved.banks);
  assert.deepEqual(game.partySlots, saved.partySlots);
  assert.deepEqual(game.battles, saved.battles);
  assert.deepEqual(game.history, saved.history);
  assert.equal(JSON.stringify(saved), before);
  const normal = new PlayGame({ data, loadMap: async () => map });
  await normal.restore(saved);
  assert.equal(normal.testBoost, false);
  assert.notEqual(normal.party[0].level, 99);
});

function fixture() {
  const data = {
    characters: {
      1: {
        id: 1,
        jobId: 1,
        name: "Terra",
        level: 3,
        exp: 96,
        maxHp: 86,
        maxMp: 38,
        baseStats: {
          strength: 31,
          vitality: 28,
          magic: 39,
          speed: 33,
          attack: 12,
          defense: 42,
          magicDefense: 33,
          evasion: 5,
          magicEvasion: 7,
        },
        equipment: [94, 93, 198, 199, 200, 200],
        abilities: [1, 2, 31],
        naturalLearning: [{ level: 6, abilityId: 36 }],
      },
    },
    contents: {
      2: { id: 2, type_id: 1, type_value: 1 },
      10: { id: 10, type_id: 1, type_value: 9 },
      12: { id: 12, type_id: 1, type_value: 11 },
      93: { id: 93, type_id: 2, type_value: 1 },
      94: { id: 94, type_id: 2, type_value: 2 },
      95: { id: 95, type_id: 2, type_value: 3 },
      198: { id: 198, type_id: 3, type_value: 2 },
      199: { id: 199, type_id: 3, type_value: 3 },
      200: { id: 200, type_id: 3, type_value: 4 },
      370: { type_id: 4, type_value: 40 },
    },
    weapons: {
      1: { type_id: 2, parts_group_id: 1 },
      2: { type_id: 1, equip_job_group_id: 1, parts_group_id: 1, attack: 26, buy: 150, sell: 75 },
      3: { type_id: 1, equip_job_group_id: 1, parts_group_id: 1, attack: 30, buy: 300, sell: 150 },
    },
    armors: {
      2: { type_id: 2, parts_group_id: 3 },
      3: { type_id: 2, parts_group_id: 4 },
      4: { type_id: 2, parts_group_id: 5 },
    },
    partsGroups: {
      1: { equip1_possible: 1, equip2_possible: 1 },
      3: { equip3_possible: 1 },
      4: { equip4_possible: 1 },
      5: { equip5_possible: 1, equip6_possible: 1 },
    },
    jobGroups: { 1: { job1_accept: 1 } },
    growth: [
      { group_id: 1, lv: 4, hp_value1: 14, mp_value1: 7 },
      { group_id: 1, lv: 5, hp_value1: 17, mp_value1: 8 },
      { group_id: 1, lv: 6, hp_value1: 20, mp_value1: 9 },
    ],
    expTable: [
      { group_id: 1, lv: 3, total_exp: 96 },
      { group_id: 1, lv: 4, total_exp: 208 },
      { group_id: 1, lv: 5, total_exp: 400 },
      { group_id: 1, lv: 6, total_exp: 672 },
    ],
    magicStones: { 64: { bonus: { parameter: 2, value: 10 } } },
    learning: [{ type_id: 2, value1: 64, value2: 6, content_id: 370 }],
    conditions: {
      5: { condition_type: 5 },
      6: { condition_type: 6 },
      10: { condition_type: 10 },
      11: { condition_type: 11 },
      15: { condition_type: 34 },
      88: { condition_type: 10 },
    },
    conditionGroups: [
      { group_id: 8, condition_id: 10 },
      { group_id: 8, condition_id: 88 },
      { group_id: 428, condition_id: 5 },
    ],
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
      6: { function1_id: 12, function1_value1: 8 },
      431: { function1_id: 1, function1_value1: 2, function1_value2: 2 },
      433: {
        function1_id: 12,
        function1_value1: 428,
        function2_id: 34,
        function2_value1: 2,
        function2_value2: 4,
        function2_value3: 100,
      },
    },
    items: {
      1: { id: 1, type_id: 1, menu_function_group_id: 1, standard_value: 50, buy: 50, sell: 25 },
      9: { id: 9, type_id: 1, menu_function_group_id: 2 },
      11: { id: 11, type_id: 1, menu_function_group_id: 6 },
    },
    abilities: {
      31: { id: 31, power: 10, mp: 5, menuFunctionGroup: 431 },
      35: { id: 35, power: 16, mp: 60, menuFunctionGroup: 433 },
    },
  };
  const game = {
    battleData: data,
    roster: {},
    inventory: { 95: 1, 64: 1, 2: 2, 10: 1, 12: 1 },
    gil: 100,
    data: {
      systemTables: {
        product: [{ id: 1, group_id: 84, content_id: 2, coefficient: -25, purchase_limit: 0 }],
      },
    },
    banks: {},
    busy: false,
    event() {},
    warn() {},
    text: (s) => s,
    unit(id) {
      return this.roster[id];
    },
    partySlots: [[1], [], []],
    partyIndex: 0,
    random: () => 0.5,
  };
  game.roster[1] = createCharacter(data, 1);
  game.party = [game.roster[1]];
  return { data, game, unit: game.roster[1] };
}

test("changing equipment trades owned stock and recomputes base stats without copying another character loadout", () => {
  const { data, game, unit } = fixture();
  assert.equal(unit.attack, 38);
  assert.equal(equip(game, 1, 0, 95), true);
  assert.equal(unit.attack, 42);
  assert.equal(game.inventory[94], 1);
  assert.equal(game.inventory[95], 0);
  assert.equal(equip(game, 1, 0, 0), true);
  assert.equal(unit.attack, 22);
  assert.equal(game.inventory[95], 1);
  unit.abilities.push(40);
  assert.deepEqual(data.characters[1].abilities, [1, 2, 31]);
});

test("removing a source permanent-condition accessory removes its lingering status without clearing unrelated conditions", () => {
  const { data, game, unit } = fixture();
  data.contents[301] = { id: 301, type_id: 3, type_value: 101 };
  data.armors[101] = {
    type_id: 1,
    parts_group_id: 5,
    equip_job_group_id: 1,
    wear_condition_group_id: 90,
  };
  data.conditionGroups.push({ group_id: 90, condition_id: 22 });
  game.inventory[301] = 1;
  assert.equal(equip(game, 1, 4, 301), true);
  assert.deepEqual(unit.permanentConditions, [22]);
  unit.conditions = [22, 10];
  assert.equal(equip(game, 1, 4, 0), true);
  assert.deepEqual(unit.permanentConditions, []);
  assert.deepEqual(unit.conditions, [10]);
});

test("PR immunity type3 outranks half damage type2 while changing equipment", () => {
  const { data, game, unit } = fixture();
  data.attributeGroups = [
    { group_id: 90, attribute_id: 4, type_id: 3 },
    { group_id: 91, attribute_id: 4, type_id: 2 },
  ];
  for (const [id, group] of [
    [301, 90],
    [302, 91],
  ]) {
    data.contents[id] = { id, type_id: 3, type_value: id };
    data.armors[id] = {
      type_id: 1,
      parts_group_id: 5,
      equip_job_group_id: 1,
      resistance_attribute: group,
    };
    game.inventory[id] = 1;
  }
  assert.equal(equip(game, 1, 4, 301), true);
  assert.equal(equip(game, 1, 5, 302), true);
  assert.equal(unit.affinities[4], 3);
  assert.equal(equip(game, 1, 4, 0), true);
  assert.equal(unit.affinities[4], 2);
});

test("one battle reward applies each PR level increment once and learns AP without healing for free", () => {
  const { data, game, unit } = fixture();
  unit.hp = 20;
  unit.mp = 3;
  assert.equal(equipMagicite(game, 1, 64), true);
  applyBattleRewards(data, [unit], { outcome: "victory", exp: 576, ap: 10 });
  assert.equal(unit.level, 6);
  assert.equal(unit.exp, 672);
  assert.equal(unit.maxHp, 86 + 15 + 18 + 22);
  assert.equal(unit.maxMp, 38 + 7 + 8 + 9);
  assert.equal(unit.hp, 20);
  assert.equal(unit.mp, 3);
  assert.equal(unit.magicLearning[40], 60);
  assert.ok(unit.abilities.includes(36));
  applyBattleRewards(data, [unit], { outcome: "victory", exp: 0, ap: 7 });
  assert.equal(unit.magicLearning[40], 100);
  assert.equal(unit.abilities.filter((id) => id === 40).length, 1);
});

test("silence keeps experience and AP, while PR stone and zombie recipients do not", () => {
  const { data, unit } = fixture();
  const silent = { ...structuredClone(unit), id: 2, conditions: [6] };
  const stone = { ...structuredClone(unit), id: 3, conditions: [11] };
  const zombie = { ...structuredClone(unit), id: 4, conditions: [15] };
  applyBattleRewards(data, [silent, stone, zombie], { outcome: "victory", exp: 112, ap: 0 });
  assert.equal(silent.exp, 208);
  assert.equal(stone.exp, 96);
  assert.equal(zombie.exp, 96);
});

test("first entry uses party average plus source offset, then actual PR growth and full entry resources", () => {
  const { data, game, unit } = fixture();
  const entrant = createCharacter(data, 1);
  entrant.id = 2;
  entrant.level = 1;
  entrant.maxHp = entrant.naturalMaxHp = 48;
  game.roster[2] = entrant;
  correctJoinLevel(game, entrant, null);
  assert.equal(entrant.level, 5);
  assert.equal(entrant.exp, 400);
  assert.equal(entrant.hp, entrant.maxHp);
  assert.equal(unit.exp, 96);
});

test("field medicine removes PR condition groups, cure consumes actual MP, and full revival uses a percent", () => {
  const { game, unit } = fixture();
  unit.conditions = [10, 88, 6];
  assert.equal(useFieldItem(game, 12, 1), true);
  assert.deepEqual(unit.conditions, [6]);
  assert.equal(game.inventory[12], 0);
  unit.conditions = [];
  unit.hp = 1;
  const mp = unit.mp;
  assert.equal(useFieldAbility(game, 31, 1, 1), true);
  assert.ok(unit.hp > 10);
  assert.equal(unit.mp, mp - 5);
  unit.abilities.push(35);
  unit.mp = 60;
  unit.hp = 0;
  unit.conditions = [5];
  assert.equal(useFieldAbility(game, 35, 1, 1), false);
  const caster = { ...structuredClone(unit), id: 2, hp: 10, conditions: [] };
  game.roster[2] = caster;
  assert.equal(useFieldAbility(game, 35, 2, 1), true);
  assert.equal(unit.hp, unit.maxHp);
  assert.deepEqual(unit.conditions, []);
  assert.equal(caster.mp, 0);
});

test("shop discounts add signed price offsets and trades cannot duplicate worn or missing stock", () => {
  const { game } = fixture();
  openShop(game, 84);
  assert.equal(game.shop.stock[0].price, 25);
  assert.equal(buyFromShop(game, 2, 2), true);
  assert.equal(game.gil, 50);
  assert.equal(game.inventory[2], 4);
  assert.equal(buyFromShop(game, 2, 3), false);
  assert.equal(sellToShop(game, 2, 3), true);
  assert.equal(game.gil, 125);
  assert.equal(game.inventory[2], 1);
  assert.equal(sellToShop(game, 2, 2), false);
  assert.equal(sellToShop(game, 94, 1), false);
});

test("teaching equipment cannot grant a free spell before earned AP reaches 100", () => {
  const { data, game, unit } = fixture();
  data.learning.push({ type_id: 4, value1: 95, value2: 5, content_id: 370 });
  assert.equal(equip(game, 1, 0, 95), true);
  assert.deepEqual(unit.equipmentAbilities, []);
  assert.equal(unit.abilities.includes(40), false);
  applyBattleRewards(data, [unit], { outcome: "victory", exp: 0, ap: 19 });
  assert.equal(unit.magicLearning[40], 95);
  assert.equal(unit.abilities.includes(40), false);
  applyBattleRewards(data, [unit], { outcome: "victory", exp: 0, ap: 1 });
  assert.equal(unit.abilities.includes(40), true);
  equip(game, 1, 0, 0);
  assert.equal(unit.abilities.includes(40), true);
});

test("MP-cost relic calculation preserves free commands and floors a positive halved cost", () => {
  assert.equal(abilityMpCost({ mpCostMultiplier: 0.5 }, { mp: 5 }), 2);
  assert.equal(abilityMpCost({ mpCostMultiplier: 0.5 }, { mp: 1 }), 1);
  assert.equal(abilityMpCost({ fixedMpCost: 1 }, { mp: 60 }), 1);
  assert.equal(abilityMpCost({ fixedMpCost: 1 }, { mp: 0 }), 0);
});
