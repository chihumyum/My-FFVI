// Source-backed ownership integration. Shader parity and formal story execution
// are separate lanes; transparent RT inputs below remain explicitly controlled.
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
const { compileFieldActorFactory } = await module("compiler/field-actor-factory");
const { compilePartyActorCatalog } = await module("compiler/party-actors");
const { compileFieldActorView } = await module("compiler/field-actor-view");
const { compileFieldEntryContext } = await module("compiler/field-entry-context");
const { compileFieldPuppetActorCatalog, compileFieldPuppetScriptContext } = await module("compiler/field-puppet-actors");
const { compileWorldCharacter } = await module("compiler/world");
const { createNewGame } = await module("core/new-game");
const { GameState } = await module("core/game-state");
const { createFreshFieldPartyActorCheckpoint, createFieldActorFactoryCandidate } = await module("core/field-actor-factory");
const { prepareMapPartyEntry } = await module("core/map-party-entry");
const { fieldCameraCellToWorld, fieldCameraLayerFromLogical } = await module("core/field-camera");
const { projectFieldActorView } = await module("core/field-actor-view");
const { createNativeFieldActorProjections, readNativeFieldActors, createNativeFieldPuppetActorsPort } = await module("core/field-native-actors");
const { projectFieldPuppetInitialization, projectFieldPuppetActorEntry, resolveFieldPuppetActor } = await module("core/field-puppet-actors");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const output = root + "build/reports/field-native-actors-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const receiptBytes = await readFile(root + "build/reports/field-actor-factory-native-check.json"), receipt = JSON.parse(receiptBytes);
assert.equal(receipt.kind, "field-actor-factory-native"); assert.equal(receipt.originalGameExecuted, false);
assert.equal(sha(await readFile(root + "build/runtime/game/GameAssembly.dll")), receipt.nativeSha256);
const corpus = await loadCorpus(root), battle = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
assert.equal(battle.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const unique = (assets, suffix) => {
  const rows = Object.values(assets).filter((a) => a.source.assetPath.endsWith(suffix));
  assert.equal(rows.length, 1, suffix); return rows[0];
};
const misc = unique(battle.assets, "/Misc/serial_misc_assets.json");
const partyCatalog = compilePartyActorCatalog(corpus.tables, misc.data).catalog;
const catalog = compileFieldPuppetActorCatalog(misc.data), factory = compileFieldActorFactory(corpus.manifest.sources);
const content = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
const { contentHash, ...body } = content; assert.equal(hash(body), contentHash);
const state = GameState.createNewGame(content.gameState, content.common.players, contentHash, content.common.conditions);
const fresh = createNewGame(content.gameState.sourceNewGame), party = state.fieldPartyAppearance.current();
assert.equal(fresh.entry.mapId, 609); assert.equal(fresh.entry.entrance, 1);
assert.deepEqual(state.fieldPuppetRoster.current().owned.map((r) => r.sourceId), [1, 31, 32]);
assert.ok(state.fieldPuppetRoster.current().owned.every((r) => r.conditionTypes.length === 0));
const ownedBefore = JSON.stringify(state.snapshot());
const map = JSON.parse(await readFile(root + `build/world/maps/${fresh.entry.mapId}.json`, "utf8"));
const { contentHash: mapHash, ...mapBody } = map; assert.equal(hash(mapBody), mapHash);
assert.equal(map.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
const view = compileFieldActorView(corpus.manifest.sources, unique(corpus.assets, "/Map_40037/Map_40037/tilemap.json"),
  unique(corpus.assets, "/Map_40037/package.json"), map.partyEntry.mapRange);
const initial = createFreshFieldPartyActorCheckpoint({ factory, catalog: partyCatalog, fresh, party, map: map.partyEntry, playerId: "-1001" });
const entry = prepareMapPartyEntry(partyCatalog, { definition: map.partyEntry, entrance: fresh.entry.entrance,
  mapViewType: fresh.entry.viewType, prior: initial, playerVisible: true, party, transportation: fresh.entry.transportation,
  canPartySwitching: fresh.events.scenario[2 * 256 + 45] === 1 });
const mediaBytes = await readFile(root + "build/world-media/media.json"), media = JSON.parse(mediaBytes);
const manifest = JSON.parse(await readFile(root + "build/world-media/snapshot.json", "utf8"));
assert.equal(manifest.files.find((f) => f.file === "media.json").sha256, sha(mediaBytes));
assert.equal(media.parentSourceSetHash, corpus.sourceSetHash); assert.equal(hash(media.sources), media.sourceSetHash);
const checked = new Set(), characters = {};
for (const asset of Object.values(partyCatalog.assets)) {
  const raw = media.characters[asset.asset]; assert.ok(raw);
  assert.equal(corpus.manifest.sources.find((s) => s.file === raw.animation.source.file).sha256, raw.animation.source.sha256);
  characters[asset.asset] = compileWorldCharacter(raw, (file, digest) => {
    assert.ok(file.startsWith("sprites/") && !file.includes(".."));
    if (checked.has(file)) return;
    assert.equal(sha(readFileSync(root + "build/world-media/" + file)), digest);
    assert.equal(manifest.files.find((f) => f.file === file).sha256, digest); checked.add(file);
  }).character;
}
const foot = compileFieldEntryContext(corpus.assets, corpus.tables, fresh.entry.mapId).foot;
assert.equal(foot.kind, "uniform-zero"); assert.equal(foot.basis, "no-attribute-asset");
const providers = { mapRenderContext: view.contextId, transportationType: fresh.entry.transportation.type,
  footAttribute: () => 0, upperTexture: null, ceilTexture: null,
  applyViewProperties: (layer) => projectFieldActorView(view, layer) };
const candidate = createFieldActorFactoryCandidate({ factory, partyCatalog, checkpoint: entry.checkpoint, characters, providers,
  player: { position: fieldCameraCellToWorld(map.partyEntry.mapRange, { x: entry.player.x, y: entry.player.y }, entry.player.layer),
    layer: fieldCameraLayerFromLogical(entry.player.layer).layer, direction: entry.player.direction, visible: entry.player.visible },
  camera: { id: "native:camera", position: { x: 0, y: 0, z: 0 }, layer: 0 } });
const actors = Object.fromEntries(createNativeFieldActorProjections(candidate, map.partyEntry.mapRange, partyCatalog).map((a) => [a.id, a]));
assert.equal(Object.keys(actors).length, 55);
assert.deepEqual({ x: actors["-1001"].x, y: actors["-1001"].y, layer: actors["-1001"].layer }, { x: 26, y: 7, layer: 0 });
assert.deepEqual(actors["-1001"].native.entity.position, { x: 88, y: 136, z: 349 });
assert.ok(Object.values(actors).slice(1).every((a) => a.direction === null && a.layer === null));
const identities = Object.fromEntries(Object.values(actors).map((a) => [a.id, { actor: a, entity: a.native.entity }]));
let camera = structuredClone(candidate.snapshot.camera), collision = true;
const read = () => readNativeFieldActors(actors, camera);
const port = createNativeFieldPuppetActorsPort({ readActors: () => actors, readProviders: () => providers, readCamera: () => camera,
  readContext: () => ({ catalog, checkpoint: entry.checkpoint, bindings: candidate.bindings, ...state.fieldPuppetRoster.current(),
    entities: [], restorePartyInstruction: "absent" }),
  prepareCamera: (next) => { const copy = structuredClone(next); return () => { camera = copy; }; },
  controlContext: () => ({ worldMapScript: false, callback: "absent" }),
  prepareCollision: (enabled) => () => { collision = enabled; } });
const serial = (snapshot) => ({ camera: snapshot.camera, actors: snapshot.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() ?? null })) });
const before = JSON.stringify(serial(read()));
const script = compileFieldPuppetScriptContext(unique(corpus.assets, "/Map_40037/Map_40037/sc_e_0001.json").data, misc.data);
const start = projectFieldPuppetInitialization({ ...port.read(), script, phase: "start" });
const publishStart = port.prepare(start);
assert.equal(JSON.stringify(serial(read())), before); publishStart();
assert.equal(resolveFieldPuppetActor(catalog, port.read().context, -1001).actor, "native:puppet:0");
assert.notEqual(actors["-1001"], actors["native:puppet:0"]);
const actorEntry = projectFieldPuppetActorEntry({ ...port.read(), script, entityId: -1001,
  nextMnemonic: "Move", leaderId: start.leaderId, assignments: start.assignments });
