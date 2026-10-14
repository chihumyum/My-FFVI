// Source maps and scripts remain the compiler's output. This recipe selects
// an explicit development baseline and a source PointIn, never story flags.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { compileDevelopmentMapEntry } from "../dist/src/compiler/development-map-entry.js";
import { ContentBatchManifest, planContentBatch } from "../dist/src/compiler/content-batch.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { GameContentRepository } from "../dist/src/core/game-content.js";
import { parseGameContentRefs } from "../dist/src/core/game-content-refs.js";

const repository = resolve(import.meta.dirname, "..");

/** Compile one declared development package without publishing or reading a
 * cached battle selection in place of a supplied candidate. */
export async function compileDevelopmentContentBatch({ root = repository,
    recipePath = "content-batches/figaro-development.recipe.json", readJson,
    recipe: suppliedRecipe, recipeSha256: suppliedRecipeSha256 } = {}) {
  const detachedRecipe = suppliedRecipe === undefined ? undefined : structuredClone(suppliedRecipe);
  assert.ok(readJson === undefined || typeof readJson === "function", "Invalid candidate content reader");
  root = resolve(root); const build = resolve(root, "build");
  let recipe, recipeSha256;
  if (detachedRecipe !== undefined) {
    assert.match(suppliedRecipeSha256, /^[a-f0-9]{64}$/, "A resolved recipe requires its original byte hash");
    recipe = detachedRecipe; recipeSha256 = suppliedRecipeSha256;
  } else {
    const bytes = await readFile(resolve(root, recipePath));
    recipe = JSON.parse(bytes.toString("utf8"));
    recipeSha256 = createHash("sha256").update(bytes).digest("hex");
    if (suppliedRecipeSha256 !== undefined) assert.equal(suppliedRecipeSha256, recipeSha256, "Original recipe bytes changed");
  }
  assert.deepEqual(Object.keys(recipe).sort(), ["kind", "id", "baseField", "battle", "world", "startMap", "entrance", "manifest"].sort());
  assert.equal(recipe.kind, "development-content-batch-recipe-v1");
  assert.match(recipe.id, /^[a-z0-9][a-z0-9-]{0,79}$/);
  const within = path => { const child = relative(build, path); return child && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child); };
  const read = async (url, expectedHash) => {
    const publicInput = /^\/(?:game|world|framework|content-batches)\/[A-Za-z0-9/_-]+\.json$/.test(url);
    const privateMap = readJson && /^\/content-packages\/(?:source|framework)\/maps\/[1-9]\d*\.json$/.test(url);
    assert.ok(publicInput || privateMap, "Unsupported development input URL");
    assert.equal(posix.normalize(url), url, "Unexpected noncanonical content path");
    const path = resolve(build, url.slice(1)); assert.ok(within(path));
    let value;
    if (readJson) value = await readJson(url);
    else {
      const actual = await realpath(path); assert.ok(within(actual));
      value = JSON.parse(await readFile(actual, "utf8"));
    }
    return verifyContent(structuredClone(value), expectedHash);
  };
  for (const name of [recipe.baseField, recipe.battle, recipe.world])
    assert.match(name, /^(?:game|world|framework|content-batches)\/[A-Za-z0-9/_-]+\.json$/);
  const [baseField, battle, catalog] = await Promise.all([recipe.baseField, recipe.battle, recipe.world].map(name => read("/" + name)));
  const initial = ContentBatchManifest.parse(recipe.manifest);
  assert.ok(initial.mapIds.includes(recipe.startMap));
  assert.ok(initial.routes.every(route => route.entry === "development-map"));
  const maps = await Promise.all(initial.mapIds.map(id => {
    const ref = catalog.maps[id]; assert.ok(ref, "Missing declared world map: " + id);
    return read(ref.url, ref.contentHash);
  }));
  const start = maps.find(map => map.mapId === recipe.startMap); assert.ok(start);
  const entry = await compileDevelopmentMapEntry({ baseField, baseBattle: battle, catalog, map: start, entrance: recipe.entrance });
  const payloads = new Map([[`/content-packages/${recipe.id}/entry.json`, entry],
    [`/content-packages/${recipe.id}/battle.json`, battle], [`/content-packages/${recipe.id}/world.json`, catalog]]);
  const reference = name => ({ url: `/content-packages/${recipe.id}/${name}.json`, contentHash: payloads.get(`/content-packages/${recipe.id}/${name}.json`).contentHash });
  const refs = parseGameContentRefs({ kind: "game-content-refs-v1", profile: "framework", world: reference("world"),
    source: null, development: { entry: reference("entry"), battle: reference("battle") } });
  const manifest = ContentBatchManifest.parse({ ...initial, contentRefs: refs });
  const plan = planContentBatch(manifest, { entry, battle, catalog, maps });
  // Diagnostics are retained. A runnable nominated route does not certify every
  // other exit, conditional script or source presentation dependency in a map.
  const content = new GameContentRepository(async url => payloads.has(url) ? payloads.get(url) : read(url), "framework", refs);
  const loaded = await content.opening(); assert.ok(loaded.development);
  assert.equal(loaded.development.map.contentHash, start.contentHash);
  const report = { kind: "development-content-batch-build-v1", recipeHash: hash(recipe), recipeSha256, refs,
    manifest: `build/content-packages/${recipe.id}/manifest.json`, entryHash: entry.contentHash,
    baseFieldHash: baseField.contentHash, maps: maps.map(map => ({ mapId: map.mapId, contentHash: map.contentHash })),
    diagnostics: plan.diagnostics, sourcePackagesChanged: false, storyFlagsChanged: false, sourceCampaignComplete: false };
  return { payloads, refs: new Map([[recipe.id, refs]]), report, manifest, plan };
}

export async function buildDevelopmentContentBatch({ root = repository,
    recipePath = "content-batches/figaro-development.recipe.json" } = {}) {
  root = resolve(root); const build = resolve(root, "build");
  const { payloads, refs: packages, report, manifest, plan } = await compileDevelopmentContentBatch({ root, recipePath });
  const [[id, refs]] = packages;
  const target = resolve(build, "content-packages"), backup = resolve(build, ".previous-development-content-packages");
  const staged = await mkdtemp(resolve(build, ".development-content-packages-"));
  try {
    await cp(target, staged, { recursive: true });
    for (const [url, payload] of payloads) {
      const file = resolve(staged, url.slice("/content-packages/".length));
      await mkdir(resolve(file, ".."), { recursive: true }); await writeFile(file, canonical(payload) + "\n");
    }
    await writeFile(resolve(staged, id + ".json"), canonical(refs) + "\n");
    await writeFile(resolve(staged, id, "manifest.json"), canonical(manifest) + "\n");
    try { await stat(backup); throw new Error("Inspect interrupted development content publication"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await rename(target, backup);
    try { await rename(staged, target); }
    catch (error) { await rename(backup, target); throw error; }
    await rm(backup, { recursive: true });
    await writeFile(resolve(build, "reports", id + "-build.json"), JSON.stringify(report, null, 2) + "\n");
  } finally { await rm(staged, { recursive: true, force: true }); }
  return { payloads, refs: packages, report, manifest, plan };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1, "Use build-development-content-batch.mjs [recipe.json]");
  const result = await buildDevelopmentContentBatch({ recipePath: args[0] ?? "content-batches/figaro-development.recipe.json" });
  console.log(JSON.stringify({ package: [...result.refs.keys()][0], maps: result.manifest.mapIds,
    diagnostics: result.plan.diagnostics.length, manifest: result.report.manifest }));
}
