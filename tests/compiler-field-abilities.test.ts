import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldAbilityCatalog } from "../src/compiler/field-abilities.js";
import type { FieldAbilityRules } from "../src/core/field-abilities.js";
import type { BattleAbilityCatalog } from "../src/core/battle-abilities.js";
import { battleAbilityContentFixture } from "./fixtures/battle-ability-content.js";

const rules: FieldAbilityRules = {
  kind: "field-ability-rules-v1", profile: "source",
  random: { kind: "web-field-random-v1", seed: 0x71f6c0de },
};

function fixture() {
  const f = battleAbilityContentFixture();
  Object.assign(f.ability, { menu_function_group_id: "81", renge_id: "6", menu_renge_id: "0" });
  return { ...f, compile: () => compileFieldAbilityCatalog(f.reader(), f.tables, [], f.resolveName, rules) };
}

function recoveryFixture() {
  const f = fixture();
  f.ability.type_id = "1";
  f.tables["function.csv"]![0]!.type_id = "12";
  f.group.function1_value1 = "77";
  f.group.function1_value2 = "0";
  f.tables["condition_group.csv"] = [
    { id: "11", group_id: "77", condition_id: "6" },
    { id: "12", group_id: "77", condition_id: "99" },
    { id: "13", group_id: "77", condition_id: "6" },
  ];
  f.tables["condition.csv"] = [{ id: "6", condition_type: "6" }, { id: "99", condition_type: "999" }];
  return f;
}

test("menu compilation reads its own group and range rather than the battle program", () => {
  const f = fixture();
  f.ability.menu_function_group_id = "0";
  f.ability.renge_id = "0";
  // A valid battle function is present, but it grants no field capability.
  const result = f.compile();
  const definition = result.catalog.abilities[901]!;
  assert.deepEqual(definition.program, { groupId: 0, range: 0, functions: [],
    process: { key: "None", values: [0, 0, 0] }, forbiddenConditionIds: [], contentFlags: [] });
  assert.equal(definition.plan, null);
  assert.deepEqual(definition.blockers, ["No source field ability function group"]);
  assert.equal(result.report.menuDeclared, 0);
  assert.equal(result.report.ownershipGranted, false);
  assert.equal(result.report.originalGameExecuted, false);
  assert.equal(result.report.randomParity, false);
});

test("unknown field functions remain visible in the raw program and block the whole entry", () => {
  const f = fixture();
  f.tables["function.csv"]![0]!.type_id = "999";
  f.group.function1_value1 = "27";
  const result = f.compile();
  assert.equal(result.catalog.abilities[901]!.plan, null);
  assert.deepEqual(result.catalog.abilities[901]!.program.functions, [
    { slot: 1, functionId: 801, type: 999, series: 0, values: [27, 2, 0] },
  ]);
  assert.ok(result.catalog.abilities[901]!.blockers.length);
  assert.ok(result.sources.some(source => source.assetPath.endsWith("function_group.csv")));
  assert.ok(result.sources.some(source => source.assetPath.endsWith("function.csv")));
});

test("missing or ambiguous content and messages cannot invent a field ability identity", () => {
  for (const kind of ["missing", "ambiguous", "message"] as const) {
    const f = fixture();
    if (kind === "missing") f.tables["content.csv"] = [];
    if (kind === "ambiguous") f.tables["content.csv"]!.push({ ...f.content, id: "402" });
    if (kind === "message") delete f.messages.SYNTHETIC_ABILITY_NAME;
    const result = f.compile();
    const entry = result.catalog.abilities[901]!;
    assert.equal(entry.contentId, kind === "message" ? 401 : null);
    assert.equal(entry.name, "");
    assert.equal(entry.plan, null);
    assert.match(entry.blockers.join(), /content identity|message/);
  }
});

test("None is a source empty label and is never replaced or sent to the resolver", () => {
  const f = fixture(); f.content.mes_id_name = "None";
  const result = compileFieldAbilityCatalog(f.reader(), f.tables, [], () => assert.fail("None lookup"), rules);
  assert.equal(result.catalog.abilities[901]!.name, "");
  assert.equal(result.catalog.abilities[901]!.contentId, 401);
  assert.ok(!result.catalog.abilities[901]!.blockers.some(reason => reason.includes("message")));
});

test("broken references and foreign enumerations abort instead of being disguised as unsupported", () => {
  const f = fixture();
  const reader = f.reader();
  const foreign = structuredClone(f.tables);
  foreign["ability.csv"]![0]!.renge_id = "7";
  assert.throws(() => compileFieldAbilityCatalog(reader, foreign, [], f.resolveName, rules), /Mismatched.*enumeration/);
  f.group.function2_id = "9999";
  assert.throws(() => f.compile(), /Unresolved table row/);
  f.group.function2_id = "0";
  f.group.function2_value1 = "2";
  assert.throws(() => f.compile(), /Orphan function values/);
  f.group.function2_value1 = "0";
  f.tables["content.csv"]!.push({ ...f.content, id: "402", type_value: "999" });
  assert.throws(() => f.compile(), /Unresolved field content ability reference/);
  f.tables["content.csv"]!.pop();
  f.tables["ability.csv"]!.push({ ...f.ability });
  assert.throws(() => f.compile(), /Duplicate/);
});

