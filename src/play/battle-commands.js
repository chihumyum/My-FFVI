// PR command rows own menu structure. Executable actions are a separate view
// used by both the manual UI and the frozen regression input policy.
import { abilityMpCost } from "./progression.js";
import { isRevival, throwableCommands } from "./ability-effects.js";
const unique = (values) => [...new Set(values)];
const learned = (unit) => (unit.abilities ?? []).map((a) => (typeof a === "object" ? a.id : a));
export const blitzInputs = {
  132: ["←", "→", "←"],
  133: ["↓", "↙", "←"],
  134: ["X", "Y", "↓", "↑"],
  135: ["←", "↙", "↓", "↘", "→"],
  136: ["R", "L", "R", "L", "X", "Y"],
  137: ["↑", "↗", "→", "↘", "↓", "↙", "←"],
  138: ["R", "L", "↑", "↓", "X", "Y"],
  139: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙", "←"],
};
export function validBlitz(id, inputs) {
  const expected = blitzInputs[id];
  return (
    !!expected &&
    expected.length === inputs.length &&
    expected.every(
      (key, n) =>
        key === inputs[n] ||
        (
          { "↙": ["↓", "←"], "↘": ["↓", "→"], "↗": ["↑", "→"], "↖": ["↑", "←"] }[key] ?? []
        ).includes(inputs[n]),
    )
  );
}
export function effectiveCommandIds(data, unit) {
  let ids =
    unit.id === 13 ? [25, ...(unit.customCommands ?? [1, 7, 3])] : [...(unit.commands ?? [1, 3])];
  if (unit.magitek) ids = [26, 3];
  else ids = ids.filter((id) => id !== 26);
  if (unit.id === 14) return [];
  if (unit.trance) ids = ids.map((id) => (id === 8 ? 9 : id));
  else ids = ids.filter((id) => id !== 9);
  if (unit.magicOnly)
    // SNES InitCmdList: Fight becomes Magic, Gau's Rage follows Fight,
    // Item/Mimic remain, and other authored slots disappear. Apply PR relic
    // replacements afterwards, so Soul of Thamasa still supplies Dualcast.
    ids = ids.flatMap((id) =>
      [3, 25].includes(id)
        ? [id]
        : [1, 26].includes(id) || (unit.id === 12 && id === 23)
          ? [7]
          : [],
    );
  const wear =
    unit.equipmentEffects ??
    (unit.equipment ?? []).flatMap((id) => {
      const c = data.contents?.[id],
        item = c?.type_id === 2 ? data.weapons?.[c.type_value] : data.armors?.[c?.type_value];
      const f = data.functions?.[item?.wear_function_group_id];
      return f
        ? [1, 2, 3].map((n) => ({
            id: f[`function${n}_id`],
            values: [1, 2, 3].map((k) => f[`function${n}_value${k}`]),
          }))
        : [];
    });
  for (const effect of wear)
    if (effect.id === 61) ids = ids.map((id) => (id === effect.values[0] ? effect.values[1] : id));
  return unique([...ids, 2, 5, 6]);
}
export function actionFor(battle, unit, source) {
  const a = { ...source };
  return {
    ...a,
    revive: isRevival(battle.data, a),
    mp: abilityMpCost(unit, a),
    selectableAll: [6, 14, 20, 21].includes(a.range),
    targetSides:
      a.targetSides ??
      ([6, 7, 8, 9, 20].includes(a.range)
        ? ["player", "enemy"]
        : [1, 2, 5, 12].includes(a.range) || a.target === "ally"
          ? ["player"]
          : ["enemy"]),
    disabled:
      !!a.disabled ||
      abilityMpCost(unit, a) > unit.mp ||
      (a.forbiddenConditions ?? []).some((id) => (unit.conditions ?? []).includes(id)),
  };
}
export function commandMenu(battle, index) {
  const unit = battle.players[index];
  if (!unit || unit.rageMonster || unit.danceAbility || unit.id === 14 || unit.berserk) return [];
  const data = battle.data,
    known = learned(unit);
  const controlled = battle.enemies[unit.controlledEnemyIndex];
  if (controlled && battle.targetable(controlled) && (controlled.conditions ?? []).includes(85)) {
    const actions = (data.commandGroups ?? [])
      .filter((r) => r.group_type === controlled.commandGroup)
      .map((r) => data.abilities?.[data.commands?.[r.command_id]?.ability_id])
      .filter(Boolean)
      .map((a) => ({
        ...actionFor(battle, controlled, a),
        id: `control:${a.id}`,
        targetSides: ["player", "enemy"],
      }));
    actions.push({
      id: "control:cancel",
      name: "解除操纵",
      kind: "control",
      range: 5,
      target: "ally",
      targetSides: ["player"],
      mp: 0,
    });
    return [
      { id: "command:19", commandId: 19, name: `操纵 ${controlled.name}`, input: "list", actions },
    ];
  }
  const partyMagic = unit.id === 13 ? unique(battle.players.flatMap(learned)) : known;
  const spellIds = partyMagic.filter(
    (id) =>
      data.commands?.[7]?.abilityTypes?.includes(data.abilities?.[id]?.typeId) ||
      (!data.commands?.[7]?.abilityTypes?.length && id >= 31 && id <= 84),
  );
  const ids = effectiveCommandIds(data, unit);
  // Magic is unlocked by learned spells/espers, not forcibly put on Gau/Umaro.
  if (
    !unit.magitek &&
    !unit.magicOnly &&
    unit.id !== 14 &&
    spellIds.length &&
    !ids.includes(7) &&
    !ids.includes(31)
  )
    ids.splice(Math.max(0, ids.length - 2), 0, 7);
  const summon = data.magicStones?.[unit.magicite]?.summonAbilityId;
  return ids.map((commandId) => {
    const row = data.commands?.[commandId] ?? {
      id: commandId,
      ability_id: commandId === 5 ? 4 : commandId,
      name: { 1: "攻击", 2: "防御", 3: "道具", 5: "换列", 7: "魔法" }[commandId],
    };
    const menu = {
      id: `command:${commandId}`,
      commandId,
      name: row.name ?? `指令 ${commandId}`,
      input: row.list_type ? "list" : "direct",
      actions: [],
    };
    const gogoSkills =
      unit.id === 13
        ? [3, 6].flatMap((id) =>
            (data.characters?.[id]?.naturalLearning ?? [])
              .filter((r) => r.level <= unit.level)
              .map((r) => r.abilityId),
          )
        : [];
    const own = (
      unit.id === 13 ? unique([...battle.players.flatMap(learned), ...gogoSkills]) : known
    ).filter((id) => row.abilityTypes?.includes(data.abilities?.[id]?.typeId));
    let abilityIds = row.ability_id ? [row.ability_id] : own;
    if ([7, 31].includes(commandId)) {
      abilityIds = [...spellIds, ...(summon && !unit.magiciteUsed ? [summon] : [])];
      menu.input = commandId === 31 ? "dualcast" : "list";
    }
    if (commandId === 3 || commandId === 14) {
      menu.input = "list";
      menu.actions = battle
        .itemsFor(index)
        .filter((a) => (commandId === 14 ? a.id.startsWith("tool:") : a.id.startsWith("item:")));
      abilityIds = [];
    }
    if (commandId === 13) {
      menu.input = "list";
      menu.actions = throwableCommands(data, battle.inventory, unit).map((a) => ({
        ...data.abilities?.[10],
        ...a,
        name: a.name,
        mp: 0,
      }));
      abilityIds = [];
    }
    if (commandId === 6) {
      menu.input = "equipment";
      menu.name = "装备";
    }
    if (commandId === 12) menu.input = "bushido";
    if (commandId === 15) menu.input = "blitz";
    if (commandId === 20) menu.input = "slots";
    if (commandId === 17) {
      menu.input = "list";
      abilityIds = unique([
        ...(unit.id === 13
          ? battle.players.flatMap((u) => u.loreAbilities ?? [])
          : (unit.loreAbilities ?? [])),
        ...own,
      ]);
    }
    if (commandId === 22) {
      menu.input = "list";
      abilityIds = unique([
        ...(unit.id === 13
          ? battle.players.flatMap((u) => u.danceAbilities ?? [])
          : (unit.danceAbilities ?? [])),
        ...own,
      ]);
    }
    if (commandId === 23) {
      menu.input = "list";
      abilityIds = [];
      menu.actions = (
        unit.id === 13 ? unique(battle.players.flatMap((u) => u.rages ?? [])) : (unit.rages ?? [])
      )
        .filter((id) => data.monsters?.[id]?.rageGroup)
        .map((id) => ({
          id: `rage:${id}`,
          name: data.monsters[id].name,
          kind: "rage",
          range: 5,
          target: "ally",
          mp: 0,
        }));
    }
    if (commandId === 26)
      abilityIds = [218, 219, 220, 222, ...(unit.id === 1 ? [221, 223, 224, 225] : [])];
    menu.actions.push(
      ...unique(abilityIds).map(
        (id) =>
          data.abilities?.[id] ?? {
            id,
            name: row.name,
            kind: id === 2 ? "defend" : "physical",
            mp: 0,
            target: "enemy",
          },
      ),
    );
    menu.actions = menu.actions.map((a) => ({
      ...actionFor(battle, unit, a),
      commandId,
      magiciteSummon: a.id === summon,
    }));
    const forbidden = (row.forbiddenConditions ?? []).some((id) =>
      (unit.conditions ?? []).includes(id),
    );
    const released = [row.release_value1, row.release_value2]
      .filter(Boolean)
      .some((id) => (unit.conditions ?? []).includes(id));
    menu.disabled =
      forbidden ||
      (row.release_type === 3 && !released && ![9, 26].includes(commandId)) ||
      (row.release_type === 5 && released) ||
      !menu.actions.length ||
      (commandId === 24 && !battle.isVeldt) ||
      (commandId === 8 && (unit.tranceGauge ?? 255) <= 0);
    if (forbidden) menu.actions = menu.actions.map((a) => ({ ...a, disabled: true }));
    if (commandId === 9 && !unit.trance) menu.disabled = true;
    return menu;
  });
}

export function configureGogo(data, unit, ids) {
  if (
    unit?.id !== 13 ||
    ids.length !== 3 ||
    ids.some((id) => ![1, 3, 7, 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23].includes(id))
  )
    return false;
  unit.customCommands = [...ids];
  return true;
}
