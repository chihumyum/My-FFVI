import assert from "node:assert/strict";
import test from "node:test";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { assessBattleHandoff, type FrameworkBattleHandoffPolicy } from "../src/core/battle-handoff-content.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { createBattleHandoffMusicLookup } from "../src/compiler/battle-handoff.js";

const policy = (): FrameworkBattleHandoffPolicy => ({ kind: "framework-battle-handoff-v1", id: "synthetic-staged-handoff",
  audio: "retain-field", introduction: "omit" });
function fixture() {
  const f = encounterRuntimeFixture();
  f.tables["monster_party.csv"] = f.input.encounters.map(encounter => ({ id: String(encounter.partyId),
    battle_background_asset_id: String(encounter.metadata.backgroundId), battle_bgm_asset_id: String(encounter.metadata.bgmId),
    appearance_production: String(encounter.metadata.appearanceProduction), not_escape: String(encounter.metadata.notEscape) }));
  f.tables["battle_background_asset.csv"] = [{ id: "1", asset_name: "SYNTHETIC_BACKGROUND" }];
  f.tables["battle_bgm_asset.csv"] = [{ id: "8", asset_name: "SYNTHETIC_BATTLE_MUSIC" }];
  return f;
}
test("absent opt-in never reads the new dependencies or changes the old encounter/report shape", () => {
  const f = encounterRuntimeFixture(), before = JSON.stringify(f.input);
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(JSON.stringify(f.input), before); assert.equal(result.report.compiledDefinitions, 2);
  assert.equal(Object.hasOwn(result.report, "handoffSources"), false);
  for (const encounter of Object.values(result.encounters)) assert.equal(Object.hasOwn(encounter, "handoff"), false);
  f.input.handoff = { policy: policy() };
  const opted = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(opted.report.compiledDefinitions, 0);
  assert.ok(opted.diagnostics.every(d => d.kind !== "blocked" || d.code === "battle-handoff-dependency"));
  assert.ok(opted.diagnostics.some(d => d.dependency?.table === "monster_party.csv" && d.dependency.id === 9201));
});
test("opt-in binds metadata and table provenance without granting source BGM, introduction or escape", () => {
  const f = fixture(), encounter = f.input.encounters[1]!;
  encounter.metadata.bgmId = 8; encounter.metadata.appearanceProduction = 1;
  f.tables["monster_party.csv"]![1]!.battle_bgm_asset_id = "8";
  f.tables["monster_party.csv"]![1]!.appearance_production = "1";
  f.input.handoff = { policy: policy() };
  const before = JSON.stringify(f.input), result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(JSON.stringify(f.input), before);
  const handoff = result.encounters[9202]!.handoff!;
  assert.deepEqual(handoff.source.metadata, { backgroundId: 1, bgmId: 8, appearanceProduction: 1, notEscape: 0 });
  assert.equal(handoff.source.row.objectId, "90071992547409937");
  assert.deepEqual(handoff.source.dependencies.map(d => [d.table, d.id]),
    [["monster_party.csv", 9202], ["battle_background_asset.csv", 1], ["battle_bgm_asset.csv", 8]]);
  assert.equal(assessBattleHandoff(handoff, "framework").status, "ready");
  assert.equal(assessBattleHandoff(handoff, "source").status, "blocked");
  assert.equal(Object.hasOwn(result.encounters[9202]!, "escapePolicy"), false);
  for (const code of ["battle-bgm", "appearance-production", "escape", "battle-handoff-policy"])
    assert.ok(result.diagnostics.some(d => d.partyId === 9202 && d.kind === "development-omission" && d.code === code), code);
  handoff.policy!.id = "changed";
  assert.equal(result.report.handoffSources!.find(s => s.partyId === 9202)!.content.policy!.id, policy().id);
});
test("source declarations without policy remain distinct from an authorized development handoff", () => {
  const f = fixture(); f.input.handoff = { policy: null };
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201]!.handoff!.policy, null);
  assert.equal(assessBattleHandoff(result.encounters[9201]!.handoff, "framework").status, "blocked");
  assert.equal(assessBattleHandoff(result.encounters[9201]!.handoff, "source").status, "blocked");
  assert.equal(result.diagnostics.some(d => d.code === "battle-handoff-policy"), false);
});
test("missing music data and substituted party metadata block only their selected encounter with exact references", () => {
  for (const problem of ["music", "metadata", "provenance"] as const) {
    const f = fixture(), encounter = f.input.encounters[1]!; f.input.handoff = { policy: policy() };
    if (problem === "music") { encounter.metadata.bgmId = 8; f.tables["monster_party.csv"]![1]!.battle_bgm_asset_id = "8"; f.tables["battle_bgm_asset.csv"] = []; }
    if (problem === "metadata") f.tables["monster_party.csv"]![1]!.not_escape = "2";
    if (problem === "provenance") encounter.source.objectId = "7";
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.ok(result.encounters[9201]); assert.equal(result.encounters[9202], undefined);
    const failure = result.diagnostics.find(d => d.partyId === 9202 && d.code === "battle-handoff-dependency")!;
    assert.equal(failure.kind, "blocked");
    assert.deepEqual(failure.dependency, problem === "music" ? { table: "battle_bgm_asset.csv", id: 8 } :
      { table: "monster_party.csv", id: 9202, ...(problem === "metadata" ? { field: "not_escape" } : {}) });
    assert.deepEqual(result.report.entries.map(e => [e.partyId, e.status]), [[9201, "compiled"], [9202, "blocked"]]);
  }
});
test("bound handoff declarations survive another blocked lane and do not discard requests or provenance", () => {
  const f = fixture(); f.input.handoff = { policy: policy() };
  f.input.encounters[1]!.enemies[0]!.sprite = "not-available";
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9202], undefined);
  assert.equal(result.report.handoffSources!.find(s => s.partyId === 9202)!.content.source.row.objectId, "90071992547409937");
  assert.deepEqual(result.report.entries.map(e => e.partyId), f.input.requestedPartyIds);
});

