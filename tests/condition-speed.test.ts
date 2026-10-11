import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceSlowClocks, conditionAtbSpeedPercent, conditionChantingModifier,
  conditionProgressCycleSeconds, reconcileSlowClocks, validateSpeedBehavior,
  type SlowState, type SpeedBehavior,
} from "../src/core/condition-speed.js";
import { compileSpeedBehavior, hasSpeedBehavior } from "../src/compiler/condition-speed.js";
import { atbIncrement } from "../src/core/atb.js";
import { advanceChanting, chantingSeconds } from "../src/core/battle-timing.js";
import { advancePoisonClocks, reconcilePoisonClocks } from "../src/core/condition-poison.js";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { compileFieldConditionCatalog } from "../src/compiler/field-conditions.js";
import { FieldConditions } from "../src/core/field-conditions.js";
import { compileDevelopmentAbility } from "../src/compiler/ability.js";
import { projectActionTarget, type ActionParticipant } from "../src/core/action-effects.js";
import { conditionSpeedAbilityFixture, conditionSpeedFixture } from "./fixtures/condition-speed.js";

const behaviors: SpeedBehavior[] = [
  { id: 121, kind: "haste", name: "Haste", untilType: 2, speedDelta: 50 },
  { id: 125, kind: "slow", name: "Slow", untilType: 2, speedDelta: -50 },
];
const noRng = () => assert.fail("Unexpected random draw");
const ordinaryHit = { accuracy: 100, magicEvasion: 0, fixed: false };

test("ordinary speed providers compile the source rate integer with its distinct sign", () => {
  const f = conditionSpeedFixture();
  assert.deepEqual(compileSpeedBehavior({ values: f.haste }, (key) => key),
    { ...behaviors[0], name: "STATE_121" });
  assert.deepEqual(compileSpeedBehavior({ values: f.slow }, (key) => key),
    { ...behaviors[1], name: "STATE_125" });
  assert.equal(compileSpeedBehavior({ values: f.special }, String), null);
  assert.equal(compileSpeedBehavior({ values: f.stop }, String), null);
  const changed = compileSpeedBehavior({ values: { ...f.slow, rate_value1: "37" } }, String)!;
  assert.equal(changed.speedDelta, -37);
  assert.equal(conditionAtbSpeedPercent([changed], [125]), 63);
});

test("speed compiler rejects missing lifecycle, stacking and secondary provider closure", () => {
  const f = conditionSpeedFixture();
  for (const row of [f.haste, f.slow]) {
    for (const key of ["until_value", "overlapped_type", "invalid_type", "target_type", "condition_group_id",
      "parameter_group_id", "attribute_group_id", "species_group_id", "rate_type2", "rate_value2",
      "recovery_invalid", "attack_target", "game_over_target", "state_cover_unavailable", "damage_number",
      "field_se_asset_id", "icon_id"])
      assert.equal(hasSpeedBehavior({ values: { ...row, [key]: "1" } }), false, key);
    for (const [key, value] of [["until_type", "3"], ["system_type", "1"], ["condition_type", "17"],
      ["resistance_decision", "0"], ["rate_type1", "1"], ["rate_value1", "0"], ["rate_value1", "-50"],
      ["rate_value1", "2147483648"], ["battle_effect_asset_id", "0"], ["battle_effect_shadow_cloning", "0"]])
      assert.equal(hasSpeedBehavior({ values: { ...row, [key!]: value! } }), false, key);
  }
  for (const mes_id_name of ["", "None"])
    assert.throws(() => compileSpeedBehavior({ values: { ...f.haste, mes_id_name } }, String), /Missing/);
  assert.throws(() => compileSpeedBehavior({ values: f.haste }, () => ""), /behavior/);
});

test("ATB sums signed providers and leaves the source limits to meter arithmetic", () => {
  assert.equal(conditionAtbSpeedPercent(behaviors, []), 100);
  assert.equal(conditionAtbSpeedPercent(behaviors, [53, 121]), 150);
  assert.equal(conditionAtbSpeedPercent(behaviors, [125, 53]), 50);
  assert.equal(conditionAtbSpeedPercent(behaviors, [125, 121]), 100);
  const extra = { ...behaviors[0]!, id: 221 };
  assert.equal(conditionAtbSpeedPercent([...behaviors, extra], [121, 221]), 200);
  const rules = { coefficient: 30, enemyCoefficient: 15, total: 100, maxHighSpeed: 60, maxLowSpeed: 30 };
  const input = { agility: 30, weight: 0, enemy: false, battleSpeed: 1, seconds: 1 };
  assert.equal(atbIncrement(rules, { ...input, speedPercent: 200 }), 96);
  assert.equal(atbIncrement(rules, { ...input, speedPercent: 50 }), 42);
});

