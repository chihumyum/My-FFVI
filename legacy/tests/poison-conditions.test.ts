import test from "node:test";
import assert from "node:assert/strict";
import {
  BattleConditions,
  type BattleConditionCatalog,
  type PoisonState,
} from "../src/core/battle-conditions.js";
import { type PoisonAdvanceInput } from "../src/core/condition-poison.js";
import { hasPoisonBehavior } from "../src/compiler/conditions.js";
import type { BattleRow } from "../src/compiler/battle.js";

// Deliberately use row identities distinct from their condition types.
const catalog: BattleConditionCatalog = {
  hpZeroConditionId: 505,
  dying: { conditionId: 504, thresholdDivisor: 8 },
  rules: {
    definitions: [
      { id: 504, type: 4, overlapped: false, eraseGroupId: 1 },
      { id: 505, type: 5, overlapped: false, eraseGroupId: 3 },
      { id: 506, type: 6, overlapped: false, eraseGroupId: 1 },
      { id: 510, type: 10, overlapped: false, eraseGroupId: 1 },
      { id: 588, type: 10, overlapped: false, eraseGroupId: 1 },
      { id: 515, type: 15, overlapped: false, eraseGroupId: 1 },
      { id: 516, type: 16, overlapped: false, eraseGroupId: 1 },
    ],
    eraseRules: [
      { id: 1, groupId: 1, type: 2, conditionId: 0, eraseConditionId: 0 },
      { id: 3, groupId: 3, type: 1, conditionId: 505, eraseConditionId: 0 },
    ],
  },
  behaviors: [
    { id: 504, kind: "dying", name: "Dying", untilType: 3 },
    { id: 505, kind: "unable-fight", name: "Fallen", untilType: 3 },
    { id: 506, kind: "silence", name: "Silence", untilType: 2 },
    { id: 510, kind: "poison", name: "Poison", untilType: 3, hpDivisor: 16 },
  ],
};
const conditions = () => new BattleConditions(catalog);
const initial = (): PoisonState => [
  { conditionId: 510, elapsedSeconds: 0, thresholdSeconds: 8, isTimeStop: false },
];
function update(patch: Partial<PoisonAdvanceInput> = {}) {
  return conditions().advancePoison({
    conditionIds: [510],
    state: initial(),
    hp: 160,
    maxHp: 160,
    elementResistances: {},
    seconds: 8,
    atbSpeed: 1,
    isTimeStopped: false,
    ...patch,
  });
}

test("poison starts at half-cycle and repeats fixed damage on full cycles", () => {
  const engine = conditions();
  const state = engine.reconcilePoisonState([506, 510], [], 1);
  assert.deepEqual(state, initial());
  const before = update({ state, seconds: 7 });
  assert.equal(before.hp, 160);
  assert.deepEqual(before.ticks, []);
  const first = update({ state: before.state, seconds: 1 });
  assert.equal(first.hp, 150);
  assert.deepEqual(first.state, [
    { conditionId: 510, elapsedSeconds: 0, thresholdSeconds: 16, isTimeStop: false },
  ]);
  const second = update({ state: first.state, hp: first.hp, seconds: 16 });
  assert.equal(second.hp, 140);
  assert.deepEqual(
    second.ticks.map((t) => t.amount),
    [10],
  );
  assert.deepEqual(engine.types([506, 510]), [6, 10]);
  assert.deepEqual(engine.poisonIds([506, 510]), [510]);
});

test("clock reconciliation preserves progress and cure followed by re-add starts fresh", () => {
  const engine = conditions();
  const state = update({ seconds: 3 }).state;
  assert.deepEqual(engine.reconcilePoisonState([510, 506], state, 2), state);
  const cure = engine.recover([506, 510], [510]);
  assert.deepEqual(engine.reconcilePoisonState(cure.currentIds, state, 2), []);
  const added = engine.add(
    cure.currentIds,
    {},
    510,
    { accuracy: 255, magicEvasion: 0, fixed: true },
    () => assert.fail("Fixed poison must not draw RNG"),
  );
  assert.deepEqual(engine.reconcilePoisonState(added.currentIds, [], 2), [
    { conditionId: 510, elapsedSeconds: 0, thresholdSeconds: 4, isTimeStop: false },
  ]);
  assert.equal(
    engine.add(
      added.currentIds,
      {},
      510,
      { accuracy: 255, magicEvasion: 0, fixed: true },
      () => assert.fail("Duplicate poison must not draw RNG"),
    ).missed,
    true,
  );
});

