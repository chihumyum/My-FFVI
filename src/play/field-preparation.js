import { prepareBattleReadiness as prepareTrainingInput } from './training-input.js';
import { routeToStory, encountersForInput } from './navigation.js';
import { shopStock } from './event-systems.js';
import { canEquip, equipmentScore, treasureOpened } from './resources.js';
import { equipmentDefinition, abilityMpCost } from './progression.js';
import { functionsFor, conditionIdsForGroup } from './ability-effects.js';
import { observePreparationTravel, preparationRoute } from './preparation-route.js';

// A player policy, not a game mechanic: all preparation goes through ordinary
// equipment, magic, item and shop inputs and spends the same finite resources.
const itemOf = (game, contentId) => {
  const content = game.battleData.contents?.[contentId];
  return Number(content?.type_id) === 1 ? game.battleData.items?.[content.type_value] : null;
};
const inventoryItems = game => Object.entries(game.inventory).filter(([, count]) => count > 0)
  .map(([id]) => ({ contentId: Number(id), item: itemOf(game, id) })).filter(entry => entry.item);
const pickupOperations = new Set(['Nop', 'Blank', 'Exit', 'Return', 'Call', 'Jump', 'Branch', 'Wait', 'PlaySE', 'Msg',
  'MsgClose', 'MsgFinishWait', 'MsgFinishWaitAll', 'GetItem', 'SetFlag', 'SetEntities', 'SetPuppet', 'ExecPuppet', 'FinishPuppet', 'Hide', 'Show']);
const healingSpells = (game, unit) => [...new Set([...(unit.abilities || []), ...(unit.equipmentAbilities || [])])]
  .map(id => game.battleData.abilities?.[id]).filter(ability => ability?.kind === 'heal' && ability.power > 0 && abilityMpCost(unit, ability) <= unit.mp)
  .sort((a, b) => abilityMpCost(unit, a) - abilityMpCost(unit, b));
const spellsFor = (game, unit) => [...new Set([...(unit.abilities || []), ...(unit.equipmentAbilities || [])])]
  .map(id => game.battleData.abilities?.[id]).filter(ability => ability && abilityMpCost(unit, ability) > 0);
function magicNeeds(game, preparation = null) {
  const battles = Math.min(6, Math.max(1, preparation?.encounterCount || 1));
  return game.party.map(unit => {
    const spells = spellsFor(game, unit);
    const summon = game.battleData.abilities?.[game.battleData.magicStones?.[unit.magicite]?.summonAbilityId];
    const summonCost = summon ? abilityMpCost(unit, summon) : 0;
    if ((!spells.length && !summonCost) || !(unit.maxMp > 0)) return null;
    const costs = spells.filter(ability => ability.power > 0 || ability.kind === 'heal')
      .map(ability => abilityMpCost(unit, ability)).sort((a, b) => a - b);
    const cost = costs.length ? costs[Math.floor(costs.length / 2)] : spells.length ? Math.min(...spells.map(ability => abilityMpCost(unit, ability))) : 0;
    // These are bounded player reserves, not game balance changes. Expensive
    // learned spells and source battle chains need more than one 50 MP Ether.
    const floor = Math.min(unit.maxMp, Math.ceil(Math.max(unit.maxMp * (preparation ? Math.min(.9, .65 + battles * .1) : .35),
      cost * (preparation ? 6 + battles * 2 : 4) + summonCost * (preparation ? battles : 1))));
    const reserve = Math.max(unit.maxMp * (preparation ? Math.min(.8, .25 + battles * .15) : .25),
      cost * (4 + battles * 2) + summonCost * (preparation ? battles : 2));
    return { unit, floor, reserve, healer: spells.some(ability => ability.kind === 'heal' && ability.power > 0) };
  }).filter(Boolean);
}
const currentPreparation = game => game.bossPreparation?.objective === game.storyObjective?.id ? game.bossPreparation : null;
const mpRecovery = (game, item) => functionsFor(game.battleData, item.menu_function_group_id)
  .some(fn => fn.id === 1 && fn.values[1] === 3) ? item.standard_value : 0;
const escapeItem = (game, item) => functionsFor(game.battleData, item.battle_function_group_id).some(fn => fn.id === 16);

