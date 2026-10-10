import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmPlayerParameters,
  confirmEnemyParameters,
  playerEvasionPercent,
  type ParameterValues,
  type ParameterLimits,
  type PlayerParameterInput,
  type ParameterEquipment,
} from "../src/core/parameters.js";
import {
  compilePlayerParameters,
  compileEnemyParameters,
  compileParameterEquipment,
  compileParameterLimits,
  parameterLimitKeys,
} from "../src/compiler/parameters.js";
import { battleTableIndex } from "../src/compiler/battle.js";

const zero: ParameterValues = {
  hp: 0,
  mp: 0,
  magic: 0,
  attack: 0,
  defense: 0,
  magicDefense: 0,
  agility: 0,
  weight: 0,
  evasion: 0,
  magicEvasion: 0,
};
const limits: ParameterLimits = {
  hp: 9999,
  mp: 999,
  magic: 128,
  naturalMagic: 128,
  attack: 255,
  defense: 255,
  magicDefense: 255,
  agility: 128,
  evasion: 255,
  magicEvasion: 255,
  evasionPercent: 100,
  magicEvasionPercent: 100,
};
function state(): PlayerParameterInput {
  return {
    base: { ...zero },
    temporary: { ...zero },
    additional: { hp: 0, mp: 0, magic: 0, agility: 0, weight: 0 },
    correction: { magic: 0, agility: 0 },
    passive: { hp: 0, mp: 0, magicEvasion: 0 },
    equipment: [],
    condition601: false,
    twoHandMultiplier: 1,
  };
}
function item(
  slot: number,
  kind: "weapon" | "armor",
  values: Partial<ParameterValues>,
): ParameterEquipment {
  return {
    slot,
    kind,
    values: { ...zero, ...values },
    bareHands: false,
    reversedByCondition601: false,
  };
}
test("growth/correction caps precede equipment and temporary reductions", () => {
  const s = state();
  s.base.magic = 120;
  s.additional.magic = 20;
  s.correction.magic = 10;
  s.temporary.magic = -4;
  s.equipment = [item(1, "weapon", { magic: -6 })];
  s.base.agility = 127;
  s.additional.agility = 30;
  s.temporary.agility = -5;
  assert.equal(confirmPlayerParameters(s, limits).magic, 118); // Not min(128, 140).
  assert.equal(confirmPlayerParameters(s, limits).agility, 123);
  // Distinct natural and final constants must not be collapsed, even when this build uses 128 for both.
  assert.equal(
    confirmPlayerParameters(s, { ...limits, naturalMagic: 100 }).magic,
    90,
  );
  s.base.defense = 400;
  s.temporary.defense = -100;
  assert.equal(confirmPlayerParameters(s, limits).defense, 155);
});
test("FFVI weapon attack follows the natural cap, and two hands multiply afterwards", () => {
  const s = state();
  s.base.attack = 250;
  s.temporary.attack = 20;
  s.equipment = [item(1, "weapon", { attack: 100 })];
  assert.equal(confirmPlayerParameters(s, limits).attack, 355);
  s.twoHandMultiplier = 2;
  assert.equal(confirmPlayerParameters(s, limits).attack, 710);
  s.equipment.push(item(5, "weapon", { attack: 900 }));
  assert.equal(
    confirmPlayerParameters(s, limits).attack,
    710,
    "Only hand slots supply weapon attack",
  );
});
test("condition 601 reverses special weapon and armor reduction, preserving zero values", () => {
  const s = state();
  s.base.attack = 12;
  s.base.defense = 20;
  const w = item(1, "weapon", { attack: 90 }),
    a = item(2, "armor", { defense: 50 }),
    z = item(3, "armor", { defense: 0 });
  w.reversedByCondition601 = true;
  s.equipment = [w, a, z];
  assert.deepEqual(
    [
      confirmPlayerParameters(s, limits).attack,
      confirmPlayerParameters(s, limits).defense,
    ],
    [13, 70],
  );
  s.condition601 = true;
  assert.deepEqual(
    [
      confirmPlayerParameters(s, limits).attack,
      confirmPlayerParameters(s, limits).defense,
    ],
    [102, 21],
  );
  a.reversedByCondition601 = true;
  assert.equal(confirmPlayerParameters(s, limits).defense, 70);
});
test("the empty-hand weapon type supplies the native bonus, not every zero-attack item", () => {
  const s = state();
  s.base.attack = 20;
  s.equipment = [item(1, "weapon", {}), item(2, "weapon", {})];
  assert.equal(confirmPlayerParameters(s, limits).attack, 20);
  s.equipment.forEach((e) => (e.bareHands = true));
  assert.equal(confirmPlayerParameters(s, limits).attack, 30);
  s.condition601 = true;
  assert.equal(confirmPlayerParameters(s, limits).attack, 21);
});
test("resource staging keeps passive input, player caps, enemy uncapped resources and signed arithmetic", () => {
  const s = state();
  s.base.hp = 12000;
  s.additional.hp = 100;
  s.temporary.hp = -100;
  s.passive.hp = 20;
  s.equipment = [item(1, "weapon", { hp: 30, weight: 5 })];
  s.base.weight = 2;
  s.additional.weight = 3;
  s.temporary.weight = -20;
  assert.equal(confirmPlayerParameters(s, limits).hp, 9949);
  assert.equal(confirmPlayerParameters(s, limits).weight, -10);
  s.base.hp = 1;
  s.additional.hp = 0;
  s.temporary.hp = -100;
  s.passive.hp = 0;
  s.equipment = [];
  assert.equal(
    confirmPlayerParameters(s, limits).hp,
    -99,
    "No invented second HP lower clamp",
  );
  const enemy = confirmEnemyParameters(
    { ...zero, hp: 65000, mp: 6000, magic: 160, weight: 20 },
    { ...zero, hp: 1000, magic: -50, weight: -30 },
    limits,
  );
  assert.deepEqual(
    [enemy.hp, enemy.mp, enemy.magic, enemy.weight],
    [66000, 6000, 110, -10],
  );
  assert.equal(
    confirmEnemyParameters(
      { ...zero, hp: 0x7fffffff },
      { ...zero, hp: 1 },
      limits,
    ).hp,
    -0x80000000,
  );
});
test("raw evasion stays separate from percentage and the two magic-evasion conversions", () => {
  const s = state();
  s.base.evasion = 51;
  s.base.magicEvasion = 51;
  s.equipment = [
    item(1, "weapon", { evasion: 26 }),
    item(2, "armor", { magicEvasion: 26 }),
  ];
  const values = confirmPlayerParameters(s, limits);
  assert.equal(values.evasion, 77);
  assert.equal(values.magicEvasion, 77);
  assert.deepEqual(playerEvasionPercent(s, limits), {
    physical: 30,
    magic: 18,
  });
});
test("unknown or malformed numeric/provider inputs cannot silently become zero", () => {
  for (const bad of [NaN, Infinity, 1.5, 0x80000000, undefined]) {
    const s = state();
    s.additional.magic = bad as number;
    assert.throws(() => confirmPlayerParameters(s, limits), /int32/);
  }
  const s = state();
  s.equipment = [item(1, "weapon", {}), item(1, "armor", {})];
  assert.throws(() => confirmPlayerParameters(s, limits), /slot/);
  assert.throws(
    () => confirmPlayerParameters(state(), { ...limits, magic: 0 }),
    /limit/,
  );
});

