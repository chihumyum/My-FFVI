import test from 'node:test';
import assert from 'node:assert/strict';
import { isVeldt, walkEncounter } from './encounters.js';
import { buyFromShop, closeShop } from './event-systems.js';

test('walking encounters charge PR terrain cost, wait for input, and cannot roll an empty slot into a victory', () => {
  const started = [], game = {
    mapId: 1, map: { width: 4, height: 4 }, player: { x: 1, y: 1 },
    Battle: true, random: () => 0, warn() {}, battles: [],
    battleData: { parties: { 2: {} }, encounters: {
      maps: { 1: { min: 200, max: 200, subtract: 100, set: 7 } },
      sets: { 7: { choices: [{ id: 0, weight: 1 }, { id: 2, weight: 1 }] } },
    } },
    encounter(...args) { started.push(args); },
  };
  assert.equal(walkEncounter(game), false);
  assert.equal(walkEncounter(game), false);
  assert.equal(started.length, 0);
  game.random = () => .9;
  game.busy = true;
  assert.equal(walkEncounter(game), false);
  assert.equal(game.walkEncounterState.remaining, 0);
  game.busy = false;
  walkEncounter(game);
  assert.equal(walkEncounter(game), true);
  assert.equal(started[0][0], 2);
  game.map.worldTerrain = { width: 4, cells: Array(16).fill(31), footRows: { 31: { typeId: 31 } } };
  assert.equal(isVeldt(game), true);
  game.player.vehicle = 3;
  assert.equal(isVeldt(game), false);
});

test('a shop sale deducts gil and closed shops cannot sell from their previous cached stock', () => {
  const game = { banks: { PlaySystems: {} }, gil: 1000, inventory: {}, event() {},
    shop: { stock: [{ id: 24, price: 150 }], task: { waitFor: 'shop' } } };
  const caller = game.shop.task;
  assert.equal(buyFromShop(game, 24, 2), true);
  assert.equal(game.gil, 700);
  assert.equal(game.inventory[24], 2);
  assert.equal(closeShop(game), true);
  assert.equal(caller.waitFor, null);
  assert.equal(buyFromShop(game, 24), false);
  assert.equal(game.gil, 700);
});
