import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { fieldCameraCellToWorld } from "../src/core/field-camera.js";
import { encodeSavedGame, decodeSavedGame } from "../src/core/saved-game.js";
import { worldLoopSessionFixture } from "./fixtures/world-loop-session.js";

const host = { visible: true, mediaReady: true, overlayOpen: false };
async function initialized(options: Parameters<typeof worldLoopSessionFixture>[0] = {}) {
  const f = await worldLoopSessionFixture(options), game = await f.make(), flow = new GameFlow(game);
  flow.start(game); flow.observeHost(host); flow.advance(10, host);
  assert.equal(game.checkpointReady, true);
  return { f, game, flow };
}
const count = (game: GameSession) => game.state.snapshot().items.find(item => item.id === 701)!.count;
function requestWorld(h: Awaited<ReturnType<typeof initialized>>) {
  assert.equal(h.flow.move("right"), true); h.flow.advance(240, host);
  assert.equal(h.game.field.stop?.kind, "map-transition");
  const stop = h.game.field.stop;
  assert.ok(stop?.kind === "map-transition");
  assert.equal(stop.request.mapId, h.f.worldMap.mapId);
  assert.equal(stop.request.birdview, h.f.requestedViewType === 1);
  return stop;
}
function enterWorld(h: Awaited<ReturnType<typeof initialized>>) {
  requestWorld(h);
  const before = count(h.game), old = h.game.field;
  const candidate = h.game.world.prepare(h.f.world, h.f.worldMap);
  assert.equal(h.game.field, old); assert.equal(count(h.game), before);
  assert.equal(h.game.world.commit(candidate), true); h.flow.advance(10, host);
  assert.equal(count(h.game), before + 1); assert.equal(h.game.checkpointReady, true);
  return candidate;
}

test("world entry prepares owned, actors and source view together and commits exactly one initializer", async () => {
  for (const requestedViewType of [0, 1] as const) {
    const h = await initialized({ requestedViewType }), old = h.game.field;
    const playerId = old.player.id, nativeIds = Object.keys(old.actors).sort(), before = h.game.state.snapshot();
    const candidate = enterWorld(h);
    assert.equal(h.game.field, candidate.field); assert.notEqual(h.game.field, old);
    assert.equal(h.game.field.player.id, playerId);
    assert.deepEqual(Object.keys(h.game.field.actors).sort(), nativeIds);
    assert.deepEqual(h.game.state.snapshot().roster, before.roster);
    assert.equal(h.game.field.eventState.read(h.f.initializerRef), 1);
    const view = h.game.field.content.entry.viewPlan!;
    assert.equal(view.isWorld, true); assert.equal(view.requestedViewType, requestedViewType);
    assert.equal(view.mapViewType, requestedViewType); assert.equal(view.presentationViewType, 0);
    assert.equal(view.presentationPolicy, "framework-world-map-flat-v1");
    assert.equal(h.game.world.commit(candidate), false);
    h.flow.advance(10, host); assert.equal(h.game.field.eventState.read(h.f.initializerRef), 1);
  }
});

test("cancelled and competing world candidates preserve the original request and do not duplicate owned grants", async () => {
  const h = await initialized({ requestedViewType: 1 }), stop = requestWorld(h), old = h.game.field;
  const before = h.game.state.snapshot(), first = h.game.world.prepare(h.f.world, h.f.worldMap);
  h.game.world.discard(first);
  assert.equal(h.game.world.commit(first), false); assert.equal(h.game.field, old);
  assert.equal(h.game.field.stop, stop); assert.deepEqual(h.game.state.snapshot(), before);
  const second = h.game.world.prepare(h.f.world, h.f.worldMap), competing = h.game.world.prepare(h.f.world, h.f.worldMap);
  assert.equal(h.game.world.commit(second), true); h.flow.advance(10, host);
  const after = h.game.state.snapshot();
  assert.equal(h.game.world.commit(competing), false); assert.deepEqual(h.game.state.snapshot(), after);
  assert.equal(count(h.game), before.items.find(item => item.id === 701)!.count + 1);
});

