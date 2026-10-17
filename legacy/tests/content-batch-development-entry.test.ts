import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContentBatchManifest, planContentBatch } from "../src/compiler/content-batch.js";
import { assessContentBatchAdmission, type ContentBatchAdmissionInput,
  type ContentBatchRouteSpec } from "../src/compiler/content-batch-admission.js";
import { compileDevelopmentMapEntry } from "../src/compiler/development-map-entry.js";
import { gameDevelopmentEntryBaseline } from "../src/core/game-development-entry.js";
import { hash } from "../src/compiler/content.js";
import { contentBatchProgramFixture } from "./fixtures/content-batch-program.js";
import { sealBatchContent } from "./fixtures/content-batch.js";

const filesModule = pathToFileURL(resolve(process.cwd(), "scripts/content-batch-files.mjs")).href;
const { batchRouteSpecs }: { batchRouteSpecs(manifest: ContentBatchManifest): ContentBatchRouteSpec[] } = await import(filesModule);

async function fixture() {
  const f = contentBatchProgramFixture();
  const { developmentProfile, ...rawField } = structuredClone(f.packages.entry);
  const baseField = { ...rawField, contentHash: developmentProfile!.sourceContentHash };
  const map = f.packages.maps[1]!, world = structuredClone(f.packages.catalog);
  world.maps[2]!.url = "/content-packages/selected-map.json";
  const catalog = sealBatchContent(world);
  const entry = await compileDevelopmentMapEntry({ baseField, baseBattle: f.packages.battle,
    catalog, map, entrance: 1 });
  const manifest = ContentBatchManifest.parse({ ...f.manifest, mapIds: [2],
    roots: [{ kind: "entry", mapId: 2, entrance: 1, continuation: null }],
    routes: [{ ...f.manifest.routes[0], entry: "development-map", expectedMapId: 2,
      requiredMapIds: [2], requiredEncounterIds: [1001], inputs: [{ kind: "save-restore" }] }],
    contentRefs: { kind: "game-content-refs-v1", profile: "framework",
      world: { url: "/content-packages/world.json", contentHash: catalog.contentHash }, source: null,
      development: { entry: { url: "/content-packages/entry.json", contentHash: entry.contentHash },
        battle: { url: "/content-packages/battle.json", contentHash: f.packages.battle.contentHash } } } });
  return { manifest, packages: { entry, battle: f.packages.battle, catalog, maps: [map] }, baseField };
}

function admission(f: Awaited<ReturnType<typeof fixture>>): ContentBatchAdmissionInput {
  const plan = planContentBatch(f.manifest, f.packages), routes = batchRouteSpecs(plan.manifest), runtimeHash = hash("unit runtime");
  return { manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: plan.contentHashes, profile: "framework", routes, diagnostics: plan.diagnostics,
    framework: { status: "passed", runtimeHash }, receipts: [{ kind: "content-batch-route-receipt-v1",
      routeId: routes[0]!.id, manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
      contentHashes: structuredClone(plan.contentHashes), profile: "framework", lane: "source-content-development",
      result: "completed", visitedMapIds: [2], completedEncounterIds: [1001], finalMapId: 2,
      checkpointReady: true, saveRestored: true, boundary: null, controls: ["authored admission unit evidence"],
      program: structuredClone(routes[0]!.program!) }] };
}

test("a development map batch binds the real starting map while preserving a different baseline field", async () => {
  const f = await fixture(), before = structuredClone(f), plan = planContentBatch(f.manifest, f.packages);
  assert.equal(f.packages.entry.map.identity!.mapId, 1);
  assert.equal(f.packages.entry.developmentEntry!.startMap, 2);
  assert.deepEqual(gameDevelopmentEntryBaseline(f.packages.entry, f.packages.catalog), f.baseField);
  assert.deepEqual(plan.diagnostics, []);
  assert.deepEqual(plan.dependencies.requiredMapIds, [2]);
  assert.deepEqual(plan.dependencies.encounterIds, [1001]);
  assert.equal(plan.runtimeAdmission, "unassessed");
  assert.equal(plan.sourceCampaignComplete, false);
  assert.deepEqual(f, before);
});

test("new entry identity cannot borrow source or controlled lanes, or omit the descriptor", async () => {
  const f = await fixture();
  for (const entry of ["source-new-game", "controlled-fixture"] as const)
    assert.throws(() => planContentBatch({ ...f.manifest,
      routes: [{ ...f.manifest.routes[0], entry }] }, f.packages), /entry lane/);
  assert.throws(() => planContentBatch({ ...f.manifest, profile: "source",
    contentRefs: { ...f.manifest.contentRefs!, profile: "source" } }, f.packages), /profile/);
  const missing = structuredClone(f.packages.entry); delete missing.developmentEntry;
  assert.throws(() => planContentBatch(f.manifest,
    { ...f.packages, entry: sealBatchContent(missing) }), /reference\/hash|entry binding/);
});

