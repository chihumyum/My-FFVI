import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleAbilityContent } from "../src/compiler/battle-ability-content.js";
import { compileDevelopmentAbility } from "../src/compiler/ability.js";
import { calculateDevelopmentEffects } from "../src/core/ability.js";
import { battleAbilityContentFixture } from "./fixtures/battle-ability-content.js";

test("complete source catalog preserves supported and blocked records without granting ownership", () => {
  const f = battleAbilityContentFixture();
  f.tables["ability.csv"]!.push({ ...f.ability, id: "902", process_prog: "UNIMPLEMENTED_SYNTHETIC_PROCESS" });
  f.tables["content.csv"]!.push({ ...f.content, id: "402", type_value: "902" });
  const before = structuredClone(f.tables);
  const result = compileBattleAbilityContent(f.reader(), f.tables, f.resolveName);
  assert.deepEqual(Object.keys(result.abilities), ["901", "902"]);
  assert.equal(result.abilities[901]!.name, "Synthetic recovery");
  assert.ok(result.abilities[901]!.plan);
  assert.equal(result.abilities[902]!.plan, null);
  assert.equal(result.entries[902]!.source.values.process_prog, "UNIMPLEMENTED_SYNTHETIC_PROCESS");
  assert.match(result.entries[902]!.blockers.join(), /unresolved process/);
  assert.deepEqual(result.abilityContentIds, { 901: 401, 902: 402 });
  assert.equal(result.report.total, 2);
  assert.equal(result.report.boundedHostPlans, 1);
  assert.equal(result.report.blocked, 1);
  assert.equal(result.report.ownershipGranted, false);
  assert.equal(result.report.originalGameExecuted, false);
  assert.ok(result.entries[901]!.requirements.includes("current-owned-command-qualification"));
  assert.ok(result.entries[901]!.requirements.includes("mp-payment-once"));
  assert.ok(result.entries[901]!.sources.every((s) => s.objectId === "9223372036854775807"));
  assert.deepEqual(f.tables, before);
  result.entries[901]!.source.values.standard_value = "999";
  result.entries[901]!.contents[0]!.values.mes_id_name = "changed";
  assert.deepEqual(f.tables, before);
});

test("None is intentionally empty source display, never an authored label or message lookup", () => {
  const f = battleAbilityContentFixture(); f.content.mes_id_name = "None";
  const result = compileBattleAbilityContent(f.reader(), f.tables, () => assert.fail("None must not be localized"));
  assert.deepEqual(result.entries[901]!.display, { kind: "none", nameKey: "None", text: "" });
  assert.equal(result.abilities[901]!.name, "");
  assert.ok(result.abilities[901]!.plan);
  assert.equal(result.report.display.none, 1);
});

test("missing or ambiguous display dependencies block a plan instead of guessing a source name", () => {
  for (const state of ["missing-message", "missing-content", "ambiguous-content"] as const) {
    const f = battleAbilityContentFixture();
    if (state === "missing-message") delete f.messages.SYNTHETIC_ABILITY_NAME;
    if (state === "missing-content") f.tables["content.csv"] = [];
    if (state === "ambiguous-content") f.tables["content.csv"]!.push({ ...f.content, id: "402" });
    const result = compileBattleAbilityContent(f.reader(), f.tables, f.resolveName);
    assert.equal(result.entries[901]!.display.kind, state);
    assert.equal(result.entries[901]!.arithmeticPlan, true);
    assert.equal(result.entries[901]!.execution, "blocked");
    assert.equal(result.abilities[901]!.plan, null);
    assert.equal(result.abilities[901]!.presentation, "unsupported");
    assert.equal(result.abilities[901]!.name, "");
    assert.equal(result.report.arithmeticPlans, 1);
    assert.equal(result.report.boundedHostPlans, 0);
    assert.equal(result.report.display[state], 1);
    assert.equal(result.abilityContentIds[901], state === "missing-message" ? 401 : null);
  }
});