function nearbyShopGroups(game) {
  const maps = game.data.navigation?.maps || {};
  const area = maps[game.mapId]?.areaId;
  const known = new Set([area]);
  const worldId = maps[game.mapId]?.world ? game.mapId : [...(game.visited || [])].reverse().find(id => maps[id]?.world);
  const world = maps[worldId];
  if (world) {
    let anchors = world.entries.filter(entry => maps[entry.destination?.mapId]?.areaId === area);
    if (!anchors.length && game.mapId !== worldId) for (const id of [...(game.visited || [])].reverse()) {
      const previousArea = maps[id]?.areaId;
      anchors = world.entries.filter(entry => maps[entry.destination?.mapId]?.areaId === previousArea);
      if (anchors.length) { known.add(previousArea); break; }
    }
    let regions;
    if (game.mapId === worldId) {
      const cell = Math.round(game.player.y) * world.width + Math.round(game.player.x);
      const region = world.regionRuns?.[game.player.layer]?.find(([end]) => end > cell)?.[1];
      regions = new Set(region ? [region] : []); anchors = [game.player];
    } else regions = new Set(anchors.flatMap(entry => entry.regions || []));
    for (const entry of world.entries) if (entry.destination && anchors.some(point =>
      Math.abs(point.x - entry.x) + Math.abs(point.y - entry.y) <= 80) &&
      entry.regions?.some(region => regions.has(region))) known.add(maps[entry.destination.mapId]?.areaId);
  }
  return [...new Set(Object.values(maps).filter(map => known.has(map.areaId))
    .flatMap(map => map.entries.map(entry => entry.productGroup)).filter(Boolean))];
}

