// Source-bound Web actor checkpoint round trips. The source map candidate and
// NPC activation are controlled mechanisms, not a formal story/gameplay save.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir", "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { hash } = await module("compiler/content");
const { bindMapPackages } = await module("compiler/map-package");
const { compileEntityGroup } = await module("compiler/entity-group");
const { compileMapPartyEntry } = await module("compiler/map-party-entry");
const { compileFieldActorFactory } = await module("compiler/field-actor-factory");
const { compilePartyActorCatalog } = await module("compiler/party-actors");
const { compileFieldActorView } = await module("compiler/field-actor-view");
const { compileFieldEntryContext } = await module("compiler/field-entry-context");
const { compileFieldNativeFoot } = await module("compiler/field-native-foot");
const { compileFieldNativeAnimationKeys } = await module("compiler/field-native-appearance");
const { compileWorldCharacter } = await module("compiler/world");
const { createNewGame } = await module("core/new-game");
const { GameState } = await module("core/game-state");
const { createFreshFieldPartyActorCheckpoint, createFieldActorFactoryCandidate } = await module("core/field-actor-factory");
const { prepareMapPartyEntry } = await module("core/map-party-entry");
const { fieldCameraCellToWorld, fieldCameraLayerFromLogical } = await module("core/field-camera");
const { projectFieldActorView } = await module("core/field-actor-view");
const { readFieldNativeFoot } = await module("core/field-native-foot");
const { createNativeFieldActorProjections, createNativeFieldActorProjection } = await module("core/field-native-actors");
const { compileFieldNativeNpcStandby } = await module("compiler/field-native-npc");
const { prepareFieldNativeNpcGroup, fieldNativeNpcStandbyPosition } = await module("core/field-native-npc");
const { captureFieldNativeCheckpoint, restoreFieldNativeCheckpoint } = await module("core/field-native-checkpoint");
const { projectFieldPuppetActorEffects } = await module("core/field-puppet-effects");
const { prepareSourceNativeMap } = await module("core/source-native-map");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const output = root + "build/reports/field-native-checkpoint-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const receiptBytes = await readFile(root + "build/reports/source-native-map-native-check.json"), receipt = JSON.parse(receiptBytes);
assert.equal(receipt.kind, "source-native-map-native"); assert.equal(receipt.originalGameExecuted, false);
assert.equal(sha(await readFile(root + "build/runtime/game/GameAssembly.dll")), receipt.nativeSha256);
const corpus = await loadCorpus(root), battleSource = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
assert.equal(battleSource.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const unique = (assets, suffix) => {
  const rows = Object.values(assets).filter((a) => a.source.assetPath.endsWith(suffix));
  assert.equal(rows.length, 1, suffix); return rows[0];
};
const misc = unique(battleSource.assets, "/Misc/serial_misc_assets.json");
const catalog = compilePartyActorCatalog(corpus.tables, misc.data).catalog;
const factory = compileFieldActorFactory(corpus.manifest.sources);
const content = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
const { contentHash, ...body } = content; assert.equal(hash(body), contentHash);
const state = GameState.createNewGame(content.gameState, content.common.players, contentHash, content.common.conditions);
const fresh = createNewGame(content.gameState.sourceNewGame), party = state.fieldPartyAppearance.current();
assert.equal(fresh.entry.mapId, 609); assert.equal(fresh.entry.entrance, 1);
const ownedBefore = JSON.stringify(state.snapshot());
const script = unique(corpus.assets, "/Map_40037/Map_40037/sc_e_0001.json"), sourceOp = script.data.Mnemonics[19];
assert.equal(sourceOp.mnemonic, "ChangeMap");
assert.deepEqual(sourceOp.operands.iValues, [3, 1, 0, 0, 1, 0, 0, 0]);
assert.equal(sourceOp.operands.sValues[0], "sc_e_0001_1");
const bindings = bindMapPackages(corpus.assets, corpus.tables), byId = new Map(corpus.assets.map((a) => [a.id, a]));
const loadMap = async (id) => {
  const map = JSON.parse(await readFile(root + `build/world/maps/${id}.json`, "utf8"));
  const { contentHash, ...body } = map; assert.equal(hash(body), contentHash);
  assert.equal(map.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
  const binding = bindings.find((b) => Number(b.id) === id); assert.ok(binding);
  const tilemap = byId.get(binding.tilemap), group = byId.get(binding.groups.entity_default), pkg = byId.get(binding.packageId);
  assert.ok(tilemap && group && pkg);
  const entities = compileEntityGroup("entity_default", group, corpus.tables, corpus.messages);
  const definition = compileMapPartyEntry(corpus.tables, id, tilemap.data, group, entities.entities).definition;
  assert.deepEqual(definition, map.partyEntry);
  const view = compileFieldActorView(corpus.manifest.sources, tilemap, pkg, definition.mapRange);
  const foot = compileFieldEntryContext(corpus.assets, corpus.tables, id).foot;
  const nativeFoot = compileFieldNativeFoot(pkg.data, pkg.source, binding.name);
  assert.deepEqual(map.nativeFoot, nativeFoot, "Rebuild the published map with its source native foot provider");
  assert.deepEqual(map.nativeFootBlockers, []);
  return { map, binding, definition, view, foot, nativeFoot, package: pkg };
};
const start = await loadMap(fresh.entry.mapId), destination = await loadMap(sourceOp.operands.iValues[0]);
assert.ok(destination.binding.scriptAliases[sourceOp.operands.sValues[0]]);
const initial = createFreshFieldPartyActorCheckpoint({ factory, catalog, fresh, party, map: start.definition, playerId: "-1001" });
const entry = prepareMapPartyEntry(catalog, { definition: start.definition, entrance: fresh.entry.entrance,
  mapViewType: fresh.entry.viewType, prior: initial, playerVisible: true, party, transportation: fresh.entry.transportation,
  canPartySwitching: fresh.events.scenario[2 * 256 + 45] === 1 });
const mediaBytes = await readFile(root + "build/world-media/media.json"), media = JSON.parse(mediaBytes);
const manifest = JSON.parse(await readFile(root + "build/world-media/snapshot.json", "utf8"));
assert.equal(manifest.files.find((f) => f.file === "media.json").sha256, sha(mediaBytes));
assert.equal(media.parentSourceSetHash, corpus.sourceSetHash); assert.equal(hash(media.sources), media.sourceSetHash);
const npcAsset = byId.get(destination.binding.groups.ev_e_0001);
const npcGroup = compileEntityGroup("ev_e_0001", npcAsset, corpus.tables, corpus.messages);
assert.deepEqual(npcGroup.blockers, []);
const npcs = npcGroup.entities.filter((e) => [6,17].includes(e.kind)).map((e) => e.nativeNpc);
assert.equal(npcs.length, 6); assert.ok(npcs.every(Boolean));
const checked = new Set(), checkedBundles = new Set(), characters = {};
const verifyBundle = (source) => {
  assert.equal(corpus.manifest.sources.find((s) => s.file === source.file)?.sha256, source.sha256);
  if (checkedBundles.has(source.file)) return;
  assert.equal(sha(readFileSync(root + "build/runtime/game/" + source.file)), source.sha256); checkedBundles.add(source.file);
};
verifyBundle(npcAsset.source);
const mediaNames = [...new Set([...Object.values(catalog.assets).map((a) => a.asset), ...npcs.map((n) => n.asset.asset)])];
for (const name of mediaNames) {
  const raw = media.characters[name]; assert.ok(raw); verifyBundle(raw.animation.source);
  assert.equal(corpus.manifest.sources.find((s) => s.file === raw.animation.source.file).sha256, raw.animation.source.sha256);
  characters[name] = compileWorldCharacter(raw, (file, digest) => {
    assert.ok(file.startsWith("sprites/") && !file.includes(".."));
    if (checked.has(file)) return;
    assert.equal(sha(readFileSync(root + "build/world-media/" + file)), digest);
    assert.equal(manifest.files.find((f) => f.file === file).sha256, digest); checked.add(file);
  }).character;
}
const animationKeys = compileFieldNativeAnimationKeys(catalog, media.characters);
assert.equal(start.foot.kind, "uniform-zero"); assert.equal(start.foot.basis, "no-attribute-asset");
// Native foot is independently source-bound; null render targets remain an
// explicit controlled pure-mechanism input, not production RT admission.
const providers = (view, foot) => ({ mapRenderContext: view.contextId, transportationType: fresh.entry.transportation.type,
  footAttribute: (position) => readFieldNativeFoot(foot, position), upperTexture: null, ceilTexture: null,
  applyViewProperties: (layer) => projectFieldActorView(view, layer) });
const range = start.definition.mapRange;
const prior = createFieldActorFactoryCandidate({ factory, partyCatalog: catalog, checkpoint: entry.checkpoint, characters,
  providers: providers(start.view, start.nativeFoot), player: {
    position: fieldCameraCellToWorld(range, { x: entry.player.x - range.x, y: entry.player.y - range.y }, entry.player.layer),
    layer: fieldCameraLayerFromLogical(entry.player.layer).layer, direction: entry.player.direction, visible: entry.player.visible },
  camera: { id: "native:camera:0", position: { x: 32, y: 64, z: 349 }, layer: 9 } });
assert.equal(prior.snapshot.actors.length, 55);
const player = prior.snapshot.actors.find((a) => a.id === prior.bindings.player), puppet = prior.snapshot.actors.find((a) => a.id === prior.bindings.partyPuppets[0]);
const resident = prior.snapshot.actors.find((a) => a.id === prior.bindings.residents[0].actor);
for (const actor of [puppet, resident]) {
  actor.position = { x: 80, y: 64, z: 349 }; actor.layer = 9; actor.direction = "up";
  actor.animation.play("WalkB", true, 1); actor.animation.advance(137);
  actor.viewBinding = { map: start.view.contextId, layer: 9, properties: projectFieldActorView(start.view, 9) };
}
puppet.visible = true; puppet.fadeAlpha = 1;
resident.visible = false; resident.fadeAlpha = 0;
player.visible = false; player.fadeAlpha = 0;
const plan = prepareMapPartyEntry(catalog, { definition: destination.definition, entrance: sourceOp.operands.iValues[1],
  mapViewType: sourceOp.operands.iValues[2], prior: entry.checkpoint, playerVisible: player.visible,
  party, transportation: fresh.entry.transportation, canPartySwitching: fresh.events.scenario[2 * 256 + 45] === 1 });
const input = { prior, priorCheckpoint: entry.checkpoint, entry: plan, definition: destination.definition,
  catalog, party, characters, animationKeys, view: destination.view, providers: providers(destination.view, destination.nativeFoot) };
const serial = (c) => ({ ...c, snapshot: { ...c.snapshot,
  actors: c.snapshot.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() ?? null })) } });
