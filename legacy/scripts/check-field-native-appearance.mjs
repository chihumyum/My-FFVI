// Real source command, owned initializer, assets and native actor owner. This
// probe executes the command directly; title/story timing is checked separately.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { verifyContent } = await module("core/content-integrity");
const { canonical } = await module("core/canonical");
const { GameState } = await module("core/game-state");
const { createNewGame } = await module("core/new-game");
const { compileFieldNativeAnimationKeys } = await module("compiler/field-native-appearance");
const { createFreshFieldPartyActorCheckpoint, createFieldActorFactoryCandidate } = await module("core/field-actor-factory");
const { createNativeFieldActorProjections } = await module("core/field-native-actors");
const { prepareNativeFieldActorAppearance } = await module("core/field-native-appearance");
const { projectFieldActorView } = await module("core/field-actor-view");
const { prepareMapPartyEntry } = await module("core/map-party-entry");
const { FieldPartyActors } = await module("core/field-party-actors");
const { executeOwnedConditionEvent } = await module("core/owned-condition");
const { createFieldCameraState, fieldCameraCellToWorld, fieldCameraLayerFromLogical } = await module("core/field-camera");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = root + "build/reports/field-native-appearance-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const packages = [];
const load = async (file, expected) => {
  const bytes = await readFile(root + file), value = await verifyContent(JSON.parse(bytes), expected);
  packages.push({ file, contentHash: value.contentHash, sha256: sha(bytes) }); return value;
};
const content = await load("build/game/source-new-game.json");
const battle = await load("build/game/source-catalog.json", content.battleCatalogHash);
const world = await load("build/world/catalog.json", content.worldCatalogHash);
const map = await load(`build/world/maps/${content.entry.mapId}.json`, content.mapContentHash);
assert.equal(map.sourceSetHash, world.sourceSetHash); assert.equal(content.sourceSetHash, world.sourceSetHash);
assert.equal(map.parentSourceSetHash, content.parentSourceSetHash);
const nativeBytes = await readFile(root + "build/reports/field-native-appearance-native-check.json"), native = JSON.parse(nativeBytes);
assert.equal(native.kind, "field-native-appearance-native"); assert.equal(native.originalGameExecuted, false);
assert.equal(sha(await readFile(root + "build/runtime/game/GameAssembly.dll")), native.nativeSha256);
const mediaBytes = await readFile(root + "build/world-media/media.json"), media = JSON.parse(mediaBytes);
const snapshot = JSON.parse(await readFile(root + "build/world-media/snapshot.json", "utf8"));
assert.equal(snapshot.files.find((f) => f.file === "media.json").sha256, sha(mediaBytes));
assert.equal(world.mediaSourceSetHash, media.sourceSetHash);
assert.equal(media.parentSourceSetHash, world.sourceSetHash);
const catalog = battle.gameState.partyActors, keys = compileFieldNativeAnimationKeys(catalog, media.characters);
assert.deepEqual(world.nativeAnimationKeys, keys, "Published world must carry the complete independently compiled source key index");
assert.deepEqual(content.animationKeys, keys, "The source new-game binding must carry that same complete index");
const verifiedSprites = new Set();
for (const asset of Object.values(catalog.assets)) {
  const character = world.characters[asset.asset]; assert.ok(character, asset.asset);
  assert.deepEqual(character.source, keys.assets[asset.asset].source);
  for (const sprite of Object.values(character.sprites)) {
    assert.ok(sprite.file.startsWith("/world-media/sprites/") && !sprite.file.includes(".."));
    if (verifiedSprites.has(sprite.file)) continue;
    assert.equal(sha(await readFile(root + "build" + sprite.file)), sprite.sha256);
    const file = sprite.file.slice("/world-media/".length);
    assert.equal(snapshot.files.find((f) => f.file === file).sha256, sprite.sha256);
    verifiedSprites.add(sprite.file);
  }
}
const program = map.scripts[content.entry.reservedScript.name], op = program[18];
assert.equal(content.entry.reservedScript.name, "sc_e_0001");
assert.equal(op.kind, "owned-condition"); assert.equal(op.source.pointer, "/Mnemonics/18");
assert.deepEqual(op.command, { kind: "add-condition", conditionType: 607, target: 0 });
assert.equal(catalog.conditionTypes[53], 607);
assert.ok(!catalog.conditionChanges.some((c) => c.type === 607), "607 itself is not a source field appearance substitute");
const serial = (owner) => Object.values(owner).map((actor) => ({ id: actor.id, fieldAssetId: actor.native.fieldAssetId,
  charaZOffset: actor.native.charaZOffset, ...actor.native.entity, animation: actor.animation?.snapshot() ?? null }));
