// PR function_group composition. Table values win; approximations are explicit
// here and warn at the ability/source that actually uses them.
import { attackHits } from "./battle-accuracy.js";
import { bindStatusLink, pruneStatusLinks } from "./status-links.js";
import { invincible, incomingHpDamage } from "./assists.js";
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const FUNCTION_EFFECTS = {
  1: ["recovery", "implemented"],
  2: ["physical damage", "implemented"],
  3: ["magic damage", "implemented"],
  9: ["add condition", "implemented"],
  10: ["add condition group", "implemented"],
  11: ["remove condition", "implemented"],
  12: ["remove condition group", "implemented"],
  13: ["return drained resource", "implemented"],
  15: ["defend", "implemented"],
  16: ["escape", "implemented"],
  17: ["change row", "implemented"],
  18: ["equipment menu", "input-dependent"],
  19: ["non-damaging action", "implemented"],
  20: ["summon enemy slot", "implemented"],
  23: ["process-specific action", "implemented"],
  32: ["caster HP recovery", "implemented"],
  33: ["current HP fixed damage", "implemented"],
  34: ["max HP recovery", "implemented"],
  38: ["caster condition", "implemented"],
  41: ["delayed ability", "implemented"],
  43: ["finish charged action", "implemented"],
  46: ["weighted random ability", "implemented"],
  50: ["scan", "implemented"],
  51: ["throw selected inventory", "implemented"],
  52: ["steal", "implemented"],
  54: ["conditional child ability", "implemented"],
  56: ["set resource value", "implemented"],
  59: ["mimic", "implemented"],
  63: ["condition-gated group application", "implemented"],
  64: ["swap conditions", "implemented"],
  66: ["force participant escape", "implemented"],
  69: ["magic resource drain", "implemented"],
  70: ["source summon preset", "approximate"],
  71: ["ordered child abilities", "implemented"],
  77: ["physical resource drain", "implemented"],
  78: ["Interceptor damage", "implemented"],
};
export const PROCESS_EFFECTS = Object.fromEntries([
  ["None", "implemented"],
  ["multiply", "implemented"],
  ["StealAttack", "implemented"],
  ["ff6_ability_sketch", "implemented"],
  ["GIL_THROW", "implemented"],
  ["GOLEM", "implemented"],
  ["SM_RAGNAROK", "implemented"],
  ["SM_RAGNAROK_ITEM", "implemented"],
  ["DRAGON", "implemented"],
  ["CHAKRA", "implemented"],
  ["FixedDamage", "implemented"],
  ["LEVEL5", "implemented"],
  ["LEVEL4", "implemented"],
  ["LEVEL3", "implemented"],
  ["LEVEL_RANDOM_HOLY", "implemented"],
  ["WALK_COUNT", "implemented"],
  ["ForceField", "implemented"],
  ["DISCHORD", "implemented"],
  ["STONE", "implemented"],
  ["BAKU", "implemented"],
  ["GAST_SMOKE", "implemented"],
  ["CRANE_BATTLE_VARIABLE_CALC", "approximate"],
  ["BARRIERCHANGE", "implemented"],
  ["ADD_VARIABLE_CALC", "implemented"],
  ["FLARE_STAR", "implemented"],
  ["THROW_PLAYER", "implemented"],
  ["SM_ERASER", "implemented"],
  ["BATTLE_FORCE", "implemented"],
  ["IMP_CRITICAL", "implemented"],
  ["IFRIT_SHIVA_BATTLE_VARIABLE_CALC", "implemented"],
  ["MOVE", "implemented"],
  ["CHADSWITCH", "implemented"],
  ["VARGAS_BATTLE_VARIABLE_CALC", "implemented"],
  ["SET_VARIABLE_CALC", "implemented"],
  ["USE_HAMON_TARGET_HEIST_PLAYER", "implemented"],
  ["ADD_VARIABLE_CALC_TWO_DIMENTIONAL", "implemented"],
  ["ALIVE_PLAYER_TO_USE_TAKOASHI", "implemented"],
  ["ATB_CHANGE", "implemented"],
  ["BATTLE_FORCE_ON_SAVE", "implemented"],
  ["NOSELECT_REMOVE", "implemented"],
]);
export function functionsFor(data, groupId) {
  const row = data.functions?.[groupId];
  if (!row) return [];
  return [1, 2, 3]
    .map((n) => ({
      id: row[`function${n}_id`],
      values: [1, 2, 3].map((k) => row[`function${n}_value${k}`] || 0),
    }))
    .filter((f) => f.id);
}
export function conditionIdsForGroup(data, groupId) {
  return (data.conditionGroups || [])
    .filter((r) => r.group_id === groupId)
    .map((r) => r.condition_id);
}
export function hasConditionType(data, unit, type) {
  return (unit.conditions || []).some(
    (id) => (data.conditions?.[id]?.condition_type ?? id) === type,
  );
}
function releaseCapture(host, unit) {
  for (const [owner, victim] of host.captures || [])
    if (owner === unit || victim === unit) {
      host.captures.delete(owner);
      for (const id of [...(victim.conditions || [])])
        if (host.data.conditions?.[id]?.condition_type === 627)
          setCondition(host, victim, id, false);
      for (const id of [...(owner.conditions || [])])
        if (host.data.conditions?.[id]?.condition_type === 682)
          setCondition(host, owner, id, false);
      host.event?.("battle-release", { actorId: owner.id, targetId: victim.id });
    }
}
export function sourceSummonPlan(data, actor, formation, preset) {
  if (preset === 2)
    return {
      members: (formation?.members || [])
        .filter((member) => member.slot + 1 !== (actor.uniqueId ?? actor.slot + 1))
        .map((member) => ({ monsterId: member.monsterId, uniqueId: member.slot + 1 })),
    };
  const program =
    data.aiPrograms?.[actor.aiName] ||
    Object.values(data.aiPrograms || {}).find((row) => row.name === actor.aiName);
  const calls = (program?.ops || []).flatMap(([, ints = []]) =>
    ints.flatMap((id) =>
      (data.abilities?.[id]?.functions || []).filter((fn) => fn.id === 20).map((fn) => fn.values),
    ),
  );
  const counts = new Map();
  for (const [monsterId] of calls) counts.set(monsterId, (counts.get(monsterId) || 0) + 1);
  const monsterId = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!monsterId)
    return { members: [], guess: `preset ${preset} has no PR companion Function20 summons` };
  let slots = [...new Set(calls.filter((call) => call[0] === monsterId).map((call) => call[1]))];
  if (preset === 3) {
    // Satellite's first two PR calls supply two and three soldiers. The last
    // preset restores four; the missing cardinal grid slot follows that layout.
    slots = [...new Set([...slots, ...[2, 4, 6, 8]])];
    return {
      members: slots.map((uniqueId) => ({ monsterId, uniqueId })),
      guess:
        "preset3 completes the four cardinal slots from the PR two/three-soldier calls and SNES Telstar restore-four behavior",
    };
  }
  return { members: slots.map((uniqueId) => ({ monsterId, uniqueId })) };
}
export function isRevival(data, ability) {
  return (
    (ability.functions || []).some((f) => f.id === 34) &&
    (ability.functions || []).some(
      (f) =>
        (f.id === 11 && (data.conditions?.[f.values[0]]?.condition_type ?? f.values[0]) === 5) ||
        (f.id === 12 &&
          conditionIdsForGroup(data, f.values[0]).some(
            (id) => (data.conditions?.[id]?.condition_type ?? id) === 5,
          )),
    )
  );
}
export function abilityFromItem(data, item, contentId) {
  const functions = functionsFor(data, item.battle_function_group_id);
  const healing = functions.some((f) => [1, 34].includes(f.id));
  const physical = functions.some((f) => [2, 77, 78].includes(f.id));
  return {
    id: `item:${contentId}`,
    contentId,
    itemId: item.id,
    name: item.name || `道具 ${item.id}`,
    kind: healing ? "heal" : physical ? "physical" : "magic",
    target: healing || [1, 2, 5].includes(item.battle_renge_id) ? "ally" : "enemy",
    functions,
    power: item.standard_value || 0,
    range: item.battle_renge_id,
    systemId: item.system_id,
    all: [2, 4, 8, 9, 16, 20, 21].includes(item.battle_renge_id),
    elements: item.attribute_id ? [item.attribute_id] : [],
    accuracy: item.accuracy_rate,
    flags: [],
    mp: 0,
    process: "None",
    revive: isRevival(data, { functions }),
    targetSides: [6, 7, 8, 9, 20].includes(item.battle_renge_id)
      ? ["player", "enemy"]
      : [1, 2, 5, 12].includes(item.battle_renge_id)
        ? ["player"]
        : ["enemy"],
  };
}
// Shared field/battle resource primitive. It does not spend inventory or MP.
export function applyRecovery(data, unit, functions, { power = 0, magicAmount = power } = {}) {
  const hp = unit.hp,
    mp = unit.mp;
  let changed = false;
  for (const f of functions) {
    const [a, b, c] = f.values || [];
    if (f.id === 11 || f.id === 12) {
      const ids = f.id === 11 ? [a] : conditionIdsForGroup(data, a);
      const next = (unit.conditions || []).filter((id) => !ids.includes(id));
      changed ||= next.length !== (unit.conditions || []).length;
      unit.conditions = next;
    } else if (f.id === 1) {
      const key = b === 3 ? "mp" : "hp",
        max = b === 3 ? "maxMp" : "maxHp";
      if (key === "hp" && unit.hp <= 0) continue;
      unit[key] = clamp((unit[key] || 0) + (a === 1 ? power : magicAmount), 0, unit[max] || 0);
    } else if (f.id === 34) {
      const source = a === 1 ? unit.maxHp : unit.maxHp;
      unit.hp = clamp(
        (unit.hp || 0) +
          Math.max(
            1,
            b === 4 ? Math.floor((source * c) / 100) : Math.floor(source / Math.max(1, c)),
          ),
        0,
        unit.maxHp,
      );
    }
  }
  return {
    hp: unit.hp - hp,
    mp: unit.mp - mp,
    revived: hp <= 0 && unit.hp > 0,
    changed: changed || unit.hp !== hp || unit.mp !== mp,
  };
}
export function setCondition(host, unit, id, add = true, { force = false } = {}) {
  const row = host.data.conditions?.[id] || {},
    type = row.condition_type ?? id;
  if (add && invincible(host, unit) && [5, 11, 628].includes(type)) return false;
  unit.conditions ??= [];
  const rulesFor = (condition) =>
    (host.data.eraseConditionGroups || []).filter(
      (r) => r.group_id === host.data.conditions?.[condition]?.erase_condition_group_id,
    );
  // Only a source self-negation rule toggles a repeated application. PR Imp
  // explicitly names itself in type4; overlap alone never implies a toggle.
  if (
    add &&
    unit.conditions.includes(id) &&
    rulesFor(id).some((r) => r.type_id === 4 && r.erase_condition === id)
  )
    add = false;
  if (add && !force) {
    const immune = unit.conditionImmunities || unit.resistanceConditions || [];
    const inherited = unit.conditions.some((active) =>
      conditionIdsForGroup(host.data, host.data.conditions?.[active]?.condition_group_id).includes(
        id,
      ),
    );
    if (
      immune.includes(id) ||
      inherited ||
      unit.conditions.some((active) =>
        rulesFor(active).some((r) => r.type_id === 6 && r.erase_condition === id),
      )
    )
      return false;
  }
  if (add && unit.conditions.includes(id)) {
    if (type === 612) unit.runic = true;
    return true;
  }
  if (!add && (unit.permanentConditions || []).includes(id)) return false;
  const previous = [...unit.conditions];
  unit.conditions = add ? [...unit.conditions, id] : unit.conditions.filter((x) => x !== id);
  if (add) {
    const rules = rulesFor(id),
      negate = rules.filter((r) => r.type_id === 4).map((r) => r.erase_condition);
    if (previous.some((active) => negate.includes(active)))
      unit.conditions = unit.conditions.filter(
        (active) => active !== id && !negate.includes(active),
      );
    const preserved = rules.filter((r) => r.type_id === 5).map((r) => r.erase_condition);
    const clearAll = rules.some((r) => r.type_id === 1) || preserved.length > 0;
    const remove = rules.filter((r) => r.type_id === 3).map((r) => r.erase_condition);
    unit.conditions = unit.conditions.filter(
      (active) =>
        active === id ||
        (unit.permanentConditions || []).includes(active) ||
        (clearAll ? preserved.includes(active) : !remove.includes(active)),
    );
    // PR type404 is Doom. Type14 is Image: its until_type16/value25
    // describes removal on a physical dodge, not a 25-second death clock.
    if (
      unit.conditions.includes(id) &&
      (type === 7 ||
        type === 404 ||
        type === 17 ||
        ([7, 15].includes(row.until_type) && row.until_value > 0))
    ) {
      unit.conditionUntil ??= {};
      unit.conditionUntil[id] = host.elapsed + Math.max(1, row.until_value || 30);
      if (type === 404)
        host.warning?.(
          `Condition ${id}: doom countdown uses PR until_value seconds; native tick cadence is simplified.`,
        );
    }
  }
  for (const removed of previous.filter((active) => !unit.conditions.includes(active)))
    if (unit.conditionUntil) delete unit.conditionUntil[removed];
  const present = unit.conditions.includes(id),
    has = (kind) => hasConditionType(host.data, unit, kind);
  for (const removed of previous.filter((active) => !unit.conditions.includes(active))) {
    const removedType = host.data.conditions?.[removed]?.condition_type;
    if (unit.periodicClocks && !has(removedType)) delete unit.periodicClocks[removedType];
  }
  if (type === 5) {
    if (present) {
      unit.hp = 0;
      unit.ready = false;
      unit.atb = 0;
    } else if (!add) unit.hp = Math.max(1, unit.hp);
  }
  if (type === 3) {
    unit.escaped = present;
    unit.hidden = present;
    unit.ready = false;
  }
  if (
    [id, ...previous.filter((active) => !unit.conditions.includes(active))].some(
      (active) => host.data.conditions?.[active]?.condition_type === 657,
    )
  ) {
    // PR 71/type657 is Engulf: absent from combat, without death or an
    // ordinary escape. Keep its own marker for the all-participants check.
    unit.engulfed = has(657);
    unit.hidden = unit.engulfed || unit.escaped || has(420) || has(625) || has(673);
    if (unit.engulfed) {
      unit.ready = false;
      unit.atb = 0;
    }
  }
  if ([420, 625, 673].includes(type))
    unit.hidden = unit.escaped || has(420) || has(625) || has(673) || has(657);
  if (type === 667) unit.untargetable = has(667);
  if (type === 665 || type === 666) unit.disguise = has(665) ? 2 : has(666) ? 1 : 0;
  if (type === 628 && present) {
    unit.hp = 0;
    unit.mp = 0;
    unit.ready = false;
    unit.atb = 0;
  }
  if (type === 627 && present) {
    unit.ready = false;
    unit.atb = 0;
  }
  if ((type === 5 && present) || ([627, 682].includes(type) && !present))
    releaseCapture(host, unit);
  if (type === 17) {
    unit.stopUntil = present ? (unit.conditionUntil?.[id] ?? host.elapsed + 30) : 0;
    unit.ready = false;
    unit.stopConditionId = present ? id : null;
  }
  // Removed conflicting conditions also clear their derived modifiers.
  if (
    [id, ...previous.filter((active) => !unit.conditions.includes(active))].some((active) =>
      [412, 19, 621, 612, 410].includes(host.data.conditions?.[active]?.condition_type),
    )
  ) {
    unit.protect = has(19);
    unit.shell = has(412);
    unit.trance = has(621);
    unit.runic = has(612);
    unit.berserk = has(410);
  }
  pruneStatusLinks(host);
  return present === add;
}
export function actionBlocked(data, unit) {
  return [5, 7, 11, 34, 17, 627, 657].some((type) => hasConditionType(data, unit, type));
}
export function conditionSpeed(data, unit) {
  // The provider-bearing versions (e.g. 95) are aliases of a condition type,
  // not an extra multiplier stacked on its ordinary version (21).
  let haste = 0,
    slow = 0;
  for (const id of unit.conditions || []) {
    const row = data.conditions?.[id];
    if (row?.condition_type === 15) haste = Math.max(haste, row.rate_value1 || 50);
    if (row?.condition_type === 16) slow = Math.max(slow, row.rate_value1 || 50);
  }
  return Math.max(0.01, 1 + (haste - slow) / 100);
}
// This is ordinary involuntary input, not an extra AI action or a source flag.
export function forcedConditionAction(battle, unit) {
  const confused = hasConditionType(battle.data, unit, 12),
    berserk = hasConditionType(battle.data, unit, 410);
  if (!confused && !berserk) return null;
  const own = unit.side === "enemy" ? battle.enemies : battle.players,
    opponents = unit.side === "enemy" ? battle.players : battle.enemies;
  const eligible = (u) =>
    battle.targetable ? battle.targetable(u) : u.hp > 0 && !u.hidden && !u.removed && !u.escaped;
  const pool = (confused ? [...own, ...opponents] : opponents).filter(eligible);
  if (!pool.length) return null;
  const selected =
    pool[Math.min(pool.length - 1, Math.floor((battle.random || Math.random)() * pool.length))];
  const side = selected.side === "enemy" || battle.enemies.includes(selected) ? "enemy" : "player";
  return {
    abilityId: 1,
    target: { side, index: (side === "enemy" ? battle.enemies : battle.players).indexOf(selected) },
    reason: confused ? "confusion" : "berserk",
  };
}
export function throwableCommands(data, inventory, unit) {
  return Object.entries(inventory || {}).flatMap(([key, count]) => {
    if (!(count > 0)) return [];
    const contentId = Number(key),
      content = data.contents?.[contentId];
    const weapon = content?.type_id === 2 ? data.weapons?.[content.type_value] : null;
    const item = content?.type_id === 1 ? data.items?.[content.type_value] : null;
    if (!(weapon?.throw_flag === 1 || item?.throw_flag === 1)) return [];
    const effect = item
      ? abilityFromItem(data, item, contentId)
      : {
          kind: "physical",
          power: weapon.attack,
          range: 3,
          all: false,
          target: "enemy",
          elements: weapon.attribute_id ? [weapon.attribute_id] : [],
          flags: [1, 5],
          accuracy: 255,
          backRow: true,
          mp: 0,
        };
    return [
      {
        ...effect,
        id: `throw:${contentId}`,
        kind: "throw",
        contentId,
        weaponId: weapon?.id,
        itemId: item?.id,
        name:
          data.contentNames?.[contentId] ||
          data.itemNames?.[item?.id] ||
          weapon?.name ||
          item?.name ||
          `投掷 ${contentId}`,
        count,
        disabled: false,
        functions: [{ id: 51, values: [0, 0, 0] }],
        effect,
        // Host supplies this selection to executeAbilityEffects through options.
        throwContentId: contentId,
      },
    ];
  });
}
export const WEAPON_EFFECTS = {
  None: "ordinary hit; ID-specific numerical weapons still require the damage host",
  ADD_MAGIC: "PR BattleExtraDesc additional-ability rows",
  THIEFS_KNIFE: "SNES 50 percent Steal attempt",
  ASSASIN_WEAPON: "PR additional-condition rows; SNES 25 percent fallback for absent death group",
  SWORD_THAT_CUTS_IRON: "deferred pre-hit instant-kill replacement",
  HAWK_EYE: "deferred pre-hit damage multiplier",
  DICE: "deferred fixed dice damage",
  CHEAT_DICE: "deferred fixed three-dice damage",
};
// Call after a real ordinary Fight, once per actual weapon strike. This never
// changes the base hit into fabricated damage and never uses a rod's separate
// trigger_ability_id (its break/use command) as its on-hit spell.
export function applyWeaponEffects(host, actor, target, ability, result, options = {}) {
  if (ability?.id !== 1 || options.weaponProc || !actor || !target || target.hp <= 0) return [];
  const data = host.data,
    random = host.random || Math.random,
    records = [];
  const effects = (actor.weaponEffects || []).filter(
    (effect) =>
      options.weaponContentId === undefined || effect.contentId === options.weaponContentId,
  );
  if (effects.length > 1)
    host.warning?.(
      "Dual-wield weapon effects are rolled for each equipped weapon; the damage host must split ordinary Fight into actual hand strikes and pass weaponContentId.",
    );
  const additional =
    data.weaponAdditionalAbilities?.additionalAbilities ?? data.weaponAdditionalAbilities ?? [];
  const follow = (weaponId, abilityId) => {
    const source = data.abilities?.[abilityId];
    if (!source) {
      host.warning?.(`Weapon ${weaponId}: missing PR additional ability ${abilityId}; skipped.`);
      return;
    }
    if (!host.perform) {
      host.warning?.(
        `Weapon ${weaponId}: host.perform is unavailable for additional ability ${abilityId}.`,
      );
      return;
    }
    // Automatic weapon spells cost no MP and do not break or consume equipment.
    const proc = { ...source, mp: 0 },
      sequence = {};
    const targets = proc.all
      ? (host.selectAITargets?.(actor, proc, target, true) ?? [target])
      : [target];
    for (const [index, recipient] of targets.entries())
      host.perform(actor, recipient, proc, targets.length, {
        weaponProc: true,
        weaponContentId: options.weaponContentId,
        updateVariables: index === 0,
        sequence,
      });
    records.push({ kind: "ability", weaponId, abilityId });
  };
  for (const effect of effects) {
    const content = data.contents?.[effect.contentId],
      weapon = content?.type_id === 2 ? data.weapons?.[content.type_value] : null;
    if (!weapon) {
      host.warning?.(
        `Weapon content ${effect.contentId}: equipped PR weapon row is unavailable; effect skipped.`,
      );
      continue;
    }
    const weaponId = weapon.id,
      process = effect.process ?? weapon.process_prog ?? "None";
    const group = effect.additionalConditionGroup ?? weapon.additional_condition_group_id;
    const rows = group ? (data.conditionGroups || []).filter((row) => row.group_id === group) : [];
    const inflict = (id, chance) => {
      if (random() * 100 >= clamp(chance, 0, 100)) return;
      const type = data.conditions?.[id]?.condition_type ?? id;
      if (type === 5 && target.boss) return;
      if (type === 5 && process === "ASSASIN_WEAPON" && target.undead) {
        // SNES instant-death weapons heal undead rather than bypassing them.
        setCondition(host, target, id, false);
        target.hp = target.maxHp;
        records.push({ kind: "undead-recovery", weaponId, conditionId: id });
        return;
      }
      if (setCondition(host, target, id, true))
        records.push({ kind: "condition", weaponId, conditionId: id });
    };
    if (result?.hit) for (const row of rows) inflict(row.condition_id, row.invocation_rate ?? 100);
    switch (process) {
      case "None":
        break;
      case "ADD_MAGIC": {
        const entries = additional.filter((row) => (row.weaponId ?? row.weapon_id) === weaponId);
        if (!entries.length)
          host.warning?.(
            `Weapon ${weaponId}: ADD_MAGIC has no exported BattleExtraDesc row; trigger_ability_id is its separate use/break ability and is not substituted.`,
          );
        // SNES CheckWeaponSpellCast rolls after the attack, even when its
        // physical part missed; it retains the original recipient.
        for (const row of entries)
          if (random() * 100 < (row.chance ?? row.ability_per ?? 0))
            follow(weaponId, row.abilityId ?? row.ability_id);
        break;
      }
      case "THIEFS_KNIFE":
        if (result?.hit && random() < 0.5) follow(weaponId, 8);
        break;
      case "ASSASIN_WEAPON":
        if (result?.hit && !rows.length) {
          host.warning?.(
            `Weapon ${weaponId}: absent PR death-condition group uses the SNES instant-death weapon rate25 percent.`,
          );
          inflict(5, 25);
        }
        break;
      case "SWORD_THAT_CUTS_IRON":
      case "HAWK_EYE":
      case "DICE":
      case "CHEAT_DICE":
        host.warning?.(
          `Weapon ${weaponId} (${process}): numerical/replacement effect needs the ordinary-hit damage host; base hit is retained.`,
        );
        break;
      default:
        host.warning?.(`Weapon ${weaponId}: unknown process ${process}; base hit is retained.`);
    }
    if ([11, 20, 30, 53, 61].includes(weaponId))
      host.warning?.(
        `Weapon ${weaponId}: its HP/MP-dependent, drain, healing or MP-critical primary hit needs the ordinary-hit damage host; additional effects do not replace that formula.`,
      );
    if (target.hp <= 0) break;
  }
  return records;
}
export function periodicStatusInterval(data, unit, type) {
  // timer.asm DecCounters: one character slot every sixteen 30-Hz updates;
  // +32/+64/+84 status gauge -> overflow256. Poison fires every eight
  // overflows; regen/sap twice per eight. These clocks are not ATB gauges.
  const step = hasConditionType(data, unit, 16) ? 32 : hasConditionType(data, unit, 15) ? 84 : 64;
  return ((type === 10 ? 8 : 4) * 16 * 256) / (30 * step);
}
export function periodicStatusAmount(unit, row) {
  const type = row.condition_type;
  let amount =
    row.rate_type1 === 2
      ? Math.floor((unit.maxHp * (row.rate_value1 || 0)) / 100)
      : row.rate_type1 === 3
        ? Math.floor(unit.maxHp / Math.max(1, row.rate_value1 || 1))
        : Math.max(1, Math.floor(unit.maxHp / 32));
  if (type === 10) {
    const affinity = (unit.affinities ?? unit.elementResistances)?.[6];
    if (affinity === 1) amount *= 2;
    if (affinity === 3) amount = 0;
    if (affinity === 2) amount = Math.max(1, Math.floor(amount / 2));
    if (affinity === 4) amount = -amount;
  }
  return type === 25 ? -amount : amount;
}
export function tickConditions(host, unit, seconds) {
  pruneStatusLinks(host);
  const wasStopped = hasConditionType(host.data, unit, 17);
  for (const [id, until] of Object.entries(unit.conditionUntil || {}))
    if (host.elapsed >= until) {
      if (host.data.conditions?.[id]?.condition_type === 404)
        setCondition(host, unit, 5, true, { force: true });
      setCondition(host, unit, Number(id), false);
    }
  for (const [owner, victim] of host.captures || [])
    if (owner.hp <= 0 || victim.hp <= 0 || owner.removed || owner.escaped)
      releaseCapture(host, owner);
  if (unit.hp <= 0 || wasStopped || host.events?.paused) return;
  const dt = Number(seconds);
  if (!Number.isFinite(dt) || dt <= 0) return;
  // One clock per effect type prevents ordinary/provider aliases applying
  // poison twice. Cleared statuses discard their elapsed time.
  const groups = new Map();
  for (const id of unit.conditions || []) {
    const row = host.data.conditions?.[id],
      type = row?.condition_type;
    if ([10, 407, 25, 627].includes(type)) {
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(row);
    }
  }
  unit.periodicClocks ??= {};
  for (const type of Object.keys(unit.periodicClocks))
    if (!groups.has(Number(type))) delete unit.periodicClocks[type];
  for (const [type, rows] of groups) {
    let clock = unit.periodicClocks[type];
    if (!clock) {
      clock = unit.periodicClocks[type] = { elapsed: 0, first: true };
      host.warning?.(
        "Periodic conditions use SNES status-counter intervals; initial phase starts at half a cycle because the native random phase is not exported.",
      );
    }
    if (type === 407)
      host.warning?.(
        "Sap condition type407 has no PR scalar rate; using provisional maxHP/32 on the SNES periodic timer.",
      );
    clock.elapsed += dt;
    let interval = periodicStatusInterval(host.data, unit, type) * (clock.first ? 0.5 : 1);
    while (clock.elapsed + 1e-9 >= interval && unit.hp > 0) {
      clock.elapsed = Math.max(0, clock.elapsed - interval);
      clock.first = false;
      const amount = rows
        .map((row) => periodicStatusAmount(unit, row))
        .reduce((best, n) => (Math.abs(n) > Math.abs(best) ? n : best), 0);
      const previous = unit.hp;
      const applied = incomingHpDamage(host, unit, amount);
      unit.hp = clamp(unit.hp - applied, 0, unit.maxHp);
      if (type === 627)
        for (const [owner, victim] of host.captures || [])
          if (victim === unit) owner.hp = clamp(owner.hp + previous - unit.hp, 0, owner.maxHp);
      host.addLog(`${unit.name} ${applied < 0 ? "持续回复" : "持续伤害"} ${Math.abs(applied)}`);
      interval = periodicStatusInterval(host.data, unit, type);
    }
  }
}
const approximate = (host, ability, what) =>
  host.warning(`Ability ${ability.id} (${ability.process || "None"}): ${what}`);
