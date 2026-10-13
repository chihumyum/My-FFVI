// Explicit framework travel on unchanged source maps. Authored navigation and
// flat materials are separate from source story and Unity presentation claims.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { compileBattleContentBatch } from "./build-battle-content-batch.mjs";

const repository = resolve(import.meta.dirname, ".."), recipeName = "content-batches/world-travel.recipe.json";
const digest = /^[a-f0-9]{64}$/;
const within = (parent, path) => {
  const child = relative(parent, path);
  return child && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
};
function fields(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.ok(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  assert.deepEqual(Reflect.ownKeys(value).sort(), keys.split(",").sort());
  assert.ok(Object.values(Object.getOwnPropertyDescriptors(value)).every(d => d.enumerable && "value" in d));
}
async function modules(root, dist) {
  const load = name => import(pathToFileURL(resolve(root, dist, "src", name + ".js")).href);
  return Object.assign({}, ...await Promise.all([
    "compiler/framework-new-game", "compiler/framework-world-presentation", "compiler/field-background",
    "compiler/field-native-composition", "compiler/corpus", "compiler/map-package", "compiler/system-source",
    "compiler/world-terrain", "compiler/field-native-foot", "compiler/field-entry-context", "compiler/content", "core/content-integrity",
    "core/game-content", "core/game-content-refs", "core/source-catalog", "core/walk-encounters",
  ].map(load)));
}

export async function compileWorldTravel(root, raw, recipeSha256, { dist = "dist" } = {}) {
  root = resolve(root); const api = await modules(root, dist), build = resolve(root, "build");
  fields(raw, "kind,id,sourceEntry,sourceBattle,sourceWorld,sourceMaps,battleSourceSetHash,handoff,worldMapId,locationMapId,entrance,worldExitEntityId,returnStation,walkEncounters");
  const recipe = structuredClone(raw);
  assert.equal(recipe.kind, "framework-world-travel-recipe-v1"); assert.equal(recipe.id, "world-travel");
  assert.match(recipeSha256, digest); assert.match(recipe.battleSourceSetHash, digest);
  assert.ok(Number.isInteger(recipe.worldMapId) && recipe.worldMapId > 0);
  assert.ok(Number.isInteger(recipe.locationMapId) && recipe.locationMapId > 0 && recipe.locationMapId !== recipe.worldMapId);
  assert.ok(Number.isInteger(recipe.entrance) && recipe.entrance > 0);
  fields(recipe.sourceMaps, "world,location"); fields(recipe.returnStation, "x,y,layer");
  assert.ok([recipe.returnStation.x, recipe.returnStation.y, recipe.returnStation.layer].every(Number.isInteger));
  const seal = value => { const { contentHash: _, ...body } = value; return { ...body, contentHash: api.hash(body) }; };
  const read = async ref => {
    fields(ref, "url,contentHash"); assert.match(ref.url, /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/);
    assert.match(ref.contentHash, digest); const path = await realpath(resolve(build, ref.url.slice(1)));
    assert.ok(within(build, path)); return api.verifyContent(JSON.parse(await readFile(path, "utf8")), ref.contentHash);
  };
  const [sourceEntry, sourceBattle, sourceWorld, sourceWorldMap, sourceLocation] = await Promise.all([
    recipe.sourceEntry, recipe.sourceBattle, recipe.sourceWorld, recipe.sourceMaps.world, recipe.sourceMaps.location,
  ].map(read));
  assert.equal(sourceEntry.battleCatalogHash, sourceBattle.contentHash);
  assert.equal(sourceEntry.worldCatalogHash, sourceWorld.contentHash);
  api.assertSourceGameCatalog(sourceBattle);
  for (const item of [sourceEntry, sourceWorld, sourceWorldMap, sourceLocation]) assert.equal(item.developmentProfile, undefined);
  for (const map of [sourceWorldMap, sourceLocation]) {
    assert.equal(sourceWorld.maps[map.mapId]?.contentHash, map.contentHash);
    assert.ok(map.map && map.partyEntry && map.cameraHost);
    assert.equal(map.partyEntryBlockers.length, 0); assert.equal(map.cameraHostBlockers.length, 0);
  }
  assert.equal(sourceWorldMap.mapId, recipe.worldMapId); assert.equal(sourceLocation.mapId, recipe.locationMapId);
  const corpus = await api.loadCorpus(root), system = await api.loadSystemSource(root, sourceEntry.parentSourceSetHash);
  assert.equal(corpus.sourceSetHash, sourceWorld.sourceSetHash);
  assert.equal(system.sourceSetHash, corpus.sourceSetHash);
  const sources = corpus.manifest.sources.map(({ file, sha256 }) => ({ file, sha256 })),
    bindings = api.bindMapPackages(corpus.assets, corpus.tables), byId = new Map(corpus.assets.map(a => [a.id, a]));
  const binding = bindings.find(b => Number(b.id) === recipe.worldMapId);
  assert.ok(binding?.packageId && binding.tilemap);
  const tilemap = byId.get(binding.tilemap), mapPackage = byId.get(binding.packageId);
  assert.equal(api.canonical(tilemap.source), api.canonical(sourceWorldMap.map.source));
  const entryView = api.compileWorldMapEntryView(system.reader, recipe.worldMapId, sources);
  assert.equal(entryView.isWorld, true);
  const mapRange = sourceWorldMap.partyEntry.mapRange;
  const terrain = api.compileWorldTerrain({ mapId: recipe.worldMapId, mapName: binding.name,
    sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    width: sourceWorldMap.map.width, height: sourceWorldMap.map.height, mapRange,
    packageAsset: mapPackage, assets: corpus.assets, tables: corpus.tables, reader: system.reader, sources });
  const foot = api.compileFieldNativeFoot(mapPackage.data, mapPackage.source, binding.name, terrain);
  if (sourceWorldMap.entryView) assert.deepEqual(entryView, sourceWorldMap.entryView);
  if (sourceWorldMap.map.worldTerrain) assert.deepEqual(terrain, sourceWorldMap.map.worldTerrain);
  const background = await api.loadFieldBackgroundMedia(root, corpus.sourceSetHash),
    renderHost = await api.loadFieldCompositionRenderHost(root, sources);
  const flat = api.compileFrameworkWorldPresentation({ policy: "framework-world-map-flat-v1", sources,
    tilemap, mapPackage, mapSize: { width: mapRange.width, height: mapRange.height },
    backgroundMedia: background.media, verify: background.verify, renderHost });
  const walk = api.parseFrameworkWalkEncounterPolicy(recipe.walkEncounters);
  const selected = await compileBattleContentBatch(root, {
    kind: "battle-content-batch-declaration-v1", id: recipe.id,
    parentSourceSetHash: sourceEntry.parentSourceSetHash, battleSourceSetHash: recipe.battleSourceSetHash,
    baseCatalogRef: recipe.sourceBattle, partyIds: walk.parties.map(p => p.partyId), handoff: recipe.handoff,
  });
  if (!selected.catalog) { const error = new Error("World travel battles are blocked"); error.report = selected.report; throw error; }
  const battle = selected.catalog;
  assert.equal(api.canonical(battle.gameState), api.canonical(sourceBattle.gameState));
  const profile = sourceContentHash => ({ kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash, omissions: [], worldMap: "framework-world-map-flat-v1" });
  const evidence = pointer => ({ file: recipeName, assetPath: "Authored/WorldTravel/recipe.json", pointer, sha256: recipeSha256 });
  const omissionReports = [];
  function scaffold(sourceMap, extraEntities, programs) {
    const definition = sourceMap.map.groups.entity_default;
    const points = sourceMap.partyEntry.pointIns.filter(p => p.id === recipe.entrance);
    assert.equal(points.length, 1);
    const anchors = definition.entities.filter(e => e.kind === 0 && e.objectId === recipe.entrance || e.kind === 27);
    assert.equal(anchors.filter(e => e.kind === 0).length, 1);
    const entities = [...structuredClone(anchors), ...extraEntities];
    assert.equal(new Set(entities.map(e => e.id)).size, entities.length);
    const group = { name: "entity_default", source: evidence(`/maps/${sourceMap.mapId}/navigation`), entities, blockers: [] };
    const scripts = Object.fromEntries(Object.entries(programs).map(([name, ops]) => [name, ops.map((op, index) =>
      ({ ...op, script: name, index, source: evidence(`/maps/${sourceMap.mapId}/scripts/${name}/${index}`) }))]));
    const context = Object.values(sourceMap.scriptPuppetContexts ?? {}).find(c => c &&
      c.miscHash === sourceEntry.puppetCatalog.miscHash && c.characteristics === sourceEntry.puppetCatalog.characteristics);
    assert.ok(context, "Source puppet context is unavailable");
    omissionReports.push({ mapId: sourceMap.mapId, sourceMapContentHash: sourceMap.contentHash,
      replacedInitializer: sourceMap.initializer, excludedSourceScripts: Object.keys(sourceMap.scripts),
      excludedSourceEntities: Object.values(sourceMap.map.groups).flatMap(g => g.entities.filter(e =>
        !entities.some(kept => api.canonical(kept) === api.canonical(e))).map(e =>
        ({ group: g.name, id: e.id, kind: e.kind, source: e.source }))) });
    return { ...structuredClone(sourceMap), developmentProfile: profile(sourceMap.contentHash),
      map: { ...structuredClone(sourceMap.map), entities, groups: { entity_default: group }, initialGroups: ["entity_default"],
        entryContext: { ...structuredClone(sourceMap.map.entryContext),
          groups: { entity_default: { savePointCount: 0, reason: null, source: group.source } } } },
      partyEntry: { ...structuredClone(sourceMap.partyEntry), pointIns: structuredClone(points), conditionColliders: [] },
      scripts, initializer: "travel_init", scriptLocals: Object.fromEntries(Object.keys(scripts).map(k => [k, null])),
      scriptPuppetContexts: Object.fromEntries(Object.entries(scripts).map(([name, program]) => [name,
        { ...structuredClone(context), scriptHash: api.hash({ kind: "framework-author-script-v1", program }),
          skipInitialize: false, keepPlayerPuppet: false, keepBadStatusVisual: false, ridingVehicle: false }])),
      scriptSystemFlags: Object.fromEntries(Object.keys(scripts).map(name => [name, { keepBadStatusVisual: false }])),
      scriptTransitionMetadata: Object.fromEntries(Object.keys(scripts).map(name => [name, { customAnimations: "none" }])),
      characterAssets: [], blockers: [], limitations: [
        "Framework travel selection uses the complete source geometry, source PointIn and explicitly selected navigation anchors.",
        "Source story initializers, other entities and routes are excluded by the separate authored package; original story reachability is not claimed.",
        "The original new-game owned state, equipment, HP, abilities, story flags, enemy rules and rewards are unchanged.",
      ] };
  }
  const exits = sourceWorldMap.map.groups.entity_default.entities.filter(e => e.id === recipe.worldExitEntityId);
  assert.equal(exits.length, 1); const exit = exits[0];
  assert.equal(exit.kind, 3); assert.deepEqual(exit.destination, { mapId: recipe.locationMapId, entrance: recipe.entrance });
  const message = text => ({ kind: "message", key: "FRAMEWORK_WORLD_TRAVEL", speaker: "", text });
  const worldMap = scaffold(sourceWorldMap, [structuredClone(exit)], {
    travel_init: [message("世界旅行演示：向北一步进入纳尔谢，原野上行走可触发普通战斗。世界地形与通行来自原数据；当前使用平面贴图，未还原调色板与海洋动态效果。菜单可保存当前旅行状态。"), { kind: "exit" }],
  });
  Object.assign(worldMap, { actorView: flat.view, actorViewBlockers: [], nativeFoot: foot, nativeFootBlockers: [],
    nativeCompositionBlockers: [], entryView });
  Object.assign(worldMap.map, { nativeComposition: flat.composition, worldTerrain: terrain,
    topology: { range: mapRange, loop: { horizontal: !!(entryView.loopType & 1), vertical: !!(entryView.loopType & 2) } },
    textures: { ...worldMap.map.textures, ...flat.textures } });
  worldMap.map.entryContext = { ...api.compileFieldEntryContext(corpus.assets, corpus.tables, recipe.worldMapId, terrain),
    groups: worldMap.map.entryContext.groups };
  assert.equal(worldMap.map.entryContext.foot.kind, "source-terrain-grid", "World encounters require the actual source terrain context");
  worldMap.walkEncounters = walk;
  worldMap.limitations.push("Flat world policy repeats the first bound ocean texture; palette, ocean shader, perspective and foot shader are not reproduced.");
  const p = recipe.returnStation;
  assert.equal(sourceLocation.map.collisions[p.layer]?.[p.y * sourceLocation.map.width + p.x], 0,
    "Authored return station must use a real walkable source cell");
  const station = { id: "framework-travel-return", objectId: 0, kind: 5, x: p.x, y: p.y, layer: p.layer,
    width: 1, height: 1, direction: "up", asset: null, script: "travel_return", collision: null, destinationLayer: null,
    source: evidence("/returnStation"), mapObject: { collision: true, acceptDirection: 15, talkMounts: [""], soundId: 0,
      interaction: { kind: "script", script: "travel_return" } } };
  const location = scaffold(sourceLocation, [station], {
    travel_init: [message("已进入纳尔谢。面向入口南侧并确认可返回世界地图；世界原野上行走可触发普通战斗。暂停菜单可编队、使用已持有能力并保存。这里是系统旅行路线，不运行原剧情。"), { kind: "exit" }],
    travel_return: [{ kind: "change-map", request: { mapId: recipe.worldMapId, entrance: recipe.entrance, continuation: null,
      birdview: false, skipFade: true, skipBgm: true, origin: "development" } }],
  });
  location.entryView = api.compileWorldMapEntryView(system.reader, recipe.locationMapId, sources);
  assert.equal(location.entryView.isWorld, false);
  assert.ok(location.actorView && location.nativeFoot && location.map.nativeComposition);
  assert.equal(location.actorViewBlockers.length, 0); assert.equal(location.nativeFootBlockers.length, 0);
  const maps = [seal(worldMap), seal(location)], prefix = "/content-packages/" + recipe.id;
  const catalog = seal({ ...structuredClone(sourceWorld), developmentProfile: profile(sourceWorld.contentHash),
    maps: Object.fromEntries(maps.map(map => [map.mapId, { url: `${prefix}/maps/${map.mapId}.json`, contentHash: map.contentHash,
      name: map.name, areaId: map.areaId, geometryReady: true, defaultGroupReady: true, blockers: [] }])),
    limitations: ["Framework flat world travel and authored return route; actual terrain and source geometry are preserved."] });
  const entry = await api.compileFrameworkNewGame({ sourceEntry, sourceBattle, sourceMap: sourceWorldMap,
    world: catalog, map: maps[0], battle, entrance: recipe.entrance });
  const refs = api.parseGameContentRefs({ kind: "game-content-refs-v2", profile: "framework", source: null, development: null,
    world: { url: `${prefix}/world.json`, contentHash: catalog.contentHash }, initialized: {
      entry: { url: `${prefix}/entry.json`, contentHash: entry.contentHash }, battle: { url: `${prefix}/battle.json`, contentHash: battle.contentHash } } });
  const payloads = new Map([[refs.world.url, catalog], [refs.initialized.entry.url, entry], [refs.initialized.battle.url, battle],
    ...maps.map(map => [catalog.maps[map.mapId].url, map])]);
  const repo = new api.GameContentRepository(async url => { assert.ok(payloads.has(url)); return payloads.get(url); }, "framework", refs);
  assert.equal((await repo.initializedNewGame()).content.contentHash, entry.contentHash);
  const report = { kind: "framework-world-travel-build-v1", recipeSha256, refs, initializerHash: entry.initializerHash,
    sourceInputs: { entry: recipe.sourceEntry, battle: recipe.sourceBattle, world: recipe.sourceWorld, maps: recipe.sourceMaps },
    maps: maps.map(map => ({ mapId: map.mapId, contentHash: map.contentHash, width: map.map.width, height: map.map.height,
      entryView: map.entryView, pointIns: map.partyEntry.pointIns, worldTerrainHash: map.map.worldTerrain?.contentHash ?? null })),
    sourceExit: exit, authoredReturn: station, sourceGeometryChanged: false, ownedInitializerChanged: false,
    initialStoryFlagsChanged: false, flatPresentation: flat.view, selectionOmissions: omissionReports,
    encounterMapId: recipe.worldMapId, encounterPolicy: walk, battleSelection: selected.report, semanticsVerified: false, originalGameExecuted: false,
    gameplayCheck: "not-run-by-builder", browserVerified: false };
  return { entry, battle, catalog, maps, refs, payloads, report };
}

export async function buildWorldTravel({ root = repository, recipePath = recipeName, out = "build/content-packages", dist = "dist" } = {}) {
  root = resolve(root); assert.equal(resolve(root, recipePath), resolve(root, recipeName));
  const api = await modules(root, dist), bytes = await readFile(resolve(root, recipePath));
  const result = await compileWorldTravel(root, JSON.parse(bytes.toString()), createHash("sha256").update(bytes).digest("hex"), { dist });
  const target = resolve(root, out), backup = target + ".previous-world-travel";
  assert.ok(within(resolve(root, "build"), target), "Travel output must be inside ignored build");
  await mkdir(resolve(target, ".."), { recursive: true }); const staged = await mkdtemp(resolve(target, "../.world-travel-"));
  try {
    try { await cp(target, staged, { recursive: true }); } catch (e) { if (e.code !== "ENOENT") throw e; }
    for (const [url, value] of result.payloads) {
      const file = resolve(staged, url.slice("/content-packages/".length)); assert.ok(within(staged, file));
      await mkdir(resolve(file, ".."), { recursive: true }); await writeFile(file, api.canonical(value) + "\n");
    }
    await writeFile(resolve(staged, "world-travel.json"), api.canonical(result.refs) + "\n");
    await writeFile(resolve(staged, "world-travel/build-report.json"), JSON.stringify(result.report, null, 2) + "\n");
    try { await stat(backup); throw new Error("Inspect interrupted world travel publication"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    let previous = false;
    try { await rename(target, backup); previous = true; } catch (e) { if (e.code !== "ENOENT") throw e; }
    try { await rename(staged, target); } catch (e) { if (previous) await rename(backup, target); throw e; }
    if (previous) await rm(backup, { recursive: true });
  } finally { await rm(staged, { force: true, recursive: true }); }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  while (args.length) { const name = args.shift(); assert.ok(["--out", "--dist"].includes(name) && args[0]); options[name.slice(2)] = args.shift(); }
  const result = await buildWorldTravel(options);
  console.log(JSON.stringify({ package: "world-travel", refs: (options.out ?? "build/content-packages") + "/world-travel.json",
    maps: result.maps.map(m => m.mapId), entryHash: result.entry.contentHash, semanticsVerified: false }));
}
