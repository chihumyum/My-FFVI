import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlayGame } from './game.js';
import { preparationPurchases, prepareBattleReadiness, prepareFieldInput } from './field-preparation.js';
import { openShop, autoShopInput, buyFromShop, closeShop } from './event-systems.js';
import { raiseLevel, applyBattleRewards } from './progression.js';
import { preparationRoute, observePreparationTravel } from './preparation-route.js';
import { pathTo } from './m1-route.js';

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

test('MP supply purchases scale for an actual casting party and source battle chain, with finite paid stock', () => {
  const purchases = [];
  for (const encounterCount of [1, 3]) {
    const game = gameOn(53);
    game.partySlots = [[1, 9], [], []];
    for (const unit of game.party) {
      unit.enabled = true; raiseLevel(battleData, unit, 22);
      unit.hp = unit.maxHp; unit.mp = unit.maxMp;
      unit.abilities = unit.id === 1 ? [31, 32, 45] : [41, 46];
    }
    game.gil = 50000;
    game.inventory = { 3: 16, 10: 8, 17: 1 };
    game.storyObjective = { id: 'source-battle-chain' };
    game.bossPreparation = { objective: game.storyObjective.id, encounterCount,
      visitedShops: [], gilReserve: 10000 };
    game.autoPurchase = preparationPurchases;
    openShop(game, 2);
    const ether = game.shop.stock.find(product => product.id === 5);
    assert.equal(ether.price, 1500);
    const requests = preparationPurchases(game), request = requests.find(entry => entry.contentId === 5);
    const spent = requests.reduce((sum, entry) => sum + (entry.count - (game.inventory[entry.contentId] || 0)) *
      game.shop.stock.find(product => product.id === entry.contentId).price, 0);
    assert.ok(request.count > 1 && request.count <= 32);
    assert.equal(game.inventory[5] || 0, 0);
    assert.equal(game.gil, 50000);
    autoShopInput(game);
    assert.equal(game.inventory[5], request.count);
    assert.equal(game.gil, 50000 - spent);
    assert.ok(game.gil >= 10000);
    purchases.push(request.count);
    openShop(game, 2); autoShopInput(game);
    assert.equal(game.inventory[5], request.count);
    assert.equal(game.gil, 50000 - spent);
  }
  assert.ok(purchases[1] > purchases[0]);
});

test('field MP preparation consumes actual 50 MP Ethers, restores the healer first and stops below full MP', () => {
  const game = gameOn(53);
  game.partySlots = [[1, 9], [], []];
  for (const unit of game.party) {
    unit.enabled = true; raiseLevel(battleData, unit, 22);
    unit.hp = unit.maxHp; unit.mp = unit.id === 1 ? 1 : 0;
    unit.abilities = unit.id === 1 ? [31] : [46];
  }
  const [healer, damageCaster] = game.party;
  const initialMp = healer.mp + damageCaster.mp;
  game.inventory[5] = 10;
  game.banks.PlaySystems = { timer: { remaining: 60, expired: false, dispatched: false } };
  const noTravel = () => { throw new Error('A source timer cannot be left to find MP supplies'); };
  assert.equal(prepareFieldInput(game, noTravel).action, 'restore-mp');
  assert.equal(healer.mp, 51);
  assert.equal(damageCaster.mp, 0);
  assert.equal(game.inventory[5], 9);
  for (let tick = 0; tick < 12; tick++) {
    const input = prepareFieldInput(game, noTravel);
    if (!input) break;
    assert.equal(input.action, 'restore-mp');
  }
  const used = 10 - game.inventory[5];
  assert.ok(used > 1 && used < 10);
  assert.equal(healer.mp + damageCaster.mp, initialMp + used * 50);
  assert.ok(healer.mp < healer.maxMp && damageCaster.mp < damageCaster.maxMp);
  const before = [healer.mp, damageCaster.mp, game.inventory[5]];
  assert.equal(prepareFieldInput(game, noTravel), null);
  assert.deepEqual([healer.mp, damageCaster.mp, game.inventory[5]], before);
});

test('source escape supplies share a small reserve and buy the cheaper real fn16 item without replacing held stock', () => {
  const game = gameOn(53);
  game.gil = 3000;
  game.inventory[23] = 1;
  game.storyObjective = { id: 'source-chain' };
  game.bossPreparation = { objective: game.storyObjective.id, encounterCount: 2,
    visitedShops: [], gilReserve: 600 };
  openShop(game, 31);
  const stock = game.shop.stock.filter(product => [22, 23].includes(product.id));
  assert.deepEqual(stock.map(product => [product.id, product.price]), [[22, 300], [23, 700]]);
  const requests = preparationPurchases(game, stock);
  assert.deepEqual(requests, [{ contentId: 22, count: 3 }]);
  assert.equal(game.inventory[22] || 0, 0);
  assert.equal(game.gil, 3000);
  assert.equal(buyFromShop(game, requests[0].contentId, requests[0].count), true);
  assert.equal(game.inventory[22], 3);
  assert.equal(game.inventory[23], 1);
  assert.equal(game.gil, 2100);
  assert.deepEqual(preparationPurchases(game, stock), []);
});

