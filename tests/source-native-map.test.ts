import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldActorView } from "../src/compiler/field-actor-view.js";
import { compileFieldNativeComposition } from "../src/compiler/field-native-composition.js";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { projectFieldActorView } from "../src/core/field-actor-view.js";
import { fieldCameraCellToWorld } from "../src/core/field-camera.js";
import { createNativeFieldActorProjections } from "../src/core/field-native-actors.js";
import type { FieldNativeAnimationKeys } from "../src/core/field-native-appearance.js";
import { fieldCompositionActorTextures, fieldCompositionTexture, ordinaryFieldCompositionRenderHost } from "../src/core/field-native-composition.js";
import { prepareMapPartyEntry, type MapPartyEntryDefinition } from "../src/core/map-party-entry.js";
import { prepareSourceNativeMap } from "../src/core/source-native-map.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function fixture() {
  const f = fieldActorFactoryFixture();
  const prior = createFieldActorFactoryCandidate(f.input);
  const definition: MapPartyEntryDefinition = { ...structuredClone(f.map), mapId: 902, width: 32, height: 24,
    mapRange: { x: 2, y: 1, width: 28, height: 20 },
    pointIns: [{ ...structuredClone(f.map.pointIns[0]!), id: 9, x: 8, y: 7, layer: 1, direction: "left" as const }] };
  const tilemap = structuredClone(f.tilemap); tilemap.data.width = 32; tilemap.data.height = 24;
  const view = compileFieldActorView(f.sources, tilemap, f.mapPackage, definition.mapRange);
  const providers = { ...f.input.providers, mapRenderContext: view.contextId,
    applyViewProperties: (layer: number) => projectFieldActorView(view, layer) };
  const player = prior.snapshot.actors.find((a) => a.id === prior.bindings.player)!;
  player.animation!.play("wave", true, 1); player.animation!.advance(110);
  player.visible = false; player.fadeAlpha = 0;
  const puppet = prior.snapshot.actors.find((a) => a.id === prior.bindings.partyPuppets[0])!;
  puppet.position = { x: 48, y: -16, z: 349 }; puppet.layer = 9;
  puppet.animation!.play("wave", true, 1); puppet.animation!.advance(130);
  puppet.visible = true; puppet.fadeAlpha = 1;
  puppet.viewBinding = { map: f.view.contextId, layer: 9, properties: projectFieldActorView(f.view, 9)! };
  const resident = prior.snapshot.actors.find((a) => a.id === prior.bindings.residents[0]!.actor)!;
  resident.position = { x: -80, y: 64, z: -2 }; resident.layer = 10; resident.direction = "right";
  resident.animation!.play("wave", true, 1); resident.animation!.advance(170);
  resident.visible = false; resident.fadeAlpha = Math.fround(0.4); resident.shadowVisible = false;
  resident.viewBinding = { map: f.view.contextId, layer: 10, properties: projectFieldActorView(f.view, 10)! };
  const other = prior.snapshot.actors.find((a) => a.id === prior.bindings.otherParties[1])!;
  other.position = { x: 40, y: 24, z: 200 }; other.visible = true; other.fadeAlpha = 1;
  const entry = prepareMapPartyEntry(f.partyCatalog, { definition, entrance: 9, mapViewType: 0,
    prior: f.entry.checkpoint, playerVisible: player.visible, party: f.party,
    transportation: f.fresh.entry.transportation, canPartySwitching: false });
  const animationKeys: FieldNativeAnimationKeys = { kind: "native-field-animation-keys-v1",
    assets: Object.fromEntries(Object.entries(f.characters).map(([asset, character]) => [asset, {
      keys: Object.keys(character.animations), source: character.source, contentHash: "a".repeat(64),
    }])) };
  const input = { prior, priorCheckpoint: f.entry.checkpoint, entry, definition, catalog: f.partyCatalog,
    party: f.party, characters: f.characters, animationKeys, view, providers };
  return { ...f, prior, definition, view, providers, entry, input, player, puppet, resident, other };
}

const serial = (candidate: ReturnType<typeof prepareSourceNativeMap>) => ({ ...candidate,
  snapshot: { ...candidate.snapshot, actors: candidate.snapshot.actors.map((a) => ({ ...a,
    animation: a.animation?.snapshot() ?? null })) } });

