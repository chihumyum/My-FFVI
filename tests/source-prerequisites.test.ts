import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifySourceNewGameWorld, type SourceNewGameWorld, type SourceNewGameWorldFacts } from "../src/compiler/source-new-game.js";
import { compileFrameworkContent } from "../src/compiler/framework-content.js";
import { hash } from "../src/compiler/content.js";
import { sourceGameContentRefsFixture, sealGameContentRefsFixture } from "./fixtures/game-content-refs.js";

async function worldFixture() {
  const f = await sourceGameContentRefsFixture("source", "/world");
  const maps = [f.map, f.destination], supplied = { catalog: f.catalog, maps };
  const facts: SourceNewGameWorldFacts = { sourceSetHash: f.catalog.sourceSetHash,
    parentSourceSetHash: f.catalog.parentSourceSetHash, mediaSourceSetHash: f.catalog.mediaSourceSetHash,
    maps: maps.map(map => ({ mapId: map.mapId, areaId: map.areaId, name: map.name })) };
  const rebind = async () => {
    supplied.maps = await Promise.all(supplied.maps.map(map => sealGameContentRefsFixture(map)));
    for (const map of supplied.maps) {
      const indexed = supplied.catalog.maps[String(map.mapId)];
      if (indexed) indexed.contentHash = map.contentHash;
    }
    supplied.catalog = await sealGameContentRefsFixture(supplied.catalog);
  };
  return { ...f, supplied, facts, rebind };
}

test("candidate source world preserves the complete unavailable-map closure and caller ownership", async () => {
  const f = await worldFixture(), destination = f.supplied.maps[1]!;
  destination.map = null;
  destination.blockers.push({ reason: "Controlled unresolved provider", source: { file: "controlled.bundle", assetPath: "map",
    objectId: "9007199254740993" } });
  await f.rebind();
  const before = structuredClone(f.supplied), verified = await verifySourceNewGameWorld(f.supplied, f.facts);
  assert.deepEqual(verified, before);
  assert.deepEqual(f.supplied, before);
  verified.maps[1]!.blockers[0]!.reason = "mutated output";
  verified.catalog.maps[String(destination.mapId)]!.url = "/changed.json";
  assert.deepEqual(f.supplied, before, "A candidate does not retain mutable input owners");
});

test("new-game candidate validation never trusts a self-sealed partial, duplicate or foreign map domain", async () => {
  const cases: { name: string; change(world: SourceNewGameWorld): void }[] = [
    { name: "missing indexed body", change: world => { world.maps = world.maps.slice(0, 1); } },
    { name: "duplicate body", change: world => { world.maps = [world.maps[0]!, world.maps[0]!]; } },
    { name: "deleted source map index", change: world => {
      delete world.catalog.maps[String(world.maps[1]!.mapId)]; world.maps = world.maps.slice(0, 1);
    } },
    { name: "noncanonical map identity", change: world => {
      const key = String(world.maps[0]!.mapId); world.catalog.maps["0" + key] = world.catalog.maps[key]!; delete world.catalog.maps[key];
    } },
    { name: "foreign source map identity", change: world => {
      const map = world.maps[1]!, old = map.mapId; map.mapId += 100;
      if (map.map) map.map.identity!.mapId = map.mapId;
      world.catalog.maps[String(map.mapId)] = world.catalog.maps[String(old)]!; delete world.catalog.maps[String(old)];
    } },
  ];
  for (const item of cases) {
    const f = await worldFixture(); item.change(f.supplied); await f.rebind();
    await assert.rejects(verifySourceNewGameWorld(f.supplied, f.facts), /complete|every|Duplicate|foreign/, item.name);
  }
});

