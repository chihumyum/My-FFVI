import test from "node:test";
import assert from "node:assert/strict";
import { compileSourceWalkPolicy, assertSourceWalkPolicyBinding, parseSourceWalkPolicyDeclaration,
  type SourceWalkPolicyDeclaration } from "../src/compiler/source-walk-policy.js";
import { compileSourceWalkEncounterDependencies } from "../src/compiler/world.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { hash } from "../src/compiler/content.js";
import { WalkEncounterState } from "../src/core/walk-encounters.js";
import type { BattleCatalog } from "../src/core/battle-content.js";
import type { SourceWalkEncounterDependencies } from "../src/field/world.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

/** Controlled source-shaped input through the real metadata and battle
 * compilers; no hand-written ready evidence and no original-story claim. */
function fixture() {
  const source = encounterRuntimeFixture(), mapId = 81;
  const master = { id: String(mapId), monster_set_id: "12", encount_area_grid_id: "0",
    required_steps_min: "2625", required_steps_max: "4375", subtract_steps: "121", retained_map_value: "unchanged" };
  const set: Record<string, string> = { id: "12", retained_set_value: "unchanged" };
  for (let slot = 1; slot <= 16; slot++) { set[`monster_set${slot}`] = "0"; set[`monster_set${slot}_rate`] = "0"; }
  Object.assign(set, { monster_set1: "9202", monster_set1_rate: "80", monster_set2: "9201", monster_set2_rate: "80",
    monster_set3: "9202", monster_set3_rate: "16", monster_set4: "9201", monster_set4_rate: "0" });
  source.tables["map.csv"] = [master]; source.tables["monster_set.csv"] = [set];
  const compiled = compileBattleEncounterRuntime(source.reader(), source.input), base = checkpointFixture().battle;
  const catalog: BattleCatalog = { ...base,
    common: { ...base.common, abilities: structuredClone(source.input.abilities),
      sprites: structuredClone(source.input.sprites), drops: compiled.drops },
    encounters: compiled.encounters, encounterReport: compiled.report, encounterDiagnostics: compiled.diagnostics };
  const reseal = () => { const { contentHash: _old, ...body } = catalog; catalog.contentHash = hash(body); };
  reseal();
  const declaration: SourceWalkPolicyDeclaration = { kind: "framework-source-set-walk-v1", id: "controlled-source-set",
    minSteps: 2, maxSteps: 4, transportationIds: [1], weighting: "source-rate-as-web-weight-v1" };
  const metadata = () => compileSourceWalkEncounterDependencies(source.reader(), mapId);
  const compile = (value = metadata()) => compileSourceWalkPolicy({ mapId, source: value, catalog, declaration,
    sourceMetadataHash: hash(value) });
  return { mapId, master, set, catalog, declaration, metadata, compile, reseal };
}

test("the complete source set binds explicit Web steps and all dependencies without claiming native selection", () => {
  const f = fixture(), source = f.metadata(), result = f.compile(source);
  assert.equal(result.status, "ready"); assert.deepEqual(result.diagnostics, []);
  assert.equal(result.runtimeAdmission, "unassessed"); assert.equal(result.battleAnalysis.runtimeAdmission, "unassessed");
  assert.deepEqual(result.source, source); assert.equal(result.source.slots.length, 16);
  assert.equal(result.source.map.values.required_steps_min, "2625");
  assert.equal(result.source.map.values.required_steps_max, "4375");
  assert.equal(result.source.map.values.subtract_steps, "121");
  assert.equal(result.source.set!.values.retained_set_value, "unchanged");
  assert.deepEqual(result.encounterIds, [9201, 9202]);
  assert.deepEqual(result.dependencies.map(({ slot, partyId, rate }) => ({ slot, partyId, rate })), [
    { slot: 1, partyId: 9202, rate: 80 }, { slot: 2, partyId: 9201, rate: 80 },
    { slot: 3, partyId: 9202, rate: 16 }, { slot: 4, partyId: 9201, rate: 0 },
  ]);
  assert.equal(result.dependencies[0]!.source.objectId, "90071992547409937");
  assert.equal(result.dependencies[3]!.source.pointer, "/id/12/monster_set4");
  assert.deepEqual(result.policy, { kind: "framework-walk-encounters-v1", id: f.declaration.id,
    minSteps: 2, maxSteps: 4, transportationIds: [1],
    parties: [{ partyId: 9202, weight: 96 }, { partyId: 9201, weight: 80 }] });
  assert.equal(result.binding!.sourceMetadataHash, hash(source));
  assert.equal(result.binding!.policyHash, hash(result.policy));
  assert.equal(result.binding!.battleCatalogHash, f.catalog.contentHash);
  assert.ok(result.limitations.some(detail => detail.startsWith("escape:")), "Existing development omissions stay visible");
  assertSourceWalkPolicyBinding({ mapId: f.mapId, source, catalog: f.catalog, binding: result.binding, policy: result.policy });
});

