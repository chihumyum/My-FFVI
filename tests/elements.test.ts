import test from "node:test";
import assert from "node:assert/strict";
import {
  magicElementDamage,
  physicalElementDamage,
  mergeElementResistances,
} from "../src/core/elements.js";
import { calculateMagic, type MagicInput } from "../src/core/magic.js";
import { calculatePhysical, type PhysicalInput } from "../src/core/physical.js";
import { calculateDevelopmentEffects } from "../src/core/ability.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import {
  compileAttackElements,
  compileElementResistances,
  compileEquipmentElements,
} from "../src/compiler/elements.js";
import { battleTableIndex } from "../src/compiler/battle.js";

test("magic keeps source order, duplicate absorption, rounding and immune short circuit", () => {
  assert.equal(magicElementDamage(101, [1, 2], { 1: 1, 2: 2 }).damage, 101);
  assert.equal(magicElementDamage(101, [2, 1], { 1: 1, 2: 2 }).damage, 100);
  assert.equal(magicElementDamage(101, [1, 1], { 1: 4 }).damage, 101);
  assert.deepEqual(magicElementDamage(101, [1, 2, 3], { 1: 1, 2: 3, 3: 4 }), {
    damage: 0,
    nullified: true,
  });
  assert.equal(magicElementDamage(101, [1, 2], { 1: 4, 2: 2 }).damage, -50);
});
test("physical chooses one matching resistance by priority, independent of element order", () => {
  for (const elements of [
    [1, 2, 3, 4],
    [4, 3, 2, 1],
  ])
    assert.deepEqual(
      physicalElementDamage(101, elements, { 1: 1, 2: 2, 3: 3, 4: 4 }),
      { damage: -101, nullified: false },
    );
  assert.equal(physicalElementDamage(101, [1, 2], { 1: 1, 2: 2 }).damage, 50);
  assert.equal(physicalElementDamage(101, [1, 1], { 1: 1 }).damage, 202);
  assert.equal(physicalElementDamage(101, [], { 1: 3 }).damage, 101);
});
test("equipment resistance merge picks the stronger admitted type without changing inputs", () => {
  const a = { 1: 1 as const, 2: 4 as const },
    b = { 1: 2 as const, 2: 3 as const };
  assert.deepEqual(mergeElementResistances(a, b), { 1: 2, 2: 4 });
  assert.deepEqual(mergeElementResistances(b, a), { 1: 2, 2: 4 });
  assert.deepEqual(a, { 1: 1, 2: 4 });
  assert.throws(
    () => mergeElementResistances({ 1: 402 } as never),
    /Unimplemented/,
  );
  assert.throws(() => mergeElementResistances(undefined as never), /Missing/);
});
const magic = (): MagicInput => ({
  rules: {
    accuracy: 255,
    contentFlags: [],
    forceDefense: false,
    elements: [1],
  },
  power: 30,
  actor: { side: "player", level: 10, magic: 20 },
  target: {
    side: "enemy",
    magicDefense: 64,
    magicEvasion: 0,
    elementResistances: { 1: 4 },
  },
  recovery: false,
  targetCount: 1,
});
const physical = (): PhysicalInput => ({
  rows: { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false },
  rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] },
  power: 0,
  actor: {
    side: "player",
    level: 10,
    attack: 40,
    strength: 30,
    accuracy: 255,
    criticalRate: 0,
    attackElements: [1],
  },
  target: {
    side: "enemy",
    defense: 64,
    evasion: 0,
    elementResistances: { 1: 4 },
  },
  targetCount: 1,
});
test("absorbed magic is halved for a group even with no-group-penalty flag", () => {
  const i = magic();
  assert.equal(calculateMagic(i, () => 0).amount, -201);
  i.targetCount = 2;
  assert.equal(calculateMagic(i, () => 0).amount, -100);
  i.rules.contentFlags = [2];
  assert.equal(calculateMagic(i, () => 0).amount, -100);
  i.target.elementResistances = { 1: 1 };
  assert.equal(calculateMagic(i, () => 0).amount, 402);
  i.rules.contentFlags = [];
  assert.equal(calculateMagic(i, () => 0).amount, 201);
});
test("physical absorbs after critical and keeps its magnitude for a group", () => {
  const i = physical();
  assert.equal(calculatePhysical(i, () => 0).amount, -64);
  i.targetCount = 3;
  i.actor.criticalRate = 100;
  assert.equal(calculatePhysical(i, () => 0).amount, -128);
  i.rules.normalAttack = false;
  i.power = 30;
  assert.equal(calculatePhysical(i, () => 0).amount, 53); // weapon element no longer used.
});
test("magic absorption keeps signed magnitude while physical has a symmetric 9999 cap", () => {
  const m = magic();
  m.actor.level = 99;
  m.actor.magic = 255;
  m.power = 220;
  m.rules.contentFlags = [5];
  assert.equal(calculateMagic(m, () => 0).amount, -57344);
  const p = physical();
  p.actor.level = 200;
  p.actor.strength = 128;
  p.actor.attack = 255;
  p.target.defense = 0;
  assert.equal(calculatePhysical(p, () => 0).amount, -9999);
});
test("immunity is distinct from an accuracy miss and consumes the reviewed draws", () => {
  const m = magic();
  m.target.elementResistances = { 1: 3 };
  const ranges: number[][] = [];
  assert.deepEqual(
    calculateMagic(m, (a, b) => {
      ranges.push([a, b]);
      return 0;
    }),
    { amount: 0, missed: false, nullified: true },
  );
  assert.deepEqual(ranges, [[0, 31]]);
  const p = physical();
  p.target.elementResistances = { 1: 3 };
  ranges.length = 0;
  assert.deepEqual(
    calculatePhysical(p, (a, b) => {
      ranges.push([a, b]);
      return 0;
    }),
    { amount: 0, missed: false, critical: false, nullified: true },
  );
  assert.deepEqual(ranges, [
    [0, 31],
    [0, 99],
  ]);
});
test("unknown affinity and missing context fail before any random draw", () => {
  const i = magic();
  for (const values of [undefined, { 1: 403 }, { 9: 1 }, { "01": 1 }]) {
    i.target.elementResistances = values as never;
    assert.throws(() => calculateMagic(i, () => assert.fail("Consumed RNG")));
  }
  i.target.elementResistances = {};
  i.rules.elements = [9];
  assert.throws(() => calculateMagic(i, () => assert.fail("Consumed RNG")));
});
test("signed absorption becomes one positive-magnitude HP effect with reversed direction", () => {
  const i = magic();
  const plan = {
    effects: [{ slot: 1, kind: "magic" as const }],
    targeting: compileTargetRule(3, 1)!,
    physical: null,
    magic: i.rules,
  };
  const actor = { ...i.actor, attack: 20, attackElements: [] };
  const target = { ...i.target, defense: 0, evasion: 0 };
  assert.deepEqual(
    calculateDevelopmentEffects(plan, i.power, actor, target, () => 0),
    [{ slot: 1, resource: "hp", recovery: true, amount: 201, missed: false }],
  );
  const healing = {
    ...plan,
    effects: [
      {
        slot: 1,
        kind: "recovery" as const,
        resource: "mp" as const,
        calculation: "magic" as const,
      },
    ],
  };
  assert.equal(
    calculateDevelopmentEffects(healing, i.power, actor, target, () => 0)[0]!
      .recovery,
    false,
  );
});

