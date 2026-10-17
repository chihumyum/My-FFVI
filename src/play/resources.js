import {
  equipmentDefinition,
  emptyEquipment,
  recalculateEquipment,
  abilityMpCost,
} from "./progression.js";
import {
  functionsFor,
  isRevival,
  applyRecovery,
  setCondition,
  conditionIdsForGroup,
} from "./ability-effects.js";
export { functionsFor } from "./ability-effects.js";
const validMember = (game, id) => game.roster[id] && game.roster[id].enabled !== false;
const changed = (unit) => JSON.stringify([unit.hp, unit.mp, unit.conditions]);
const conditionType = (data, id) => data.conditions?.[id]?.condition_type ?? id;
export function changeInventory(game, contentId, delta) {
  const content = game.battleData.contents?.[contentId];
  if (content?.type_id === 5) {
    game.gil = Math.max(0, Math.min(game.battleData.limits?.MAX_GIL ?? 9999999, game.gil + delta));
    return;
  }
  const worn = Object.values(game.roster).reduce(
    (sum, unit) => sum + (unit.equipment ?? []).filter((id) => id === contentId).length,
    0,
  );
  const max = content?.type_id === 9 ? 1 : (game.battleData.limits?.MAX_ITEM ?? 99) - worn;
  game.inventory[contentId] = Math.max(0, Math.min(max, (game.inventory[contentId] ?? 0) + delta));
  if (content?.type_id === 9 && !game.inventory[contentId])
    for (const unit of Object.values(game.roster))
      if (unit.magicite === contentId) unit.magicite = 0;
}

function treasureFlag(definition) {
  const flag = Number(definition?.flagId);
  return Number.isInteger(flag) && flag >= 0 && flag < 1024
    ? { category: `TreasureFlag${1 + Math.floor(flag / 256)}`, index: flag % 256 }
    : null;
}
export function treasureOpened(game, entity) {
  const ref = treasureFlag(entity.treasure);
  return ref
    ? Boolean(game.banks?.[ref.category]?.[ref.index])
    : Boolean(game.banks?.PlaySystems?.openedTreasure?.[`${game.mapId}:${entity.id}`]);
}
export function resetTreasureGroup(game, contentId) {
  const reset = [];
  for (const entity of game.entities || []) {
    const definition = entity.kind === 7 && entity.treasure;
    if (!definition) continue;
    const program =
        definition.scriptName && game.data.programs?.[game.resolve(definition.scriptName)],
      grantsContent =
        definition.reward?.id === contentId ||
        program?.ops.some(([op, i]) => op === "GetItem" && i[0] === contentId);
    if (!grantsContent) continue;
    const ref = treasureFlag(definition);
    if (ref) (game.banks[ref.category] ??= {})[ref.index] = 0;
    const opened = game.banks.PlaySystems?.openedTreasure;
    if (opened) delete opened[`${game.mapId}:${entity.id}`];
    const actor = game.actor(entity.id);
    actor.opened = false;
    if (definition.presentation?.pickUp) actor.visible = true;
    reset.push(entity.id);
  }
  game.event("treasure-reset", { contentId, entityIds: reset });
  return reset.length;
}
export function openTreasure(game, entity, { after = false, message = true, task = null } = {}) {
  const definition = entity?.treasure;
  if (!definition) return false;
  if (game.dialogue) {
    if (task) {
      task.pc--;
      task.waitFor = "message";
    }
    return false;
  }
  const actor = game.actor(entity.id);
  actor.opened = true;
  if (definition.presentation?.pickUp) actor.visible = false;
  if (treasureOpened(game, entity)) {
    if (message)
      game.dialogue = {
        key: "treasure-empty",
        text: "里面已经空了。",
        speaker: "",
        elapsed: 0,
        task: null,
      };
    return true;
  }
  if (!after && definition.scriptName) {
    game.startScript(definition.scriptName);
    return true;
  }
  const reward = definition.reward;
  if (!reward) {
    game.warn(task, `Treasure ${entity.id} has no source reward; left unopened.`);
    return false;
  }
  if (reward.kind === "grant-gil")
    game.gil = Math.min(game.battleData.limits?.MAX_GIL ?? 9999999, game.gil + reward.amount);
  else changeInventory(game, reward.id, reward.count);
  const finish = () => {
    const ref = treasureFlag(definition);
    if (ref) (game.banks[ref.category] ??= {})[ref.index] = 1;
    else {
      game.banks.PlaySystems ??= {};
      (game.banks.PlaySystems.openedTreasure ??= {})[`${game.mapId}:${entity.id}`] = true;
      game.warn(
        task,
        `Treasure ${entity.id} has no PR flag address; tracking its map and entity key.`,
      );
    }
    if (task) task.waitFor = null;
  };
  if (definition.presentation?.soundId > 0)
    game.event("se", { id: definition.presentation.soundId });
  game.event("treasure", { entityId: entity.id, reward });
  if (message) {
    const name =
      game.battleData.contentNames?.[reward.id] ||
      game.text(game.battleData.contents?.[reward.id]?.mes_id_name);
    game.dialogue = {
      key: "treasure",
      text:
        reward.kind === "grant-gil"
          ? `获得 ${reward.amount} Gil。`
          : `获得 ${name || `物品 ${reward.id}`} ×${reward.count}。`,
      speaker: "",
      elapsed: 0,
      task: null,
      onConfirm: finish,
    };
    if (task) task.waitFor = "message";
  } else finish();
  return true;
}

