import test from "node:test";
import assert from "node:assert/strict";
import { compileSourceWalkEncounterDependencies } from "../src/compiler/world.js";
import { analyzeContentDependencies, validateSourceWalkEncounterDependencies } from "../src/compiler/content-dependencies.js";
import type { BattleRow } from "../src/compiler/battle.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

function fixture() {
  const f = checkpointFixture(), map = structuredClone(f.target), catalog = structuredClone(f.world), mapId = map.mapId;
  const source = { file: "controlled-master.bundle", assetPath: "Controlled/monster_set.csv", objectId: "9007199254740993",
    serializedFile: "controlled-serialized", rowId: "154" };
  const values: Record<string, string> = { id: "154", retained_source_field: "observed-extra" };
  for (let i = 1; i <= 16; i++) { values[`monster_set${i}`] = "0"; values[`monster_set${i}_rate`] = "0"; }
  Object.assign(values, { monster_set1: "375", monster_set1_rate: "80", monster_set2: "374", monster_set2_rate: "80",
    monster_set3: "126", monster_set3_rate: "0", monster_set4: "126", monster_set4_rate: "16" });
  const master: BattleRow = { source: { ...source, assetPath: "Controlled/map.csv", rowId: String(mapId) },
    values: { id: String(mapId), monster_set_id: "154", required_steps_min: "21", required_steps_max: "75",
      subtract_steps: "3", encount_area_grid_id: "0", encount_effect_id: "5" } };
  const set: BattleRow = { source, values };
  let missing = false;
  const reader = { row(table: string): BattleRow {
    if (table === "map.csv") return master;
    if (table === "monster_set.csv" && !missing) return set;
    throw new Error("Controlled missing table/row");
  } };
  const compile = () => compileSourceWalkEncounterDependencies(reader, mapId);
  // Read-only structural graph fixture, not a source story or battle oracle.
  map.scripts = {}; map.scriptLocals = {}; map.initializer = null;
  const point = map.map!.groups!.entity_default!.entities.find(entity => entity.kind === 0)!;
  map.map!.entities = [point]; map.map!.groups!.entity_default!.entities = [point];
  map.map!.groups!.entity_default!.blockers = []; map.blockers = [];
  catalog.maps[String(mapId)]!.blockers = [];
  const analyze = () => analyzeContentDependencies({ catalog, maps: [map], mapIds: [mapId],
    roots: [{ kind: "entry", mapId, entrance: point.objectId!, continuation: null }] });
  return { mapId, map, master, set, compile, analyze, missing() { missing = true; } };
}

test("source walking metadata preserves the complete selected row and all 16 raw slots without lending ownership", () => {
  const f = fixture(), before = structuredClone(f.set), result = f.compile();
  validateSourceWalkEncounterDependencies(result, f.mapId);
  assert.equal(result.slots.length, 16); assert.equal(result.set!.values.retained_source_field, "observed-extra");
  assert.equal(result.slots[3]!.rawRate, "16"); assert.equal(result.slots[2]!.rate, 0);
  assert.equal(result.set!.source.objectId, "9007199254740993");
  assert.deepEqual(result.map.values, f.master.values);
  assert.equal(result.set!.source.rowId, "154"); assert.equal(result.slots[0]!.source.pointer, "/id/154/monster_set1");
  result.map.values.required_steps_min = "changed";
  result.set!.values.monster_set1 = "changed"; result.slots[0]!.source.pointer = "/changed";
  assert.deepEqual(f.set, before);
  assert.equal(f.master.values.required_steps_min, "21");
});

test("source walking parties including zero-rate and repeated slots enter the complete encounter graph", () => {
  const f = fixture(); f.map.sourceWalkEncounters = f.compile(); const graph = f.analyze();
  assert.deepEqual(graph.encounterIds, [126, 374, 375]);
  assert.equal(graph.edges.filter(edge => edge.kind === "encounter").length, 4);
  assert.ok(graph.diagnostics.some(d => d.code === "source-walk-encounter-policy-unimplemented"));
  assert.equal(graph.referenceClosure, "incomplete"); assert.equal(graph.runtimeAdmission, "unassessed");
  assert.equal(f.map.walkEncounters, undefined, "Metadata never creates a runtime walking policy");
});

