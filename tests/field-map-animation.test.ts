import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldMapAnimation } from "../src/compiler/field-map-animation.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { WEB_FIELD_MAP_ANIMATION, prepareFieldMapAnimations } from "../src/core/field-map-animation.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";
import { type0ConditionSessionFixture, removeAll, type0Exit } from "./fixtures/type0-condition-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import type { FieldEntity } from "../src/field/types.js";

function definition(playOnAwake = true) {
  const source = { file: "synthetic.bundle", assetPath: "Root/entity.json", pointer: "/layers/0/objects/0" };
  return compileFieldMapAnimation({ group: "entity_default", object: { x: 48, y: 64, width: 16, height: 16 },
    entity: { id: "500", kind: 10, layer: 0, source }, tables: { "mapobject.csv": [{ id: "188", asset_name: "animated" }] },
    properties: { object_type: 10, entity_id: 500, asset_id: 188, direction: 15, action_id: 0, script_id: 0,
      birdview_puppet: false, affected: true, collision: true, front: true, split: false, building: false,
      play_on_awake: playOnAwake, zoffset: -1, link_object_id: 0, flight_altitude_ratio: 1 } });
}
test("kind10 opaque direction remains separate from Default playback and the two NPC diagonal cases", () => {
  const d = definition(); assert.deepEqual(d.blockers, []); assert.equal(d.definition!.sourceDirection, 15);
  assert.equal(d.definition!.zOffset, 2);
  const source = d.definition!.source, object = { x: 48, y: 64, width: 16, height: 16,
    properties: Object.entries({ object_type: 10, entity_id: 500, asset_id: 188, direction: 15,
      action_id: 0, script_id: 0, birdview_puppet: false, affected: true, collision: true, front: true,
      split: false, building: false, play_on_awake: true, zoffset: -1, link_object_id: 0, flight_altitude_ratio: 1 })
      .map(([name, value]) => ({ name, value })) };
  const group = compileEntityGroup("entity_default", { source, data: { layers: [{ name: "BottomObject", objects: [object] }] } },
    { "mapobject.csv": [{ id: "188", asset_name: "animated" }] });
  assert.equal(group.entities[0]!.direction, null); assert.ok(group.entities[0]!.mapAnimation);
  assert.ok(group.blockers.some(b => b.reason.includes("unbound")));
  assert.equal(group.blockers.some(b => b.reason === "Unsupported entity direction"), false);
  object.properties.find(p => p.name === "object_type")!.value = 6;
  object.properties.find(p => p.name === "direction")!.value = 7;
  const npc = compileEntityGroup("entity_default", { source, data: { layers: [{ name: "BottomObject", objects: [object] }] } },
    { "mapobject.csv": [{ id: "188", asset_name: "animated" }] });
  assert.ok(npc.blockers.some(b => b.reason === "Unsupported entity direction"));
});
test("source Default uses the shared playback mode; stopped Web initial frame does not invent facing or a clock", () => {
  const f = fieldActorFactoryFixture(), source = f.characters["hero"] ?? Object.values(f.characters)[0]!;
  const media = structuredClone(source); media.animations.Default!.mode = 1;
  const input = { factory: f.factory, characters: { animated: media }, mapRange: f.map.mapRange,
    providers: f.input.providers, existingActorIds: [], policy: WEB_FIELD_MAP_ANIMATION };
  const active = prepareFieldMapAnimations({ ...input, definitions: [definition().definition!] }).actors[0]!;
  assert.equal(active.entity.character, false); assert.equal(active.entity.direction, null);
  assert.equal(active.entity.animation!.snapshot()!.mode, 1); active.entity.animation!.advance(600);
  assert.equal(active.entity.animation!.snapshot()!.loops, 1);
  const stopped = prepareFieldMapAnimations({ ...input, definitions: [definition(false).definition!] }).actors[0]!;
  const before = stopped.entity.animation!.snapshot(); stopped.entity.animation!.advance(1000);
  assert.deepEqual(stopped.entity.animation!.snapshot(), before); assert.equal(before!.elapsed, 0);
  assert.throws(() => prepareFieldMapAnimations({ ...input, policy: "unknown" as typeof WEB_FIELD_MAP_ANIMATION,
    definitions: [definition().definition!] }), /trusted Web policy/);
  assert.throws(() => prepareFieldMapAnimations({ ...input, existingActorIds: ["500"], definitions: [definition().definition!] }), /already exists/);
});

