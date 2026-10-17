// Independent numerical reference. This file deliberately imports no game code.
// PR CSV values supply operands; SNES 8130132 supplies the fallback operations.
export const referenceSources = {
  physical:
    "SNES src/battle/init_attacker.asm CalcDmg @2b9d; init_2.asm monster Strength initialization; math.asm Mult24 @47b7",
  magic:
    "SNES src/battle/init_attacker.asm CalcMagicDmg @2b69; init_2.asm AddHalf; math.asm Mult24",
  modifiers: "SNES src/battle/calc_dmg.asm CalcDmgMod @0c9e, MultDmg @0d3d",
  hit: "SNES src/battle/init_attacker.asm InvertEvade @2861; check_hit.asm @233f..2399 (BUGFIX_EVADE branch)",
  status:
    "PR condition.csv/condition_group.csv; SNES check_hit.asm CheckHit and status_effect.asm @4634/@467d/@4687/@4691",
  periodic:
    "SNES atb.asm UpdateBattleTime @111b; timer.asm DecCounters @5a83/StatusCounterTbl @5aea",
  rewards: "PR monster.csv exp/gill, monster_party.csv get_value; SNES win.asm @5db0..5e73",
  growth: "PR character_status.csv, growth_curve.csv, exp_table.csv; SNES win.asm DoLevelUp @60c2",
};

const floor = Math.floor;
const bounded = (n, min, max) => Math.max(min, Math.min(max, n));
export const numericRows = (table) =>
  Object.values(table ?? {}).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())
          ? Number(value.trim())
          : value,
      ]),
    ),
  );

// Mult24 stores the full product in e8:e9:ea. CalcDmg takes its high
// sixteen bits after the second multiply; the intermediate level product is
// NOT divided by 256 twice. Player's final LSR/add is integer, not float *1.5.
export function physicalBase({
  level,
  battlePower,
  vigor = 0,
  monsterStrength = 56,
  enemy = false,
}) {
  const strength = enemy ? monsterStrength : Math.min(255, vigor * 2);
  const scaled = floor((level * level * (strength + (enemy ? 4 : 1) * battlePower)) / 256);
  return enemy ? scaled : battlePower + scaled + floor(scaled / 2);
}

export function magicBase({ level, battlePower, magic, enemy = false }) {
  // Enemy magic is multiplied at load time with AddHalf (8-bit saturation).
  const effectiveMagic = enemy ? Math.min(255, magic + floor(magic / 2)) : magic;
  return (level > 0 ? 4 : 1) * battlePower + floor((level * effectiveMagic * battlePower) / 32);
}

export function damageReference({
  base,
  varianceByte = 0,
  defense = 0,
  ignoreDefense = false,
  healing = false,
  shellOrProtect = false,
  targetBackRow = false,
  defending = false,
  targetMorph = false,
  physical = false,
  friendlyFire = false,
}) {
  const stages = {};
  let damage = floor((base * (224 | (varianceByte & 255))) / 256) + 1;
  stages.variance = damage;
  if (!healing && !ignoreDefense) {
    damage = floor((damage * (255 - bounded(defense, 0, 255))) / 256) + 1;
    stages.defense = damage;
    if (shellOrProtect) damage = floor((damage * 170) / 256) + 1;
    if (physical && defending) damage = floor(damage / 2);
    if (physical && targetBackRow) damage = floor(damage / 2);
    if (!physical && targetMorph) damage = floor(damage / 2);
    if (friendlyFire) damage = floor(damage / 2);
  }
  return { amount: bounded(damage, 0, 9999), stages };
}

// SNES's zero-evade inverse is 255, NOT 256. PR CSV says percent accuracy;
// whether PR kept this boundary is explicitly an unconfirmed fallback.
export function hitThreshold({ accuracy = 100, evade = 0, blind = false, physical = false }) {
  if (accuracy === 255) return 100;
  const doubled = bounded(evade, 0, 255) * 2;
  const inverse = doubled >= 256 ? 1 : doubled === 0 ? 255 : 256 - doubled;
  return floor((inverse * (physical && blind ? floor(accuracy / 2) : accuracy)) / 256);
}

export function periodicInterval({ type, haste = false, slow = false }) {
  const step = slow ? 32 : haste ? 84 : 64;
  return ((type === 10 ? 8 : 4) * 16 * 256) / (30 * step);
}

export function periodicAmount(row, maxHp) {
  if (row.rate_type1 === 2) return floor((maxHp * row.rate_value1) / 100);
  if (row.rate_type1 === 3 && row.rate_value1 > 0) return floor(maxHp / row.rate_value1);
  return null; // Sap's rate is absent: do not copy the runtime's provisional /32.
}

export function snesDuration({ type, haste = false, slow = false }) {
  const counters = { 7: 18, 17: 18, 413: 26 };
  return counters[type] === undefined
    ? null
    : (counters[type] * 16 * 256) / (30 * (slow ? 32 : haste ? 84 : 64));
}

export function levelForExp(expRows, exp, group = 1) {
  return Math.max(
    1,
    ...expRows.filter((r) => r.group_id === group && r.total_exp <= exp).map((r) => r.lv),
  );
}

export function growthAtLevel(character, growthRows, level) {
  const group = character.growth_curve_group_id;
  const increments = growthRows.filter((r) => r.group_id === group && r.lv > 1 && r.lv <= level);
  const unsupported = increments.filter((r) => r.insert_type_1 !== 1 || r.hp_value2 || r.mp_value2);
  if (unsupported.length)
    return { unknown: "Non-additive PR growth operands", rows: unsupported.map((r) => r.id) };
  return {
    hp: Math.min(9999, character.hp + increments.reduce((sum, row) => sum + row.hp_value1, 0)),
    mp: Math.min(999, character.mp + increments.reduce((sum, row) => sum + row.mp_value1, 0)),
  };
}

export function rewardReference({ monsters, participants, veldt = false }) {
  const defeated = monsters.filter((m) => m.defeated && !m.escaped);
  const eligible = participants.filter(
    (p) =>
      p.hp > 0 && !p.escaped && !p.removed && !p.statusTypes?.some((t) => [5, 11, 34].includes(t)),
  );
  const exp = veldt ? 0 : defeated.reduce((n, m) => n + m.exp, 0);
  return {
    exp,
    gil: defeated.reduce((n, m) => n + m.gill, 0),
    share: floor(exp / Math.max(1, eligible.length)),
    eligibleIds: eligible.map((p) => p.id),
  };
}