export function canEquip(data, unit, contentId, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 5) return false;
  const content = data.contents?.[contentId],
    item = equipmentDefinition(data, contentId);
  if (!item || !data.partsGroups?.[item.parts_group_id]?.[`equip${slot + 1}_possible`])
    return false;
  if (item.type_id === 2) return true;
  if (unit.id === 14 || (unit.id === 13 && slot < 4)) return false;
  const merit = (unit.equipment ?? []).includes(317);
  if (!merit && !data.jobGroups?.[item.equip_job_group_id]?.[`job${unit.jobId}_accept`])
    return false;
  if (slot < 2) {
    const other = equipmentDefinition(data, unit.equipment?.[slot === 0 ? 1 : 0]);
    const genji = (unit.equipment ?? []).includes(308);
    if (
      content.type_id === 2 &&
      other &&
      other.type_id !== 2 &&
      data.contents?.[unit.equipment[slot === 0 ? 1 : 0]]?.type_id === 2 &&
      !genji
    )
      return false;
    if (
      content.type_id === 3 &&
      other &&
      other.type_id !== 2 &&
      data.contents?.[unit.equipment[slot === 0 ? 1 : 0]]?.type_id === 3
    )
      return false;
  }
  return true;
}

export function equip(game, memberId, slot, contentId, { duringEvent = false } = {}) {
  if ((!duringEvent && game.busy) || !validMember(game, memberId)) return false;
  const unit = game.unit(memberId),
    data = game.battleData;
  contentId = Number(contentId) || emptyEquipment(data, slot);
  if (!canEquip(data, unit, contentId, slot)) return false;
  unit.equipment ??= Array.from({ length: 6 }, (_, n) => emptyEquipment(data, n));
  const old = unit.equipment[slot],
    item = equipmentDefinition(data, contentId);
  if (old === contentId) return true;
  if (item.type_id !== 2 && !(game.inventory[contentId] > 0)) return false;
  if (item.type_id !== 2) game.inventory[contentId]--;
  if (equipmentDefinition(data, old)?.type_id !== 2 && equipmentDefinition(data, old))
    game.inventory[old] = (game.inventory[old] ?? 0) + 1;
  unit.equipment[slot] = contentId;
  // Removing a slot-changing relic must not leave an illegal second weapon.
  for (let n = 0; n < 6; n++)
    if (!canEquip(data, unit, unit.equipment[n], n)) {
      const removed = unit.equipment[n];
      if (equipmentDefinition(data, removed)?.type_id !== 2)
        game.inventory[removed] = (game.inventory[removed] ?? 0) + 1;
      unit.equipment[n] = emptyEquipment(data, n);
    }
  recalculateEquipment(data, unit);
  for (const message of unit.equipmentGuesses ?? []) game.warn(null, message);
  game.event("equipment", { id: memberId, equipment: [...unit.equipment] });
  return true;
}

