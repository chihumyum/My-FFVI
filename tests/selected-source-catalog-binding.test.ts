import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { canonical } from "../src/core/canonical.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { deriveSourceAreaScope } from "../src/compiler/source-area-scope.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";
import type { WorldCatalog, WorldMapContent } from "../src/field/world.js";

type Build = Record<string, unknown> & { kind: "initialized-source-map-build-v1" };
type CatalogInput = { built: Build; battle: unknown; sourceBattle: unknown; sourceWorld: unknown;
  directory?: unknown; requests?: unknown; directoryReport?: unknown };
type AreaInput = { built: Build; sourceWorld: WorldCatalog; sourceMaps: WorldMapContent[] };
const script = pathToFileURL(resolve(process.cwd(), "scripts/check-selected-source-batches.mjs")).href;
const options = { compiledDir: fileURLToPath(new URL("../", import.meta.url)) };
const catalogBinding = async (input: CatalogInput): Promise<{ selection: string; catalogHash: string; baselineHash: string }> =>
  (await import(script)).validateSelectedSourceCatalogBinding(input, options);
const areaBinding = async (input: AreaInput): Promise<unknown> =>
  (await import(script)).validateSelectedSourceAreaBinding(input, options);
async function seal<T extends { contentHash: string }>(raw: T): Promise<T> {
  const { contentHash: _, ...body } = structuredClone(raw);
  return { ...body, contentHash: await contentDigest(body) } as T;
}

/** Authored source-shape data exercises real catalog/area validation only.
 * It claims no original assets, native execution or reachable story state. */
async function fixture() {
  const f = sourceNewGameFixture();
  const map = await seal({ ...f.map, sourceSetHash: "a".repeat(64), parentSourceSetHash: "b".repeat(64),
    mediaSourceSetHash: "c".repeat(64), areaId: 8, map: { ...f.map.map!, identity: { mapId: f.map.mapId, areaId: 8 } } });
  const otherDraft = structuredClone(map); otherDraft.mapId++; otherDraft.map!.identity!.mapId++;
  otherDraft.partyEntry!.mapId = otherDraft.mapId;
  otherDraft.blockers.push({ reason: "Controlled unknown capability remains blocked", source: structuredClone(map.map!.source) });
  const other = await seal(otherDraft);
  const index = (value: WorldMapContent) => ({ contentHash: value.contentHash,
    url: "/content-packages/source/maps/" + value.mapId + ".json", name: value.name, areaId: value.areaId,
    geometryReady: true, defaultGroupReady: true, blockers: [] });
  const world: WorldCatalog = await seal({ ...f.world, sourceSetHash: map.sourceSetHash, parentSourceSetHash: map.parentSourceSetHash,
    mediaSourceSetHash: map.mediaSourceSetHash, maps: { [map.mapId]: index(map), [other.mapId]: index(other) } });
  const sourceBattle = await seal({ ...f.battle, common: { ...f.battle.common,
    sourceContentHash: "d".repeat(64), fieldSourceSetHash: "e".repeat(64) } });
  const directory = await seal({ ...sourceBattle, encounterDiagnostics: [
    ...(sourceBattle.encounterDiagnostics ?? []), { partyId: 900001, kind: "runtime-dependency" as const,
      code: "controlled-unknown-family", reason: "Unknown dependent source behavior remains visible" },
  ] });
  const sourceRequests = await seal({ kind: "source-battle-requests-v1", contentHash: "",
    worldCatalogHash: world.contentHash, diagnostics: [{ code: "controlled-unknown-family", reason: "Retained unknown" }] });
  const requests = await seal({ kind: "source-battle-directory-requests-v1", contentHash: "",
    parentSourceSetHash: world.parentSourceSetHash, sourceRequests });
  const directoryReport = await seal({ kind: "source-battle-directory-build-v1", contentHash: "",
    sourceSetHash: world.sourceSetHash, parentSourceSetHash: world.parentSourceSetHash,
    baselineHash: sourceBattle.contentHash, frameworkCatalogHash: directory.contentHash, requestsHash: requests.contentHash,
    counts: { conditional: 1 }, diagnostics: structuredClone(directory.encounterDiagnostics) });
  const binding = { catalogHash: directory.contentHash, requestsHash: requests.contentHash, reportHash: directoryReport.contentHash };
  const baseline: Build = { kind: "initialized-source-map-build-v1", recipeKind: "initialized-source-map-recipe-v1" };
  const selected: Build = { kind: "initialized-source-map-build-v1", recipeKind: "initialized-source-map-recipe-v3",
    battleCatalogSelection: "shared-framework-directory-v1", sourceAreaScopeReceipt: null, battleDirectory: binding };
  const input = (): CatalogInput => ({ built: selected, battle: directory, sourceBattle, sourceWorld: world,
    directory, requests, directoryReport });
  const maps = [map, other], scope = { kind: "source-area-scope-v1" as const, areaId: 8 };
  const receipt = deriveSourceAreaScope({ scope, catalog: world, maps });
  const areaBuilt: Build = { ...selected, sourceAreaScopeReceipt: receipt,
    sourceInputs: { maps: maps.map(value => ({ mapId: value.mapId, ...world.maps[String(value.mapId)]! })) } };
  return { world, maps, sourceBattle, directory, requests, directoryReport, binding, baseline, selected,
    input, scope, receipt, areaBuilt };
}