test("source enumeration and all dispatch references must be consistent before a batch can publish", () => {
  const f = battleAbilityContentFixture();
  const reader = f.reader();
  const foreign = structuredClone(f.tables); foreign["ability.csv"]![0]!.standard_value = "51";
  assert.throws(() => compileBattleAbilityContent(reader, foreign, f.resolveName), /Mismatched.*enumeration/);
  f.group.function3_id = "999";
  assert.throws(() => compileBattleAbilityContent(f.reader(), f.tables, f.resolveName), /Unresolved table row/);
  f.group.function3_id = "0";
  f.tables["content.csv"]!.push({ ...f.content, id: "402", type_value: "999" });
  assert.throws(() => compileBattleAbilityContent(f.reader(), f.tables, f.resolveName), /Unresolved content ability/);
  f.tables["content.csv"]!.pop(); f.tables["ability.csv"]!.push({ ...f.ability });
  assert.throws(() => compileBattleAbilityContent(f.reader(), f.tables, f.resolveName), /Duplicate/);
});

test("recover groups preserve unsupported inactive references, order and repeated identity", () => {
  const f = battleAbilityContentFixture();
  f.tables["function.csv"]![0]!.type_id = "12";
  f.group.function1_value1 = "98"; f.group.function1_value2 = "0";
  f.tables["condition_group.csv"] = [
    { id: "201", group_id: "98", condition_id: "6" },
    { id: "202", group_id: "98", condition_id: "99" },
    { id: "203", group_id: "98", condition_id: "6" },
  ];
  f.tables["condition.csv"] = [{ id: "6", condition_type: "6" }, { id: "99", condition_type: "999" }];
  const result = compileBattleAbilityContent(f.reader(), f.tables, f.resolveName);
  assert.deepEqual(result.entries[901]!.conditionDependencies, { forbidden: [], added: [], recovered: [6, 99, 6] });
  assert.deepEqual(result.abilities[901]!.plan!.effects, [{ slot: 1, kind: "recover-condition", conditionIds: [6, 99, 6] }]);
  assert.ok(result.entries[901]!.requirements.includes("implemented-active-condition-behaviors"));
  assert.ok(result.sources.some((s) => s.assetPath.endsWith("condition.csv") && s.rowId === "99"));
});

test("physical, reflection and formation requirements are retained separately from arithmetic success", () => {
  const f = battleAbilityContentFixture();
  f.tables["function.csv"]![0]!.type_id = "2";
  f.group.function1_value1 = f.group.function1_value2 = "0";
  f.ability.invalid_reflection = "0"; f.ability.battle_renge_id = "6";
  const result = compileBattleAbilityContent(f.reader(), f.tables, f.resolveName);
  assert.ok(result.abilities[901]!.plan);
  const requirements = result.entries[901]!.requirements;
  for (const requirement of ["no-reflection-provider", "front-row-selected-arm-physical-inputs",
    "admitted-equipment-and-parameter-providers", "normal-formation-targeting", "source-chanting-and-atb-host"] as const)
    assert.ok(requirements.includes(requirement), requirement);
  // The source Function1Id is retained even when it differs from function.type.
  assert.equal(result.abilities[901]!.program.functions[0]!.functionId, 801);
  assert.equal(result.abilities[901]!.program.functions[0]!.type, 2);
});

