import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ordinaryWeapon,
  weaponDamagePlan,
  finalizeWeaponDamage,
  ultimaWeaponDamage,
  diceWeaponDamage,
} from "./weapon-damage.js";
const data = JSON.parse(
  fs.readFileSync(new URL("../../build/play/battle.json", import.meta.url), "utf8"),
);
const fight = data.abilities[1];
const contentFor = (id) =>
  Object.values(data.contents).find((content) => content.type_id === 2 && content.type_value === id)
    .id;
const actorFor = (id, extra = {}) => ({
  equipment: [contentFor(id)],
  hp: 500,
  maxHp: 1000,
  mp: 10,
  maxMp: 100,
  level: 20,
  ...extra,
});
const targetFor = (extra = {}) => ({
  hp: 400,
  maxHp: 1000,
  mp: 90,
  maxMp: 100,
  conditions: [],
  conditionImmunities: [],
  vitality: 0,
  ...extra,
});

test("special weapons resolve actual content rows and require an explicit hand for dual wield", () => {
  const actor = actorFor(11);
  assert.equal(ordinaryWeapon(data, actor).weapon.id, 11);
  assert.notEqual(contentFor(11), 11);
  assert.equal(ordinaryWeapon(data, { equipment: [11] }), null);
  actor.equipment.push(contentFor(30));
  const warnings = [];
  assert.equal(
    weaponDamagePlan(data, actor, targetFor(), fight, () => 0, { warn: (m) => warnings.push(m) }),
    null,
  );
  assert(warnings[0].includes("actual hand"));
  assert.equal(
    weaponDamagePlan(data, actor, targetFor(), fight, () => 0, { weaponContentId: contentFor(30) })
      .kind,
    "ultima-weapon",
  );
});

test("Valiant Knife exposes missing-HP base bonus and defense bypass without raising actor stats", () => {
  const actor = actorFor(11, { hp: 300, attack: 175 }),
    before = structuredClone(actor);
  const plan = weaponDamagePlan(data, actor, targetFor(), fight);
  assert.equal(plan.baseBonus, 700);
  assert(plan.ability.flags.includes(5));
  assert.equal(plan.noCritical, undefined);
  assert.deepEqual(actor, before);
  assert.deepEqual(fight, data.abilities[1]);
});

test("Ultima Weapon uses the SNES HP high-byte ratio and level/64, with no critical hit", () => {
  assert.equal(ultimaWeaponDamage(2048, { hp: 2048, maxHp: 2048, level: 32 }), 1025);
  assert.equal(ultimaWeaponDamage(2048, { hp: 1024, maxHp: 2048, level: 32 }), 545);
  assert.equal(ultimaWeaponDamage(2048, { hp: 1023, maxHp: 2048, level: 32 }), 449);
  const plan = weaponDamagePlan(
    data,
    actorFor(30, { hp: 1024, maxHp: 2048, level: 32 }),
    targetFor(),
    fight,
  );
  assert(plan.ability.flags.includes(5));
  assert.equal(plan.noCritical, true);
  assert.deepEqual(finalizeWeaponDamage(plan, { amount: 2048, missed: false, critical: true }), {
    amount: 545,
    missed: false,
    critical: false,
    resource: "hp",
    weaponId: 30,
  });
});

test("PR HP/MP drain caps a real transfer and reverses against undead without mutating either unit", () => {
  const actor = actorFor(20, { hp: 900 }),
    target = targetFor(),
    before = structuredClone({ actor, target });
  let plan = weaponDamagePlan(data, actor, target, fight),
    result = finalizeWeaponDamage(plan, { amount: 500, missed: false });
  assert.equal(result.amount, 100);
  assert.equal(result.drain, true);
  assert.equal(result.resource, "hp");
  assert.deepEqual({ actor, target }, before);
  plan = weaponDamagePlan(data, actorFor(20, { hp: 1000 }), target, fight);
  assert.equal(finalizeWeaponDamage(plan, { amount: 500 }).amount, 0);
  plan = weaponDamagePlan(
    data,
    actorFor(20, { hp: 100 }),
    targetFor({ hp: 950, undead: true }),
    fight,
  );
  assert.equal(finalizeWeaponDamage(plan, { amount: 500 }).amount, -50);
  plan = weaponDamagePlan(data, actorFor(24, { mp: 95 }), targetFor({ mp: 30 }), fight);
  result = finalizeWeaponDamage(plan, { amount: 200 });
  assert.equal(result.resource, "mp");
  assert.equal(result.amount, 5);
});

