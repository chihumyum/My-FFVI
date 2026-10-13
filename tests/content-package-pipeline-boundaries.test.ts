import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical } from "../src/core/canonical.js";
import { contentDigest, verifyContent } from "../src/core/content-integrity.js";
import { GameContentRepository } from "../src/core/game-content.js";
import type { GameContentRefsV1 } from "../src/core/game-content-refs.js";
import { parseGameContentReleaseIndex, resolveGameContentReleaseObject, selectGameContentRelease } from "../src/core/game-content-release.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

const compiledDir = fileURLToPath(new URL("../", import.meta.url));
const scripts = (name: string) => pathToFileURL(resolve(process.cwd(), "scripts", name + ".mjs")).href;
const primaryURL = "/content-packages/primary.json";
const mediaURL = "/world-media/controlled.png";
const media = Buffer.from("Controlled media bytes only; no image decoding or browser verification");
const mediaSha = createHash("sha256").update(media).digest("hex");
const bytes = (value: unknown) => Buffer.from(canonical(value) + "\n");
type ArchiveInput = { root: string; compiledDir: string; packageDirectory?: string; out?: string;
  readJson?: (url: string) => Promise<Uint8Array>; readMedia?: (url: string) => Promise<Uint8Array> };
type ArchiveResult = { packages: string[]; reports: Record<string, unknown>[] };
type Archive = (input: ArchiveInput) => Promise<ArchiveResult>;
type PipelineReport = { result: string; published: boolean; retainedCASObjects: number;
  stages: { name: string; status: string }[] };
const archive: Archive = async input => (await import(scripts("archive-content-release"))).archivePublishedContentPackages(input);
async function publish(root: string, payloads: Map<string, unknown>, archiver: Archive = archive): Promise<PipelineReport> {
  return (await import(scripts("content-package-pipeline"))).publishContentPackages({ root, compiledDir,
    compile: async () => ({ payloads }), archive: archiver });
}
async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...body } = structuredClone(value);
  return { ...body, contentHash: await contentDigest(body) } as T;
}
async function put(root: string, url: string, value: Uint8Array): Promise<void> {
  const file = resolve(root, "build", "." + url);
  await mkdir(dirname(file), { recursive: true }); await writeFile(file, value);
}

/** Actual Repository/source-entry bindings over redistributable controlled
 * initializer data. Real archiving reads all JSON and media bytes; the test
 * neither decodes the media nor claims original game/story execution. */
