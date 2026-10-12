// Source packages and real media through the detached map candidate. Renderer
// inputs are explicitly controlled; this is not a story or browser playthrough.
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
const { prepareNativeFieldProviders } = await module("core/field-native-providers");
const { readFieldNativeFoot } = await module("core/field-native-foot");
const { createNativeFieldActorProjections } = await module("core/field-native-actors");
const { projectFieldPuppetActorEffects } = await module("core/field-puppet-effects");
const { prepareSourceNativeMap } = await module("core/source-native-map");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const output = root + "build/reports/source-native-map-check.json";
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
const checked = new Set(), characters = {};
for (const asset of Object.values(catalog.assets)) {
  const raw = media.characters[asset.asset]; assert.ok(raw);
  assert.equal(corpus.manifest.sources.find((s) => s.file === raw.animation.source.file).sha256, raw.animation.source.sha256);
  characters[asset.asset] = compileWorldCharacter(raw, (file, digest) => {
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
check("all 55 persistent identities survive without fresh-factory recreation", () => {
  assert.deepEqual(candidate.bindings, prior.bindings); assert.equal(candidate.snapshot.actors.length, 55);
  assert.deepEqual(candidate.assets.slice(1), prior.assets.slice(1));
});
check("controlled placed resident and puppet retain pose/playback while party puppets hide", () => {
  for (const priorActor of [puppet, resident]) {
    const after = candidate.snapshot.actors.find((a) => a.id === priorActor.id);
    assert.deepEqual(after.position, priorActor.position); assert.equal(after.layer, priorActor.layer);
    assert.deepEqual(after.animation.snapshot(), priorActor.animation.snapshot());
    assert.equal(after.visible, false); assert.equal(after.viewBinding.map, destination.view.contextId);
  }
});
check("source destination PointIn initializes only actual player and preserves hidden visibility", () => {
  const actors = createNativeFieldActorProjections(candidate, destination.definition.mapRange, catalog);
  const player = actors.find((a) => a.id === candidate.bindings.player);
  assert.equal(player.x, 38); assert.equal(player.y, 61); assert.equal(player.layer, 1);
  assert.equal(player.direction, "up"); assert.equal(player.native.entity.visible, false);
  assert.equal(player.native.charaZOffset, 0.5);
  const oldPlayer = prior.snapshot.actors.find((actor) => actor.id === prior.bindings.player);
  assert.equal(oldPlayer.animation.snapshot().key, "WalkB"); assert.equal(oldPlayer.animation.playing, false);
  // Re-cueing an already selected, stopped source key follows its authored
  // next key (WalkB-S in this media); a fresh animation owner would miss it.
  assert.equal(player.animation.snapshot().key, characters[plan.player.asset].animations.WalkB.next || "WalkB");
  assert.equal(player.animation.playing, false);
  assert.deepEqual(candidate.snapshot.camera, prior.snapshot.camera);
});
check("source condition607 keeps ordinary walking media without inventing a transportation or refreshing puppets", () => {
  const magitekRows = Object.entries(catalog.conditionTypes).filter(([, type]) => type === 607);
  assert.equal(magitekRows.length, 1);
  const projected = structuredClone(party);
  projected.activeMembers.forEach((m) => m.conditionIds.push(Number(magitekRows[0][0])));
  projected.parties[0].forEach((m) => { if (!m.conditionIds.includes(Number(magitekRows[0][0]))) m.conditionIds.push(Number(magitekRows[0][0])); });
  const conditioned = prepareMapPartyEntry(catalog, { definition: destination.definition, entrance: sourceOp.operands.iValues[1],
    mapViewType: 0, prior: entry.checkpoint, playerVisible: false, party: projected,
    transportation: fresh.entry.transportation, canPartySwitching: false });
  const next = prepareSourceNativeMap({ ...input, entry: conditioned, party: projected });
  assert.equal(next.assets.find((a) => a.id === next.bindings.player).fieldAssetId,
    entry.checkpoint.context.player.fieldAssetId);
  assert.equal(next.snapshot.actors.find((a) => a.id === next.bindings.player).riding, false);
  assert.deepEqual(next.assets.slice(1), prior.assets.slice(1));
});
check("source same-direction PointIn retains controlled stationary playback through ordered player media replacements", () => {
  const controlled = { ...prior, snapshot: projectFieldPuppetActorEffects([], prior.snapshot, input.providers) };
  const oldPlayer = controlled.snapshot.actors.find((actor) => actor.id === controlled.bindings.player);
  oldPlayer.animation.play("WalkB", true, 1); oldPlayer.animation.advance(191);
  const oldPlayback = oldPlayer.animation.snapshot();
  const next = prepareSourceNativeMap({ ...input, prior: controlled });
  const playback = next.snapshot.actors.find((actor) => actor.id === next.bindings.player).animation.snapshot();
  assert.equal(plan.player.direction, "up"); assert.equal(playback.key, "WalkB");
  assert.equal(playback.playing, true); assert.equal(playback.elapsed, oldPlayback.elapsed);
  assert.deepEqual(oldPlayer.animation.snapshot(), oldPlayback);
});
check("native actor candidate is detached and cannot mutate departed owned, pose or playback state", () => {
  assert.equal(JSON.stringify(serial(prior)), before); assert.equal(JSON.stringify(state.snapshot()), ownedBefore);
  candidate.snapshot.actors.find((a) => a.id === resident.id).animation.advance(31);
  assert.equal(JSON.stringify(serial(prior)), before);
});
check("unknown foot, missing media and active movement reject without partial publication", () => {
  assert.throws(() => prepareSourceNativeMap({ ...input, providers: { ...input.providers, footAttribute: () => null } }), /Unknown/);
  const missing = { ...characters }; delete missing[catalog.assets[entry.checkpoint.context.player.fieldAssetId].asset];
  assert.throws(() => prepareSourceNativeMap({ ...input, characters: missing }), /media/);
  const changed = { ...prior, snapshot: { ...prior.snapshot, actors: prior.snapshot.actors.map((a) => a.id === puppet.id ? { ...a, moving: true } : a) } };
  assert.throws(() => prepareSourceNativeMap({ ...input, prior: changed }), /Active movement/);
  assert.equal(JSON.stringify(serial(prior)), before);
});
let productionProviderBlocker = null;
check("actual destination provider binds source raw foot and the newly published nonempty render targets", () => {
  const field = { content: { cameraHost: destination.map.cameraHost, map: destination.map.map }, partyActorCheckpoint: plan.checkpoint };
  const bound = prepareNativeFieldProviders(field, destination.view, destination.map.nativeFoot)();
  assert.equal(destination.foot.basis, "default-monster-set");
  assert.equal(destination.nativeFoot.basis, "package-attribute-absent");
  assert.equal(readFieldNativeFoot(destination.map.nativeFoot, { x: 10, y: -20, z: 200 }), 0);
  assert.ok(destination.map.map.layers.some((layer) => ["UpperLayer", "CeilLayer"].includes(layer.name) && layer.data.some((id) => id !== 0)));
  assert.equal(bound.composition.renderHost.width, 320); assert.equal(bound.composition.renderHost.height, 180);
  assert.equal(bound.upperTexture, `native-field-rt:${destination.view.contextId}:UpperLayer`);
  assert.equal(bound.ceilTexture, `native-field-rt:${destination.view.contextId}:CeilLayer`);
  assert.deepEqual(bound.composition.renderTargets, { upper: "source-rendered", ceil: "source-rendered" });
});
check("nonempty destination layers cannot discard their source composition provider", () => {
  const map = structuredClone(destination.map.map); delete map.nativeComposition;
  const field = { content: { cameraHost: destination.map.cameraHost, map }, partyActorCheckpoint: plan.checkpoint };
  assert.throws(() => prepareNativeFieldProviders(field, destination.view, destination.map.nativeFoot), /upper\/ceiling composition is unresolved/);
});
check("missing or another-map native foot cannot inherit the encounter default-monster-set result", () => {
  const field = { content: { cameraHost: destination.map.cameraHost, map: destination.map.map }, partyActorCheckpoint: plan.checkpoint };
  assert.throws(() => prepareNativeFieldProviders(field, destination.view, undefined), /foot provider is unresolved/);
  assert.throws(() => prepareNativeFieldProviders(field, destination.view, start.map.nativeFoot), /another source map/);
});
const report = { kind: "source-native-map-source", sourceSetHash: corpus.sourceSetHash, contentHash,
  nativeReceiptSha256: sha(receiptBytes), sourceRoute: { source: script.source, script: script.data.Name, index: 19,
    mapId: sourceOp.operands.iValues[0], entrance: sourceOp.operands.iValues[1], continuation: sourceOp.operands.sValues[0] },
  maps: [start, destination].map((m) => ({ mapId: m.map.mapId, contentHash: m.map.contentHash,
    definitionHash: hash(m.definition), viewContextId: m.view.contextId, encounterFoot: m.foot, nativeFoot: m.nativeFoot })),
  counts: { cases: cases.length, persistentActors: 55, residents: prior.bindings.residents.length,
    hiddenPartyActors: plan.hiddenActorIds.length, verifiedSpriteFiles: checked.size }, cases,
  productionProviderBlocker, originalGameExecuted: false, semanticsVerified: false,
  formalMapPublished: false, browserExecuted: false, gpuShaderParity: false,
  controlledInputs: ["Resident and puppet poses/playback are controlled mutations on genuine source-created actors",
    "Destination upper/ceiling RTs=null test the pure candidate; they are not production render providers for map3",
    "Condition607 case projects a source-valid party candidate without executing or mutating the story/owned state"],
  remaining: ["Production source map3 particle and shared-pool map lifecycle", "Full map-local NPC controller lifecycle",
    "Mounted/retained-rider, companion and active motion; stable Web saves are checked separately"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.counts, productionProviderBlocker,
  formalMapPublished: false, originalGameExecuted: false }));
