import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { BattleGame } from "../src/core/battle.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { aiSource } from "./fixtures/battle-ai.js";

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

test("unknown initial conditions and physical providers block their record without changing the supported one", () => {
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
  const content = { ...f.battle, ...result.encounters[9202]!, drops: result.drops };
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
  assert.throws(() => new BattleGame({ ...f.battle, ...result.encounters[9202]!, drops: result.drops }, 1), /unsupported AI instruction/);
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
