import test from "node:test";
import assert from "node:assert/strict";
import { physicalAccuracyWithBlind, projectBlindEffectVisible, validateBlindBehavior, type BlindBehavior } from "../src/core/condition-blind.js";
import { compileBlindBehavior, compileBlindPresentation, hasBlindBehavior } from "../src/compiler/condition-blind.js";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { compileFieldConditionCatalog } from "../src/compiler/field-conditions.js";
import { FieldConditions } from "../src/core/field-conditions.js";
import { compileDevelopmentAbility } from "../src/compiler/ability.js";
import { projectActionTarget, type ActionParticipant } from "../src/core/action-effects.js";
import { calculatePhysical } from "../src/core/physical.js";
import { calculateMagic, type MagicInput } from "../src/core/magic.js";
import { magicAccuracyHit, targetConditionAccuracy } from "../src/core/battle-hit.js";
import { rowPhysicalInput } from "./fixtures/battle-row.js";
import { fixture as battleFixture } from "./fixtures/battle-content.js";
import { conditionBlindAbilityFixture, conditionBlindFixture } from "./fixtures/condition-blind.js";

const noRng = () => assert.fail("Unexpected random draw");
const normalHit = { accuracy: 100, magicEvasion: 0, fixed: false };
const behavior: BlindBehavior = { id: 109, kind: "blind", name: "STATE_BLIND", untilType: 3, effectAssetId: 870, iconId: 71 };
const participant: ActionParticipant = { id: "caster", side: "player", level: 10, attack: 40, magic: 20,
  physical: { attack: 40, strength: 30, accuracy: 100, criticalRate: 3 }, attackElements: [],
  defense: 64, magicDefense: 64, evasion: 0, magicEvasion: 0, hp: 1000, maxHp: 1000,
  mp: 50, maxMp: 50, conditionIds: [], conditionResistances: {}, elementResistances: {} };

test("ordinary Blind compiles independent row identities and requires its presentation providers", () => {
  const f = conditionBlindFixture(), compiled = f.compile();
  assert.deepEqual(compileBlindBehavior({ values: f.blind }, String), behavior);
  assert.equal(compileBlindBehavior({ values: f.specialBlind }, String), null);
  assert.deepEqual(compiled.catalog.behaviors.find((b) => b.id === 109), behavior);
  assert.deepEqual(compileBlindPresentation(f.reader(), behavior).map((r) => r.values.id), ["870", "874"]);
  for (const row of compileBlindPresentation(f.reader(), behavior)) assert.ok(compiled.sources.some((r) =>
    r.source.assetPath === row.source.assetPath && r.values.id === row.values.id));
  assert.ok(compiled.sources.some((r) => r.values.asset_name === "synthetic-se"));
  f.tables["se_asset.csv"] = [];
  assert.throws(() => f.compile(), /Unresolved table row se_asset/);
});

test("Blind rejects alternate providers, stacking, timers and incomplete effect records", () => {
  const f = conditionBlindFixture();
  for (const key of ["until_value", "overlapped_type", "invalid_type", "target_type", "condition_group_id",
    "parameter_group_id", "attribute_group_id", "species_group_id", "rate_type1", "rate_type2",
    "rate_value1", "rate_value2", "recovery_invalid", "attack_target", "game_over_target",
    "state_cover_unavailable", "damage_number", "field_se_asset_id", "battle_effect_shadow_cloning"])
    assert.equal(hasBlindBehavior({ values: { ...f.blind, [key]: "1" } }), false, key);
  for (const [key, value] of [["until_type", "2"], ["system_type", "2"], ["resistance_decision", "0"],
    ["battle_effect_asset_id", "0"], ["icon_id", "0"], ["condition_type", "10"]])
    assert.equal(hasBlindBehavior({ values: { ...f.blind, [key!]: value! } }), false, key);
  for (const mes_id_name of ["", "None"])
    assert.throws(() => compileBlindBehavior({ values: { ...f.blind, mes_id_name } }, String), /Missing/);
  assert.throws(() => validateBlindBehavior({ ...behavior, effectAssetId: NaN }), /Blind/);
  f.effect.position_type = "4";
  assert.throws(() => f.compile(), /Unresolved Blind effect/);
});

test("Blind halves clamped physical accuracy once and later guaranteed hit overrides it", () => {
  for (const [raw, expected] of [[0, 0], [1, 0], [3, 1], [99, 49], [100, 50], [254, 127], [255, 127], [600, 127]]) {
    assert.equal(physicalAccuracyWithBlind(raw!, [9], false), expected);
    assert.equal(physicalAccuracyWithBlind(raw!, [9, 9], false), expected);
    assert.equal(physicalAccuracyWithBlind(raw!, [9], true), 255);
  }
  assert.equal(physicalAccuracyWithBlind(100, [109], false), 100);
  for (const input of [undefined, null, [-1], [NaN], [0.5]])
    assert.throws(() => physicalAccuracyWithBlind(100, input as number[], false), /condition type/);
});

