import test from "node:test";
import assert from "node:assert/strict";
import { compileAbilityProgram, compileDevelopmentAbility } from "../src/compiler/ability.js";
import { compileSourceConditionApplication, compileSourceControlCondition,
  hasSourceControlConditionLifecycle, sourceDoomPauseConditionTypes, compileSourceConditionRecoveryHit,
  compileSourceEnemyConditionTraits, compileSourceFreshPlayerConditionTraits } from "../src/compiler/source-condition-application.js";
import { compileFieldConditionCatalog } from "../src/compiler/field-conditions.js";
import { FieldConditions } from "../src/core/field-conditions.js";
import { conditionSpeedAbilityFixture } from "./fixtures/condition-speed.js";

function fixture(kind: "sleep" | "confusion" | "temptation" | "doom" = "sleep") {
  const f = conditionSpeedAbilityFixture("slow");
  const spec = { sleep: [7, 1, 9, 30, 1], confusion: [12, 1, 8, 1, 1],
    temptation: [630, 4, 17, 0, 0], doom: [404, 3, 2, 40, 0] }[kind]!;
  const control: Record<string, string> = { ...f.tables["condition.csv"]![0]!, id: "1907",
    condition_type: String(spec[0]), system_type: String(spec[1]), until_type: String(spec[2]),
    until_value: String(spec[3]), state_cover_unavailable: String(spec[4]),
    mes_id_name: kind === "temptation" ? "None" : "SYNTHETIC_CONTROL", erase_condition_group_id: "1" };
  f.tables["condition.csv"]!.push(control);
  Object.assign(f.ability, { type_id: "13", system_id: "5", accuracy_rate: "90",
    content_flag_group_id: "0", invalid_reflection: "1" });
  f.group.function1_value1 = "1907";
  const program = () => compileAbilityProgram(f.reader(), 801).program;
  const compile = () => compileSourceConditionApplication(f.reader(), program());
  const behavior = () => compileSourceControlCondition(f.reader(), f.reader().row("condition.csv", 1907), String,
    f.compile().catalog.rules.definitions);
  return { ...f, control, program, compileApplication: compile, compileControl: behavior };
}

test("all four control families bind independent source IDs and remain unassessed as applications", () => {
  for (const kind of ["sleep", "confusion", "temptation", "doom"] as const) {
    const f = fixture(kind), application = f.compileApplication(), condition = f.compileControl();
    assert.equal(application.runtimeAdmission, "unassessed");
    assert.equal(application.controlKind, kind); assert.deepEqual(application.blockers, []);
    assert.deepEqual(application.effect, { slot: 1, kind: "add-condition", conditionId: 1907, fixedHit: false, accuracy: 90 });
    assert.equal(condition.behavior?.kind, kind); assert.equal(condition.behavior?.id, 1907);
    assert.equal(condition.behavior?.name, kind === "temptation" ? "" : "SYNTHETIC_CONTROL");
    if (condition.behavior?.kind === "doom") assert.deepEqual(condition.behavior.pauseConditionTypes, [17, 627, 11]);
    assert.equal("plan" in application, false);
    assert.ok(application.requirements.includes("source-control-condition-active-owner"));
  }
  assert.deepEqual(sourceDoomPauseConditionTypes, [17, 627, 11]);
});

test("source Fn9 fixed hit and flag1 evasion bypass remain distinct from resistance bypass", () => {
  const f = fixture(); f.group.function1_value2 = "1";
  f.ability.content_flag_group_id = "91";
  f.tables["content_flag_group.csv"] = [{ id: "1", group_id: "91", content_flag_id: "1" }];
  const result = f.compileApplication();
  assert.equal(result.effect?.fixedHit, true); assert.equal(result.effect?.accuracy, 255);
  assert.deepEqual(f.program().contentFlags, [1]); assert.equal("ignoreResistance" in result.effect!, false);
});