test("a zero-rate missing enemy party prevents binding the whole source set instead of filtering the reference", () => {
  const f = fixture(); f.set.monster_set4 = "9999";
  const result = f.compile();
  assert.equal(result.status, "blocked"); assert.equal(result.policy, null); assert.equal(result.binding, null);
  assert.deepEqual(result.encounterIds, [9201, 9202, 9999]);
  assert.deepEqual(result.selectableEncounterIds, [9201, 9202]);
  assert.equal(result.dependencies[3]!.rate, 0);
  assert.ok(result.diagnostics.some(d => d.code === "battle-dependency" && d.partyId === 9999 && /missing-encounter/.test(d.reason)));
  assert.equal(result.battleAnalysis.encounters.find(encounter => encounter.id === 9202)!.status, "ready");
  assert.deepEqual(result.source.set!.values, f.set);
});

test("conditional execution and absent compiler evidence cannot become ready through explicit Web weighting", () => {
  const f = fixture(); f.catalog.common.abilities[13]!.plan = null; f.reseal();
  const conditional = f.compile();
  assert.equal(conditional.status, "blocked"); assert.equal(conditional.policy, null);
  assert.ok(conditional.diagnostics.some(d => d.code === "battle-conditional" && d.abilityId === 13));
  const g = fixture(); delete g.catalog.encounterReport; delete g.catalog.encounterDiagnostics; g.reseal();
  const missing = g.compile();
  assert.equal(missing.policy, null);
  assert.ok(missing.diagnostics.some(d => d.code === "battle-conditional" && /compiler-evidence-missing/.test(d.reason)));
});

test("invalid raw rates retain the party dependency and block even if a caller erases the source diagnostic", () => {
  for (const raw of [undefined, "unknown", "-1", "1.5", "2147483648"] as const) {
    const f = fixture();
    if (raw === undefined) delete f.set.monster_set1_rate; else f.set.monster_set1_rate = raw;
    const source = f.metadata(); source.blockers = [];
    const result = f.compile(source);
    assert.equal(result.status, "blocked"); assert.equal(result.policy, null);
    assert.deepEqual(result.encounterIds, [9201, 9202]);
    assert.equal(result.dependencies[0]!.rate, null);
    assert.ok(result.diagnostics.some(d => d.code === "source-walk-slot-invalid"));
    assert.deepEqual(result.source, source);
  }
});

test("unreviewed raw slots cannot be hidden by truncating the decoded list or clearing blockers", () => {
  const f = fixture(); f.set.monster_set17 = "9999"; f.set.monster_set17_rate = "0";
  const source = f.metadata(); source.slots = source.slots.slice(0, 16); source.blockers = [];
  const result = f.compile(source);
  assert.equal(result.policy, null); assert.equal(result.binding, null);
  assert.deepEqual(result.encounterIds, [9201, 9202, 9999]);
  assert.equal(result.dependencies.at(-1)!.slot, 17);
  assert.ok(result.diagnostics.some(d => d.code === "source-walk-slot-schema"));
  assert.equal(result.source.set!.values.monster_set17_rate, "0");
});

test("unknown or nonzero area grids reject default-set fallback; an explicit zero set and grid creates no policy", () => {
  for (const raw of [undefined, "1", "bad"] as const) {
    const f = fixture();
    if (raw === undefined) delete (f.master as Partial<typeof f.master>).encount_area_grid_id;
    else f.master.encount_area_grid_id = raw;
    const result = f.compile();
    assert.equal(result.status, "blocked"); assert.equal(result.policy, null);
    assert.ok(result.diagnostics.some(d => d.code === "source-walk-grid-unimplemented"));
  }
  const f = fixture(); f.master.monster_set_id = "0";
  const none = f.compile();
  assert.equal(none.status, "none"); assert.equal(none.policy, null); assert.equal(none.binding, null);
  assert.deepEqual(none.dependencies, []); assert.deepEqual(none.diagnostics, []);
  f.master.encount_area_grid_id = "1";
  assert.equal(f.compile().status, "blocked", "Set zero cannot hide an unimplemented grid reference");
});

test("weighted party zero, an empty pool, and overflow cannot manufacture a fallback or partial distribution", () => {
  const f = fixture(); f.set.monster_set5_rate = "3";
  assert.ok(f.compile().diagnostics.some(d => d.code === "source-walk-slot-invalid" && d.slot === 5));
  assert.equal(f.compile().policy, null);
  const g = fixture(); for (let slot = 1; slot <= 16; slot++) g.set[`monster_set${slot}_rate`] = "0";
  assert.equal(g.compile().policy, null);
  assert.ok(g.compile().diagnostics.some(d => d.code === "source-walk-empty-pool"));
  const h = fixture(); h.set.monster_set1_rate = "2147483647"; h.set.monster_set2_rate = "2147483647";
  const overflow = h.compile(); assert.equal(overflow.policy, null); assert.equal(overflow.binding, null);
  assert.ok(overflow.diagnostics.some(d => d.code === "source-walk-weight-range"));
});