export function preparationPurchases(game, stock = game.shop?.stock || []) {
  if (game.testBoost) return [];
  const preparation = game.bossPreparation && game.bossPreparation.objective === game.storyObjective?.id && !game.bossPreparation.finished ? game.bossPreparation : null;
  if (preparation && stock === game.shop?.stock) {
    if (!preparation.visitedShops.includes(game.shop.groupId)) preparation.visitedShops.push(game.shop.groupId);
    preparation.shoppingArea ??= game.data.navigation?.maps[game.mapId]?.areaId;
  }
  const size = Math.max(1, game.party.length), wanted = [], products = stock.filter(product => product.price > 0);
  const hp = game.party.reduce((sum, unit) => sum + unit.maxHp, 0) / size;
  const magic = magicNeeds(game, preparation);
  const required = game.storyObjective?.buy;
  const requiredItem = required && (itemOf(game, required.contentId) || equipmentDefinition(game.battleData, required.contentId));
  const reserved = required ? Math.max(0, (required.count || 1) - (game.inventory[required.contentId] || 0)) *
    (products.find(product => product.id === required.contentId)?.price ?? requiredItem?.buy ?? 0) : 0;
  let budget = Math.max(0, game.gil - reserved - (preparation?.gilReserve || 0));
  const add = (product, target, reserve = 0) => {
    if (!product) return;
    const old = wanted.find(request => request.contentId === product.id);
    const held = game.inventory[product.id] || 0, planned = old?.count || held;
    const count = Math.min(Math.max(0, target - planned), Math.max(0, Math.floor((budget - reserve) / product.price)));
    if (!count) return;
    if (old) old.count += count;
    else wanted.push({ contentId: product.id, count: held + count });
    budget -= count * product.price;
  };
  const itemProducts = products.map(product => ({ ...product, item: itemOf(game, product.id) })).filter(product => product.item);
  // A small finite survival reserve comes before upgrades. Expensive MP
  // supplies never consume an early party's entire equipment/rest budget.
  const revival = itemProducts.filter(product => product.item.menu_function_group_id === 2).sort((a, b) => a.price - b.price)[0];
  add(revival, preparation ? Math.max(2, size * 2) : 2);
  let healingProducts = itemProducts.filter(product => product.item.menu_function_group_id === 1);
  if (healingProducts.some(product => product.item.standard_value >= hp * .4))
    healingProducts = healingProducts.filter(product => product.item.standard_value >= hp * .4);
  const healing = healingProducts.sort((a, b) => a.price / Math.min(hp * .65, a.item.standard_value) -
    b.price / Math.min(hp * .65, b.item.standard_value))[0];
  add(healing, Math.max(4, size * (preparation ? 4 : 2)));
  const escapes = itemProducts.filter(product => escapeItem(game, product.item)).sort((a, b) => a.price - b.price);
  const heldEscapes = inventoryItems(game).filter(({ item }) => escapeItem(game, item))
    .reduce((sum, { contentId }) => sum + game.inventory[contentId], 0);
  if (escapes[0]) add(escapes[0], (game.inventory[escapes[0].id] || 0) + Math.max(0, (preparation ? 4 : 2) - heldEscapes));
  const lowMagic = magic.some(({ unit, floor }) => unit.mp < floor);
  const tent = itemProducts.filter(product => product.item.menu_function_group_id === 11).sort((a, b) => a.price - b.price)[0];
  if (magic.length && tent && (lowMagic || budget >= tent.price * 3)) add(tent, 1, lowMagic ? 200 : budget * .5);
  const ether = itemProducts.filter(product => product.item.menu_function_group_id === 3 && mpRecovery(game, product.item) > 0)
    .sort((a, b) => a.price / mpRecovery(game, a.item) - b.price / mpRecovery(game, b.item))[0];
  if (magic.length && ether && (lowMagic || budget >= 6000)) {
    const heldRecovery = inventoryItems(game).filter(({ item }) => item.menu_function_group_id === 3)
      .reduce((sum, { contentId, item }) => sum + game.inventory[contentId] * mpRecovery(game, item), 0);
    const wantedRecovery = magic.reduce((sum, need) => sum + need.reserve, 0);
    const target = (game.inventory[ether.id] || 0) + Math.ceil(Math.max(0, wantedRecovery - heldRecovery) / mpRecovery(game, ether.item));
    add(ether, Math.min(32, target), Math.max(500, budget * .25));
  }
  const requiredCopies = new Map();
  for (const unit of game.party) for (let slot = 0; slot < 4; slot++) {
    const old = equipmentScore(game.battleData, unit.equipment?.[slot], slot);
    const upgrades = products.filter(product => canEquip(game.battleData, unit, product.id, slot))
      .map(product => ({ ...product, gain: equipmentScore(game.battleData, product.id, slot) - old }))
      .filter(product => {
        if (product.gain < Math.max(12, old * .2)) return false;
        const planned = wanted.find(request => request.contentId === product.id)?.count ?? (game.inventory[product.id] || 0);
        return planned > (requiredCopies.get(product.id) || 0) || product.price <= budget - 100;
      })
      .sort((a, b) => b.gain / b.price - a.gain / a.price);
    const best = upgrades[0];
    if (!best) continue;
    const needed = (requiredCopies.get(best.id) || 0) + 1;
    requiredCopies.set(best.id, needed);
    add(best, needed, 100);
  }
  return wanted;
}

export function prepareBattleReadiness(game, objective, input, pathTo) {
  const training = prepareTrainingInput(game, objective, input, pathTo);
  const timer = game.banks.PlaySystems?.timer;
  if (training || game.busy || game.testBoost || !objective || !game.party.length || game.rts?.active ||
      timer && !timer.expired && !timer.dispatched) return training;
  if (game.bossPreparation?.objective !== objective.id) game.bossPreparation = null;
  let preparation = game.bossPreparation;
  if (!preparation) {
    const encounters = encountersForInput(game, input);
    const bosses = encounters.flatMap(id => game.battleData.parties?.[id]?.members || [])
      .map(member => game.battleData.monsters?.[member.monsterId]).filter(enemy => enemy?.boss);
    if (!bosses.length) return null;
    preparation = game.bossPreparation = { objective: objective.id, visitedShops: [], encounterCount: encounters.length,
      shopGroups: nearbyShopGroups(game), gilReserve: Math.floor(game.gil * .2) };
  }
  if (preparation.finished) return null;
  // Preparing for a source boss can include a normal trip to a merchant.
  // Keep a cash reserve, buy a finite survival stock and visit at most two
  // equipment merchants; do not tour every shop for marginal upgrades.
  const localGroups = preparation.shoppingArea === undefined ? null : new Set(Object.values(game.data.navigation?.maps || {})
    .filter(map => map.areaId === preparation.shoppingArea).flatMap(map => map.entries.map(entry => entry.productGroup)).filter(Boolean));
  const groups = preparation.shopGroups.filter(group => !localGroups || localGroups.has(group));
  const supplyGroups = [], equipmentGroups = [];
  for (const group of groups) {
    if (preparation.visitedShops.includes(group)) continue;
    const stock = shopStock(game, group).filter(product => !product.limit ||
      (game.banks.PlaySystems?.purchases?.[product.productId] || 0) < product.limit);
    const wanted = preparationPurchases(game, stock);
    if (wanted.some(request => itemOf(game, request.contentId))) supplyGroups.push(group);
    if (wanted.some(request => equipmentDefinition(game.battleData, request.contentId))) equipmentGroups.push(group);
  }
  const equipmentVisits = preparation.visitedShops.filter(group => shopStock(game, group)
    .some(product => equipmentDefinition(game.battleData, product.id))).length;
  for (const shops of [supplyGroups, equipmentVisits < 2 ? equipmentGroups : []]) {
    if (!shops.length) continue;
    const route = routeToStory(game, { shops }, pathTo);
    const guarded = preparationRoute(game, route, 'shopping', objective.id);
    if (guarded) return { ...guarded, training: true, preparation: 'shopping' };
  }
  preparation.finished = true;
  return null;
}

