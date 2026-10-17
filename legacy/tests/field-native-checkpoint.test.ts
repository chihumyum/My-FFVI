import test from "node:test";
import assert from "node:assert/strict";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { captureFieldNativeCheckpoint, restoreFieldNativeCheckpoint,
  type FieldNativeCheckpointContext, type FieldNativeCheckpoint } from "../src/core/field-native-checkpoint.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { createNativeFieldActorProjection, createNativeFieldActorProjections,
  type NativeFieldActor } from "../src/core/field-native-actors.js";
import { compileFieldNativeNpc } from "../src/compiler/field-native-npc.js";
import { prepareFieldNativeNpcGroup } from "../src/core/field-native-npc.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function fixture() {
  const f = fieldActorFactoryFixture(), candidate = createFieldActorFactoryCandidate(f.input);
  const owner = Object.fromEntries(createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog).map((a) => [a.id, a]));
  const context: FieldNativeCheckpointContext = { mapRange: f.map.mapRange, bindings: candidate.bindings, factory: f.factory,
    partyCatalog: f.partyCatalog, partyCheckpoint: f.entry.checkpoint, characters: f.characters, npcs: [], providers: f.input.providers };
  return { ...f, candidate, context, owner, player: owner[candidate.bindings.player]! };
}
function addNpc(f: ReturnType<typeof fixture>, anonymous = false) {
  const source = { file: "synthetic-npc.bundle", assetPath: "Map/event.json", objectId: "9007199254740997", pointer: "/layers/0/objects/2" };
  const asset = f.player.asset!, id = anonymous ? "event:0:2" : "501";
  const definition = compileFieldNativeNpc({ group: "event", object: { x: 80, y: 96, width: 16, height: 16 },
    entity: { id, kind: 6, layer: 1, source }, properties: { entity_id: anonymous ? 0 : 501, asset_id: 77,
      direction: 1, move_type: 0, turn_around: true, move_while_display_message: true },
    tables: { "mapobject.csv": [{ id: 77, asset_name: asset, shadow_type: 1 }] } }).definition!;
  assert.ok(definition);
  const candidate = prepareFieldNativeNpcGroup({ definitions: [definition], factory: f.factory, characters: f.characters,
    mapRange: f.map.mapRange, providers: f.input.providers, existingActorIds: Object.keys(f.owner) });
  const actor = createNativeFieldActorProjection(candidate.actors[0]!, f.map.mapRange, f.partyCatalog);
  f.owner[id] = actor; f.context.npcs = [...f.context.npcs, definition];
  return actor;
}
const asOwner = (actors: NativeFieldActor[]) => Object.fromEntries(actors.map((a) => [a.id, a]));
const save = (f: ReturnType<typeof fixture>) => captureFieldNativeCheckpoint(f.owner, f.context);
const copy = <T>(value: T): T => structuredClone(value);