function compositionFixture(destinationLayers: string[] = ["UpperLayer", "CeilLayer"]) {
  const f = fixture(), prefix = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/";
  f.sources.push({ file: prefix + "map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle",
    sha256: "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a" },
  { file: prefix + "shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle",
    sha256: "56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e" });
  const prepare = (width: number, height: number, layers: string[], range: typeof f.map.mapRange) => {
    const tilemap = structuredClone(f.tilemap);
    tilemap.data.width = width; tilemap.data.height = height;
    tilemap.data.layers[0]!.layers.push(...layers.map((name) => ({ type: "tilelayer", name,
      width, height, data: Array(width * height).fill(0) })));
    const view = compileFieldActorView(f.sources, tilemap, f.mapPackage, range);
    return { view, composition: compileFieldNativeComposition(f.sources, view, tilemap) };
  };
  const old = prepare(20, 16, ["UpperLayer", "CeilLayer"], f.map.mapRange);
  const next = prepare(32, 24, destinationLayers, f.definition.mapRange);
  for (const actor of [f.player, f.puppet, f.resident]) {
    actor.viewBinding = { map: old.view.contextId, layer: actor.layer, properties: projectFieldActorView(old.view, actor.layer)! };
    actor.transparentTextures = fieldCompositionActorTextures(old.composition, actor.layer);
  }
  const providers = { ...f.providers, mapRenderContext: next.view.contextId, composition: next.composition,
    upperTexture: next.composition.upperTexture, ceilTexture: next.composition.ceilTexture,
    applyViewProperties: (layer: number) => projectFieldActorView(next.view, layer) };
  return { ...f, old, next, input: { ...f.input, priorComposition: old.composition, view: next.view, providers } };
}

test("ordinary map handoff retains resident world pose, visibility and playback instead of running the save-load reset", () => {
  const f = fixture(), before = serial(f.prior), next = prepareSourceNativeMap(f.input);
  const resident = next.snapshot.actors.find((a) => a.id === f.resident.id)!;
  assert.deepEqual(resident.position, f.resident.position);
  assert.equal(resident.layer, 10); assert.equal(resident.direction, "right");
  assert.equal(resident.visible, false); assert.equal(resident.fadeAlpha, Math.fround(0.4));
  assert.equal(resident.shadowVisible, false);
  assert.deepEqual(resident.animation!.snapshot(), f.resident.animation!.snapshot());
  assert.equal(resident.viewBinding!.map, f.view.contextId);
  assert.notEqual(resident.viewBinding!.map, f.resident.viewBinding!.map);
  assert.deepEqual(serial(f.prior), before);
  assert.deepEqual(next.bindings, f.prior.bindings);
  assert.deepEqual(next.snapshot.camera, f.prior.snapshot.camera);
});

test("MapSetup hides four puppets and three other-party actors without resetting their position, asset or playback", () => {
  const f = fixture(), next = prepareSourceNativeMap(f.input);
  for (const id of [...next.bindings.partyPuppets, ...next.bindings.otherParties]) {
    const prior = f.prior.snapshot.actors.find((a) => a.id === id)!;
    const after = next.snapshot.actors.find((a) => a.id === id)!;
    assert.equal(after.visible, false); assert.equal(after.fadeAlpha, 0);
    assert.deepEqual(after.position, prior.position); assert.equal(after.layer, prior.layer);
    assert.deepEqual(after.animation?.snapshot() ?? null, prior.animation?.snapshot() ?? null);
    assert.deepEqual(next.assets.find((a) => a.id === id), f.prior.assets.find((a) => a.id === id));
  }
});

test("only the actual player receives destination PointIn, normal look, movement reset and source depth offset", () => {
  const f = fixture(), next = prepareSourceNativeMap(f.input), player = next.snapshot.actors.find((a) => a.id === next.bindings.player)!;
  assert.deepEqual(player.position, fieldCameraCellToWorld(f.definition.mapRange, { x: 6, y: 6 }, 1));
  assert.equal(player.layer, 10); assert.equal(player.direction, "left");
  assert.equal(player.visible, false); assert.equal(player.fadeAlpha, 0);
  assert.equal(player.moving, false); assert.equal(player.animation!.snapshot()!.key, "WalkL");
  assert.equal(player.animation!.playing, false);
  assert.equal(next.assets.find((a) => a.id === player.id)!.charaZOffset, 0.5);
  const oldPlayer = f.prior.snapshot.actors.find((a) => a.id === player.id)!;
  assert.equal(oldPlayer.animation!.snapshot()!.key, "wave"); assert.equal(oldPlayer.animation!.playing, true);
});

