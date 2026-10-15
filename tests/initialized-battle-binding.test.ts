import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../src/compiler/content.js";
import { analyzeBatchEncounters } from "../src/compiler/content-batch-battle.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { selectInitializedBattleCatalog } from "../src/compiler/initialized-battle-binding.js";
import type { SourceBattleRequests } from "../src/compiler/source-battle-requests.js";
import type { BattleCatalog } from "../src/core/battle-content.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

function seal<T extends { contentHash?: string }>(value: T): T & { contentHash: string } {
  const { contentHash: _, ...body } = value;
  return { ...value, contentHash: hash(body) };
}
function analysis(catalog: BattleCatalog, ids: number[]) {
  const result = analyzeBatchEncounters(catalog, ids);
  return { ready: result.encounters.filter(entry => entry.status === "ready").length,
    conditional: result.encounters.filter(entry => entry.status === "conditional").length,
    blocked: result.encounters.filter(entry => entry.status === "blocked").length, entries: result.encounters };
}

/** Reuse the existing enemy compiler and source-shaped owner. Only request
 * provenance is authored; no test supplies a hand-written ready certificate. */
async function fixture() {
  const native = sourceNewGameFixture(), f = encounterRuntimeFixture();
  f.tables["monster_party.csv"] = f.input.encounters.map(entry => ({ id: String(entry.partyId),
    battle_background_asset_id: String(entry.metadata.backgroundId), battle_bgm_asset_id: String(entry.metadata.bgmId),
    appearance_production: String(entry.metadata.appearanceProduction), not_escape: String(entry.metadata.notEscape) }));
  f.tables["battle_background_asset.csv"] = [{ id: "1", asset_name: "controlled-background" }];
  f.input.handoff = { policy: { kind: "framework-battle-handoff-v1", id: "controlled-directory",
    audio: "retain-field", introduction: "omit" } };
  f.input.encounters[1]!.patterns = [0, 0, 0, 0, 0, 1];
  f.input.abilities[13]!.plan = null;
  f.input.abilities[13]!.blockers = ["Controlled unimplemented effect on a conditional AI action"];
  const rawBase = native.battle;
  rawBase.encounters = {};
  rawBase.common.abilities = structuredClone(f.input.abilities);
  rawBase.common.sprites = structuredClone(f.input.sprites);
  rawBase.common.drops = { kind: "battle-drops-v1", weights: [100, 0, 0, 0, 0, 0, 0, 0], monsters: [], contents: [] };
  f.input.conditions = rawBase.common.conditions;
  const sourceBattle = seal(rawBase);
  native.world.parentSourceSetHash = f.aiIdentity.sourceSetHash;
  native.world.maps[String(native.map.mapId)]!.contentHash = seal(native.map).contentHash;
  const sourceWorld = seal(native.world);
  const runtime = compileBattleEncounterRuntime(f.reader(), f.input);
  const producer = await import(pathToFileURL(resolve("scripts/source-battle-directory.mjs")).href);
  const composed = await producer.composeFrameworkBattleDirectory({ compiledDir: resolve(import.meta.dirname, ".."),
    baseCatalog: sourceBattle, runtime }) as { catalog: BattleCatalog };
  const catalog = composed.catalog, requestedPartyIds = [9201, 9202];
  const rawRequests: SourceBattleRequests = {
    kind: "source-battle-requests-v1", contentHash: "", sourceSetHash: sourceWorld.sourceSetHash,
    parentSourceSetHash: sourceWorld.parentSourceSetHash, worldCatalogHash: sourceWorld.contentHash,
    mapBindings: [{ mapId: native.map.mapId, contentHash: sourceWorld.maps[String(native.map.mapId)]!.contentHash }],
    requestedPartyIds,
    requests: requestedPartyIds.map(partyId => ({ partyId, onlyBlockedCandidates: false, sites: [{
      kind: "typed-field-encounter", partyId, mapId: native.map.mapId, script: "controlled", index: partyId - 9201,
      slot: null, source: { ...f.aiIdentity, pointer: "/controlled-encounters/" + partyId }, rawPartyId: partyId,
      rawRate: null, rawInstruction: { mnemonic: "Encount", operands: { iValues: [partyId] } },
    }] })), diagnostics: [], runtimeAdmission: "unassessed",
  };
  const requests = seal({ kind: "source-battle-directory-requests-v1", contentHash: "",
    sourceSetHash: sourceWorld.sourceSetHash, parentSourceSetHash: sourceWorld.parentSourceSetHash,
    sourceRequests: seal(rawRequests), retainedBase: { catalogHash: sourceBattle.contentHash, partyIds: [] as number[] },
    requestedPartyIds });
  const report = seal({ kind: "source-battle-directory-build-v1", contentHash: "",
    sourceSetHash: sourceWorld.sourceSetHash, parentSourceSetHash: sourceWorld.parentSourceSetHash,
    battleSourceSetHash: f.aiIdentity.battleSourceSetHash, baselineHash: sourceBattle.contentHash,
    frameworkCatalogHash: catalog.contentHash, strictCatalogHash: hash({ controlled: "strict directory omitted from this input" }),
    requestsHash: requests.contentHash, requestedPartyIds,
    framework: { ...catalog.encounterReport!, analysis: analysis(catalog, requestedPartyIds) },
    diagnostics: { requests: requests.sourceRequests.diagnostics, framework: catalog.encounterDiagnostics!, strict: [] },
  });
  return { selection: "shared-framework-directory-v1" as const, sourceBattle, sourceWorld,
    directory: { frameworkCatalog: catalog, requests, report } };
}