function reader() {
  const tables: Record<string, Record<string, string>[]> = {
    "attribute.csv": Array.from({ length: 8 }, (_, n) => ({
      id: String(n + 1),
    })),
    "attribute_group.csv": [
      { id: "21", group_id: "10", attribute_id: "2", type_id: "4" },
      { id: "22", group_id: "10", attribute_id: "2", type_id: "4" },
      { id: "23", group_id: "10", attribute_id: "1", type_id: "2" },
      { id: "24", group_id: "11", attribute_id: "1", type_id: "0" },
      { id: "25", group_id: "11", attribute_id: "2", type_id: "5" },
      { id: "26", group_id: "11", attribute_id: "1", type_id: "0" },
      { id: "27", group_id: "11", attribute_id: "3", type_id: "3" },
    ],
    "content.csv": [
      { id: "1", type_id: "2", type_value: "101" },
      { id: "2", type_id: "3", type_value: "201" },
    ],
    "weapon.csv": [{ id: "101", attribute_id: "3", attribute_group_id: "0" }],
    "armor.csv": [{ id: "201", resistance_attribute: "10" }],
  };
  return battleTableIndex(
    tables,
    Object.fromEntries(
      Object.keys(tables).map((t) => [
        t,
        {
          file: "synthetic",
          assetPath: t,
          objectId: "9223372036854775807",
          serializedFile: "synthetic",
        },
      ]),
    ),
  );
}
test("duplicate identical resistance rows retain provenance; conflicting rows stay blocked", () => {
  const result = compileElementResistances(reader(), 10);
  assert.deepEqual(result.resistances, { 2: 4, 1: 2 });
  assert.deepEqual(result.shadowedRowIds, ["22"]);
  assert.ok(
    result.sources.every((s) => s.source.objectId === "9223372036854775807"),
  );
  assert.throws(() => compileElementResistances(reader(), 11), /Unimplemented/);
  assert.throws(() => compileElementResistances(reader(), 12), /Unresolved/);
  const conflicting = reader();
  conflicting.row("attribute_group.csv", 22).values.type_id = "1";
  assert.throws(
    () => compileElementResistances(conflicting, 10),
    /Unreviewed conflicting element rows/,
  );
});
test("active group order and duplicates survive; an attribute group takes precedence over the single ID", () => {
  assert.deepEqual(compileAttackElements(reader(), 8, 11).elements, [1, 2, 1]);
  assert.deepEqual(compileAttackElements(reader(), 0, 0).elements, []);
  assert.deepEqual(compileAttackElements(reader(), 8, 0).elements, [8]);
});
test("equipment projection reads the selected arm and merges armor references", () => {
  const a = compileEquipmentElements(reader(), [1, 2, 2, 2, 2, 2], 1);
  assert.deepEqual(a.attackElements, [3]);
  assert.deepEqual(a.resistances, { 1: 2, 2: 4 });
  assert.deepEqual(
    compileEquipmentElements(reader(), [1, 2, 2, 2, 2, 2], 2).attackElements,
    [],
  );
});