export function executeAbilityEffects(
  host,
  actor,
  target,
  ability,
  targetCount,
  options,
  calculateDamage,
) {
  const random = host.random,
    data = host.data,
    fns = ability.functions || [],
    process = ability.process || "None";
  let amount = 0,
    mpAmount = 0,
    hit = true,
    critical = false,
    numeric = false,
    lastDamage = 0,
    handledProcess = false,
    delegated = false,
    hitResolved = false,
    baseHit = true,
    numericHit = false,
    statusAttempted = false,
    statusApplied = false;
  const apply = (n, resource = "hp") => {
    n = Math.trunc(n);
    const max = resource === "mp" ? target.maxMp : target.maxHp;
    if (resource === "hp") n = host.events?.beforeDamage(actor, target, ability, n) ?? n;
    if (resource === "hp") n = incomingHpDamage(host, target, n);
    const before = target[resource] || 0;
    target[resource] = clamp(before - clamp(n, -9999, 9999), 0, max || 0);
    const actual = before - target[resource];
    if (resource === "hp") amount += actual;
    else mpAmount += actual;
    lastDamage = actual;
    numeric = true;
    numericHit = true;
    if (actual > 0 && resource === "hp" && ability.kind === "physical")
      for (const id of [...(target.conditions || [])])
        if ([7, 12].includes(data.conditions?.[id]?.condition_type ?? id))
          setCondition(host, target, id, false);
    return actual;
  };
  const damage = (kind = ability.kind, resource = "hp", extra = {}) => {
    numeric = true;
    lastDamage = 0;
    const effect = { ...ability, kind, ...extra, hitResolved };
    if (hitResolved && !baseHit) {
      hit = false;
      return;
    }
    const imageId = (target.conditions || []).find(
      (id) => data.conditions?.[id]?.condition_type === 14,
    );
    const guaranteed =
      effect.flags?.includes(1) || (effect.accuracy ?? actor.accuracy ?? 100) >= 255;
    if (kind === "physical" && !guaranteed && imageId !== undefined) {
      // SNES CheckHit always misses this dodgeable physical hit, then rolls
      // whether Image dissipates. PR supplies the removal percent (25).
      const chance = data.conditions[imageId].until_value ?? 25;
      if (random() * 100 < clamp(chance, 0, 100)) setCondition(host, target, imageId, false);
      hit = false;
      return;
    }
    const result = calculateDamage(actor, target, effect, random, targetCount);
    hitResolved = true;
    baseHit = !result.missed;
    hit &&= !result.missed;
    critical ||= result.critical;
    if (!result.missed) {
      let n = result.amount;
      if (kind === "heal") n = -Math.abs(n);
      if (kind === "heal" && target.undead && resource === "hp") n = -n;
      if (host.forceFieldElements?.includes(ability.elements?.[0])) n = 0;
      if (
        n > 0 &&
        kind === "physical" &&
        targetCount === 1 &&
        (ability.id === 1 || process === "StealAttack") &&
        host.golemShield?.side === target.side &&
        host.golemShield?.hp > 0
      ) {
        const block = Math.min(n, host.golemShield.hp);
        host.golemShield.hp -= block;
        n -= block;
      }
      const actual = apply(n, result.resource || resource);
      if (result.drain) {
        const key = result.resource || resource,
          max = key === "mp" ? "maxMp" : "maxHp";
        actor[key] = clamp(
          (actor[key] || 0) + Math.trunc((actual * (result.drainPercent ?? 100)) / 100),
          0,
          actor[max] || 0,
        );
      }
    }
  };
  const child = (id, retarget = false, recipient = null) => {
    const a = data.abilities?.[id];
    if (!a) {
      approximate(host, ability, `missing child ${id}; child skipped.`);
      return;
    }
    if ((host.effectDepth || 0) >= 8) {
      approximate(host, ability, "child chain yielded at depth 8.");
      return;
    }
    const previous = host.effectDepth || 0;
    host.effectDepth = previous + 1;
    try {
      const targets = recipient
        ? [recipient]
        : retarget
          ? host.selectAITargets(actor, a, null, a.all)
          : [target];
      const sequence = {};
      for (const [index, t] of targets.entries())
        host.perform(actor, t, a, targets.length, { updateVariables: index === 0, sequence });
    } finally {
      host.effectDepth = previous;
    }
  };
  const vars = actor.aiState?.vars;
  if (options.updateVariables !== false) {
    if (
      ["ADD_VARIABLE_CALC", "SET_VARIABLE_CALC"].includes(process) &&
      vars &&
      ability.dataB >= 0 &&
      ability.dataB < 15
    )
      vars[ability.dataB] =
        (process === "SET_VARIABLE_CALC"
          ? ability.dataC
          : (vars[ability.dataB] || 0) + ability.dataC) | 0;
    if (process === "ADD_VARIABLE_CALC_TWO_DIMENTIONAL") {
      // Existing pure PR decoder projectEnemyVariableAction resolves this as
      // TWO indices in the same actual attacker's fifteen-cell bank. It does
      // not select another monster slot. Equal indices intentionally add twice.
      if (vars)
        for (const index of [ability.dataA, ability.dataB])
          if (Number.isInteger(index) && index >= 0 && index < 15)
            vars[index] = ((vars[index] || 0) + ability.dataC) | 0;
    }
  }
  const levelDivisor = { LEVEL5: 5, LEVEL4: 4, LEVEL3: 3 }[process];
  if (levelDivisor && target.level % levelDivisor !== 0)
    return { amount: 0, mp: 0, hit: false, critical: false };
  if (ability.invalidBoss && target.boss) return { amount: 0, mp: 0, hit: false, critical: false };
  switch (process) {
    case "SM_ERASER":
      target.hp = 0;
      target.removed = true;
      handledProcess = true;
      break;
    case "NOSELECT_REMOVE":
      target.removed = true;
      target.hidden = true;
      handledProcess = true;
      break;
    case "MOVE": {
      const from = { x: actor.x || 0, y: actor.y || 0 };
      actor.x = from.x + (ability.dataA || 0);
      host.event("battle-move", {
        actorId: actor.id,
        from,
        to: { x: actor.x, y: actor.y || 0 },
        wait: ability.abilityWait || 0,
      });
      break;
    }
    case "ATB_CHANGE":
      target.atb = clamp(ability.dataA || 0, 0, 100);
      target.ready = target.atb >= 100;
      handledProcess = true;
      break;
    case "BARRIERCHANGE": {
      const weak = 1 + Math.floor(random() * 8);
      target.elementResistances = Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [i + 1, i + 1 === weak ? 1 : 4]),
      );
      target.affinities = target.elementResistances;
      handledProcess = true;
      break;
    }
    case "ForceField": {
      host.forceFieldElements ??= [];
      if (options.updateVariables !== false) {
        const pool = [1, 2, 3, 4, 5, 6, 7, 8].filter((e) => !host.forceFieldElements.includes(e));
        if (pool.length) host.forceFieldElements.push(pool[Math.floor(random() * pool.length)]);
      }
      handledProcess = true;
      break;
    }
    case "DISCHORD":
      target.level = Math.max(1, Math.floor(target.level / 2));
      handledProcess = true;
      break;
    case "FixedDamage":
      apply(1000);
      handledProcess = true;
      break;
    case "FLARE_STAR":
      apply(Math.floor((target.level * (ability.power || 80)) / Math.max(1, targetCount)));
      handledProcess = true;
      break;
    case "WALK_COUNT":
      apply(
        Math.floor(
          (host.context.steps || host.banks.SystemVariable?.[3] || 0) /
            Math.max(1, ability.power || 32),
        ),
      );
      handledProcess = true;
      break;
    case "GIL_THROW": {
      const sequence = options.sequence || {};
      if (sequence.gilSpent === undefined) {
        const cost = actor.level * 30,
          budget = actor.side === "enemy" ? actor.gil || 0 : host.context.gil || 0;
        sequence.gilSpent = Math.min(cost, budget);
        if (actor.side === "enemy") actor.gil = Math.max(0, budget - sequence.gilSpent);
        else {
          host.context.gil = Math.max(0, budget - sequence.gilSpent);
          host.event("gil-spend", { amount: sequence.gilSpent });
        }
      }
      apply(Math.floor((2 * sequence.gilSpent) / Math.max(1, targetCount)));
      handledProcess = true;
      break;
    }
    case "CHAKRA":
      if (target !== actor) apply(-Math.floor(actor.maxHp / Math.max(1, targetCount)));
      handledProcess = true;
      break;
    case "GOLEM":
      if (options.updateVariables !== false) host.golemShield = { side: actor.side, hp: actor.hp };
      handledProcess = true;
      break;
    case "SM_RAGNAROK":
    case "SM_RAGNAROK_ITEM": {
      const exchange = (data.monsterExchangeItems || []).find(
        (row) => Number(row.monster_id) === Number(target.monsterId ?? target.id),
      );
      const weight = (data.monsterExchangeWeights || []).find(
        (row) => Number(row.weight_id) === Number(exchange?.weight_id),
      );
      if (!exchange || !weight) {
        hit = false;
        approximate(
          host,
          ability,
          "PR metamorph row is missing; no drop-table substitute or item grant is made.",
        );
      } else if (target.side === "player" || random() * 100 >= Number(weight.weight)) hit = false;
      else {
        const choices = exchange.exchange_content_ids.filter((id) => Number(id) > 0),
          id = Number(choices[Math.floor(random() * choices.length)]);
        if (!id) hit = false;
        else {
          host.inventory[id] = Math.min(data.limits?.MAX_ITEM || 99, (host.inventory[id] || 0) + 1);
          target.removed = true;
          target.ready = false;
          host.event("battle-metamorph", {
            monsterId: target.monsterId ?? target.id,
            contentId: id,
          });
        }
      }
      handledProcess = true;
      break;
    }
    case "ff6_ability_sketch": {
      const rows = (data.randomAbilityGroups || []).filter(
        (row) => row.group_id === target.sketchGroup && row.invocation_rate > 0,
      );
      const chance = Math.min(1, (actor.level || 1) / Math.max(1, target.level || 1));
      if (target.side === "player" || target.sketchDisabled || !rows.length || random() >= chance) {
        hit = false;
        handledProcess = true;
        break;
      }
      let roll = random() * rows.reduce((sum, row) => sum + row.invocation_rate, 0),
        selected = rows.at(-1);
      for (const row of rows) {
        roll -= row.invocation_rate;
        if (roll < 0) {
          selected = row;
          break;
        }
      }
      const sketch = data.abilities?.[selected.ability_id];
      if (sketch) {
        const saved = { magic: actor.magic, strength: actor.strength, attack: actor.attack };
        // SNES dispatches the imitation with monster parameters, then
        // InitAttackerLevel overrides its level with the character using Sketch.
        Object.assign(actor, {
          magic: target.magic,
          strength: target.strength,
          attack: target.attack,
        });
        try {
          child(selected.ability_id, true);
        } finally {
          Object.assign(actor, saved);
        }
      } else {
        hit = false;
        approximate(host, ability, `missing PR Sketch child ${selected.ability_id}.`);
      }
      handledProcess = true;
      break;
    }
    case "DRAGON": {
      for (const [resource, power] of [
        ["hp", ability.dataA || ability.power],
        ["mp", ability.dataB || Math.floor((ability.dataA || ability.power) / 4)],
      ]) {
        damage("magic", resource, {
          power,
          functions: [
            { id: 69, values: [resource === "mp" ? 2 : 1, 0, 0] },
            { id: 13, values: [resource === "mp" ? 2 : 1, 100, 0] },
          ],
        });
        actor[resource] = clamp(
          (actor[resource] || 0) + lastDamage,
          0,
          actor[resource === "mp" ? "maxMp" : "maxHp"] || 0,
        );
      }
      handledProcess = true;
      break;
    }
    case "STONE":
      damage("magic", "hp", { multiplier: actor.level === target.level ? 7 : 1 });
      handledProcess = true;
      break;
    case "LEVEL_RANDOM_HOLY": {
      const divisor = Math.max(0, Math.trunc(host.context.gil || 0)) % 10;
      if (divisor > 0 && target.level % divisor === 0) damage("magic");
      else hit = false;
      handledProcess = true;
      break;
    }
    case "GAST_SMOKE": {
      const ids = conditionIdsForGroup(data, 408);
      for (const id of ids) if (random() < 0.5) setCondition(host, target, id, true);
      handledProcess = true;
      break;
    }
    case "THROW_PLAYER":
      releaseCapture(host, actor);
      handledProcess = true;
      break;
    case "ALIVE_PLAYER_TO_USE_TAKOASHI": {
      // PR Ultros AI labels these three branches Terra/Sabin/Banon, and
      // dataC is their character ID (1/6/15), not a player-slot bit mask.
      if (!host.players.includes(target) || target.id !== ability.dataC || !host.targetable(target))
        return { amount: 0, mp: 0, hit: false, critical: false };
      targetCount = 1;
      break;
    }
    case "CRANE_BATTLE_VARIABLE_CALC":
      if (options.updateVariables !== false)
        approximate(
          host,
          ability,
          "special helper has no PR operands identifying a variable; source AI/event retains variable ownership.",
        );
      break;
  }
  for (const fn of fns) {
    const [a = 0, b = 0, c = 0] = fn.values || [];
    switch (fn.id) {
      case 1:
        if (!handledProcess && (b === 3 || target.hp > 0)) {
          if (a === 1) apply(-(ability.power || 0), b === 3 ? "mp" : "hp");
          else damage("heal", b === 3 ? "mp" : "hp");
        }
        break;
      case 2:
      case 3:
      case 69:
      case 77:
      case 78:
        if (!handledProcess) {
          const kind = [2, 77, 78].includes(fn.id) ? "physical" : "magic",
            resource = [3, 69, 77].includes(fn.id) && a === 2 ? "mp" : "hp";
          const count = fn.id === 2 && a === 2 ? Math.max(1, Math.min(16, b)) : 1;
          if (count > 1) {
            // Quadra Slam/Flurry select a living opponent again for every strike.
            // Each child passes through ordinary hit/counter/status processing.
            const single = {
              ...ability,
              functions: fns.map((entry) =>
                entry === fn ? { ...entry, values: [0, 0, 0] } : entry,
              ),
            };
            hit = false;
            delegated = true;
            for (let n = 0; n < count; n++) {
              const pool = (actor.side === "enemy" ? host.players : host.enemies).filter((unit) =>
                host.targetable(unit),
              );
              if (!pool.length) break;
              const victim = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))],
                hp = victim.hp,
                mp = victim.mp;
              host.perform(actor, victim, single, 1, {
                ...options,
                sequence: {},
                updateVariables: n === 0,
              });
              amount += hp - victim.hp;
              mpAmount += mp - victim.mp;
              hit = true;
            }
            if (actor.side === "player") host.lastMimicAction = { actor, ability, target };
            return { amount, mp: mpAmount, hit, critical, delegated };
          }
          if (target.hp > 0) damage(kind, resource);
        }
        break;
      case 9:
      case 10: {
        if (!hit) break;
        const rows =
          fn.id === 9
            ? [{ condition_id: a }]
            : (data.conditionGroups || []).filter((r) => r.group_id === a);
        statusAttempted = true;
        for (const row of rows) {
          const id = row.condition_id,
            definition = data.conditions?.[id] || {};
          if (ability.invalidBoss && target.boss) continue;
          const force = b === 1 || ability.flags?.includes(1);
          if (!force && !hitResolved) {
            baseHit = attackHits(actor, target, ability, random, data);
            hitResolved = true;
          }
          if (!force && !baseHit) {
            hit = false;
            break;
          }
          // A group member's chance is a separate authored invocation roll.
          // fn9 has no member roll; it must retain the ability's base accuracy.
          // Zero marks an unparameterized member in PR groups, including
          // Mighty Guard406's Shell/Protect. It is not a zero-percent effect.
          const rate = fn.id === 10 && row.invocation_rate > 0 ? row.invocation_rate : 100;
          if (
            definition.condition_type === 627 &&
            (target.side !== "player" ||
              host.captures?.has(actor) ||
              [...(host.captures?.values() || [])].includes(target))
          ) {
            continue;
          }
          if (force || rate >= 100 || random() * 100 < Math.max(0, rate)) {
            let applied = setCondition(host, target, id, true, {
              force: ability.flags?.includes(4),
            });
            if (
              applied &&
              [630, 674].includes(definition.condition_type) &&
              !bindStatusLink(host, actor, target, id)
            )
              applied = false;
            statusApplied ||= applied;
            if (applied && definition.condition_type === 627) {
              host.captures ??= new Map();
              host.captures.set(actor, target);
            }
          }
          if (
            definition.condition_type >= 500 &&
            ![625, 673, 667, 665, 666, 621, 612, 627, 682, 657, 630, 674].includes(
              definition.condition_type,
            )
          )
            approximate(
              host,
              ability,
              `condition ${id}/${definition.condition_type} is retained as a source marker; specialized animation/command behavior may be simplified.`,
            );
        }
        break;
      }
      case 11:
      case 12: {
        const fallen = target.hp <= 0;
        for (const id of fn.id === 11 ? [a] : conditionIdsForGroup(data, a))
          setCondition(host, target, id, false);
        if (fallen && isRevival(data, ability)) target.hp = 0;
        break;
      }
      case 13: {
        const resource = a === 2 ? "mp" : "hp",
          max = resource === "mp" ? actor.maxMp : actor.maxHp;
        const drain = (lastDamage * b) / 100;
        actor[resource] = clamp(actor[resource] + Math.trunc(drain), 0, max);
        break;
      }
      case 15:
        target.defending = true;
        break;
      case 16:
        if (actor.side === "player" && target.side === "player" && host.canEscape === false) {
          host.warning?.(
            "PR escape effect failed because the current source formation or enemy forbids escape.",
          );
          break;
        }
        target.escaped = true;
        target.hidden = true;
        target.ready = false;
        break;
      case 17:
        target.row = target.row === "back" ? "front" : "back";
        break;
      case 18:
        if (host.requestEquipment) host.requestEquipment(actor);
        else host.event("battle-input-request", { kind: "equipment", actorId: actor.id });
        break;
      case 19:
      case 23:
        break;
      case 20:
        if (options.updateVariables !== false) host.addEnemy(a, b);
        break;
      case 32: {
        const unit = a === 1 ? actor : target;
        apply(
          -(b === 1
            ? unit.hp
            : b === 2
              ? Math.floor((unit.hp * c) / 100)
              : b === 3
                ? Math.floor(unit.hp / Math.max(1, c))
                : unit.maxHp - unit.hp),
        );
        break;
      }
      case 33: {
        if (target.boss) {
          hit = false;
          break;
        }
        const unit = a === 1 ? actor : target;
        let n =
          b === 1
            ? unit.hp
            : b === 2
              ? Math.floor((unit.hp * c) / 100)
              : b === 3
                ? Math.floor(unit.hp / Math.max(1, c))
                : b === 6
                  ? unit.maxHp - unit.hp
                  : 0;
        apply(n);
        break;
      }
      case 34:
        apply(
          -Math.max(
            1,
            b === 4
              ? Math.floor((target.maxHp * c) / 100)
              : Math.floor(target.maxHp / Math.max(1, c)),
          ),
        );
        target.atb = 0;
        target.ready = false;
        break;
      case 38:
        if (data.conditions?.[a]?.condition_type !== 682 || c !== 0 || host.captures?.has(actor))
          setCondition(host, actor, a, c === 0);
        break;
      case 41: {
        const owner = fns.some(
          (f) => f.id === 9 && data.conditions?.[f.values?.[0]]?.condition_type === 420,
        )
          ? target
          : actor;
        owner.chargedAbility = a;
        owner.chargedTarget = owner === actor ? target : null;
        owner.atb = 0;
        owner.ready = false;
        approximate(
          host,
          ability,
          "charged ability resolves on its condition holder next ATB turn; exact native animation delay is simplified.",
        );
        break;
      }
      case 43:
        setCondition(host, actor, a, false);
        actor.chargedAbility = null;
        break;
      case 46: {
        const rows = (data.randomAbilityGroups || []).filter(
          (r) =>
            r.group_id === a &&
            (!r.condition_group_id ||
              conditionIdsForGroup(data, r.condition_group_id).some((id) =>
                (actor.conditions || []).includes(id),
              )),
        );
        let roll = random() * rows.reduce((n, r) => n + (r.invocation_rate || 1), 0),
          chosen;
        for (const r of rows) {
          roll -= r.invocation_rate || 1;
          if (roll < 0) {
            chosen = r;
            break;
          }
        }
        if (chosen) child(chosen.ability_id, c === 1);
        else if (b) child(b, c === 1);
        else approximate(host, ability, `random group ${a} has no eligible child.`);
        break;
      }
      case 50:
        host.addLog(
          `${target.name} Lv${target.level} HP ${target.hp}/${target.maxHp} MP ${target.mp}/${target.maxMp}`,
        );
        host.event("battle-scan", { target });
        break;
      case 51: {
        const sequence = options.sequence || {};
        if (!sequence.throwCommand) {
          const command = throwableCommands(data, host.inventory, actor).find(
            (command) => command.contentId === Number(options.throwContentId),
          );
          if (!command) {
            hit = false;
            approximate(
              host,
              ability,
              "Throw requires an owned weapon or throwable item selection; no item was selected or consumed.",
            );
            host.event("battle-input-request", { kind: "throw", actorId: actor.id });
            break;
          }
          sequence.throwCommand = command;
          host.inventory[command.contentId] -= 1;
        }
        const command = sequence.throwCommand,
          effect = command.effect;
        if (command.weaponId) {
          // CalcItemEffect initializes thrown weapon power independently of
          // equipped attack, ignores defense/row/evasion and cannot crit.
          const result = calculateDamage(
            { ...actor, attack: 0, row: "front", weaponElements: [], criticalRate: 0 },
            target,
            effect,
            random,
            1,
          );
          hit = !result.missed;
          if (hit) apply(result.amount);
        } else {
          const result = executeAbilityEffects(
            host,
            actor,
            target,
            { ...effect, id: `throw:${command.contentId}` },
            targetCount,
            { ...options, throwContentId: undefined },
            calculateDamage,
          );
          amount += result.amount;
          mpAmount += result.mp || 0;
          hit = result.hit;
          critical = result.critical;
        }
        break;
      }
      case 52:
        steal();
        break;
      case 54: {
        if (process === "USE_HAMON_TARGET_HEIST_PLAYER") {
          const players = host.players.filter(
            (unit) => host.targetable(unit) && hasConditionType(data, unit, 15),
          );
          const hasted =
            players[Math.min(players.length - 1, Math.floor(random() * players.length))];
          if (hasted) child(b, false, hasted);
          else child(a, false, actor);
        } else {
          child(actor.conditions?.length ? a : b, true);
          approximate(host, ability, "unknown conditional child uses caster-condition fallback.");
        }
        break;
      }
      case 56: {
        const key = a === 2 ? "mp" : "hp";
        apply((target[key] || 0) - b, key);
        break;
      }
      case 59: {
        const previous = host.lastMimicAction;
        if (
          previous?.ability &&
          previous.ability.id !== ability.id &&
          (host.effectDepth || 0) < 8
        ) {
          const copied = previous.ability,
            targets = host.selectAITargets(actor, copied, previous.target, copied.all);
          const sequence = previous.throwCommand ? { throwCommand: previous.throwCommand } : {};
          host.effectDepth = (host.effectDepth || 0) + 1;
          try {
            for (const unit of targets)
              host.perform(actor, unit, copied, targets.length, { mimic: true, sequence });
          } finally {
            host.effectDepth--;
          }
        }
        break;
      }
      case 63: {
        if (c && !(target.conditions || []).includes(c)) {
          hit = false;
          break;
        }
        for (const id of conditionIdsForGroup(data, a)) setCondition(host, target, id, true);
        break;
      }
      case 64: {
        const left = (actor.conditions || []).filter((id) => !target.conditions?.includes(id)),
          right = (target.conditions || []).filter((id) => !actor.conditions?.includes(id));
        // Common statuses remain untouched, including their running clocks.
        for (const id of left) setCondition(host, actor, id, false);
        for (const id of right) setCondition(host, target, id, false);
        for (const id of left) setCondition(host, target, id, true);
        for (const id of right) setCondition(host, actor, id, true);
        break;
      }
      case 66:
        target.escaped = true;
        target.hidden = true;
        target.ready = false;
        break;
      case 70:
        if (options.updateVariables !== false) {
          const plan = sourceSummonPlan(data, actor, host.formation, a);
          if (plan.guess) approximate(host, ability, plan.guess);
          for (const member of plan.members) {
            const present = host.enemies.find(
              (enemy) => enemy.uniqueId === member.uniqueId || enemy.slot + 1 === member.uniqueId,
            );
            if (!present || present.hp <= 0 || present.removed || present.escaped)
              host.addEnemy(member.monsterId, member.uniqueId);
          }
          host.event("battle-summon-preset", {
            preset: a,
            actorId: actor.id,
            members: plan.members,
          });
          break;
        }
        break;
      case 71:
        for (const id of [a, b, c].filter(Boolean)) child(id, true);
        break;
      default:
        approximate(
          host,
          ability,
          `function ${fn.id} has no effect handler; skipped without replacing its other functions.`,
        );
    }
  }
  if (process === "StealAttack") {
    if (!numeric) damage("physical");
    steal();
  }
  if (process === "BAKU") setCondition(host, target, ability.dataA || 7, true);
  if (process === "IMP_CRITICAL" && hasConditionType(data, actor, 601))
    apply(Math.max(1, lastDamage));
  if (!PROCESS_EFFECTS[process])
    approximate(host, ability, `process ${process} has no handler; table functions still execute.`);
  if (!fns.length && !handledProcess && ability.id === 1) damage("physical");
  return {
    amount,
    mp: mpAmount,
    hit: numericHit || (hit && (!statusAttempted || statusApplied)),
    critical,
  };
  function steal() {
    const chance = clamp(50 + (actor.level - target.level) * 2, 5, 100);
    let stole = random() * 100 < chance;
    if (stole && !target.stolen) {
      const rows = (target.steal || []).filter((x) => x.id > 0),
        item = rows[Math.min(rows.length - 1, random() < 0.125 ? 1 : 0)];
      if (item) {
        host.inventory[item.id] = (host.inventory[item.id] || 0) + (item.count || 1);
        target.stolen = true;
      } else stole = false;
    }
    // A failed secondary theft cannot retroactively miss landed Mug damage.
    // Keep the theft roll separate so damage success never grants an item.
    hit = numericHit || stole;
  }
}
