import test from "node:test";
import assert from "node:assert/strict";
import { frameworkNewGameFixture } from "./fixtures/framework-new-game.js";
import { assertFrameworkNewGameBindings, parseFrameworkNewGameContent, prepareFrameworkNewGameField,
  installFrameworkNewGameActors } from "../src/core/framework-new-game.js";
import { createFreshFieldPartyActorCheckpoint, createFrameworkFieldPartyActorCheckpoint } from "../src/core/field-actor-factory.js";
import { GameState } from "../src/core/game-state.js";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { createSourceNativeState } from "../src/core/source-native-state.js";
import { prepareSourceNewGameField } from "../src/core/source-new-game.js";
import { fieldCameraCellToWorld } from "../src/core/field-camera.js";
import { reservedFlag, fallbackFlag } from "./fixtures/source-new-game.js";

type Fixture = Awaited<ReturnType<typeof frameworkNewGameFixture>>;
const freshState = (f: Fixture) => GameState.createNewGame(f.battle.gameState, f.battle.common.players,
  f.battle.contentHash, f.battle.common.conditions);
function privateField(f: Fixture) {
  const state = freshState(f), prepared = prepareFrameworkNewGameField(f.content, f.world, f.map, f.battle, state);
  const field = new FieldGame(prepared.field, new EventState(prepared.fresh.events), undefined, undefined, {
    nativeActorPreparation: true, partyAppearance: state.fieldPartyAppearance!, puppetRoster: state.fieldPuppetRoster,
    inventory: state.fieldInventory,
  });
  return { state, prepared, field };
}

test("framework placement preserves the complete source initialized owner and original route", async () => {
  const f = await frameworkNewGameFixture(), state = freshState(f), before = state.snapshot();
  const inputs = structuredClone({ content: f.content, world: f.world, map: f.map, battle: f.battle });
  const result = prepareFrameworkNewGameField(f.content, f.world, f.map, f.battle, state);
  assert.equal(f.plan.entry.mapId, 901);
  assert.equal(result.field.map.identity!.mapId, 900001);
  assert.equal(result.field.contentHash, f.content.contentHash);
  assert.deepEqual(result.fresh.entry, f.plan.entry);
  assert.deepEqual(result.fresh.owned, f.plan.owned);
  assert.deepEqual(before.nativeState, createSourceNativeState(f.plan));
  assert.equal(before.initialization, "source-new-game");
  assert.equal(before.formatVersion, 14);
  assert.equal(result.field.entry.transportationId, f.plan.entry.transportation.id);
  const point = f.map.partyEntry!.pointIns[0]!;
  assert.deepEqual(result.plan.player, { x: point.x, y: point.y, layer: point.layer,
    direction: point.direction, visible: true, asset: result.field.entry.player.asset, mount: "" });
  assert.deepEqual(state.snapshot(), before);
  assert.deepEqual({ content: f.content, world: f.world, map: f.map, battle: f.battle }, inputs);
  result.fresh.owned.roster[0]!.hp = 0;
  result.plan.checkpoint.context.player.fieldAssetId = 999;
  assert.deepEqual(state.snapshot(), before, "Placement projections cannot mutate the owned initializer");
});

test("the source factory route cannot be bypassed by the explicit framework wrapper", async () => {
  const f = await frameworkNewGameFixture(), state = freshState(f), party = state.fieldPartyAppearance!.current();
  const input = { catalog: state.fieldPartyAppearance!.catalog, fresh: f.plan, party,
    map: f.map.partyEntry!, playerId: "-1001" };
  assert.throws(() => createFreshFieldPartyActorCheckpoint({ ...input, factory: f.content.factory }), /Invalid fresh native/);
  const actual = createFrameworkFieldPartyActorCheckpoint({ ...input, content: f.content });
  assert.equal(actual.context.player.fieldAssetId, null);
  assert.equal(actual.context.currentTransport!.id, f.plan.entry.transportation.id);
  const changed = structuredClone(party); changed.parties[0]![0]!.row = "front";
  assert.throws(() => createFrameworkFieldPartyActorCheckpoint({ ...input, party: changed, content: f.content }), /ownership/);
  assert.throws(() => prepareSourceNewGameField(f.sourceEntry, f.world, f.map, f.sourceBattle, state, undefined),
    /binding mismatch|provider is unavailable/);
  assert.equal(f.plan.entry.mapId, 901);
});

