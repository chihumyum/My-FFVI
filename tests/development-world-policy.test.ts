import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical } from "../src/core/canonical.js";
import { gameDevelopmentEntryBaseline } from "../src/core/game-development-entry.js";
import { sourceGameContentRefsFixture, developmentGameContentRefsFixture } from "./fixtures/game-content-refs.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
const module = () => import(pathToFileURL(resolve(process.cwd(), "scripts/build-development-content-batch.mjs")).href);
async function fixture() {
  const source = await sourceGameContentRefsFixture("source", "/world"), development = await developmentGameContentRefsFixture();
  // This fixture's generic entity evidence intentionally differs from its
  // factory PointIn. Bind the authored test entrance exactly; production gates
  // must keep rejecting that mismatch rather than weakening their comparison.
  const draft = structuredClone(source.map), point = draft.partyEntry!.pointIns[0]!;
  for (const entities of [draft.map!.entities, draft.map!.groups!.entity_default!.entities])
    for (const entity of entities.filter(entity => entity.kind === 0 && entity.objectId === point.id))
      Object.assign(entity, { x: point.x, y: point.y, layer: point.layer, direction: point.direction, source: structuredClone(point.source) });
  source.map = sealBatchContent(draft);
  source.catalog = sealBatchContent({ ...source.catalog, maps: { ...source.catalog.maps,
    [source.map.mapId]: { ...source.catalog.maps[source.map.mapId]!, contentHash: source.map.contentHash } } });
  source.content = sealBatchContent({ ...source.content, worldCatalogHash: source.catalog.contentHash, mapContentHash: source.map.contentHash });
  const field = sealBatchContent({ ...development.field, sourceSetHash: source.battle.common.fieldSourceSetHash,
    parentSourceSetHash: source.catalog.parentSourceSetHash });
  const recipe = { kind: "development-content-batch-recipe-v2", id: "independent-development", baseField: "game/narshe.json",
    battle: "content-batches/ordinary-battles/battle.json", world: "world/catalog.json",
    frameworkPolicy: { kind: "independent-source-framework-v1", sourceEntry: "game/source-new-game.json" },
    startMap: source.map.mapId, entrance: source.map.partyEntry!.pointIns[0]!.id,
    manifest: { kind: "content-batch-manifest-v1", id: "independent-development-fixture", profile: "framework",
      mapIds: [source.map.mapId], roots: [{ kind: "entry", mapId: source.map.mapId, entrance: source.map.partyEntry!.pointIns[0]!.id, continuation: null }], routes: [{ id: "independent-source", entry: "development-map", expectedMapId: source.map.mapId,
        requiredMapIds: [source.map.mapId], requiredEncounterIds: [], maxTicks: 20, inputs: [{ kind: "save-restore" }],
        choiceAnswers: [], battleAbilityIds: [] }] } };
  const files = new Map<string, any>([["/game/narshe.json", field], ["/content-batches/ordinary-battles/battle.json", source.battle],
    ["/world/catalog.json", source.catalog], ["/game/source-new-game.json", source.content],
    ...[source.map, source.destination].map(map => [source.catalog.maps[map.mapId]!.url, map] as [string, unknown]),
    ["/framework/world/catalog.json", { forbiddenGlobalLogicalOwner: true }]]);
  const calls: string[] = [], run = async (overrides: Record<string, unknown> = {}) => (await module()).compileDevelopmentContentBatch({
    root: process.cwd(), recipe, recipeSha256: "c".repeat(64), readJson: async (url: string) => {
      calls.push(url); assert.ok(files.has(url), "Missing exact candidate: " + url); return files.get(url);
    }, ...overrides });
  return { source, field, recipe, files, calls, run };
}
test("v2 derives a complete independent world from the same strict candidate without inheriting global policies", async () => {
  const f = await fixture(), before = canonical({ recipe: f.recipe, files: [...f.files] }), result = await f.run();
  const world = result.payloads.get("/content-packages/independent-development/world.json"), entry = result.payloads.get("/content-packages/independent-development/entry.json");
  assert.equal(Object.keys(world.maps).length, 2, "Whole source index is retained, including undeclared route maps");
  assert.equal(f.calls.includes("/framework/world/catalog.json"), false); assert.ok(f.calls.includes("/game/source-new-game.json"));
  for (const [id, index] of Object.entries(world.maps) as [string, any][]) {
    assert.equal(index.url, "/content-packages/independent-development/maps/" + id + ".json");
    const map = result.payloads.get(index.url); assert.equal(map.contentHash, index.contentHash);
    for (const key of ["logicalFieldEffects", "worldMap", "fieldPresentation"])
      assert.equal(map.developmentProfile[key], undefined);
    assert.deepEqual(map.scripts, f.files.get(f.source.catalog.maps[id]!.url).scripts);
  }
  assert.deepEqual(gameDevelopmentEntryBaseline(entry, world), f.field);
  assert.equal(result.report.worldDerivation.sourceEntryHash, f.source.content.contentHash);
  assert.equal(result.report.worldDerivation.sourceWorldHash, f.source.catalog.contentHash);
  assert.equal(result.report.worldDerivation.globalFrameworkRead, false);
  assert.equal(canonical({ recipe: f.recipe, files: [...f.files] }), before);
});
test("independent derivation rejects profiled source inputs, stale source entries and missing candidate dependencies", async () => {
  for (const kind of ["world-profile", "map-profile", "entry-profile", "stale-entry", "missing-entry", "map-tamper"] as const) {
    const f = await fixture();
    if (kind === "world-profile") f.files.set("/world/catalog.json", sealBatchContent({ ...f.source.catalog, developmentProfile: { kind: "fake" } }));
    if (kind === "map-profile") {
      const map = sealBatchContent({ ...f.source.map, developmentProfile: { kind: "fake" } });
      const world = structuredClone(f.source.catalog); world.maps[map.mapId]!.contentHash = map.contentHash;
      f.files.set("/world/catalog.json", sealBatchContent(world)); f.files.set(f.source.catalog.maps[map.mapId]!.url, map);
    }
    if (kind === "entry-profile") f.files.set("/game/source-new-game.json", sealBatchContent({ ...f.source.content, developmentProfile: { kind: "fake" } }));
    if (kind === "stale-entry") f.files.set("/game/source-new-game.json", sealBatchContent({ ...f.source.content, worldCatalogHash: "f".repeat(64) }));
    if (kind === "missing-entry") f.files.delete("/game/source-new-game.json");
    if (kind === "map-tamper") f.files.get(f.source.catalog.maps[f.source.map.mapId]!.url).name = "late unsealed source";
    await assert.rejects(f.run(), /strict|strip|binding mismatch|Missing exact candidate|payload changed/i, kind);
  }
});
test("v2 policy is fixed and exact, and source recipe resolution preserves the original declaration", async () => {
  const f = await fixture(), { resolveSourceRecipeInputs } = await import(pathToFileURL(resolve(process.cwd(), "scripts/source-recipe-inputs.mjs")).href);
  const input = { recipePath: "synthetic-v2.recipe.json", recipeBytes: Buffer.from(JSON.stringify(f.recipe)),
    readCurrentJson: async () => { throw new Error("No unpinned disk fallback"); }, readCandidateJson: async () => { throw new Error("No unpinned disk fallback"); } };
  const output = await resolveSourceRecipeInputs(input); assert.deepEqual(output.recipe, f.recipe);
  for (const change of [
    { ...f.recipe, world: "framework/world/catalog.json" },
    { ...f.recipe, frameworkPolicy: { ...f.recipe.frameworkPolicy, kind: "unknown" } },
    { ...f.recipe, frameworkPolicy: { ...f.recipe.frameworkPolicy, sourceEntry: "cached/entry.json" } },
    { ...f.recipe, frameworkPolicy: { ...f.recipe.frameworkPolicy, logicalFieldEffects: "inherit" } },
  ]) {
    await assert.rejects(f.run({ recipe: change }), /policy|strict|candidate|source world|source entry|deep-equal|Expected values/i);
    await assert.rejects(resolveSourceRecipeInputs({ ...input, recipeBytes: Buffer.from(JSON.stringify(change)) }), /policy|strict|candidate|source world|source entry|deep-equal|Expected values/i);
  }
});

test("legacy v1 cannot silently inherit a global logical policy or strip it to enter an unchanged raw baseline", async () => {
  const f = await fixture(), { compileFrameworkContent } = await import("../src/compiler/framework-content.js");
  const frame = compileFrameworkContent(f.source.catalog, [f.source.map, f.source.destination], f.source.content);
  const maps = frame.maps.map(map => sealBatchContent({ ...map, developmentProfile: { ...map.developmentProfile,
    logicalFieldEffects: "web-logical-all-loop-field-effects-v1" as const } }));
  const catalog = structuredClone(frame.catalog); catalog.developmentProfile.logicalFieldEffects = "web-logical-all-loop-field-effects-v1";
  for (const map of maps) { catalog.maps[map.mapId]!.contentHash = map.contentHash; f.files.set(catalog.maps[map.mapId]!.url, map); }
  f.files.set("/framework/world/catalog.json", sealBatchContent(catalog));
  const { frameworkPolicy: _, ...baseline } = f.recipe, recipe = { ...baseline, kind: "development-content-batch-recipe-v1", world: "framework/world/catalog.json" };
  const before = canonical(f.field);
  await assert.rejects(f.run({ recipe }), /Source entry profile mismatch/);
  assert.equal(canonical(f.field), before);
});