test("rehashing cannot hide a baseline state edit or replace the descriptor's bound dependencies", async () => {
  const f = await fixture();
  for (const key of ["baseFieldHash", "battleHash", "worldHash", "mapHash"] as const) {
    const entry = structuredClone(f.packages.entry); entry.developmentEntry![key] = "f".repeat(64);
    const changed = sealBatchContent(entry), manifest = structuredClone(f.manifest);
    manifest.contentRefs!.development!.entry.contentHash = changed.contentHash;
    assert.throws(() => planContentBatch(manifest, { ...f.packages, entry: changed }));
  }
  const entry = structuredClone(f.packages.entry); entry.entry.initialEventValues![0]!.value = 1;
  const changed = sealBatchContent(entry), manifest = structuredClone(f.manifest);
  manifest.contentRefs!.development!.entry.contentHash = changed.contentHash;
  assert.throws(() => planContentBatch(manifest, { ...f.packages, entry: changed }), /payload\/hash/);
});

test("development root coverage must use the exact PointIn without a replacement continuation", async () => {
  const f = await fixture();
  for (const root of [
    { kind: "entry" as const, mapId: 2, entrance: 99, continuation: null },
    { kind: "entry" as const, mapId: 2, entrance: 1, continuation: "init" },
    { kind: "script" as const, mapId: 2, script: "init" },
  ]) {
    const plan = planContentBatch({ ...f.manifest, roots: [root] }, f.packages);
    assert.ok(plan.diagnostics.some(item => item.code === "BATCH_ENTRY_UNSCANNED"));
  }
});

test("a new development lane retains unvisited instruction and provider diagnostics", async () => {
  const f = await fixture(), map = structuredClone(f.packages.maps[0]!);
  map.scripts.second!.push({ kind: "blocked", mnemonic: "UnknownSharedFeature", reason: "Unknown branch remains",
    script: "second", index: 8, source: { file: "synthetic", assetPath: "unvisited-branch" } });
  map.actorViewBlockers = [{ reason: "Missing source actor provider", source: map.map!.source }];
  const changed = sealBatchContent(map), catalog = structuredClone(f.packages.catalog);
  catalog.maps[2]!.contentHash = changed.contentHash;
  const world = sealBatchContent(catalog), entry = await compileDevelopmentMapEntry({ baseField: f.baseField,
    baseBattle: f.packages.battle, catalog: world, map: changed, entrance: 1 });
  const manifest = structuredClone(f.manifest);
  manifest.contentRefs!.world.contentHash = world.contentHash;
  manifest.contentRefs!.development!.entry.contentHash = entry.contentHash;
  const plan = planContentBatch(manifest, { ...f.packages, catalog: world, entry, maps: [changed] });
  assert.ok(plan.diagnostics.some(item => item.code === "instruction-blocked"));
  assert.ok(plan.diagnostics.some(item => item.code === "map-provider-blocked"));
  assert.equal(plan.runtimeAdmission, "unassessed");
});

test("development route evidence has its own lane and requires framework profile with every old gate", async () => {
  const f = await fixture(), raw = admission(f), before = structuredClone(raw);
  assert.equal(assessContentBatchAdmission(raw).status, "passed");
  assert.deepEqual(raw, before);
  for (const lane of ["source-profile", "synthetic-controlled"] as const) {
    const wrong = structuredClone(raw); wrong.receipts[0]!.lane = lane;
    assert.ok(assessContentBatchAdmission(wrong).blockers.some(item => item.code === "route-lane-mismatch"));
  }
  const source = structuredClone(raw); source.profile = "source"; source.receipts[0]!.profile = "source";
  assert.ok(assessContentBatchAdmission(source).blockers.some(item => item.code === "development-route-profile"));
  const unknown = structuredClone(raw); unknown.diagnostics.push({ code: "missing-provider", reason: "Unresolved source dependency" });
  assert.equal(assessContentBatchAdmission(unknown).status, "blocked");
  assert.equal(assessContentBatchAdmission(raw).sourceCampaignComplete, false);
});

test("the CLI reads the nominated development role through the real repository, without a source entry fallback", async () => {
  const f = await fixture(), root = await mkdtemp(join(tmpdir(), "ffvi-development-batch-"));
  const write = async (path: string, value: unknown) => {
    const absolute = join(root, path); await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, JSON.stringify(value));
  };
  try {
    await write("manifest.json", f.manifest);
    for (const [path, value] of [["world", f.packages.catalog], ["entry", f.packages.entry],
      ["battle", f.packages.battle], ["selected-map", f.packages.maps[0]]] as const)
      await write(`build/content-packages/${path}.json`, value);
    const { readSourceBatch } = await import(filesModule);
    const result = await readSourceBatch(root, "manifest.json", fileURLToPath(new URL("../", import.meta.url)));
    assert.deepEqual(result.packages, f.packages);
    assert.deepEqual(result.plan, planContentBatch(f.manifest, f.packages));
    const noDescriptor = structuredClone(f.packages.entry); delete noDescriptor.developmentEntry;
    const changed = sealBatchContent(noDescriptor), manifest = structuredClone(f.manifest);
    manifest.contentRefs!.development!.entry.contentHash = changed.contentHash;
    await write("manifest.json", manifest); await write("build/content-packages/entry.json", changed);
    await assert.rejects(readSourceBatch(root, "manifest.json", fileURLToPath(new URL("../", import.meta.url))),
      /declared map entry/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
