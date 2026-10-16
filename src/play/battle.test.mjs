import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, calculateDamage, atbRate } from './battle.js';

const actor = { side: 'player', level: 3, strength: 31, magic: 39, attack: 42, criticalRate: 0 };
const target = { defense: 100, magicDefense: 155, evasion: 0, magicEvasion: 0 };
const fight = { kind: 'physical', power: 0, accuracy: 100 };
const fire = { kind: 'magic', power: 60, accuracy: 100, flags: [1], elements: [1] };

test('ordinary physical damage uses level, strength, attack, variance and target defense', () => {
  assert.equal(calculateDamage(actor, target, fight, () => 0.5).amount, 28);
  assert.equal(calculateDamage({ ...actor, level: 6 }, target, fight, () => 0.5).amount, 37);
  assert.equal(calculateDamage(actor, { ...target, defense: 255 }, fight, () => 0.5).amount, 1);
});

test('PR beam power is used with SNES magic scaling and elemental priority', () => {
  assert.equal(calculateDamage(actor, target, fire, () => 0.5).amount, 169);
  assert.equal(calculateDamage(actor, { ...target, elementResistances: { 1: 1 } }, fire, () => 0.5).amount, 338);
  assert.equal(calculateDamage(actor, { ...target, elementResistances: { 1: 4 } }, fire, () => 0.5).amount, -169);
  assert.equal(calculateDamage(actor, { ...target, elementResistances: { 1: 3 } }, fire, () => 0.5).amount, 0);
});

test('evasion can prevent ordinary hits and unblockable attacks bypass it', () => {
  assert.equal(calculateDamage(actor, { ...target, evasion: 128 }, fight, () => 0.5).missed, true);
  assert.equal(calculateDamage(actor, { ...target, magicEvasion: 128 }, fire, () => 0.5).missed, false);
});

test('healing ignores defense and critical multipliers', () => {
  const healing = { kind: 'heal', power: 50, accuracy: 100 };
  assert.equal(calculateDamage(actor, target, healing, () => 0.5).amount, 359);
  assert.equal(calculateDamage(actor, { ...target, magicDefense: 0 }, healing, () => 0.5).amount, 359);
});

test('ATB fills in SNES two-frame updates, with player and enemy speed scaling', () => {
  assert.equal(atbRate({ speed: 33, side: 'player' }), 14.556884765625);
  assert.ok(atbRate({ speed: 33, side: 'enemy' }) < atbRate({ speed: 33, side: 'player' }));
  assert.ok(atbRate({ speed: 50, side: 'player' }) > atbRate({ speed: 33, side: 'player' }));
});

test('battle items use fixed PR recovery, shared content stock and an ordinary action turn', () => {
  const inventory = { 2: 2, 10: 1 };
  const data = { parties: { 1: { members: [{ monsterId: 1 }] } }, monsters: { 1: { id: 1, hp: 500, maxHp: 500 } },
    contents: { 2: { type_id: 1, type_value: 1 }, 10: { type_id: 1, type_value: 9 } },
    items: { 1: { id: 1, battle_function_group_id: 1, standard_value: 50 }, 9: { id: 9, battle_function_group_id: 2 } } };
  const party = [{ id: 2, hp: 20, maxHp: 100, magic: 99 }, { id: 19, hp: 0, maxHp: 80, conditions: [5] }];
  const battle = new Battle({ data, party, encounterId: 1, inventory, random: () => .5 });
  party[0].ready = true; party[0].atb = 100;
  assert.equal(battle.choose(0, 'item:2', 0), true);
  assert.equal(party[0].hp, 70);
  assert.equal(inventory[2], 1);
  assert.equal(battle.useItem(0, 2, 0), false);
  assert.equal(inventory[2], 1);
  party[0].ready = true; party[0].atb = 100;
  assert.equal(battle.useItem(0, 10, 1), true);
  assert.equal(party[1].hp, 10);
  assert.equal(inventory[10], 0);
  assert.deepEqual(party[1].conditions, []);
});

test('Dried Meat uses its PR item/content IDs and targets the actual enemy receiving it', () => {
  const inventory = { 24: 2, 26: 1 }, data = {
    parties: { 1: { members: [{ monsterId: 549, slot: 2 }] } },
    monsters: { 549: { id: 549, hp: 50000, maxHp: 50000 } },
    contents: { 24: { type_id: 1, type_value: 23 }, 26: { type_id: 1, type_value: 25 } },
    items: { 23: { id: 23, battle_function_group_id: 1, standard_value: 150, battle_renge_id: 7 },
      25: { id: 25, battle_function_group_id: 19, standard_value: 100, battle_renge_id: 4 } },
  };
  const party = [{ id: 6, hp: 100, maxHp: 100 }];
  const battle = new Battle({ data, party, encounterId: 1, inventory, random: () => .5 });
  const received = [];
  battle.enemies[0].aiState.wake = (kind, action) => received.push({ kind, action });
  party[0].ready = true;
  assert.equal(battle.itemsFor(0).find(item => item.itemId === 23).target, 'enemy');
  assert.equal(battle.choose(0, 'item:24', { side: 'enemy', index: 0 }), true);
  assert.equal(inventory[24], 1);
  assert.equal(inventory[26], 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].kind, 'reaction');
  assert.equal(received[0].action.item.itemId, 23);
  assert.equal(received[0].action.item.contentId, 24);
  assert.equal(received[0].action.target, battle.enemies[0]);
  party[0].ready = true;
  assert.equal(battle.useItem(0, 24, { side: 'player', index: 0 }), true);
  assert.equal(received.at(-1).kind, 'observer');
  assert.equal(received.at(-1).action.target, party[0]);
});

