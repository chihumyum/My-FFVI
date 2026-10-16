import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContentBatchManifest, planContentBatch } from "../src/compiler/content-batch.js";
import { hash } from "../src/compiler/content.js";
import { parseGameContentRefs } from "../src/core/game-content-refs.js";
import { contentBatchFixture, sealBatchContent } from "./fixtures/content-batch.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

function developmentRefs(f: ReturnType<typeof contentBatchFixture>) {
  return { kind: "game-content-refs-v1" as const, profile: f.manifest.profile,
    world: { url: "/content-packages/world.json", contentHash: f.packages.catalog.contentHash },
    source: null,
    development: {
      entry: { url: "/game/custom-field.json", contentHash: f.packages.entry.contentHash },
      battle: { url: "/game/custom-development-battle.json", contentHash: f.packages.battle.contentHash },
    } };
}

// Source-entry shapes use an existing authored initializer fixture. These tests
// validate package bindings and file reads, not native/story reachability.
function sourceFixture() {
  const f = sourceNewGameFixture(), map = sealBatchContent(f.map);
  const rawWorld = structuredClone(f.world);
  rawWorld.maps[String(map.mapId)]!.url = "/content-packages/first-map.json";
  rawWorld.maps[String(map.mapId)]!.contentHash = map.contentHash;
  const catalog = sealBatchContent(rawWorld), battle = sealBatchContent(f.battle);
  const entry = sealBatchContent({ ...f.content, worldCatalogHash: catalog.contentHash,
    battleCatalogHash: battle.contentHash, mapContentHash: map.contentHash });
  const manifest = ContentBatchManifest.parse({ kind: "content-batch-manifest-v1", id: "source-refs-fixture",
    profile: "source", mapIds: [map.mapId], roots: [{ kind: "entry", mapId: map.mapId,
      entrance: entry.entry.entrance, continuation: entry.entry.reservedScript.name }],
    routes: [{ id: "source-entry", entry: "source-new-game", expectedMapId: map.mapId,
      requiredMapIds: [map.mapId], requiredEncounterIds: [], maxTicks: 100,
      inputs: [], choiceAnswers: [], battleAbilityIds: [] }] });
  // Deliberately nominate the old alias input name. A refs-aware reader must
  // read this exact file rather than /game/source-new-game.json.
  const contentRefs = { kind: "game-content-refs-v1" as const, profile: "source" as const,
    world: { url: "/content-packages/world.json", contentHash: catalog.contentHash },
    source: { entry: { url: "/game/new-game.json", contentHash: entry.contentHash },
      battle: { url: "/game/custom-source-battle.json", contentHash: battle.contentHash } },
    development: null };
  return { manifest, packages: { entry, catalog, battle, maps: [map] }, contentRefs };
}

test("an old batch keeps its exact manifest and dependency digest without references", () => {
  const f = contentBatchFixture(), before = structuredClone(f), plan = planContentBatch(f.manifest, f.packages);
  assert.deepEqual(plan.manifest, f.manifest);
  assert.equal(Object.hasOwn(plan.manifest, "contentRefs"), false);
  assert.equal(plan.manifestHash, hash(f.manifest));
  assert.equal(plan.dependencyHash, hash({ contentHashes: plan.contentHashes,
    dependencies: plan.dependencies, encounters: plan.encounters, diagnostics: plan.diagnostics }));
  assert.deepEqual(f, before);
});

test("a batch uses the same strict reference parser as the repository", () => {
  const f = contentBatchFixture(), refs = developmentRefs(f);
  const parsed = ContentBatchManifest.parse({ ...f.manifest, contentRefs: refs });
  assert.deepEqual(parsed.contentRefs, parseGameContentRefs(refs));
  for (const contentRefs of [{ ...refs, approved: true }, { ...refs, source: null, development: null },
    { ...refs, world: { url: refs.world.url } },
    { ...refs, development: { ...refs.development, battle: { ...refs.development.battle, contentHash: "bad" } } }]) {
    assert.throws(() => parseGameContentRefs(contentRefs));
    assert.throws(() => ContentBatchManifest.parse({ ...f.manifest, contentRefs }));
  }
});

