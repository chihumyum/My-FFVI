import test from "node:test";
import assert from "node:assert/strict";
import { compileWalkEncounters, type WalkEncounterDevelopmentSettings } from "../src/compiler/walk-encounters.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import type { BattleCatalog } from "../src/core/battle-content.js";

function fixture() {
  const source = encounterRuntimeFixture();
  source.tables["map.csv"] = [{ id: "81", monster_set_id: "12", encount_area_grid_id: "0",
    required_steps_min: "2000", required_steps_max: "4000", subtract_steps: "120" }];
  const set = source.tables["monster_set.csv"] = [{ id: "12", ...Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [[`monster_set${index + 1}`, "0"], [`monster_set${index + 1}_rate`, "0"]]).flat()),
    monster_set1: "9202", monster_set1_rate: "80", monster_set2: "9201", monster_set2_rate: "80",
    monster_set3: "9202", monster_set3_rate: "16" }];
  const compiled = compileBattleEncounterRuntime(source.reader(), source.input);
  const base = checkpointFixture().battle;
  const catalog: BattleCatalog = { ...base,
    common: { ...base.common, abilities: structuredClone(source.input.abilities),
      sprites: structuredClone(source.input.sprites), drops: compiled.drops },
    encounters: compiled.encounters, encounterDiagnostics: compiled.diagnostics, encounterReport: compiled.report };
  const settings: WalkEncounterDevelopmentSettings = { id: "test-walking", minSteps: 3, maxSteps: 8, transportationIds: [1] };
  const compile = (development: WalkEncounterDevelopmentSettings | undefined = settings) =>
    compileWalkEncounters(source.reader(), 81, catalog, development);
  return { source, set: set[0]!, map: source.tables["map.csv"][0]!, catalog, settings, compile };
}

test("source inventory alone does not enable walking encounters or copy native threshold units", () => {
  const f = fixture();
  const result = compileWalkEncounters(f.source.reader(), 81, f.catalog);
  assert.equal(result.policy, null);
  assert.equal(result.slots.length, 16);
  assert.deepEqual(result.partyIds, [9201, 9202]);
  assert.equal(result.source.map!.source.rowId, "81");
  assert.equal(result.source.monsterSet!.source.rowId, "12");
  assert.deepEqual(result.sourceSteps, { requiredStepsMin: 2000, requiredStepsMax: 4000, subtractSteps: 120 });
  assert.equal(result.battleAnalysis.runtimeAdmission, "unassessed");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.limitations.some(reason => reason.startsWith("escape:")));
});

test("explicit development policy preserves the whole weighted pool and stable first-slot order", () => {
  const f = fixture(), before = structuredClone({ tables: f.source.tables, catalog: f.catalog, settings: f.settings });
  const result = f.compile();
  assert.deepEqual(result.policy, { kind: "framework-walk-encounters-v1", ...f.settings,
    parties: [{ partyId: 9202, weight: 96 }, { partyId: 9201, weight: 80 }] });
  assert.deepEqual(result.slots.slice(0, 4), [{ slot: 1, partyId: 9202, weight: 80 },
    { slot: 2, partyId: 9201, weight: 80 }, { slot: 3, partyId: 9202, weight: 16 }, { slot: 4, partyId: 0, weight: 0 }]);
  assert.deepEqual({ tables: f.source.tables, catalog: f.catalog, settings: f.settings }, before);
  result.source.map!.values.monster_set_id = "99";
  result.policy!.parties[0]!.weight = 1;
  result.policy!.transportationIds[0] = 6;
  assert.deepEqual({ tables: f.source.tables, catalog: f.catalog, settings: f.settings }, before);
  assert.deepEqual(f.compile(), compileWalkEncounters(f.source.reader(), 81, f.catalog, f.settings));
});

test("a missing positive-weight party blocks the entire policy without renormalizing survivors", () => {
  const f = fixture(); f.set.monster_set2 = "9999";
  const result = f.compile();
  assert.equal(result.policy, null);
  assert.deepEqual(result.partyIds, [9202, 9999]);
  assert.equal(result.slots[1]!.weight, 80);
  assert.ok(result.diagnostics.some(d => d.code === "battle-dependency" && d.partyId === 9999 && d.reason.includes("missing-encounter")));
  assert.equal(result.battleAnalysis.encounters.find(e => e.id === 9202)!.status, "ready");
});

