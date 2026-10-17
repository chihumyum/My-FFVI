import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileFrameworkContent } from "../src/compiler/framework-content.js";
import { canonical } from "../src/compiler/content.js";
import { sourceGameContentRefsFixture } from "./fixtures/game-content-refs.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import type { FrameworkPeriodicAssessment } from "../src/compiler/framework-periodic-presentation.js";
async function fixture() {
  const f = await sourceGameContentRefsFixture("source", "/world");
  const maps = [f.map, f.destination].map(original => {
    const map = structuredClone(original);
    map.entryView = { mapId: map.mapId, isWorld: false, loopType: 1, sources: { map: map.map!.source, area: map.map!.source } };
    return sealBatchContent(map);
  });
  const catalog = structuredClone(f.catalog);
  for (const map of maps) catalog.maps[map.mapId]!.contentHash = map.contentHash;
  const world = sealBatchContent(catalog), entry = sealBatchContent({ ...f.content, worldCatalogHash: world.contentHash,
    mapContentHash: maps.find(map => map.mapId === f.content.entry.mapId)!.contentHash });
  const assessments: FrameworkPeriodicAssessment[] = maps.map(map => ({ mapId: map.mapId,
    sourceContentHash: map.contentHash, presentation: null, blockers: ["Explicit synthetic source host unavailable"] }));
  return { catalog: world, maps, entry, assessments };
}
test("framework periodic option covers the whole family including failures while legacy omission keeps its shape", async () => {
  const f = await fixture(), before = canonical(f), legacy = compileFrameworkContent(f.catalog, f.maps, f.entry),
    actual = compileFrameworkContent(f.catalog, f.maps, f.entry, { periodicPresentations: f.assessments });
  assert.equal(legacy.report.periodicReport, undefined); assert.equal(legacy.catalog.developmentProfile.worldMap, undefined);
  assert.equal(actual.report.periodicReport!.maps.length, 2); assert.equal(actual.report.periodicReport!.unready, 2);
  for (const map of actual.maps) {
    const previous = legacy.maps.find(row => row.mapId === map.mapId)!;
    assert.equal(map.developmentProfile.worldMap, "framework-world-map-flat-v1");
    assert.equal(map.developmentProfile.fieldPresentation, "framework-ordinary-field-flat-v1");
    assert.deepEqual(map.map, previous.map); assert.deepEqual(map.blockers, previous.blockers);
    assert.deepEqual(map.scripts, previous.scripts); assert.equal(map.frameworkPresentation, undefined);
    assert.equal(actual.catalog.maps[map.mapId]!.contentHash, map.contentHash);
  }
  assert.equal(actual.entry.worldCatalogHash, actual.catalog.contentHash);
  assert.equal(canonical(f), before);
});
test("partial, duplicate, foreign and fabricated successful assessments cannot authorize the periodic family", async () => {
  const f = await fixture();
  for (const change of [
    (rows: FrameworkPeriodicAssessment[]) => rows.pop(),
    (rows: FrameworkPeriodicAssessment[]) => { rows[1] = structuredClone(rows[0]!); },
    (rows: FrameworkPeriodicAssessment[]) => { rows[0]!.sourceContentHash = "f".repeat(64); },
    (rows: FrameworkPeriodicAssessment[]) => { rows[0]!.blockers = []; },
  ]) {
    const rows = structuredClone(f.assessments); change(rows);
    assert.throws(() => compileFrameworkContent(f.catalog, f.maps, f.entry, { periodicPresentations: rows }), /complete periodic family|source assessment mismatch/);
  }
});
test("public linker reuses the exact complete assessments and retains every strict map", async () => {
  const f = await fixture(), payloads = new Map<string, unknown>([["/world/catalog.json", f.catalog], ["/game/source-new-game.json", f.entry],
    ...f.maps.map(map => [f.catalog.maps[map.mapId]!.url, map] as [string, unknown])]);
  const before = canonical([...payloads]), api = await import(pathToFileURL(resolve(process.cwd(), "scripts/link-source-prerequisites.mjs")).href);
  const linked = await api.linkSourcePrerequisites({ root: process.cwd(), compiledDir: fileURLToPath(new URL("..", import.meta.url)),
    payloads, frameworkOptions: { periodicPresentations: f.assessments } });
  assert.deepEqual(linked.report.periodicReport.maps, f.assessments);
  for (const map of f.maps) assert.deepEqual(linked.payloads.get("/content-packages/source/maps/" + map.mapId + ".json"), map);
  const world = linked.inputs.get("/framework/world/catalog.json"), entry = linked.inputs.get("/framework/new-game.json");
  assert.equal(entry.worldCatalogHash, world.contentHash);
  for (const map of f.maps) assert.equal(linked.payloads.get("/content-packages/framework/maps/" + map.mapId + ".json").developmentProfile.fieldPresentation,
    "framework-ordinary-field-flat-v1");
  assert.equal(canonical([...payloads]), before);
});
test("periodic public input accepts only a fixed explicit policy and rejects external rules and accessors", async () => {
  const api = await import(pathToFileURL(resolve(process.cwd(), "scripts/compile-source-prerequisites.mjs")).href);
  assert.equal(api.sourcePeriodicMapsInput(undefined), undefined);
  const value = { kind: "web-source-periodic-presentation-input-v1", reason: "Explicit controlled Web policy" };
  assert.deepEqual(api.sourcePeriodicMapsInput(value), value); assert.notEqual(api.sourcePeriodicMapsInput(value), value);
  for (const bad of [null, {}, { ...value, kind: "unknown" }, { ...value, reason: " " }, { ...value, input: "external.json" },
    { ...value, worldPolicy: "guess" }, Object.defineProperty({ ...value }, "kind", { enumerable: true, get() { throw new Error("getter ran"); } })])
    assert.throws(() => api.sourcePeriodicMapsInput(bad), /periodic maps input/);
});
