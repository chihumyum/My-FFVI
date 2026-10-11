import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { FieldConditions } from "../src/core/field-conditions.js";
import { compileFieldConditionCatalog } from "../src/compiler/field-conditions.js";
import { compileProtectionBehavior, hasProtectionBehavior } from "../src/compiler/protection.js";
import { compileDevelopmentAbility } from "../src/compiler/ability.js";
import { projectActionTarget, type ActionParticipant } from "../src/core/action-effects.js";
import { protectionAbilityFixture, protectionFixture } from "./fixtures/protection.js";

const noRng = () => assert.fail("Unexpected random draw");
const ordinary = { accuracy: 100, magicEvasion: 0, fixed: false };

test("ordinary protection compiles by condition type while preserving row identity", () => {
  const f = protectionFixture(), { catalog } = f.compile(), engine = new BattleConditions(catalog);
  assert.deepEqual(catalog.behaviors.filter((b) => b.kind.endsWith("-protection")), [
    { id: 123, kind: "physical-protection", name: "STATE_123", untilType: 2 },
    { id: 122, kind: "magic-protection", name: "STATE_122", untilType: 2 },
  ]);
  assert.deepEqual(engine.types([122, 123, 901]), [412, 19, 1]);
  assert.throws(() => engine.validateActive([193]), /Unimplemented active/);
  assert.equal(hasProtectionBehavior({ values: f.special }), false);
});

test("protection admission rejects alternate lifecycle and secondary providers", () => {
  const f = protectionFixture();
  for (const [key, value] of [["condition_type", "423"], ["system_type", "1"], ["until_type", "3"],
    ["until_value", "2"], ["condition_group_id", "908"], ["parameter_group_id", "1"],
    ["attribute_group_id", "1"], ["species_group_id", "1"], ["overlapped_type", "1"],
    ["resistance_decision", "0"], ["rate_type1", "1"], ["rate_value1", "50"],
    ["invalid_type", "1"], ["target_type", "1"], ["recovery_invalid", "1"],
    ["damage_number", "32"], ["field_se_asset_id", "1"], ["battle_effect_shadow_cloning", "0"]])
    assert.equal(hasProtectionBehavior({ values: { ...f.physical, [key!]: value! } }), false, key);
  assert.throws(() => compileProtectionBehavior({ values: { ...f.physical, mes_id_name: "None" } }, String), /Missing/);
});

test("ordinary protection application keeps hit, resistance and IsAddable ordering", () => {
  const engine = new BattleConditions(protectionFixture().compile().catalog), before = [53];
  let draws = 0;
  const applied = engine.add(before, {}, 123, ordinary, (min, max) => {
    draws++; assert.deepEqual([min, max], [0, 255]); return 0;
  });
  assert.deepEqual(applied, { currentIds: [53, 123], added: [123], removed: [], missed: false });
  assert.equal(draws, 1); assert.deepEqual(before, [53]);
  assert.equal(engine.add(applied.currentIds, {}, 123, ordinary, noRng).missed, true);
  for (const value of [0, 1, 2])
    assert.equal(engine.add(before, { 123: value }, 123, ordinary, noRng).missed, true);
  assert.equal(engine.add(before, { 123: 1 }, 123, { ...ordinary, fixed: true }, noRng).missed, true);
  assert.deepEqual(engine.add(before, { 123: 0 }, 123, { ...ordinary, fixed: true }, noRng).currentIds, [53, 123]);
  assert.equal(engine.add(before, {}, 123, { ...ordinary, magicEvasion: 128 }, () => 0).missed, true);
});

test("both protections coexist, survive ATB admission, and disappear at battle end", () => {
  const engine = new BattleConditions(protectionFixture().compile().catalog);
  const ids = engine.add([53, 123, 901], {}, 122, { ...ordinary, fixed: true }, noRng).currentIds;
  assert.deepEqual(ids, [53, 123, 901, 122]);
  assert.deepEqual(engine.admitAtbAction(ids, [{ id: 800, type: 4 }]), [53, 123, 122]);
  assert.deepEqual(engine.battleEnd(ids), [53]);
  assert.deepEqual(ids, [53, 123, 901, 122]);
});

test("source conflict cleanup removes protections on death and recovery removes requested rows once", () => {
  const engine = new BattleConditions(protectionFixture().compile().catalog), before = [53, 123, 122];
  assert.deepEqual(engine.settleLife(0, before, false), { hp: 0, conditionIds: [53, 5] });
  assert.deepEqual(engine.recover(before, [123]), { currentIds: [53, 122], removed: [123], added: [], missed: false });
  assert.deepEqual(engine.recover([123, 123, 122], [123]).currentIds, [123, 122]);
  assert.throws(() => engine.recover(before, [123, 999]), /Unknown battle condition/);
  assert.deepEqual(before, [53, 123, 122]);
});

test("battle-local protections are not silently admitted as passive field or save conditions", () => {
  const f = protectionFixture(), battle = f.compile().catalog;
  const { catalog } = compileFieldConditionCatalog(f.reader(), battle, [106]);
  const field = new FieldConditions(catalog);
  assert.deepEqual(catalog.behaviors.map((b) => b.id), [4, 5, 6, 53]);
  field.validateActive([53]);
  for (const id of [122, 123, 193]) assert.throws(() => field.validateActive([id]), /Unimplemented active field/);
});

