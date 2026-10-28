import { tr } from "./i18n.js";
// Pure ordinary-Fight weapon rules. Resolve content IDs through PR contents;
// the explicit IDs below are weapon.csv IDs, never inventory content IDs.
//
// Host integration:
// 1. In perform, build one plan and pass {...plan.ability, weaponPlan:plan}
//    to effects (Dice must become undodgeable before Image checks).
// 2. calculateDamage reuses ability.weaponPlan. Add baseBonus to the physical
//    base before variance; honor noCritical. A defined fixedAmount skips the
//    ordinary variance/defense/row/critical path altogether.
// 3. finalizeWeaponDamage(plan, ordinaryResult) returns the final result.
//    Effects apply its resource (HP by default). For drain, return the ACTUAL
//    target resource loss times drainPercent/100 to the caster; negative loss
//    hurts the caster. Keep beforeDamage/death/event handling in the host.
// This module changes no units, equipment, inventory, or random state of its own.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const number = (n, fallback = 0) => (Number.isFinite(Number(n)) ? Number(n) : fallback);
const type = (data, id) => data.conditions?.[id]?.condition_type ?? id;
const undead = (data, unit) =>
  Boolean(unit.undead || (unit.conditions || []).some((id) => type(data, id) === 34));
const addFlags = (ability, ...flags) => ({
  ...ability,
  flags: [...new Set([...(ability.flags || []), ...flags])],
});

export function ordinaryWeapon(data, actor, { weaponContentId, warn = () => {} } = {}) {
  const equipped = actor.weaponEffects?.length
    ? actor.weaponEffects.map((e) => e.contentId)
    : (actor.equipment || []).slice(0, 2);
  const weapons = equipped.flatMap((contentId) => {
    const content = data.contents?.[contentId],
      weapon = content?.type_id === 2 ? data.weapons?.[content.type_value] : null;
    return weapon?.type_id === 1
      ? [
          {
            contentId,
            weapon,
            name: data.contentNames?.[contentId] || tr("weapon.number", { v0: weapon.id }),
          },
        ]
      : [];
  });
  if (weaponContentId !== undefined) {
    const selected = weapons.find((entry) => entry.contentId === weaponContentId);
    if (!selected)
      warn(
        `Weapon content ${weaponContentId} is not an equipped PR weapon; ordinary damage is retained.`,
      );
    return selected ?? null;
  }
  if (weapons.length > 1) {
    warn(
      "Special weapon damage needs an actual hand/weaponContentId; combined dual-wield attack is not reused as one special weapon.",
    );
    return null;
  }
  return weapons[0] ?? null;
}

export function ultimaWeaponDamage(ordinaryAmount, actor) {
  // SNES calc_dmg.asm UltimaEffect uses high-byte HP + 1, then level/64.
  const hp = clamp(Math.trunc(number(actor.hp)), 0, 65535),
    max = Math.max(1, Math.trunc(number(actor.maxHp, 1)));
  const ratio = Math.floor(
    (((hp >>> 8) + 1) * Math.max(1, Math.trunc(number(actor.level, 1)))) / ((max >>> 8) + 1),
  );
  const sign = ordinaryAmount < 0 ? -1 : 1;
  return sign * (Math.floor((Math.abs(ordinaryAmount) * ratio) / 64) + 1);
}

export function diceWeaponDamage(level, faces) {
  const dice = faces.map((face) => clamp(Math.trunc(number(face, 1)), 1, 6));
  const matched = dice.length === 3 && dice.every((face) => face === dice[0]) ? dice[0] : 1;
  return (
    2 *
    Math.max(1, Math.trunc(number(level, 1))) *
    dice.reduce((product, face) => product * face, 1) *
    matched
  );
}