test("ATB additive, chanting presence and periodic priority remain separate algorithms", () => {
  assert.equal(conditionChantingModifier([]), 1);
  assert.equal(conditionChantingModifier([15]), 2);
  assert.equal(conditionChantingModifier([16]), 0.5);
  assert.equal(conditionChantingModifier([15, 15, 16]), 1);
  assert.equal(conditionProgressCycleSeconds([], 1), 16);
  assert.equal(conditionProgressCycleSeconds([15], 1), 8);
  assert.equal(conditionProgressCycleSeconds([16], 1), 32);
  assert.equal(conditionProgressCycleSeconds([16, 15], 1), 8);
  assert.equal(conditionProgressCycleSeconds([16, 16], 3), Math.fround(32 / 3));
  // Type queries are not active admission; this does not implement Stop.
  assert.equal(conditionProgressCycleSeconds([17], 1), 16);
});

test("chanting stores the status projection once and KillingSword ignores it", () => {
  const input = { actor: "player" as const, firstAbility: { id: 701, typeId: 1, wait: 5 },
    command: { id: 1, referencedAbility: null }, agility: 40, atbSpeed: 1 };
  assert.equal(chantingSeconds({ ...input, conditionTypes: [] }), 2.5);
  assert.equal(chantingSeconds({ ...input, conditionTypes: [15] }), 1.25);
  assert.equal(chantingSeconds({ ...input, conditionTypes: [16] }), 5);
  const initial = chantingSeconds({ ...input, conditionTypes: [16] });
  // UpdateChantTime does not receive the current status types.
  assert.equal(advanceChanting(initial, 0.25, 1), 4.75);
  assert.equal(chantingSeconds({ ...input, command: { id: 12, referencedAbility: null }, conditionTypes: [15] }), 5);
  assert.equal(chantingSeconds({ ...input, actor: "enemy", conditionTypes: [15] }), 0);
});

test("slow state follows native delta only and ordinary until2 has no automatic timeout", () => {
  const initial = reconcileSlowClocks(behaviors, [121, 125], []);
  assert.deepEqual(initial, [{ conditionId: 125, elapsedSeconds: 0 }]);
  const first = advanceSlowClocks(behaviors, [125], initial, 0.1);
  const second = advanceSlowClocks(behaviors, [125], first, 0.2);
  assert.equal(second[0]!.elapsedSeconds, Math.fround(Math.fround(0.1) + Math.fround(0.2)));
  assert.equal(advanceSlowClocks(behaviors, [125], initial, 100000)[0]!.elapsedSeconds, 100000);
  assert.deepEqual(reconcileSlowClocks(behaviors, [125], second), second);
  assert.deepEqual(reconcileSlowClocks(behaviors, [121], second), []);
  assert.deepEqual(reconcileSlowClocks(behaviors, [125], []), initial);
});

test("slow clock projections cannot mutate their input or silently restart missing state", () => {
  const state: SlowState = [{ conditionId: 125, elapsedSeconds: 0.5 }];
  Object.freeze(state[0]); Object.freeze(state);
  const advanced = advanceSlowClocks(behaviors, [125], state, 0.5);
  assert.deepEqual(state, [{ conditionId: 125, elapsedSeconds: 0.5 }]);
  assert.notEqual(advanced[0], state[0]);
  assert.notEqual(reconcileSlowClocks(behaviors, [125], state)[0], state[0]);
  assert.throws(() => advanceSlowClocks(behaviors, [125], [], 1), /reconciliation/);
  assert.throws(() => advanceSlowClocks(behaviors, [], state, 1), /reconciliation/);
  assert.throws(() => reconcileSlowClocks(behaviors, [125, 125], state), /Duplicate active/);
  for (const elapsedSeconds of [-1, NaN, Infinity, 0.1])
    assert.throws(() => reconcileSlowClocks(behaviors, [125], [{ conditionId: 125, elapsedSeconds }]), /clock state/);
  assert.throws(() => reconcileSlowClocks(behaviors, [], [{ conditionId: 121, elapsedSeconds: 0 }]), /clock state/);
  assert.throws(() => reconcileSlowClocks(behaviors, [], [...state, ...state]), /clock state/);
  assert.throws(() => reconcileSlowClocks(behaviors, [], [{ ...state[0]!, extra: 0 } as SlowState[number]]), /clock state/);
  for (const seconds of [-1, NaN, Infinity, 1e100])
    assert.throws(() => advanceSlowClocks(behaviors, [125], state, seconds), /clock update/);
  assert.throws(() => advanceSlowClocks(behaviors, [125], [{ conditionId: 125, elapsedSeconds: Math.fround(3e38) }], 3e38), /overflow/);
});