test("baseline selection is an exact detached source catalog and needs no directory or walking policy", async () => {
  const f = await fixture(), before = structuredClone(f.sourceBattle);
  const result = await selectInitializedBattleCatalog({ selection: "source-baseline-v1",
    sourceBattle: f.sourceBattle, sourceWorld: f.sourceWorld });
  assert.deepEqual(result, { catalog: before, directoryBinding: null });
  assert.notEqual(result.catalog, f.sourceBattle);
  result.catalog.gameState.initialGil++;
  assert.deepEqual(f.sourceBattle, before);
});

test("whole directory selection preserves conditional and blocked parties without granting walking or owners", async () => {
  const f = await fixture(), before = structuredClone(f), result = await selectInitializedBattleCatalog(f);
  assert.deepEqual(result.catalog, f.directory.frameworkCatalog);
  assert.deepEqual(result.catalog.gameState, f.sourceBattle.gameState);
  assert.deepEqual(result.catalog.encounterReport!.entries.map(entry => [entry.partyId, entry.status]),
    [[9201, "compiled"], [9202, "blocked"]]);
  assert.deepEqual(analyzeBatchEncounters(result.catalog, [9201, 9202]).encounters.map(entry => entry.status),
    ["conditional", "blocked"]);
  assert.ok(result.catalog.encounterDiagnostics!.some(d => d.kind === "runtime-dependency"));
  assert.ok(result.catalog.encounterDiagnostics!.some(d => d.kind === "blocked"));
  assert.deepEqual(result.directoryBinding, { catalogHash: f.directory.frameworkCatalog.contentHash,
    requestsHash: f.directory.requests.contentHash, reportHash: f.directory.report.contentHash });
  assert.equal(Object.hasOwn(result.catalog, "walkEncounters"), false);
  result.catalog.encounterDiagnostics![0]!.reason = "Changed returned copy";
  assert.deepEqual(f, before);
});

test("selection captures all caller input before the first digest await", async () => {
  const f = await fixture(), expected = structuredClone(f.directory.frameworkCatalog);
  const promise = selectInitializedBattleCatalog(f);
  f.directory.frameworkCatalog.gameState.initialGil++;
  f.directory.requests.requestedPartyIds.length = 0;
  assert.deepEqual((await promise).catalog, expected);
});

test("missing proof and changed payloads cannot fall back to the small baseline", async () => {
  const f = await fixture(), { directory: _, ...without } = f;
  await assert.rejects(selectInitializedBattleCatalog(without), /proof is missing/);
  for (const field of ["requests", "report", "frameworkCatalog"] as const) {
    const bad = structuredClone(f); bad.directory[field].contentHash = "0".repeat(64);
    await assert.rejects(selectInitializedBattleCatalog(bad), /Content payload changed/);
  }
  const staleNested = structuredClone(f);
  staleNested.directory.requests.sourceRequests.requestedPartyIds.pop();
  staleNested.directory.requests = seal(staleNested.directory.requests);
  staleNested.directory.report.requestsHash = staleNested.directory.requests.contentHash;
  staleNested.directory.report = seal(staleNested.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(staleNested), /Content payload changed/);
});