test("source binding rejects changed full rules, process, flags, function operands and omitted companions", () => {
  for (const mutate of [
    (p: ReturnType<ReturnType<typeof fixture>["program"]>) => { p.rules.reaction_type = 1; },
    (p: ReturnType<ReturnType<typeof fixture>["program"]>) => { p.rules.unbound = 1; },
    (p: ReturnType<ReturnType<typeof fixture>["program"]>) => { p.process.values[2] = 1; },
    (p: ReturnType<ReturnType<typeof fixture>["program"]>) => { p.contentFlags = [1]; },
    (p: ReturnType<ReturnType<typeof fixture>["program"]>) => { p.functions[0]!.values[0] = 7; },
  ]) {
    const f = fixture(), p = f.program(); mutate(p);
    assert.throws(() => compileSourceConditionApplication(f.reader(), p), /differs|changed/);
  }
  const f = fixture(), original = f.program();
  f.group.function2_id = "501"; f.group.function2_value1 = "1907";
  assert.throws(() => compileSourceConditionApplication(f.reader(), original), /omitted or changed/);
  const complete = f.compileApplication();
  assert.equal(complete.effect, null); assert.match(complete.blockers.join(), /companion/);
});

test("unknown reserved operands and altered active lifecycle do not become a no-op or ordinary condition", () => {
  for (const [key, value] of [["function1_value2", "2"], ["function1_value3", "1"]]) {
    const f = fixture(); f.group[key!] = value!;
    assert.equal(f.compileApplication().effect, null); assert.match(f.compileApplication().blockers.join(), /operands/);
  }
  for (const key of ["parameter_group_id", "attribute_group_id", "species_group_id", "rate_type1",
    "target_type", "attack_target", "damage_number", "overlapped_type", "recovery_invalid"]) {
    const f = fixture(); f.control[key] = "1";
    assert.equal(hasSourceControlConditionLifecycle({ values: f.control }), false, key);
    assert.equal(f.compileApplication().effect, null, key);
  }
});

test("active resistance dictionaries retain their actual rows and dangling references block the definition", () => {
  const f = fixture("confusion"); f.control.condition_group_id = "9876";
  f.tables["condition_group.csv"] = [{ id: "1987", group_id: "9876", condition_id: "6", type_id: "0", invocation_rate: "100" }];
  const compiled = f.compileControl();
  assert.deepEqual(compiled.behavior?.resistanceProvider, { groupId: 9876, conditions: { 6: 0 } });
  assert.ok(compiled.sources.some(row => row.source.rowId === "1987"));
  f.tables["condition_group.csv"]![0]!.condition_id = "9999";
  const missing = f.compileControl(); assert.equal(missing.behavior, null); assert.ok(missing.blockers.length);
});

test("condition presentation dependencies and decimal object identities remain bound even without rendering", () => {
  const f = fixture(); f.control.battle_effect_asset_id = "987";
  f.tables["battle_effect_asset.csv"] = [{ id: "987", se_asset_id: "988", se_asset_id_2: "0", critical_se_asset_id: "0" }];
  f.tables["se_asset.csv"] = [{ id: "988", asset_name: "synthetic-condition-sound" }];
  const compiled = f.compileControl(); assert.deepEqual(compiled.sources.map(row => row.source.rowId), ["1907", "987", "988"]);
  f.tables["se_asset.csv"] = [];
  assert.throws(() => f.compileControl(), /Unresolved table row/);
  const identity = fixture(), p = identity.program(), reader = identity.reader();
  const changed = { ...reader, row: (table: string, id: string | number) => {
    const row = reader.row(table, id); return table === "ability.csv" ? { ...row, source: { ...row.source, rowId: "802" } } : row;
  } };
  assert.throws(() => compileSourceConditionApplication(changed, p), /identity mismatch/);
});

test("new battle-only control behaviors never become passive field states or checkpoint injections", () => {
  for (const kind of ["sleep", "confusion", "temptation", "doom"] as const) {
    const f = fixture(kind), battle = f.compile().catalog;
    assert.ok(battle.behaviors.some(b => b.id === 1907 && b.kind === kind));
    const field = compileFieldConditionCatalog(f.reader(), battle, [106]).catalog;
    assert.ok(field.definitions.some(d => d.id === 1907));
    assert.ok(!field.behaviors.some(b => b.id === 1907));
    assert.throws(() => new FieldConditions(field).validateActive([1907]), /Unimplemented active/);
  }
});

