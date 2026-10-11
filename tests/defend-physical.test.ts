import test from "node:test";
import assert from "node:assert/strict";
import { calculatePhysical, type PhysicalInput } from "../src/core/physical.js";
import { calculateMagic, type MagicInput } from "../src/core/magic.js";

const input = (): PhysicalInput => ({
  rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] }, power: 0,
  actor: { side: "player", level: 10, attackElements: [], attack: 40, strength: 30, accuracy: 100, criticalRate: 3 },
  target: { side: "enemy", defense: 64, evasion: 0, elementResistances: {}, conditionTypes: [1] }, targetCount: 1,
});
function run(value: PhysicalInput, draws = [31, 0, 99]) {
  const remaining = [...draws], ranges: number[][] = [];
  const result = calculatePhysical(value, (min, max) => {
    ranges.push([min, max]); assert.ok(remaining.length, "Unexpected draw"); return remaining.shift()!;
  });
  assert.equal(remaining.length, 0);
  return { ...result, ranges };
}
test("Defend halves after defense with truncation before critical", () => {
  // Base98 -> high variance97 -> defense73 -> Defend36 -> critical72.
  assert.equal(run(input()).amount, 36);
  assert.equal(run(input(), [31, 0, 0]).amount, 72);
  const baseline = input(); baseline.target.conditionTypes = [];
  assert.equal(run(baseline, [31, 0, 0]).amount, 146);
  assert.deepEqual(run(input()).ranges, [[0, 31], [0, 255], [0, 99]]);
});
test("Defend inside the defense branch is bypassed by source content flag5", () => {
  const f = input(); f.rules.contentFlags = [5]; f.target.side = "player";
  assert.equal(run(f).amount, 97);
  assert.equal(run(f, [31, 0, 0]).amount, 194);
});
test("Defend precedes friendly-fire rounding, elements and multiple-target correction", () => {
  const f = input(); f.target.side = "player";
  assert.equal(run(f).amount, 18);
  f.target.side = "enemy"; f.actor.attackElements = [1]; f.target.elementResistances = { 1: 4 };
  assert.equal(run(f, [31, 0, 0]).amount, -72);
  f.targetCount = 3;
  assert.equal(run(f, [31, 0, 0]).amount, -72);
  f.target.elementResistances = { 1: 1 };
  assert.equal(run(f).amount, 36);
});
test("Defend does not force minimum damage or consume an extra random value", () => {
  const f = input(); f.actor.level = 0; f.actor.attack = 0;
  assert.equal(run(f).amount, 0); // defense +1, then truncate(1/2).
  f.targetCount = 2; assert.equal(run(f).amount, 0);
  f.target.evasion = 255;
  assert.deepEqual(run(f, [31, 255]), { amount: 0, missed: true, critical: false, ranges: [[0, 31], [0, 255]] });
});
test("physical state uses condition types, validates them before RNG, and supports absent legacy input", () => {
  const f = input(); f.target.conditionTypes = [901];
  assert.equal(run(f).amount, 73);
  delete f.target.conditionTypes;
  assert.equal(run(f).amount, 73);
  for (const type of [NaN, -1, 1.1, 0x80000000]) {
    f.target.conditionTypes = [type];
    assert.throws(() => calculatePhysical(f, () => assert.fail("Invalid input consumed RNG")), /Invalid physical condition/);
  }
});
test("Defend does not add a numerical modifier to ordinary magic", () => {
  const f: MagicInput = { rules: { accuracy: 100, contentFlags: [], elements: [], forceDefense: false },
    power: 30, actor: { side: "player", level: 10, magic: 20 },
    target: { side: "enemy", magicDefense: 64, magicEvasion: 0, elementResistances: {} },
    recovery: false, targetCount: 1 };
  const target = { ...f.target, conditionTypes: [1] };
  const draws = [0, 31];
  assert.deepEqual(calculateMagic({ ...f, target }, () => draws.shift()!), { amount: 229, missed: false });
  assert.equal(draws.length, 0);
});
