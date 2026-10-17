import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions } from "../src/core/battle-conditions.js";
import {
  initialUserConditionCalcResult, projectUserConditionPhase, projectUniqueNoneEffect,
  type UserConditionEffect,
} from "../src/core/ability-user-conditions.js";
import { compileUserConditionEffect, compileUniqueNoneEffect } from "../src/compiler/ability-user-conditions.js";
import { compileAbilityProgram, compileDevelopmentAbility } from "../src/compiler/ability.js";
import { battleAbilityContentFixture } from "./fixtures/battle-ability-content.js";

function conditions() {
  return new BattleConditions({ hpZeroConditionId: 305,
    dying: { conditionId: 304, thresholdDivisor: 8 }, rules: {
      definitions: [
        { id: 301, type: 6, overlapped: false, eraseGroupId: 1 },
        { id: 304, type: 4, overlapped: false, eraseGroupId: 1 },
        { id: 305, type: 5, overlapped: false, eraseGroupId: 1 },
        { id: 312, type: 682, overlapped: false, eraseGroupId: 1 },
        { id: 313, type: 501, overlapped: false, eraseGroupId: 1 },
      ], eraseRules: [{ id: 1, groupId: 1, type: 2, conditionId: 0, eraseConditionId: 0 }],
    }, behaviors: [
      { id: 301, kind: "silence", name: "Synthetic silence", untilType: 2 },
      { id: 304, kind: "dying", name: "Synthetic dying", untilType: 3 },
      { id: 305, kind: "unable-fight", name: "Synthetic fallen", untilType: 3 },
    ] });
}
function effect(id = 301, type = 6, phase: 0 | 1 = 0, remove: 0 | 1 = 1): UserConditionEffect {
  return { kind: "user-condition", slot: 2, conditionId: id, conditionType: type,
    phase: phase === 0 ? "fixed-parameter" : "update-parameter",
    operation: remove ? "remove" : "add", rawValues: [id, phase, remove] };
}
function fixture() {
  const f = battleAbilityContentFixture();
  f.group.function1_id = "938"; f.group.function1_value1 = "301";
  f.group.function1_value2 = "0"; f.group.function1_value3 = "1";
  f.tables["function.csv"]!.push({ id: "938", type_id: "38", series_id: "0" },
    { id: "923", type_id: "23", series_id: "0" });
  f.tables["condition.csv"] = [{ id: "301", condition_type: "6" },
    { id: "312", condition_type: "682" }, { id: "313", condition_type: "501" }];
  const program = () => compileAbilityProgram(f.reader(), Number(f.ability.id)).program;
  const compile = () => compileDevelopmentAbility(f.reader(), Number(f.ability.id), "Synthetic user action");
  return { ...f, program, compile };
}

