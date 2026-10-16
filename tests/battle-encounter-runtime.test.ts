import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { BattleGame } from "../src/core/battle.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { aiSource } from "./fixtures/battle-ai.js";
import { encounterContent } from "../src/core/battle-content.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";

function automaticRangeFixture(range: number, system = 1) {
  const f = encounterRuntimeFixture(), ability = f.input.abilities[13]!;
  ability.program.range = range;
  ability.plan!.targeting = compileTargetRule(range, system)!;
  return f;
}

function contentFor(f: ReturnType<typeof encounterRuntimeFixture>, result: ReturnType<typeof compileBattleEncounterRuntime>, id: number, seed = 1) {
  return encounterContent({ ...checkpointFixture().battle,
    common: { ...f.battle, drops: result.drops }, encounters: result.encounters }, id, seed)!;
}

test("arbitrary encounter IDs preserve repeated monsters, source slots and placement through the shared compiler", () => {
  const f = encounterRuntimeFixture(), e = f.input.encounters[0]!;
  e.enemies.push({ ...structuredClone(e.enemies[0]!), slot: 9, group: 2, x: -20, y: 13 });
  const before = JSON.stringify(f.input), result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(JSON.stringify(f.input), before);
  assert.deepEqual(result.encounters[9201]!.enemies.map((m) => [m.id, m.sourceId, m.hp, m.exp, m.gil, m.placement]), [
    ["enemy:5", 9101, 35, 8, 7, { x: 12, y: -8, group: 1 }],
    ["enemy:9", 9101, 35, 8, 7, { x: -20, y: 13, group: 2 }],
  ]);
  assert.equal(result.report.compiledDefinitions, 2);
  assert.deepEqual(result.drops.monsters.map((m) => m.id), [9101, 9102]);
  assert.equal(result.report.originalGameExecuted, false);
});

test("a missing monster removes only its encounter and retains dependency diagnostics", () => {
  const f = encounterRuntimeFixture(); f.tables["monster.csv"]!.pop();
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.deepEqual(Object.keys(result.encounters), ["9201"]);
  assert.equal(result.report.blocked, 1);
  assert.ok(result.diagnostics.some((d) => d.partyId === 9202 && d.kind === "blocked" &&
    d.enemySlot === 5 && d.dependency?.table === "monster.csv" && d.dependency.id === 9102));
  assert.deepEqual(result.drops.monsters.map((m) => m.id), [9101]);
});

test("unknown initial conditions, physical providers and resistance groups block only their dependent record", () => {
  for (const field of ["initial_condition", "attack_plus", "resistance_condition"]) {
    const f = encounterRuntimeFixture(); f.tables["monster.csv"]![1]![field] = "22";
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.deepEqual(Object.keys(result.encounters), ["9201"]);
    assert.ok(result.diagnostics.some((d) => d.partyId === 9202 && d.reason.includes(field + "=22")));
  }
});

test("missing media and missing ability definitions do not become implicit empty input", () => {
  for (const cause of ["media", "ability"] as const) {
    const f = encounterRuntimeFixture(), enemy = f.input.encounters[1]!.enemies[0]!;
    if (cause === "media") enemy.sprite = "missing";
    else enemy.ai.data = aiSource([["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [999]],
      ["EndTable"], ["JumpBattleAI", [0]]]);
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.deepEqual(Object.keys(result.encounters), ["9201"]);
    assert.ok(result.diagnostics.some((d) => d.partyId === 9202 && d.kind === "blocked" &&
      (cause === "media" ? d.reason.includes("sprite") : d.dependency?.id === 999)));
  }
});

test("unimplemented conditional abilities retain source PCs and the live battle gate", () => {
  const f = encounterRuntimeFixture();
  f.input.encounters[1]!.enemies[0]!.ai.data = aiSource([
    ["Nop"], ["SyncAI"], ["IsLevelCheck", [1, 7, 7]], ["StartTable", [0]], ["Act", [13]],
    ["EndTable"], ["JumpBattleAI", [0]], ["StartTable", [0]], ["Act", [12]], ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.report.compiledDefinitions, 2);
  assert.equal(result.report.withRuntimeDependencies, 1);
  assert.ok(result.diagnostics.some((d) => d.partyId === 9202 && d.kind === "runtime-dependency" &&
    d.pc === 8 && d.dependency?.id === 12));
  const content = contentFor(f, result, 9202);
  assert.doesNotThrow(() => new BattleGame(content, 1));
  content.players[0]!.level = 7;
  assert.throws(() => new BattleGame(content, 1), /unimplemented ability 12/);
});

test("unimplemented AI opcodes survive for the runtime instead of being converted to no-op", () => {
  const f = encounterRuntimeFixture();
  f.input.encounters[1]!.enemies[0]!.ai.data = aiSource([["Nop"], ["SyncAI"], ["NotImplemented"], ["JumpBattleAI", [0]]]);
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9202]!.enemies[0]!.ai!.instructions[2]!.op.kind, "blocked");
  assert.ok(result.diagnostics.some((d) => d.kind === "runtime-dependency" && d.pc === 2));
  assert.throws(() => new BattleGame(contentFor(f, result, 9202), 1), /unsupported AI instruction/);
});