test("source player condition media changes are applied while nonplayer media remains unchanged", () => {
  const f = fixture(), party = structuredClone(f.party);
  party.activeMembers[0]!.conditionIds = [13];
  party.parties[0]![0]!.conditionIds = [13];
  const entry = prepareMapPartyEntry(f.partyCatalog, { definition: f.definition, entrance: 9, mapViewType: 0,
    prior: f.input.priorCheckpoint, playerVisible: false, party,
    transportation: f.fresh.entry.transportation, canPartySwitching: false });
  const next = prepareSourceNativeMap({ ...f.input, entry, party });
  assert.equal(next.assets.find((a) => a.id === next.bindings.player)!.fieldAssetId, 41);
  assert.equal(next.snapshot.actors.find((a) => a.id === next.bindings.player)!.animation!.character, f.characters.frog);
  assert.equal(next.assets.find((a) => a.id === f.puppet.id)!.fieldAssetId, f.prior.assets.find((a) => a.id === f.puppet.id)!.fieldAssetId);
});

test("PointIn in the currently playing direction retains elapsed/play through both player asset assignments", () => {
  const f = fixture();
  f.definition.pointIns[0]!.direction = "up"; f.entry.player.direction = "up";
  f.player.animation!.play("WalkB", true, 1); f.player.animation!.advance(173);
  const before = f.player.animation!.snapshot()!;
  const next = prepareSourceNativeMap(f.input).snapshot.actors.find((a) => a.id === f.player.id)!.animation!;
  assert.equal(next.snapshot()!.key, "WalkB"); assert.equal(next.playing, true);
  assert.equal(next.snapshot()!.elapsed, before.elapsed);
  assert.equal(next.snapshot()!.mode, f.player.animation!.character.animations.WalkB!.mode);
  assert.deepEqual(f.player.animation!.snapshot(), before);
});

test("PointIn changing direction cues the destination pose and stops the previously playing directional animation", () => {
  const f = fixture(); f.player.animation!.play("WalkB", true, 1); f.player.animation!.advance(173);
  const next = prepareSourceNativeMap(f.input).snapshot.actors.find((a) => a.id === f.player.id)!.animation!;
  assert.equal(next.snapshot()!.key, "WalkL"); assert.equal(next.playing, false);
  assert.equal(f.player.animation!.snapshot()!.key, "WalkB"); assert.equal(f.player.animation!.playing, true);
});

test("an intermediate base asset fallback cannot regain old playback when the final condition asset contains the old key", () => {
  const f = fixture(), party = structuredClone(f.party);
  party.activeMembers[0]!.conditionIds = [13]; party.parties[0]![0]!.conditionIds = [13];
  f.input.priorCheckpoint.context.player.fieldAssetId = 41; f.input.priorCheckpoint.playerAssetCacheId = 41;
  f.prior.assets.find((a) => a.id === f.player.id)!.fieldAssetId = 41;
  f.player.animation = new ActorAnimation(f.characters.frog!);
  f.player.animation.play("WalkB", true, 1); f.player.animation.advance(173);
  delete f.characters.bravo!.animations.WalkB;
  f.input.animationKeys.assets.bravo!.keys = f.input.animationKeys.assets.bravo!.keys.filter((key) => key !== "WalkB");
  f.definition.pointIns[0]!.direction = "up";
  const entry = prepareMapPartyEntry(f.partyCatalog, { definition: f.definition, entrance: 9, mapViewType: 0,
    prior: f.input.priorCheckpoint, playerVisible: false, party,
    transportation: f.fresh.entry.transportation, canPartySwitching: false });
  const next = prepareSourceNativeMap({ ...f.input, entry, party }).snapshot.actors.find((a) => a.id === f.player.id)!.animation!;
  assert.equal(next.character, f.characters.frog); assert.equal(next.snapshot()!.key, "WalkB");
  assert.equal(next.playing, false); assert.notEqual(next.snapshot()!.elapsed, f.player.animation.snapshot()!.elapsed);
  assert.equal(f.player.animation.playing, true);
});

