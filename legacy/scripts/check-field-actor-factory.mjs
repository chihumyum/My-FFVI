// Real source owners, map inputs and media. Standalone candidate/host projection,
// never a claim that GameSession has published this actor family or run the story.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { hash } = await module("compiler/content");
const { compileFieldActorFactory } = await module("compiler/field-actor-factory");
const { battleTableIndex } = await module("compiler/battle");
const { compileNewGame } = await module("compiler/new-game");
const { compileOrdinaryWeaponEffects } = await module("compiler/ordinary-weapon");
const { compileFieldActorView } = await module("compiler/field-actor-view");
const { compileFieldEntryContext } = await module("compiler/field-entry-context");
const { projectFieldActorView } = await module("core/field-actor-view");
const { createFreshFieldPartyActorCheckpoint, createFieldActorFactoryCandidate, fieldPuppetContextFromActors } = await module("core/field-actor-factory");
const { compilePartyActorCatalog } = await module("compiler/party-actors");
const { compileFieldPuppetActorCatalog, compileFieldPuppetScriptContext } = await module("compiler/field-puppet-actors");
const { projectFieldPuppetInitialization, projectFieldPuppetActorEntry, resolveFieldPuppetActor } = await module("core/field-puppet-actors");
const { projectFieldPuppetActorEffects } = await module("core/field-puppet-effects");
const { compileWorldCharacter } = await module("compiler/world");
const { createNewGame } = await module("core/new-game");
const { prepareMapPartyEntry } = await module("core/map-party-entry");
const { createFieldCameraState, fieldCameraCellToWorld, fieldCameraLayerFromLogical } = await module("core/field-camera");
const { GameState } = await module("core/game-state");
const output = root + "build/reports/field-actor-factory-check.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const nativeBytes = await readFile(root + "build/reports/field-actor-factory-native-check.json"), native = JSON.parse(nativeBytes);
assert.equal(native.kind, "field-actor-factory-native");
assert.equal(native.originalGameExecuted, false); assert.equal(native.semanticsVerified, false);
assert.equal(sha(await readFile(root + "build/runtime/game/GameAssembly.dll")), native.nativeSha256);
const corpus = await loadCorpus(root), battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
assert.equal(battle.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const miscRows = Object.values(battle.assets).filter((a) => a.source.assetPath === "Assets/GameAssets/Serial/Data/Misc/serial_misc_assets.json");
assert.equal(miscRows.length, 1); const misc = miscRows[0];
const factory = compileFieldActorFactory(corpus.manifest.sources), partyCatalog = compilePartyActorCatalog(corpus.tables, misc.data).catalog;
const catalog = compileFieldPuppetActorCatalog(misc.data);
const published = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
const { contentHash, ...publishedBody } = published; assert.equal(hash(publishedBody), contentHash);
const field = JSON.parse(snapshotFile(await readSnapshot(root + "build/field"), "field.json"));
assert.equal(field.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const reader = () => battleTableIndex(corpus.tables, battle.tableSources);
const extra = corpus.assets.filter((a) => a.source.assetPath === "Assets/GameAssets/Serial/Data/BattleExtraData/battle_extra_data.json");
assert.equal(extra.length, 1);
const effects = compileOrdinaryWeaponEffects(reader(), extra[0].data).catalog;
const definition = compileNewGame(reader(), corpus.tables, (key) => {
  const value = field.messages.system_zhc[key]; assert.equal(typeof value, "string"); return value;
}, effects).definition;
assert.deepEqual(published.gameState.sourceNewGame, definition);
const state = GameState.createNewGame(published.gameState, published.common.players, contentHash, published.common.conditions);
const owned = state.snapshot(), ownedBefore = JSON.stringify(owned), fresh = createNewGame(published.gameState.sourceNewGame);
assert.deepEqual(owned.roster.map((r) => r.sourceId), [1, 31, 32]);
assert.ok(owned.roster.every((r) => r.conditionIds.length === 0));
const party = state.fieldPartyAppearance.current();
const map = JSON.parse(await readFile(root + `build/world/maps/${fresh.entry.mapId}.json`, "utf8"));
const { contentHash: mapHash, ...mapBody } = map; assert.equal(hash(mapBody), mapHash);
assert.equal(map.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
assert.equal(fresh.entry.mapId, 609); assert.equal(fresh.entry.entrance, 1);
assert.deepEqual(map.partyEntry.pointIns.map((p) => [p.id, p.x, p.y, p.layer, p.direction]), [[1, 26, 7, 0, "up"]]);
const one = (suffix) => { const list = corpus.assets.filter((a) => a.source.assetPath.endsWith(suffix)); assert.equal(list.length, 1, suffix); return list[0]; };
const tilemap = one("/Map_40037/Map_40037/tilemap.json"), mapPackage = one("/Map_40037/package.json");
const view = compileFieldActorView(corpus.manifest.sources, tilemap, mapPackage, map.partyEntry.mapRange);
assert.deepEqual(mapPackage.data.texture.map((t) => t.name), ["Map_event"]);
const initial = createFreshFieldPartyActorCheckpoint({ factory, catalog: partyCatalog, fresh, party, map: map.partyEntry, playerId: "-1001" });
assert.equal(initial.context.leaderIndex, -1); assert.equal(initial.playerAssetCacheId, null);
assert.deepEqual(initial.context.puppets.map((p) => p.fieldAssetId), [1, 31, 31, 1]);
assert.equal(initial.context.conditionResidents.length, 47);
const entry = prepareMapPartyEntry(partyCatalog, { definition: map.partyEntry, entrance: fresh.entry.entrance,
  mapViewType: fresh.entry.viewType, prior: initial, playerVisible: true, party, transportation: fresh.entry.transportation,
  canPartySwitching: fresh.events.scenario[2 * 256 + 45] === 1 });
assert.equal(fresh.events.scenario[2 * 256 + 45], 0);
assert.equal(entry.checkpoint.context.player.fieldAssetId, 1); assert.equal(entry.checkpoint.playerAssetCacheId, 1);
const mediaBytes = await readFile(root + "build/world-media/media.json"), media = JSON.parse(mediaBytes);
const mediaSnapshot = JSON.parse(await readFile(root + "build/world-media/snapshot.json", "utf8"));
assert.equal(mediaSnapshot.files.find((f) => f.file === "media.json").sha256, sha(mediaBytes));
assert.equal(media.parentSourceSetHash, corpus.sourceSetHash); assert.equal(hash(media.sources), media.sourceSetHash);
const checked = new Set(), characters = {}, mediaIssues = [];
for (const asset of Object.values(partyCatalog.assets)) {
  const raw = media.characters[asset.asset]; assert.ok(raw, asset.asset);
  assert.equal(corpus.manifest.sources.find((s) => s.file === raw.animation.source.file).sha256, raw.animation.source.sha256);
  const result = compileWorldCharacter(raw, (file, digest) => {
    assert.ok(!file.includes("..") && file.startsWith("sprites/"));
    if (!checked.has(file)) {
      assert.equal(sha(readFileSync(root + "build/world-media/" + file)), digest);
      assert.equal(mediaSnapshot.files.find((f) => f.file === file).sha256, digest); checked.add(file);
    }
  });
  characters[asset.asset] = result.character;
  if (result.issues.length) mediaIssues.push({ fieldAssetId: asset.id, issues: result.issues });
}
const camera = createFieldCameraState();
const foot = compileFieldEntryContext(corpus.assets, corpus.tables, fresh.entry.mapId).foot;
assert.equal(foot.kind, "uniform-zero"); assert.equal(foot.basis, "no-attribute-asset");
const providers = { mapRenderContext: view.contextId, transportationType: fresh.entry.transportation.type,
  // 2df5f0 reads MapModel.attribute directly; with no AttributeAssetLoad it
  // retains its local footAttribute=0. This is distinct from CheckBeast timing.
  footAttribute: () => 0, upperTexture: null, ceilTexture: null,
  applyViewProperties: (layer) => projectFieldActorView(view, layer) };
const input = { factory, partyCatalog, checkpoint: entry.checkpoint, characters,
  player: { position: fieldCameraCellToWorld(map.partyEntry.mapRange, { x: entry.player.x, y: entry.player.y }, entry.player.layer),
    layer: fieldCameraLayerFromLogical(entry.player.layer).layer, direction: entry.player.direction, visible: entry.player.visible },
  camera: { id: "native:camera:0", position: camera.dummy.position, layer: camera.dummy.layer }, providers };
const candidate = createFieldActorFactoryCandidate(input);
assert.equal(candidate.snapshot.actors.length, 55);
assert.deepEqual(candidate.snapshot.actors[0].position, { x: 88, y: 136, z: 349 });
assert.deepEqual(candidate.assets.map((a) => a.fieldAssetId).slice(0, 8), [1, 1, 31, 31, 1, null, null, null]);
for (const actor of candidate.snapshot.actors.slice(1)) {
  assert.deepEqual(actor.position, { x: 30000, y: 1000, z: -1000 }); assert.equal(actor.layer, 0);
  assert.equal(actor.direction, null); assert.equal(actor.animation?.snapshot() ?? null, null);
  assert.equal(actor.visible, actor.id.startsWith("native:resident:"));
}
const cells = owned.party.slots[owned.party.selectedSlot], corps = cells.map((c) => c.id === null ? 0 : owned.roster.find((r) => r.id === c.id).ownedId);
const read = (snapshot) => fieldPuppetContextFromActors({ catalog, checkpoint: entry.checkpoint, bindings: candidate.bindings, snapshot,
  owned: owned.roster.map((r) => ({ ownedId: r.ownedId, sourceId: r.sourceId, enabled: r.enabled,
    conditionTypes: r.conditionIds.map((id) => partyCatalog.conditionTypes[id]) })), party: corps,
  entities: [], restorePartyInstruction: "absent" });
const context = read(candidate.snapshot), sourceScript = one("/Map_40037/Map_40037/sc_e_0001.json");
const script = compileFieldPuppetScriptContext(sourceScript.data, misc.data);
assert.equal(resolveFieldPuppetActor(catalog, context, -1001).actor, "native:puppet:0");
assert.notEqual(context.player, "native:puppet:0");
const serial = (snapshot) => ({ camera: snapshot.camera, actors: snapshot.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() ?? null })) });
const before = serial(candidate.snapshot);
const start = projectFieldPuppetInitialization({ catalog, context, script, phase: "start" });
const started = projectFieldPuppetActorEffects(start.effects, candidate.snapshot, providers);
const actorEntry = projectFieldPuppetActorEntry({ catalog, context: read(started), script, entityId: -1001,
  nextMnemonic: "Move", leaderId: start.leaderId, assignments: start.assignments });