test("catalog output is deterministic and owns no aliases into source or caller policy", () => {
  const f = fixture();
  f.tables["ability.csv"]!.unshift({ ...f.ability, id: "902", menu_function_group_id: "0" });
  f.tables["content.csv"]!.push({ ...f.content, id: "402", type_value: "902" });
  const tables = structuredClone(f.tables);
  const policy = structuredClone(rules);
  const first = compileFieldAbilityCatalog(f.reader(), f.tables, [], f.resolveName, policy);
  const second = f.compile();
  assert.deepEqual(first, second);
  assert.deepEqual(first.report.entries.map(entry => entry.id), [901, 902]);
  first.catalog.abilities[901]!.program.functions[0]!.values[0] = 123;
  first.catalog.rules.random.seed = 99;
  first.report.entries[0]!.sources[0]!.assetPath = "different";
  assert.deepEqual(f.tables, tables);
  assert.deepEqual(policy, rules);
  assert.deepEqual(f.compile(), second);
});

test("the Web random policy is explicit and never inferred from a missing seed", () => {
  const f = fixture();
  for (const seed of [0, -1, 1.5, 0x100000000, NaN]) {
    assert.throws(() => compileFieldAbilityCatalog(f.reader(), f.tables, [], f.resolveName,
      { ...rules, random: { ...rules.random, seed } }), /random policy/);
  }
  const absent = structuredClone(rules) as Partial<FieldAbilityRules>;
  delete absent.random;
  assert.throws(() => compileFieldAbilityCatalog(f.reader(), f.tables, [], f.resolveName, absent as FieldAbilityRules), /random policy/);
});

test("field condition recovery preserves ordered references including unsupported inactive statuses", () => {
  const f = recoveryFixture();
  // Intentionally disagree with both other range columns. Source menu callers
  // read RengeId; MenuRengeId and BattleRengeId do not authorize this projection.
  f.ability.renge_id = "1"; f.ability.menu_renge_id = "0"; f.ability.battle_renge_id = "4";
  const result = f.compile();
  assert.deepEqual(result.catalog.abilities[901]!.plan, {
    kind: "field-ability-plan-v1", modes: ["single"],
    effects: [{ slot: 1, kind: "recover-condition", conditionIds: [6, 99, 6] }], magic: null,
  });
  assert.equal(result.report.plans, 1);
  assert.ok(result.sources.some(source => source.assetPath.endsWith("condition.csv") && source.rowId === "99"));
  f.tables["condition.csv"]!.pop();
  assert.throws(() => f.compile(), /Unresolved table row/);
});

test("revival requires ordered condition removal before maximum-HP recovery", () => {
  const f = recoveryFixture();
  f.ability.renge_id = "7";
  f.tables["condition.csv"]![0]!.condition_type = "5";
  f.tables["function.csv"]!.push({ id: "802", type_id: "34", series_id: "0" });
  Object.assign(f.group, { function2_id: "802", function2_value1: "2", function2_value2: "5", function2_value3: "8" });
  let plan = f.compile().catalog.abilities[901]!.plan!;
  assert.deepEqual(plan.effects[1], { slot: 2, kind: "recover-max-hp", mode: "divide", value: 8 });
  f.group.function2_value2 = "4"; f.group.function2_value3 = "100";
  plan = f.compile().catalog.abilities[901]!.plan!;
  assert.deepEqual(plan.effects[1], { slot: 2, kind: "recover-max-hp", mode: "percent", value: 100 });
  // Condition type 1 is not death: its unrelated numeric identity must not
  // authorize this life-recovery chain.
  f.tables["condition.csv"]![0]!.condition_type = "1";
  assert.match(f.compile().catalog.abilities[901]!.blockers.join(), /preceding revival/);
  f.tables["condition.csv"]![0]!.condition_type = "5";
  f.group.function1_id = "0"; f.group.function1_value1 = "0";
  assert.equal(f.compile().catalog.abilities[901]!.plan, null);
  assert.match(f.compile().catalog.abilities[901]!.blockers.join(), /preceding revival/);
});