test("ordinary magic preserves Runic targeting metadata without passing it as a damage modifier", () => {
  const f = battleAbilityContentFixture();
  f.ability.type_id = "2"; f.ability.system_id = "3"; f.ability.battle_renge_id = "6";
  f.ability.invalid_reflection = "0"; f.ability.content_flag_group_id = "71";
  f.tables["function.csv"]![0]!.type_id = "3"; f.group.function1_value2 = "0";
  f.tables["content_flag_group.csv"] = [
    { id: "11", group_id: "71", content_flag_id: "1" },
    { id: "12", group_id: "71", content_flag_id: "3" },
  ];
  const result = compileBattleAbilityContent(f.reader(), f.tables, f.resolveName);
  const definition = result.abilities[901]!;
  assert.deepEqual(definition.program.contentFlags, [1, 3]);
  assert.deepEqual(definition.plan!.magic!.contentFlags, [1]);
  assert.ok(result.entries[901]!.requirements.includes("no-runic-undead-or-other-value-overrides"));
  assert.ok(result.entries[901]!.requirements.includes("no-reflection-provider"));
  assert.ok(result.entries[901]!.requirements.includes("normal-formation-targeting"));
  let draws = 0;
  const effects = calculateDevelopmentEffects(definition.plan!, definition.power,
    { level: 1, magic: 10, attack: 0, attackElements: [], side: "player" },
    { defense: 0, magicDefense: 0, evasion: 0, magicEvasion: 128, elementResistances: {}, side: "enemy", conditionTypes: [] },
    (min, max) => { assert.deepEqual([min, max], [0, 31]); draws++; return 0; });
  assert.equal(effects[0]!.missed, false); assert.equal(draws, 1);
  f.tables["content_flag_group.csv"]![1]!.content_flag_id = "99";
  assert.equal(compileDevelopmentAbility(f.reader(), 901, "Synthetic").plan, null);
});

test("white-magic computed recovery reuses the reviewed formula but does not admit arbitrary type-one effects", () => {
  const f = battleAbilityContentFixture(); f.ability.type_id = "1";
  f.group.function1_value1 = "2";
  const result = compileBattleAbilityContent(f.reader(), f.tables, f.resolveName);
  assert.equal(result.abilities[901]!.plan!.effects[0]!.kind, "recovery");
  assert.ok(result.abilities[901]!.plan!.magic);
  f.ability.ability_lv = "1";
  assert.match(compileDevelopmentAbility(f.reader(), 901, "Synthetic").blockers.join(), /level-specific/);
  f.ability.ability_lv = "0";
  f.tables["function.csv"]![0]!.type_id = "2";
  f.group.function1_value1 = f.group.function1_value2 = "0";
  assert.equal(compileDevelopmentAbility(f.reader(), 901, "Synthetic").plan, null);
});

test("native play-time and level-use resource providers cannot inherit scalar MP consumption", () => {
  const f = battleAbilityContentFixture();
  f.ability.id = "154"; f.content.type_value = "154";
  const result = compileBattleAbilityContent(f.reader(), f.tables, f.resolveName);
  assert.equal(result.abilities[154]!.plan, null);
  assert.match(result.abilities[154]!.blockers.join(), /play-time/);
  f.ability.id = "901"; f.content.type_value = "901"; f.ability.ability_lv = "2";
  const levelUse = compileBattleAbilityContent(f.reader(), f.tables, f.resolveName);
  assert.equal(levelUse.entries[901]!.arithmeticPlan, true);
  assert.equal(levelUse.abilities[901]!.plan, null);
  assert.match(levelUse.entries[901]!.blockers.join(), /level-specific/);
});

test("source all-target override requires an already equivalent content flag in the scalar host", () => {
  const f = battleAbilityContentFixture();
  f.ability.id = "59"; f.content.type_value = "59";
  f.ability.type_id = "2"; f.ability.system_id = "3"; f.ability.battle_renge_id = "4";
  f.tables["function.csv"]![0]!.type_id = "3"; f.group.function1_value2 = "0";
  assert.match(compileDevelopmentAbility(f.reader(), 59, "Synthetic").blockers.join(), /all-target magic correction provider/);
  f.ability.content_flag_group_id = "71";
  f.tables["content_flag_group.csv"] = [{ id: "11", group_id: "71", content_flag_id: "2" }];
  const definition = compileDevelopmentAbility(f.reader(), 59, "Synthetic");
  assert.ok(definition.plan);
  assert.deepEqual(definition.program.contentFlags, [2]);
  assert.deepEqual(definition.plan.magic!.contentFlags, [2]);
});