export const equipmentScore = (data, id, slot) => {
  const item = equipmentDefinition(data, id),
    content = data.contents?.[id];
  if (!item || item.type_id === 2) return 0;
  return slot < 2 && content.type_id === 2
    ? item.attack * 4 + item.strength * 2 + item.magic
    : (item.defense ?? 0) * 2 +
        (item.ability_defense ?? 0) * 2 +
        (item.evasion_rate ?? 0) +
        (item.ability_evasion_rate ?? 0) * 2 +
        (item.strength ?? 0) * 2 +
        (item.magic ?? 0) * 2 +
        (item.agility ?? 0) +
        (item.max_hp_up ?? 0) / 10 +
        (item.max_mp_up ?? 0) / 5 +
        ({ 294: 20, 295: 20, 300: 40, 301: 100, 302: 40, 303: 20, 304: 25, 305: 50, 327: 10 }[id] ??
          0);
};
export function optimizeEquipment(game, memberId, { duringEvent = false } = {}) {
  if ((!duringEvent && game.busy) || !validMember(game, memberId)) return false;
  const unit = game.unit(memberId),
    data = game.battleData;
  let any = false;
  for (let slot = 0; slot < 6; slot++) {
    const old = unit.equipment?.[slot] || emptyEquipment(data, slot);
    const candidates = [
      old,
      ...Object.keys(game.inventory)
        .filter((id) => game.inventory[id] > 0)
        .map(Number),
    ].filter((id) => canEquip(data, unit, id, slot));
    const best = candidates.sort(
      (a, b) => equipmentScore(data, b, slot) - equipmentScore(data, a, slot),
    )[0];
    if (best && best !== old) {
      any = equip(game, memberId, slot, best, { duringEvent }) || any;
    }
  }
  return any;
}

export function equipMagicite(game, memberId, contentId) {
  if (game.busy || !validMember(game, memberId) || [13, 14].includes(memberId) || memberId > 14)
    return false;
  contentId = Number(contentId) || 0;
  if (contentId && (!game.battleData.magicStones?.[contentId] || !(game.inventory[contentId] > 0)))
    return false;
  for (const unit of Object.values(game.roster))
    if (contentId && unit.magicite === contentId) unit.magicite = 0;
  const unit = game.unit(memberId);
  unit.magicite = contentId;
  unit.magicLearning ??= {};
  game.event("magicite", { id: memberId, contentId });
  return true;
}

const hasType = (data, unit, types) =>
  (unit.conditions ?? []).some((id) => types.includes(conditionType(data, id)));
function fieldEffect(game, actor, target, functions, power, isItem) {
  const data = game.battleData,
    revive = isRevival(data, { functions });
  const holyWater = functions.some((fn) => fn.id === 11 && fn.values[0] === 15);
  if (holyWater && !hasType(data, target, [34])) return false;
  if (
    !holyWater &&
    (revive
      ? hasType(data, target, [34]) || (target.hp > 0 && !hasType(data, target, [5]))
      : target.hp <= 0)
  )
    return false;
  const before = changed(target);
  const host = { data, elapsed: game.time || 0, warning: (message) => game.warn(null, message) };
  for (const fn of functions)
    if (fn.id === 9 || fn.id === 10)
      for (const id of fn.id === 9 ? [fn.values[0]] : conditionIdsForGroup(data, fn.values[0]))
        setCondition(host, target, id, true);
  const variance = 224 + Math.floor(game.random() * 32);
  const magicAmount = isItem
    ? power
    : Math.floor(
        ((power * 4 + Math.floor((actor.level * actor.magic * power) / 32)) * variance) / 256,
      ) + 1;
  for (const fn of functions)
    if (![1, 9, 10, 11, 12, 23, 28, 34].includes(fn.id))
      game.warn(null, `Field effect function ${fn.id} uses a provisional no-op.`);
  applyRecovery(data, target, functions, { power, magicAmount });
  return changed(target) !== before;
}

