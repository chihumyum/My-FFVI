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
    "core/content-integrity", "core/game-content", "core/game-content-refs", "core/source-catalog", "core/development-profile",
    "compiler/source-walk-policy",
    "compiler/initialized-battle-binding", "compiler/source-area-scope",
    "compiler/field-npc-activity", "core/field-npc-activity-source", "compiler/field-services", "compiler/framework-npc-area",
  ].map(load)));
}

/** One explicit producer profile for every initialized entry/world/map body.
 * Runtime authorization is separate; this creates no source readiness grant. */
export function initializedContentBatchProfile(sourceContentHash,{presentation,npcActivity,worldAutoTasks,birdViewActors,worldAutoMove,mobColorFilter,screenPresentation}={}){
  if(screenPresentation!==undefined&&screenPresentation!=="web-field-screen-presentation-2d-v1")throw Error("Unknown initialized screen presentation policy");
  assert.match(sourceContentHash,digest);assert.equal(presentation,'framework-ordinary-field-flat-v1');
  if(worldAutoTasks!==undefined&&worldAutoTasks!=='web-flat-world-auto-tasks-v1')throw new Error('Unknown initialized world auto-task policy');
  if(mobColorFilter!==undefined&&mobColorFilter!=='web-flat-mob-color-filter-v1')throw new Error('Unknown initialized Mob color-filter policy');
  if(birdViewActors!==undefined&&birdViewActors!=='web-flat-bird-view-actors-v1')throw new Error('Unknown initialized BirdView actor policy');
  if(worldAutoMove!==undefined&&(worldAutoMove!=='web-flat-world-auto-move-v1'||worldAutoTasks!=='web-flat-world-auto-tasks-v1'))throw Error('Invalid initialized world auto-movement policy');
  if(npcActivity!==undefined&&npcActivity!=='framework-npc-area-v1')throw new Error('Unknown initialized NPC activity policy');
  return {kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash,omissions:[],
    storyRuntime:'web-field-story-runtime-v1',autoSave:'web-field-autosave-barrier-v1',fieldPresentation:presentation,
    ...(npcActivity?{npcActivity}:{}),...(worldAutoTasks?{worldAutoTasks}:{}),...(birdViewActors?{birdViewActors}:{}),...(worldAutoMove?{worldAutoMove}:{}),...(mobColorFilter?{mobColorFilter}:{}),...(screenPresentation?{screenPresentation}:{})};
}

/** All source references are verified before derivation. The manifest supplies
 * player inputs, not replacement scripts, flags, actors, rewards or assets. */