export function weaponDamagePlan(data, actor, target, ability, random = Math.random, options = {}) {
  if (ability?.id !== 1 || ability.kind !== "physical") return null;
  const warn = options.warn || (() => {}),
    entry = ordinaryWeapon(data, actor, options);
  if (!entry) return null;
  const { weapon, contentId, name } = entry,
    process = weapon.process_prog ?? "None";
  const common = {
    weaponId: weapon.id,
    contentId,
    name,
    process,
    ability: { ...ability },
    baseBonus: 0,
    resource: "hp",
  };
  const plan = (kind) => ({ ...common, kind });
  if (weapon.id === 11)
    return {
      ...plan("valiant-knife"),
      ability: addFlags(ability, 5),
      baseBonus: Math.max(0, number(actor.maxHp) - number(actor.hp)),
    };
  if (weapon.id === 30)
    return {
      ...plan("ultima-weapon"),
      ability: addFlags(ability, 5),
      noCritical: true,
      actorHp: number(actor.hp),
      actorMaxHp: number(actor.maxHp, 1),
      actorLevel: number(actor.level, 1),
    };
  if (weapon.id === 53)
    return {
      ...plan("healing-rod"),
      ability: addFlags(ability, 5),
      noCritical: true,
      healing: true,
      targetUndead: undead(data, target),
    };
  // Drainer and Soul Sabre have actual PR wear functions, including HP/MP
  // identity. Do not guess those from their inventory IDs or translated names.
  const wear = data.functions?.[weapon.wear_function_group_id];
  const drain = [1, 2, 3]
    .map((n) => ({
      id: wear?.[`function${n}_id`],
      a: wear?.[`function${n}_value1`],
      percent: wear?.[`function${n}_value2`],
    }))
    .find((fn) => fn.id === 13);
  if (drain) {
    const resource = drain.a === 2 ? "mp" : "hp",
      maximum = resource === "mp" ? "maxMp" : "maxHp";
    return {
      ...plan("drain"),
      resource,
      drain: true,
      drainPercent: number(drain.percent, 100),
      targetUndead: undead(data, target),
      actorResource: number(actor[resource]),
      actorMaximum: number(actor[maximum]),
      targetResource: number(target[resource]),
      targetMaximum: number(target[maximum]),
    };
  }
  if (process === "DICE" || process === "CHEAT_DICE") {
    const faces = Array.from(
      { length: process === "CHEAT_DICE" ? 3 : 2 },
      () => 1 + Math.floor(clamp(number(random()), 0, 1 - Number.EPSILON) * 6),
    );
    warn(
      `Weapon ${weapon.id}: dice use independent uniform d6 rolls; SNES packed-byte bias and frame-derived third die are not reproduced.`,
    );
    return {
      ...plan("dice"),
      ability: addFlags(ability, 1, 5),
      noCritical: true,
      faces,
      fixedAmount: diceWeaponDamage(actor.level, faces),
    };
  }
  if (process === "HAWK_EYE") {
    if (random() >= 0.5) return null;
    const floating = Boolean(
      target.floating || (target.conditions || []).some((id) => type(data, id) === 409),
    );
    // target_effect.asm STRONG_VS_FLYING adds one half-unit normally and
    // four half-units in total for floating targets (1.5x versus 3x).
    return {
      ...plan("hawk-eye"),
      ability: { ...ability, multiplier: number(ability.multiplier, 1) * (floating ? 3 : 1.5) },
    };
  }
  if (process === "SWORD_THAT_CUTS_IRON") {
    const immunities = target.conditionImmunities ?? target.resistanceConditions;
    if (immunities?.some((id) => type(data, id) === 5) || target.instantDeathImmune) return null;
    if (!immunities && target.boss) {
      warn(
        `Weapon ${weapon.id}: boss death-immunity metadata is absent; ordinary damage is retained.`,
      );
      return null;
    }
    const stamina = target.vitality ?? target.stamina;
    if (!Number.isFinite(Number(stamina))) {
      warn(
        `Weapon ${weapon.id}: PR target vitality/stamina is absent; ordinary damage is retained.`,
      );
      return null;
    }
    if (
      random() >= 0.25 ||
      Math.floor(clamp(number(random()), 0, 1 - Number.EPSILON) * 128) <
        clamp(number(stamina), 0, 255)
    )
      return null;
    return {
      ...plan("zantetsuken"),
      ability: addFlags(ability, 1, 5),
      noCritical: true,
      instantDeath: true,
      fixedAmount: Math.max(0, number(target.hp)),
    };
  }
  if (weapon.id === 61)
    warn(
      `Weapon ${weapon.id}: MP-critical spending is not implemented by the pure damage module; ordinary damage is retained.`,
    );
  else if (!["None", "ADD_MAGIC", "THIEFS_KNIFE", "ASSASIN_WEAPON"].includes(process))
    warn(
      `Weapon ${weapon.id}: unrecognized primary process ${process}; ordinary damage is retained.`,
    );
  return null;
}

export function finalizeWeaponDamage(plan, result) {
  if (!plan) return result;
  if (result.missed && plan.fixedAmount === undefined)
    return { ...result, resource: plan.resource, weaponId: plan.weaponId };
  let amount = plan.fixedAmount ?? number(result.amount);
  if (plan.kind === "ultima-weapon")
    amount = ultimaWeaponDamage(amount, {
      hp: plan.actorHp,
      maxHp: plan.actorMaxHp,
      level: plan.actorLevel,
    });
  if (plan.healing) amount = (plan.targetUndead ? 1 : -1) * Math.abs(amount);
  if (plan.drain) {
    const percent = Math.max(0, number(plan.drainPercent, 100));
    // FixDrainDmg caps by both source supply and recipient free capacity.
    // An undead target reverses the transfer; neither side gains resources.
    const supply = plan.targetUndead ? plan.actorResource : plan.targetResource;
    const room = plan.targetUndead
      ? Math.max(0, plan.targetMaximum - plan.targetResource)
      : Math.max(0, plan.actorMaximum - plan.actorResource);
    amount =
      (plan.targetUndead ? -1 : 1) *
      Math.min(Math.abs(amount), supply, percent > 0 ? Math.floor((room * 100) / percent) : 0);
  }
  return {
    ...result,
    amount: clamp(Math.trunc(amount), -9999, 9999),
    missed: false,
    critical: plan.noCritical ? false : Boolean(result.critical),
    resource: plan.resource,
    weaponId: plan.weaponId,
    ...(plan.drain ? { drain: true, drainPercent: plan.drainPercent } : {}),
    ...(plan.instantDeath ? { instantDeath: true } : {}),
  };
}
