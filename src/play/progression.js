const clamp = (value, max, min = 0) => Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)));
const bonusKeys = { 4: "strength", 5: "vitality", 6: "speed", 14: "magic" };
export function abilityMpCost(unit, ability) {
  if (!(ability.mp > 0)) return 0;
  if (unit.fixedMpCost) return unit.fixedMpCost;
  return Math.max(1, Math.floor(ability.mp * (unit.mpCostMultiplier ?? 1)));
}
// The source character initialization uses these signed offsets to the
// recruited party average. PR supplies starting values and growth increments.
export const firstJoinLevelBonuses = [
  0, 2, 2, 0, 2, 2, 0, 2, 0, 0, 5, 2, 2, 0, -3, 5, 2, -3, 2, 0, 0, -3, 0, 2, 2, 0, 0, 2, 5, 0, -3,
  -3,
];

export function equipmentDefinition(data, contentId) {
  const content = data.contents?.[contentId];
  return content?.type_id === 2
    ? data.weapons?.[content.type_value]
    : content?.type_id === 3
      ? data.armors?.[content.type_value]
      : null;
}
export function emptyEquipment(data, slot) {
  return Number(
    Object.values(data.contents ?? {}).find((content) => {
      const item = equipmentDefinition(data, content.id);
      return (
        item?.type_id === 2 &&
        (slot < 2
          ? content.type_id === 2
          : Number(data.partsGroups?.[item.parts_group_id]?.[`equip${slot + 1}_possible`]) === 1)
      );
    })?.id ?? 0,
  );
}
const actualEquipment = (data, unit) =>
  (unit.equipment ?? [])
    .map((id, slot) => ({
      id,
      slot,
      content: data.contents?.[id],
      item: equipmentDefinition(data, id),
    }))
    .filter((e) => e.item);

