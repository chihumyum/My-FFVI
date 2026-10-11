import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceChanting,
  addAtbGauge,
  atbGaugeCanAdvance,
  battleClockGate,
  battleTimeScale,
  chantingSeconds,
  chantingTimeComplete,
  keyInputMenuWaiting,
  type BattleClockInput,
  type ChantingInput,
} from "../src/core/battle-timing.js";

function input(patch: Partial<ChantingInput> = {}): ChantingInput {
  return {
    actor: "player",
    firstAbility: { id: 1, typeId: 4, wait: 3 },
    command: { id: 1, referencedAbility: { id: 1, typeId: 4, wait: 3 } },
    agility: 40,
    conditionTypes: [],
    atbSpeed: 1,
    ...patch,
  };
}
function clock(patch: Partial<BattleClockInput> = {}): BattleClockInput {
  return {
    paused: false,
    helpPaused: false,
    progressEnabled: true,
    mode: "active",
    uiWaiting: false,
    forceWaiting: false,
    battleResult: 0,
    ...patch,
  };
}

test("chanting checks the first ability type for enemies but always evaluates players", () => {
  assert.equal(chantingSeconds(input()), 1.5);
  assert.equal(chantingSeconds(input({ actor: "enemy" })), 0);
  for (const typeId of [15, 16])
    assert.equal(
      chantingSeconds(
        input({ actor: "enemy", firstAbility: { id: 21, typeId, wait: 3 } }),
      ),
      1.5,
    );
  // Even the special command cannot turn an ordinary enemy ability into a charge.
  assert.equal(
    chantingSeconds(
      input({ actor: "enemy", command: { id: 12, referencedAbility: null } }),
    ),
    0,
  );
});

test("command ability reference replaces wait only for source type 623", () => {
  const firstAbility = { id: 99, typeId: 2, wait: 1 };
  assert.equal(
    chantingSeconds(
      input({
        firstAbility,
        command: {
          id: 14,
          referencedAbility: { id: 24, typeId: 623, wait: 3 },
        },
      }),
    ),
    1.5,
  );
  assert.equal(
    chantingSeconds(
      input({
        firstAbility,
        command: {
          id: 14,
          referencedAbility: { id: 24, typeId: 624, wait: 3 },
        },
      }),
    ),
    0.5,
  );
  assert.equal(chantingSeconds(input({ firstAbility, command: null })), 0.5);
});

test("null first ability is zero before the command override, including ordinary item actions", () => {
  assert.equal(
    chantingSeconds(
      input({
        firstAbility: null,
        command: { id: 3, referencedAbility: null },
      }),
    ),
    0,
  );
  assert.equal(
    chantingSeconds(
      input({
        firstAbility: null,
        command: {
          id: 14,
          referencedAbility: { id: 24, typeId: 623, wait: 3 },
        },
      }),
    ),
    1.5,
  );
  assert.equal(
    chantingSeconds(
      input({
        actor: "enemy",
        firstAbility: null,
        command: {
          id: 14,
          referencedAbility: { id: 24, typeId: 623, wait: 3 },
        },
      }),
    ),
    0,
  );
});

test("haste and slow use confirmed types; Killing Sword ignores both and agility", () => {
  assert.equal(chantingSeconds(input({ conditionTypes: [15] })), 0.75);
  assert.equal(chantingSeconds(input({ conditionTypes: [16] })), 3);
  assert.equal(chantingSeconds(input({ conditionTypes: [15, 16] })), 1.5);
  assert.equal(chantingSeconds(input({ conditionTypes: [15, 15] })), 0.75);
  for (const agility of [0, 255])
    for (const conditionTypes of [[], [15], [16], [15, 16]])
      assert.equal(
        chantingSeconds(
          input({
            agility,
            conditionTypes,
            command: { id: 12, referencedAbility: null },
            atbSpeed: 2,
          }),
        ),
        1.5,
      );
  // Ability identity 12 is not the special command identity 12.
  assert.equal(
    chantingSeconds(input({ firstAbility: { id: 12, typeId: 4, wait: 3 } })),
    1.5,
  );
});

test("charge arithmetic retains native float32 stages instead of integer milliseconds", () => {
  assert.equal(
    chantingSeconds(input({ agility: 31, atbSpeed: 1.3 })),
    1.3001084327697754,
  );
  assert.equal(
    chantingSeconds(
      input({
        agility: 255,
        atbSpeed: 3,
        conditionTypes: [16],
        firstAbility: { id: 22, typeId: 16, wait: 30 },
      }),
    ),
    2.711864471435547,
  );
  assert.equal(advanceChanting(0.005, 0.01, 1), -0.004999999888241291);
});

test("ATB speed divides initial charge and separately multiplies later countdown", () => {
  const initial = chantingSeconds(input({ atbSpeed: 2 }));
  assert.equal(initial, 0.75);
  assert.equal(advanceChanting(initial, 0.25, 2), 0.25);
  // Current speed is read each update; it is not captured with the initial wait.
  assert.equal(advanceChanting(initial, 0.25, 1), 0.5);
  assert.equal(advanceChanting(initial, 0.25, 0), initial);
});