async function fixture(root: string, pretty = false) {
  const f = sourceNewGameFixture(), map = await seal(f.map);
  const worldDraft = structuredClone(f.world), battleDraft = structuredClone(f.battle);
  for (const character of Object.values(worldDraft.characters)) for (const sprite of Object.values(character.sprites)) {
    sprite.file = mediaURL; sprite.sha256 = mediaSha;
  }
  for (const sprite of Object.values(battleDraft.common.sprites)) sprite.file = mediaURL;
  const mapURL = "/world/maps/" + map.mapId + ".json";
  worldDraft.maps[map.mapId]!.url = mapURL; worldDraft.maps[map.mapId]!.contentHash = map.contentHash;
  const world = await seal(worldDraft), battle = await seal(battleDraft), entry = await seal({ ...f.content,
    worldCatalogHash: world.contentHash, battleCatalogHash: battle.contentHash, mapContentHash: map.contentHash });
  const refs: GameContentRefsV1 = { kind: "game-content-refs-v1", profile: "source", development: null,
    world: { url: "/content-packages/primary/world.json", contentHash: world.contentHash }, source: {
      entry: { url: "/content-packages/primary/entry.json", contentHash: entry.contentHash },
      battle: { url: "/content-packages/primary/battle.json", contentHash: battle.contentHash } } };
  const payloads = new Map<string, unknown>([[primaryURL, refs], [refs.world.url, world],
    [refs.source!.entry.url, entry], [refs.source!.battle.url, battle]]);
  const originalBytes = new Map<string, Buffer>();
  for (const [url, value] of payloads) {
    const original = pretty ? Buffer.from(JSON.stringify(value, null, 2) + "\n") : bytes(value);
    originalBytes.set(url, original); await put(root, url, original);
  }
  originalBytes.set(mapURL, bytes(map)); await put(root, mapURL, bytes(map)); await put(root, mediaURL, media);
  return { map, mapURL, world, battle, entry, refs, payloads, originalBytes };
}
async function withRoot(work: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "ffvi-package-boundaries-")));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function collection(root: string): Promise<Map<string, Buffer>> {
  const output = new Map<string, Buffer>(), base = resolve(root, "build/content-packages");
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, item.name), name = prefix + item.name;
      if (item.isDirectory()) await visit(path, name + "/");
      else { assert.equal(item.isFile(), true); output.set(name, await readFile(path)); }
    }
  }
  await visit(base, ""); return output;
}
const indexFile = (root: string) => resolve(root, "build/content-releases/packages/primary.json");
async function index(root: string) {
  const value = parseGameContentReleaseIndex(JSON.parse(await readFile(indexFile(root), "utf8")));
  await verifyContent(value); return value;
}
async function currentRepository(root: string): Promise<GameContentRepository> {
  const refs = JSON.parse(await readFile(resolve(root, "build", "." + primaryURL), "utf8")) as GameContentRefsV1;
  return new GameContentRepository(async url => JSON.parse(await readFile(resolve(root, "build", "." + url), "utf8")), refs.profile, refs);
}
async function archivedRepository(root: string): Promise<GameContentRepository> {
  const selected = selectGameContentRelease(await index(root), { kind: "current" });
  return new GameContentRepository(async logical => {
    const ref = resolveGameContentReleaseObject(selected, logical);
    return verifyContent(JSON.parse(await readFile(resolve(root, "build", "." + ref.url), "utf8")), ref.contentHash);
  }, selected.profile, selected.release.refs);
}
async function assertClean(root: string): Promise<void> {
  const names = await readdir(resolve(root, "build"));
  assert.deepEqual(names.filter(name => name.startsWith(".package-candidate-") || name.startsWith(".package-candidate-history-") ||
    name === ".content-package-pipeline.lock" || name === ".previous-package-collection"), []);
}
async function failure(run: Promise<PipelineReport>, expected: RegExp): Promise<PipelineReport> {
  let caught: unknown;
  try { await run; } catch (error) { caught = error; }
  assert.ok(caught instanceof Error); assert.match(caught.message, expected);
  const report = (caught as Error & { report: PipelineReport }).report;
  assert.equal(report.result, "failed"); assert.equal(report.published, false);
  assert.equal(report.stages.some(stage => stage.name === "publish-complete-collection"), false);
  return report;
}

test("same-body candidates retain pretty published JSON and history bytes across repeated real archival", async () => {
  await withRoot(async root => {
    const f = await fixture(root, true), before = await collection(root);
    assert.notDeepEqual(f.originalBytes.get(f.refs.world.url), bytes(f.world));
    assert.deepEqual((await archive({ root, compiledDir })).packages, ["primary"]);
    const oldIndex = await readFile(indexFile(root));
    for (let attempt = 0; attempt < 2; attempt++) {
      const report = await publish(root, f.payloads);
      assert.equal(report.result, "passed"); assert.equal(report.published, true);
      assert.ok(report.retainedCASObjects >= 4);
      assert.ok(report.stages.every(stage => stage.status === "passed"));
      assert.deepEqual(await collection(root), before);
      assert.deepEqual(await readFile(indexFile(root)), oldIndex, "Equivalent content cannot create another release");
      const history = await index(root); assert.equal(history.releases.length, 1);
      for (const [url, hash] of Object.entries(history.releases[0]!.bindings))
        assert.deepEqual(await readFile(resolve(root, "build/content-releases/objects", hash + ".json")), f.originalBytes.get(url));
      assert.equal((await (await currentRepository(root)).sourceNewGame()).content.contentHash, f.entry.contentHash);
      assert.equal((await (await archivedRepository(root)).sourceNewGame()).content.contentHash, f.entry.contentHash);
      await assertClean(root);
    }
  });
});