port.prepare(actorEntry)();
assert.equal(actors["-1001"].native.entity.visible, false);
// Explicit controlled movement after source alias binding. This does not claim
// the story's next instruction moved one tile in this direction.
actors["native:puppet:0"].x = 27.25;
assert.equal(actors["native:puppet:0"].native.entity.position.x, 108);
const finish = projectFieldPuppetInitialization({ ...port.read(), script, phase: "finish" }); port.prepare(finish)();
assert.equal(actors["-1001"].x, 27.25); assert.equal(actors["-1001"].layer, 0);
assert.equal(actors["-1001"].native.entity.visible, true);
assert.equal(actors["native:puppet:0"].native.entity.visible, false);
for (const [id, ref] of Object.entries(identities)) {
  assert.equal(actors[id], ref.actor); assert.equal(actors[id].native.entity, ref.entity);
  assert.equal(actors[id].animation, actors[id].native.entity.animation);
}
const beforeFailure = JSON.stringify(serial(read()));
assert.throws(() => port.prepare({ leaderId: null, assignments: null, effects: [
  { kind: "hide", actor: "-1001" }, { kind: "look", actor: "native:party:0", from: "-1001" },
] }), /media/);
assert.equal(JSON.stringify(serial(read())), beforeFailure);
const pending = port.prepare({ leaderId: null, assignments: null, effects: [{ kind: "hide", actor: "-1001" }] });
actors["-1001"].x = 28;
assert.throws(pending, /Stale/); assert.equal(actors["-1001"].native.entity.visible, true);
const collisionCommit = port.prepareCollision(false); assert.equal(collision, true); collisionCommit(); assert.equal(collision, false);
assert.equal(JSON.stringify(state.snapshot()), ownedBefore);
const report = { kind: "field-native-actors-source", sourceSetHash: corpus.sourceSetHash, contentHash,
  nativeReceiptSha256: sha(receiptBytes), mapId: fresh.entry.mapId, counts: { actors: 55, sourceSprites: checked.size,
    startEffects: start.effects.length, entryEffects: actorEntry.effects.length, finishEffects: finish.effects.length },
  ownerIdentityPreserved: true, nativeEntityIdentityPreserved: true, sourceOwnedReadUsed: true,
  atomicMissingMedia: true, staleCommitRejected: true, singleCameraOwner: true,
  controlledProviders: ["renderer upper/ceiling textures are explicitly null", "camera and collision commits use isolated host ports",
    "restore-party and Exec callback absent are controlled lifecycle inputs", "one-tile/subcell movement is a lifecycle mechanism probe"],
  originalGameExecuted: false, formalGameSessionPublished: false, gpuShaderParity: false, stableNativeSaveSupported: false };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.counts, ownerIdentityPreserved: true,
  formalGameSessionPublished: false, gpuShaderParity: false }));