test("150 fixed 10ms updates retain float remainder at the mathematical boundary", () => {
  let remaining = chantingSeconds(input());
  for (let n = 0; n < 150; n++) remaining = advanceChanting(remaining, 0.01, 1);
  assert.equal(remaining, 1.1473894119262695e-6);
  assert.equal(chantingTimeComplete(remaining), false);
  assert.equal(advanceChanting(remaining, 0.01, 1), -0.009998852387070656);
  assert.equal(chantingTimeComplete(advanceChanting(remaining, 0.01, 1)), true);
  assert.equal(chantingTimeComplete(0), true);
});

test("gauge eligibility uses action prohibition count and pre-increment threshold", () => {
  const base = { gauge: 99.5, actNotPossibleCounter: 0, notUpdateGauge: false };
  assert.equal(atbGaugeCanAdvance(base), true);
  assert.equal(
    atbGaugeCanAdvance({ ...base, actNotPossibleCounter: 1 }),
    false,
  );
  assert.equal(atbGaugeCanAdvance({ ...base, notUpdateGauge: true }), false);
  assert.equal(atbGaugeCanAdvance({ ...base, gauge: 100 }), false);
  assert.equal(addAtbGauge(base.gauge, 0.75), 100.25);
  assert.equal(atbGaugeCanAdvance({ ...base, gauge: 100.25 }), false);
  assert.equal(
    atbGaugeCanAdvance({ ...base, actNotPossibleCounter: -1 }),
    true,
  );
});

test("source KeyInput command selection keeps time, submenus wait, special inputs force wait", () => {
  assert.deepEqual(keyInputMenuWaiting(null), {
    uiWaiting: false,
    forceWaiting: false,
  });
  for (const state of [0, 1])
    assert.deepEqual(keyInputMenuWaiting(state), {
      uiWaiting: false,
      forceWaiting: false,
    });
  for (const state of [2, 3, 4, 5, 6, 7, 8])
    assert.deepEqual(keyInputMenuWaiting(state), {
      uiWaiting: true,
      forceWaiting: false,
    });
  for (const state of [9, 10])
    assert.deepEqual(keyInputMenuWaiting(state), {
      uiWaiting: false,
      forceWaiting: true,
    });
  assert.throws(() => keyInputMenuWaiting(11));
  assert.throws(() => keyInputMenuWaiting(-1));
});

test("FF6 progress gate separates waiting from simulation and condition result gating", () => {
  const rows: [Partial<BattleClockInput>, boolean[]][] = [
    [{}, [true, true, true]],
    [{ uiWaiting: true }, [true, true, true]],
    [{ mode: "wait" }, [true, true, true]],
    [{ mode: "wait", uiWaiting: true }, [true, false, false]],
    [{ forceWaiting: true }, [true, false, false]],
    [{ progressEnabled: false }, [true, false, false]],
    [{ battleResult: 3 }, [true, true, false]],
    [{ paused: true }, [false, false, false]],
    [{ helpPaused: true }, [false, false, false]],
  ];
  for (const [patch, expected] of rows) {
    const result = battleClockGate(clock(patch));
    assert.deepEqual(
      [result.simulation, result.progress, result.conditions],
      expected,
    );
  }
});

test("Unity option/auto time scale remains distinct from ATB speed", () => {
  const base = {
    paused: false,
    helpPaused: false,
    optionTimeScale: 2,
    auto: false,
  };
  assert.equal(battleTimeScale(base), 2);
  assert.equal(battleTimeScale({ ...base, auto: true }), 3);
  assert.equal(battleTimeScale({ ...base, auto: true, paused: true }), 0);
  assert.equal(battleTimeScale({ ...base, helpPaused: true }), 0);
});

test("unknown or nonfinite timing inputs fail before becoming silent defaults", () => {
  for (const atbSpeed of [0, -1, NaN, Infinity, 1e100])
    assert.throws(() => chantingSeconds(input({ atbSpeed })));
  assert.throws(() => chantingSeconds(input({ agility: 1.5 })));
  assert.throws(() =>
    chantingSeconds(input({ firstAbility: { id: 1, typeId: 4, wait: -1 } })),
  );
  assert.throws(() => chantingSeconds(input({ conditionTypes: [NaN] })));
  assert.throws(() => advanceChanting(0, -1, 1));
  assert.throws(() => advanceChanting(Infinity, 0, 1));
  assert.throws(() => chantingTimeComplete(NaN));
  assert.throws(() =>
    atbGaugeCanAdvance({
      gauge: 0,
      actNotPossibleCounter: 0.5,
      notUpdateGauge: false,
    }),
  );
  assert.throws(() => battleClockGate(clock({ mode: "unknown" as "active" })));
  assert.throws(() =>
    battleClockGate(clock({ uiWaiting: undefined as unknown as boolean })),
  );
  assert.throws(() =>
    battleTimeScale({
      paused: false,
      helpPaused: false,
      auto: false,
      optionTimeScale: -1,
    }),
  );
});
