import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { actorCatalog, actorContext } from "./fixtures/party-actors.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import type { Op } from "../src/field/types.js";

const source = { file: "synthetic", assetPath: "map-entry-integration" };
const op = (value: Record<string, unknown>): Op => ({ ...value, source, script: "entry", index: 0 }) as Op;
function integration(mounted = false) {
  const f = checkpointFixture(), catalog = actorCatalog(), context = actorContext();
  catalog.viewpointOffsets = [];
  catalog.characterAssets = f.game.state.snapshot().roster.map((p, index) => ({ id: index + 1,
    sourceId: p.sourceId, jobId: p.jobId, fieldAssetId: index + 1 }));
  context.player.id = "-1001";
  context.conditionColliders = [];
  if (mounted) {
    catalog.viewpointOffsets.push({ fieldAssetId: 38, x: 0, y: 16 });
    context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 };
    context.player = { id: "-1001", fieldAssetId: 38, riderFieldAssetId: 1, riding: true };
    context.puppets[0] = { id: "puppet:0", fieldAssetId: 38, riderFieldAssetId: 1, riding: true };
  }
  const image = structuredClone(f.field.characters.hero!);
  image.animations.RideL = structuredClone(image.animations.WalkL!);
  image.animations.RideR = structuredClone(image.animations.WalkR!);
  for (const asset of Object.values(catalog.assets)) {
    f.field.characters[asset.asset] = structuredClone(image);
    f.world.characters[asset.asset] = structuredClone(image);
  }
  f.field.entry.player.asset = "alpha";
  f.field.entry.player.mount = mounted ? "armor" : "";
  f.field.entry.transportationId = mounted ? 6 : 1;
  f.field.entry.partyActors = { kind: "field-party-actors-v1", context, playerAssetCacheId: 1 };
  f.battle.gameState.partyActors = catalog;
  f.world.transportation = {
    definitions: [{ id: 1, type: 1, assetId: 0, releaseFlag: 900 },
      { id: 6, type: 12, assetId: 38, releaseFlag: 905 }],
    newGame: { mapId: 1, entrance: 1, scriptId: 0, transportationId: 1 },
  };
  const point = f.target.map!.groups!.entity_default!.entities.find((e) => e.kind === 0)!;
  Object.assign(point, { x: 3, y: 2, layer: 2, direction: "up" });
  f.target.map!.collisions[2] = Array(24).fill(0);
  f.target.partyEntry = { formatVersion: 1, kind: "map-party-entry", mapId: 2,
    width: 6, height: 4, mapRange: { x: 0, y: 0, width: 6, height: 4 }, loopType: 0,
    pointIns: [{ id: 1, x: 3, y: 2, layer: 2, direction: "up", linkObject: 0, source }], conditionColliders: [] };
  f.target.partyEntryBlockers = [];
  f.target.scriptSystemFlags = { init: { keepBadStatusVisual: false } };
  const game = new GameSession(f.field, f.battle);
  game.field.eventState.write({ category: "ScenarioFlag3", index: 45 }, 0);
  game.field.eventState.write({ category: "TreasureFlag4", index: 132 }, 1);
  game.field.eventState.write({ category: "TreasureFlag4", index: 137 }, 1);
  game.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
  return { ...f, game };
}
function cross(f: ReturnType<typeof integration>) {
  f.game.field.previewMap(2, 1);
  const candidate = f.game.world.prepare(f.world, f.target);
  assert.equal(f.game.world.commit(candidate), true);
  f.game.advance(10);
  return candidate;
}

test("source actor world entry uses destination PointIn, preserves visibility and hidden puppet caches", () => {
  for (const mounted of [false, true]) {
    const f = integration(mounted), old = f.game.field;
    const before = old.partyActorCheckpoint!;
    old.hiddenEntities.add("-1001");
    const prepared = cross(f);
    assert.notEqual(f.game.field, old);
    assert.equal(prepared.field, f.game.field);
    assert.deepEqual([f.game.field.player.x, f.game.field.player.y, f.game.field.player.layer, f.game.field.player.direction], [3, 2, 2, "up"]);
    assert.equal(f.game.field.player.motion, null);
    assert.ok(f.game.field.hiddenEntities.has("-1001"));
    assert.deepEqual(f.game.field.partyActorCheckpoint!.context.puppets, before.context.puppets);
    assert.equal(f.game.field.transportationId, mounted ? 6 : 1);
    assert.deepEqual(f.game.field.content.entry.cameraOffset, { x: 0, y: mounted ? 16 : 0 });
    assert.deepEqual(f.game.field.content.scriptSystemFlags?.init, { keepBadStatusVisual: false });
    assert.equal(f.game.world.checkpoint().location!.traveler, null);
    assert.equal(f.game.field.eventState.read({ category: "ScenarioFlag1", index: 8 }), 1);
  }
});

test("entry refreshes the player from candidate owned party without refreshing hidden actors", () => {
  const f = integration();
  const owned = f.game.state.snapshot();
  [owned.party.slots[0]![0], owned.party.slots[0]![1]] = [owned.party.slots[0]![1]!, owned.party.slots[0]![0]!];
  f.game.state.restore(owned);
  const previous = f.game.field.partyActorCheckpoint!;
  cross(f);
  assert.equal(f.game.field.player.asset, "bravo");
  assert.deepEqual(f.game.field.partyActorCheckpoint!.context.puppets, previous.context.puppets);
  assert.equal(f.game.field.partyActorCheckpoint!.playerAssetCacheId, 2);
});