test("late JSON and media symlink rebinding reject before publication, retain the collection and permit a fresh retry", async () => {
  for (const resource of ["json", "media"] as const) await withRoot(async root => {
    const f = await fixture(root), before = await collection(root);
    await archive({ root, compiledDir }); const oldIndex = await readFile(indexFile(root));
    const logical = resource === "json" ? f.mapURL : mediaURL, link = resolve(root, "build", "." + logical);
    const original = link + ".original", other = link + ".other", originalBytes = await readFile(link);
    await writeFile(original, originalBytes);
    await writeFile(other, resource === "json" ? bytes(await seal({ ...f.map, name: "Different valid external map" })) : Buffer.from("different media"));
    await rm(link); await symlink(original, link);
    let calls = 0;
    const changingArchive: Archive = async input => {
      const archived = await archive(input);
      // Both complete archives succeeded with the original bytes. Change only
      // the logical binding, leaving the originally consumed target untouched.
      if (++calls === 2) { await rm(link); await symlink(other, link); }
      return archived;
    };
    const report = await failure(publish(root, f.payloads, changingArchive), /changed its path binding/);
    assert.equal(report.stages.find(stage => stage.name === "validate-unchanged-inputs")?.status, "failed");
    assert.equal(calls, 2); assert.deepEqual(await collection(root), before);
    assert.deepEqual(await readFile(indexFile(root)), oldIndex);
    assert.deepEqual(await readFile(original), originalBytes);
    assert.equal((await (await archivedRepository(root)).sourceNewGame()).content.contentHash, f.entry.contentHash);
    await assertClean(root);
    await rm(link); await symlink(original, link);
    const retry = await publish(root, f.payloads);
    assert.equal(retry.result, "passed"); assert.equal(retry.published, true);
    assert.equal((await (await currentRepository(root)).sourceNewGame()).content.contentHash, f.entry.contentHash);
    await assertClean(root);
  });
});

test("incompatible retained CAS bytes reject a new release before rename and leave the prior release usable", async () => {
  await withRoot(async root => {
    const f = await fixture(root), before = await collection(root);
    await archive({ root, compiledDir }); const oldIndex = await readFile(indexFile(root)), oldRelease = (await index(root)).currentReleaseId;
    const world = await seal({ ...f.world, limitations: [...f.world.limitations, "Controlled next generation"] });
    const entry = await seal({ ...f.entry, worldCatalogHash: world.contentHash }), refs = structuredClone(f.refs);
    refs.world.contentHash = world.contentHash; refs.source!.entry.contentHash = entry.contentHash;
    const payloads = new Map(f.payloads);
    payloads.set(primaryURL, refs); payloads.set(refs.world.url, world); payloads.set(refs.source!.entry.url, entry);
    const conflicting = resolve(root, "build/content-releases/objects", world.contentHash + ".json"), wrongBytes = bytes(f.map);
    await writeFile(conflicting, wrongBytes);
    const report = await failure(publish(root, payloads), /conflicts with retained immutable bytes/);
    assert.equal(report.stages.find(stage => stage.name === "validate-retained-CAS-compatibility")?.status, "failed");
    assert.deepEqual(await collection(root), before); assert.deepEqual(await readFile(indexFile(root)), oldIndex);
    assert.deepEqual(await readFile(conflicting), wrongBytes, "A producer cannot silently repair immutable content");
    assert.equal((await (await currentRepository(root)).sourceNewGame()).content.contentHash, f.entry.contentHash);
    assert.equal((await (await archivedRepository(root)).sourceNewGame()).content.contentHash, f.entry.contentHash);
    await assertClean(root);
    // Explicitly repair the controlled external corruption, then prepare a
    // fresh candidate. The failed attempt retained no lock or partial registry.
    await rm(conflicting);
    const retry = await publish(root, payloads);
    assert.equal(retry.result, "passed"); assert.equal(retry.published, true);
    const history = await index(root);
    assert.equal(history.releases.length, 2); assert.ok(history.releases.some(release => release.id === oldRelease));
    assert.notEqual(history.currentReleaseId, oldRelease);
    assert.equal((await (await currentRepository(root)).sourceNewGame()).content.contentHash, entry.contentHash);
    assert.equal((await (await archivedRepository(root)).sourceNewGame()).content.contentHash, entry.contentHash);
    await assertClean(root);
  });
});