const source = {
  file: "synthetic.bundle",
  assetPath: "table.csv",
  objectId: "-9223372036854775807",
  serializedFile: "synthetic",
};
function reader() {
  const equipment = {
    id: "700",
    type_id: "1",
    attack: "40",
    max_hp_up: "5",
    max_mp_up: "2",
    magic: "4",
    agility: "3",
    weight: "7",
    evasion_rate: "20",
    wear_function_group_id: "0",
    wear_condition_group_id: "0",
  };
  const character = {
    id: "999",
    hp: "80",
    mp: "12",
    magic: "20",
    attack: "30",
    defense: "40",
    ability_defense: "50",
    agility: "25",
    evasion_rate: "10",
    magic_evasion_rate: "12",
    initial_condition_group: "0",
    ...Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`content_id${i + 1}`, "99"]),
    ),
  };
  const tables = {
    "weapon.csv": [equipment],
    "character_status.csv": [character],
    "content.csv": [{ id: "99", type_id: "2", type_value: "700" }],
    "monster.csv": [
      { ...character, id: "998", weight: "8", ability_attack: "70" },
    ],
    "game_constant_int.csv": Object.entries(parameterLimitKeys).map(
      ([k, v], i) => ({
        id: String(i + 1),
        key_name: v,
        value1: String(limits[k as keyof ParameterLimits]),
      }),
    ),
  };
  return {
    tables,
    index: battleTableIndex(
      tables,
      Object.fromEntries(
        Object.keys(tables).map((k) => [k, { ...source, assetPath: k }]),
      ),
    ),
  };
}
test("source parameter binding uses row identities, weapon evasion and FFVI enemy ability_attack", () => {
  const { index } = reader();
  const l = compileParameterLimits(index);
  assert.deepEqual(l.values, limits);
  const s = state();
  const p = compilePlayerParameters(index, 999, s, limits);
  assert.equal(
    p.confirmed.evasion,
    130,
    "All equipment contributes evasion, including weapons",
  );
  assert.equal(
    p.confirmed.attack,
    110,
    "Only slots 1 and 2 contribute weapon attack",
  );
  assert.equal(p.confirmed.magic, 44);
  assert.equal(p.sources[1]!.objectId, source.objectId);
  const e = compileEnemyParameters(index, 998, { ...zero }, limits);
  assert.equal(e.base.magic, 70);
  assert.equal(e.confirmed.magic, 70);
});
test("unresolved wear effects, missing equipment and non-equipment content stay blocked", () => {
  let r = reader();
  r.tables["weapon.csv"][0]!.wear_function_group_id = "123";
  assert.throws(
    () => compileParameterEquipment(r.index, [{ slot: 1, contentId: 99 }]),
    /wear_function/,
  );
  r = reader();
  r.tables["content.csv"][0]!.type_value = "9999";
  assert.throws(
    () => compileParameterEquipment(r.index, [{ slot: 1, contentId: 99 }]),
    /Unresolved/,
  );
  r = reader();
  r.tables["content.csv"][0]!.type_id = "4";
  assert.throws(
    () => compileParameterEquipment(r.index, [{ slot: 1, contentId: 99 }]),
    /content type/,
  );
});