const before = JSON.stringify(serial(prior)), cases = [];
const check = (name, fn) => { fn(); cases.push({ name, pass: true }); };
const candidate = prepareSourceNativeMap(input);

const owner = Object.fromEntries(createNativeFieldActorProjections(candidate, destination.definition.mapRange, catalog).map((a) => [a.id,a]));
const npcCandidate = prepareFieldNativeNpcGroup({ definitions: npcs, factory, characters,
  mapRange: destination.definition.mapRange, providers: input.providers, existingActorIds: Object.keys(owner),
  standbyAnchorPosition: fieldNativeNpcStandbyPosition(compileFieldNativeNpcStandby(corpus.manifest.sources)) });
for (const npc of npcCandidate.actors) {
  const actor = createNativeFieldActorProjection(npc, destination.definition.mapRange, catalog); owner[actor.id] = actor;
}
const context = { mapRange: destination.definition.mapRange, bindings: candidate.bindings, factory, partyCatalog: catalog,
  partyCheckpoint: plan.checkpoint, characters, npcs, providers: input.providers };
const asOwner = (actors) => Object.fromEntries(actors.map((a) => [a.id,a]));
const capture = (actors = owner) => captureFieldNativeCheckpoint(actors, context);
const initialSaved = capture();
check("55 source persistent actors and six real NPCs round-trip without initializing playback", () => {
  assert.equal(initialSaved.actors.length, 61);
  const restored = asOwner(restoreFieldNativeCheckpoint(JSON.parse(JSON.stringify(initialSaved)), context));
  assert.deepEqual(capture(restored), initialSaved);
  assert.equal(restored["native:party:0"].animation, null);
  assert.equal(restored["179"].animation.snapshot().key, "Default-S");
});
check("source stationary looping playback keeps elapsed state and future frame progression", () => {
  const source = owner[candidate.bindings.partyPuppets[0]];
  assert.equal(source.animation.playing, true);
  const restored = asOwner(restoreFieldNativeCheckpoint(capture(), context))[source.id];
  for (const delta of [10,43,600]) {
    source.animation.advance(delta); restored.animation.advance(delta);
    assert.deepEqual(restored.animation.snapshot(), source.animation.snapshot());
    assert.deepEqual(restored.animation.frame(), source.animation.frame());
  }
});
check("NPC runtime pose, hidden alpha and steps survive without replaying its activation", () => {
  const source = owner["179"]; source.x = 38.25; source.y = 47.5;
  source.native.entity.visible = false; source.native.entity.fadeAlpha = Math.fround(0.375); source.steps = 11;
  const restored = asOwner(restoreFieldNativeCheckpoint(capture(), context))[source.id];
  assert.equal(restored.x, 38.25); assert.equal(restored.y, 47.5); assert.equal(restored.steps, 11);
  assert.equal(restored.native.entity.visible, false); assert.equal(restored.native.entity.fadeAlpha, Math.fround(0.375));
  assert.deepEqual(restored.animation.snapshot(), source.animation.snapshot());
});
check("real hidden residents cannot be omitted, duplicated or given foreign media keys", () => {
  const raw = capture(), missing = structuredClone(raw); missing.actors.pop();
  assert.throws(() => restoreFieldNativeCheckpoint(missing, context), /identit/);
  const duplicate = structuredClone(raw); duplicate.actors.push(duplicate.actors[0]);
  assert.throws(() => restoreFieldNativeCheckpoint(duplicate, context), /identit/);
  const bad = structuredClone(raw), target = bad.actors.find((a) => a.id === candidate.bindings.residents[0].actor);
  target.animation = { ...bad.actors[0].animation, key: "__no_source_animation__" };
  assert.throws(() => restoreFieldNativeCheckpoint(bad, context), /Missing actor animation/);
});
check("saved source metadata and map-material forgery cannot authorize a provider", () => {
  const bad = capture(); bad.actors[0].fieldAssetId = 999;
  assert.throws(() => restoreFieldNativeCheckpoint(bad, context), /fields/);
  const foreign = capture(); foreign.actors[0].view.map = "f".repeat(64);
  assert.throws(() => restoreFieldNativeCheckpoint(foreign, context), /another map material/);
  const missing = { ...characters }; delete missing[owner["179"].asset];
  assert.throws(() => restoreFieldNativeCheckpoint(capture(), { ...context, characters: missing }), /source media/);
});
check("source materials are rebuilt while actor JSON only records their binding identity", () => {
  const raw = capture(), restored = asOwner(restoreFieldNativeCheckpoint(raw, context));
  assert.ok(raw.actors.filter((a) => a.view).every((a) => !Object.hasOwn(a.view,"properties")));
  for (const actor of Object.values(restored)) if (actor.native.entity.viewBinding)
    assert.deepEqual(actor.native.entity.viewBinding.properties, input.providers.applyViewProperties(actor.native.entity.layer));
});
check("moving native actor is rejected without altering actors or shared ownership", () => {
  const source = owner["179"], before = capture();
  source.motion = { from:{x:source.x,y:source.y},to:{x:source.x+1,y:source.y},elapsed:0,duration:120,manual:false };
  assert.throws(() => capture(), /moving/); source.motion = null;
  assert.deepEqual(capture(), before); assert.equal(JSON.stringify(state.snapshot()),ownedBefore);
});
const report = { kind:"field-native-checkpoint-source", sourceSetHash:corpus.sourceSetHash, contentHash,
  mapContentHash:destination.map.contentHash, nativeReceiptSha256:sha(receiptBytes), mediaSnapshotSha256:sha(mediaBytes),
  sourceMapId:fresh.entry.mapId, controlledDestinationMapId:destination.definition.mapId,
  counts:{cases:cases.length, persistentActors:55,mapNpcs:npcs.length, checkpointActors:initialSaved.actors.length,
    verifiedMediaAssets:mediaNames.length,verifiedSpriteFiles:checked.size,verifiedOriginalBundles:checkedBundles.size}, cases,
  originalGameExecuted:false,semanticsVerified:false,browserExecuted:false,formalGameSessionPublished:false,
  stableWebActorCodec:true,originalSaveFormatSupported:false,
  controlledInputs:["map-entry and NPC activation are pure candidates, not a reachable story run",
    "upper/ceiling RT are explicitly null; production FX/nonempty RT admission is not bypassed",
    "placed resident/puppet loop playback and NPC movement/alpha/steps are controlled mechanism values"],
  implementation: await Promise.all(["field-native-checkpoint", "field", "world-session", "game-session"].map(async (name) => ({
    file: `src/core/${name}.ts`, sha256: sha(await readFile(resolve(root, `src/core/${name}.ts`))),
    compiledSha256: sha(await readFile(resolve(compiled, `src/core/${name}.js`))),
  }))),
  webSchema: { field: "idle-field-v10", world: "idle-world-v10", game: 4 },
  remaining:["outer native field/world/session integration is exercised separately by native-checkpoint-integration.test.ts; this source probe publishes no GameSession",
    "browser persistence and original-game dynamic parity are independent acceptance lanes",
    "active motion/scripts/FX hosts and original-game save format are not implemented by this actor codec"] };
await writeFile(output, JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({result:"pass",...report.counts,formalGameSessionPublished:false,originalGameExecuted:false}));