export function activeSavePoint(game) {
  if (!game.player || (game.player.vehicle || 1) > 1) return null;
  // entities is the live, source-selected group list. Never inspect dormant
  // map.groups here: a later-story save point may occupy the same cell.
  for (const entity of game.entities ?? []) {
    if (
      entity.kind !== 9 ||
      (entity.savePoint?.actionId !== undefined && entity.savePoint.actionId !== 7) ||
      entity.savePoint?.visible === false
    )
      continue;
    const actual = { ...entity, ...game.actors?.get(String(entity.id)) };
    if (actual.visible === false || actual.layer !== game.player.layer) continue;
    if (
      game.player.x >= actual.x &&
      game.player.x < actual.x + (actual.width || 1) &&
      game.player.y >= actual.y &&
      game.player.y < actual.y + (actual.height || 1)
    )
      return actual;
  }
  return null;
}
export function canUseTent(game) {
  if (!game.player || (game.player.vehicle || 1) > 1) return false;
  return Boolean(game.map?.worldTerrain || activeSavePoint(game));
}

export function useFieldItem(game, contentId, memberId) {
  if (game.busy || !validMember(game, memberId) || !(game.inventory[contentId] > 0)) return false;
  const data = game.battleData,
    content = data.contents?.[contentId],
    item = content?.type_id === 1 ? data.items?.[content.type_value] : null;
  if (!item || !item.menu_function_group_id) return false;
  const rest = [10, 11].includes(item.menu_function_group_id);
  const tent = item.menu_function_group_id === 11;
  if (rest && !canUseTent(game)) return false;
  const functions = functionsFor(data, item.menu_function_group_id);
  if (!functions.length) return false;
  const targets = tent ? game.party : [game.unit(memberId)];
  if (tent) {
    if (
      !targets.some(
        (unit) => unit.hp < unit.maxHp || unit.mp < unit.maxMp || (unit.conditions ?? []).length,
      )
    )
      return false;
    const script = game.data?.scriptIds?.[5000];
    if (script && game.resolve?.(script) !== undefined && game.startScript) {
      // PR function28 explicitly names sc_tnt. The authored item effect
      // owns recovery and its cinematic; one paid item dispatches it once.
      game.inventory[contentId]--;
      game.startScript(script);
      game.event("item", { contentId, targetId: memberId });
      return true;
    }
    game.warn(
      null,
      "Tent source script is unavailable; applying its party HP/MP and condition recovery directly.",
    );
  }
  let used = false;
  for (const target of targets) {
    if (tent) {
      const before = changed(target);
      target.hp = target.maxHp;
      target.mp = target.maxMp;
      target.conditions = [];
      used = changed(target) !== before || used;
    } else used = fieldEffect(game, target, target, functions, item.standard_value, true) || used;
  }
  if (!used) return false;
  game.inventory[contentId]--;
  game.event("item", { contentId, targetId: memberId });
  return true;
}

export function useFieldAbility(game, abilityId, memberId, targetId = memberId) {
  if (game.busy || !validMember(game, memberId) || !validMember(game, targetId)) return false;
  const actor = game.unit(memberId),
    target = game.unit(targetId),
    ability = game.battleData.abilities?.[abilityId];
  const cost = abilityMpCost(actor, ability ?? {});
  if (
    !ability ||
    ![...(actor.abilities ?? []), ...(actor.equipmentAbilities ?? [])].includes(abilityId) ||
    actor.hp <= 0 ||
    hasType(game.battleData, actor, [5, 6, 11, 34]) ||
    actor.mp < cost
  )
    return false;
  const forbiddenTypes = (ability.forbiddenConditions || []).map((id) =>
    conditionType(game.battleData, id),
  );
  if (hasType(game.battleData, actor, forbiddenTypes)) return false;
  const functions = functionsFor(game.battleData, ability.menuFunctionGroup);
  if (!functions.length || !fieldEffect(game, actor, target, functions, ability.power, false))
    return false;
  actor.mp -= cost;
  game.event("ability", { abilityId, actorId: memberId, targetId });
  return true;
}