test("source baseline must remain the entire pinned catalog, including common capability metadata", async () => {
  const f = await fixture(), input = { built: f.baseline, battle: f.sourceBattle, sourceBattle: f.sourceBattle, sourceWorld: f.world };
  const before = canonical(input);
  assert.notEqual(f.sourceBattle.common.fieldSourceSetHash, f.world.sourceSetHash,
    "A field export subset and the complete world corpus retain distinct identities");
  assert.equal((await catalogBinding(input)).selection, "source-baseline-v1");
  assert.equal((await catalogBinding({ ...input, built: { kind: "initialized-source-map-build-v1" } })).selection,
    "source-baseline-v1", "An existing versionless v1 build remains a valid baseline declaration");
  const baselineV3: Build = { ...f.selected, battleCatalogSelection: "source-baseline-v1" }; delete baselineV3.battleDirectory;
  assert.equal((await catalogBinding({ ...input, built: baselineV3 })).selection, "source-baseline-v1");
  const changed = await seal({ ...f.sourceBattle, common: { ...f.sourceBattle.common, limitations: ["Undeclared upgrade"] } });
  await assert.rejects(catalogBinding({ ...input, battle: changed }), /baseline catalog changed/);
  await assert.rejects(catalogBinding({ ...input, built: { ...f.baseline, battleDirectory: f.binding } }), /Version 1/);
  assert.equal(canonical(input), before);
});

test("version 3 shared directory is checked without walking and retains its complete conditional records", async () => {
  const f = await fixture(), input = f.input(), before = canonical(input);
  assert.notEqual(f.directory.common.fieldSourceSetHash, f.world.sourceSetHash);
  const result = await catalogBinding(input);
  assert.equal(result.selection, "shared-framework-directory-v1"); assert.equal(result.catalogHash, f.directory.contentHash);
  assert.equal(Object.hasOwn(input.built, "walking"), false);
  assert.equal(f.directory.encounterDiagnostics!.length, 1);
  assert.equal(f.directoryReport.counts.conditional, 1);
  assert.equal(canonical(input), before, "Catalog validation never filters unknown/conditional definitions or diagnostics");
  for (const key of ["battleCatalogSelection", "sourceAreaScopeReceipt", "battleDirectory"]) {
    const built = structuredClone(f.selected); delete built[key];
    await assert.rejects(catalogBinding({ ...input, built }), /Version 3|directory is missing/);
  }
  await assert.rejects(catalogBinding({ ...input, built: { ...f.selected, battleCatalogSelection: "inferred-from-walking" } }),
    /Unknown selected/);
  await assert.rejects(catalogBinding({ ...input, built: { ...f.selected, battleCatalogSelection: "source-baseline-v1" } }),
    /explicit version 3 selection/);
});

test("existing version 2 walking binding stays explicit while directory-free old records cannot hide another catalog", async () => {
  const f = await fixture(), walking = [{ status: "ready", binding: { mapId: f.maps[0]!.mapId } }];
  const built: Build = { kind: "initialized-source-map-build-v1", recipeKind: "initialized-source-map-recipe-v2",
    walking, nativeWalkingRulesVerified: false, battleDirectory: f.binding };
  assert.equal((await catalogBinding({ ...f.input(), built })).catalogHash, f.directory.contentHash);
  const legacy = structuredClone(built); delete legacy.recipeKind;
  assert.equal((await catalogBinding({ ...f.input(), built: legacy })).catalogHash, f.directory.contentHash);
  await assert.rejects(catalogBinding({ ...f.input(), built: { ...built, walking: [] } }), /actual enabled map records/);
  const hidden = { ...legacy }; delete hidden.walking; delete hidden.nativeWalkingRulesVerified;
  await assert.rejects(catalogBinding({ ...f.input(), built: hidden }), /explicit version 3/);
  const missing = { ...legacy }; delete missing.battleDirectory;
  await assert.rejects(catalogBinding({ ...f.input(), built: missing }), /Legacy walking/);
});

