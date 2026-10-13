// A generic source-location package. Only initial placement and the declared
// Web presentation differ: source events/entities and DataInitialize stay intact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const repository = resolve(import.meta.dirname, ".."), digest = /^[a-f0-9]{64}$/;
const within = (parent, path) => {
  const child = relative(parent, path);
  return child.length > 0 && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
};
function fields(raw, keys) {
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw));
  assert.ok(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null);
  assert.deepEqual(Reflect.ownKeys(raw).sort(), keys.split(",").sort());
  assert.ok(Object.values(Object.getOwnPropertyDescriptors(raw)).every(value => value.enumerable && "value" in value));
}
async function modules(root, dist) {
  const load = name => import(pathToFileURL(resolve(root, dist, "src", name + ".js")).href);
  return Object.assign({}, ...await Promise.all([
    "compiler/framework-field-presentation", "compiler/framework-new-game", "compiler/content-batch",
    "compiler/corpus", "compiler/map-package", "compiler/field-native-composition", "compiler/content",
    "core/content-integrity", "core/game-content", "core/game-content-refs", "core/source-catalog",
  ].map(load)));
}

/** All source references are verified before derivation. The manifest supplies
 * player inputs, not replacement scripts, flags, actors, rewards or assets. */
export async function compileInitializedContentBatch(root, raw, recipeSha256, { dist = "dist" } = {}) {
  root = resolve(root); const api = await modules(root, dist), build = resolve(root, "build");
  fields(raw, "kind,id,sourceEntry,sourceBattle,sourceWorld,startMap,entrance,presentation,manifest");
  const recipe = structuredClone(raw);
  assert.equal(recipe.kind, "initialized-source-map-recipe-v1");
  assert.match(recipe.id, /^[a-z0-9][a-z0-9-]{0,79}$/); assert.match(recipeSha256, digest);
  assert.ok(Number.isInteger(recipe.startMap) && recipe.startMap > 0 && recipe.startMap <= 0x7fffffff);
  assert.ok(Number.isInteger(recipe.entrance) && recipe.entrance >= 0 && recipe.entrance <= 0x7fffffff);
  assert.equal(recipe.presentation, "framework-ordinary-field-flat-v1");
  const initialManifest = api.ContentBatchManifest.parse(recipe.manifest);
  assert.equal(initialManifest.profile, "framework"); assert.equal(initialManifest.contentRefs, undefined);
  assert.ok(initialManifest.mapIds.includes(recipe.startMap));
  assert.equal(new Set(initialManifest.mapIds).size, initialManifest.mapIds.length);
  assert.ok(initialManifest.routes.every(route => route.entry === "framework-new-game"));
  const read = async ref => {
    fields(ref, "url,contentHash"); assert.match(ref.url, /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/);
    assert.match(ref.contentHash, digest);
    const path = await realpath(resolve(build, ref.url.slice(1))); assert.ok(within(build, path), "Source must remain inside build");
    return api.verifyContent(JSON.parse(await readFile(path, "utf8")), ref.contentHash);
  };
  const [sourceEntry, sourceBattle, sourceWorld] = await Promise.all([
    recipe.sourceEntry, recipe.sourceBattle, recipe.sourceWorld,
  ].map(read));
  assert.equal(sourceEntry.kind, "source-new-game-content-v1");
  assert.equal(sourceEntry.battleCatalogHash, sourceBattle.contentHash);
  assert.equal(sourceEntry.worldCatalogHash, sourceWorld.contentHash);
  for (const value of [sourceEntry, sourceWorld]) assert.equal(value.developmentProfile, undefined);
  api.assertSourceGameCatalog(sourceBattle);
  const sourcePins = initialManifest.mapIds.map(mapId => {
    const index = sourceWorld.maps[String(mapId)]; assert.ok(index, "Missing original map " + mapId);
    return { mapId, url: index.url, contentHash: index.contentHash };
  });
  const sourceMaps = await Promise.all(sourcePins.map(({ url, contentHash }) => read({ url, contentHash })));
  for (const [index, map] of sourceMaps.entries()) {
    assert.equal(map.mapId, sourcePins[index].mapId); assert.equal(map.developmentProfile, undefined);
    assert.equal(map.sourceSetHash, sourceWorld.sourceSetHash);
    assert.equal(map.parentSourceSetHash, sourceWorld.parentSourceSetHash);
    assert.equal(map.mediaSourceSetHash, sourceWorld.mediaSourceSetHash);
  }
  const corpus = await api.loadCorpus(root);
  assert.equal(corpus.sourceSetHash, sourceWorld.sourceSetHash);
  assert.equal(corpus.manifest.parentSourceSetHash, sourceWorld.parentSourceSetHash);
  const sources = corpus.manifest.sources.map(({ file, sha256 }) => ({ file, sha256 }));
  const bindings = api.bindMapPackages(corpus.assets, corpus.tables), byId = new Map(corpus.assets.map(asset => [asset.id, asset]));
  const renderHost = await api.loadFieldCompositionRenderHost(root, sources);
  const seal = value => { const { contentHash: _, ...body } = value; return { ...body, contentHash: api.hash(body) }; };
  const profile = sourceContentHash => ({ kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash, omissions: [], fieldPresentation: recipe.presentation });
  const prefix = "/content-packages/" + recipe.id, presentations = [];
  const maps = sourceMaps.map(sourceMap => {
    const map = structuredClone(sourceMap);
    map.developmentProfile = profile(sourceMap.contentHash);
    try {
      assert.ok(map.map && map.partyEntry && map.cameraHost && map.entryView);
      assert.equal(map.entryView.isWorld, false, "Ordinary presentation cannot grant world-map identity");
      assert.equal(api.canonical(map.partyEntry.mapRange), api.canonical(map.cameraHost.mapRange));
      const candidates = bindings.filter(item => Number(item.id) === map.mapId);
      assert.equal(candidates.length, 1, "Ambiguous source map package");
      const binding = candidates[0], tilemap = byId.get(binding.tilemap), mapPackage = byId.get(binding.packageId);
      assert.ok(tilemap && mapPackage, "Missing original tilemap/package");
      assert.equal(api.canonical(tilemap.source), api.canonical(map.map.source));
      map.frameworkPresentation = api.compileFrameworkFieldPresentation({ policy: recipe.presentation, sources,
        tilemap, mapPackage, mapSize: { width: map.map.width, height: map.map.height },
        mapRange: map.partyEntry.mapRange, renderHost });
      presentations.push({ mapId: map.mapId, status: "compiled", contextId: map.frameworkPresentation.view.contextId,
        omissions: map.frameworkPresentation.view.omissions, sourceActorViewBlockers: structuredClone(map.actorViewBlockers ?? []) });
    } catch (error) {
      // Keep this map and every original blocker. A failed alternate display
      // must not remove the map, substitute a nearby one or grant its gameplay.
      presentations.push({ mapId: map.mapId, status: "blocked", reason: String(error.message ?? error) });
    }
    // Derived fields are top-level only. Every original payload field is kept
    // exactly, including original view/provider diagnostics and script metadata.
    const { developmentProfile: _profile, frameworkPresentation: _presentation, ...unchanged } = map;
    assert.equal(api.canonical(unchanged), api.canonical(sourceMap));
    return seal(map);
  });
  const catalogDraft = structuredClone(sourceWorld);
  catalogDraft.developmentProfile = profile(sourceWorld.contentHash);
  for (const map of maps) catalogDraft.maps[String(map.mapId)] = {
    ...catalogDraft.maps[String(map.mapId)], url: prefix + "/maps/" + map.mapId + ".json", contentHash: map.contentHash,
  };
  // The remaining catalog identities remain visible. They are not silently
  // converted to this profile or admitted through an unvisited source exit.
  const catalog = seal(catalogDraft), battle = structuredClone(sourceBattle);
  const sourceMap = sourceMaps.find(map => map.mapId === recipe.startMap), map = maps.find(map => map.mapId === recipe.startMap);
  assert.ok(sourceMap && map);
  assert.ok(initialManifest.roots.some(value => value.kind === "entry" && value.mapId === map.mapId &&
    value.entrance === recipe.entrance && value.continuation === map.initializer),
  "Initialized batch root must bind the actual map initializer");
  const entry = await api.compileFrameworkNewGame({ sourceEntry, sourceBattle, sourceMap, world: catalog,
    map, battle, entrance: recipe.entrance });
  assert.equal(api.canonical(battle.gameState), api.canonical(sourceBattle.gameState));
  const ref = (name, value) => ({ url: prefix + "/" + name + ".json", contentHash: value.contentHash });
  const refs = api.parseGameContentRefs({ kind: "game-content-refs-v2", profile: "framework",
    world: ref("world", catalog), source: null, development: null,
    initialized: { entry: ref("entry", entry), battle: ref("battle", battle) } });
  const manifest = api.ContentBatchManifest.parse({ ...initialManifest, contentRefs: refs });
  const plan = api.planContentBatch(manifest, { entry, battle, catalog, maps });
  const payloads = new Map([[refs.world.url, catalog], [refs.initialized.entry.url, entry], [refs.initialized.battle.url, battle],
    ...maps.map(value => [catalog.maps[String(value.mapId)].url, value])]);
  const repo = new api.GameContentRepository(async url => {
    assert.ok(payloads.has(url), "Initialized package requested an undeclared dependency: " + url);
    return payloads.get(url);
  }, "framework", refs);
  const loaded = await repo.initializedNewGame(); assert.equal(loaded.map.contentHash, map.contentHash);
  const report = { kind: "initialized-source-map-build-v1", package: recipe.id, recipeSha256,
    refs, manifestHash: plan.manifestHash, initializerHash: entry.initializerHash,
    sourceInputs: { entry: recipe.sourceEntry, battle: recipe.sourceBattle, world: recipe.sourceWorld, maps: sourcePins },
    relocation: { kind: "source-initializer-authored-map-v1", mapId: recipe.startMap, entrance: recipe.entrance,
      sourceStoryReachability: "unverified" },
    maps: maps.map(value => ({ mapId: value.mapId, contentHash: value.contentHash })), presentations,
    diagnostics: plan.diagnostics, referenceClosure: plan.dependencies.referenceClosure, runtimeAdmission: "unassessed",
    originalMapPayloadsChanged: false, originalPackagesChanged: false, originalInitializerChanged: false,
    storyFlagsChanged: false, ownedCatalogsChanged: false, sourceCampaignComplete: false,
    browserVerified: false, originalGameExecuted: false,
    limitations: ["Only entry relocation and the declared ordinary Canvas material policy are authored.",
      "Every original map entity, event, exit, collision and foot provider is retained, including blockers.",
      "Original entries outside the declared map batch remain indexed but are not granted this initialized profile.",
      "Compilation and reference analysis do not prove route execution or original story reachability."] };
  return { entry, battle, catalog, maps, refs, manifest, plan, payloads, report };
}