test("whole control abilities admit only their bounded type/system, flags and target contract", () => {
  for (const [kind, type] of [["sleep", "13"], ["confusion", "3"], ["temptation", "13"], ["doom", "504"]] as const) {
    const f = fixture(kind); f.ability.type_id = type;
    if (kind === "sleep") f.ability.battle_renge_id = "16";
    if (kind === "doom") {
      f.ability.content_flag_group_id = "91";
      f.tables["content_flag_group.csv"] = [{ id: "1", group_id: "91", content_flag_id: "1" }];
    }
    const action = compileDevelopmentAbility(f.reader(), 801, "Controlled source action");
    assert.deepEqual(action.blockers, []); assert.equal(action.plan?.effects[0]?.kind, "add-condition");
    assert.ok(action.limitations.some(text => text.includes("web-source-control-actions-v1")));
    if (kind === "sleep") assert.deepEqual(action.plan?.targeting, { life: "alive", relation: "enemy", modes: ["side"],
      defaultMode: "side", defaultRelation: "enemy", normalFormationOnly: true });
  }
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.ability.type_id = "999"; },
    (f: ReturnType<typeof fixture>) => { f.ability.system_id = "2"; },
    (f: ReturnType<typeof fixture>) => { f.ability.battle_renge_id = "10"; },
    (f: ReturnType<typeof fixture>) => { f.ability.attack_count = "1"; },
    (f: ReturnType<typeof fixture>) => { f.ability.reaction_type = "2"; },
    (f: ReturnType<typeof fixture>) => { f.ability.content_flag_group_id = "91";
      f.tables["content_flag_group.csv"] = [{ id: "1", group_id: "91", content_flag_id: "4" }]; },
  ]) { const f = fixture(); change(f); assert.equal(compileDevelopmentAbility(f.reader(), 801, "Unsupported").plan, null); }
});

test("recovery hit metadata follows Chanting and raw source function IDs, not the physical executor label", () => {
  const f = fixture(); f.tables["chanting.csv"] = [{ id: "199", ability_type_id: "13", for_ai_type_id: "1" }];
  const first = compileSourceConditionRecoveryHit(f.reader(), f.program());
  assert.deepEqual(first.metadata, { kind: "source-condition-recovery-hit-v1", forAiType: 1, isMagic: false });
  f.tables["function.csv"]![0]!.id = "3"; f.group.function1_id = "3";
  assert.equal(compileSourceConditionRecoveryHit(f.reader(), f.program()).metadata.isMagic, true,
    "native IsMagic checks the function row identity before generic effect type");
  f.tables["function.csv"]![0]!.id = "501"; f.group.function1_id = "501";
  f.tables["chanting.csv"]![0]!.for_ai_type_id = "2";
  assert.equal(compileSourceConditionRecoveryHit(f.reader(), f.program()).metadata.isMagic, true);
  f.tables["chanting.csv"]!.push({ ...f.tables["chanting.csv"]![0]!, id: "200" });
  assert.throws(() => compileSourceConditionRecoveryHit(f.reader(), f.program()), /ambiguous/);
  f.tables["chanting.csv"] = [];
  assert.throws(() => compileSourceConditionRecoveryHit(f.reader(), f.program()), /Unresolved table group chanting/);
});

test("enemy undead base bit retains the actual flag source and does not imply live zombie or accessory state", () => {
  const f = fixture(); f.tables["monster.csv"] = [{ id: "1999", monster_flag_group_id: "2999" }];
  f.tables["monster_flag_group.csv"] = [
    { id: "3001", group_id: "2999", monster_flag_id: "5" }, { id: "3002", group_id: "2999", monster_flag_id: "2" },
  ];
  const value = compileSourceEnemyConditionTraits(f.reader(), 1999);
  assert.deepEqual(value.metadata, { kind: "source-condition-traits-v1", baseUndead: true });
  assert.deepEqual(value.sources.map(row => row.source.rowId), ["1999", "3001", "3002"]);
  assert.equal("undead" in value.metadata, false);
  f.tables["monster_flag_group.csv"]!.pop();
  assert.equal(compileSourceEnemyConditionTraits(f.reader(), 1999).metadata.baseUndead, false);
  f.tables["monster_flag_group.csv"] = [];
  assert.throws(() => compileSourceEnemyConditionTraits(f.reader(), 1999), /Unresolved table group monster_flag_group/);
});

test("fresh player base trait requires its source initializer and does not grant Rampage or live equipment predicates", () => {
  const f = fixture(); f.tables["character_status.csv"] = [{ id: "1998", initial_condition_group: "0" }];
  assert.deepEqual(compileSourceFreshPlayerConditionTraits(f.reader(), 1998).metadata,
    { kind: "source-condition-traits-v1", baseUndead: false });
  f.tables["character_status.csv"]![0]!.initial_condition_group = "1";
  assert.throws(() => compileSourceFreshPlayerConditionTraits(f.reader(), 1998), /initialization/);
});