test("initialized placement does not promote a legacy owner or accept another catalog owner", async () => {
  const f = await frameworkNewGameFixture();
  const legacy = new GameState(f.battle.gameState, f.battle.common.players, f.battle.contentHash, f.battle.common.conditions);
  const before = legacy.snapshot();
  assert.equal(legacy.nativeState, null);
  assert.throws(() => prepareFrameworkNewGameField(f.content, f.world, f.map, f.battle, legacy), /source initialized owner/);
  assert.deepEqual(legacy.snapshot(), before);
  const other = GameState.createNewGame(f.battle.gameState, f.battle.common.players, "a".repeat(64), f.battle.common.conditions);
  assert.throws(() => prepareFrameworkNewGameField(f.content, f.world, f.map, f.battle, other), /source initialized owner/);
});

test("complete native installation uses the actual player, camera and initialized dormant actors", async () => {
  const f = await frameworkNewGameFixture(), { state, prepared, field } = privateField(f), before = state.snapshot();
  assert.equal(field.player.native, undefined);
  installFrameworkNewGameActors(field, f.content, state, f.map);
  const point = f.map.partyEntry!.pointIns[0]!, range = f.map.partyEntry!.mapRange;
  assert.deepEqual(field.player.native!.entity.position,
    fieldCameraCellToWorld(range, { x: point.x - range.x, y: point.y - range.y }, point.layer));
  assert.equal(field.player.native!.entity.direction, point.direction);
  assert.equal(field.player.native!.entity.viewBinding!.map, f.content.view.contextId);
  assert.equal(field.cameraSnapshot!.target, "player");
  assert.equal(field.entrySynchronized, false);
  assert.deepEqual(field.partyActorCheckpoint, prepared.plan.checkpoint);
  assert.ok(Object.values(field.actors).every(actor => actor.native !== undefined));
  for (const id of ["native:puppet:0", "native:puppet:1", "native:party:0", "native:party:1", "native:party:2"])
    assert.deepEqual(field.actors[id]!.native!.entity.position, f.content.factory.offMapPosition);
  assert.deepEqual(state.snapshot(), before);
  assert.equal(field.eventState.read(reservedFlag), 0);
  assert.equal(field.eventState.read(fallbackFlag), 0);
  assert.equal(field.eventState.read(f.initializerFlag), 0, "Actor installation does not execute map scripts");
  assert.throws(() => installFrameworkNewGameActors(field, f.content, state, f.map), /fresh bound field/);
});

test("late missing native media rejects before replacing the private field player or owned state", async () => {
  const f = await frameworkNewGameFixture(), { state, field } = privateField(f);
  const player = field.player, actors = { ...field.actors }, before = state.snapshot();
  delete field.content.characters.frog;
  assert.throws(() => installFrameworkNewGameActors(field, f.content, state, f.map), /animation binding|media/);
  assert.equal(field.player, player);
  assert.equal(field.player.native, undefined);
  assert.deepEqual(field.actors, actors);
  assert.equal(field.options.puppetActors, undefined);
  assert.deepEqual(state.snapshot(), before);
});

