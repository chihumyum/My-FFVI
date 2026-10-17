import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MAGIC_LEARNING_VALUE, parseBattleRewardPolicy, projectMagicLearningValue,
  type BattleRewardPolicy,
} from "../src/core/battle-result.js";
import { compileBattleRewardPolicy } from "../src/compiler/battle-result.js";

const policy = (magicPoints = 3): BattleRewardPolicy => ({ kind: "battle-reward-policy-v1", ap: 0, magicPoints });

test("reward parsing preserves party MagicPoint and returns detached content", () => {
  for (const amount of [0, 1, 10, 128, 0x7fffffff]) {
    const source = policy(amount), parsed = parseBattleRewardPolicy(source);
    assert.deepEqual(parsed, source);
    assert.notEqual(parsed, source);
    parsed.magicPoints = 99;
    assert.equal(source.magicPoints, amount);
    assert.deepEqual(parseBattleRewardPolicy(JSON.parse(JSON.stringify(source))), source);
  }
});

test("reward policy rejects missing, additional, inherited and accessor fields", () => {
  for (const raw of [null, [], {}, { kind: "battle-reward-policy-v1", ap: 0 },
    { ...policy(), kind: "other" }, { ...policy(), rewards: [] },
    Object.assign(Object.create(policy()), {}), Object.assign(policy(), { [Symbol("extra")]: true })])
    assert.throws(() => parseBattleRewardPolicy(raw), /Invalid battle reward policy/);
  let read = false;
  const accessor = { kind: "battle-reward-policy-v1", ap: 0,
    get magicPoints() { read = true; return 1; } };
  assert.throws(() => parseBattleRewardPolicy(accessor), /fields/);
  assert.equal(read, false);
});

test("ordinary policies do not silently discard nonzero AP", () => {
  assert.throws(() => parseBattleRewardPolicy({ ...policy(), ap: 1 }), /Nonzero AP/);
  assert.throws(() => compileBattleRewardPolicy({ getAp: 1, getValue: 0, battleFlags: [] }), /Nonzero AP/);
});

test("both reward integers reject coercion, fractions, negative and out-of-range input", () => {
  for (const field of ["ap", "magicPoints"])
    for (const value of [undefined, null, "0", true, -0, -1, 0.5, NaN, Infinity, 0x80000000])
      assert.throws(() => parseBattleRewardPolicy({ ...policy(), [field]: value }), /Invalid battle reward/);
});

test("each eligible member receives the full party value independently of EXP distribution", () => {
  assert.equal(MAX_MAGIC_LEARNING_VALUE, 128);
  const values = [0, 13, 80].map(value => projectMagicLearningValue(value, 9, true));
  assert.deepEqual(values, [9, 22, 89]);
  assert.equal(projectMagicLearningValue(7, 0, true), 7);
});

test("MagicLearningValue saturates at 128, independently from the learned skill threshold", () => {
  assert.equal(projectMagicLearningValue(98, 3, true), 101);
  assert.equal(projectMagicLearningValue(127, 1, true), 128);
  assert.equal(projectMagicLearningValue(127, 10, true), 128);
  assert.equal(projectMagicLearningValue(128, 10, true), 128);
  assert.equal(projectMagicLearningValue(0, 0x7fffffff, true), 128);
});

test("ineligible members keep their own value rather than receiving or resetting MagicPoint", () => {
  assert.equal(projectMagicLearningValue(0, 9, false), 0);
  assert.equal(projectMagicLearningValue(41, 9, false), 41);
  assert.equal(projectMagicLearningValue(128, 9, false), 128);
});

test("invalid owned values and rewards fail even on an ineligible projection", () => {
  for (const eligible of [true, false]) {
    for (const value of [-0, -1, 129, 0.5, NaN, Infinity])
      assert.throws(() => projectMagicLearningValue(value, 1, eligible), /owned magic learning value/);
    for (const reward of [-0, -1, 0.5, NaN, Infinity, 0x80000000])
      assert.throws(() => projectMagicLearningValue(0, reward, eligible), /magic points/);
  }
  assert.throws(() => projectMagicLearningValue(0, 1, 1 as unknown as boolean), /eligibility/);
});

test("source reward fields map directly without conflating AP and MagicPoint", () => {
  const source = { getAp: 0, getValue: 7, battleFlags: [14] }, before = structuredClone(source);
  assert.deepEqual(compileBattleRewardPolicy(source), policy(7));
  assert.deepEqual(source, before);
  assert.deepEqual(compileBattleRewardPolicy({ ...source, getValue: 0 }), policy(0));
});

test("unsupported held-state and reward flags block even when their numeric rewards are zero", () => {
  for (const flag of [3, 9, 10, 11, 12, 13])
    for (const getValue of [0, 1])
      assert.throws(() => compileBattleRewardPolicy({ getAp: 0, getValue, battleFlags: [14, flag] }),
        new RegExp(`reward flag ${flag} .*unimplemented`));
});

test("known non-reward flags are left to the runtime lifecycle gate, not silently executed", () => {
  for (const flag of [1, 2, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27])
    assert.deepEqual(compileBattleRewardPolicy({ getAp: 0, getValue: 1, battleFlags: [flag] }), policy(1));
});

test("reward compilation requires the exact source flag list and rejects unknown or malformed entries", () => {
  const invalid: unknown[] = [undefined, null, [0], [-1], [28], [1.5], [NaN], ["14"],
    new Array(1), Object.assign([14], { omitted: true })];
  let read = false;
  const getter = [14];
  Object.defineProperty(getter, 0, { enumerable: true, get() { read = true; return 14; } });
  invalid.push(getter);
  for (const battleFlags of invalid)
    assert.throws(() => compileBattleRewardPolicy({ getAp: 0, getValue: 1, battleFlags: battleFlags as number[] }));
  assert.equal(read, false);
  for (const getValue of [-1, 1.5, NaN, 0x80000000])
    assert.throws(() => compileBattleRewardPolicy({ getAp: 0, getValue, battleFlags: [] }));
});
