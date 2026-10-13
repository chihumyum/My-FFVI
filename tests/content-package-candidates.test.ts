import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contentDigest } from "../src/core/content-integrity.js";
import { canonical } from "../src/core/canonical.js";
import type { GameContentRefs } from "../src/core/game-content-refs.js";
import type { Op } from "../src/field/types.js";
import { sourceGameContentRefsFixture, developmentGameContentRefsFixture } from "./fixtures/game-content-refs.js";
import { contentBatchProgramFixture } from "./fixtures/content-batch-program.js";
import { sealBatchContent } from "./fixtures/content-batch.js";

type Candidate = {
  payloads: Map<string, { contentHash: string } & Record<string, unknown>>;
  refs: Map<string, GameContentRefs>;
  report: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  plan?: { diagnostics: { code: string; reason: string }[] };
};
const load = async (name: string) => import(pathToFileURL(resolve(process.cwd(), "scripts", name + ".mjs")).href);
async function directory(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(resolve(tmpdir(), "ffvi-candidate-packages-"));
  try { await mkdir(resolve(root, "build")); await work(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function reader(files: Map<string, unknown>) {
  const calls: string[] = [];
  return { calls, readJson: async (url: string) => {
    calls.push(url); assert.ok(files.has(url), "Missing declared candidate " + url); return files.get(url);
  } };
}
async function baseInputs() {
  const source = await sourceGameContentRefsFixture("source", "/world");
  const framework = await sourceGameContentRefsFixture("framework", "/framework/world");
  const development = await developmentGameContentRefsFixture();
  return new Map<string, unknown>([
    ["/game/source-new-game.json", source.content], ["/world/catalog.json", source.catalog],
    ["/game/source-catalog.json", source.battle], ["/game/narshe.json", development.field],
    ["/game/opening-playable.json", development.battle], ["/framework/new-game.json", framework.content],
    ["/framework/world/catalog.json", framework.catalog],
    ...[source, framework].flatMap(f => [f.map, f.destination].map(map =>
      [f.catalog.maps[String(map.mapId)]!.url, map] as [string, unknown])),
  ]);
}

test("base package imports and candidate compilation perform no publication and detach all caller content", async () => {
  await directory(async root => {
    const files = await baseInputs(), before = canonical([...files]), host = reader(files);
    const { compileBaseContentPackages } = await load("build-content-packages");
    const result = await compileBaseContentPackages({ root, readJson: host.readJson }) as Candidate;
    assert.deepEqual([...result.refs.keys()], ["source", "framework", "development"]);
    assert.equal(result.payloads.size, 7);
    assert.ok([...result.payloads.keys()].every(url => url.startsWith("/content-packages/")));
    assert.equal(result.report.sourceGameplayAdmitted, false);
    assert.equal(canonical([...files]), before);
    result.payloads.get("/content-packages/development/entry.json")!.sourceSetHash = "changed";
    assert.equal(canonical([...files]), before, "A candidate must not borrow mutable input ownership");
    assert.deepEqual(await readdir(resolve(root, "build")), [], "No content, reports or staging directories are written");
  });
});

test("base candidates retain digest, entry/battle and profile checks with a trusted JSON reader", async () => {
  await directory(async root => {
    const files = await baseInputs(), { compileBaseContentPackages } = await load("build-content-packages");
    const value = structuredClone(files.get("/game/source-catalog.json")) as { contentHash: string; limitations?: string[] };
    value.limitations = ["Unsealed tamper"];
    const changed = new Map(files); changed.set("/game/source-catalog.json", value);
    await assert.rejects(compileBaseContentPackages({ root, ...reader(changed) }), /Content payload changed/);
    const entry = structuredClone(files.get("/game/source-new-game.json")) as { contentHash: string; battleCatalogHash: string };
    entry.battleCatalogHash = "0".repeat(64);
    changed.set("/game/source-catalog.json", files.get("/game/source-catalog.json"));
    changed.set("/game/source-new-game.json", sealBatchContent(entry));
    await assert.rejects(compileBaseContentPackages({ root, ...reader(changed) }), /identity|binding|reference/i);
    changed.set("/game/source-new-game.json", files.get("/game/source-new-game.json"));
    changed.set("/framework/new-game.json", files.get("/game/source-new-game.json"));
    await assert.rejects(compileBaseContentPackages({ root, ...reader(changed) }), /profile/);
    assert.deepEqual(await readdir(resolve(root, "build")), []);
  });
});

test("a failed candidate read is propagated and cannot fall back to an old package or poison a later preparation", async () => {
  await directory(async root => {
    const files = await baseInputs(), { compileBaseContentPackages } = await load("build-content-packages");
    const failure = new Error("Controlled private dependency failure");
    await assert.rejects(compileBaseContentPackages({ root, readJson: async () => { throw failure; } }),
      error => error === failure);
    const good = await compileBaseContentPackages({ root, ...reader(files) }) as Candidate;
    assert.equal(good.refs.size, 3);
    assert.deepEqual(await readdir(resolve(root, "build")), []);
  });
});

function developmentInputs() {
  const f = contentBatchProgramFixture(), { developmentProfile, ...raw } = structuredClone(f.packages.entry);
  const baseField = { ...raw, contentHash: developmentProfile!.sourceContentHash };
  const maps = f.packages.maps.map(map => structuredClone(map));
  const map = maps[1]!;
  map.scripts.init![0] = { ...map.scripts.init![0]!, kind: "blocked", mnemonic: "SyntheticUnknown",
    reason: "Retained future capability" } as Op;
  const sealedMaps = maps.map(sealBatchContent), draft = structuredClone(f.packages.catalog);
  for (const map of sealedMaps) {
    draft.maps[String(map.mapId)]!.url = `/framework/world/maps/${map.mapId}.json`;
    draft.maps[String(map.mapId)]!.contentHash = map.contentHash;
  }
  const catalog = sealBatchContent(draft), battle = sealBatchContent({ ...f.packages.battle,
    limitations: ["This build's declared candidate, separate from the old disk cache"] });
  const recipe = { kind: "development-content-batch-recipe-v1", id: "synthetic-development",
    baseField: "game/narshe.json", battle: "content-batches/ordinary-battles/battle.json",
    world: "framework/world/catalog.json", startMap: 2, entrance: 1,
    manifest: { ...f.manifest, id: "synthetic-development-candidate", mapIds: [2],
      roots: [{ kind: "entry", mapId: 2, entrance: 1, continuation: null }],
      routes: [{ ...f.manifest.routes[0], entry: "development-map", expectedMapId: 2,
        requiredMapIds: [2], requiredEncounterIds: [1001], inputs: [{ kind: "save-restore" }] }] } };
  const files = new Map<string, unknown>([["/game/narshe.json", baseField],
    ["/content-batches/ordinary-battles/battle.json", battle], ["/framework/world/catalog.json", catalog],
    ...sealedMaps.map(map => [catalog.maps[String(map.mapId)]!.url, map] as [string, unknown])]);
  return { files, recipe, battle };
}

test("development preparation uses this build's battle candidate and keeps the full unresolved dependency plan", async () => {
  await directory(async root => {
    const f = developmentInputs(), host = reader(f.files), before = canonical([...f.files]);
    await mkdir(resolve(root, "content-batches"));
    await writeFile(resolve(root, "content-batches/recipe.json"), JSON.stringify(f.recipe));
    await mkdir(resolve(root, "build/content-batches/ordinary-battles"), { recursive: true });
    const oldCache = "An old cache must not be consulted or overwritten";
    await writeFile(resolve(root, "build/content-batches/ordinary-battles/battle.json"), oldCache);
    const { compileDevelopmentContentBatch } = await load("build-development-content-batch");
    const result = await compileDevelopmentContentBatch({ root, recipePath: "content-batches/recipe.json",
      readJson: host.readJson }) as Candidate;
    assert.equal(result.refs.size, 1);
    assert.equal(result.payloads.get("/content-packages/synthetic-development/battle.json")!.contentHash, f.battle.contentHash);
    assert.ok(host.calls.includes("/content-batches/ordinary-battles/battle.json"));
    assert.ok(result.plan!.diagnostics.some(d => d.code === "instruction-blocked" && d.reason.includes("Retained future capability")));
    assert.equal(result.report.storyFlagsChanged, false);
    assert.equal(result.report.sourceCampaignComplete, false);
    assert.equal(canonical([...f.files]), before);
    assert.equal(await readFile(resolve(root, "build/content-batches/ordinary-battles/battle.json"), "utf8"), oldCache);
    assert.deepEqual(await readdir(resolve(root, "build")), ["content-batches"]);
  });
});

test("development candidate readers do not bypass rooted paths or signed payload verification", async () => {
  await directory(async root => {
    const f = developmentInputs(), { compileDevelopmentContentBatch } = await load("build-development-content-batch");
    await mkdir(resolve(root, "content-batches"));
    const path = resolve(root, "content-batches/recipe.json"), host = reader(f.files);
    await writeFile(path, JSON.stringify({ ...f.recipe, battle: "../escape.json" }));
    await assert.rejects(compileDevelopmentContentBatch({ root, recipePath: "content-batches/recipe.json", readJson: host.readJson }));
    assert.deepEqual(host.calls, []);
    await writeFile(path, JSON.stringify(f.recipe));
    const corrupt = new Map(f.files), changed = structuredClone(f.battle);
    changed.gameState.initialGil++;
    corrupt.set("/content-batches/ordinary-battles/battle.json", changed);
    await assert.rejects(compileDevelopmentContentBatch({ root, recipePath: "content-batches/recipe.json", ...reader(corrupt) }),
      /Content payload changed/);
    assert.deepEqual(await readdir(resolve(root, "build")), []);
  });
});

test("playground candidate input hooks still require the recipe's exact expected content hash", async () => {
  await directory(async root => {
    const payload = sealBatchContent({ contentHash: "", kind: "controlled-hash-input" });
    const ref = { url: "/content-batches/ordinary-battles/battle.json", contentHash: "a".repeat(64) };
    assert.notEqual(payload.contentHash, ref.contentHash);
    const recipe = { kind: "systems-playground-recipe-v1", id: "systems-playground",
      baseField: ref, battle: ref, baseWorld: ref, mapRules: ref, areaId: 7,
      supplies: { itemId: 10, count: 2 }, stages: [] };
    const { compileSystemsPlayground } = await load("build-systems-playground"), calls: string[] = [];
    await assert.rejects(compileSystemsPlayground(root, recipe, await contentDigest(recipe), {
      readJson: async (url: string) => { calls.push(url); return payload; },
    }), /Content identity mismatch/);
    assert.deepEqual(calls, Array(4).fill(ref.url));
    assert.deepEqual(await readdir(resolve(root, "build")), []);
  });
});