test("ordinary and repeated AI actions admit the shared source range matrix without rewriting menu defaults", () => {
  for (const range of [1, 2, 4, 5, 6, 8, 9, 14, 20, 21]) {
    const f = automaticRangeFixture(range);
    f.input.encounters[1]!.enemies[0]!.ai.data = aiSource([
      ["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [13]],
      ["LoopAct", [13], [3]], ["EndTable"], ["JumpBattleAI", [0]],
    ]);
    const before = JSON.stringify(f.input), result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.report.compiledDefinitions, 2, "range " + range);
    assert.equal(result.report.withRuntimeDependencies, 0, "range " + range);
    assert.equal(JSON.stringify(f.input), before, "The compiler preserves source programs and menu defaults");
    assert.deepEqual(result.encounters[9202]!.enemies[0]!.abilities, [13]);
    assert.deepEqual(result.encounters[9202]!.enemies[0]!.ai!.instructions[4]!.op,
      { kind: "loop-act", abilities: [13], counts: [3] });
    if (range === 20) {
      assert.equal(f.input.abilities[13]!.plan!.targeting.defaultMode, "side");
      assert.equal(f.input.abilities[13]!.plan!.targeting.defaultRelation, "ally");
    }
  }
});

test("a future CounterAct retains unsupported target dependencies while exact source self dispatch admits", () => {
  for (const range of [1, 2, 4, 5, 6, 8, 9, 14, 20, 21]) {
    const f = automaticRangeFixture(range);
    f.input.encounters[1]!.enemies[0]!.ai.data = aiSource([
      ["Nop"], ["SyncAI"], ["IsLevelCheck", [1, 7, 7]], ["StartTable", [0]], ["Act", [13]],
      ["EndTable"], ["JumpBattleAI", [0]], ["StartTable", [0]], ["CounterAct", [13]],
      ["EndTable"], ["JumpBattleAI", [0]],
    ]);
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.report.compiledDefinitions, 2, "range " + range);
    assert.equal(result.report.withRuntimeDependencies, range === 5 ? 0 : 1, "range " + range);
    const dependencies = result.diagnostics.filter(d => d.code === "automatic-target");
    assert.equal(dependencies.length, range === 5 ? 0 : 1, "Self is dispatched by its source branch; other counter scopes stay bounded");
    if (range === 5) {
      assert.equal(result.encounters[9202]!.enemies[0]!.ai!.instructions[8]!.op.kind, "counter-act");
      continue;
    }
    const diagnostic = dependencies[0]!;
    assert.deepEqual([diagnostic.partyId, diagnostic.enemySlot, diagnostic.pc, diagnostic.kind, diagnostic.dependency],
      [9202, 5, 8, "runtime-dependency", { table: "ability.csv", id: 13 }]);
    assert.match(diagnostic.reason, /counter target range/);
    assert.equal(result.encounters[9202]!.enemies[0]!.ai!.instructions[8]!.op.kind, "counter-act");
  }
});

test("existing range 3 and 7 CounterAct support remains separate from ordinary range expansion", () => {
  for (const range of [3, 7]) {
    const f = automaticRangeFixture(range);
    f.input.encounters[1]!.enemies[0]!.ai.data = aiSource([
      ["Nop"], ["SyncAI"], ["CounterAct", [13]], ["SyncAI"], ["JumpBattleAI", [0]],
    ]);
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.report.withRuntimeDependencies, 0);
    assert.equal(result.encounters[9202]!.enemies[0]!.ai!.instructions[2]!.op.kind, "counter-act");
  }
});

test("a compiled plan cannot use a contradictory or unsupported automatic target contract", () => {
  for (const fault of ["source-range", "side-mode", "life", "unknown-range"] as const) {
    const f = automaticRangeFixture(20), ability = f.input.abilities[13]!;
    if (fault === "source-range") ability.program.range = 3;
    if (fault === "side-mode") ability.plan!.targeting.modes = ["single"];
    if (fault === "life") ability.plan!.targeting.life = "include-fallen-players";
    if (fault === "unknown-range") ability.program.range = 999;
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    const diagnostic = result.diagnostics.find(d => d.partyId === 9202 && d.code === "automatic-target")!;
    assert.ok(diagnostic, fault);
    assert.deepEqual([diagnostic.kind, diagnostic.pc, diagnostic.dependency],
      ["runtime-dependency", 3, { table: "ability.csv", id: 13 }]);
    assert.equal(result.report.withRuntimeDependencies, 2);
  }
});