test("target hit lists apply each category once, plus then minus, with intermediate truncation/cap", () => {
  for (const type of [12, 630, 34, 9, 602, 16]) assert.equal(targetConditionAccuracy(81, [type]), 101);
  for (const type of [407, 4, 10, 15]) assert.equal(targetConditionAccuracy(81, [type]), 60);
  assert.equal(targetConditionAccuracy(81, [9, 9, 16, 4, 10, 15]), 75);
  assert.equal(targetConditionAccuracy(254, [9, 10]), 191); // cap(317) then trunc(255*.75)
  assert.equal(targetConditionAccuracy(255, [9, 10]), 255); // no modifier branch
  assert.equal(targetConditionAccuracy(400, [15]), 255);
  assert.equal(targetConditionAccuracy(0, [9, 15]), 0);
  assert.equal(targetConditionAccuracy(81, [109, 607, 6, 19, 412]), 81);
});

test("magic consumes its entered hit draw even if target adjustment raises the rate to 255", () => {
  const calls: number[][] = [];
  assert.equal(magicAccuracyHit(254, 255, [9], (min, max) => { calls.push([min, max]); return 255; }), true);
  assert.deepEqual(calls, [[0, 255]]);
  assert.equal(magicAccuracyHit(255, 255, [9, 10], noRng), true);
  assert.equal(magicAccuracyHit(80, 64, [9], () => 128), false); // chance50, draw50
  assert.equal(magicAccuracyHit(80, 64, [9], () => 127), true);
});

test("actor Blind and target Blind are separate physical stages and preserve draw order", () => {
  const f = rowPhysicalInput(); f.actor.conditionTypes = [9]; f.target.conditionTypes = [9, 10];
  f.target.evasion = 0;
  // actor 100/2=50; target trunc(50*1.25)=62; poison trunc(62*.75)=46.
  const draws = [31, 118], ranges: number[][] = [];
  const miss = calculatePhysical(f, (min, max) => { ranges.push([min, max]); return draws.shift()!; });
  assert.deepEqual(miss, { amount: 0, missed: true, critical: false });
  assert.deepEqual(ranges, [[0, 31], [0, 255]]); // draw trunc(118*100/256)=46
  const hitDraws = [31, 117, 99];
  assert.equal(calculatePhysical(f, () => hitDraws.shift()!).amount, 73);
  assert.equal(hitDraws.length, 0);
  f.actor.accuracy = 255; f.target.conditionTypes = []; f.target.evasion = 128;
  assert.equal(calculatePhysical(f, (min) => min).missed, true); // 255 no longer skips
  f.rules.contentFlags = [1];
  const guaranteed = [31, 99]; assert.equal(calculatePhysical(f, () => guaranteed.shift()!).missed, false);
  assert.equal(guaranteed.length, 0);
  f.rules.contentFlags = []; f.actor.accuracy = 254; f.actor.conditionTypes = []; f.target.conditionTypes = [9];
  const targetGuaranteed = [31, 99]; assert.equal(calculatePhysical(f, () => targetGuaranteed.shift()!).missed, false);
  assert.equal(targetGuaranteed.length, 0); // physical tests adjusted rate after variance
});

test("unknown actor physical state rejects before RNG and magic actor Blind does not halve spell accuracy", () => {
  const f = rowPhysicalInput(); delete (f.actor as Partial<typeof f.actor>).conditionTypes;
  assert.throws(() => calculatePhysical(f, noRng), /Missing physical actor condition/);
  const m: MagicInput = { rules: { accuracy: 80, contentFlags: [], forceDefense: false, elements: [] },
    actor: { side: "player", level: 10, magic: 20 }, power: 30,
    target: { side: "enemy", magicDefense: 64, magicEvasion: 64, elementResistances: {}, conditionTypes: [9] },
    recovery: false, targetCount: 1 };
  const values = [127, 31]; assert.equal(calculateMagic(m, () => values.shift()!).missed, false);
  assert.equal(values.length, 0); // target+25% makes threshold50
  m.target.conditionTypes = [];
  assert.equal(calculateMagic(m, () => 127).missed, true); // unchanged80 makes threshold40
});