function sessionFixture() {
  const f = type0ConditionSessionFixture({ declared: [removeAll(), type0Exit],
    "anim-action": [{ kind: "calc", left: { category: "MapLocalVariable", index: 0 }, operator: "＋",
      right: { kind: "immediate", value: 1 } }, type0Exit] });
  const d = definition().definition!, group = f.map.map!.groups!.entity_default!;
  const e: FieldEntity = { id: d.entityId, kind: 10, x: 3, y: 3, width: 1, height: 1, layer: 0,
    direction: null, asset: "animated", script: "anim-action", collision: null, destinationLayer: null, source: d.source,
    mapAnimation: d, mapObject: { collision: true, acceptDirection: 15, talkMounts: [""], soundId: 0,
      interaction: { kind: "script", script: "anim-action" } } };
  e.mapObject!.talkMounts = ["", ...Object.keys(f.world.characters)];
  group.entities.push(e); if (group.entities !== f.map.map!.entities) f.map.map!.entities.push(e);
  const media = structuredClone(Object.values(f.world.characters)[0]!); media.animations.Default!.mode = 1;
  f.world.characters.animated = media; f.map.characterAssets.push("animated");
  for (const value of [f.map, f.world, f.content]) value.developmentProfile = {
    kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1", omissions: [],
    sourceContentHash: value.contentHash, mapAnimatedEntities: WEB_FIELD_MAP_ANIMATION };
  f.map.contentHash = sealBatchContent(f.map).contentHash; f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash;
  f.world.contentHash = sealBatchContent(f.world).contentHash;
  f.content.mapContentHash = f.map.contentHash; f.content.worldCatalogHash = f.world.contentHash;
  f.content.contentHash = sealBatchContent(f.content).contentHash;
  return f;
}
test("actual Session installs one animated actor, runs original interaction, and restores playback without Default/init replay", () => {
  const f = sessionFixture(), game = f.make(), actor = game.field.actors["500"]!;
  assert.ok(actor?.native); assert.equal(actor.native.scope!.kind, "map-animated");
  assert.equal(actor.direction, null); assert.equal(actor.native.entity.character, false);
  game.advance(120); const before = actor.animation!.snapshot();
  const checkpoint = game.checkpoint(), restored = f.restore(checkpoint);
  assert.deepEqual(restored.field.actors["500"]!.animation!.snapshot(), before);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(restored.field.interactionTarget("up")?.id, "500");
  assert.equal(restored.field.move("up"), false, "source collision remains on the actual animated owner");
  restored.field.confirm(); restored.advance(10);
  assert.equal(restored.field.stop, null); assert.equal(restored.field.eventState.read({ category: "MapLocalVariable", index: 0 }), 1);
  assert.equal(restored.field.actors["500"]!.native!.mapAnimation!.sourceDirection, 15);
});

