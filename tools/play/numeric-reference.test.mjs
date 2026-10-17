import test from "node:test";
import assert from "node:assert/strict";
import {
  physicalBase,
  magicBase,
  damageReference,
  hitThreshold,
  growthAtLevel,
  levelForExp,
  rewardReference,
} from "./numeric-reference.mjs";

test("SNES player physical LSR/add truncates the level term before adding half", () => {
  // 30² * (2*37+40) = 102600; high product is 400, then 40+400+200.
  assert.equal(physicalBase({ level: 30, battlePower: 40, vigor: 37 }), 640);
  assert.equal(
    damageReference({ base: 640, varianceByte: 16, defense: 0, physical: true }).amount,
    599,
  );
});

test("SNES enemy AddHalf truncates odd magic before the spell multiplication", () => {
  // AddHalf(7)=10, then 4*21 + floor(30*10*21/32).
  assert.equal(magicBase({ level: 30, battlePower: 21, magic: 7, enemy: true }), 280);
});

test("SNES inverse evade retains its zero-evade boundary and blind half hit", () => {
  assert.equal(hitThreshold({ accuracy: 100, evade: 0 }), 99);
  assert.equal(hitThreshold({ accuracy: 100, evade: 64, physical: true, blind: true }), 25);
  assert.equal(hitThreshold({ accuracy: 255, evade: 128, physical: true, blind: true }), 100);
});

test("PR additive growth and cumulative EXP operands have no SNES table substitution", () => {
  const growth = [
    {
      group_id: 1,
      lv: 2,
      insert_type_1: 1,
      hp_value1: 11,
      mp_value1: 5,
      hp_value2: 0,
      mp_value2: 0,
    },
    {
      group_id: 1,
      lv: 3,
      insert_type_1: 1,
      hp_value1: 12,
      mp_value1: 6,
      hp_value2: 0,
      mp_value2: 0,
    },
  ];
  assert.deepEqual(growthAtLevel({ hp: 63, mp: 27, growth_curve_group_id: 1 }, growth, 3), {
    hp: 86,
    mp: 38,
  });
  const exp = [
    { group_id: 1, lv: 1, total_exp: 0 },
    { group_id: 1, lv: 2, total_exp: 32 },
    { group_id: 1, lv: 3, total_exp: 96 },
  ];
  assert.equal(levelForExp(exp, 95), 2);
  assert.equal(levelForExp(exp, 96), 3);
  assert.ok(
    growthAtLevel(
      { hp: 63, mp: 27, growth_curve_group_id: 1 },
      [{ ...growth[0], hp_value2: 20 }],
      2,
    ).unknown,
  );
});

test("SNES rewards share only among eligible survivors; Veldt keeps gil", () => {
  const input = {
    monsters: [
      { exp: 117, gill: 48, defeated: true },
      { exp: 48, gill: 12, defeated: true },
      { exp: 99, gill: 99, defeated: true, escaped: true },
    ],
    participants: [
      { id: 1, hp: 100 },
      { id: 2, hp: 0 },
      { id: 3, hp: 100, statusTypes: [11] },
      { id: 4, hp: 100 },
    ],
  };
  assert.deepEqual(rewardReference(input), { exp: 165, gil: 60, share: 82, eligibleIds: [1, 4] });
  assert.deepEqual(rewardReference({ ...input, veldt: true }), {
    exp: 0,
    gil: 60,
    share: 0,
    eligibleIds: [1, 4],
  });
});