test("owned revision changes invalidate a complete world candidate without replacing the old field", async () => {
  const h = await initialized(), stop = requestWorld(h), old = h.game.field;
  const candidate = h.game.world.prepare(h.f.world, h.f.worldMap);
  h.game.state.fieldInventory.prepare({ kind: "grant-item", id: 701, count: 1 }).commit();
  const before = h.game.state.snapshot();
  assert.equal(h.game.world.commit(candidate), false);
  assert.equal(h.game.field, old); assert.equal(h.game.field.stop, stop);
  assert.deepEqual(h.game.state.snapshot(), before);
});

test("failure after private world initialization leaves inventory, native actors and source request intact", async () => {
  const h = await initialized({ initializationFailure: true }), stop = requestWorld(h), old = h.game.field;
  const before = h.game.state.snapshot(), actor = old.player.native!.entity,
    position = structuredClone(actor.position), checkpoint = old.partyActorCheckpoint;
  assert.throws(() => h.game.world.prepare(h.f.world, h.f.worldMap), /Controlled world initializer failed/);
  assert.equal(h.game.field, old); assert.equal(h.game.field.stop, stop);
  assert.equal(h.game.field.player.native!.entity, actor); assert.deepEqual(actor.position, position);
  assert.deepEqual(h.game.field.partyActorCheckpoint, checkpoint); assert.deepEqual(h.game.state.snapshot(), before);
});

test("native world input wraps both axes, publishes canonical endpoints and restores view without reinitializing", async () => {
  const h = await initialized({ requestedViewType: 1 }); enterWorld(h);
  const game = h.game, width = h.f.worldMap.map!.width, height = h.f.worldMap.map!.height;
  assert.deepEqual([game.field.player.x, game.field.player.y], [width - 1, height - 1]);
  const playerId = game.field.player.id, before = game.state.snapshot();
  assert.equal(h.flow.move("right"), true); h.flow.advance(120, host);
  assert.ok(game.field.player.motion); assert.equal(game.checkpointReady, false);
  h.flow.advance(120, host);
  assert.deepEqual([game.field.player.x, game.field.player.y], [0, height - 1]);
  assert.equal(h.flow.move("down"), true); h.flow.advance(240, host);
  assert.deepEqual([game.field.player.x, game.field.player.y], [0, 0]);
  assert.equal(game.field.player.steps, 2); assert.equal(game.field.player.id, playerId);
  assert.deepEqual(game.field.player.native!.entity.position,
    fieldCameraCellToWorld(h.f.worldMap.partyEntry!.mapRange, { x: 0, y: 0 }, game.field.player.layer));
  assert.deepEqual(game.state.snapshot(), before, "Controlled walking has no invented resource or progress changes");
  const saved = game.checkpoint();
  assert.equal(saved.world.field.kind, "idle-field-v11");
  assert.deepEqual(saved.world.field.viewPlan, game.field.content.entry.viewPlan);
  const encoded = await encodeSavedGame(saved, 74), decoded = await decodeSavedGame(encoded);
  const restored = GameSession.restore(decoded.checkpoint, undefined, h.f.battle,
    { catalog: h.f.world, map: h.f.worldMap, initialized: { content: h.f.content, initialMap: h.f.map } },
    { battleHandoff: "prepared" });
  assert.notEqual(restored.state, game.state); assert.notEqual(restored.field, game.field);
  assert.deepEqual(restored.checkpoint(), saved);
  restored.advance(10); assert.deepEqual(restored.state.snapshot(), saved.owned);
  assert.equal(restored.field.eventState.read(h.f.initializerRef), 1);
  const flow = new GameFlow(restored); flow.start(restored); flow.observeHost(host);
  assert.equal(flow.move("left"), true); flow.advance(240, host);
  assert.deepEqual([restored.field.player.x, restored.field.player.y], [width - 1, 0]);
  assert.equal(restored.field.player.steps, 3);
  assert.equal(restored.field.content.entry.viewPlan!.requestedViewType, 1);
});