export function prepareFieldInput(game, pathTo) {
  game.autoPurchase ??= preparationPurchases;
  if (game.busy || game.testBoost || !game.control || !game.party.length) return null;
  observePreparationTravel(game);
  const signature = JSON.stringify([game.party.map(unit => unit.id), game.battles.length, game.inventory]);
  if (signature !== game.preparedInventory) {
    for (const unit of game.party) game.optimizeEquipment?.(unit.id);
    const learners = game.party.filter(unit => unit.id > 0 && unit.id <= 12);
    const currentLearning = new Set(learners.filter(unit => {
      const current = game.battleData.magicStones?.[unit.magicite];
      return current && healingWeight(current, unit) > 0;
    }).map(unit => unit.magicite));
    // Reserve-party equipment is still player-owned. A current party may
    // transfer its stones through the ordinary menu instead of abandoning
    // magic growth when the previous group leaves the story temporarily.
    const stones = Object.values(game.battleData.magicStones || {})
      .filter(stone => game.inventory[stone.contentId] > 0 && !currentLearning.has(stone.contentId));
    for (const unit of learners) {
      const current = game.battleData.magicStones?.[unit.magicite];
      if (current && healingWeight(current, unit) > 0) continue;
      stones.sort((a, b) => healingWeight(b, unit) - healingWeight(a, unit));
      const best = stones.find(stone => healingWeight(stone, unit) > 0);
      if (!best) continue;
      if (game.equipMagicite?.(unit.id, best.contentId)) stones.splice(stones.indexOf(best), 1);
    }
    const knowsHealing = unit => (unit.abilities || []).some(id =>
      game.battleData.abilities?.[id]?.kind === 'heal' && game.battleData.abilities[id].power > 0);
    if (learners.filter(knowsHealing).length < Math.min(2, learners.length)) {
      const candidates = [];
      for (const stone of Object.values(game.battleData.magicStones || {}).filter(stone => game.inventory[stone.contentId] > 0))
        for (const entry of stone.learning || []) {
          const ability = game.battleData.abilities?.[entry.abilityId];
          if (ability?.kind !== 'heal' || !(ability.power > 0)) continue;
          for (const unit of learners.filter(unit => !knowsHealing(unit) && ability.mp <= unit.maxMp * .5))
            candidates.push({ unit, stone, score: entry.rate / Math.max(1, 100 - (unit.magicLearning?.[entry.abilityId] || 0)) *
              (1 + unit.magic / 100) });
        }
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (best && best.unit.magicite !== best.stone.contentId) game.equipMagicite?.(best.unit.id, best.stone.contentId);
    }
    game.preparedInventory = JSON.stringify([game.party.map(unit => unit.id), game.battles.length, game.inventory]);
  }
  const items = inventoryItems(game);
  for (const target of game.party) {
    const conditions = (target.conditions || []).filter(id => [6, 9, 10, 11, 12, 13, 15, 16, 26, 88, 89, 90].includes(id));
    if (!conditions.length) continue;
    const cures = functions => functions.some(fn => fn.id === 11 && conditions.includes(fn.values[0]) ||
      fn.id === 12 && conditionIdsForGroup(game.battleData, fn.values[0]).some(id => conditions.includes(id)) ||
      fn.id === 9 && conditions.includes(fn.values[0]) && (game.battleData.eraseConditionGroups || []).some(row =>
        row.group_id === game.battleData.conditions?.[fn.values[0]]?.erase_condition_group_id &&
        row.type_id === 4 && row.erase_condition === fn.values[0]));
    for (const { item, contentId } of items) if (cures(functionsFor(game.battleData, item.menu_function_group_id)) &&
      game.useItem(contentId, target.id)) return { status: 'prepare', action: 'cure-condition' };
    for (const caster of game.party.filter(unit => unit.hp > 0))
      for (const id of caster.abilities || []) {
        const ability = game.battleData.abilities?.[id];
        if (ability && cures(functionsFor(game.battleData, ability.menuFunctionGroup)) &&
          game.useAbility?.(id, caster.id, target.id)) return { status: 'prepare', action: 'cure-condition' };
      }
  }
  const magic = magicNeeds(game, currentPreparation(game));
  const lowMagic = magic.some(({ unit, floor }) => unit.hp > 0 && unit.mp < floor);
  const timer = game.banks.PlaySystems?.timer;
  const timed = timer && !timer.expired && !timer.dispatched;
  if (lowMagic) {
    // A reachable bed on this map is cheaper than spending several Ethers.
    // Do not leave a timed event to seek a service; immediate items still work.
    if (!timed && game.data.navigation) {
      const bed = routeToStory(game, { rest: 'mp' }, pathTo);
      if (bed.target && !bed.target.destination && [5, 6, 8, 17].includes(bed.target.kind)) {
        const guarded = preparationRoute(game, bed, 'rest');
        if (guarded) return guarded;
      }
    }
    const camp = items.find(({ item }) => item.menu_function_group_id === 11),
      bag = items.find(({ item }) => item.menu_function_group_id === 10);
    if (game.canCamp?.()) {
      if (camp && game.useItem(camp.contentId, game.party[0].id)) return { status: 'prepare', action: 'camp' };
      const target = magic.find(({ unit, floor }) => unit.hp > 0 && unit.mp < floor)?.unit;
      if (bag && target && game.useItem(bag.contentId, target.id)) return { status: 'prepare', action: 'camp' };
    } else if (!timed && (camp || bag)) {
      const points = (game.entities || []).filter(entity => entity.kind === 9)
        .map(entity => ({ ...entity, ...game.actors.get(String(entity.id)) }))
        .filter(point => point.visible !== false && point.savePoint?.visible !== false &&
          (point.savePoint?.actionId === undefined || point.savePoint.actionId === 7))
        .map(target => ({ status: 'target', target, route: pathTo(game, target) }))
        .filter(input => input.route).sort((a, b) => a.route.length - b.route.length);
      if (points[0]) {
        const guarded = preparationRoute(game, points[0], 'rest');
        if (guarded) return guarded;
      }
    }
    // Give a nearly empty healer enough MP before spending the party's HP
    // supplies. Each attempt goes through useItem and consumes real stock.
    const targets = magic.filter(({ unit, floor }) => unit.hp > 0 && unit.mp < floor)
      .sort((a, b) => Number(b.healer) - Number(a.healer) || a.unit.mp / a.unit.maxMp - b.unit.mp / b.unit.maxMp);
    for (const { unit } of targets) {
      const ethers = items.filter(({ item }) => [3, 4].includes(item.menu_function_group_id) && mpRecovery(game, item) > 0)
        .sort((a, b) => Number(a.item.menu_function_group_id === 4) - Number(b.item.menu_function_group_id === 4) ||
          Math.max(0, mpRecovery(game, a.item) - (unit.maxMp - unit.mp)) -
          Math.max(0, mpRecovery(game, b.item) - (unit.maxMp - unit.mp)) ||
          mpRecovery(game, a.item) - mpRecovery(game, b.item));
      for (const ether of ethers) if (game.useItem(ether.contentId, unit.id))
        return { status: 'prepare', action: 'restore-mp' };
    }
  }
  for (const target of game.party) {
    if (target.hp <= 0) {
      const revival = items.find(({ item }) => item.menu_function_group_id === 2);
      if (revival && game.useItem(revival.contentId, target.id)) return { status: 'prepare', action: 'revive' };
      for (const caster of game.party.filter(unit => unit.hp > 0)) {
        const spell = (caster.abilities || []).map(id => game.battleData.abilities?.[id])
          .find(ability => ability?.functions?.some(fn => fn.id === 34) && ability.mp <= caster.mp);
        if (spell && game.useAbility?.(spell.id, caster.id, target.id)) return { status: 'prepare', action: 'revive' };
      }
      continue;
    }
    if (target.hp >= target.maxHp * 0.7) continue;
    for (const caster of game.party.filter(unit => unit.hp > 0))
      for (const spell of healingSpells(game, caster))
        if (game.useAbility?.(spell.id, caster.id, target.id)) return { status: 'prepare', action: 'heal' };
    const potion = items.filter(({ item }) => [1, 4].includes(item.menu_function_group_id))
      .sort((a, b) => Math.abs((target.maxHp - target.hp) - a.item.standard_value) -
        Math.abs((target.maxHp - target.hp) - b.item.standard_value))[0];
    if (potion && game.useItem(potion.contentId, target.id)) return { status: 'prepare', action: 'heal' };
  }
  if (timed) return null;
  // The original field data includes ordinary chests beside the story path.
  // Their declarative rewards are ordinary inputs, not test supplies. Open
  // only reachable, source-active boxes and let their normal dialogue/flag
  // transaction grant the item; scripted monster-in-a-box encounters wait.
  const loot = [];
  for (const entity of game.entities || []) {
    if (entity.kind === 10 && entity.script) {
      const program = game.data.programs[game.resolve(entity.script)];
      if (program?.ops.every(([op]) => pickupOperations.has(op)) && program.ops.some(([op, ints]) =>
        op === 'GetItem' && game.battleData.contents?.[ints[0]]?.type_id === 9 && !(game.inventory[ints[0]] > 0))) {
        const actual = { ...entity, ...game.actors.get(String(entity.id)) };
        if (actual.visible !== false) {
          const route = pathTo(game, actual);
          if (route) loot.push({ status: 'target', target: actual, route });
        }
      }
    }
    if (entity.kind !== 7 || !entity.treasure?.reward || entity.treasure.scriptName || treasureOpened(game, entity)) continue;
    const actual = { ...entity, ...game.actors.get(String(entity.id)) };
    if (actual.visible === false) continue;
    const reward = entity.treasure.reward;
    const content = game.battleData.contents?.[reward.id];
    let useful = reward.kind === 'grant-gil';
    if (reward.kind === 'grant-item') useful = (game.inventory[reward.id] || 0) < (game.battleData.limits?.MAX_ITEM || 99);
    if ([2, 3].includes(content?.type_id)) useful = game.party.some(unit =>
      Array.from({ length: 6 }, (_, slot) => slot).some(slot => canEquip(game.battleData, unit, reward.id, slot) &&
        equipmentScore(game.battleData, reward.id, slot) > equipmentScore(game.battleData, unit.equipment?.[slot], slot)));
    if (!useful) continue;
    const route = pathTo(game, actual);
    if (route && (game.party.length >= 2 || route.length <= 6)) loot.push({ status: 'target', target: actual, route });
  }
  loot.sort((a, b) => a.route.length - b.route.length);
  if (loot[0]) return loot[0];
  // Replenish at reachable local merchants rather than giving the test party
  // supplies. Source groups still determine which merchant actually exists.
  if (!game.map?.worldTerrain && (game.player.vehicle || 1) <= 1 && game.gil >= 200) {
    const products = game.data.systemTables?.product || [], candidates = [];
    for (const entity of game.entities || []) {
      const interaction = entity.npc?.interaction;
      if (interaction?.actionId !== 8 || !interaction.productGroup) continue;
      const actual = { ...entity, ...game.actors.get(String(entity.id)) };
      if (actual.visible === false) continue;
      const stock = products.filter(product => Number(product.group_id) === interaction.productGroup)
        .map(product => {
          const id = Number(product.content_id), item = itemOf(game, id) || equipmentDefinition(game.battleData, id);
          return { id, price: Math.max(0, (item?.buy || 0) + Number(product.coefficient || 0)) };
        });
      if (!preparationPurchases(game, stock).some(purchase => (game.inventory[purchase.contentId] || 0) < purchase.count)) continue;
      const route = pathTo(game, actual);
      if (route) candidates.push({ status: 'target', target: actual, route });
    }
    candidates.sort((a, b) => a.route.length - b.route.length);
    if (candidates[0]) {
      const route = preparationRoute(game, candidates[0], 'shopping');
      if (route) return route;
    }
  }
  if (!game.map?.worldTerrain && game.gil >= 200 && game.data.navigation &&
      (game.visited || []).some(id => game.data.navigation.maps[id]?.world)) {
    const averageHp = game.party.reduce((sum, unit) => sum + unit.maxHp, 0) / game.party.length;
    const healingCount = items.filter(({ item }) => item.menu_function_group_id === 1 && item.standard_value >= averageHp * .3)
      .reduce((sum, entry) => sum + game.inventory[entry.contentId], 0);
    const revivalCount = items.filter(({ item }) => item.menu_function_group_id === 2)
      .reduce((sum, entry) => sum + game.inventory[entry.contentId], 0);
    const heldMp = items.filter(({ item }) => item.menu_function_group_id === 3)
      .reduce((sum, { contentId, item }) => sum + game.inventory[contentId] * mpRecovery(game, item), 0);
    const needsEther = magic.length && heldMp < magic.reduce((sum, need) => sum + need.reserve, 0) * .5;
    const needsEscape = items.filter(({ item }) => escapeItem(game, item))
      .reduce((sum, { contentId }) => sum + game.inventory[contentId], 0) < 2;
    if (healingCount < game.party.length || revivalCount < 2 || needsEther || needsEscape) {
      const maps = game.data.navigation.maps, area = maps[game.mapId]?.areaId;
      const groups = [...new Set(Object.values(maps).filter(map => map.areaId === area)
        .flatMap(map => map.entries.map(entry => entry.productGroup)).filter(Boolean))];
      const shops = groups.filter(group => preparationPurchases(game, shopStock(game, group)).some(request => {
        const item = itemOf(game, request.contentId);
        return item?.menu_function_group_id === 1 && healingCount < game.party.length ||
          item?.menu_function_group_id === 2 && revivalCount < 2 ||
          item?.menu_function_group_id === 3 && needsEther ||
          item && escapeItem(game, item) && needsEscape;
      }));
      if (shops.length) {
        const route = routeToStory(game, { shops }, pathTo);
        const guarded = preparationRoute(game, route, 'shopping');
        if (guarded) return guarded;
      }
    }
  }
  const needsRevival = game.party.some(unit => unit.hp <= 0),
    needsHealing = game.party.some(unit => unit.hp > 0 && unit.hp < unit.maxHp * 0.4);
  if ((needsHealing || lowMagic) && game.data.navigation) {
    const input = routeToStory(game, { rest: lowMagic ? 'mp' : 'hp' }, pathTo);
    const route = preparationRoute(game, input, 'rest');
    if (route) return route;
  }
  if ((needsRevival || needsHealing) && game.gil >= 50 && game.data.navigation) {
    const usableGroups = new Set((game.data.systemTables?.product || []).filter(product => {
      const item = itemOf(game, product.content_id), group = item?.menu_function_group_id;
      return (needsRevival ? group === 2 : [1, 4].includes(group)) &&
        (item?.buy || 0) + Number(product.coefficient || 0) <= game.gil;
    }).map(product => Number(product.group_id)));
    if (usableGroups.size) {
      const input = routeToStory(game, { shops: [...usableGroups] }, pathTo);
      const route = preparationRoute(game, input, 'shopping');
      if (route) return route;
    }
  }
  return null;

  function healingWeight(stone, unit = null) {
    return (stone.learning || []).reduce((sum, entry) => sum +
      (unit?.abilities?.includes(entry.abilityId) ? 0 :
        game.battleData.abilities?.[entry.abilityId]?.kind === 'heal' ? 10 * entry.rate : entry.rate), 0);
  }
}