test("one native update discards overshoot and never batches repeated ticks", () => {
  const result = update({ seconds: 100 });
  assert.equal(result.hp, 150);
  assert.equal(result.ticks.length, 1);
  assert.equal(result.state[0]!.elapsedSeconds, 0);
  assert.equal(update({ state: result.state, seconds: 15 }).ticks.length, 0);
});

test("speed changes affect only a newly initialized or completed cycle", () => {
  const result = update({ seconds: 7, atbSpeed: 2 });
  assert.equal(result.ticks.length, 0);
  assert.equal(result.state[0]!.thresholdSeconds, 8);
  const tick = update({ state: result.state, seconds: 1, atbSpeed: 2 });
  assert.equal(tick.state[0]!.thresholdSeconds, 8);
  const fractional = conditions().reconcilePoisonState([510], [], 3);
  assert.equal(
    fractional[0]!.thresholdSeconds,
    Math.fround(Math.fround(16 / 3) * 0.5),
  );
});

test("time stop retains progress; elapsed accumulation uses native float32", () => {
  const state = update({ seconds: 0.1 }).state;
  assert.equal(state[0]!.elapsedSeconds, Math.fround(0.1));
  const frozen = update({ state, seconds: 100, isTimeStopped: true });
  assert.deepEqual(frozen.state, state);
  assert.equal(frozen.hp, 160);
  assert.deepEqual(frozen.ticks, []);
  const resumed = update({ state, seconds: 0.2 });
  assert.equal(
    resumed.state[0]!.elapsedSeconds,
    Math.fround(Math.fround(0.1) + Math.fround(0.2)),
  );
});

test("damage floors max HP ratio, does not use remaining HP or escalating count", () => {
  const result = update({ hp: 70, maxHp: 159 });
  assert.equal(result.hp, 61);
  assert.equal(result.ticks[0]!.amount, 9);
  assert.equal(update({ hp: 15, maxHp: 15 }).ticks[0]!.amount, 0);
  assert.equal(update({ hp: 9, maxHp: 159 }).hp, 0);
});

test("poison affinity handles weakness, half minimum, immunity and living absorption", () => {
  assert.equal(update({ elementResistances: { 6: 1 } }).hp, 140);
  assert.equal(
    update({ hp: 159, maxHp: 159, elementResistances: { 6: 2 } }).hp,
    155,
  );
  assert.equal(
    update({ hp: 15, maxHp: 15, elementResistances: { 6: 2 } }).hp,
    14,
  );
  const immune = update({ elementResistances: { 6: 3 } });
  assert.equal(immune.hp, 160);
  assert.equal(immune.ticks[0]!.amount, 0);
  assert.equal(immune.state[0]!.thresholdSeconds, 16);
  const absorb = update({ hp: 155, elementResistances: { 6: 4 } });
  assert.deepEqual(absorb.ticks, [
    {
      conditionId: 510,
      amount: 10,
      recovery: true,
      hpBefore: 155,
      hpAfter: 160,
    },
  ]);
  const dead = update({ hp: 0, elementResistances: { 6: 4 } });
  assert.equal(dead.hp, 0);
  assert.deepEqual(dead.ticks, []);
  assert.equal(dead.state[0]!.thresholdSeconds, 16);
  assert.equal(update({ elementResistances: { 1: 4 } }).hp, 150);
});

test("lethal poison settles through normal death conflicts and drops its runtime clock", () => {
  const engine = conditions();
  const result = update({ hp: 5 });
  const settled = engine.settleLife(result.hp, [504, 510], false);
  assert.deepEqual(settled, { hp: 0, conditionIds: [505] });
  assert.deepEqual(
    engine.reconcilePoisonState(settled.conditionIds, result.state, 1),
    [],
  );
  assert.deepEqual(engine.battleEnd([506, 510]), [510]);
  const saved = JSON.parse(
    JSON.stringify({ conditionIds: engine.battleEnd([510]) }),
  );
  assert.deepEqual(
    engine.reconcilePoisonState(saved.conditionIds, [], 1),
    initial(),
  );
});

test("projected updates and reconciliation do not mutate caller-owned state", () => {
  const state = initial();
  Object.freeze(state[0]);
  Object.freeze(state);
  const result = update({ state });
  assert.deepEqual(state, initial());
  result.state[0]!.elapsedSeconds = 4;
  assert.deepEqual(state, initial());
  const continued = conditions().reconcilePoisonState([510], state, 1);
  assert.notEqual(continued[0], state[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(continued)), initial());
});