test("a looping world returns through an actual trigger and restores the ordinary map view", async () => {
  const h = await initialized({ requestedViewType: 1 }); enterWorld(h);
  const playerId = h.game.field.player.id, nativeIds = Object.keys(h.game.field.actors).sort();
  for (const direction of ["right", "down", "right", "down"] as const) {
    assert.equal(h.flow.move(direction), true); h.flow.advance(240, host);
  }
  const previous = h.game.field, before = count(h.game), stop = previous.stop;
  assert.ok(stop?.kind === "map-transition");
  assert.deepEqual([previous.player.x, previous.player.y], [1, 1]);
  assert.equal(stop.request.mapId, h.f.map.mapId); assert.equal(stop.request.birdview, false);
  const candidate = h.game.world.prepare(h.f.world, h.f.map);
  assert.equal(h.game.field, previous); assert.equal(count(h.game), before);
  assert.equal(h.game.world.commit(candidate), true); h.flow.advance(10, host);
  assert.equal(h.game.field.content.map.identity!.mapId, h.f.map.mapId);
  assert.equal(h.game.field.player.id, playerId); assert.deepEqual(Object.keys(h.game.field.actors).sort(), nativeIds);
  assert.equal(count(h.game), before + 1, "Normal map loading executes the declared initializer once");
  assert.equal(h.game.field.content.entry.viewPlan!.isWorld, false);
  assert.equal(h.game.field.content.entry.viewPlan!.mapViewType, 0);
  assert.equal(h.game.checkpointReady, true);
  const saved = h.game.checkpoint();
  const restored = GameSession.restore(saved, undefined, h.f.battle,
    { catalog: h.f.world, map: h.f.map, initialized: { content: h.f.content, initialMap: h.f.map } });
  assert.deepEqual(restored.checkpoint(), saved);
  restored.advance(10); assert.equal(count(restored), count(h.game));
});

test("event saves preserve the world view and resume only the post-save owned effect", async () => {
  const h = await initialized({ requestedViewType: 1 }); enterWorld(h);
  const before = count(h.game);
  for (const direction of ["right", "down", "right", "right"] as const) {
    assert.equal(h.flow.move(direction), true); h.flow.advance(240, host);
  }
  assert.deepEqual([h.game.field.player.x, h.game.field.player.y], [2, 0]);
  const request = h.game.eventSaveRequest;
  assert.ok(request); assert.equal(count(h.game), before + 1);
  const candidate = h.game.prepareEventSave(request), saved = candidate.checkpoint;
  assert.equal(saved.world.kind, "event-world-v1");
  assert.equal(saved.world.field.kind, "event-field-v2");
  assert.deepEqual(saved.world.field.viewPlan, h.game.field.content.entry.viewPlan);
  const encoded = await encodeSavedGame(saved, 75), decoded = await decodeSavedGame(encoded);
  const restored = GameSession.restore(decoded.checkpoint, undefined, h.f.battle,
    { catalog: h.f.world, map: h.f.worldMap, initialized: { content: h.f.content, initialMap: h.f.map } });
  assert.equal(restored.eventSaveRequest, null); assert.equal(count(restored), before + 1);
  let stored: string | null = null;
  candidate.commitWith(() => { stored = encoded; });
  assert.equal(stored, encoded); assert.equal(h.game.eventSaveRequest, null); assert.equal(count(h.game), before + 1);
  h.flow.advance(10, host); restored.advance(10);
  assert.equal(count(h.game), before + 2); assert.equal(count(restored), before + 2);
  assert.equal(h.game.field.eventState.read(h.f.initializerRef), 1);
  assert.deepEqual(restored.checkpoint(), h.game.checkpoint());
  restored.advance(10); assert.equal(count(restored), before + 2);
});

test("restoring a world checkpoint rejects changed source view, topology or undeclared presentation", async () => {
  const h = await initialized({ requestedViewType: 1 }); enterWorld(h);
  const saved = h.game.checkpoint(), world = { catalog: h.f.world, map: h.f.worldMap,
    initialized: { content: h.f.content, initialMap: h.f.map } };
  for (const change of ["source", "policy", "loop"] as const) {
    const wrong = structuredClone(saved);
    assert.equal(wrong.world.field.kind, "idle-field-v11");
    if (change === "source") wrong.world.field.viewPlan!.mapViewType = 0;
    if (change === "policy") wrong.world.field.viewPlan!.presentationPolicy = null;
    if (change === "loop") wrong.world.field.viewPlan!.loop.horizontal = false;
    assert.throws(() => GameSession.restore(wrong, undefined, h.f.battle, world), /view|projection|loop|mismatch/);
    assert.deepEqual(h.game.checkpoint(), saved);
  }
});