import { worldLoopSessionFixture } from "./fixtures/world-loop-session.js";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameContentRepository } from "../src/core/game-content.js";
const ready = { visible: true, mediaReady: true, overlayOpen: false };
async function mapFixture(failure = false) {
  const f = await worldLoopSessionFixture({ initializationFailure: failure });
  const media = structuredClone(Object.values(f.world.characters)[0]!); media.animations.Default!.mode = 1;
  f.world.characters.animated = media; f.world.developmentProfile!.mapAnimatedEntities = WEB_FIELD_MAP_ANIMATION;
  const maps = f.maps.map(input => {
    const map = structuredClone(input), d = definition().definition!;
    d.collision = false;
    const e: FieldEntity = { id: d.entityId, kind: 10, x: 3, y: 3, width: 1, height: 1, layer: 0,
      direction: null, asset: "animated", script: null, collision: null, destinationLayer: null, source: d.source, mapAnimation: d };
    map.map!.entities.push(e); map.map!.groups!.entity_default!.entities.push(structuredClone(e));
    map.characterAssets.push("animated"); map.developmentProfile!.mapAnimatedEntities = WEB_FIELD_MAP_ANIMATION;
    return sealBatchContent(map);
  });
  for (const map of maps) f.world.maps[map.mapId]!.contentHash = map.contentHash;
  const world = sealBatchContent(f.world), [map, target] = maps;
  const content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle,
    sourceMap: f.sourceMap, world, map: map!, battle: f.battle, entrance: map!.partyEntry!.pointIns[0]!.id });
  const game = await GameSession.prepareFrameworkNewGame(content, world, map!, f.battle, { battleHandoff: "prepared" });
  const flow = new GameFlow(game); flow.start(); flow.observeHost(ready); flow.advance(10, ready);
  const refs = { kind: "game-content-refs-v2" as const, profile: "framework" as const,
    world: { url: "/framework/world/catalog.json", contentHash: world.contentHash }, source: null, development: null,
    initialized: { entry: { url: "/framework/animated-entry.json", contentHash: content.contentHash },
      battle: { url: "/framework/animated-battle.json", contentHash: f.battle.contentHash } } };
  const files = new Map<string, unknown>([[refs.world.url, world], [refs.initialized.entry.url, content],
    [refs.initialized.battle.url, f.battle], ...maps.map(m => [world.maps[m.mapId]!.url, m] as [string, unknown])]);
  const repo = new GameContentRepository(async url => { assert.ok(files.has(url)); return structuredClone(files.get(url)); }, "framework", refs);
  return { ...f, world, map: map!, target: target!, maps, content, game, flow, repo };
}
test("failed/cancelled/retried map preparation keeps the old animation owner and commits exactly one next owner", async () => {
  const f = await mapFixture(), actor = f.game.field.actors["500"]!, entity = actor.native!.entity;
  f.game.advance(70); const before = actor.animation!.snapshot(), owned = f.game.state.snapshot();
  assert.equal(f.game.field.startEvent("go-world"), true);
  let fail = true, hold = false, release!: () => void, reached!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { reached = resolve; });
  const loader = new GameMapLoader(f.flow, f.repo, { prepare: async () => {
    if (hold) { reached(); await waiting; } if (fail) throw new Error("Controlled animated media failure"); return null;
  }, discard() {} });
  assert.equal((await loader.load()).status, "failed");
  assert.equal(f.game.field.actors["500"], actor); assert.equal(actor.native!.entity, entity);
  assert.deepEqual(actor.animation!.snapshot(), before); assert.deepEqual(f.game.state.snapshot(), owned);
  fail = false; hold = true; const pending = loader.load(); await entered; loader.cancel(); release();
  assert.equal((await pending).status, "cancelled"); assert.equal(f.game.field.actors["500"], actor);
  assert.deepEqual(actor.animation!.snapshot(), before); assert.deepEqual(f.game.state.snapshot(), owned);
  hold = false; assert.equal((await loader.load()).status, "committed"); f.flow.advance(10, ready);
  const next = f.game.field.actors["500"]!; assert.notEqual(next, actor); assert.notEqual(next.native!.entity, entity);
  assert.equal(next.native!.scope!.kind, "map-animated"); assert.equal(next.native!.entity.character, false);
  assert.deepEqual(actor.animation!.snapshot(), before, "retired actor must not be rebound or advanced");
  const checkpoint = f.game.checkpoint(), restored = GameSession.restore(checkpoint, undefined, f.battle,
    { catalog: f.world, map: f.target, initialized: { content: f.content, initialMap: f.map } }, { battleHandoff: "prepared" });
  assert.deepEqual(restored.checkpoint(), checkpoint); assert.deepEqual(restored.field.actors["500"]!.animation!.snapshot(), next.animation!.snapshot());
  restored.field.startEvent("world-return"); assert.equal(restored.world.commit(restored.world.prepare(f.world, f.map)), true);
  restored.advance(10); assert.notEqual(restored.field.actors["500"]!.native!.entity, next.native!.entity);
});
test("late original initializer failure and forged native view permission never partially publish animated actors", async () => {
  const f = await mapFixture(true), field = f.game.field, before = f.game.checkpoint(), actor = field.actors["500"]!;
  field.startEvent("go-world"); const owned = f.game.state.snapshot(), animation = actor.animation!.snapshot();
  assert.throws(() => f.game.world.prepare(f.world, f.target), /initializer failed/);
  assert.equal(f.game.field, field); assert.equal(field.actors["500"], actor);
  assert.deepEqual(f.game.state.snapshot(), owned); assert.deepEqual(actor.animation!.snapshot(), animation);
  const stable = await mapFixture(), save = stable.game.checkpoint();
  const forged = structuredClone(save), native = Reflect.get(forged.world.field, "native")?.actors;
  assert.ok(native, "same existing native checkpoint must own animated payloads");
  const entry = native.actors.find((a: { id: string }) => a.id === "500"); assert.ok(entry);
  Reflect.set(entry, "character", true);
  assert.throws(() => GameSession.restore(forged, undefined, stable.battle,
    { catalog: stable.world, map: stable.map, initialized: { content: stable.content, initialMap: stable.map } }, { battleHandoff: "prepared" }), /character|identity|checkpoint|native/i);
  assert.deepEqual(stable.game.checkpoint(), save); assert.ok(before);
});


test("prepared map transfer fences source-bound animated metadata on the current owner", async () => {
  const f = await mapFixture(), field = f.game.field, owned = f.game.state.snapshot();
  field.startEvent("go-world"); const candidate = f.game.world.prepare(f.world, f.target);
  field.actors["500"]!.native!.mapAnimation!.zOffset++;
  assert.equal(f.game.world.commit(candidate), false, "existing World commit reports stale candidate without publication");
  assert.equal(f.game.field, field); assert.deepEqual(f.game.state.snapshot(), owned);
});