test("map identity, physical row references and decoded/raw discrepancies remain admission failures", () => {
  const mutations: ((source: SourceWalkEncounterDependencies) => void)[] = [
    source => { source.mapId++; }, source => { source.map.source.rowId = "82"; },
    source => { source.map.source.pointer = "/id/82"; },
    source => { source.slots[0]!.source.serializedFile = "another-physical-file"; },
    source => { source.slots[0]!.source.objectId = "90071992547409939"; },
    source => { source.slots[0]!.partyId = 9999; },
    source => { source.set!.source.pointer = "/id/13"; },
  ];
  for (const mutate of mutations) {
    const f = fixture(), source = f.metadata(); mutate(source);
    const result = f.compile(source);
    assert.equal(result.policy, null); assert.equal(result.binding, null);
    assert.ok(result.diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
    assert.deepEqual(result.encounterIds, [9201, 9202], "Forged decoded IDs do not replace raw party references");
  }
});

test("explicit declaration is exact and never takes native thresholds, implicit transports, or unsupported weighting", () => {
  const f = fixture();
  for (const invalid of [null, {}, { ...f.declaration, weighting: "native" }, { ...f.declaration, minSteps: 0 },
    { ...f.declaration, maxSteps: 1 }, { ...f.declaration, maxSteps: 0x100000000 },
    { ...f.declaration, transportationIds: [] }, { ...f.declaration, transportationIds: [0] },
    { ...f.declaration, transportationIds: [1, 1] }, { ...f.declaration, id: " padded " },
    { ...f.declaration, seed: 123 }, { ...f.declaration, minSteps: -0 }])
    assert.throws(() => parseSourceWalkPolicyDeclaration(invalid), /Invalid|Missing|duplicate/);
  const sparse = structuredClone(f.declaration); sparse.transportationIds = new Array<number>(1);
  assert.throws(() => parseSourceWalkPolicyDeclaration(sparse), /transportation/);
  assert.throws(() => compileSourceWalkPolicy({ mapId: 0, source: f.metadata(), catalog: f.catalog,
    declaration: f.declaration }), /map ID/);
});

test("binding revalidation rejects changed payloads, forged policies, stale pins and unbound extra fields", () => {
  const f = fixture(), source = f.metadata(), result = f.compile(source);
  const validate = (binding: unknown = result.binding, policy: unknown = result.policy) =>
    assertSourceWalkPolicyBinding({ mapId: f.mapId, source, catalog: f.catalog, binding, policy });
  validate();
  assert.throws(() => validate({ ...result.binding, ignored: true }), /binding/);
  const forgedPolicy = structuredClone(result.policy!); forgedPolicy.parties[0]!.weight = 1;
  assert.throws(() => validate({ ...result.binding, policyHash: hash(forgedPolicy) }, forgedPolicy), /binding or policy changed/);
  assert.throws(() => validate({ ...result.binding, monsterSetId: 13 }), /identity mismatch/);
  const wrongPin = compileSourceWalkPolicy({ mapId: f.mapId, source, catalog: f.catalog, declaration: f.declaration,
    sourceMetadataHash: "0".repeat(64) });
  assert.equal(wrongPin.policy, null); assert.ok(wrongPin.diagnostics.some(d => d.code === "source-walk-metadata-hash"));
  source.map.values.subtract_steps = "122";
  assert.throws(() => validate(), /not ready/);
  source.map.values.subtract_steps = "121";
  f.catalog.common.limitations.push("Changed catalog");
  assert.throws(() => validate(), /not ready/, "Claimed same catalog SHA does not authenticate changed bytes");
  f.reseal();
  assert.throws(() => validate(), /binding or policy changed/, "A valid new catalog cannot inherit the old binding");
  f.catalog.common.abilities[13]!.plan = null; f.reseal();
  assert.throws(() => validate({ ...result.binding, battleCatalogHash: f.catalog.contentHash }), /not ready/);
});

test("results are deterministic and detached and their policy runs through the existing saved scheduler", () => {
  const f = fixture(), source = f.metadata(), before = structuredClone({ source, catalog: f.catalog, declaration: f.declaration });
  const a = f.compile(source), b = f.compile(source);
  assert.deepEqual(a, b);
  assert.deepEqual({ source, catalog: f.catalog, declaration: f.declaration }, before);
  const live = new WalkEncounterState(79), restored = new WalkEncounterState(79);
  for (let step = 0; step < 12; step++) {
    restored.restore(live.snapshot());
    const left = live.prepareStep(f.mapId, a.policy!), right = restored.prepareStep(f.mapId, b.policy!);
    assert.equal(left.partyId, right.partyId);
    assert.ok(left.partyId === null || a.encounterIds.includes(left.partyId));
    left.commitWith(() => {}); right.commitWith(() => {});
    assert.deepEqual(restored.snapshot(), live.snapshot());
  }
  assert.ok(live.snapshot().encounters > 0);
  a.source.set!.values.monster_set1 = "9999"; a.dependencies[0]!.source.objectId = "changed";
  a.binding!.declaration.transportationIds[0] = 6; a.policy!.parties[0]!.weight = 1;
  a.battleAnalysis.encounters[0]!.sourceDiagnostics[0]!.reason = "changed result";
  assert.deepEqual({ source, catalog: f.catalog, declaration: f.declaration }, before);
  assert.deepEqual(f.compile(source), b);
});