test("speed arithmetic rejects unresolved or nonnative inputs before publishing a projection", () => {
  for (const behavior of [
    { ...behaviors[0]!, speedDelta: -50 }, { ...behaviors[1]!, speedDelta: 50 },
    { ...behaviors[0]!, speedDelta: 0 }, { ...behaviors[0]!, speedDelta: 0.5 },
    { ...behaviors[0]!, untilType: 3 }, { ...behaviors[0]!, id: 0 },
  ]) assert.throws(() => validateSpeedBehavior(behavior as SpeedBehavior), /speed condition/);
  assert.throws(() => conditionAtbSpeedPercent([behaviors[0]!, behaviors[0]!], []), /Duplicate/);
  assert.throws(() => conditionAtbSpeedPercent([{ ...behaviors[0]!, speedDelta: 0x7fffffff }], [121]), /overflow/);
  for (const types of [[-1], [0.1], [NaN], [0x80000000]]) {
    assert.throws(() => conditionChantingModifier(types), /condition type/);
    assert.throws(() => conditionProgressCycleSeconds(types, 1), /condition type/);
  }
  for (const speed of [0, -1, NaN, Infinity, Number.MIN_VALUE, 1e100])
    assert.throws(() => conditionProgressCycleSeconds([15], speed), /ATB speed/);
});

test("poison samples speed types only when creating or completing a cached interval", () => {
  const poison = [{ id: 110, hpDivisor: 16 }];
  const neutral = reconcilePoisonClocks(poison, [110], [], 1, [10]);
  assert.equal(neutral[0]!.thresholdSeconds, 8);
  assert.equal(reconcilePoisonClocks(poison, [110, 121], [], 1, [10, 15])[0]!.thresholdSeconds, 4);
  assert.equal(reconcilePoisonClocks(poison, [110, 125], [], 1, [10, 16])[0]!.thresholdSeconds, 16);
  const input = { conditionIds: [110, 121], state: neutral, hp: 160, maxHp: 160,
    elementResistances: {}, seconds: 7, atbSpeed: 1, isTimeStopped: false };
  const first = advancePoisonClocks(poison, input, [10, 15]);
  assert.equal(first.ticks.length, 0);
  assert.deepEqual(reconcilePoisonClocks(poison, [110, 125], first.state, 1, [10, 16]), first.state);
  const second = advancePoisonClocks(poison, { ...input, state: first.state, seconds: 1 }, [10, 16]);
  assert.equal(second.hp, 150);
  assert.equal(second.state[0]!.thresholdSeconds, 32);
  const third = advancePoisonClocks(poison, { ...input, state: second.state, hp: second.hp, seconds: 50 }, [10, 15]);
  assert.equal(third.ticks.length, 1);
  assert.equal(third.state[0]!.thresholdSeconds, 8);
  assert.equal(third.state[0]!.elapsedSeconds, 0);
  const frozen = advancePoisonClocks(poison, { ...input, seconds: 50, isTimeStopped: true }, [10, 15]);
  assert.deepEqual(frozen.state, neutral);
});

test("compiled speed lifecycle retains hit and replacement rules, clears at death and battle end", () => {
  const f = conditionSpeedFixture(), engine = new BattleConditions(f.compile().catalog);
  const haste = engine.add([53], {}, 121, ordinaryHit, () => 0);
  assert.deepEqual(haste.currentIds, [53, 121]);
  assert.equal(engine.add(haste.currentIds, {}, 121, ordinaryHit, noRng).missed, true);
  const slow = engine.add(haste.currentIds, {}, 125, ordinaryHit, () => 0);
  assert.deepEqual(slow, { currentIds: [53, 125], added: [125], removed: [121], missed: false });
  const back = engine.add(slow.currentIds, {}, 121, ordinaryHit, () => 0);
  assert.deepEqual(back.currentIds, [53, 121]);
  assert.deepEqual(engine.recover(back.currentIds, [121]).currentIds, [53]);
  assert.deepEqual(engine.settleLife(0, slow.currentIds, false).conditionIds, [53, 5]);
  assert.deepEqual(engine.battleEnd(slow.currentIds), [53]);
  assert.deepEqual(engine.admitAtbAction(back.currentIds, [{ id: 700, type: 1 }]), back.currentIds);
  for (const value of [0, 1, 2])
    assert.equal(engine.add([53], { 125: value }, 125, ordinaryHit, noRng).missed, true);
  assert.equal(engine.add([53], {}, 125, { ...ordinaryHit, magicEvasion: 128 }, () => 0).missed, true);
});