test("a mismatched condition type or stacking lifecycle cannot forge an active protection behavior", () => {
  for (const mutation of ["type", "overlapped", "until"] as const) {
    const { catalog } = protectionFixture().compile();
    const definition = catalog.rules.definitions.find((d) => d.id === 123)!;
    if (mutation === "type") definition.type = 423;
    if (mutation === "overlapped") definition.overlapped = true;
    if (mutation === "until") Object.assign(catalog.behaviors.find((b) => b.id === 123)!, { untilType: 3 });
    assert.throws(() => new BattleConditions(catalog), /Unsupported battle condition behavior/);
  }
});

test("source-shaped protection flag1 bypasses high evasion but retains ordinary resistance and duplicate rejection", () => {
  const f = protectionAbilityFixture();
  const definition = compileDevelopmentAbility(f.reader(), 801, "Synthetic protection");
  assert.deepEqual(definition.blockers, []);
  assert.deepEqual(definition.plan!.effects, [{ slot: 1, kind: "add-condition", conditionId: 123, fixedHit: false, accuracy: 255 }]);
  assert.deepEqual(definition.plan!.targeting, { life: "alive", relation: "either", modes: ["single"],
    defaultMode: "single", defaultRelation: "ally", normalFormationOnly: false });
  const engine = new BattleConditions(f.compile().catalog);
  const actor: ActionParticipant = { id: "actor", side: "player", level: 10, attack: 0, magic: 20,
    attackElements: [], defense: 64, magicDefense: 64, evasion: 0, magicEvasion: 255,
    hp: 800, maxHp: 800, mp: 50, maxMp: 50, conditionIds: [], conditionResistances: {}, elementResistances: {} };
  const target = { ...actor, id: "target" };
  const apply = (t: ActionParticipant) => projectActionTarget(definition.plan!, 0, actor, t, engine, noRng, 1);
  const result = apply(target);
  assert.deepEqual(result.state.conditionIds, [123]);
  assert.equal(result.effects[0]!.missed, false);
  for (const resistance of [0, 1, 2]) {
    const resisted = apply({ ...target, conditionResistances: { 123: resistance } });
    assert.deepEqual(resisted.state.conditionIds, []); assert.equal(resisted.effects[0]!.missed, true);
  }
  assert.equal(apply({ ...target, conditionIds: [123] }).effects[0]!.missed, true);
  assert.deepEqual(target.conditionIds, []);
});

test("ordinary protection spell without flag1 consumes the accuracy draw; Value2 alone selects fixed hit", () => {
  const f = protectionAbilityFixture(); f.tables["content_flag_group.csv"]!.shift();
  let definition = compileDevelopmentAbility(f.reader(), 801, "Synthetic protection");
  assert.deepEqual(definition.blockers, []);
  assert.deepEqual(definition.plan!.effects, [{ slot: 1, kind: "add-condition", conditionId: 123, fixedHit: false, accuracy: 100 }]);
  f.group.function1_value2 = "1";
  definition = compileDevelopmentAbility(f.reader(), 801, "Synthetic fixed protection");
  assert.deepEqual(definition.plan!.effects, [{ slot: 1, kind: "add-condition", conditionId: 123, fixedHit: true, accuracy: 100 }]);
});

test("protection compiler retains special-type, secondary-provider and unimplemented flag blockers", () => {
  for (const mutation of ["special-type", "provider", "flag4", "unknown-flag"] as const) {
    const f = protectionAbilityFixture();
    if (mutation === "special-type") f.ability.type_id = "628";
    if (mutation === "provider") f.group.function1_value1 = "193";
    if (mutation === "flag4" || mutation === "unknown-flag")
      f.tables["content_flag_group.csv"]![0]!.content_flag_id = mutation === "flag4" ? "4" : "99";
    const definition = compileDevelopmentAbility(f.reader(), 801, "Unadmitted protection");
    assert.equal(definition.plan, null, mutation);
    assert.ok(definition.blockers.length, mutation);
  }
  const f = protectionAbilityFixture(); f.ability.type_id = "3"; f.ability.content_flag_group_id = "0";
  assert.deepEqual(compileDevelopmentAbility(f.reader(), 801, "Enemy protection").blockers, []);
});

test("the shared action target projection derives numerical protection from live row identities", () => {
  const f = protectionFixture(), engine = new BattleConditions(f.compile().catalog);
  const actor: ActionParticipant = { id: "actor", side: "player", level: 10, attack: 40, magic: 20,
    physical: { attack: 40, strength: 30, accuracy: 100, criticalRate: 3 },
    attackElements: [], defense: 64, magicDefense: 64, evasion: 0, magicEvasion: 0,
    hp: 1000, maxHp: 1000, mp: 50, maxMp: 50, conditionIds: [], conditionResistances: {}, elementResistances: {} };
  const target: ActionParticipant = { ...actor, id: "target", side: "enemy", conditionIds: [123, 122] };
  const targeting = { life: "alive" as const, relation: "enemy" as const, modes: ["single" as const],
    defaultMode: "single" as const, defaultRelation: "enemy" as const, normalFormationOnly: false };
  let random = [31, 0, 99];
  const physical = projectActionTarget({ effects: [{ slot: 1, kind: "physical" }], targeting,
    physical: { normalAttack: true, multiplyPercent: null, contentFlags: [] }, magic: null },
  0, actor, target, engine, () => random.shift()!, 1);
  assert.equal(physical.state.hp, 952); assert.equal(random.length, 0);
  random = [0, 31];
  const magic = projectActionTarget({ effects: [{ slot: 1, kind: "magic" }], targeting, physical: null,
    magic: { accuracy: 100, contentFlags: [], elements: [], forceDefense: false } },
  30, actor, target, engine, () => random.shift()!, 1);
  assert.equal(magic.state.hp, 847); assert.equal(random.length, 0);
  assert.deepEqual(target.conditionIds, [123, 122]); assert.equal(target.hp, 1000);
});