test("recomputed candidate hashes do not authorize source/profile/media/area changes", async () => {
  const cases: { name: string; change(f: Awaited<ReturnType<typeof worldFixture>>): void }[] = [
    { name: "source set", change: f => { f.supplied.catalog.sourceSetHash = "foreign"; } },
    { name: "parent source", change: f => { f.supplied.catalog.parentSourceSetHash = "foreign"; } },
    { name: "media source", change: f => { f.supplied.catalog.mediaSourceSetHash = "foreign"; } },
    { name: "map parent source", change: f => { f.supplied.maps[1]!.parentSourceSetHash = "foreign"; } },
    { name: "source name", change: f => { f.supplied.maps[1]!.name = "Another area";
      f.supplied.catalog.maps[String(f.supplied.maps[1]!.mapId)]!.name = "Another area"; } },
    { name: "source area", change: f => { const map = f.supplied.maps[1]!; map.areaId += 1;
      map.map!.identity!.areaId = map.areaId; f.supplied.catalog.maps[String(map.mapId)]!.areaId = map.areaId; } },
    { name: "framework profile", change: f => { f.supplied.maps[1]!.developmentProfile = { kind: "framework-development-v1",
      policy: "omit-anonymous-environment-particles-v1", sourceContentHash: f.supplied.maps[1]!.contentHash, omissions: [] }; } },
    { name: "development omissions", change: f => { f.supplied.maps[1]!.developmentOmissions = [{ kind: "field-effect",
      group: "entity_default", entityId: "opaque", source: { file: "controlled", assetPath: "entity" }, reason: "not source" }]; } },
    { name: "authored walking policy", change: f => { Object.assign(f.supplied.maps[1]!, { walkEncounters: { kind: "controlled" } }); } },
  ];
  for (const item of cases) {
    const f = await worldFixture(); item.change(f); await f.rebind();
    await assert.rejects(verifySourceNewGameWorld(f.supplied, f.facts), /source\/profile|identity/, item.name);
  }
});

test("candidate map payload and indexed digest must both match before framework derivation", async () => {
  const f = await worldFixture();
  f.supplied.maps[1]!.limitations.push("unsealed source edit");
  await assert.rejects(verifySourceNewGameWorld(f.supplied, f.facts), /Content payload changed/);
  await f.rebind(); f.supplied.catalog.maps[String(f.supplied.maps[1]!.mapId)]!.contentHash = "0".repeat(64);
  f.supplied.catalog = await sealGameContentRefsFixture(f.supplied.catalog);
  await assert.rejects(verifySourceNewGameWorld(f.supplied, f.facts), /Content identity mismatch/);
});

test("strict verified candidates retain the existing framework derivation shape and source content", async () => {
  const f = await worldFixture(), before = structuredClone(f.supplied);
  const verified = await verifySourceNewGameWorld(f.supplied, f.facts);
  const expected = compileFrameworkContent(f.supplied.catalog, f.supplied.maps, f.content);
  const actual = compileFrameworkContent(verified.catalog, verified.maps, f.content);
  assert.deepEqual(actual, expected);
  assert.deepEqual(f.supplied, before);
  assert.equal(actual.maps.length, f.facts.maps.length);
  assert.notEqual(actual.catalog.contentHash, f.supplied.catalog.contentHash);
});

type InputLock = { kind: string; sourceSetHash: string; parentSourceSetHash: string; compiledDir: string; compilerDigest: string;
  files: { path: string; sha256: string; bytes: number; realPath: string }[]; directories: { path: string; entriesDigest: string }[] };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown) => sha(JSON.stringify(value));
const loadLock = async () => import(pathToFileURL(resolve(process.cwd(), "scripts/compile-source-prerequisites.mjs")).href) as
  Promise<{ validateSourcePrerequisiteInputs(lock: InputLock, options?: { root: string }): Promise<boolean> }>;

/** Redistributable file-system lock fixture. It tests freshness and closure;
 * it has no original media, source semantics or runnable compiler claims. */