test("catalog choice rejects wrong directory pins, foreign dependency graphs and owner-changing replacements", async () => {
  const f = await fixture();
  for (const key of ["catalogHash", "requestsHash", "reportHash"] as const)
    await assert.rejects(catalogBinding({ ...f.input(), built: { ...f.selected,
      battleDirectory: { ...f.binding, [key]: "e".repeat(64) } } }), /identity mismatch/);
  await assert.rejects(catalogBinding({ ...f.input(), battle: f.sourceBattle }), /complete published shared directory/);
  const foreignSource = await seal({ ...f.requests.sourceRequests, worldCatalogHash: "e".repeat(64) });
  const requests = await seal({ ...f.requests, sourceRequests: foreignSource });
  const directoryReport = await seal({ ...f.directoryReport, requestsHash: requests.contentHash });
  const foreignBuilt = { ...f.selected, battleDirectory: { ...f.binding,
    requestsHash: requests.contentHash, reportHash: directoryReport.contentHash } };
  await assert.rejects(catalogBinding({ ...f.input(), requests, directoryReport, built: foreignBuilt }), /world identity changed/);
  const altered = await seal({ ...f.directory, gameState: { ...f.directory.gameState, initialGil: f.directory.gameState.initialGil + 1 } });
  const ownerReport = await seal({ ...f.directoryReport, frameworkCatalogHash: altered.contentHash });
  const ownerBuilt = { ...f.selected, battleDirectory: { ...f.binding,
    catalogHash: altered.contentHash, reportHash: ownerReport.contentHash } };
  await assert.rejects(catalogBinding({ ...f.input(), battle: altered, directory: altered,
    directoryReport: ownerReport, built: ownerBuilt }), /owned source initializer/);
});

test("source area receipt binds every original map without filtering blocked bodies or route coverage", async () => {
  const f = await fixture(), input = { built: f.areaBuilt, sourceWorld: f.world, sourceMaps: f.maps }, before = canonical(input);
  assert.deepEqual(await areaBinding(input), f.receipt);
  assert.deepEqual(f.receipt.maps[1]!.blockers, f.maps[1]!.blockers);
  assert.equal(f.receipt.runtimeAdmission, "unassessed");
  assert.equal(canonical(input), before);
  await assert.rejects(areaBinding({ ...input, sourceMaps: f.maps.slice(0, 1) }), /complete|missing|scope|map/i);
  const missingPin = structuredClone(f.areaBuilt) as Build & { sourceInputs: { maps: unknown[] } };
  missingPin.sourceInputs.maps.pop();
  await assert.rejects(areaBinding({ ...input, built: missingPin }), /pins omit/);
  const changed = structuredClone(f.maps[1]!); changed.map!.entities[0]!.x++;
  await assert.rejects(areaBinding({ ...input, sourceMaps: [f.maps[0]!, await seal(changed)] }), /identity|hash|binding|map/i);
  const lie = structuredClone(f.receipt); lie.mapIds.pop();
  await assert.rejects(areaBinding({ ...input, built: { ...f.areaBuilt, sourceAreaScopeReceipt: lie } }), /receipt|payload|scope/i);
  const badURL = structuredClone(f.areaBuilt) as Build & { sourceInputs: { maps: { url: string }[] } };
  badURL.sourceInputs.maps[0]!.url = "/content-packages/foreign/map.json";
  await assert.rejects(areaBinding({ ...input, built: badURL }), /pin URL/);
});

test("null scope remains an unassessed claim and cannot reuse another build's scope receipt", async () => {
  const f = await fixture();
  assert.equal(await areaBinding({ built: f.selected, sourceWorld: f.world, sourceMaps: f.maps }), null);
  assert.equal(await areaBinding({ built: f.baseline, sourceWorld: f.world, sourceMaps: f.maps }), null);
  const missing = structuredClone(f.selected); delete missing.sourceAreaScopeReceipt;
  await assert.rejects(areaBinding({ built: missing, sourceWorld: f.world, sourceMaps: f.maps }), /Version 3/);
  await assert.rejects(areaBinding({ built: { ...f.baseline, sourceAreaScopeReceipt: f.receipt },
    sourceWorld: f.world, sourceMaps: f.maps }), /version 3/);
});