test("missing source keys and unimplemented transportation automatic playback fail without changing the departed actor", () => {
  const f = fixture(), before = serial(f.prior), keys = structuredClone(f.input.animationKeys);
  delete keys.assets.bravo;
  assert.throws(() => prepareSourceNativeMap({ ...f.input, animationKeys: keys }), /source animation keys/);
  f.characters.bravo!.animations.Default!.mode = 1;
  assert.throws(() => prepareSourceNativeMap(f.input), /automatic playback/);
  assert.deepEqual(serial(f.prior), before);
});

test("detached candidate projections use the destination map range while retained native world coordinates stay unchanged", () => {
  const f = fixture(), next = prepareSourceNativeMap(f.input);
  const old = createNativeFieldActorProjections(f.prior, f.map.mapRange, f.partyCatalog);
  const actors = createNativeFieldActorProjections(next, f.definition.mapRange, f.partyCatalog);
  const resident = actors.find((a) => a.id === f.resident.id)!;
  assert.notEqual(resident.x, old.find((a) => a.id === f.resident.id)!.x);
  assert.deepEqual(resident.native.entity.position, f.resident.position);
  const player = actors.find((a) => a.id === next.bindings.player)!;
  assert.equal(player.x, 8); assert.equal(player.y, 7);
  resident.animation!.advance(70); resident.x += 1;
  assert.notDeepEqual(resident.animation!.snapshot(), f.resident.animation!.snapshot());
  assert.deepEqual(f.resident.position, { x: -80, y: 64, z: -2 });
  assert.equal(next.snapshot.actors.find((a) => a.id === f.resident.id)!.position.x, -80);
});

test("unplaced residents retain their old material binding because the native layer branch performs no apply", () => {
  const f = fixture(), other = f.prior.snapshot.actors.find((a) => a.id === f.prior.bindings.residents[1]!.actor)!;
  other.viewBinding = { map: f.resident.viewBinding!.map, layer: 10, properties: projectFieldActorView(fieldActorFactoryFixture().view, 10)! };
  const next = prepareSourceNativeMap(f.input), after = next.snapshot.actors.find((a) => a.id === other.id)!;
  assert.equal(after.layer, 0); assert.deepEqual(after.viewBinding, other.viewBinding);
});

test("missing destination media or unbound material preparation leaves every departed state unchanged", () => {
  const f = fixture(), before = serial(f.prior), characters = { ...f.characters };
  delete characters.frog;
  assert.throws(() => prepareSourceNativeMap({ ...f.input, characters }), /media/);
  assert.throws(() => prepareSourceNativeMap({ ...f.input, providers: { ...f.providers, applyViewProperties: () => null } }), /disagrees/);
  assert.throws(() => prepareSourceNativeMap({ ...f.input, view: { ...f.view, mapSize: { width: 1, height: 1 } } }), /size mismatch/);
  assert.deepEqual(serial(f.prior), before);
});

test("unknown foot attributes, forest material and destination render textures are separate explicit blockers", () => {
  const f = fixture(), before = serial(f.prior);
  assert.throws(() => prepareSourceNativeMap({ ...f.input, providers: { ...f.providers, footAttribute: () => null } }), /Unknown/);
  assert.throws(() => prepareSourceNativeMap({ ...f.input, providers: { ...f.providers, footAttribute: () => 9 } }), /transparency/);
  assert.throws(() => prepareSourceNativeMap({ ...f.input, providers: { ...f.providers, ceilTexture: "rt:ceil" } }), /composition/);
  assert.deepEqual(serial(f.prior), before);
});

test("rider caches, active movement and companions cannot be discarded at map publication", () => {
  const f = fixture(), before = serial(f.prior);
  const checkpoint = structuredClone(f.input.priorCheckpoint); checkpoint.context.player.riderFieldAssetId = 2;
  assert.throws(() => prepareSourceNativeMap({ ...f.input, priorCheckpoint: checkpoint }), /riding instance/);
  const input = fixture().input; input.prior.snapshot.actors[2]!.moving = true;
  assert.throws(() => prepareSourceNativeMap(input), /Active movement/);
  const companion = fixture().input;
  companion.priorCheckpoint.context.companion = { fieldAssetId: 1, conditionTypes: [], actor: null, puppet: null };
  assert.throws(() => prepareSourceNativeMap(companion), /companion/);
  assert.deepEqual(serial(f.prior), before);
});