test("native stable checkpoint round-trips persistent factory actors without selecting uninitialized animations", () => {
  const f = fixture(), raw = save(f), actors = restoreFieldNativeCheckpoint(JSON.parse(JSON.stringify(raw)), f.context);
  assert.equal(actors.length, Object.keys(f.owner).length);
  assert.deepEqual(captureFieldNativeCheckpoint(asOwner(actors), f.context), raw);
  for (const actor of actors) {
    const before = f.owner[actor.id]!;
    assert.notEqual(actor, before); assert.notEqual(actor.native.entity, before.native.entity);
    assert.equal(actor.animation, actor.native.entity.animation);
    assert.deepEqual(actor.animation?.snapshot() ?? null, before.animation?.snapshot() ?? null);
    assert.equal(actor.layer, before.layer); assert.equal(actor.asset, before.asset);
  }
  assert.equal(actors.find((a) => a.id === "native:party:0")!.animation, null);
  assert.equal(actors.find((a) => a.id === "native:puppet:0")!.animation!.snapshot(), null);
});
test("stable active playback retains timing, loops and next-frame continuation", () => {
  const f = fixture();
  f.player.animation!.play("wave", true, 1.5); f.player.animation!.advance(710); f.player.steps = 23;
  const restored = asOwner(restoreFieldNativeCheckpoint(save(f), f.context))[f.player.id]!;
  assert.equal(restored.steps, 23); assert.equal(restored.animation!.playing, true);
  for (const delta of [0, 10, 140, 700]) {
    f.player.animation!.advance(delta); restored.animation!.advance(delta);
    assert.deepEqual(restored.animation!.snapshot(), f.player.animation!.snapshot());
    assert.deepEqual(restored.animation!.frame(), f.player.animation!.frame());
  }
});
test("positive and anonymous map NPCs retain source metadata from definitions and all runtime changes", () => {
  const f = fixture(), npc = addNpc(f), anonymous = addNpc(f, true);
  npc.x = 12.5; npc.y = 7.25; npc.steps = 19; npc.native.entity.visible = false;
  npc.native.entity.fadeAlpha = Math.fround(0.375); npc.animation!.play("wave", true, 2); npc.animation!.advance(70);
  anonymous.native.entity.bodyOpaque = false; anonymous.native.entity.shadowVisible = false;
  const raw = save(f), recovered = asOwner(restoreFieldNativeCheckpoint(raw, f.context));
  assert.deepEqual(captureFieldNativeCheckpoint(recovered, f.context), raw);
  assert.equal(recovered[npc.id]!.native.mapObjectAsset!.id, 77);
  assert.equal(recovered[anonymous.id]!.native.scope!.source.objectId, "9007199254740997");
  assert.equal(recovered[anonymous.id]!.native.updateAttribute, 10);
  assert.ok(!("fieldAssetId" in raw.actors[0]!)); assert.ok(!("source" in raw.actors[0]!));
});
test("restore never replays Look, Cue or NPC initialization", () => {
  const f = fixture(), npc = addNpc(f, true); npc.animation!.play("wave", true, 2); npc.animation!.advance(25);
  const raw = save(f), look = ActorAnimation.prototype.look, cue = ActorAnimation.prototype.cue;
  ActorAnimation.prototype.look = () => { throw new Error("Must not reinitialize look"); };
  ActorAnimation.prototype.cue = () => { throw new Error("Must not reinitialize cue"); };
  try { assert.deepEqual(captureFieldNativeCheckpoint(asOwner(restoreFieldNativeCheckpoint(raw, f.context)), f.context), raw); }
  finally { ActorAnimation.prototype.look = look; ActorAnimation.prototype.cue = cue; }
});
test("missing, duplicate and extra actor identities are rejected against trusted active groups", () => {
  const f = fixture(); addNpc(f, true); const raw = save(f);
  for (const actors of [raw.actors.slice(1), [...raw.actors, raw.actors[0]!],
    [...raw.actors, { ...raw.actors[0]!, id: "unknown-npc" }]])
    assert.throws(() => restoreFieldNativeCheckpoint({ ...raw, actors }, f.context), /identit/);
  assert.throws(() => restoreFieldNativeCheckpoint(raw, { ...f.context, npcs: [] }), /identit/);
});
test("unknown saved fields cannot inject trusted metadata, sources or resource identities", () => {
  const f = fixture(), raw = save(f);
  const changed = copy(raw); Object.assign(changed.actors[0]!, { fieldAssetId: 999 });
  assert.throws(() => restoreFieldNativeCheckpoint(changed, f.context), /fields/);
  assert.throws(() => restoreFieldNativeCheckpoint({ ...raw, sources: [] } as never, f.context), /fields/);
  assert.throws(() => restoreFieldNativeCheckpoint({ ...raw, kind: "native-v0" } as never, f.context), /Unknown/);
});
test("live metadata and media must still match the trusted appearance and NPC definitions", () => {
  const f = fixture(), npc = addNpc(f), original = npc.native.mapObjectAsset!.source;
  npc.native.mapObjectAsset!.source = { ...original, objectId: "12" };
  assert.throws(() => save(f), /metadata/); npc.native.mapObjectAsset!.source = original;
  f.player.native.charaZOffset = 0;
  assert.throws(() => save(f), /metadata/); f.player.native.charaZOffset = 0.5;
  const media = f.player.animation!.character, foreign = copy(media); foreign.source.file = "foreign.bundle";
  f.player.animation = new ActorAnimation(foreign);
  assert.throws(() => save(f), /media/);
});
test("moving, rider and child hosts remain outside stable checkpoint admission", () => {
  const f = fixture();
  f.player.motion = { from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, elapsed: 0, duration: 120, manual: false };
  assert.throws(() => save(f), /moving/); f.player.motion = null;
  f.player.native.entity.riding = true; assert.throws(() => save(f), /lifecycle/); f.player.native.entity.riding = false;
  f.player.native.entity.childEntityObject = "unknown"; assert.throws(() => save(f), /lifecycle/);
});
test("numeric, layer and boolean corruption fail even on hidden residents", () => {
  const f = fixture(), raw = save(f), at = raw.actors.findIndex((a) => a.id.startsWith("native:resident:"));
  assert.ok(at >= 0);
  const mutate = (fn: (r: FieldNativeCheckpoint["actors"][number]) => void) => { const bad = copy(raw); fn(bad.actors[at]!);
    assert.throws(() => restoreFieldNativeCheckpoint(bad, f.context)); };
  mutate((r) => { r.position.x = 0.1; }); mutate((r) => { r.position.z = NaN; });
  mutate((r) => { r.layer = 14; }); mutate((r) => { r.fadeAlpha = 1.01; });
  mutate((r) => { r.steps = -1; }); mutate((r) => { r.visible = 1 as never; });
});
test("playback corruption and absent source keys reject without partial changes", () => {
  const f = fixture(), raw = save(f), before = JSON.stringify(raw), ownerBefore = save(f);
  const bad = copy(raw); bad.actors[0]!.animation!.key = "missing";
  assert.throws(() => restoreFieldNativeCheckpoint(bad, f.context), /Missing actor animation/);
  const malformed = copy(raw); malformed.actors[0]!.animation!.elapsed = 0.1;
  assert.throws(() => restoreFieldNativeCheckpoint(malformed, f.context), /animation checkpoint/);
  assert.equal(JSON.stringify(raw), before); assert.deepEqual(save(f), ownerBefore);
});
test("an assetless actor cannot acquire animation from the checkpoint", () => {
  const f = fixture(), raw = save(f);
  raw.actors.find((a) => a.id === "native:party:0")!.animation = copy(raw.actors[0]!.animation);
  assert.throws(() => restoreFieldNativeCheckpoint(raw, f.context), /grants missing source media/);
});
test("foreign map material and forged live shader properties are rejected", () => {
  const f = fixture(), raw = save(f), original = f.player.native.entity.viewBinding!;
  raw.actors[0]!.view!.map = "f".repeat(64);
  assert.throws(() => restoreFieldNativeCheckpoint(raw, f.context), /another map material/);
  f.player.native.entity.viewBinding = { ...original, properties: { ...original.properties!, paletteSpeed: 2 } as never };
  assert.throws(() => save(f), /material properties/);
});
test("saved texture strings cannot grant a missing render-target compositor", () => {
  const f = fixture(), raw = save(f);
  raw.actors[0]!.transparentTextures.first = "forged-rt";
  assert.throws(() => restoreFieldNativeCheckpoint(raw, f.context), /texture binding/);
  const providers = { ...f.context.providers, upperTexture: "undeclared-rt" };
  raw.actors[0]!.transparentTextures.first = "undeclared-rt";
  assert.throws(() => restoreFieldNativeCheckpoint(raw, { ...f.context, providers }), /composition/);
});
test("retained unplaced material needs an independent trusted old-map provider", () => {
  const f = fixture(), raw = save(f), row = raw.actors.find((a) => a.id === "native:puppet:0")!;
  const current = f.context.providers, oldId = "e".repeat(64);
  row.view = { map: oldId, layer: 9 };
  const old = { ...current, mapRenderContext: oldId, applyViewProperties: (layer: number) => {
    const view = current.applyViewProperties!(layer); return view && { ...view, contextId: oldId };
  } };
  assert.throws(() => restoreFieldNativeCheckpoint(raw, f.context), /retained material/);
  const context = { ...f.context, resolveRetainedView: (id: string) => id === oldId ? old : null };
  const restored = asOwner(restoreFieldNativeCheckpoint(raw, context));
  assert.equal(restored[row.id]!.layer, null); assert.equal(restored[row.id]!.native.entity.viewBinding!.map, oldId);
  assert.deepEqual(captureFieldNativeCheckpoint(restored, context), raw);
});
test("restored playback and positions are detached while their trusted media stays shared", () => {
  const f = fixture(), raw = save(f), expected = copy(raw), restored = asOwner(restoreFieldNativeCheckpoint(raw, f.context));
  const player = restored[f.player.id]!; player.x += 1; player.animation!.play("wave", true, 2); player.steps++;
  assert.deepEqual(raw, expected); assert.deepEqual(save(f), expected);
  assert.equal(player.animation!.character, f.player.animation!.character);
});
test("changed trusted source dependencies cannot be papered over with matching saved identities", () => {
  const f = fixture(), raw = save(f), characters = { ...f.characters }; delete characters[f.player.asset!];
  assert.throws(() => restoreFieldNativeCheckpoint(raw, { ...f.context, characters }), /source media/);
  const bindings = copy(f.context.bindings); bindings.residents[0]!.actor = "pretend-resident";
  assert.throws(() => restoreFieldNativeCheckpoint(raw, { ...f.context, bindings }), /resident instance identity/);
});