test("map actor preparation shares inventory draft and discards failed initialization", () => {
  const f = integration(), before = f.game.state.snapshot(), old = f.game.field;
  f.target.scripts.init = [op({ kind: "inventory", command: { kind: "grant-item", id: 10, count: 2 }, result: null, dependencies: [] }),
    op({ kind: "blocked", mnemonic: "unimplemented", reason: "source continuation unavailable" })];
  old.previewMap(2, 1);
  assert.throws(() => f.game.world.prepare(f.world, f.target), /source continuation unavailable/);
  assert.equal(f.game.field, old);
  assert.deepEqual(f.game.state.snapshot(), before);
  f.target.scripts.init[1] = op({ kind: "exit" });
  const a = f.game.world.prepare(f.world, f.target), b = f.game.world.prepare(f.world, f.target);
  assert.deepEqual(f.game.state.snapshot(), before);
  assert.equal(f.game.world.commit(a), true);
  assert.equal(f.game.world.commit(a), false);
  assert.equal(f.game.world.commit(b), false);
  assert.equal(f.game.state.snapshot().items[0]!.count, 2);
});

test("stale owned state or source player change rejects the complete prepared entry", () => {
  for (const change of ["owned", "visibility", "position", "request"] as const) {
    const f = integration(), old = f.game.field;
    old.previewMap(2, 1);
    const next = f.game.world.prepare(f.world, f.target);
    if (change === "owned") f.game.state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
    else if (change === "visibility") old.hiddenEntities.add("-1001");
    else if (change === "request" && old.stop?.kind === "map-transition") old.stop.request.mapId = 999;
    else old.player.x++;
    assert.equal(f.game.world.commit(next), false);
    assert.equal(f.game.field, old);
  }
});

test("unknown source cells, providers and linked PointIn retain the original world", () => {
  const mutations = [
    (f: ReturnType<typeof integration>) => { const s = f.game.field.eventState.snapshot(); s.scenario[2 * 256 + 45] = null;
      f.game.world.restore({ ...f.game.world.checkpoint(), field: { ...f.game.field.checkpoint(), eventState: s } }); },
    (f: ReturnType<typeof integration>) => { f.game.field.eventState.write({ category: "ScenarioFlag3", index: 45 }, 1); },
    (f: ReturnType<typeof integration>) => { f.game.field.eventState.write({ category: "TreasureFlag4", index: 132 }, 0); },
    (f: ReturnType<typeof integration>) => { f.target.partyEntry!.pointIns[0]!.linkObject = 7; },
    (f: ReturnType<typeof integration>) => { f.target.partyEntry!.loopType = 1; },
    (f: ReturnType<typeof integration>) => { f.target.partyEntry!.mapId = 3; },
    (f: ReturnType<typeof integration>) => { delete f.world.transportation; },
    (f: ReturnType<typeof integration>) => { delete f.world.characters.alpha; },
  ];
  for (const mutate of mutations) {
    const f = integration(); mutate(f);
    const old = f.game.field, before = f.game.state.snapshot();
    old.previewMap(2, 1);
    assert.throws(() => f.game.world.prepare(f.world, f.target));
    assert.equal(f.game.field, old);
    assert.deepEqual(f.game.state.snapshot(), before);
  }
});

test("native actor world save restores cache and owned state without replaying initialization", () => {
  for (const mounted of [false, true]) {
    const f = integration(mounted);
    f.target.scripts.init = [op({ kind: "inventory", command: { kind: "grant-item", id: 10, count: 2 }, result: null, dependencies: [] }), op({ kind: "exit" })];
    cross(f);
    f.game.field.hiddenEntities.add("-1001");
    const saved = f.game.checkpoint();
    const restored = GameSession.restore(saved, f.field, f.battle, { catalog: f.world, map: f.target });
    assert.deepEqual(restored.checkpoint(), saved);
    assert.equal(restored.state.snapshot().items[0]!.count, 2);
    assert.equal(restored.field.hiddenEntities.has("-1001"), true);
    assert.deepEqual(restored.field.content.entry.cameraOffset, { x: 0, y: mounted ? 16 : 0 });
    // Unknown current cells remain unknown after restoring an already-admitted
    // map; the next MapSetup must read them again instead of injecting a seed.
    const unknown = structuredClone(saved);
    unknown.world.field.eventState.scenario[2 * 256 + 45] = null;
    const copy = GameSession.restore(unknown, f.field, f.battle, { catalog: f.world, map: f.target });
    copy.field.previewMap(2, 1);
    assert.throws(() => copy.world.prepare(f.world, f.target), /Unknown.*switching flag/);
  }
});

test("world save cannot manufacture its own actor origin, transportation or duplicate ownership", () => {
  const f = integration(true); cross(f);
  const saved = f.game.checkpoint();
  const mutations = [
    (s: typeof saved) => { s.world.location!.traveler = { asset: "alpha", mount: "armor", transportationId: 6 }; },
    (s: typeof saved) => { s.world.field.partyActors!.context.player.fieldAssetId = 1; },
    (s: typeof saved) => { s.world.field.partyActors!.context.puppets[0]!.id = "forged"; },
    (s: typeof saved) => { s.world.field.partyActors!.context.conditionResidents = []; },
    (s: typeof saved) => { s.world.field.partyActors!.context.conditionColliders = [{ id: "forged", collisionType: 0, throughConditionType: 0 }]; },
    (s: typeof saved) => { s.world.field.partyActors!.context.camera.mapArea.width = 99; },
    (s: typeof saved) => { s.world.field.partyActors!.context.currentTransport = { id: 1, typeId: 1, fieldAssetId: 0 }; s.world.field.transportationId = 1; },
    (s: typeof saved) => { s.world.field.partyActors!.context.multiParty[1]!.leaderIndex = 3; },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(saved); mutate(bad);
    assert.throws(() => GameSession.restore(bad, f.field, f.battle, { catalog: f.world, map: f.target }));
  }
  assert.deepEqual(f.game.checkpoint(), saved);
});