function setup() {
  const state = GameState.createNewGame(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
  const fresh = createNewGame(battle.gameState.sourceNewGame), party = state.fieldPartyAppearance.current();
  const initial = createFreshFieldPartyActorCheckpoint({ factory: content.factory, catalog, fresh, party, map: map.partyEntry, playerId: "-1001" });
  const entry = prepareMapPartyEntry(catalog, { definition: map.partyEntry, entrance: fresh.entry.entrance,
    mapViewType: fresh.entry.viewType, prior: initial, playerVisible: true, party, transportation: fresh.entry.transportation,
    canPartySwitching: fresh.events.scenario[2 * 256 + 45] === 1 });
  assert.equal(map.map.entryContext.foot.kind, "uniform-zero");
  const providers = { mapRenderContext: content.view.contextId, transportationType: fresh.entry.transportation.type,
    footAttribute: () => 0, upperTexture: null, ceilTexture: null,
    applyViewProperties: (layer) => projectFieldActorView(content.view, layer) };
  const characters = { ...world.characters };
  const camera = createFieldCameraState();
  const candidate = createFieldActorFactoryCandidate({ factory: content.factory, partyCatalog: catalog,
    checkpoint: entry.checkpoint, characters,
    player: { position: fieldCameraCellToWorld(map.partyEntry.mapRange, { x: entry.player.x, y: entry.player.y }, entry.player.layer),
      layer: fieldCameraLayerFromLogical(entry.player.layer).layer, direction: entry.player.direction, visible: entry.player.visible },
    camera: { id: "native:camera:0", position: camera.dummy.position, layer: camera.dummy.layer }, providers });
  const owner = Object.fromEntries(createNativeFieldActorProjections(candidate, map.partyEntry.mapRange, catalog).map((a) => [a.id, a]));
  const appearance = new FieldPartyActors(catalog, entry.checkpoint, fresh.entry.transportation.id);
  const host = { readActors: () => owner, readCatalog: () => catalog, readCharacters: () => characters,
    readProviders: () => providers, readAnimationKeys: () => keys };
  const batches = [];
  const renderer = { prepareBatch(steps) { batches.push(structuredClone(steps)); return prepareNativeFieldActorAppearance(host, steps); } };
  const prepare = (steps) => appearance.prepareSequence(steps, renderer);
  return { state, owner, appearance, characters, host, batches, prepare };
}
const cases = [], t = setup();
assert.equal(Object.keys(t.owner).length, 55);
assert.deepEqual(t.state.snapshot().roster.map((r) => r.conditionIds), [[], [], []]);
const initialIds = serial(t.owner).map((a) => a.fieldAssetId), prior = serial(t.owner);
const refs = Object.values(t.owner).map((actor) => ({ actor, native: actor.native, entity: actor.native.entity,
  position: actor.native.entity.position, view: actor.native.entity.viewBinding }));
executeOwnedConditionEvent(op, t.state.fieldOwnedConditions, t.prepare);
assert.deepEqual(t.state.snapshot().roster.map((r) => r.conditionIds), [[53], [53], [53]]);
assert.equal(t.batches.length, 1); assert.equal(t.batches[0].length, 3);
for (const step of t.batches[0]) {
  assert.ok(step.plan.changes.every((change) => change.mode === "replace"));
  assert.deepEqual(step.plan.cameraOffset, { x: 0, y: 16 });
}
const expectedIds = [...initialIds]; expectedIds[5] = 1;
assert.deepEqual(serial(t.owner).map((a) => a.fieldAssetId), expectedIds,
  "ChangePartyEntityAsset also binds source party 0's enabled leader into its existing hidden actor");
assert.equal(t.owner["-1001"].native.charaZOffset, 0.5);
for (const [i, ref] of refs.entries()) {
  assert.equal(t.owner[ref.actor.id], ref.actor); assert.equal(ref.actor.native, ref.native); assert.equal(ref.native.entity, ref.entity);
  assert.equal(ref.entity.position, ref.position); assert.equal(ref.entity.viewBinding, ref.view);
  const after = serial(t.owner)[i];
  const expected = i === 5 ? { ...prior[i], fieldAssetId: 1, shadowVisible: true } : prior[i];
  assert.deepEqual({ ...after, animation: null }, { ...expected, animation: null });
}
for (const id of ["native:puppet:0", "native:puppet:1", "native:puppet:2"]) {
  assert.equal(t.owner[id].native.entity.visible, false); assert.equal(t.owner[id].direction, null);
  assert.equal(t.owner[id].animation.snapshot().key, "Default"); assert.equal(t.owner[id].animation.snapshot().elapsed, 0);
}
assert.equal(t.owner["native:puppet:3"].animation.snapshot(), null, "setDummy false retains the preexisting unused puppet");
assert.equal(t.owner["native:party:0"].animation.snapshot().key, "Default",
  "the first target creates an unselected instance; later target refreshes choose Default from that instance");
assert.equal(t.owner["native:party:0"].native.entity.visible, false);
assert.equal(t.owner["native:party:0"].direction, null);
cases.push({ name: "real source AddCondition607 refreshes all 3 owners in one ordered native actor batch", pass: true,
  steps: t.batches[0].length, replacements: t.batches[0].map((s) => s.plan.changes.length) });
const savedOwned = t.state.snapshot();
executeOwnedConditionEvent(op, t.state.fieldOwnedConditions, t.prepare);
assert.deepEqual(t.state.snapshot(), savedOwned); assert.equal(t.batches.length, 2);
cases.push({ name: "already-added state still executes source refresh without duplicating status", pass: true });
const remove = { ...op, command: { ...op.command, kind: "remove-condition" } };
executeOwnedConditionEvent(remove, t.state.fieldOwnedConditions, t.prepare);
assert.deepEqual(t.state.snapshot().roster.map((r) => r.conditionIds), [[], [], []]);
cases.push({ name: "controlled inverse Remove607 uses the same real owned/native owner transaction", pass: true,
  controlledCommand: true });
const u = setup(), before = { owned: u.state.snapshot(), actors: serial(u.owner), appearance: u.appearance.checkpoint() };
delete u.characters[catalog.assets[31].asset];
assert.throws(() => executeOwnedConditionEvent(op, u.state.fieldOwnedConditions, u.prepare), /Missing native appearance media/);
assert.deepEqual({ owned: u.state.snapshot(), actors: serial(u.owner), appearance: u.appearance.checkpoint() }, before);
cases.push({ name: "real media dependency loss rejects owned and all native actor publication", pass: true });
const v = setup();
assert.throws(() => executeOwnedConditionEvent(op, v.state.fieldOwnedConditions, (steps) => {
  const pending = v.prepare(steps); v.owner["-1001"].x += 1; return pending;
}), /Stale native appearance/);
assert.deepEqual(v.state.snapshot().roster.map((r) => r.conditionIds), [[], [], []]);
assert.equal(v.owner["native:puppet:0"].animation.snapshot(), null);
cases.push({ name: "stale live pose is rejected before owned condition commit", pass: true });
const report = { kind: "field-native-appearance-source", packages, sourceCommand: op, nativeReceiptSha256: sha(nativeBytes),
  sourceAnimationIndexHash: sha(canonical(keys)), cases,
  counts: { actors: Object.keys(t.owner).length, ownedTargets: 3, cases: cases.length,
    sourceAnimationAssets: Object.keys(keys.assets).length, verifiedSpriteFiles: verifiedSprites.size,
    nativeMethods: native.counts.completeMethods + native.counts.rawMethods },
  lane: "real-source-command-and-native-owner-probe", actualStoryExecuted: false, originalGameExecuted: false,
  gpuShaderParity: false,
  controlledInputs: ["The source command is invoked directly after source PointIn/factory; no preceding story clocks or UI are replayed.",
    "Upper/ceiling attachments are explicit null inputs in the bounded Canvas path, not a claim that Unity allocated no render targets.",
    "Remove607 is an explicit controlled inverse probe, not an instruction claimed to occur at this source route."],
  remaining: ["Mounted rider replacement, custom shadows/shaders and source GPU equivalence remain gated.",
    "Full source-new-game story execution and camera offset publication are parent-host acceptance lanes."] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.counts, actualStoryExecuted: false, originalGameExecuted: false }));