test("conditional battle execution is visible and prevents policy generation", () => {
  const f = fixture(); f.catalog.common.abilities[13]!.plan = null;
  const result = f.compile();
  assert.equal(result.policy, null);
  assert.ok(result.diagnostics.some(d => d.code === "battle-conditional" && d.abilityId === 13));
  assert.deepEqual(result.partyIds, [9201, 9202]);
  assert.equal(result.slots.filter(s => s.weight > 0).reduce((sum, s) => sum + s.weight, 0), 176);
});

test("missing source compilation evidence cannot create a ready policy", () => {
  const f = fixture(); delete f.catalog.encounterReport; delete f.catalog.encounterDiagnostics;
  const result = f.compile();
  assert.equal(result.policy, null);
  assert.ok(result.diagnostics.some(d => d.code === "battle-conditional" && d.reason.includes("compiler-evidence-missing")));
});

test("zero source weights are retained but weighted empty slots and empty pools are unresolved", () => {
  const f = fixture(); f.set.monster_set4 = "9999";
  assert.ok(f.compile().policy, "Zero-weight source reference is not sampled or granted");
  assert.equal(f.compile().slots[3]!.partyId, 9999);
  f.set.monster_set4 = "0"; f.set.monster_set4_rate = "1";
  const weightedEmpty = f.compile();
  assert.equal(weightedEmpty.policy, null);
  assert.ok(weightedEmpty.diagnostics.some(d => d.code === "source-empty-party" && d.slot === 4));
  for (let slot = 1; slot <= 16; slot++) f.set[`monster_set${slot}_rate`] = "0";
  assert.equal(f.compile().policy, null);
  assert.ok(f.compile().diagnostics.some(d => d.code === "source-empty-pool"));
});

test("grid selection, missing rows and mismatched row identities remain explicit", () => {
  const f = fixture(); f.map.monster_set_id = "0"; f.map.encount_area_grid_id = "3";
  const grid = f.compile();
  assert.equal(grid.encountAreaGridId, 3);
  assert.equal(grid.policy, null);
  assert.ok(grid.diagnostics.some(d => d.code === "source-grid-selection"));
  f.map.monster_set_id = "99";
  assert.ok(f.compile().diagnostics.some(d => d.code === "source-reference"));
  const reader = f.source.reader();
  const mismatch = compileWalkEncounters({ row: (table, id) => {
    const row = reader.row(table, id); row.source.rowId = "82"; return row;
  } }, 81, f.catalog, f.settings);
  assert.equal(mismatch.policy, null);
  assert.ok(mismatch.diagnostics.some(d => d.reason.includes("Mismatched source identity")));
});

test("bad source fields and sampler overflow never become a partial policy", () => {
  const f = fixture(); delete f.set.monster_set16_rate;
  assert.equal(f.compile().policy, null);
  assert.ok(f.compile().diagnostics.some(d => d.code === "source-reference"));
  f.set.monster_set16_rate = "0"; f.set.monster_set1_rate = "-1";
  assert.equal(f.compile().policy, null);
  f.set.monster_set1_rate = "2147483647"; f.set.monster_set2_rate = "2147483647";
  const result = f.compile();
  assert.equal(result.policy, null);
  assert.ok(result.diagnostics.some(d => d.code === "source-weight-range"));
});

test("caller must explicitly supply valid development steps and transport identities even for a blocked map", () => {
  const f = fixture(); f.map.monster_set_id = "99";
  for (const change of [{ minSteps: 0 }, { maxSteps: 2 }, { maxSteps: 0x100000000 },
    { transportationIds: [] }, { transportationIds: [0] }, { transportationIds: [1, 1] }, { id: " " }, { id: " padded " }])
    assert.throws(() => f.compile({ ...f.settings, ...change }), /explicit development/);
  assert.throws(() => compileWalkEncounters(f.source.reader(), 0, f.catalog, f.settings), /map identity/);
});
