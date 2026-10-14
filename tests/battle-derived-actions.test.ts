import test from "node:test";
import assert from "node:assert/strict";
import { proposeRandomAbilityDispatch, proposeForcedEscape,
  type RandomAbilityDispatchPlan, type ForcedEscapeDispatchPlan } from "../src/core/battle-derived-actions.js";
import { compileBattleDerivedAction } from "../src/compiler/battle-derived-actions.js";
import { compileAbilityProgram, compileDevelopmentAbility } from "../src/compiler/ability.js";
import { battleAbilityContentFixture } from "./fixtures/battle-ability-content.js";

function randomFixture() {
  const f = battleAbilityContentFixture();
  Object.assign(f.ability, { standard_value: "0", use_value: "0", ability_wait: "0", system_id: "3" });
  Object.assign(f.group, { function1_id: "846", function1_value1: "946", function1_value2: "0", function1_value3: "1" });
  f.tables["function.csv"]!.push({ id: "846", type_id: "46", series_id: "0" });
  f.tables["ability.csv"]!.push({ ...f.ability, id: "921" }, { ...f.ability, id: "922" });
  f.tables["ability_random_group.csv"] = [
    { id: "971", group_id: "946", ability_id: "921", invocation_rate: "33", condition_group_id: "0" },
    { id: "972", group_id: "946", ability_id: "921", invocation_rate: "33", condition_group_id: "0" },
    { id: "973", group_id: "946", ability_id: "922", invocation_rate: "34", condition_group_id: "0" },
  ];
  const program = () => compileAbilityProgram(f.reader(), 901).program;
  const compile = () => compileBattleDerivedAction(f.reader(), program());
  const plan = () => compile().dispatch as RandomAbilityDispatchPlan;
  return { ...f, program, compile, plan };
}
function escapeFixture() {
  const f = battleAbilityContentFixture();
  Object.assign(f.ability, { standard_value: "0", use_value: "0", ability_wait: "0",
    type_id: "13", system_id: "2", battle_renge_id: "5", content_flag_group_id: "91", condition_group_id: "92" });
  Object.assign(f.group, { function1_id: "816", function1_value1: "2", function1_value2: "0", function1_value3: "0" });
  f.tables["function.csv"]!.push({ id: "816", type_id: "16", series_id: "0" });
  f.tables["content_flag_group.csv"] = [{ id: "991", group_id: "91", content_flag_id: "1" }];
  f.tables["condition_group.csv"] = [{ id: "992", group_id: "92", condition_id: "913", invocation_rate: "100" }];
  f.tables["condition.csv"] = [{ id: "903", condition_type: "3" }, { id: "913", condition_type: "601" }];
  const program = () => compileAbilityProgram(f.reader(), 901).program;
  const compile = () => compileBattleDerivedAction(f.reader(), program());
  const plan = () => compile().dispatch as ForcedEscapeDispatchPlan;
  return { ...f, program, compile, plan };
}