test("automatic range support does not grant unknown initial conditions or source flag policies", () => {
  for (const fault of ["initial-condition", "flags"] as const) {
    const f = automaticRangeFixture(20), encounter = f.input.encounters[1]!;
    assert.equal(compileBattleEncounterRuntime(f.reader(), f.input).report.withRuntimeDependencies, 0);
    if (fault === "initial-condition") f.tables["monster.csv"]![1]!.initial_condition = "22";
    else {
      encounter.metadata.battleFlagGroupId = 18;
      encounter.metadata.battleFlags = [{ source: f.rowSource("battle_flag_group.csv", 19),
        values: { id: "19", group_id: "18", battle_flag_id: "20" } }];
    }
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.deepEqual(Object.keys(result.encounters), ["9201"]);
    assert.equal(result.report.blocked, 1);
    assert.ok(result.diagnostics.some(d => d.partyId === 9202 && d.kind === "blocked" &&
      (fault === "initial-condition" ? d.reason.includes("initial_condition=22") : d.code === "battle-flags")));
  }
});

test("battle scripts require an exact explicit development binding and remain reported omissions", () => {
  const f = encounterRuntimeFixture(), encounter = f.input.encounters[1]!;
  encounter.metadata.scriptId = 17;
  encounter.script = { source: { ...f.aiIdentity, assetPath: "synthetic/battle-script.json" }, data: {} };
  const blocked = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.deepEqual(Object.keys(blocked.encounters), ["9201"]);
  assert.ok(blocked.diagnostics.some((d) => d.code === "battle-script" && d.kind === "blocked"));
  f.input.development.scripts = [{ id: 17, source: structuredClone(encounter.script.source), reason: "Synthetic explicit omission" }];
  const allowed = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.ok(allowed.encounters[9202]);
  assert.ok(allowed.diagnostics.some((d) => d.code === "battle-script" && d.kind === "development-omission"));
  encounter.script.source.sha256 = "changed";
  assert.equal(compileBattleEncounterRuntime(f.reader(), f.input).encounters[9202], undefined);
});

test("special party rewards and changed flag rows cannot inherit an unrelated omission", () => {
  const f = encounterRuntimeFixture(), encounter = f.input.encounters[1]!;
  encounter.metadata.getAp = 1;
  assert.equal(compileBattleEncounterRuntime(f.reader(), f.input).encounters[9202], undefined);
  encounter.metadata.getAp = 0;
  encounter.metadata.battleFlagGroupId = 18;
  encounter.metadata.battleFlags = [{ source: f.rowSource("battle_flag_group.csv", 19),
    values: { id: "19", group_id: "18", battle_flag_id: "20" } }];
  f.input.development.flagGroups = [{ id: 18, rows: structuredClone(encounter.metadata.battleFlags), reason: "Explicit synthetic omission" }];
  assert.ok(compileBattleEncounterRuntime(f.reader(), f.input).encounters[9202]);
  encounter.metadata.battleFlags[0]!.values.battle_flag_id = "21";
  assert.equal(compileBattleEncounterRuntime(f.reader(), f.input).encounters[9202], undefined);
});

test("an unresolved reachable drop blocks only encounters containing its monster", () => {
  const f = encounterRuntimeFixture(), monster = f.tables["monster.csv"]![1]!;
  monster.drop_rate = "100"; monster.drop_content_id1 = "888"; monster.drop_content_id1_value = "1";
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.deepEqual(Object.keys(result.encounters), ["9201"]);
  assert.ok(result.diagnostics.some((d) => d.partyId === 9202 && d.code === "monster-drops" && d.reason.includes("888")));
  assert.deepEqual(result.drops.contents, []);
});

test("source failures remain in the same report while valid encounter compilation continues", () => {
  const f = encounterRuntimeFixture();
  f.input.requestedPartyIds = [9201, 9202, 9203];
  f.input.sourceDiagnostics = [{ partyId: 9203, code: "table-reference", reason: "Missing selected party", source: null,
    dependency: { table: "monster_party.csv", id: 9203 } }];
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.deepEqual(result.report.entries.map((e) => [e.partyId, e.status]), [[9201, "compiled"], [9202, "compiled"], [9203, "blocked"]]);
  assert.equal(result.diagnostics.filter((d) => d.partyId === 9203).length, 1);
  assert.equal(result.diagnostics.find((d) => d.partyId === 9203)!.kind, "blocked");
});