test("speed states do not admit special group providers, Stop or field persistence", () => {
  const f = conditionSpeedFixture(), { catalog } = f.compile(), engine = new BattleConditions(catalog);
  for (const id of [195, 117]) assert.throws(() => engine.validateActive([id]), /Unimplemented active/);
  const field = new FieldConditions(compileFieldConditionCatalog(f.reader(), catalog, [106]).catalog);
  for (const id of [121, 125, 195, 117]) assert.throws(() => field.validateActive([id]), /Unimplemented active field/);
  assert.deepEqual(engine.types([121, 125]), [15, 16]);
  assert.equal(engine.reconcilePoisonState([110, 121], [], 1)[0]!.thresholdSeconds, 4);
  assert.equal(engine.reconcilePoisonState([110, 125], [], 1)[0]!.thresholdSeconds, 16);
});

test("ordinary Haste and Slow spell programs preserve flag1, flag3 and distinct target defaults", () => {
  const participant: ActionParticipant = { id: "caster", side: "player", level: 10, attack: 0, magic: 20,
    attackElements: [], defense: 20, magicDefense: 20, evasion: 0, magicEvasion: 255,
    hp: 800, maxHp: 800, mp: 50, maxMp: 50, conditionIds: [], conditionResistances: {}, elementResistances: {} };
  for (const kind of ["haste", "slow"] as const) {
    const f = conditionSpeedAbilityFixture(kind), d = compileDevelopmentAbility(f.reader(), 801, "Synthetic speed");
    const id = kind === "haste" ? 121 : 125;
    assert.deepEqual(d.blockers, []);
    assert.deepEqual(d.plan!.effects, [{ slot: 1, kind: "add-condition", conditionId: id, fixedHit: false,
      accuracy: kind === "haste" ? 255 : 120 }]);
    assert.equal(d.plan!.targeting.defaultRelation, kind === "haste" ? "ally" : "enemy");
    assert.ok(d.limitations.some((text) => text.includes("Runic")));
    const conditions = new BattleConditions(f.compile().catalog);
    const target = { ...participant, id: "target" };
    const result = projectActionTarget(d.plan!, d.power, participant, target, conditions, kind === "haste" ? noRng : () => 0, 1);
    assert.deepEqual(result.state.conditionIds, kind === "haste" ? [121] : []);
    const hit = projectActionTarget(d.plan!, d.power, participant, { ...target, magicEvasion: 0 }, conditions, () => 0, 1);
    assert.deepEqual(hit.state.conditionIds, [id]);
    assert.equal(projectActionTarget(d.plan!, d.power, participant,
      { ...target, conditionResistances: { [id]: 0 } }, conditions, noRng, 1).effects[0]!.missed, true);
  }
});

test("speed ability admission does not widen special types, level fees, flags or composition", () => {
  for (const kind of ["haste", "slow"] as const) {
    for (const mutation of ["special-type", "wrong-system", "level-fee", "special-provider", "flag4", "composition"] as const) {
      const f = conditionSpeedAbilityFixture(kind);
      if (mutation === "special-type") f.ability.type_id = "637";
      if (mutation === "wrong-system") f.ability.system_id = kind === "haste" ? "5" : "2";
      if (mutation === "level-fee") f.ability.ability_lv = "1";
      if (mutation === "special-provider") f.group.function1_value1 = "195";
      if (mutation === "flag4") f.tables["content_flag_group.csv"]!.push({ id: "3", group_id: "91", content_flag_id: "4" });
      if (mutation === "composition") Object.assign(f.group, { function2_id: "501", function2_value1: "121" });
      const d = compileDevelopmentAbility(f.reader(), 801, "Unadmitted speed");
      assert.equal(d.plan, null, `${kind}/${mutation}`); assert.ok(d.blockers.length);
    }
    const f = conditionSpeedAbilityFixture(kind);
    f.ability.type_id = "3"; f.ability.content_flag_group_id = "0";
    assert.deepEqual(compileDevelopmentAbility(f.reader(), 801, "Synthetic enemy speed").blockers, []);
  }
});