test("rehashing does not excuse wrong baseline, report, source or world bindings", async () => {
  for (const field of ["baselineHash", "frameworkCatalogHash", "requestsHash", "sourceSetHash", "parentSourceSetHash"] as const) {
    const f = await fixture(); f.directory.report[field] = "0".repeat(64); f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /binding mismatch|source identity mismatch/);
  }
  const f = await fixture(); f.directory.requests.sourceRequests.worldCatalogHash = "0".repeat(64);
  f.directory.requests.sourceRequests = seal(f.directory.requests.sourceRequests);
  f.directory.requests = seal(f.directory.requests); f.directory.report.requestsHash = f.directory.requests.contentHash;
  f.directory.report = seal(f.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(f), /source world binding/);
});

test("all map and party request bindings are required, including currently blocked entries", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.directory.requests.sourceRequests.mapBindings = []; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.directory.requests.sourceRequests.requests.pop(); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.directory.requests.requestedPartyIds = [9201]; },
  ]) {
    const f = await fixture(); change(f);
    f.directory.requests.sourceRequests = seal(f.directory.requests.sourceRequests);
    f.directory.requests = seal(f.directory.requests); f.directory.report.requestsHash = f.directory.requests.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /complete source/);
  }
});

test("directory cannot mutate initialization, owned data or any shared non-drop capability", async () => {
  for (const mutate of [
    (catalog: BattleCatalog) => { catalog.gameState.initialGil++; },
    (catalog: BattleCatalog) => { catalog.common.timing.speedIndex = 4; },
  ]) {
    const f = await fixture(); mutate(f.directory.frameworkCatalog);
    f.directory.frameworkCatalog = seal(f.directory.frameworkCatalog);
    f.directory.report.frameworkCatalogHash = f.directory.frameworkCatalog.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /owned catalogs|shared battle capabilities/);
  }
});

test("drop extension keeps source lottery and requires actual admitted monster and owned content references", async () => {
  for (const mutate of [
    (catalog: BattleCatalog) => { catalog.common.drops!.weights = [0, 100, 0, 0, 0, 0, 0, 0]; },
    (catalog: BattleCatalog) => { catalog.common.drops!.monsters[0]!.id = 9999; },
    (catalog: BattleCatalog) => {
      const monster = catalog.common.drops!.monsters[0]!; monster.rate = 100; monster.slots[0] = { contentId: 9999, count: 1 };
      catalog.common.drops!.contents.push({ id: 9999, kind: "item" });
    },
  ]) {
    const f = await fixture(); mutate(f.directory.frameworkCatalog);
    f.directory.frameworkCatalog = seal(f.directory.frameworkCatalog);
    f.directory.report.frameworkCatalogHash = f.directory.frameworkCatalog.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /drop weights|drop monster|owned definition/);
  }
});

test("removing diagnostics or changing compiler readiness cannot borrow the original report", async () => {
  const filtered = await fixture(); filtered.directory.frameworkCatalog.encounterDiagnostics = [];
  filtered.directory.frameworkCatalog = seal(filtered.directory.frameworkCatalog);
  filtered.directory.report.frameworkCatalogHash = filtered.directory.frameworkCatalog.contentHash;
  filtered.directory.report = seal(filtered.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(filtered), /complete encounter diagnostics/);
  const reassessed = await fixture(); reassessed.directory.report.framework.analysis.conditional = 0;
  reassessed.directory.report.framework.analysis.ready = 1; reassessed.directory.report = seal(reassessed.directory.report);
  await assert.rejects(selectInitializedBattleCatalog(reassessed), /current complete dependency analysis/);
});

test("an optional strict catalog is also hash checked, never an ignored extra payload", async () => {
  const f = await fixture();
  await assert.rejects(selectInitializedBattleCatalog({ ...f,
    directory: { ...f.directory, strictCatalog: f.sourceBattle } }), /Content identity mismatch/);
  assert.equal(canonical(f.sourceBattle.gameState), canonical(f.directory.frameworkCatalog.gameState));
});