test("controlled and source batches bind their separate nominated lanes", () => {
  const controlled = contentBatchFixture(), source = sourceFixture();
  const first = planContentBatch({ ...controlled.manifest, contentRefs: developmentRefs(controlled) }, controlled.packages);
  const second = planContentBatch({ ...source.manifest, contentRefs: source.contentRefs }, source.packages);
  assert.equal(first.manifest.contentRefs!.source, null);
  assert.equal(second.manifest.contentRefs!.development, null);
  assert.equal(first.contentHashes.entry, controlled.packages.entry.contentHash);
  assert.equal(second.contentHashes.entry, source.packages.entry.contentHash);
  assert.equal(first.runtimeAdmission, "unassessed");
  assert.equal(second.sourceCampaignComplete, false);
});

test("a null required lane cannot borrow the other entry with the same hashes", () => {
  const controlled = contentBatchFixture(), refs = developmentRefs(controlled);
  assert.throws(() => planContentBatch({ ...controlled.manifest,
    contentRefs: { ...refs, source: refs.development, development: null } }, controlled.packages), /required entry lane/);
  const source = sourceFixture();
  assert.throws(() => planContentBatch({ ...source.manifest,
    contentRefs: { ...source.contentRefs, source: null, development: source.contentRefs.source } }, source.packages),
    /required entry lane/);
});

test("reference profile and all three selected package hashes must match", () => {
  const f = contentBatchFixture(), refs = developmentRefs(f), other = "f".repeat(64);
  assert.throws(() => planContentBatch({ ...f.manifest, contentRefs: { ...refs, profile: "framework" } }, f.packages), /profile/);
  assert.throws(() => planContentBatch({ ...f.manifest, contentRefs: {
    ...refs, world: { ...refs.world, contentHash: other } } }, f.packages), /world reference/);
  for (const lane of [
    { ...refs.development, entry: { ...refs.development.entry, contentHash: other } },
    { ...refs.development, battle: { ...refs.development.battle, contentHash: other } },
  ]) assert.throws(() => planContentBatch({ ...f.manifest,
    contentRefs: { ...refs, development: lane } }, f.packages), /entry\/battle reference/);
});

test("framework reference bindings retain the original explicit development profile gate", () => {
  const f = contentBatchFixture(); f.manifest.profile = "framework";
  const profile = { kind: "framework-development-v1" as const,
    policy: "omit-anonymous-environment-particles-v1" as const, sourceContentHash: "a".repeat(64), omissions: [] };
  f.packages.maps = f.packages.maps.map(map => sealBatchContent({ ...map, developmentProfile: profile }));
  for (const map of f.packages.maps) f.packages.catalog.maps[map.mapId]!.contentHash = map.contentHash;
  f.packages.catalog = sealBatchContent({ ...f.packages.catalog, developmentProfile: profile });
  f.packages.entry = sealBatchContent({ ...f.packages.entry, developmentProfile: profile });
  const manifest = { ...f.manifest, contentRefs: developmentRefs(f) };
  assert.deepEqual(planContentBatch(manifest, f.packages).diagnostics, []);
  const incompatible = { ...manifest, profile: "source", contentRefs: { ...manifest.contentRefs, profile: "source" } };
  assert.throws(() => planContentBatch(incompatible, f.packages), /content profile mismatch/);
});

test("reference addresses affect both digests even when all content hashes stay unchanged", () => {
  const f = contentBatchFixture(), refs = developmentRefs(f);
  const before = planContentBatch({ ...f.manifest, contentRefs: refs }, f.packages);
  refs.development.entry.url = "/content-packages/other-entry.json";
  const after = planContentBatch({ ...f.manifest, contentRefs: refs }, f.packages);
  assert.deepEqual(after.contentHashes, before.contentHashes);
  assert.notEqual(after.manifestHash, before.manifestHash);
  assert.notEqual(after.dependencyHash, before.dependencyHash);
  assert.equal(before.manifest.contentRefs!.development!.entry.url, "/game/custom-field.json");
  assert.deepEqual(before.manifest.contentRefs, parseGameContentRefs(developmentRefs(f)));
});

