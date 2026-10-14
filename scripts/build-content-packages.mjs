import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../dist/src/compiler/content.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { parseGameContentRefs } from "../dist/src/core/game-content-refs.js";
import { GameContentRepository } from "../dist/src/core/game-content.js";

const repository = resolve(import.meta.dirname, "..");

/** Prepare all base package roles without changing the published collection.
 * A trusted reader may supply this build's private candidates; their payload
 * hashes and the existing repository source/profile gates remain mandatory. */
export async function compileBaseContentPackages({ root = repository, readJson } = {}) {
  const build = resolve(root, "build");
  const read = async url => {
    if (typeof url !== "string" || !/^\/(?:game|world|framework)\/[a-zA-Z0-9/_-]+\.json$/.test(url) ||
        posix.normalize(url) !== url) throw new Error("Unexpected source dependency: " + url);
    const file = resolve(build, url.slice(1)), child = relative(build, file);
    if (!child || child === ".." || child.startsWith(".." + sep) || isAbsolute(child))
      throw new Error("Unexpected source dependency outside build");
    const value = readJson ? await readJson(url) : JSON.parse(await readFile(file, "utf8"));
    return verifyContent(structuredClone(value));
  };
  const [sourceEntry, sourceWorld, sourceBattle, developmentEntry, developmentBattle, frameworkEntry, frameworkWorld] =
    await Promise.all(["/game/source-new-game.json", "/world/catalog.json", "/game/source-catalog.json",
      "/game/narshe.json", "/game/opening-playable.json", "/framework/new-game.json", "/framework/world/catalog.json"].map(read));
  const payloads = new Map([
    ["/content-packages/source/entry.json", sourceEntry], ["/content-packages/source/world.json", sourceWorld],
    ["/content-packages/source/battle.json", sourceBattle], ["/content-packages/development/entry.json", developmentEntry],
    ["/content-packages/development/battle.json", developmentBattle], ["/content-packages/framework/entry.json", frameworkEntry],
    ["/content-packages/framework/world.json", frameworkWorld],
  ]);
  const reference = path => ({ url: "/content-packages/" + path, contentHash: payloads.get("/content-packages/" + path).contentHash });
  const development = { entry: reference("development/entry.json"), battle: reference("development/battle.json") };
  const packages = new Map([
    ["source", parseGameContentRefs({ kind: "game-content-refs-v1", profile: "source", world: reference("source/world.json"),
      source: { entry: reference("source/entry.json"), battle: reference("source/battle.json") }, development })],
    ["framework", parseGameContentRefs({ kind: "game-content-refs-v1", profile: "framework", world: reference("framework/world.json"),
      source: { entry: reference("framework/entry.json"), battle: reference("source/battle.json") }, development })],
    ["development", parseGameContentRefs({ kind: "game-content-refs-v1", profile: "source", world: reference("source/world.json"),
      source: null, development })],
  ]);
  // Validate the same role/source/map/script contracts consumers use. A manifest
  // only points at existing payloads; it creates no initial state or capability.
  for (const refs of packages.values()) {
    const repository = new GameContentRepository(async url => {
      if (url.startsWith("/content-packages/")) {
        const payload = payloads.get(url);
        if (payload) return payload;
        if (readJson && /^\/content-packages\/(?:source|framework)\/maps\/[1-9][0-9]*\.json$/.test(url))
          return verifyContent(structuredClone(await readJson(url)));
        throw new Error("Missing declared package payload: " + url);
      }
      if (!/^\/(?:world|framework)\/[a-zA-Z0-9/_-]+\.json$/.test(url))
        throw new Error("Unexpected source dependency: " + url);
      return read(url);
    }, refs.profile, refs);
    await repository.world();
    if (repository.hasSourceEntry) await repository.sourceNewGame();
    if (repository.hasDevelopmentEntry) await repository.opening();
  }
  const report = { kind: "game-content-package-build-v1", packages: [...packages].map(([id, refs]) =>
    ({ id, refs, refsSha256: hash(refs) })), sourcePayloadsChanged: false, sourceGameplayAdmitted: false };
  return { payloads, refs: packages, report };
}

export async function buildBaseContentPackages({ root = repository } = {}) {
  root = resolve(root); const target = resolve(root, "build/content-packages");
  const { payloads, refs: packages, report } = await compileBaseContentPackages({ root });
  const staged = await mkdtemp(resolve(root, "build/.content-packages-")), backup = resolve(root, "build/.previous-content-packages");
  const ownedFiles = new Set([...payloads.keys()].map(url => url.slice("/content-packages/".length)));
  for (const id of packages.keys()) ownedFiles.add(id + ".json");
  try {
    // This producer owns these exact files, not the content package registry.
    // Independent batches, their manifests and other files survive the same
    // staged publication. Do not copy an owned file's old bytes or symlink.
    let existing = false;
    try {
      const current = await stat(target);
      if (!current.isDirectory()) throw new Error("Content package target must be a directory");
      existing = true;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing) await cp(target, staged, { recursive: true, verbatimSymlinks: true,
      filter: file => !ownedFiles.has(relative(target, file)) });
    for (const id of packages.keys()) {
      try {
        const namespace = await lstat(resolve(staged, id));
        if (!namespace.isDirectory() || namespace.isSymbolicLink())
          throw new Error("Owned content payload namespace must be a directory: " + id);
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    for (const [url, payload] of payloads) {
      const file = resolve(staged, url.slice("/content-packages/".length)); await mkdir(resolve(file, ".."), { recursive: true });
      await writeFile(file, canonical(payload) + "\n");
    }
    for (const [id, refs] of packages) await writeFile(resolve(staged, id + ".json"), canonical(refs) + "\n");
    try { await stat(backup); throw new Error("Inspect interrupted build/.previous-content-packages"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    let previous = false;
    try { await rename(target, backup); previous = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await rename(staged, target); }
    catch (error) { if (previous) await rename(backup, target); throw error; }
    if (previous) await rm(backup, { recursive: true });
    await mkdir(resolve(root, "build/reports"), { recursive: true });
    await writeFile(resolve(root, "build/reports/content-package-build.json"), JSON.stringify(report, null, 2) + "\n");
  } finally { await rm(staged, { recursive: true, force: true }); }
  return { payloads, refs: packages, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw new Error("Use build-content-packages.mjs without arguments");
  const result = await buildBaseContentPackages();
  console.log(JSON.stringify({ packages: [...result.refs.keys()], payloads: result.payloads.size, output: "build/content-packages" }));
}