const entered = projectFieldPuppetActorEffects(actorEntry.effects, started, providers);
const finish = projectFieldPuppetInitialization({ catalog, context: read(entered), script, phase: "finish" });
const finished = projectFieldPuppetActorEffects(finish.effects, entered, providers);
assert.deepEqual(serial(candidate.snapshot), before);
assert.equal(finished.actors.find((a) => a.id === "-1001").visible, true);
assert.equal(finished.actors.find((a) => a.id === "native:puppet:0").visible, false);
assert.equal(started.actors.find((a) => a.id === "native:puppet:0").viewBinding.properties.renderLayer, 0);
const missing = { ...characters }; delete missing[partyCatalog.assets[47]?.asset ?? Object.values(partyCatalog.assets).at(-1).asset];
assert.throws(() => createFieldActorFactoryCandidate({ ...input, characters: missing }), /media/);
assert.equal(JSON.stringify(state.snapshot()), ownedBefore);
const report = { kind: "field-actor-factory-source", sourceSetHash: corpus.sourceSetHash, contentHash,
  nativeReceiptSha256: sha(nativeBytes), freshMapId: fresh.entry.mapId, pointIn: map.partyEntry.pointIns[0],
  counts: { actors: candidate.snapshot.actors.length, partyPuppets: candidate.bindings.partyPuppets.length,
    otherParties: candidate.bindings.otherParties.length, residents: candidate.bindings.residents.length, verifiedSpriteFiles: checked.size },
  actors: serial(candidate.snapshot).actors, material: view, mediaIssues,
  lifecycle: { scriptSource: sourceScript.source, script, start, entry: actorEntry, finish },
  controlledLifecycleProbe: "start/entry(-1001, Move)/finish exercises the real source planner; not execution of the story's instruction sequence",
  controlledProviders: ["upperTexture=null and ceilTexture=null are bounded renderer inputs; the native camera render-target lifecycle is not proved by missing map layers"],
  originalGameExecuted: false, formalSessionPublished: false, gpuShaderParity: false,
  remaining: ["GameSession publication/save/battle-return ownership adapter", "Canvas consumption of native default material input projection",
    "Water/palette/custom shaders, mounted and companion factory/lifecycle branches"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.counts, lifecycleEffects: [start.effects.length, actorEntry.effects.length, finish.effects.length],
  formalSessionPublished: false, gpuShaderParity: false, originalGameExecuted: false }));