test("verified missing music keeps its declared ID and unknown binding under a nonconsuming development policy", () => {
  const f = fixture(), encounter = f.input.encounters[1]!; f.input.handoff = { policy: policy() };
  encounter.metadata.bgmId = 8; f.tables["monster_party.csv"]![1]!.battle_bgm_asset_id = "8";
  f.tables["battle_bgm_asset.csv"] = [];
  const reader = { ...f.reader(), handoffMusic: createBattleHandoffMusicLookup(f.tables, f.reader()) };
  const result = compileBattleEncounterRuntime(reader, f.input), handoff = result.encounters[9202]!.handoff!;
  assert.equal(handoff.source.metadata.bgmId, 8);
  assert.deepEqual(handoff.source.dependencies[2], { table: "battle_bgm_asset.csv", id: 8, binding: "unresolved", source: null,
    reason: "The complete verified battle_bgm_asset.csv has 0 rows and no row 8; native music resolution is unverified" });
  assert.equal(assessBattleHandoff(handoff, "framework").status, "ready");
  assert.equal(assessBattleHandoff(handoff, "source").status, "blocked");
  assert.ok(result.diagnostics.some(d => d.partyId === 9202 && d.kind === "development-omission" &&
    d.code === "battle-handoff-bgm-unresolved" && d.dependency?.id === 8));
});

test("complete-table resolution cannot hide corruption, duplicate rows, substituted provenance or selected-row absence", () => {
  const f = fixture();
  f.tables["battle_bgm_asset.csv"]!.push({ ...f.tables["battle_bgm_asset.csv"]![0]! });
  assert.throws(() => createBattleHandoffMusicLookup(f.tables, f.reader()), /ambiguous/);
  f.tables["battle_bgm_asset.csv"]!.pop(); f.tables["battle_bgm_asset.csv"]![0]!.id = "broken";
  assert.throws(() => createBattleHandoffMusicLookup(f.tables, f.reader()));
  f.tables["battle_bgm_asset.csv"]![0]!.id = "8";
  const missingProvenance = createBattleHandoffMusicLookup(f.tables, { row() { throw new Error("Missing source provenance"); } });
  assert.throws(() => missingProvenance(8), /provenance/);
  const wrong = createBattleHandoffMusicLookup(f.tables, { row(table, id) {
    const found = f.reader().row(table, id); return { ...found, values: { ...found.values, asset_name: "SUBSTITUTED" } };
  } });
  assert.throws(() => wrong(8), /row mismatch/);
  const selected = { ...f.tables, "battle_bgm_asset.csv": [] };
  const complete = createBattleHandoffMusicLookup(f.tables, f.reader());
  assert.equal(selected["battle_bgm_asset.csv"].length, 0);
  assert.equal(complete(8).binding, "bound", "Use full source rows instead of interpreting unselected capabilities as absent");
});

test("music resolver errors remain blocked dependencies instead of becoming nullable declarations", () => {
  const f = fixture(), encounter = f.input.encounters[1]!; f.input.handoff = { policy: policy() };
  encounter.metadata.bgmId = 8; f.tables["monster_party.csv"]![1]!.battle_bgm_asset_id = "8";
  const reader = { ...f.reader(), handoffMusic() { throw new Error("Ambiguous or corrupt source provenance"); } };
  const result = compileBattleEncounterRuntime(reader, f.input);
  assert.ok(result.encounters[9201]); assert.equal(result.encounters[9202], undefined);
  assert.equal(result.report.handoffSources!.some(s => s.partyId === 9202), false);
  assert.ok(result.diagnostics.some(d => d.partyId === 9202 && d.code === "battle-handoff-dependency" &&
    d.kind === "blocked" && d.reason.includes("corrupt source provenance") && d.dependency?.table === "battle_bgm_asset.csv"));
});
