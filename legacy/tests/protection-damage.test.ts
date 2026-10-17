import test from "node:test";
import assert from "node:assert/strict";
import { calculatePhysical, type PhysicalInput } from "../src/core/physical.js";
import { calculateMagic, type MagicInput } from "../src/core/magic.js";
import { magicProtectionDamage, physicalProtectionDamage } from "../src/core/protection.js";

const physical = (): PhysicalInput => ({
  rows: { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false },
  rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] }, power: 0,
  actor: { side: "player", level: 10, attackElements: [], conditionTypes: [], attack: 40, strength: 30, accuracy: 100, criticalRate: 3 },
  target: { side: "enemy", defense: 64, evasion: 0, elementResistances: {}, conditionTypes: [19] }, targetCount: 1,
});
const magic = (): MagicInput => ({
  rules: { accuracy: 100, contentFlags: [], elements: [], forceDefense: false }, power: 30,
  actor: { side: "player", level: 10, magic: 20 },
  target: { side: "enemy", magicDefense: 64, magicEvasion: 0, elementResistances: {}, conditionTypes: [412] },
  recovery: false, targetCount: 1,
});
function draws(values: number[]) {
  const pending = [...values], ranges: number[][] = [];
  return { random: (min: number, max: number) => {
    ranges.push([min, max]); assert.ok(pending.length, "Unexpected draw"); return pending.shift()!;
  }, done: () => assert.equal(pending.length, 0), ranges };
}
const runPhysical = (input: PhysicalInput, values = [31, 0, 99]) => {
  const rng = draws(values), result = calculatePhysical(input, rng.random); rng.done(); return { ...result, ranges: rng.ranges };
};
const runMagic = (input: MagicInput, values = [0, 31]) => {
  const rng = draws(values), result = calculateMagic(input, rng.random); rng.done(); return { ...result, ranges: rng.ranges };
};

test("Proteus integer reduction precedes normal defense and Defend, critical and elements", () => {
  // 98 base -> 97 variance -> Proteus64 -> defense48 -> Defend24 -> critical48.
  const f = physical();
  assert.equal(runPhysical(f).amount, 48);
  f.target.conditionTypes = [19, 1]; assert.equal(runPhysical(f).amount, 24);
  assert.equal(runPhysical(f, [31, 0, 0]).amount, 48);
  f.actor.attackElements = [1]; f.target.elementResistances = { 1: 4 };
  assert.equal(runPhysical(f, [31, 0, 0]).amount, -48);
  f.targetCount = 2; assert.equal(runPhysical(f, [31, 0, 0]).amount, -48);
  f.target.elementResistances = { 1: 1 }; assert.equal(runPhysical(f).amount, 24);
});

test("protection adds no draws, does not stack for repeated types, and is not keyed by source row IDs", () => {
  const f = physical();
  const protectedValue = runPhysical(f);
  assert.deepEqual(protectedValue.ranges, [[0, 31], [0, 255], [0, 99]]);
  f.target.conditionTypes = [19, 19]; assert.equal(runPhysical(f).amount, 48);
  f.target.conditionTypes = [23, 122, 412]; assert.equal(runPhysical(f).amount, 73);
  const m = magic(); m.target.conditionTypes = [22, 123, 19, 1]; assert.equal(runMagic(m).amount, 229);
  m.target.conditionTypes = [412, 412]; assert.equal(runMagic(m).amount, 153);
  assert.deepEqual(runMagic(m).ranges, [[0, 255], [0, 31]]);
});

test("source flag5 bypasses both protections and physical Defend together", () => {
  const f = physical(); f.rules.contentFlags = [5]; f.target.conditionTypes = [19, 1]; f.target.side = "player";
  assert.equal(runPhysical(f).amount, 97);
  const m = magic(); m.rules.contentFlags = [5]; assert.equal(runMagic(m).amount, 306);
});

test("Shell reduces the magic-defense result with its own +1, before friendly and multi-target halves", () => {
  // Base307 -> varied306 -> magic defense229 -> Shell153 -> friendly76 -> two targets38.
  const f = magic(); assert.equal(runMagic(f).amount, 153);
  f.target.side = "player"; assert.equal(runMagic(f).amount, 76);
  f.targetCount = 2; assert.equal(runMagic(f).amount, 38);
  f.target.side = "enemy"; f.rules.elements = [1]; f.target.elementResistances = { 1: 4 };
  assert.equal(runMagic(f).amount, -76);
  f.target.elementResistances = { 1: 3 }; assert.equal(runMagic(f).amount, 0);
});

test("ordinary healing bypasses Shell but explicit force-defense recovery keeps it", () => {
  const f = magic(); f.recovery = true;
  assert.equal(runMagic(f).amount, 306);
  f.rules.forceDefense = true; assert.equal(runMagic(f).amount, 153);
  f.rules.contentFlags = [5]; assert.equal(runMagic(f).amount, 306);
});

test("protection preserves low-damage rounding and skips numerical processing on misses", () => {
  assert.equal(physicalProtectionDamage(0), 0);
  assert.equal(magicProtectionDamage(0), 0);
  const f = physical(); f.actor.level = 0; f.actor.attack = 0;
  assert.equal(runPhysical(f).amount, 1);
  f.target.conditionTypes = [19, 1]; assert.equal(runPhysical(f).amount, 0);
  f.target.evasion = 255;
  assert.equal(runPhysical(f, [31, 255]).missed, true);
  const m = magic(); m.target.magicDefense = 255; assert.equal(runMagic(m).amount, 1);
  m.target.magicEvasion = 255; assert.equal(runMagic(m, [255]).missed, true);
});

test("protection arithmetic retains int32 quotient/remainder boundaries and rejects unsupported overflow", () => {
  assert.equal(physicalProtectionDamage(257), 170);
  assert.equal(physicalProtectionDamage(65537), 43520);
  assert.equal(physicalProtectionDamage(0x7fffffff), 1426063359);
  assert.equal(magicProtectionDamage(257), 171);
  for (const value of [-1, 0.1, NaN, Infinity, 0x80000000]) {
    assert.throws(() => physicalProtectionDamage(value), /Invalid/);
    assert.throws(() => magicProtectionDamage(value), /Invalid/);
  }
  assert.throws(() => magicProtectionDamage(0x7fffffff), /outside supported/);
});

test("invalid live magic condition types fail before consuming random state", () => {
  for (const type of [NaN, -1, 412.5, 0x80000000]) {
    const f = magic(); f.target.conditionTypes = [type];
    assert.throws(() => calculateMagic(f, () => assert.fail("Invalid input consumed RNG")), /Invalid magic condition/);
  }
});