test("Blind spell application uses status hit without the target numerical condition lists", () => {
  const f = conditionBlindAbilityFixture(), definition = compileDevelopmentAbility(f.reader(), 801, "Blind");
  assert.deepEqual(definition.blockers, []);
  const engine = new BattleConditions(f.compile().catalog);
  const target = { ...participant, id: "target", magicEvasion: 64, conditionIds: [125] };
  const result = projectActionTarget(definition.plan!, definition.power,
    { ...participant, conditionIds: [109] }, target, engine, () => 128, 1);
  assert.deepEqual(result.state.conditionIds, [125]); // 100/2=50; Slow must not raise to62
  const hit = projectActionTarget(definition.plan!, definition.power, participant, target, engine, () => 127, 1);
  assert.deepEqual(hit.state.conditionIds, [125, 109]);
  assert.deepEqual(target.conditionIds, [125]);
  f.group.function1_value1 = "189";
  assert.equal(compileDevelopmentAbility(f.reader(), 801, "Special").plan, null);
});

test("action host derives both numerical condition lists from current IDs instead of stale caller projections", () => {
  const f = conditionBlindFixture(), conditions = new BattleConditions(f.compile().catalog);
  const plan = battleFixture().abilities[13]!.plan!;
  const target = { ...participant, id: "target", side: "enemy" as const, conditionIds: [], conditionTypes: [9] };
  const actor = { ...participant, conditionIds: [109], conditionTypes: [] };
  const values = [31, 128];
  const miss = projectActionTarget(plan, 0, actor, target, conditions, () => values.shift()!, 1, 0,
    { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false });
  assert.equal(miss.effects[0]!.missed, true); assert.equal(values.length, 0);
  const magicPlan = battleFixture().abilities[10]!.plan!;
  magicPlan.magic!.accuracy = 80; magicPlan.magic!.contentFlags = [];
  const magicTarget = { ...target, conditionIds: [109], conditionTypes: [], magicEvasion: 64 };
  const magicValues = [127, 31];
  const hit = projectActionTarget(magicPlan, 30, actor, magicTarget, conditions, () => magicValues.shift()!, 1);
  assert.equal(hit.effects[0]!.missed, false); assert.equal(magicValues.length, 0);
  assert.deepEqual(actor.conditionIds, [109]); assert.deepEqual(magicTarget.conditionIds, [109]);
});

test("Blind lifecycle honors resistance, duplicate/fixed application, explicit recovery, death and persistence", () => {
  const f = conditionBlindFixture(), engine = new BattleConditions(f.compile().catalog);
  const applied = engine.add([53], {}, 109, normalHit, () => 0);
  assert.deepEqual(applied.currentIds, [53, 109]);
  assert.equal(engine.add(applied.currentIds, {}, 109, normalHit, noRng).missed, true);
  for (const value of [0, 1, 2])
    assert.equal(engine.add([53], { 109: value }, 109, normalHit, noRng).missed, true);
  const fixed = engine.add([53], {}, 109, { ...normalHit, accuracy: 0, magicEvasion: 255, fixed: true }, noRng);
  assert.deepEqual(fixed.currentIds, [53, 109]);
  assert.deepEqual(engine.battleEnd([53, 109, 121]), [53, 109]);
  assert.deepEqual(engine.recover(applied.currentIds, [109]).currentIds, [53]);
  assert.deepEqual(engine.settleLife(0, applied.currentIds, false).conditionIds, [53, 5]);
  engine.validateStableLife(0, [53, 5]);
  assert.throws(() => engine.validateStableLife(0, [53, 5, 109]), /death\/condition/);
  assert.throws(() => engine.validateStableLife(1, [5]), /HP\/death/);
  assert.throws(() => engine.validateActive([189]), /Unimplemented active/);
  const field = new FieldConditions(compileFieldConditionCatalog(f.reader(), f.compile().catalog, [101, 106]).catalog);
  assert.deepEqual(field.projectStep([{ id: "member", hp: 10, maxHp: 100, conditionIds: [109] }], 101),
    { members: [{ id: "member", hp: 10, maxHp: 100, conditionIds: [109] }], damage: [], soundId: null });
  assert.throws(() => field.validateActive([189]), /Unimplemented active/);
});

test("Blind presentation preserves native two-signal hysteresis and player/load gates", () => {
  const base = { serialType: 6, isPlayer: true, assetLoaded: true, effectPresent: true,
    active: true, isConfusion: false, hasConfusionBehavior: false };
  for (const active of [false, true]) for (const isConfusion of [false, true]) for (const hasConfusionBehavior of [false, true]) {
    const expected = isConfusion === hasConfusionBehavior ? !isConfusion : active;
    assert.equal(projectBlindEffectVisible({ ...base, active, isConfusion, hasConfusionBehavior }), expected);
  }
  for (const gate of [{ serialType: 5 }, { isPlayer: false }, { assetLoaded: false }, { effectPresent: false }])
    assert.equal(projectBlindEffectVisible({ ...base, ...gate, isConfusion: true, hasConfusionBehavior: true }), true);
});