test("duplicate selections and corrupt shared reward rules still reject the whole batch", () => {
  const f = encounterRuntimeFixture(); f.input.requestedPartyIds = [9201, 9201];
  assert.throws(() => compileBattleEncounterRuntime(f.reader(), f.input), /selection/);
  f.input.requestedPartyIds = [9201, 9202];
  f.tables["game_constant_int.csv"]!.pop();
  assert.throws(() => compileBattleEncounterRuntime(f.reader(), f.input), /MONSTER_DROP_RATE_8/);
});

test("source eligibility remains complete and multi-pattern entry requires an authored selection plan", () => {
  const f = encounterRuntimeFixture(), source = f.input.encounters[1]!;
  source.patterns = [1, 1, 1, 1, 1, 1];
  let result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9202], undefined);
  assert.ok(result.diagnostics.some(d => d.partyId === 9202 && d.code === "formation-selection" && d.kind === "blocked"));
  f.input.development.formations = { kind: "framework-battle-formations-v1", id: "authored-normal", weights: [5, 0, 0, 0, 0, 0] };
  result = compileBattleEncounterRuntime(f.reader(), f.input);
  const encounter = result.encounters[9202]!;
  assert.equal(encounter.formation, null, "Compilation does not select a runtime branch");
  assert.deepEqual(encounter.formationPlan!.patterns, source.patterns);
  assert.equal(result.encounters[9201]!.formationPlan!.kind, "fixed", "Existing fixed entries do not acquire a new lottery");
  assert.ok(result.diagnostics.some(d => d.partyId === 9202 && d.code === "formation-selection" && d.kind === "development-omission"));
  const content = contentFor(f, result, 9202, 17);
  assert.equal(content.formation, "normal");
  assert.equal(content.formationChoice!.seed, 17);
  assert.doesNotThrow(() => new BattleGame(content, 17));
  assert.throws(() => new BattleGame(content, 18), /formation choice/);
  assert.throws(() => encounterContent({ ...checkpointFixture().battle, encounters: result.encounters }, 9202), /seed/);
});

test("unimplemented positive weights never get filtered and forced side attack cannot inherit an omission", () => {
  const f = encounterRuntimeFixture(), source = f.input.encounters[1]!;
  source.patterns = [1, 1, 1, 0, 0, 0];
  f.input.development.formations = { kind: "framework-battle-formations-v1", id: "invalid", weights: [1, 1, 0, 0, 0, 0] };
  let result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9202], undefined);
  assert.ok(result.diagnostics.some(d => d.code === "formation-selection" && d.reason.includes("Unsupported")));
  f.input.development.formations.weights[1] = 0;
  source.metadata.battleFlagGroupId = 8;
  source.metadata.battleFlags = [{ source: f.rowSource("battle_flag_group.csv", 8),
    values: { id: "8", group_id: "8", battle_flag_id: "27" } }];
  f.input.development.flagGroups = [{ id: 8, rows: structuredClone(source.metadata.battleFlags), reason: "Cannot waive mechanics" }];
  result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9202], undefined);
  assert.ok(result.diagnostics.some(d => d.code === "formation-override" && d.kind === "blocked"));
  assert.ok(result.encounters[9201]);
});

test("ability formation dependencies cover every reachable branch, not a sampled normal branch", () => {
  const f = encounterRuntimeFixture();
  f.input.encounters[1]!.patterns = [1, 0, 1, 0, 0, 0];
  f.input.abilities[13]!.program.range = 6;
  f.input.abilities[13]!.plan!.targeting = compileTargetRule(6, 1)!;
  f.input.development.formations = { kind: "framework-battle-formations-v1", id: "both", weights: [1, 0, 1, 0, 0, 0] };
  let result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.ok(result.diagnostics.some(d => d.partyId === 9202 && d.code === "ability-formation" && d.kind === "runtime-dependency"));
  f.input.development.formations.weights[2] = 0;
  result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.ok(!result.diagnostics.some(d => d.code === "ability-formation"));
});

test("an unresolved or tampered compiled formation cannot bypass entry resolution", () => {
  const f = encounterRuntimeFixture();
  f.input.encounters[0]!.patterns = [1, 0, 1, 0, 0, 0];
  f.input.development.formations = { kind: "framework-battle-formations-v1", id: "both", weights: [1, 0, 1, 0, 0, 0] };
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  const unresolved = { ...f.battle, ...result.encounters[9201]! };
  assert.throws(() => new BattleGame(unresolved as never, 1), /unresolved/);
  result.encounters[9201]!.formation = "normal";
  assert.throws(() => contentFor(f, result, 9201), /premature/);
  result.encounters[9202]!.formation = "opposed";
  assert.throws(() => contentFor(f, result, 9202), /Inconsistent/);
});