export async function buildInitializedContentBatch({ root = repository,
  recipePath = "content-batches/figaro-initialized.recipe.json", out = "build/content-packages", dist = "dist" } = {}) {
  root = resolve(root); const api = await modules(root, dist), bytes = await readFile(resolve(root, recipePath));
  const result = await compileInitializedContentBatch(root, JSON.parse(bytes.toString()),
    createHash("sha256").update(bytes).digest("hex"), { dist });
  const build = resolve(root, "build"), target = resolve(root, out), backup = target + ".previous-initialized-batch";
  assert.ok(within(build, target), "Initialized batch output must be inside build");
  await mkdir(resolve(target, ".."), { recursive: true });
  const staged = await mkdtemp(resolve(target, "../.initialized-content-batch-"));
  try {
    try { await cp(target, staged, { recursive: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const [url, value] of result.payloads) {
      const file = resolve(staged, url.slice("/content-packages/".length)); assert.ok(within(staged, file));
      await mkdir(resolve(file, ".."), { recursive: true }); await writeFile(file, api.canonical(value) + "\n");
    }
    const id = result.report.package;
    await writeFile(resolve(staged, id + ".json"), api.canonical(result.refs) + "\n");
    await writeFile(resolve(staged, id, "manifest.json"), api.canonical(result.manifest) + "\n");
    await writeFile(resolve(staged, id, "build-report.json"), JSON.stringify(result.report, null, 2) + "\n");
    try { await stat(backup); throw new Error("Inspect interrupted initialized batch publication"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    let previous = false;
    try { await rename(target, backup); previous = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await rename(staged, target); } catch (error) { if (previous) await rename(backup, target); throw error; }
    if (previous) await rm(backup, { recursive: true });
  } finally { await rm(staged, { recursive: true, force: true }); }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  if (args[0] && !args[0].startsWith("--")) options.recipePath = args.shift();
  while (args.length) {
    const key = args.shift(); assert.ok(["--out", "--dist"].includes(key) && args[0],
      "Use build-initialized-content-batch.mjs [recipe.json] [--out build/collection] [--dist compiled-dir]");
    options[key.slice(2)] = args.shift();
  }
  const result = await buildInitializedContentBatch(options);
  console.log(JSON.stringify({ package: result.report.package, profile: "framework",
    mapIds: result.manifest.mapIds, entryHash: result.entry.contentHash, initializerHash: result.entry.initializerHash,
    diagnostics: result.plan.diagnostics.length, sourceCampaignComplete: false,
    refs: (options.out ?? "build/content-packages") + "/" + result.report.package + ".json" }));
}