test("matching reference pins cannot bless an edited payload or source development escape", () => {
  const f = contentBatchFixture(), refs = developmentRefs(f);
  f.packages.entry.entry.player.x++;
  assert.throws(() => planContentBatch({ ...f.manifest, contentRefs: refs }, f.packages), /payload\/hash/);
  const source = sourceFixture();
  const encounter = Object.values(source.packages.battle.encounters)[0]!;
  encounter.escapePolicy = { kind: "framework-battle-escape-v1", id: "authored-escape" };
  source.packages.battle = sealBatchContent(source.packages.battle);
  source.packages.entry = sealBatchContent({ ...source.packages.entry, battleCatalogHash: source.packages.battle.contentHash });
  source.contentRefs.source.battle.contentHash = source.packages.battle.contentHash;
  source.contentRefs.source.entry.contentHash = source.packages.entry.contentHash;
  assert.throws(() => planContentBatch({ ...source.manifest, contentRefs: source.contentRefs }, source.packages), /source profile.*escape/);
});

const compiled = fileURLToPath(new URL("../", import.meta.url));
async function readBatch(root: string, readJson?: (url: string) => Promise<unknown>) {
  const script = pathToFileURL(resolve(process.cwd(), "scripts/content-batch-files.mjs")).href;
  const { readSourceBatch } = await import(script);
  return readSourceBatch(root, "manifest.json", compiled, readJson ? {readJson} : undefined) as Promise<ReturnType<typeof sourceReadResult>>;
}
function sourceReadResult() {
  const f = sourceFixture();
  return { plan: planContentBatch({ ...f.manifest, contentRefs: f.contentRefs }, f.packages), packages: f.packages };
}
async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}
async function filesFixture({ legacy = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ffvi-batch-refs-")), f = sourceFixture();
  const manifest = legacy ? f.manifest : { ...f.manifest, contentRefs: f.contentRefs };
  await writeJson(join(root, "manifest.json"), manifest);
  await writeJson(join(root, "build", legacy ? "game/source-new-game.json" : "game/new-game.json"), f.packages.entry);
  await writeJson(join(root, "build", legacy ? "game/source-catalog.json" : "game/custom-source-battle.json"), f.packages.battle);
  await writeJson(join(root, "build", legacy ? "world/catalog.json" : "content-packages/world.json"), f.packages.catalog);
  await writeJson(join(root, "build/content-packages/first-map.json"), f.packages.maps[0]);
  return { ...f, root };
}

test("the file adapter reads trusted exact source references without compatibility aliasing", async () => {
  const f = await filesFixture();
  try {
    const loaded = await readBatch(f.root);
    assert.deepEqual(loaded.packages, f.packages);
    assert.deepEqual(loaded.plan.manifest.contentRefs, parseGameContentRefs(f.contentRefs));
    assert.equal(loaded.plan.manifestHash, hash({ ...f.manifest, contentRefs: f.contentRefs }));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a legacy source manifest still uses the old default URLs and aliases", async () => {
  const f = await filesFixture({ legacy: true });
  try {
    const loaded = await readBatch(f.root);
    assert.deepEqual(loaded.packages, f.packages);
    assert.equal(Object.hasOwn(loaded.plan.manifest, "contentRefs"), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a private candidate supplies exact batch references without public fallback and still cannot bless changed payloads", async () => {
  const f = await filesFixture();
  try {
    const payloads = new Map<string, unknown>([
      [f.contentRefs.world.url, f.packages.catalog], [f.contentRefs.source.entry.url, f.packages.entry],
      [f.contentRefs.source.battle.url, f.packages.battle],
      [f.packages.catalog.maps[String(f.packages.maps[0]!.mapId)]!.url, f.packages.maps[0]],
    ]);
    await rm(join(f.root, "build"), {recursive:true});
    const readJson = async (url: string) => { assert(payloads.has(url), "Missing private candidate object"); return structuredClone(payloads.get(url)); };
    assert.deepEqual((await readBatch(f.root, readJson)).packages, f.packages);
    const changed = structuredClone(f.packages.entry); changed.entry.mapId++;
    payloads.set(f.contentRefs.source.entry.url, changed);
    await assert.rejects(readBatch(f.root, readJson), /hash|digest|payload/i);
    payloads.delete(f.contentRefs.source.entry.url);
    await assert.rejects(readBatch(f.root, readJson), /Missing private candidate object/);
  } finally { await rm(f.root, {recursive:true, force:true}); }
});

test("the file adapter rejects undeclared fixture execution lanes", async () => {
  const f = await filesFixture();
  try {
    await writeJson(join(f.root, "manifest.json"), { ...f.manifest, contentRefs: {
      ...f.contentRefs, source: null, development: f.contentRefs.source } });
    await assert.rejects(readBatch(f.root), /source|entry.*(?:missing|unavailable|disabled)|lane/i);
    await writeJson(join(f.root, "manifest.json"), { ...f.manifest,
      routes: f.manifest.routes.map(route => ({ ...route, entry: "controlled-fixture" })) });
    await assert.rejects(readBatch(f.root), /single declared source, development-map or initialized framework entry lane/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a source reference cannot load a rehashed legacy owned seed", async () => {
  const f = await filesFixture();
  try {
    const raw = sourceNewGameFixture(), battle = sealBatchContent(raw.developmentBattle);
    const entry = sealBatchContent({ ...f.packages.entry, battleCatalogHash: battle.contentHash });
    const refs = { ...f.contentRefs, source: {
      entry: { ...f.contentRefs.source.entry, contentHash: entry.contentHash },
      battle: { ...f.contentRefs.source.battle, contentHash: battle.contentHash } } };
    await writeJson(join(f.root, "manifest.json"), { ...f.manifest, contentRefs: refs });
    await writeJson(join(f.root, "build/game/new-game.json"), entry);
    await writeJson(join(f.root, "build/game/custom-source-battle.json"), battle);
    await assert.rejects(readBatch(f.root), /source.*(?:catalog|checkpoint|seed)|initialOwnedConditions/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("catalog child URLs must remain canonical within the trusted build root", async () => {
  for (const url of ["/world/maps/../../outside.json", "/world//maps/entry.json"]) {
    const f = await filesFixture();
    try {
      const raw = structuredClone(f.packages.catalog);
      raw.maps[String(f.packages.maps[0]!.mapId)]!.url = url;
      const catalog = sealBatchContent(raw), entry = sealBatchContent({ ...f.packages.entry, worldCatalogHash: catalog.contentHash });
      const refs = { ...f.contentRefs, world: { ...f.contentRefs.world, contentHash: catalog.contentHash },
        source: { ...f.contentRefs.source, entry: { ...f.contentRefs.source.entry, contentHash: entry.contentHash } } };
      await writeJson(join(f.root, "manifest.json"), { ...f.manifest, contentRefs: refs });
      await writeJson(join(f.root, "build/content-packages/world.json"), catalog);
      await writeJson(join(f.root, "build/game/new-game.json"), entry);
      await assert.rejects(readBatch(f.root), /Unexpected content path/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("a rooted reference cannot escape build through a filesystem symlink", async () => {
  const f = await filesFixture();
  try {
    const external = join(f.root, "outside.json"), location = join(f.root, "build/content-packages/world.json");
    await writeJson(external, f.packages.catalog);
    await rm(location); await symlink(external, location);
    await assert.rejects(readBatch(f.root), /outside build/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