export function recalculateEquipment(data, unit) {
  const source = data.characters?.[unit.id] ?? unit;
  const base = source.baseStats;
  if (!base || unit.testBoost) return unit;
  const equipment = actualEquipment(data, unit),
    sum = (key) => equipment.reduce((total, e) => total + (Number(e.item[key]) || 0), 0);
  const bonuses = unit.growthBonuses ?? {};
  const hands = equipment.filter((e) => e.slot < 2 && e.content.type_id === 2);
  const weapons = hands.filter((e) => e.item.type_id !== 2);
  const weapon = weapons[0]?.item;
  const limit = data.limits ?? {};
  const bounded = (key, value, fallback) => clamp(value, limit[key] ?? fallback);
  unit.strength = bounded(
    "MAX_STRNGTH",
    base.strength + (bonuses.strength ?? 0) + sum("strength"),
    128,
  );
  unit.vitality = bounded(
    "MAX_VITALITY",
    base.vitality + (bonuses.vitality ?? 0) + sum("vitality"),
    128,
  );
  unit.magic = bounded("MAX_MAGIC", base.magic + (bonuses.magic ?? 0) + sum("magic"), 128);
  unit.speed = bounded("MAX_AGILITY", base.speed + (bonuses.speed ?? 0) + sum("agility"), 128);
  unit.attack = Math.max(
    0,
    base.attack + (weapons.length ? weapons.reduce((n, e) => n + e.item.attack, 0) : 10),
  );
  unit.defense = bounded("MAX_DEFENSE", base.defense + sum("defense"), 255);
  unit.magicDefense = bounded(
    "MAX_ABILITY_DEFENSE",
    base.magicDefense + sum("ability_defense"),
    255,
  );
  unit.evasion = bounded("MAX_EVASION_RATE", base.evasion + sum("evasion_rate"), 255);
  unit.magicEvasion = bounded(
    "MAX_ABILITY_EVASION_RATE",
    base.magicEvasion + sum("ability_evasion_rate"),
    255,
  );
  unit.accuracy = weapon?.accuracy_rate ?? 100;
  unit.criticalRate = weapon?.critical_rate ?? 3;
  unit.weaponElements = [
    ...new Set(weapons.flatMap((e) => (e.item.attribute_id ? [e.item.attribute_id] : []))),
  ];
  unit.weaponBackRow = weapons.length > 0 && weapons.every((e) => e.item.back_flag === 1);
  unit.weaponEffects = weapons.map((e) => ({
    contentId: e.id,
    process: e.item.process_prog,
    triggerAbilityId: e.item.trigger_ability_id,
    additionalConditionGroup: e.item.additional_condition_group_id,
  }));
  unit.equipmentEffects = equipment.flatMap((e) => {
    const functions = data.functions?.[e.item.wear_function_group_id] ?? {};
    return Array.from({ length: 3 }, (_, n) => ({
      id: functions[`function${n + 1}_id`],
      values: [1, 2, 3].map((k) => functions[`function${n + 1}_value${k}`]),
    })).filter((f) => f.id);
  });
  unit.equipmentLearning = (data.learning ?? [])
    .filter((row) => row.type_id === 4 && (unit.equipment ?? []).includes(row.value1))
    .map((row) => ({ abilityId: data.contents?.[row.content_id]?.type_value, rate: row.value2 }));
  // Teaching equipment accrues AP; it does not make an unlearned spell castable.
  unit.equipmentAbilities = [];
  const previousPermanent = new Set(unit.permanentConditions ?? []);
  unit.affinities = {};
  unit.conditionImmunities = [];
  unit.permanentConditions = [];
  for (const { item } of equipment) {
    for (const row of data.attributeGroups ?? [])
      if (row.group_id === item.resistance_attribute) {
        // PR: one weak, two resist, three immune, four absorb.
        const priority = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
        if ((priority[row.type_id] ?? 0) >= (priority[unit.affinities[row.attribute_id]] ?? 0))
          unit.affinities[row.attribute_id] = row.type_id;
      }
    for (const row of data.conditionGroups ?? []) {
      if (row.group_id === item.resistance_condition)
        unit.conditionImmunities.push(row.condition_id);
      if (row.group_id === item.wear_condition_group_id)
        unit.permanentConditions.push(row.condition_id);
    }
  }
  if (unit.conditions)
    unit.conditions = unit.conditions.filter(
      (id) => !previousPermanent.has(id) || unit.permanentConditions.includes(id),
    );
  unit.elementResistances = unit.affinities;
  const worn = unit.equipment ?? [],
    copies = (id) => worn.filter((value) => value === id).length;
  // These named PR relics carry their behavior in native dictionaries rather
  // than numerical CSV fields. Their familiar SNES meanings are the fallback.
  unit.equipmentGuesses = worn.some((id) =>
    [294, 295, 300, 302, 303, 304, 305, 307, 308, 327].includes(id),
  )
    ? [
        "Relic HP/MP, damage, MP-cost, handedness and experience bonuses use the SNES meaning of the matching PR relic; exact PR native stacking is approximated.",
      ]
    : [];
  unit.physicalDamageMultiplier = 1 + 0.25 * (copies(295) + copies(300));
  unit.magicDamageMultiplier = 1 + 0.25 * (copies(294) + copies(300));
  unit.mpCostMultiplier = worn.includes(304) ? 0.5 : 1;
  unit.fixedMpCost = worn.includes(305) ? 1 : 0;
  unit.expMultiplier = worn.includes(327) ? 2 : 1;
  unit.dualWield = worn.includes(308);
  unit.twoHand =
    worn.includes(307) &&
    weapons.length === 1 &&
    equipment.every((e) => e.slot > 1 || e.item.type_id === 2 || e.content.type_id === 2);
  if (unit.twoHand) unit.attack *= 2;
  const hp = unit.naturalMaxHp ?? source.maxHp ?? unit.maxHp;
  const mp = unit.naturalMaxMp ?? source.maxMp ?? unit.maxMp;
  unit.maxHp = bounded(
    "MAX_HP",
    Math.floor(hp * (worn.includes(302) ? 1.5 : 1)) + sum("max_hp_up"),
    9999,
  );
  unit.maxMp = bounded(
    "MAX_MP",
    Math.floor(mp * (worn.includes(303) ? 1.5 : 1)) + sum("max_mp_up"),
    999,
  );
  unit.hp = Math.min(unit.hp ?? unit.maxHp, unit.maxHp);
  unit.mp = Math.min(unit.mp ?? unit.maxMp, unit.maxMp);
  return unit;
}

export function applyTestBoost(unit) {
  return Object.assign(unit, {
    testBoost: true,
    level: 99,
    hp: 999999,
    maxHp: 999999,
    mp: 999,
    maxMp: 999,
    strength: 255,
    magic: 255,
    attack: 255,
    defense: 250,
    magicDefense: 250,
    speed: 255,
    accuracy: 255,
  });
}

export function createCharacter(data, id, testBoost = false) {
  const src = structuredClone(data.characters?.[id] ?? {});
  const unit = {
    id,
    name: `角色${id}`,
    maxHp: 120,
    maxMp: 30,
    level: 1,
    strength: 25,
    magic: 25,
    defense: 20,
    magicDefense: 20,
    speed: 30,
    ...src,
  };
  unit.hp = unit.maxHp;
  unit.mp = unit.maxMp;
  unit.naturalMaxHp = unit.maxHp;
  unit.naturalMaxMp = unit.maxMp;
  unit.magicite = 0;
  unit.magicLearning = {};
  unit.growthBonuses = {};
  if (testBoost) applyTestBoost(unit);
  else recalculateEquipment(data, unit);
  return unit;
}

export function learnNaturalAbilities(unit, log = () => {}) {
  unit.abilities ??= [1, 2];
  for (const row of unit.naturalLearning ?? [])
    if (row.level <= unit.level && !unit.abilities.includes(row.abilityId)) {
      unit.abilities.push(row.abilityId);
      log(`${unit.name}学会了技能 ${row.abilityId}。`);
    }
}