test('ordinary MP preparation walks to a live save point before spending one owned tent', () => {
  const game = gameOn(232);
  game.partySlots = [[1], [], []];
  const unit = game.party[0]; unit.enabled = true; unit.abilities = [31];
  unit.hp = unit.maxHp; unit.mp = 0;
  const point = game.entities.find(entity => entity.kind === 9);
  const next = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) =>
    game.canWalk(point.x + dx, point.y + dy, point.layer));
  assert.ok(next);
  Object.assign(game.player, { x: point.x + next[0], y: point.y + next[1], layer: point.layer });
  game.inventory[17] = 1;
  game.triggered = new Set();
  assert.equal(game.canCamp(), false);
  const input = prepareFieldInput(game, pathTo);
  assert.equal(input.target.id, point.id);
  assert.equal(game.inventory[17], 1);
  assert.equal(input.route.length, 1);
  assert.equal(game.move(input.route[0]), true);
  assert.equal(game.canCamp(), true);
  for (let tick = 0; tick < 100 && game.busy; tick++) game.tick(.1, { auto: true });
  assert.equal(prepareFieldInput(game, pathTo).action, 'camp');
  assert.equal(game.inventory[17], 0);
  for (let tick = 0; tick < 100; tick++) game.tick(.1);
  assert.equal(unit.mp, unit.maxMp);
  assert.equal(game.history.filter(entry => entry.script === 'sc_tnt').length, 1);
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

test('ordinary field preparation picks up the live PR Kirin object through its source script', () => {
  const game = gameOn(395);
  game.groups.add('ev_e_0306'); game.refreshActors();
  const pickup = game.entities.find(entity => entity.script === 'sc_e_0306');
  assert.ok(pickup);
  Object.assign(game.player, { x: pickup.x, y: pickup.y + 1, layer: pickup.layer, direction: 'up' });
  const input = prepareFieldInput(game, (current, target) => target.id === pickup.id ? [] : null);
  assert.equal(input.target.id, pickup.id);
  assert.equal(game.inventory[63] || 0, 0);
  assert.equal(game.confirm(), true);
  for (let tick = 0; tick < 100; tick++) game.tick(.1, { auto: true });
  assert.equal(game.inventory[63], 1);
  assert.equal(game.banks.ScenarioFlag1[153], 1);
  assert.equal(game.history.some(entry => entry.script === 'sc_e_0306'), true);
});

test('source party splits prepare an owned healing lesson through AP encounters before removing the only healer', () => {
  const game = gameOn(53);
  game.roster = {}; game.partySlots = [[3, 5, 2, 7], [], []];
  for (const unit of game.party) { unit.enabled = true; raiseLevel(battleData, unit, 15); }
  game.inventory[63] = 1; game.equipMagicite(5, 63);
  let position;
  for (let y = 1; y < game.map.height - 1 && !position; y++) for (let x = 1; x < game.map.width - 1; x++) {
    if (![x - 1, x, x + 1].every(px => game.canWalk(px, y, 1))) continue;
    if (game.entities.some(entity => [2, 3, 23, 30].includes(entity.kind) && entity.layer === 1 &&
      Math.abs(entity.x - x) < 3 && Math.abs(entity.y - y) < 3)) continue;
    position = { x, y, layer: 1 }; break;
  }
  Object.assign(game.player, position);
  const objective = { id: 'source-party-split', chapter: 'M5' }, input = { target: { script: 'sc_e_0315', ...position } };
  const banks = JSON.stringify(game.banks);
  const first = prepareBattleReadiness(game, objective, input, () => null);
  assert.equal(first.status, 'training-walk');
  assert.equal(game.preparationTraining.lesson.memberId, 5);
  assert.equal(game.preparationTraining.lesson.abilityId, 31);
  assert.equal(game.unit(5).abilities.includes(31), false);
  assert.equal(JSON.stringify(game.banks), banks);
  applyBattleRewards(battleData, game.party, { outcome: 'victory', exp: 0, ap: 20 });
  assert.equal(game.unit(5).abilities.includes(31), true);
  assert.equal(prepareBattleReadiness(game, objective, input, () => null), null);
  assert.equal(game.preparationTraining, null);
  game.banks.PlaySystems = { timer: { remaining: 60, expired: false, dispatched: false } };
  assert.equal(prepareFieldInput(game, () => { throw new Error('A timed source event must not navigate to services'); }).action, 'heal');
  for (const unit of game.party) { unit.hp = unit.maxHp; unit.mp = unit.maxMp; }
  assert.equal(prepareFieldInput(game, () => { throw new Error('A timed source event must not navigate to services'); }), null);
});

test('optional preparation yields after repeated real map edges, and a paid purchase resets the route guard', () => {
  const game = gameOn(53), route = { status: 'target', target: { id: 'merchant' }, route: ['up'] };
  game.storyObjective = { id: 'source-travel' }; game.warn = () => {};
  const inventory = JSON.stringify(game.inventory), banks = JSON.stringify(game.banks), gil = game.gil;
  for (let trip = 0; trip < 3; trip++) {
    preparationRoute(game, route, 'shopping');
    game.mapId = 55; observePreparationTravel(game);
    preparationRoute(game, route, 'shopping');
    game.mapId = 53; observePreparationTravel(game);
  }
  assert.equal(preparationRoute(game, route, 'shopping'), null);
  assert.equal(JSON.stringify(game.inventory), inventory);
  assert.equal(JSON.stringify(game.banks), banks);
  assert.equal(game.gil, gil);
  openShop(game, 6); assert.equal(buyFromShop(game, 2), true); closeShop(game);
  observePreparationTravel(game);
  assert.equal(preparationRoute(game, route, 'shopping'), route);
  assert.equal(game.inventory[2], 1);
  assert.equal(game.gil, gil - 50);
});