export async function compileInitializedContentBatch(root, raw, recipeSha256,
  { dist = "dist", readJson, sourceBattleDirectory, worldAutoTasks, birdViewActors, worldAutoMove, mobColorFilter,screenPresentation } = {}) {
  if(screenPresentation!==undefined&&screenPresentation!=="web-field-screen-presentation-2d-v1")throw Error("Unknown initialized screen presentation policy");
  if(worldAutoTasks!==undefined&&worldAutoTasks!=='web-flat-world-auto-tasks-v1')throw new Error('Unknown initialized world auto-task policy');
  if(mobColorFilter!==undefined&&mobColorFilter!=='web-flat-mob-color-filter-v1')throw new Error('Unknown initialized Mob color-filter policy');
  if(birdViewActors!==undefined&&birdViewActors!=='web-flat-bird-view-actors-v1')throw new Error('Unknown initialized BirdView actor policy');
  if(worldAutoMove!==undefined&&(worldAutoMove!=='web-flat-world-auto-move-v1'||worldAutoTasks!=='web-flat-world-auto-tasks-v1'))throw Error('Invalid initialized world auto-movement policy');
  root = resolve(root); const api = await modules(root, dist), build = resolve(root, "build");
  const serviceVariant=raw?.kind==='initialized-source-map-recipe-v5';
  const npcVariant=raw?.kind==='initialized-source-map-recipe-v4'||serviceVariant;
  const directoryVariant=raw?.kind==='initialized-source-map-recipe-v3'||npcVariant;
  const walkingVariant=raw?.kind==='initialized-source-map-recipe-v2'||directoryVariant&&raw.walking!==null;
  fields(raw, "kind,id,sourceEntry,sourceBattle,sourceWorld,startMap,entrance,presentation,manifest"+
    (directoryVariant?',battleCatalogSelection,sourceAreaScope,walking':walkingVariant?',walking':'')+(npcVariant?',npcActivity':'')+(serviceVariant?',fieldServices':''));
  const recipe = structuredClone(raw);
  assert.ok(['initialized-source-map-recipe-v1','initialized-source-map-recipe-v2','initialized-source-map-recipe-v3','initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(recipe.kind));
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
    if (readJson) return api.verifyContent(structuredClone(await readJson(ref.url)), ref.contentHash);
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
  const battleCatalogSelection=directoryVariant?recipe.battleCatalogSelection:
    walkingVariant?'shared-framework-directory-v1':'source-baseline-v1';
  if(walkingVariant)assert.equal(battleCatalogSelection,'shared-framework-directory-v1',
    'Source walking requires the shared directory, never a filtered baseline pool');
  const selected=await api.selectInitializedBattleCatalog({selection:battleCatalogSelection,
    sourceBattle,sourceWorld,...(sourceBattleDirectory===undefined?{}:{directory:sourceBattleDirectory})});
  const battle=selected.catalog;
  const walking=new Map();
  let npcTemplate=null;
  if(npcVariant){
    fields(recipe.npcActivity,'kind,policy,missingFirstInterval,random,collision,schedule,takeover,reason');
    assert.equal(recipe.npcActivity.kind,'framework-npc-area-template-v1');
    api.parseFrameworkNpcActivityDeclaration({...recipe.npcActivity,kind:'framework-npc-area-declaration-v1',sourceHash:'0'.repeat(64)});
    npcTemplate=structuredClone(recipe.npcActivity);
  }
  const serviceMaps=new Set();
  if(serviceVariant){
    fields(recipe.fieldServices,'kind,relayInteraction,passiveEffects,mapIds');
    assert.equal(recipe.fieldServices.kind,'framework-field-services-declaration-v1');
    assert.equal(recipe.fieldServices.relayInteraction,'framework-relay-interaction-v1');
    assert.equal(recipe.fieldServices.passiveEffects,'framework-passive-field-effects-v1');
    assert.ok(Array.isArray(recipe.fieldServices.mapIds)&&recipe.fieldServices.mapIds.length);
    for(const mapId of recipe.fieldServices.mapIds){
      assert.ok(initialManifest.mapIds.includes(mapId)&&!serviceMaps.has(mapId),'Unbound or duplicate service map');
      serviceMaps.add(mapId);
    }
  }
  if(walkingVariant){
    fields(recipe.walking,'kind,maps');assert.equal(recipe.walking.kind,'initialized-source-walking-v1');
    assert.ok(Array.isArray(recipe.walking.maps)&&recipe.walking.maps.length>0);
    for(const item of recipe.walking.maps){
      fields(item,'mapId,declaration');assert.ok(initialManifest.mapIds.includes(item.mapId));
      assert.ok(!walking.has(item.mapId),'Duplicate source walking map declaration');
      walking.set(item.mapId,item.declaration);
    }
  }
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
  const sourceAreaScopeReceipt=directoryVariant&&recipe.sourceAreaScope!==null
    ? await api.deriveSourceAreaScope({scope:recipe.sourceAreaScope,catalog:sourceWorld,maps:sourceMaps}):null;
  const corpus = await api.loadCorpus(root);
  assert.equal(corpus.sourceSetHash, sourceWorld.sourceSetHash);
  assert.equal(corpus.manifest.parentSourceSetHash, sourceWorld.parentSourceSetHash);
  const sources = corpus.manifest.sources.map(({ file, sha256 }) => ({ file, sha256 }));
  const bindings = api.bindMapPackages(corpus.assets, corpus.tables), byId = new Map(corpus.assets.map(asset => [asset.id, asset]));
  const renderHost = await api.loadFieldCompositionRenderHost(root, sources);
  const seal = value => { const { contentHash: _, ...body } = value; return { ...body, contentHash: api.hash(body) }; };
  const profile = sourceContentHash => initializedContentBatchProfile(sourceContentHash,{presentation:recipe.presentation,
    ...(npcVariant?{npcActivity:npcTemplate.policy}:{}),...(worldAutoTasks?{worldAutoTasks}:{}),...(birdViewActors?{birdViewActors}:{}),...(worldAutoMove?{worldAutoMove}:{}),...(mobColorFilter?{mobColorFilter}:{}),...(screenPresentation?{screenPresentation}:{})});
  const prefix = "/content-packages/" + recipe.id, presentations = [], walkingResults=[],npcResults=[],serviceResults=[];
  const maps = sourceMaps.map(sourceMap => {
    const map = structuredClone(sourceMap);
    map.developmentProfile = profile(sourceMap.contentHash);
    if(serviceMaps.has(map.mapId)){
      map.developmentProfile.relayInteraction=recipe.fieldServices.relayInteraction;
      map.developmentProfile.passiveEffects=recipe.fieldServices.passiveEffects;
      const relay=api.deriveFrameworkRelayHost(sourceMap),passive=api.deriveFrameworkPassiveEffectsHost(sourceMap,corpus.assets);
      map.frameworkRelayInteraction=relay;if(passive.host)map.frameworkPassiveEffects=passive.host;
      serviceResults.push({mapId:map.mapId,relays:relay.bindings.length,passiveEffects:passive.host?.bindings.length??0,
        diagnostics:passive.diagnostics,nativeRulesVerified:false});
    }
    if(npcVariant){
      assert.equal(sourceMap.frameworkNpcActivity,undefined,'Original source map cannot carry an authored NPC controller host');
      const assessment=api.assessFrameworkNpcAreaMap(corpus,sourceMap,npcTemplate);
      map.frameworkNpcActivity=assessment.host;
      npcResults.push(assessment.record);
    }
    if(walking.has(map.mapId)){
      assert.ok(map.sourceWalkEncounters,'Missing retained source walking metadata');
      assert.equal(map.walkEncounters,undefined,'Source map cannot already carry an authored scheduler');
      const result=api.compileSourceWalkPolicy({mapId:map.mapId,source:map.sourceWalkEncounters,catalog:battle,
        declaration:walking.get(map.mapId)});
      walkingResults.push(result);
      assert.equal(result.status,'ready','Entire source encounter pool must be executable before enabling walking: '+
        api.canonical(result.diagnostics));
      assert.ok(result.policy&&result.binding);
      map.walkEncounters=result.policy;map.frameworkWalkBinding=result.binding;
    }
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
    const unchanged=structuredClone(map);delete unchanged.developmentProfile;delete unchanged.frameworkPresentation;
    if(npcVariant)delete unchanged.frameworkNpcActivity;
    if(serviceMaps.has(map.mapId)){delete unchanged.frameworkRelayInteraction;delete unchanged.frameworkPassiveEffects;}
    if(walking.has(map.mapId)){delete unchanged.walkEncounters;delete unchanged.frameworkWalkBinding;}
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
  const catalog = seal(catalogDraft);
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
  const report = { kind: "initialized-source-map-build-v1", package: recipe.id, recipeKind:recipe.kind, recipeSha256,
    refs, manifestHash: plan.manifestHash, initializerHash: entry.initializerHash,
    sourceInputs: { entry: recipe.sourceEntry, battle: recipe.sourceBattle, world: recipe.sourceWorld, maps: sourcePins },
    ...(directoryVariant?{battleCatalogSelection,sourceAreaScopeReceipt}:{}),
    ...(selected.directoryBinding===null?{}:{battleDirectory:selected.directoryBinding}),
    ...(walkingVariant?{walking:walkingResults,nativeWalkingRulesVerified:false}:{}),
    ...(serviceVariant?{fieldServices:{declaration:recipe.fieldServices,maps:serviceResults,nativeRulesVerified:false}}:{}),
    ...(npcVariant?{npcActivity:{template:npcTemplate,maps:npcResults,nativeRulesVerified:false,
      counts:{maps:npcResults.length,declared:npcResults.reduce((sum,value)=>sum+value.counts.declared,0),
        derived:npcResults.reduce((sum,value)=>sum+value.counts.derived,0),
        blocked:npcResults.reduce((sum,value)=>sum+value.counts.declared-value.counts.derived,0)}}}:{}),
    relocation: { kind: "source-initializer-authored-map-v1", mapId: recipe.startMap, entrance: recipe.entrance,
      sourceStoryReachability: "unverified" },
    maps: maps.map(value => ({ mapId: value.mapId, contentHash: value.contentHash })), presentations,
    diagnostics: plan.diagnostics, referenceClosure: plan.dependencies.referenceClosure, runtimeAdmission: "unassessed",
    originalMapPayloadsChanged: false, originalPackagesChanged: false, originalInitializerChanged: false,
    storyFlagsChanged: false, ownedCatalogsChanged: false, sourceCampaignComplete: false,
    browserVerified: false, originalGameExecuted: false,
    limitations: [walkingVariant?'Entry relocation, flat presentation, Web step counts and source rates as Web weights are explicit development policies.'
      :selected.directoryBinding===null?"Only entry relocation and the declared ordinary Canvas material policy are authored."
        :"Entry relocation, ordinary Canvas materials and shared-directory Web battle policies are explicitly selected; walking is not enabled.",
      "Every original map entity, event, exit, collision and foot provider is retained, including blockers.",
      "Original entries outside the declared map batch remain indexed but are not granted this initialized profile.",
      ...(sourceAreaScopeReceipt===null?[]:["Every source map variant in the declared area is included; world phase and story applicability remain unknown."]),
      ...(npcVariant?["Area NPC source records and original blockers are retained; scheduling, randomness, collision and takeover use the explicit Web host policy."]:[]),
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