test("random dispatch keeps duplicate rows, source order and exact weight boundaries", () => {
  const plan = randomFixture().plan();
  for (const [draw, rowId, abilityId] of [[0, 971, 921], [32, 971, 921], [33, 972, 921],
    [65, 972, 921], [66, 973, 922], [99, 973, 922]]) {
    let calls = 0;
    const result = proposeRandomAbilityDispatch(plan, [921, 922], (min, max) => {
      calls++; assert.deepEqual([min, max], [0, 99]); return draw!;
    });
    assert.equal(calls, 1); assert.equal(result.rowId, rowId); assert.equal(result.abilityId, abilityId);
    assert.deepEqual(result.primaryResult, { hitType: 0, value: 0 });
    assert.equal(result.child.actType, 5); assert.equal(result.child.isCounter, false);
    assert.equal(result.child.commandId, null);
  }
});
test("a blocked unselected child rejects the complete lottery before RNG or publication", () => {
  const plan = randomFixture().plan(), before = structuredClone(plan);
  let calls = 0;
  assert.throws(() => proposeRandomAbilityDispatch(plan, [921], () => { calls++; return 0; }), /child dependency/);
  assert.equal(calls, 0); assert.deepEqual(plan, before);
});
test("conditional and fallback dispatch stay explicit even if all ordinary children are ready", () => {
  const plan = randomFixture().plan(); let calls = 0;
  const random = () => { calls++; return 0; };
  const conditional = structuredClone(plan);
  conditional.rows[0]!.conditionGroupId = 99; conditional.rows[0]!.conditionIds = [913];
  assert.throws(() => proposeRandomAbilityDispatch(conditional, [921, 922], random), /condition-group/);
  const fallback = structuredClone(plan); fallback.fallbackAbilityId = 921; fallback.rawValues[1] = 921;
  assert.throws(() => proposeRandomAbilityDispatch(fallback, [921, 922], random), /fallback/);
  assert.equal(calls, 0);
});
test("weight overflow, negative weights, duplicate row identity and forged child context reject before draw", () => {
  for (const change of [
    (plan: RandomAbilityDispatchPlan) => { plan.rows[0]!.invocationRate = -1; },
    (plan: RandomAbilityDispatchPlan) => { plan.rows[0]!.invocationRate = 0x7fffffff; },
    (plan: RandomAbilityDispatchPlan) => { plan.rows[1]!.rowId = plan.rows[0]!.rowId; },
    (plan: RandomAbilityDispatchPlan) => { plan.rawValues[0]++; },
    (plan: RandomAbilityDispatchPlan) => { plan.child.isCounter = true as never; },
  ]) {
    const plan = randomFixture().plan(); change(plan); let calls = 0;
    assert.throws(() => proposeRandomAbilityDispatch(plan, [921, 922], () => { calls++; return 0; }));
    assert.equal(calls, 0);
  }
});
test("zero-rate declarations retain dependency admission and never win the lottery", () => {
  const plan = randomFixture().plan(); plan.rows[2]!.invocationRate = 0;
  let calls = 0;
  assert.throws(() => proposeRandomAbilityDispatch(plan, [921], () => { calls++; return 0; }), /child dependency/);
  assert.equal(calls, 0);
  const result = proposeRandomAbilityDispatch(plan, [921, 922], () => 65);
  assert.equal(result.rowId, 972);
});
test("proposal results are detached and do not replace the caller's action or targets", () => {
  const plan = randomFixture().plan(), before = structuredClone(plan);
  const result = proposeRandomAbilityDispatch(plan, [921, 922], () => 99);
  result.child.actType = 0 as never; result.primaryResult.value = 42 as never;
  assert.deepEqual(plan, before);
  assert.throws(() => proposeRandomAbilityDispatch(plan, [921, 922], () => 100), /random value/);
});
test("forced enemy escape returns only a type3 condition intent without HP or death evidence", () => {
  const plan = escapeFixture().plan(), targetIds = ["enemy:source-instance"];
  const result = proposeForcedEscape(plan, { actorId: targetIds[0]!, actorSide: "enemy", targetIds });
  assert.deepEqual(result, { unitId: targetIds[0], conditionId: 903, conditionType: 3,
    primaryResult: { hitType: 0, value: 0 } });
  assert.equal("hp" in result, false); assert.equal("rewards" in result, false);
  assert.deepEqual(targetIds, ["enemy:source-instance"]);
});
test("player, cross-unit, group and probabilistic escape cannot inherit enemy-self semantics", () => {
  const plan = escapeFixture().plan();
  for (const input of [
    { actorId: "enemy:a", actorSide: "player" as const, targetIds: ["enemy:a"] },
    { actorId: "enemy:a", actorSide: "enemy" as const, targetIds: ["enemy:b"] },
    { actorId: "enemy:a", actorSide: "enemy" as const, targetIds: ["enemy:a", "enemy:b"] },
  ]) assert.throws(() => proposeForcedEscape(plan, input), /domain/);
  assert.throws(() => proposeForcedEscape({ ...plan, rawValues: [1, 0, 0] as never },
    { actorId: "enemy:a", actorSide: "enemy", targetIds: ["enemy:a"] }), /binding/);
});
test("compiler binds all lottery source rows and children with decimal object identity", () => {
  const f = randomFixture(), result = f.compile();
  assert.deepEqual(result.blockers, []);
  assert.deepEqual((result.dispatch as RandomAbilityDispatchPlan).rows.map(row => row.abilityId), [921, 921, 922]);
  assert.equal(result.sources.filter(row => row.source.assetPath.endsWith("ability_random_group.csv")).length, 3);
  assert.ok(result.sources.every(row => row.source.objectId === "9223372036854775807"));
  assert.ok(result.sources.some(row => row.source.rowId === "922"));
  const compiled = compileDevelopmentAbility(f.reader(), 901, "Synthetic random action");
  assert.equal(compiled.plan?.effects[0]?.kind, "random-ability");
});
test("missing child, duplicate rows and omitted source companion functions are not filtered away", () => {
  const f = randomFixture(); f.tables["ability.csv"]!.pop();
  assert.throws(() => f.compile(), /Unresolved table row/);
  const duplicate = randomFixture(); duplicate.tables["ability_random_group.csv"]!.push({ ...duplicate.tables["ability_random_group.csv"]![0]! });
  assert.throws(() => duplicate.compile(), /Duplicate row/);
  const companion = randomFixture(), p = companion.program(); companion.group.function2_id = "801";
  assert.throws(() => compileBattleDerivedAction(companion.reader(), p), /omitted companion/);
});
test("compiler retains conditional and fallback metadata while blocking their unported consumers", () => {
  const f = randomFixture(); f.group.function1_value2 = "921";
  f.tables["ability_random_group.csv"]![0]!.condition_group_id = "99";
  f.tables["condition_group.csv"] = [{ id: "993", group_id: "99", condition_id: "913", invocation_rate: "100" }];
  f.tables["condition.csv"] = [{ id: "913", condition_type: "601" }];
  const result = f.compile(); assert.ok(result.dispatch);
  assert.deepEqual(result.blockers, ["unresolved random-ability fallback dispatch", "unresolved random-ability condition-group selection"]);
  assert.deepEqual((result.dispatch as RandomAbilityDispatchPlan).rows[0]!.conditionIds, [913]);
  const compiled = compileDevelopmentAbility(f.reader(), 901, "Synthetic conditional action");
  assert.equal(compiled.plan, null);
});
test("source-program mismatches cannot grant dispatch from a lookalike effect", () => {
  const f = randomFixture(), p = f.program(); p.functions[0]!.values[0]++;
  assert.throws(() => compileBattleDerivedAction(f.reader(), p), /differs from its source/);
  const series = randomFixture(); series.tables["function.csv"]!.find(row => row.id === "846")!.series_id = "1";
  assert.equal(series.compile().dispatch, null);
});
test("forced escape admission retains exact condition, flags and forbidden source references", () => {
  const f = escapeFixture(), compiled = compileDevelopmentAbility(f.reader(), 901, "Synthetic escape");
  assert.ok(compiled.plan); assert.deepEqual(compiled.program.forbiddenConditionIds, [913]);
  assert.equal(compiled.plan.effects[0]!.kind, "forced-escape");
  assert.ok(f.compile().sources.some(row => row.source.rowId === "903"));
  for (const mutate of [
    (g: ReturnType<typeof escapeFixture>) => { g.ability.system_id = "5"; },
    (g: ReturnType<typeof escapeFixture>) => { g.ability.battle_renge_id = "4"; },
    (g: ReturnType<typeof escapeFixture>) => { g.group.function1_value1 = "1"; },
    (g: ReturnType<typeof escapeFixture>) => { g.ability.content_flag_group_id = "0"; },
  ]) { const g = escapeFixture(); mutate(g); assert.equal(compileDevelopmentAbility(g.reader(), 901, "Synthetic").plan, null); }
});
test("derived actions retain existing scalar, process, reaction and multi-effect gates", () => {
  for (const [key, value] of [["standard_value", "1"], ["use_value", "1"], ["reaction_type", "1"], ["data_a", "1"]]) {
    const f = randomFixture(); f.ability[key!] = value!;
    assert.equal(compileDevelopmentAbility(f.reader(), 901, "Synthetic").plan, null);
  }
  const f = randomFixture(); f.group.function2_id = "801"; f.group.function2_value1 = "1";
  f.group.function2_value2 = "2";
  assert.equal(compileDevelopmentAbility(f.reader(), 901, "Synthetic composed action").plan, null);
});