test("field command mapping binds normalized ability types through unique source Chanting rows", () => {
  const f = recoveryFixture();
  f.tables["chanting.csv"] = [{ id: "42", ability_type_id: "1" }];
  f.tables["ability_group.csv"] = [{ id: "12", group_id: "88", type_id: "42" }];
  f.tables["command.csv"] = [{ id: "7", ability_group_id: "88" }];
  const commands: BattleAbilityCatalog["commands"] = [{
    id: 7, nameKey: "SYNTHETIC_MAGIC", type: 1, listType: 2, executionType: 1,
    abilityId: 0, contentId: null, abilityTypes: [1], releaseType: 0, releaseValues: [0, 0],
    forbiddenConditionIds: [], blockers: [],
  }];
  const compile = () => compileFieldAbilityCatalog(f.reader(), f.tables, commands, f.resolveName, rules);
  const result = compile();
  assert.deepEqual(result.catalog.commands[0]!.abilityTypes, [1]);
  assert.ok(result.sources.some(source => source.assetPath.endsWith("chanting.csv") && source.rowId === "42"));
  assert.ok(result.sources.some(source => source.assetPath.endsWith("ability_group.csv") && source.rowId === "12"));
  commands[0]!.abilityTypes = [42];
  assert.throws(compile, /Mismatched field command ability type mapping/);
  commands[0]!.abilityTypes = [1];
  f.tables["chanting.csv"]!.push({ id: "43", ability_type_id: "1" });
  assert.throws(compile, /Ambiguous field ability chanting type/);
  f.tables["chanting.csv"]!.pop();
  f.tables["ability_group.csv"]![0]!.type_id = "99";
  assert.throws(compile, /Unresolved field command chanting reference/);
});

test("menu range modes remain explicit and unsupported functions never publish a partial plan", () => {
  const f = recoveryFixture();
  for (const [range, modes] of [[1, ["single"]], [2, ["all"]], [5, ["single"]], [6, ["single", "all"]], [7, ["single"]]] as const) {
    f.ability.renge_id = String(range);
    assert.deepEqual(f.compile().catalog.abilities[901]!.plan!.modes, modes);
  }
  f.ability.renge_id = "0";
  assert.match(f.compile().catalog.abilities[901]!.blockers.join(), /range: 0/);
  f.ability.renge_id = "6";
  f.tables["function.csv"]!.push({ id: "802", type_id: "999", series_id: "0" });
  f.group.function2_id = "802";
  const definition = f.compile().catalog.abilities[901]!;
  assert.equal(definition.plan, null);
  assert.deepEqual(definition.program.functions.map(fn => fn.type), [12, 999]);
  assert.match(definition.blockers.join(), /function: 999/);
});

test("alternate process and level-use resources cannot inherit the ordinary field plan", () => {
  const f = recoveryFixture();
  f.ability.process_prog = "SYNTHETIC_UNIMPLEMENTED_PROCESS";
  assert.match(f.compile().catalog.abilities[901]!.blockers.join(), /process/);
  f.ability.process_prog = "None"; f.ability.data_a = "1";
  assert.equal(f.compile().catalog.abilities[901]!.plan, null);
  f.ability.data_a = "0"; f.ability.ability_lv = "1";
  assert.match(f.compile().catalog.abilities[901]!.blockers.join(), /level-use/);
});

test("computed field recovery compiles both native slots including explicit Unique None", () => {
  const f = fixture();
  f.ability.type_id = "1";
  f.group.function1_value1 = "2";
  f.tables["function.csv"]!.push({ id: "802", type_id: "23", series_id: "0" });
  f.group.function2_id = "802";
  f.ability.content_flag_group_id = "71";
  f.tables["content_flag_group.csv"] = [
    { id: "11", group_id: "71", content_flag_id: "1" },
    { id: "12", group_id: "71", content_flag_id: "3" },
  ];
  f.ability.condition_group_id = "72";
  f.tables["condition_group.csv"] = [
    { id: "21", group_id: "72", condition_id: "6" },
    { id: "22", group_id: "72", condition_id: "13" },
  ];
  f.tables["condition.csv"] = [{ id: "6", condition_type: "6" }, { id: "13", condition_type: "13" }];
  // No battle program can compile from these references. It is deliberately
  // irrelevant to this independently decoded menu capability.
  f.ability.battle_function_group_id = "9999";
  f.ability.battle_renge_id = "999";
  const result = f.compile();
  const entry = result.catalog.abilities[901]!;
  assert.deepEqual(entry.program.contentFlags, [1, 3]);
  assert.deepEqual(entry.program.forbiddenConditionIds, [6, 13]);
  assert.deepEqual(entry.plan, {
    kind: "field-ability-plan-v1", modes: ["single", "all"], effects: [
      { slot: 1, kind: "recovery", resource: "hp", calculation: "magic" },
      { slot: 2, kind: "field-unique-none", resultType: 2 },
    ], magic: { accuracy: 100, contentFlags: [1], forceDefense: false, elements: [] },
  });
  assert.equal(result.report.plans, 1);
  assert.equal(entry.program.functions.length, entry.plan!.effects.length);
  assert.ok(result.sources.some(source => source.assetPath.endsWith("content_flag_group.csv") && source.rowId === "12"));
  f.ability.process_prog = "SYNTHETIC_UNIMPLEMENTED_PROCESS";
  assert.equal(f.compile().catalog.abilities[901]!.plan, null);
  f.ability.process_prog = "None";
  f.group.function2_value1 = "1";
  assert.equal(f.compile().catalog.abilities[901]!.plan, null);
  f.group.function2_value1 = "0";
  f.tables["content_flag_group.csv"]![1]!.content_flag_id = "99";
  assert.match(f.compile().catalog.abilities[901]!.blockers.join(), /content flags/);
});