export function raiseLevel(data, unit, target, { magicite = true, log = () => {} } = {}) {
  target = clamp(target, data.limits?.MAX_LV ?? 99, 1);
  unit.naturalMaxHp ??= unit.maxHp;
  unit.naturalMaxMp ??= unit.maxMp;
  unit.growthBonuses ??= {};
  for (let level = unit.level + 1; level <= target; level++) {
    const row = data.growth?.find((g) => g.group_id === (unit.growthGroup ?? 1) && g.lv === level);
    let hp = row?.hp_value1 ?? 0,
      mp = row?.mp_value1 ?? 0;
    const bonus = magicite ? data.magicStones?.[unit.magicite]?.bonus : null;
    if (bonus?.parameter === 2) hp += Math.floor((hp * bonus.value) / 100);
    else if (bonus?.parameter === 3) mp += Math.floor((mp * bonus.value) / 100);
    else if (bonusKeys[bonus?.parameter]) {
      const key = bonusKeys[bonus.parameter];
      unit.growthBonuses[key] = (unit.growthBonuses[key] ?? 0) + bonus.value;
    }
    unit.naturalMaxHp = clamp(unit.naturalMaxHp + hp, data.limits?.MAX_HP ?? 9999);
    unit.naturalMaxMp = clamp(unit.naturalMaxMp + mp, data.limits?.MAX_MP ?? 999);
    unit.level = level;
    log(`${unit.name}升到了 ${level} 级！`);
  }
  learnNaturalAbilities(unit, log);
  recalculateEquipment(data, unit);
}

export function correctJoinLevel(game, unit, task) {
  if (unit.testBoost) return;
  const recruited = Object.values(game.roster).filter(
    (other) =>
      other.id !== unit.id &&
      other.id <= 14 &&
      (other.enabled || game.partySlots.some((slot) => slot.includes(other.id))),
  );
  if (!recruited.length) return;
  const average = Math.floor(
    recruited.reduce((sum, other) => sum + other.level, 0) / recruited.length,
  );
  const bonus = unit.hasJoined ? 0 : (firstJoinLevelBonuses[unit.id - 1] ?? 0);
  const level = Math.max(unit.level, clamp(average + bonus, 99, 1));
  if (level <= unit.level) return;
  // PR's in_type2 marks the entry correction but does not encode the signed
  // per-character offset. Retain the SNES initialization meaning explicitly.
  game.warn(
    task,
    "First-join level offsets follow SNES character initialization; PR growth and experience values are retained.",
  );
  raiseLevel(game.battleData, unit, level, { magicite: false });
  unit.exp = Math.max(
    unit.exp ?? 0,
    game.battleData.expTable?.find(
      (row) => row.group_id === (unit.expGroup ?? 1) && row.lv === level,
    )?.total_exp ?? 0,
  );
  unit.hp = unit.maxHp;
  unit.mp = unit.maxMp;
}

export function applyBattleRewards(data, players, result, { log = () => {} } = {}) {
  if (result.outcome !== "victory") return;
  const eligible = players.filter(
    (unit) =>
      unit.hp > 0 &&
      !unit.removed &&
      !unit.escaped &&
      !(unit.conditions ?? []).some((id) =>
        [5, 11, 34].includes(data.conditions?.[id]?.condition_type ?? id),
      ),
  );
  const share = Math.floor((result.exp ?? 0) / Math.max(1, eligible.length));
  for (const unit of eligible) {
    unit.exp = clamp(
      (unit.exp ?? 0) + share * (unit.expMultiplier ?? 1),
      data.limits?.MAX_EXP ?? 15000000,
    );
    const target = Math.max(
      unit.level,
      ...(data.expTable ?? [])
        .filter((row) => row.group_id === (unit.expGroup ?? 1) && row.total_exp <= unit.exp)
        .map((row) => row.lv),
    );
    raiseLevel(data, unit, target, { log });
    if ([13, 14].includes(unit.id)) continue;
    const learning = [
      ...(data.learning ?? []).filter((row) => row.type_id === 2 && row.value1 === unit.magicite),
      ...(data.learning ?? []).filter(
        (row) => row.type_id === 4 && (unit.equipment ?? []).includes(row.value1),
      ),
    ];
    unit.magicLearning ??= {};
    for (const row of learning) {
      const ability = data.contents?.[row.content_id]?.type_value;
      if (!ability || unit.abilities?.includes(ability)) continue;
      unit.magicLearning[ability] = clamp(
        (unit.magicLearning[ability] ?? 0) + (result.ap ?? 0) * row.value2,
        100,
      );
      if (unit.magicLearning[ability] >= 100) {
        unit.abilities ??= [1, 2];
        unit.abilities.push(ability);
        log(`${unit.name}学会了技能 ${ability}。`);
      }
    }
  }
}