test("alias reuse, missing residents and unsupported map-local instances do not silently change the native identity set", () => {
  const f = fixture(); f.prior.bindings.residents[0]!.actor = f.prior.bindings.player;
  assert.throws(() => prepareSourceNativeMap(f.input), /missing, duplicate/);
  const missing = fixture(); missing.prior.snapshot.actors.pop(); missing.prior.assets.pop();
  assert.throws(() => prepareSourceNativeMap(missing.input), /missing, duplicate/);
  const extra = fixture(); extra.prior.snapshot.actors.push({ ...extra.resident, id: "native:map-local:7" });
  extra.prior.assets.push({ ...extra.prior.assets[0]!, id: "native:map-local:7" });
  assert.throws(() => prepareSourceNativeMap(extra.input), /map-local/);
});

test("changed appearance metadata or puppet reset plans cannot bypass the source MapSetup scope", () => {
  const f = fixture(); f.prior.assets.find((a) => a.id === f.puppet.id)!.fieldAssetId = 3;
  assert.throws(() => prepareSourceNativeMap(f.input), /disagrees with appearance/);
  const changed = fixture(); changed.entry.checkpoint.context.puppets[0]!.fieldAssetId = 3;
  assert.throws(() => prepareSourceNativeMap(changed.input), /does not refresh/);
  const visibility = fixture(); visibility.entry.player.visible = true;
  assert.throws(() => prepareSourceNativeMap(visibility.input), /retain actual player visibility/);
});

test("invalid player PointIn, camera range and hide scope cannot invent a viable native map entry", () => {
  const f = fixture(); f.entry.player.x++;
  assert.throws(() => prepareSourceNativeMap(f.input), /PointIn/);
  const camera = fixture(); camera.entry.checkpoint.context.camera.mapArea.xMin++;
  assert.throws(() => prepareSourceNativeMap(camera.input), /camera range/);
  const hide = fixture(); hide.entry.hiddenActorIds.pop();
  assert.throws(() => prepareSourceNativeMap(hide.input), /hidden actor set/);
});

test("ordinary map handoff migrates existing global RT references without rebuilding persistent actors", () => {
  const f = compositionFixture(), before = serial(f.prior), next = prepareSourceNativeMap(f.input);
  const player = next.snapshot.actors.find((a) => a.id === f.player.id)!;
  assert.equal(f.player.layer, 9); assert.equal(player.layer, 10);
  assert.deepEqual(player.transparentTextures, { first: f.next.composition.ceilTexture, second: null },
    "the actual player is reattached after its destination PointIn");
  for (const old of [f.puppet, f.resident]) {
    const retained = next.snapshot.actors.find((a) => a.id === old.id)!;
    assert.deepEqual(retained.transparentTextures, fieldCompositionActorTextures(f.next.composition, old.layer));
    assert.notDeepEqual(retained.transparentTextures, old.transparentTextures);
    assert.deepEqual(retained.position, old.position); assert.deepEqual(retained.animation!.snapshot(), old.animation!.snapshot());
    assert.equal(retained.viewBinding!.map, f.next.view.contextId);
  }
  assert.deepEqual(serial(f.prior), before);
  next.snapshot.actors.find((a) => a.id === f.resident.id)!.transparentTextures.first = null;
  assert.deepEqual(serial(f.prior), before);
});

test("MapSetup hiding does not invent attachments for old null slots even when the new layer exists", () => {
  const f = compositionFixture();
  for (const actor of [f.puppet, f.resident]) actor.transparentTextures = { first: null, second: null };
  const next = prepareSourceNativeMap(f.input);
  for (const old of [f.puppet, f.resident]) {
    const actor = next.snapshot.actors.find((a) => a.id === old.id)!;
    assert.equal(actor.visible, false); assert.deepEqual(actor.transparentTextures, { first: null, second: null });
    assert.equal(actor.viewBinding!.map, f.next.view.contextId);
  }
  assert.ok(next.snapshot.actors.find((a) => a.id === f.player.id)!.transparentTextures.first,
    "only the registered actual player receives the destination Attach call");
});

test("retained RT tokens cannot authorize their own source composition or forged material properties", () => {
  const f = compositionFixture(), before = serial(f.prior);
  const { priorComposition: ignored, ...missing } = f.input;
  assert.throws(() => prepareSourceNativeMap(missing), /Missing trusted departed native composition/);
  assert.throws(() => prepareSourceNativeMap({ ...f.input, priorComposition: f.next.composition }), /Unbound departed native texture slots/);
  assert.deepEqual(serial(f.prior), before);
  const invalid = compositionFixture(); invalid.puppet.transparentTextures.first = invalid.old.composition.ceilTexture;
  assert.throws(() => prepareSourceNativeMap(invalid.input), /Unbound departed native texture slots/);
  const properties = compositionFixture(); properties.resident.viewBinding!.map = properties.next.view.contextId;
  assert.throws(() => prepareSourceNativeMap(properties.input), /actor material projection|departed material identity/);
});