test('ADD_VARIABLE_CALC advances the acting PR monster variable without a Fight fallback', () => {
  const data = { parties: { 1: { members: [{ monsterId: 550 }] } },
    monsters: { 550: { id: 550, hp: 50000, maxHp: 50000 } } };
  const battle = new Battle({ data, party: [{ id: 6, hp: 100, maxHp: 100 }], encounterId: 1, random: () => .5 });
  const gau = battle.enemies[0];
  battle.perform(gau, gau, { id: 1199, functions: [{ id: 19, values: [0, 0, 0] }, { id: 23, values: [0, 0, 0] }],
    process: 'ADD_VARIABLE_CALC', dataA: 0, dataB: 0, dataC: 1 });
  assert.equal(gau.aiState.vars[0], 1);
  assert.equal(gau.hp, 50000);
  assert.equal(battle.players[0].hp, 100);
  assert.equal(battle.warnings.has('Ability 1199 effect is not implemented; using Fight.'), false);
  battle.perform(gau, gau, { id: 1202, functions: [{ id: 19 }, { id: 23 }],
    process: 'ADD_VARIABLE_CALC', dataA: 0, dataB: 3, dataC: 1 });
  assert.equal(gau.aiState.vars[3], 1);
  assert.equal(gau.aiState.vars[0], 1);
  assert.equal(battle.supported({ process: 'ADD_VARIABLE_CALC', dataB: 15, dataC: 1 }), false);
});

test('the PR variable companion runs once for an area action without discarding its damage', () => {
  const ability = { id: 333, functions: [{ id: 2 }, { id: 23 }], kind: 'physical', range: 4,
    power: 0, accuracy: 255, process: 'ADD_VARIABLE_CALC', dataA: 0, dataB: 2, dataC: 1 };
  const battle = new Battle({ data: { parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 500, maxHp: 500, attack: 40 } }, abilities: { 333: ability } },
  party: [{ id: 1, hp: 1000, maxHp: 1000 }, { id: 2, hp: 1000, maxHp: 1000 }], encounterId: 1, random: () => .5 });
  const enemy = battle.enemies[0];
  battle.queueAIAction({ actor: enemy, abilityId: 333, script: 'fixture', index: 0 });
  battle.drainAI();
  assert.equal(enemy.aiState.vars[2], 1);
  assert(battle.players.every(unit => unit.hp < 1000));
});

test('final reserve order reaches the source replacement handler and cannot recycle departed members', () => {
  const units = { 1: { id: 1, hp: 100, maxHp: 100 },
    2: { id: 2, hp: 35, maxHp: 100, removed: true, escaped: true }, 3: { id: 3, hp: 50, maxHp: 100 } };
  const battle = new Battle({ data: { parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 500, maxHp: 500 } } }, party: [units[1]], finalParty: [1, 2, 3],
  character: id => units[id], encounterId: 1, random: () => .5 });
  units[1].removed = true;
  battle.events.syscall('LB:プレイヤーパーティ変更', [], []);
  assert.equal(battle.players[0], units[2]);
  assert.equal(units[2].hp, 35);
  assert.equal(units[2].removed, false);
  assert.equal(units[2].escaped, false);
  units[2].removed = true;
  battle.events.syscall('LB:プレイヤーパーティ変更', [], []);
  assert.equal(battle.players[0], units[3]);
  assert.equal(units[3].hp, 50);
});

test('a source final-party replacement during the end check cannot settle the previous defeat', () => {
  const units = { 1: { id: 1, hp: 100, maxHp: 100 }, 2: { id: 2, hp: 35, maxHp: 100 } };
  let exits = 0;
  const battle = new Battle({ data: { parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 500, maxHp: 500 } } }, party: [units[1]], finalParty: [1, 2],
    character: id => units[id], encounterId: 1, random: () => .5, onEnd: () => exits++ });
  battle.events.beforeEnd = outcome => {
    assert.equal(outcome, 'defeat');
    battle.events.syscall('LB:プレイヤーパーティ変更', [], []);
    return true;
  };
  units[1].hp = 0;
  battle.checkEnd();
  assert.equal(battle.players[0], units[2]);
  assert.equal(units[2].hp, 35);
  assert.equal(battle.phase, 'active');
  assert.equal(battle.result, null);
  assert.equal(exits, 0);
});

test('a source Gau return clears the previous leap removal without fabricating a heal', () => {
  const gau = { id: 12, enabled: false, veldtLeapt: true, removed: true, escaped: true, hp: 24, maxHp: 100 };
  const battle = new Battle({ data: { parties: { 1: { members: [{ monsterId: 1 }] } },
    monsters: { 1: { id: 1, hp: 100, maxHp: 100 } } }, party: [{ id: 6, hp: 100, maxHp: 100 }],
  encounterId: 1, character: id => id === 12 ? gau : { id }, random: () => .5 });
  battle.events.syscall('バトル加入：ガウ', [], []);
  assert.equal(battle.players.at(-1), gau);
  assert.equal(gau.removed, false);
  assert.equal(gau.escaped, false);
  assert.equal(gau.enabled, true);
  assert.equal(gau.veldtLeapt, false);
  assert.equal(gau.hp, 24);
});