test("missing and malformed rates never erase otherwise valid source party references", () => {
  for (const raw of [undefined, "unknown", "-1", "1.5"] as const) {
    const f = fixture(); if (raw === undefined) delete f.set.values.monster_set1_rate; else f.set.values.monster_set1_rate = raw;
    f.map.sourceWalkEncounters = f.compile(); assert.equal(f.map.sourceWalkEncounters.slots[0]!.rate, null);
    const graph = f.analyze(); assert.deepEqual(graph.encounterIds, [126, 374, 375]);
    assert.ok(graph.diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
  }
});

test("missing set tables or rows and invalid master values remain explicit binding failures", () => {
  const f = fixture(); f.missing(); f.map.sourceWalkEncounters = f.compile();
  assert.equal(f.map.sourceWalkEncounters.set, null);
  assert.ok(f.analyze().diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
  for (const raw of [undefined, "-1", "invalid", "2147483648"] as const) {
    const g = fixture(); if (raw === undefined) delete g.master.values.monster_set_id; else g.master.values.monster_set_id = raw;
    g.map.sourceWalkEncounters = g.compile(); assert.equal(g.map.sourceWalkEncounters.monsterSetId, null);
    assert.ok(g.analyze().diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
  }
});

test("source set zero stays an explicit no-set configuration while developer walking declarations remain separate", () => {
  const f = fixture(); f.master.values.monster_set_id = "0"; f.map.sourceWalkEncounters = f.compile();
  validateSourceWalkEncounterDependencies(f.map.sourceWalkEncounters, f.mapId);
  assert.equal(f.map.sourceWalkEncounters.set, null); assert.deepEqual(f.map.sourceWalkEncounters.slots, []);
  assert.equal(f.analyze().diagnostics.some(d => d.code.startsWith("source-walk-")), false);
  f.map.walkEncounters = { kind: "framework-walk-encounters-v1", id: "controlled-walking", minSteps: 2, maxSteps: 3,
    transportationIds: [1], parties: [{ partyId: 30, weight: 1 }] };
  assert.deepEqual(f.analyze().encounterIds, [30]);
});

test("resealed metadata/header or slot mismatches cannot hide valid raw dependencies or achieve closure", () => {
  const f = fixture(); f.map.sourceWalkEncounters = f.compile();
  f.map.sourceWalkEncounters.slots[0]!.partyId = 999;
  assert.throws(() => validateSourceWalkEncounterDependencies(f.map.sourceWalkEncounters!, f.mapId), /binding mismatch/);
  assert.deepEqual(f.analyze().encounterIds, [126, 374, 375]);
  assert.ok(f.analyze().diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
  f.map.sourceWalkEncounters = f.compile(); f.map.sourceWalkEncounters.mapId += 1;
  assert.ok(f.analyze().diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
});

test("unknown additional source slots retain their positive references and an unreviewed-schema blocker", () => {
  const f = fixture(); f.set.values.monster_set17 = "999"; f.set.values.monster_set17_rate = "0";
  f.map.sourceWalkEncounters = f.compile(); assert.equal(f.map.sourceWalkEncounters.slots.length, 17);
  assert.deepEqual(f.analyze().encounterIds, [126, 374, 375, 999]);
  assert.ok(f.analyze().diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
});

test("a source area-grid reference remains blocked even when the master default monster set is zero", () => {
  const f = fixture(); f.master.values.monster_set_id = "0"; f.master.values.encount_area_grid_id = "2";
  f.map.sourceWalkEncounters = f.compile(); validateSourceWalkEncounterDependencies(f.map.sourceWalkEncounters, f.mapId);
  assert.equal(f.map.sourceWalkEncounters.map.values.encount_area_grid_id, "2");
  assert.equal(f.map.sourceWalkEncounters.set, null); assert.deepEqual(f.analyze().encounterIds, []);
  assert.ok(f.analyze().diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid" && /area-grid/.test(d.reason)));
  assert.equal(f.map.walkEncounters, undefined);
  f.map.sourceWalkEncounters.blockers = [];
  assert.throws(() => validateSourceWalkEncounterDependencies(f.map.sourceWalkEncounters!, f.mapId), /area-grid/);
  assert.ok(f.analyze().diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
});
