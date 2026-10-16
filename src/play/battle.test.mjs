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
