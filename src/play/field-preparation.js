import { prepareBattleReadiness as prepareTrainingInput } from './training-input.js';
import { routeToStory, encountersForInput } from './navigation.js';
import { shopStock } from './event-systems.js';
import { canEquip, equipmentScore, treasureOpened } from './resources.js';
import { equipmentDefinition } from './progression.js';
import { functionsFor, conditionIdsForGroup } from './ability-effects.js';

// A player policy, not a game mechanic: all preparation goes through ordinary
// equipment, magic, item and shop inputs and spends the same finite resources.
const itemOf = (game, contentId) => {
  const content = game.battleData.contents?.[contentId];
  return Number(content?.type_id) === 1 ? game.battleData.items?.[content.type_value] : null;
};
const inventoryItems = game => Object.entries(game.inventory).filter(([, count]) => count > 0)
  .map(([id]) => ({ contentId: Number(id), item: itemOf(game, id) })).filter(entry => entry.item);
const healingSpells = (game, unit) => [...new Set([...(unit.abilities || []), ...(unit.equipmentAbilities || [])])]
  .map(id => game.battleData.abilities?.[id]).filter(ability => ability?.kind === 'heal' && ability.power > 0 && ability.mp <= unit.mp)
  .sort((a, b) => a.mp - b.mp);

function nearbyShopGroups(game) {
  const maps = game.data.navigation?.maps || {};
  const known = new Set((game.visited || []).map(id => maps[id]?.areaId));
  const area = maps[game.mapId]?.areaId;
  known.add(area);
  const worldId = maps[game.mapId]?.world ? game.mapId : [...(game.visited || [])].reverse().find(id => maps[id]?.world);
  const world = maps[worldId];
  if (world) {
    const anchors = game.mapId === worldId ? [game.player] : world.entries.filter(entry =>
      maps[entry.destination?.mapId]?.areaId === area);
    for (const entry of world.entries) if (entry.destination && anchors.some(point =>
      Math.abs(point.x - entry.x) + Math.abs(point.y - entry.y) <= 30)) known.add(maps[entry.destination.mapId]?.areaId);
  }
  return [...new Set(Object.values(maps).filter(map => known.has(map.areaId))
    .flatMap(map => map.entries.map(entry => entry.productGroup)).filter(Boolean))];
}

export function preparationPurchases(game, stock = game.shop?.stock || []) {
  if (game.testBoost) return [];
  const preparation = game.bossPreparation?.objective === game.storyObjective?.id ? game.bossPreparation : null;
  if (preparation && stock === game.shop?.stock && !preparation.visitedShops.includes(game.shop.groupId))
    preparation.visitedShops.push(game.shop.groupId);
  const size = Math.max(1, game.party.length), wanted = [], products = stock.filter(product => product.price > 0);
  const hp = game.party.reduce((sum, unit) => sum + unit.maxHp, 0) / size;
  const casters = game.party.filter(unit => (unit.abilities || []).some(id => (game.battleData.abilities?.[id]?.mp || 0) > 0));
  const required = game.storyObjective?.buy;
  const reserved = required ? Math.max(0, (required.count || 1) - (game.inventory[required.contentId] || 0)) *
    (products.find(product => product.id === required.contentId)?.price || 0) : 0;
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
  const healing = itemProducts.filter(product => product.item.menu_function_group_id === 1)
    .sort((a, b) => a.price / Math.min(hp * .65, a.item.standard_value) - b.price / Math.min(hp * .65, b.item.standard_value))[0];
  add(healing, Math.max(4, size * (preparation ? 4 : 2)));
  const lowMagic = casters.some(unit => unit.mp < unit.maxMp * .35);
  const tent = itemProducts.filter(product => product.item.menu_function_group_id === 11).sort((a, b) => a.price - b.price)[0];
  if (casters.length && tent && (lowMagic || budget >= tent.price * 3)) add(tent, 1, lowMagic ? 200 : budget * .5);
  const ether = itemProducts.filter(product => product.item.menu_function_group_id === 3).sort((a, b) => a.price - b.price)[0];
  if (casters.length && (lowMagic || budget >= 6000)) add(ether, 1, Math.max(500, budget * .35));
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
  if (training || game.busy || game.testBoost || !objective || !game.party.length || game.rts?.active) return training;
  if (game.bossPreparation?.objective !== objective.id) game.bossPreparation = null;
  let preparation = game.bossPreparation;
  if (!preparation) {
    const bosses = encountersForInput(game, input).flatMap(id => game.battleData.parties?.[id]?.members || [])
      .map(member => game.battleData.monsters?.[member.monsterId]).filter(enemy => enemy?.boss);
    if (!bosses.length) return null;
    preparation = game.bossPreparation = { objective: objective.id, visitedShops: [],
      shopGroups: nearbyShopGroups(game), gilReserve: Math.floor(game.gil * .2) };
  }
  if (preparation.finished) return null;
  // Preparing for a source boss can include a normal trip to a merchant.
  // Keep a cash reserve, buy a finite survival stock and visit at most two
  // equipment merchants; do not tour every shop for marginal upgrades.
  const groups = preparation.shopGroups;
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
    if (!['no-route', 'no-input'].includes(route.status)) return { ...route, training: true, preparation: 'shopping' };
  }
  preparation.finished = true;
  return null;
}

