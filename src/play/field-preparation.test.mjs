import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlayGame } from './game.js';
import { preparationPurchases, prepareBattleReadiness } from './field-preparation.js';
import { openShop, autoShopInput } from './event-systems.js';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const data = read('build/play/data.json'), battleData = read('build/play/battle.json');
function gameOn(mapId) {
  const map = read(`build/world/maps/${mapId}.json`).map;
  const game = new PlayGame({ data: { ...data, navigation: read('build/play/navigation.json') }, battleData,
    loadMap: async () => map, random: () => .5 });
  Object.assign(game, { map, mapId, tasks: [], groups: new Set(['entity_default']), inventory: {}, gil: 2000 });
  game.partySlots = [[2, 7], [], []]; game.partyIndex = 0;
  for (const unit of game.party) { unit.enabled = true; unit.level = 7; }
  game.refreshActors();
  return game;
}

test('early supply planning preserves real gear money instead of spending it on two unnecessary Ethers', () => {
  const game = gameOn(53);
  const stock = [{ id: 2, price: 50 }, { id: 10, price: 500 }, { id: 5, price: 1500 }, { id: 105, price: 450 }];
  const requests = preparationPurchases(game, stock);
  const spent = requests.reduce((sum, request) => sum + stock.find(product => product.id === request.contentId).price * request.count, 0);
  assert.ok(spent <= game.gil);
  assert.equal(requests.some(request => request.contentId === 5), false);
  assert.ok(requests.some(request => request.contentId === 105));
  assert.equal(game.gil, 2000);
  assert.deepEqual(game.inventory, {});
});

test('boss survival stock is bought once at the source price while preserving the cash reserve', () => {
  const game = gameOn(53);
  game.storyObjective = { id: 'tunnel-armor' };
  game.bossPreparation = { objective: 'tunnel-armor', visitedShops: [], gilReserve: 400 };
  game.inventory = { 2: 2, 10: 2 };
  game.autoPurchase = preparationPurchases;
  openShop(game, 6);
  assert.equal(autoShopInput(game), true);
  assert.equal(game.inventory[2], 8);
  assert.equal(game.inventory[10], 4);
  assert.equal(game.gil, 700);
  assert.deepEqual(game.bossPreparation.visitedShops, [6]);
  openShop(game, 6); autoShopInput(game);
  assert.equal(game.gil, 700);
  assert.equal(game.inventory[2], 8);
  assert.equal(game.inventory[10], 4);
});

test('boss readiness inspects the PR Tunnel Armor script but trains only by normal directional movement', () => {
  const game = gameOn(53);
  let position;
  for (let y = 1; y < game.map.height - 1 && !position; y++) for (let x = 1; x < game.map.width - 1; x++) {
    if (![x - 1, x, x + 1].every(px => game.canWalk(px, y, 1))) continue;
    if (game.entities.some(entity => [2, 3, 23, 30].includes(entity.kind) && entity.layer === 1 &&
      Math.abs(entity.x - x) < 3 && Math.abs(entity.y - y) < 3)) continue;
    position = { x, y, layer: 1 }; break;
  }
  assert.ok(position);
  Object.assign(game.player, position);
  const before = { banks: JSON.stringify(game.banks), units: game.party.map(unit => [unit.level, unit.exp]) };
  let directEncounters = 0;
  game.encounter = () => { directEncounters++; };
  const input = prepareBattleReadiness(game, { id: 'tunnel-armor', chapter: 'M3-locke' },
    { target: { script: 'sc_e_0086', ...position } }, () => { throw new Error('Current legal pool should be used first'); });
  assert.equal(input.status, 'training-walk');
  assert.equal(input.targetLevel, 11);
  assert.notDeepEqual([game.player.x, game.player.y], [position.x, position.y]);
  assert.equal(directEncounters, 0);
  assert.equal(JSON.stringify(game.banks), before.banks);
  assert.deepEqual(game.party.map(unit => [unit.level, unit.exp]), before.units);
});