test("user removal deletes one exact record, preserving calculator classification and caller input", () => {
  const before = [301, 301, 304], previous = initialUserConditionCalcResult();
  const change = projectUserConditionPhase(effect(), "fixed-parameter", { id: "user", conditionIds: before }, conditions(), previous);
  assert.deepEqual(change.currentIds, [301, 304]);
  assert.deepEqual(change.removed, [301]); assert.deepEqual(change.added, []);
  assert.equal(change.executed, true); assert.equal(change.calcResult.hitType, -1);
  assert.deepEqual(before, [301, 301, 304]);
  change.calcResult.hitType = 0; assert.equal(previous.hitType, -1);
});
test("absence of a known unported marker permits removal without admitting its active state", () => {
  const c = conditions(), e = effect(312, 682);
  const change = projectUserConditionPhase(e, "fixed-parameter", { id: "user", conditionIds: [301] }, c);
  assert.equal(change.executed, true); assert.deepEqual(change.removed, []);
  assert.deepEqual(change.currentIds, [301]); assert.equal(change.calcResult.hitType, -1);
  assert.throws(() => projectUserConditionPhase(e, "fixed-parameter", { id: "user", conditionIds: [312] }, c), /Unimplemented active/);
});
test("phase selection does not execute early and repeats thread the shared user projection", () => {
  const c = conditions(), e = effect(301, 6, 1, 0), before = { id: "user", conditionIds: [] as number[] };
  const early = projectUserConditionPhase(e, "fixed-parameter", before, c);
  assert.equal(early.executed, false); assert.deepEqual(early.currentIds, []);
  const first = projectUserConditionPhase(e, "update-parameter", before, c);
  const next = projectUserConditionPhase(e, "update-parameter", { id: before.id, conditionIds: first.currentIds }, c);
  // Direct List.Add precedes lifecycle conflict resolution; this stage must
  // not silently turn two nominal-target invocations into one per action.
  assert.deepEqual(next.currentIds, [301, 301]); assert.equal(next.calcResult.hitType, 0);
  assert.deepEqual(before.conditionIds, []);
});
test("the user projection cannot mutate nominal target conditions or settle death on its own", () => {
  const target = { id: "target", conditionIds: [301], hp: 40 };
  const user = { id: "user", conditionIds: [] as number[], hp: 80 };
  const projected = projectUserConditionPhase(effect(305, 5, 0, 0), "fixed-parameter", user, conditions());
  assert.deepEqual(projected.currentIds, [305]);
  assert.deepEqual(target, { id: "target", conditionIds: [301], hp: 40 });
  assert.deepEqual(user, { id: "user", conditionIds: [], hp: 80 });
});
test("unknown active behavior and Manipulate guard fail without partial list publication", () => {
  const user = { id: "user", conditionIds: [301] };
  assert.throws(() => projectUserConditionPhase(effect(312, 682, 0, 0), "fixed-parameter", user, conditions()), /Unimplemented active/);
  assert.throws(() => projectUserConditionPhase(effect(313, 501, 0, 0), "fixed-parameter", user, conditions()), /Manipulate guard/);
  assert.deepEqual(user.conditionIds, [301]);
});
test("raw operation, master/type, phase and result mismatches never inherit user semantics", () => {
  const user = { id: "user", conditionIds: [301] };
  assert.throws(() => projectUserConditionPhase({ ...effect(), operation: "add" }, "fixed-parameter", user, conditions()), /function binding/);
  assert.throws(() => projectUserConditionPhase(effect(301, 5), "fixed-parameter", user, conditions()), /master\/type/);
  assert.throws(() => projectUserConditionPhase({ ...effect(), rawValues: [301, 2, 1] } as unknown as UserConditionEffect,
    "fixed-parameter", user, conditions()), /function binding/);
  assert.throws(() => projectUserConditionPhase(effect(), "fixed-parameter", user, conditions(),
    { ...initialUserConditionCalcResult(), value: 1 } as never), /calculator result/);
});
test("removal preserves an existing result rather than translating absence into miss or hit", () => {
  const previous = { ...initialUserConditionCalcResult(), hitType: 2 as const };
  const projected = projectUserConditionPhase(effect(), "fixed-parameter", { id: "user", conditionIds: [] }, conditions(), previous);
  assert.deepEqual(projected.calcResult, previous); assert.notEqual(projected.calcResult, previous);
});
test("all three source slots bind the exact condition master and decimal object provenance", () => {
  for (const slot of [1, 2, 3]) {
    const f = fixture(); f.group.function1_id = "0";
    for (const n of [1, 2, 3]) f.group[`function1_value${n}`] = "0";
    f.group[`function${slot}_id`] = "938";
    f.group[`function${slot}_value1`] = "301";
    f.group[`function${slot}_value2`] = "1"; f.group[`function${slot}_value3`] = "0";
    const p = f.program(), compiled = compileUserConditionEffect(f.reader(), p, p.functions[0]!);
    assert.equal(compiled.effect.slot, slot); assert.equal(compiled.effect.phase, "update-parameter");
    assert.equal(compiled.effect.operation, "add"); assert.equal(compiled.effect.conditionType, 6);
    assert.deepEqual(compiled.effect.rawValues, [301, 1, 0]);
    assert.deepEqual(compiled.sources.map(r => r.source.rowId), ["901", "81", "938", "301"]);
    assert.ok(compiled.sources.every(r => r.source.objectId === "9223372036854775807"));
  }
});
test("decoded function operands must still match their source group and function dispatch", () => {
  const f = fixture(), p = f.program();
  f.group.function1_value1 = "312";
  assert.throws(() => compileUserConditionEffect(f.reader(), p, p.functions[0]!), /differs from its source/);
  f.group.function1_value1 = "301"; f.tables["function.csv"]!.find(r => r.id === "938")!.type_id = "9";
  assert.throws(() => compileUserConditionEffect(f.reader(), p, p.functions[0]!), /differs from its source/);
});
test("source references and unobserved phase/operation flags remain strict admission boundaries", () => {
  const f = fixture(), p = f.program();
  f.tables["condition.csv"] = [];
  assert.throws(() => compileUserConditionEffect(f.reader(), p, p.functions[0]!), /Unresolved table row/);
  const g = fixture(); g.group.function1_value2 = "2";
  const pg = g.program();
  assert.throws(() => compileUserConditionEffect(g.reader(), pg, pg.functions[0]!), /operands/);
  assert.equal(g.compile().plan, null);
});
test("a typed user effect cannot hide an unclosed companion or authorize an incoming lifecycle", () => {
  const f = fixture(); f.group.function1_value3 = "0";
  assert.equal(f.compile().plan, null);
  assert.match(f.compile().blockers.join(";"), /active lifecycle/);
  f.group.function1_value3 = "1";
  assert.equal(f.compile().plan, null); // No complete primary wrapper contract.
  assert.match(f.compile().blockers.join(";"), /whole-action stages/);
});
test("source-bound FF6 empty primary is retained beside the independently staged user removal", () => {
  const f = fixture(); Object.assign(f.ability, { id: "696", battle_function_group_id: "557",
    battle_renge_id: "5", type_id: "35", system_id: "2", standard_value: "0", use_value: "0", ability_wait: "0" });
  Object.assign(f.group, { id: "557", function1_id: "923", function1_value1: "0", function1_value2: "0", function1_value3: "0",
    function2_id: "938", function2_value1: "312", function2_value2: "0", function2_value3: "1" });
  const ability = f.compile(); assert.deepEqual(ability.blockers, []); assert.ok(ability.plan);
  assert.deepEqual(ability.plan.effects[0], { kind: "unique-none", slot: 1, primaryResult: "empty-dictionary" });
  assert.deepEqual(projectUniqueNoneEffect(ability.plan.effects[0] as never), {
    slot: 1, resource: "none", primaryResult: "empty-dictionary", calcResult: null,
  });
  assert.equal(ability.plan.effects[1]!.kind, "user-condition");
  const p = f.program();
  assert.throws(() => compileUniqueNoneEffect({ ...p, abilityId: 255 }, p.functions[0]!), /Unresolved Unique None/);
  assert.throws(() => compileUniqueNoneEffect(p, { ...p.functions[0]!, values: [] as never }), /Unresolved Unique None/);
  f.ability.use_value = "1"; assert.equal(f.compile().plan, null);
  f.ability.use_value = "0"; f.group.function3_id = "801";
  f.group.function3_value1 = "1"; f.group.function3_value2 = "2";
  assert.equal(f.compile().plan, null);
});
