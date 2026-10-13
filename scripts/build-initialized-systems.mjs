// Source DataInitialize and authored system stations are separate entry lanes.
// No development snapshot receives a fabricated native ownership seed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { compileBattleContentBatch } from "./build-battle-content-batch.mjs";

const repository = resolve(import.meta.dirname, ".."), recipeName = "content-batches/systems-initialized.recipe.json";
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
const integer = (value, minimum = 0) => assert.ok(Number.isInteger(value) && value >= minimum && value <= 0x7fffffff);
async function modules(root, dist) {
  const load = name => import(pathToFileURL(resolve(root, dist, "src", name + ".js")).href);
  const results = await Promise.all([load("compiler/framework-new-game"), load("compiler/content"),
    load("core/content-integrity"), load("core/game-content"), load("core/game-content-refs"), load("core/source-catalog")]);
  return Object.assign({}, ...results);
}

export async function compileInitializedSystems(root, rawRecipe, recipeSha256, { dist = "dist" } = {}) {
  root = resolve(root); const api = await modules(root, dist), build = resolve(root, "build");
  fields(rawRecipe, "kind,id,sourceEntry,sourceBattle,sourceWorld,sourceMap,battleSourceSetHash,handoff,mapId,areaId,name,trainingNote,entrance,training,shop,magicStone");
  const recipe = structuredClone(rawRecipe);
  assert.equal(recipe.kind, "initialized-systems-recipe-v1"); assert.equal(recipe.id, "systems-initialized");
  assert.match(recipeSha256, digest); assert.match(recipe.battleSourceSetHash, digest);
  integer(recipe.mapId, 1); integer(recipe.areaId, 1);
  assert.ok(typeof recipe.name === "string" && recipe.name.trim());
  assert.ok(typeof recipe.trainingNote === "string" && recipe.trainingNote.trim());
  const seal = value => { const { contentHash: _, ...payload } = value; return { ...payload, contentHash: api.hash(payload) }; };
  const read = async ref => {
    fields(ref, "url,contentHash"); assert.match(ref.url, /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/);
    assert.match(ref.contentHash, digest);
    const path = await realpath(resolve(build, ref.url.slice(1))); assert.ok(within(build, path));
    return api.verifyContent(JSON.parse(await readFile(path, "utf8")), ref.contentHash);
  };
  const [sourceEntry, sourceBattle, sourceWorld, sourceMap] = await Promise.all(
    [recipe.sourceEntry, recipe.sourceBattle, recipe.sourceWorld, recipe.sourceMap].map(read));
  assert.equal(sourceEntry.battleCatalogHash, sourceBattle.contentHash);
  assert.equal(sourceEntry.worldCatalogHash, sourceWorld.contentHash);
  assert.equal(sourceWorld.maps[sourceMap.mapId]?.contentHash, sourceMap.contentHash);
  api.assertSourceGameCatalog(sourceBattle);
  assert.equal(sourceMap.developmentProfile, undefined); assert.equal(sourceWorld.developmentProfile, undefined);
  assert.equal(sourceEntry.developmentProfile, undefined);
  assert.ok(sourceMap.map && sourceMap.partyEntry && sourceMap.actorView && sourceMap.cameraHost && sourceMap.nativeFoot &&
    sourceWorld.nativeAnimationKeys && sourceMap.map.nativeComposition, "Source geometry/native providers are incomplete");
  for (const key of ["partyEntryBlockers", "actorViewBlockers", "cameraHostBlockers", "nativeFootBlockers", "nativeCompositionBlockers"])
    assert.equal(sourceMap[key]?.length ?? 0, 0, "Source native provider is blocked: " + key);
  assert.equal(sourceWorld.maps[recipe.mapId], undefined, "Author map cannot replace a source identity");
  fields(recipe.entrance, "x,y,layer,direction"); fields(recipe.training, "x,y,learningPartyId,growthPartyId");
  fields(recipe.shop, "x,y,groupId"); fields(recipe.magicStone, "x,y,contentId");
  integer(recipe.entrance.layer); assert.ok(["up", "right", "down", "left"].includes(recipe.entrance.direction));
  for (const key of ["learningPartyId", "growthPartyId"]) integer(recipe.training[key], 1);
  integer(recipe.shop.groupId, 1); integer(recipe.magicStone.contentId, 1);
  assert.ok(sourceBattle.gameState.shops.groups.some(row => row.id === recipe.shop.groupId));
  assert.ok(sourceBattle.gameState.magicStones.stones[recipe.magicStone.contentId]);
  const positions = [recipe.entrance, recipe.training, recipe.shop, recipe.magicStone];
  assert.equal(new Set(positions.map(p => `${p.x},${p.y}`)).size, positions.length);
  for (const p of positions) {
    integer(p.x); integer(p.y); assert.ok(p.x < sourceMap.map.width && p.y < sourceMap.map.height);
    assert.equal(sourceMap.map.collisions[recipe.entrance.layer]?.[p.y * sourceMap.map.width + p.x], 0,
      "System stations must use existing walkable geometry");
  }
  const selectedParties = [recipe.training.learningPartyId, recipe.training.growthPartyId];
  assert.equal(new Set(selectedParties).size, selectedParties.length);
  const declaration = { kind: "battle-content-batch-declaration-v1", id: recipe.id,
    parentSourceSetHash: sourceEntry.parentSourceSetHash, battleSourceSetHash: recipe.battleSourceSetHash,
    baseCatalogRef: recipe.sourceBattle, partyIds: selectedParties, handoff: recipe.handoff };
  const selected = await compileBattleContentBatch(root, declaration);
  if (!selected.catalog) { const error = new Error("Initialized system battles are blocked"); error.report = selected.report; throw error; }
  const rows = sourceBattle.common.battleEntry.maps.filter(row => row.id === sourceMap.mapId);
  assert.equal(rows.length, 1, "Source map qualification is ambiguous or absent");
  const qualification = rows[0];
  assert.ok(!selected.catalog.common.battleEntry.maps.some(row => row.id === recipe.mapId));
  const battle = seal({ ...selected.catalog, common: { ...selected.catalog.common,
    battleEntry: { ...selected.catalog.common.battleEntry, maps: [...selected.catalog.common.battleEntry.maps,
      { id: recipe.mapId, sleepingAvailability: qualification.sleepingAvailability,
        movingAvailability: qualification.movingAvailability }] },
    limitations: [...selected.catalog.common.limitations,
      `Author map ${recipe.mapId} explicitly reuses map ${sourceMap.mapId} ability exclusions; this is framework policy.`] } });
  assert.equal(api.canonical(battle.gameState), api.canonical(sourceBattle.gameState));
  const evidence = pointer => ({ file: recipeName, assetPath: "Authored/SystemsInitialized/recipe.json", pointer, sha256: recipeSha256 });
  const profile = sourceContentHash => ({ kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash, omissions: [] });
  const local = { category: "MapLocalVariable", index: 0 }, selection = { category: "MessageSelection", index: 0 };
  const message = (key, text) => ({ kind: "message", key, speaker: "", text });
  const programs = {
    systems_init: [{ kind: "exit" }],
    systems_training: [
      { kind: "choice", options: [{ key: "TRAIN_LEARNING", text: "魔法学习训练" },
        { key: "TRAIN_GROWTH", text: "升级训练" }, { key: "TRAIN_EXIT", text: "返回训练场" }],
        initialIndex: 0, cancelIndex: null, anchor: "bottom-center", presentation: "multiple", retainMessage: false },
      { kind: "branch", left: selection, operator: "＝", right: { kind: "immediate", value: 0 }, target: 4 },
      { kind: "branch", left: selection, operator: "＝", right: { kind: "immediate", value: 1 }, target: 6 },
      { kind: "exit" },
      { kind: "encounter", party: recipe.training.learningPartyId, continuation: "systems_after" }, { kind: "exit" },
      { kind: "encounter", party: recipe.training.growthPartyId, continuation: "systems_after" }, { kind: "exit" },
    ],
    systems_after: [message("SYSTEMS_RETURN", "结果已写回队伍。可打开菜单、施法、换装、编队和保存；再次面对上方训练设施并确认可选择下一战。"), { kind: "exit" }],
    systems_stone: [
      { kind: "branch", left: local, operator: "＝", right: { kind: "immediate", value: 1 }, target: 5 },
      { kind: "inventory", command: { kind: "grant-magic-stone", id: recipe.magicStone.contentId, count: 1 }, result: null,
        dependencies: [{ table: "content.csv", id: recipe.magicStone.contentId }] },
      { kind: "calc", left: local, operator: "←", right: { kind: "immediate", value: 1 } },
      message("SYSTEMS_STONE", "获得训练用魔石。打开菜单，在蒂娜的魔石列表中装备俾斯麦；魔法学习训练每胜一场推进实际学习进度，升级训练可观察等级奖励。" + recipe.trainingNote),
      { kind: "exit" }, message("SYSTEMS_STONE_TAKEN", "训练魔石已领取。装备、学习进度与成长均保留在当前队伍中。"), { kind: "exit" },
    ],
  };
  const scripts = Object.fromEntries(Object.entries(programs).map(([name, program]) => [name,
    program.map((op, index) => ({ ...op, script: name, index, source: evidence("/scripts/" + name + "/" + index) }))]));
  const contexts = Object.values(sourceMap.scriptPuppetContexts ?? {}).filter(context =>
    context && context.miscHash === sourceEntry.puppetCatalog.miscHash && context.characteristics === sourceEntry.puppetCatalog.characteristics);
  assert.ok(contexts.length > 0, "Source puppet context declaration is unavailable");
  const context = contexts[0], pointSource = evidence("/entrance");
  const point = { id: 1, ...recipe.entrance, linkObject: 0, source: pointSource };
  const entity = (id, position, extra) => ({ id, objectId: 0, kind: 5, ...position, layer: recipe.entrance.layer,
    width: 1, height: 1, direction: "down", asset: null, script: null, collision: null, destinationLayer: null,
    source: evidence("/stations/" + id), ...extra });
  const properties = interaction => ({ collision: true, acceptDirection: 15, talkMounts: [""], soundId: 0, interaction });
  const entities = [entity("systems_entrance", recipe.entrance, { objectId: 1, kind: 0,
    direction: recipe.entrance.direction, source: pointSource }),
    entity("systems_training", { x: recipe.training.x, y: recipe.training.y }, { script: "systems_training",
      mapObject: properties({ kind: "script", script: "systems_training" }) }),
    entity("systems_shop", { x: recipe.shop.x, y: recipe.shop.y }, { mapObject: properties({ kind: "shop", groupId: recipe.shop.groupId,
      start: null, close: null }) }),
    entity("systems_stone", { x: recipe.magicStone.x, y: recipe.magicStone.y }, { script: "systems_stone",
      mapObject: properties({ kind: "script", script: "systems_stone" }) })];
  const group = { name: "entity_default", source: evidence("/stations"), entities, blockers: [] };
  // Keep the physical map name for its unchanged native foot/material inputs.
  const geometry = { ...structuredClone(sourceMap.map), identity: { mapId: recipe.mapId, areaId: recipe.areaId },
    entities, groups: { entity_default: group }, initialGroups: ["entity_default"],
    entryContext: { ...structuredClone(sourceMap.map.entryContext), mapId: recipe.mapId,
      groups: { entity_default: { savePointCount: 0, reason: null, source: group.source } } } };
  const map = seal({ formatVersion: 1, kind: "world-map-development", sourceSetHash: sourceWorld.sourceSetHash,
    parentSourceSetHash: sourceWorld.parentSourceSetHash, mediaSourceSetHash: sourceWorld.mediaSourceSetHash,
    developmentProfile: profile(sourceMap.contentHash), mapId: recipe.mapId, areaId: recipe.areaId, name: recipe.name,
    map: geometry, partyEntry: { ...structuredClone(sourceMap.partyEntry), mapId: recipe.mapId, pointIns: [point], conditionColliders: [] },
    partyEntryBlockers: [], actorView: structuredClone(sourceMap.actorView), actorViewBlockers: [],
    cameraHost: structuredClone(sourceMap.cameraHost), cameraHostBlockers: [], nativeFoot: structuredClone(sourceMap.nativeFoot),
    nativeFootBlockers: [], nativeCompositionBlockers: [], scripts, initializer: "systems_init",
    scriptLocals: Object.fromEntries(Object.keys(scripts).map(name => [name, null])),
    scriptPuppetContexts: Object.fromEntries(Object.entries(scripts).map(([name, program]) => [name,
      { ...structuredClone(context), scriptHash: api.hash({ kind: "framework-author-script-v1", program }),
        skipInitialize: false, keepPlayerPuppet: false, keepBadStatusVisual: false, ridingVehicle: false }])),
    scriptSystemFlags: Object.fromEntries(Object.keys(scripts).map(name => [name, { keepBadStatusVisual: false }])),
    scriptTransitionMetadata: Object.fromEntries(Object.keys(scripts).map(name => [name, { customAnimations: "none" }])),
    characterAssets: [], blockers: [],
    limitations: ["Authored facilities and training choices on source geometry; source story reachability remains unverified.",
      "Assetless MapObject facilities are interactive system stations, not native NPCs.",
      "Magic stone receipt is guarded by the actual map-local bank; checkpoint restore does not rerun initialization."] });
  const prefix = "/content-packages/" + recipe.id;
  const catalog = seal({ ...structuredClone(sourceWorld), developmentProfile: profile(sourceWorld.contentHash),
    maps: { [map.mapId]: { url: prefix + "/maps/" + map.mapId + ".json", contentHash: map.contentHash,
      name: map.name, areaId: map.areaId, geometryReady: true, defaultGroupReady: true, blockers: [] } },
    limitations: ["Source initializer, owned catalogs and immutable source map retained; authored training facilities have a separate entry."] });
  const entry = await api.compileFrameworkNewGame({ sourceEntry, sourceBattle, sourceMap, world: catalog, map, battle, entrance: 1 });
  const refs = api.parseGameContentRefs({ kind: "game-content-refs-v2", profile: "framework", source: null, development: null,
    world: { url: prefix + "/world.json", contentHash: catalog.contentHash },
    initialized: { entry: { url: prefix + "/entry.json", contentHash: entry.contentHash },
      battle: { url: prefix + "/battle.json", contentHash: battle.contentHash } } });
  const payloads = new Map([[refs.world.url, catalog], [refs.initialized.entry.url, entry],
    [refs.initialized.battle.url, battle], [catalog.maps[map.mapId].url, map]]);
  const repo = new api.GameContentRepository(async url => {
    assert.ok(payloads.has(url), "Unexpected initialized system dependency: " + url); return payloads.get(url);
  }, "framework", refs);
  const loaded = await repo.initializedNewGame(); assert.equal(loaded.content.contentHash, entry.contentHash);
  const report = { kind: "initialized-systems-build-v1", package: recipe.id, profile: "framework", entryOrigin: "framework-new-game",
    recipeSha256, refs, initializerHash: entry.initializerHash, sourceEntryHash: sourceEntry.contentHash,
    sourceMapHash: sourceMap.contentHash, sourceBattleHash: sourceBattle.contentHash, battleHash: battle.contentHash,
    sourceInputs: { entry: recipe.sourceEntry, battle: recipe.sourceBattle, world: recipe.sourceWorld, map: recipe.sourceMap },
    battleSelection: selected.report, mapQualification: { fromMapId: sourceMap.mapId, toMapId: recipe.mapId, row: qualification },
    maps: [{ mapId: map.mapId, contentHash: map.contentHash, scripts: Object.keys(map.scripts) }],
    stations: { entrance: recipe.entrance, training: recipe.training, shop: recipe.shop, magicStone: recipe.magicStone },
    trainingNote: recipe.trainingNote,
    ownedCatalogsChanged: false, originalInitializerChanged: false, originalPackagesChanged: false,
    sourceGameplayAdmitted: false, nativeHandoffVerified: false, browserVerified: false, gameplayCheck: "not-run-by-builder" };
  return { entry, battle, catalog, map, maps: [map], refs, payloads, report };
}