export function prepareFieldInput(game, pathTo) {
  game.autoPurchase ??= preparationPurchases;
  if (game.busy || game.testBoost || !game.control || !game.party.length) return null;
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
      fn.id === 12 && conditionIdsForGroup(game.battleData, fn.values[0]).some(id => conditions.includes(id)));
    for (const { item, contentId } of items) if (cures(functionsFor(game.battleData, item.menu_function_group_id)) &&
      game.useItem(contentId, target.id)) return { status: 'prepare', action: 'cure-condition' };
    for (const caster of game.party.filter(unit => unit.hp > 0))
      for (const id of caster.abilities || []) {
        const ability = game.battleData.abilities?.[id];
        if (ability && cures(functionsFor(game.battleData, ability.menuFunctionGroup)) &&
          game.useAbility?.(id, caster.id, target.id)) return { status: 'prepare', action: 'cure-condition' };
      }
  }
  const lowMagic = game.party.some(unit => unit.hp > 0 && unit.mp < unit.maxMp * 0.2 &&
    (unit.abilities || []).some(id => game.battleData.abilities?.[id]?.mp > 0));
  if (lowMagic && game.canCamp?.()) {
    const tent = items.find(({ item }) => item.menu_function_group_id === 11);
    if (tent && game.useItem(tent.contentId, game.party[0].id)) return { status: 'prepare', action: 'camp' };
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
  for (const caster of game.party.filter(unit => unit.hp > 0 && unit.mp < unit.maxMp * 0.2)) {
    if (!(caster.abilities || []).some(id => game.battleData.abilities?.[id]?.mp > 0)) continue;
    const ether = items.find(({ item }) => [3, 4].includes(item.menu_function_group_id));
    if (ether && game.useItem(ether.contentId, caster.id)) return { status: 'prepare', action: 'restore-mp' };
  }
  // The original field data includes ordinary chests beside the story path.
  // Their declarative rewards are ordinary inputs, not test supplies. Open
  // only reachable, source-active boxes and let their normal dialogue/flag
  // transaction grant the item; scripted monster-in-a-box encounters wait.
  const loot = [];
  for (const entity of game.entities || []) {
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
    if (candidates[0]) return candidates[0];
  }
  const needsRevival = game.party.some(unit => unit.hp <= 0),
    needsHealing = game.party.some(unit => unit.hp > 0 && unit.hp < unit.maxHp * 0.4);
  if ((needsHealing || lowMagic) && game.data.navigation) {
    const input = routeToStory(game, { rest: lowMagic ? 'mp' : 'hp' }, pathTo);
    if (input.status !== 'no-route') return input;
  }
  if ((needsRevival || needsHealing) && game.gil >= 50 && game.data.navigation) {
    const usableGroups = new Set((game.data.systemTables?.product || []).filter(product => {
      const item = itemOf(game, product.content_id), group = item?.menu_function_group_id;
      return (needsRevival ? group === 2 : [1, 4].includes(group)) &&
        (item?.buy || 0) + Number(product.coefficient || 0) <= game.gil;
    }).map(product => Number(product.group_id)));
    if (usableGroups.size) {
      const input = routeToStory(game, { shops: [...usableGroups] }, pathTo);
      if (input.status !== 'no-route') return input;
    }
  }
  return null;

  function healingWeight(stone, unit = null) {
    return (stone.learning || []).reduce((sum, entry) => sum +
      (unit?.abilities?.includes(entry.abilityId) ? 0 :
        game.battleData.abilities?.[entry.abilityId]?.kind === 'heal' ? 10 * entry.rate : entry.rate), 0);
  }
}
