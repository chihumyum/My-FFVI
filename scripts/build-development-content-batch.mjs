// Source maps and scripts remain the compiler's output. This recipe selects
// an explicit development baseline and a source PointIn, never story flags.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { compileDevelopmentMapEntry } from "../dist/src/compiler/development-map-entry.js";
import { ContentBatchManifest, planContentBatch } from "../dist/src/compiler/content-batch.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { GameContentRepository } from "../dist/src/core/game-content.js";
import { parseGameContentRefs } from "../dist/src/core/game-content-refs.js";

const root = resolve(import.meta.dirname, ".."), build = resolve(root, "build");
const args = process.argv.slice(2);
assert.ok(args.length <= 1, "Use build-development-content-batch.mjs [recipe.json]");
const recipe = JSON.parse(await readFile(resolve(root, args[0] ?? "content-batches/figaro-development.recipe.json"), "utf8"));
assert.deepEqual(Object.keys(recipe).sort(), ["kind", "id", "baseField", "battle", "world", "startMap", "entrance", "manifest"].sort());
assert.equal(recipe.kind, "development-content-batch-recipe-v1");
assert.match(recipe.id, /^[a-z0-9][a-z0-9-]{0,79}$/);
const within = path => { const child = relative(build, path); return child && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child); };
const read = async name => {
  assert.match(name, /^(?:game|world|framework|content-batches)\/[A-Za-z0-9/_-]+\.json$/);
  const path = resolve(build, name); assert.ok(within(path));
  const actual = await realpath(path); assert.ok(within(actual));
  return verifyContent(JSON.parse(await readFile(actual, "utf8")));
};
const [baseField, battle, catalog] = await Promise.all([recipe.baseField, recipe.battle, recipe.world].map(read));
const initial = ContentBatchManifest.parse(recipe.manifest);
assert.ok(initial.mapIds.includes(recipe.startMap));
assert.ok(initial.routes.every(route => route.entry === "development-map"));
const maps = await Promise.all(initial.mapIds.map(id => read(catalog.maps[id].url.slice(1))));
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
const repository = new GameContentRepository(async url => payloads.has(url) ? payloads.get(url) : read(url.slice(1)), "framework", refs);
const loaded = await repository.opening(); assert.ok(loaded.development);
assert.equal(loaded.development.map.contentHash, start.contentHash);
const target = resolve(build, "content-packages"), backup = resolve(build, ".previous-development-content-packages");
const staged = await mkdtemp(resolve(build, ".development-content-packages-"));
try {
  await cp(target, staged, { recursive: true });
  for (const [url, payload] of payloads) {
    const file = resolve(staged, url.slice("/content-packages/".length));
    await mkdir(resolve(file, ".."), { recursive: true }); await writeFile(file, canonical(payload) + "\n");
  }
  await writeFile(resolve(staged, recipe.id + ".json"), canonical(refs) + "\n");
  await writeFile(resolve(staged, recipe.id, "manifest.json"), canonical(manifest) + "\n");
  try { await stat(backup); throw new Error("Inspect interrupted development content publication"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await rename(target, backup);
  try { await rename(staged, target); }
  catch (error) { await rename(backup, target); throw error; }
  await rm(backup, { recursive: true });
  const report = { kind: "development-content-batch-build-v1", recipeHash: hash(recipe), refs,
    manifest: `build/content-packages/${recipe.id}/manifest.json`, entryHash: entry.contentHash,
    baseFieldHash: baseField.contentHash, maps: maps.map(map => ({ mapId: map.mapId, contentHash: map.contentHash })),
    diagnostics: plan.diagnostics, sourcePackagesChanged: false, storyFlagsChanged: false, sourceCampaignComplete: false };
  await writeFile(resolve(build, "reports", recipe.id + "-build.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ package: recipe.id, maps: initial.mapIds, diagnostics: plan.diagnostics.length, manifest: report.manifest }));
} finally { await rm(staged, { recursive: true, force: true }); }