async function lockedDirectory(work: (root: string, lock: InputLock) => Promise<void>) {
  const root = await mkdtemp(resolve(tmpdir(), "ffvi-source-input-lock-")), compiledDir = resolve(root, "compiled");
  const directories: string[] = [], fileNames: string[] = [];
  const write = async (path: string, value: string) => {
    await mkdir(resolve(root, path, ".."), { recursive: true }); await writeFile(resolve(root, path), value); fileNames.push(path);
  };
  try {
    const sources = [{ file: "synthetic-source", sha256: "a".repeat(64) }], sourceSetHash = hash(sources), parentSourceSetHash = "b".repeat(64);
    for (const name of ["corpus", "battle", "field", "world-media", "field-background-media", "map-ui", "bgm", "environment", "se"]) {
      const dir = "build/" + name; directories.push(dir);
      const file = name === "corpus" ? "corpus.json" : "media.json";
      const body = name === "corpus" ? JSON.stringify({ sources, sourceSetHash, parentSourceSetHash }) : JSON.stringify({ controlled: name });
      await write(dir + "/" + file, body);
      await write(dir + "/snapshot.json", JSON.stringify({ formatVersion: 1, files: [{ file, sha256: sha(body) }] }));
    }
    await write("build/game/source-catalog.json", JSON.stringify({ controlled: "catalog" }));
    await write("build/runtime/game/FINAL FANTASY VI_Data/level0", "synthetic boot source");
    await write("build/runtime/game/FINAL FANTASY VI_Data/globalgamemanagers", "synthetic managers source");
    await write("compiled/src/compiler.js", "export const synthetic = true;\n"); directories.push("compiled/src");
    const files: InputLock["files"] = [];
    for (const path of fileNames.sort()) {
      const bytes = await readFile(resolve(root, path)); files.push({ path, sha256: sha(bytes), bytes: bytes.length, realPath: await realpath(resolve(root, path)) });
    }
    const entryDigest = async (path: string) => {
      const entries: unknown[] = [[".", "real-directory", await realpath(resolve(root, path))]];
      for (const file of (await readdir(resolve(root, path))).sort()) {
        const absolute = resolve(root, path, file), stat = await lstat(absolute);
        entries.push(stat.isSymbolicLink() ? [file, "symlink", await readlink(absolute)] : [file, "file"]);
      }
      return digest(entries);
    };
    const lock: InputLock = { kind: "source-prerequisite-input-lock-v1", sourceSetHash, parentSourceSetHash, compiledDir,
      compilerDigest: digest([{ path: "src/compiler.js", sha256: files.find(file => file.path === "compiled/src/compiler.js")!.sha256,
        bytes: files.find(file => file.path === "compiled/src/compiler.js")!.bytes }]), files,
      directories: await Promise.all(directories.map(async path => ({ path, entriesDigest: await entryDigest(path) }))) };
    await work(root, lock);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("source input lock remains detached and validates all declared snapshot and compiler bytes", async () => {
  const api = await loadLock(); await lockedDirectory(async (root, lock) => {
    const before = structuredClone(lock); assert.equal(await api.validateSourcePrerequisiteInputs(lock, { root }), true);
    assert.deepEqual(lock, before);
    assert.deepEqual((await readdir(root)).sort(), ["build", "compiled"], "Validation does not publish or create output");
  });
});

test("source input lock refuses stale bytes, directory additions and changed compiler identity", async () => {
  const api = await loadLock();
  for (const change of ["source", "compiler", "addition"] as const) await lockedDirectory(async (root, lock) => {
    if (change === "source") await writeFile(resolve(root, "build/field/media.json"), "changed");
    if (change === "compiler") await writeFile(resolve(root, "compiled/src/compiler.js"), "export const stale = true;");
    if (change === "addition") await writeFile(resolve(root, "build/corpus/unlisted.json"), "{}");
    await assert.rejects(api.validateSourcePrerequisiteInputs(lock, { root }), /changed/);
  });
});

test("unchanged bytes under a different symlink target cannot satisfy the old path binding", async () => {
  const api = await loadLock(); await lockedDirectory(async (root, lock) => {
    const original = resolve(root, "build/field/media.json"), replacement = resolve(root, "alternate.json");
    await writeFile(replacement, await readFile(original)); await rm(original); await symlink(replacement, original);
    await assert.rejects(api.validateSourcePrerequisiteInputs(lock, { root }), /path\/size changed|directory changed/);
  });
});

test("incomplete and malformed source locks cannot omit required snapshots or original host dependencies", async () => {
  const api = await loadLock();
  await lockedDirectory(async (root, lock) => {
    const changed = structuredClone(lock);
    changed.files = changed.files.filter(file => file.path !== "build/field/media.json");
    await assert.rejects(api.validateSourcePrerequisiteInputs(changed, { root }), /Incomplete source prerequisite snapshot/);
    changed.files = structuredClone(lock.files); changed.directories = changed.directories.filter(dir => dir.path !== "build/se");
    await assert.rejects(api.validateSourcePrerequisiteInputs(changed, { root }), /Missing.*snapshot directory/);
    changed.directories = structuredClone(lock.directories);
    changed.files = changed.files.filter(file => !file.path.endsWith("globalgamemanagers"));
    await assert.rejects(api.validateSourcePrerequisiteInputs(changed, { root }), /Missing.*dependency/);
    const duplicate = structuredClone(lock); duplicate.files.push(duplicate.files[0]!);
    await assert.rejects(api.validateSourcePrerequisiteInputs(duplicate, { root }), /duplicate/);
    const unknown = { ...lock, generatedApproval: true };
    await assert.rejects(api.validateSourcePrerequisiteInputs(unknown, { root }), /fields/);
  });
});