test("unknown old and new RT capabilities and transparent bodies fail without touching departed actors", () => {
  const f = compositionFixture(), before = serial(f.prior), old = structuredClone(f.old.composition);
  old.renderTargets.upper = "unresolved";
  assert.throws(() => prepareSourceNativeMap({ ...f.input, priorComposition: old }), /allocation and sampling/);
  const next = structuredClone(f.next.composition); next.renderTargets.ceil = "unresolved";
  assert.throws(() => prepareSourceNativeMap({ ...f.input, providers: { ...f.input.providers, composition: next } }), /allocation and sampling/);
  assert.deepEqual(serial(f.prior), before);
  f.resident.bodyOpaque = false;
  assert.throws(() => prepareSourceNativeMap(f.input), /transparent body lifecycle/);
});

test("disabled global targets require explicit global target identity and cannot be silently replaced with null", () => {
  const f = compositionFixture([]), before = serial(f.prior);
  assert.throws(() => prepareSourceNativeMap(f.input), /Retained native render target is disabled/);
  assert.deepEqual(serial(f.prior), before);
  for (const actor of [f.puppet, f.resident]) actor.transparentTextures = { first: null, second: null };
  const next = prepareSourceNativeMap(f.input);
  assert.deepEqual(next.snapshot.actors.find((a) => a.id === f.player.id)!.transparentTextures, { first: null, second: null },
    "the actual player's source Attach call can release its old references");
});

test("hidden persistent global RT references survive enabled to disabled to enabled maps without an invented Attach", () => {
  const f = compositionFixture([]);
  f.next.composition.renderHost = ordinaryFieldCompositionRenderHost();
  const before = serial(f.prior), disabled = prepareSourceNativeMap(f.input);
  const puppet = disabled.snapshot.actors.find((a) => a.id === f.puppet.id)!;
  assert.equal(puppet.visible, false);
  assert.equal(f.next.composition.upperTexture, null);
  assert.deepEqual(puppet.transparentTextures, {
    first: fieldCompositionTexture(f.next.view.contextId, "UpperLayer"),
    second: fieldCompositionTexture(f.next.view.contextId, "CeilLayer"),
  });
  assert.deepEqual(disabled.snapshot.actors.find((a) => a.id === f.player.id)!.transparentTextures, { first: null, second: null });
  const destination = compositionFixture(), priorBefore = serial(disabled);
  const next = prepareSourceNativeMap({ ...destination.input, prior: disabled,
    priorCheckpoint: f.entry.checkpoint, priorComposition: f.next.composition });
  assert.deepEqual(next.snapshot.actors.find((a) => a.id === f.puppet.id)!.transparentTextures,
    fieldCompositionActorTextures(destination.next.composition, f.puppet.layer));
  assert.deepEqual(serial(f.prior), before); assert.deepEqual(serial(disabled), priorBefore);
  const bad = structuredClone(f.next.composition); delete bad.renderHost;
  assert.throws(() => prepareSourceNativeMap({ ...destination.input, prior: disabled,
    priorCheckpoint: f.entry.checkpoint, priorComposition: bad }), /trusted global native render target/);
});

test("a retained disabled RT never bypasses the visible renderer contract", () => {
  const f = compositionFixture([]); f.next.composition.renderHost = ordinaryFieldCompositionRenderHost();
  f.resident.visible = true; f.resident.fadeAlpha = 1;
  const before = serial(f.prior);
  assert.throws(() => prepareSourceNativeMap(f.input), /Visible retained native texture slots/);
  assert.deepEqual(serial(f.prior), before);
});

test("visible persistent actors with retained null slots keep a precise renderer gate instead of an invented Attach", () => {
  const f = compositionFixture(); f.resident.visible = true; f.resident.fadeAlpha = 1;
  f.resident.transparentTextures = { first: null, second: null };
  const before = serial(f.prior);
  assert.throws(() => prepareSourceNativeMap(f.input), /Visible retained native texture slots/);
  assert.deepEqual(serial(f.prior), before);
});