export async function buildInitializedSystems({ root = repository, recipePath = recipeName, out, dist = "dist" } = {}) {
  root = resolve(root); const api = await modules(root, dist);
  assert.equal(resolve(root, recipePath), resolve(root, recipeName), "Only the initialized systems recipe is supported");
  const bytes = await readFile(resolve(root, recipePath)), result = await compileInitializedSystems(root,
    JSON.parse(bytes.toString()), createHash("sha256").update(bytes).digest("hex"), { dist });
  const build = resolve(root, "build"), target = resolve(root, out ?? "build/content-packages"), backup = target + ".previous-initialized";
  assert.ok(within(build, target), "Initialized output must be inside build");
  await mkdir(resolve(target, ".."), { recursive: true });
  const staged = await mkdtemp(resolve(target, "../.initialized-packages-"));
  try {
    try { await cp(target, staged, { recursive: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const [url, value] of result.payloads) {
      const file = resolve(staged, url.slice("/content-packages/".length)); assert.ok(within(staged, file));
      await mkdir(resolve(file, ".."), { recursive: true }); await writeFile(file, api.canonical(value) + "\n");
    }
    await writeFile(resolve(staged, "systems-initialized.json"), api.canonical(result.refs) + "\n");
    await writeFile(resolve(staged, "systems-initialized/build-report.json"), JSON.stringify(result.report, null, 2) + "\n");
    try { await stat(backup); throw new Error("Inspect interrupted initialized systems publication"); }
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
    const name = args.shift(); assert.ok(["--out", "--dist"].includes(name) && args[0],
      "Use build-initialized-systems.mjs [recipe.json] [--out build/collection] [--dist compiled-dir]");
    options[name.slice(2)] = args.shift();
  }
  const result = await buildInitializedSystems(options);
  console.log(JSON.stringify({ package: "systems-initialized", profile: result.refs.profile,
    mapId: result.map.mapId, entryHash: result.entry.contentHash, initializerHash: result.entry.initializerHash,
    refs: (options.out ?? "build/content-packages") + "/systems-initialized.json", sourceGameplayAdmitted: false }));
}