test("Healing Rod reverses its physical result to healing and damages undead recipients", () => {
  const actor = actorFor(53);
  let plan = weaponDamagePlan(data, actor, targetFor(), fight);
  assert(plan.ability.flags.includes(5));
  assert.equal(plan.ability.kind, "physical");
  assert.equal(finalizeWeaponDamage(plan, { amount: 200, critical: true }).amount, -200);
  assert.equal(finalizeWeaponDamage(plan, { amount: 200, critical: true }).critical, false);
  plan = weaponDamagePlan(data, actor, targetFor({ conditions: [15] }), fight);
  assert.equal(finalizeWeaponDamage(plan, { amount: 200 }).amount, 200);
});

test("Dice ignore ordinary damage modifiers and matching Fixed Dice apply their actual face bonus", () => {
  assert.equal(diceWeaponDamage(20, [1, 6]), 240);
  assert.equal(diceWeaponDamage(20, [3, 3, 3]), 3240);
  const actor = actorFor(84, { level: 10 }),
    warnings = [];
  const plan = weaponDamagePlan(data, actor, targetFor(), fight, () => 0.999, {
    warn: (m) => warnings.push(m),
  });
  assert.deepEqual(plan.faces, [6, 6, 6]);
  assert.equal(plan.fixedAmount, 25920);
  assert(plan.ability.flags.includes(1));
  assert(plan.ability.flags.includes(5));
  assert.equal(warnings.length, 1);
  const result = finalizeWeaponDamage(plan, { amount: 1, missed: true, critical: true });
  assert.equal(result.amount, 9999);
  assert.equal(result.missed, false);
  assert.equal(result.critical, false);
});

test("Hawk Eye uses 50-percent source multipliers and resolves Float by PR condition type", () => {
  const actor = actorFor(75),
    normal = weaponDamagePlan(data, actor, targetFor(), fight, () => 0.499);
  assert.equal(normal.ability.multiplier, 1.5);
  const floating = weaponDamagePlan(
    data,
    actor,
    targetFor({ conditions: [17] }),
    fight,
    () => 0.499,
  );
  assert.equal(floating.ability.multiplier, 3);
  assert.equal(
    weaponDamagePlan(data, actor, targetFor(), fight, () => 0.5),
    null,
  );
});

test("Zantetsuken requires both the 25-percent proc and stamina roll and honors source death immunity", () => {
  const actor = actorFor(27),
    target = targetFor({ vitality: 64 });
  let rolls = [0.249, 64 / 128];
  const plan = weaponDamagePlan(data, actor, target, fight, () => rolls.shift());
  assert.equal(plan.instantDeath, true);
  assert.equal(plan.fixedAmount, target.hp);
  rolls = [0.249, 63 / 128];
  assert.equal(
    weaponDamagePlan(data, actor, target, fight, () => rolls.shift()),
    null,
  );
  rolls = [0.25];
  assert.equal(
    weaponDamagePlan(data, actor, target, fight, () => rolls.shift()),
    null,
  );
  target.conditionImmunities = [5];
  assert.equal(
    weaponDamagePlan(data, actor, target, fight, () => {
      throw Error("immune target must not roll");
    }),
    null,
  );
  delete target.vitality;
  target.conditionImmunities = [];
  const warnings = [];
  assert.equal(
    weaponDamagePlan(data, actor, target, fight, () => 0, { warn: (m) => warnings.push(m) }),
    null,
  );
  assert(warnings[0].includes("vitality/stamina"));
});