async function conditionPolicyFixture() {
  const f = await fixture(), policy = { kind: "web-source-control-actions-v1" as const };
  const catalog = seal({ ...f.directory.frameworkCatalog,
    common: { ...f.directory.frameworkCatalog.common, conditionControlPolicy: policy } });
  const report = seal({ ...f.directory.report, frameworkCatalogHash: catalog.contentHash,
    policy: { kind: "source-battle-directory-policy-v2", framework: { conditionControlPolicy: policy } },
    policyChanges: [{ kind: "framework-condition-policy-binding-v1", field: "common.conditionControlPolicy",
      from: null, to: policy, beforeCommonHash: hash(f.sourceBattle.common), afterCommonHash: hash(catalog.common),
      beforeGameStateHash: hash(f.sourceBattle.gameState), afterGameStateHash: hash(catalog.gameState),
      beforeCommon: structuredClone(f.sourceBattle.common), afterCommon: structuredClone(catalog.common) }],
  });
  const producer = await import(pathToFileURL(resolve("scripts/source-battle-directory.mjs")).href);
  const actual = await producer.composeFrameworkBattleDirectory({ compiledDir: resolve(import.meta.dirname, ".."),
    baseCatalog: f.sourceBattle, conditionControlPolicy: policy, runtime: {
      encounters: f.directory.frameworkCatalog.encounters, diagnostics: f.directory.frameworkCatalog.encounterDiagnostics,
      report: f.directory.frameworkCatalog.encounterReport, drops: f.directory.frameworkCatalog.common.drops,
    } });
  assert.deepEqual(actual.catalog, catalog);
  assert.deepEqual(actual.policyChanges, report.policyChanges);
  return { ...f, directory: { ...f.directory, frameworkCatalog: catalog, report } };
}

test("a declared Web condition policy binds through both source selection consumers without changing owners", async () => {
  const f = await conditionPolicyFixture(), selected = await selectInitializedBattleCatalog(f);
  assert.deepEqual(selected.catalog.gameState, f.sourceBattle.gameState);
  assert.deepEqual(selected.catalog.common.conditionControlPolicy, { kind: "web-source-control-actions-v1" });
  const checker = await import(pathToFileURL(resolve("scripts/check-selected-source-batches.mjs")).href);
  const binding = await checker.validateSelectedSourceCatalogBinding({ built: {
    kind: "initialized-source-map-build-v1", recipeKind: "initialized-source-map-recipe-v3",
    battleCatalogSelection: "shared-framework-directory-v1", sourceAreaScopeReceipt: null,
    battleDirectory: selected.directoryBinding,
  }, battle: selected.catalog, sourceBattle: f.sourceBattle, sourceWorld: f.sourceWorld,
  directory: selected.catalog, requests: f.directory.requests, directoryReport: f.directory.report },
  { compiledDir: resolve(import.meta.dirname, "..") });
  assert.equal(binding.catalogHash, selected.catalog.contentHash);
});

test("rehashing cannot replace a missing, changed or unknown condition-policy receipt", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policyChanges.length = 0; },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policyChanges[0]!.beforeCommonHash = "0".repeat(64); },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policyChanges[0]!.afterGameStateHash = "0".repeat(64); },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policy.kind = "source-battle-directory-policy-v1"; },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { f.directory.report.policy.framework.conditionControlPolicy = { kind: "unknown" } as never; },
    (f: Awaited<ReturnType<typeof conditionPolicyFixture>>) => { delete (f.directory.frameworkCatalog as BattleCatalog).common.conditionControlPolicy; },
  ]) {
    const f = await conditionPolicyFixture(); mutate(f);
    f.directory.frameworkCatalog = seal(f.directory.frameworkCatalog);
    f.directory.report.frameworkCatalogHash = f.directory.frameworkCatalog.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /condition policy|condition-policy/);
  }
});

test("a consistent policy receipt grants no other capability or owned-state change", async () => {
  for (const owned of [false, true]) {
    const f = await conditionPolicyFixture();
    if (owned) f.directory.frameworkCatalog.gameState.initialGil++;
    else f.directory.frameworkCatalog.common.timing.speedIndex = 4;
    const catalog = f.directory.frameworkCatalog, change = f.directory.report.policyChanges[0]!;
    change.afterCommon = structuredClone(catalog.common); change.afterCommonHash = hash(catalog.common);
    change.afterGameStateHash = hash(catalog.gameState);
    f.directory.frameworkCatalog = seal(catalog);
    f.directory.report.frameworkCatalogHash = f.directory.frameworkCatalog.contentHash;
    f.directory.report = seal(f.directory.report);
    await assert.rejects(selectInitializedBattleCatalog(f), /owned catalogs|shared battle capabilities/);
  }
  const f = await conditionPolicyFixture();
  await assert.rejects(selectInitializedBattleCatalog({ selection: "source-baseline-v1", sourceWorld: f.sourceWorld,
    sourceBattle: f.directory.frameworkCatalog }), /strict source baseline cannot use a Web condition control policy/);
});