test("missing, extra, repeated and unknown clocks cannot silently restart progress", () => {
  assert.throws(() => update({ state: [] }), /reconciliation/);
  assert.throws(() => update({ conditionIds: [] }), /reconciliation/);
  assert.throws(
    () => update({ state: [...initial(), ...initial()] }),
    /clock state/,
  );
  assert.throws(() => update({ conditionIds: [510, 510] }), /Duplicate active/);
  assert.throws(
    () => update({ state: [{ ...initial()[0]!, conditionId: 588 }] }),
    /clock state/,
  );
  assert.throws(() => update({ conditionIds: [588] }), /Unimplemented active/);
  assert.throws(
    () => update({ conditionIds: [510, 515] }),
    /Unimplemented active/,
  );
  assert.throws(
    () => update({ conditionIds: [510, 516] }),
    /Unimplemented active/,
  );
  assert.throws(() => conditions().types([999]), /Unknown/);
});

test("serialized clock fields, HP, delta and native arithmetic must remain representable", () => {
  for (const thresholdSeconds of [0, -1, NaN, Infinity, 0.1])
    assert.throws(
      () => update({ state: [{ ...initial()[0]!, thresholdSeconds }] }),
      /clock state/,
    );
  for (const elapsedSeconds of [-1, NaN, Infinity, 8, 0.1])
    assert.throws(
      () => update({ state: [{ ...initial()[0]!, elapsedSeconds }] }),
      /clock state/,
    );
  assert.throws(
    () =>
      update({
        state: [{ ...initial()[0]!, extra: 1 } as PoisonState[number]],
      }),
    /clock state/,
  );
  for (const atbSpeed of [0, -1, NaN, Infinity, Number.MIN_VALUE, 1e100])
    assert.throws(() => update({ atbSpeed }), /ATB speed/);
  for (const seconds of [-1, NaN, Infinity, 1e100])
    assert.throws(() => update({ seconds }), /clock update/);
  for (const hp of [-1, 0.5, 161])
    assert.throws(() => update({ hp }), /poison HP/);
  assert.throws(
    () =>
      update({
        hp: 0x7fffffff,
        maxHp: 0x7fffffff,
        elementResistances: { 6: 4 },
      }),
    /overflow/,
  );
  assert.throws(
    () => update({ elementResistances: { 6: 0 } as never }),
    /resistance/,
  );
});

test("behavior identity and divisor validation excludes unsupported timer providers", () => {
  const invalid = structuredClone(catalog);
  invalid.behaviors.push({
    id: 588,
    kind: "poison",
    name: "Invalid",
    untilType: 3,
    hpDivisor: 0,
  });
  assert.throws(() => new BattleConditions(invalid), /Unsupported/);
  const wrong = structuredClone(catalog);
  wrong.rules.definitions.find((d) => d.id === 510)!.overlapped = true;
  assert.throws(() => new BattleConditions(wrong), /Unsupported/);
});

test("poison compiler admits the proven field closure and blocks alternate providers", () => {
  const values: Record<string, string> = {
    id: "510",
    condition_type: "10",
    system_type: "1",
    resistance_decision: "1",
    until_type: "3",
    rate_type1: "3",
    rate_value1: "16",
    damage_number: "32",
  };
  const unsupported = [
    "until_value",
    "overlapped_type",
    "invalid_type",
    "target_type",
    "condition_group_id",
    "parameter_group_id",
    "attribute_group_id",
    "species_group_id",
    "rate_type2",
    "rate_value2",
    "recovery_invalid",
    "attack_target",
    "game_over_target",
    "state_cover_unavailable",
  ];
  for (const key of unsupported) values[key] = "0";
  const row = { values } as BattleRow;
  assert.equal(hasPoisonBehavior(row), true);
  for (const key of unsupported)
    assert.equal(
      hasPoisonBehavior({ ...row, values: { ...values, [key]: "1" } }),
      false,
      key,
    );
  for (const [key, value] of [
    ["rate_type1", "2"],
    ["rate_value1", "0"],
    ["until_type", "2"],
    ["condition_type", "88"],
    ["damage_number", "0"],
  ])
    assert.equal(
      hasPoisonBehavior({ ...row, values: { ...values, [key!]: value! } }),
      false,
      key,
    );
});