test("cross package, profile and PointIn identities reject without changing the owner", async () => {
  const f = await frameworkNewGameFixture(), state = freshState(f), before = state.snapshot();
  const changes: [string, (data: Pick<Fixture, "content" | "world" | "map" | "battle">) => void][] = [
    ["battle pin", data => { data.content.battleCatalogHash = "a".repeat(64); }],
    ["world pin", data => { data.content.worldCatalogHash = "a".repeat(64); }],
    ["map pin", data => { data.content.mapContentHash = "a".repeat(64); }],
    ["source identity", data => { data.map.sourceSetHash = "other-source"; }],
    ["media identity", data => { data.map.mediaSourceSetHash = "other-media"; }],
    ["profile", data => { delete data.map.developmentProfile; }],
    ["transport policy", data => { data.world.developmentProfile!.transportation = "walking-magitek-framework-v1"; }],
    ["entry identity", data => { data.content.entry.mapId++; }],
    ["duplicate PointIn", data => { data.map.partyEntry!.pointIns.push(structuredClone(data.map.partyEntry!.pointIns[0]!)); }],
    ["PointIn geometry", data => { data.map.partyEntry!.pointIns[0]!.x++; }],
    ["PointIn provenance", data => { data.map.partyEntry!.pointIns[0]!.source.file = "other"; }],
  ];
  for (const [name, change] of changes) {
    const data = structuredClone({ content: f.content, world: f.world, map: f.map, battle: f.battle });
    change(data);
    assert.throws(() => prepareFrameworkNewGameField(data.content, data.world, data.map, data.battle, state),
      /identity mismatch|profile mismatch|PointIn source mismatch/, name);
    assert.deepEqual(state.snapshot(), before, name);
  }
});

test("necessary actor, camera, foot and animation inputs cannot be replaced by missing providers", async () => {
  const f = await frameworkNewGameFixture(), state = freshState(f), before = state.snapshot();
  const cases = ["view", "camera", "foot", "animation", "factory", "native blocker", "source animation"] as const;
  for (const name of cases) {
    const data = structuredClone({ content: f.content, world: f.world, map: f.map, battle: f.battle });
    if (name === "view") delete data.map.actorView;
    if (name === "camera") delete data.map.cameraHost;
    if (name === "foot") delete data.map.nativeFoot;
    if (name === "animation") delete data.world.nativeAnimationKeys;
    if (name === "factory") data.content.factory.sources[0]!.sha256 = "unknown";
    if (name === "native blocker") data.map.nativeCompositionBlockers = [{ reason: "Controlled unresolved composition", source: f.source }];
    if (name === "source animation") {
      delete data.content.animationKeys.assets.bravo;
      data.world.nativeAnimationKeys = structuredClone(data.content.animationKeys);
    }
    assert.throws(() => prepareFrameworkNewGameField(data.content, data.world, data.map, data.battle, state),
      /unavailable|factory source identity|unresolved composition/, name);
    assert.deepEqual(state.snapshot(), before, name);
  }
});

test("framework entry metadata is strict detached data and grants no alternate source route", async () => {
  const f = await frameworkNewGameFixture(), before = structuredClone(f.content);
  const parsed = parseFrameworkNewGameContent(f.content);
  parsed.entry.mapId++; parsed.factory.sources[0]!.file = "other";
  assert.deepEqual(f.content, before);
  assert.throws(() => parseFrameworkNewGameContent({ ...f.content, reservedScript: "fake-source-route" }), /fields/);
  assert.throws(() => parseFrameworkNewGameContent({ ...f.content, initializerHash: "unknown" }), /hash/);
  assert.throws(() => parseFrameworkNewGameContent({ ...f.content, developmentProfile: undefined }), /explicit development/);
  assert.throws(() => parseFrameworkNewGameContent({ ...f.content, provenance: { ...f.content.provenance,
    kind: "source-map-reachable" } }), /provenance/);
  let getterReads = 0;
  const accessed = { ...f.content };
  Object.defineProperty(accessed, "entry", { enumerable: true, get: () => { getterReads++; return f.content.entry; } });
  assert.throws(() => parseFrameworkNewGameContent(accessed), /fields/);
  assert.equal(getterReads, 0);
  assertFrameworkNewGameBindings(f.content, f.world, f.map, f.battle);
});
