import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { GameState } from "../src/core/game-state.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { FieldFadeState } from "../src/core/field-fade.js";
import { createSourceNativeState } from "../src/core/source-native-state.js";
import { worldFieldContent } from "../src/core/world-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { sourceNewGameFixture, reservedFlag, fallbackFlag } from "./fixtures/source-new-game.js";

function title() {
  const f = sourceNewGameFixture(), entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const original = f.fade.snapshot(), start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" });
  assert.deepEqual(f.fade.snapshot(), original);
  start.commit();
  let fade = start.fade;
  assert.equal(entry.prepareResume(fade, true), null, "cached map readiness cannot finish the real title fade");
  fade.advance(0.5);
  for (const phase of ["scene-loading", "scene-activated", "field-preparing"] as const) {
    const next = entry.prepareResume(fade, true);
    assert.ok(next); next.commit(); fade = next.fade;
    assert.equal(entry.phase, phase);
  }
  return { f, entry, fade };
}

test("fresh preparation retains complete origin and native metadata without development condition seeds", () => {
  const { f, fade } = title(), beforeFade = fade.snapshot(), before = structuredClone(f.content);
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const saved = game.state.snapshot();
  assert.equal(saved.formatVersion, 10);
  assert.equal(saved.initialization, "source-new-game");
  assert.deepEqual(saved.nativeState, createSourceNativeState(f.plan));
  assert.equal(saved.nativeState!.kind, "source-native-state-v2");
  assert.deepEqual(saved.roster.map((member) => member.conditionIds), [[]]);
  assert.deepEqual(game.state.fieldPuppetRoster.current(), { owned: [{ ownedId: 1, sourceId: 2,
    enabled: true, conditionTypes: [] }], party: [1, 0, 0, 0] });
  const development = new GameState(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions);
  assert.deepEqual(development.fieldPuppetRoster.current().owned[0]!.conditionTypes, [607]);
  assert.equal(development.initialization, "development-checkpoint");
  assert.equal(development.nativeState, null);
  assert.deepEqual(saved.equipmentStock, f.plan.owned.equipmentStock);
  assert.deepEqual(saved.items, f.plan.owned.items);
  assert.deepEqual(saved.learnedAbilityIds, f.plan.owned.learnedAbilityIds);
  assert.deepEqual(saved.characterNames, f.plan.owned.characterNames);
  assert.deepEqual(game.battlePreferences, f.plan.battlePreferences);
  assert.deepEqual(game.field.player.native!.entity.position, { x: -104, y: 56, z: 349 });
  assert.equal(game.field.cameraSnapshot!.target, "player");
  assert.equal(game.field.entrySynchronized, false);
  assert.equal(game.field.eventState.read(reservedFlag), 0);
  assert.equal(game.field.eventState.read(fallbackFlag), 0);
  assert.notEqual(game.field.fader, fade);
  assert.deepEqual(fade.snapshot(), beforeFade);
  assert.deepEqual(f.content, before);
  assert.throws(() => game.newGamePreparation(false), /incomplete/);
});

test("ordinary title protocol launches the reserved script once and bypasses the map initializer", () => {
  const { f, entry, fade } = title();
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const receipt = game.newGamePreparation(true), fadeBefore = game.field.fader.snapshot();
  const transaction = entry.prepareLaunch(fade, receipt);
  assert.equal(entry.phase, "field-preparing");
  game.launchNewGame(transaction.launch);
  transaction.commit();
  assert.equal(entry.phase, "launched");
  assert.equal(game.field.stop, null);
  assert.equal(game.field.eventState.read(reservedFlag), 1);
  assert.equal(game.field.eventState.read(fallbackFlag), 0);
  assert.equal(game.field.cameraSnapshot!.target, "dummy");
  assert.equal(game.field.entrySynchronized, false);
  game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.field.busy, false);
  assert.equal(game.field.cameraSnapshot!.target, "player");
  assert.equal(game.field.entrySynchronized, true);
  assert.equal(game.field.eventState.read(fallbackFlag), 0);
  assert.deepEqual(game.field.fader.snapshot(), { ...fadeBefore, tween: null },
    "the completed title FadeOut only retires its coroutine; the reserved branch does not invent FadeIn");
  assert.throws(() => game.launchNewGame(transaction.launch), /No pending/);
  assert.throws(() => transaction.commit(), /Stale or repeated/);
});

test("mismatched launch fade, source presentation, route and script identity reject before VM publication", () => {
  for (const change of ["fade", "presentation", "map", "entrance", "script", "script-hash", "fallback"] as const) {
    const { f, entry, fade } = title();
    const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
    const transaction = entry.prepareLaunch(fade, game.newGamePreparation(true));
    const bad = { ...transaction.launch, sourcePresentation: { ...transaction.launch.sourcePresentation } };
    if (change === "fade") bad.fade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
      rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
    if (change === "presentation") Object.assign(bad.sourcePresentation, { origin: "loaded-game" });
    if (change === "map") bad.mapId++;
    if (change === "entrance") bad.entrance++;
    if (change === "script") bad.scriptName = "fallback";
    if (change === "script-hash") bad.scriptContentHash = "0".repeat(64);
    if (change === "fallback") Object.assign(bad, { fallbackBranch: "run-map-initializer" });
    const before = { owned: game.state.snapshot(), events: game.field.eventState.snapshot(),
      camera: game.field.cameraSnapshot, fade: game.field.fader.snapshot(), player: game.field.player };
    assert.throws(() => game.launchNewGame(bad), /Invalid source new-game launch|lost.*fade\/presentation/, change);
    assert.deepEqual(game.state.snapshot(), before.owned, change);
    assert.deepEqual(game.field.eventState.snapshot(), before.events, change);
    assert.deepEqual(game.field.cameraSnapshot, before.camera, change);
    assert.deepEqual(game.field.fader.snapshot(), before.fade, change);
    assert.equal(game.field.player, before.player, change);
    assert.equal(game.field.busy, false, change);
    assert.equal(game.field.stop, null, change);
    assert.equal(entry.phase, "field-preparing", change);
    // The failed launch did not consume the prepared session or protocol.
    game.launchNewGame(transaction.launch); transaction.commit();
    assert.equal(game.field.eventState.read(reservedFlag), 1, change);
  }
});

test("source package, factory, route and foot provider failures never mutate the prior fade or development session", () => {
  for (const change of ["battle", "world", "map", "source", "route", "factory", "view", "presentation", "missing-foot", "unknown-foot"] as const) {
    const { f, fade } = title(), prior = checkpointFixture().game, checkpoint = prior.checkpoint(), oldField = prior.field;
    const beforeFade = fade.snapshot();
    if (change === "battle") f.content.battleCatalogHash = "wrong";
    if (change === "world") f.content.worldCatalogHash = "wrong";
    if (change === "map") f.content.mapContentHash = "wrong";
    if (change === "source") f.content.sourceSetHash = "wrong";
    if (change === "route") f.content.entry.entrance++;
    if (change === "factory") Object.assign(f.content.factory.playerPrefab, { childEntityObject: "unresolved" });
    if (change === "view") f.content.view.contextId = "wrong";
    if (change === "presentation") Object.assign(f.presentation, { origin: "loaded-game" });
    if (change === "missing-foot") delete f.map.nativeFoot;
    if (change === "unknown-foot") f.map.nativeFootBlockers = [{ reason: "Controlled unknown foot provider", source: f.source }];
    assert.throws(() => GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation),
      /binding mismatch|provider is unavailable|actor prefab|ordinary actor view|presentation|foot provider/, change);
    assert.deepEqual(fade.snapshot(), beforeFade, change);
    assert.equal(prior.field, oldField, change);
    assert.deepEqual(prior.checkpoint(), checkpoint, change);
  }
});

test("a source owned snapshot cannot acquire the development field codec through an outer save", () => {
  const f = sourceNewGameFixture(), field = checkpointFixture().field;
  f.battle.common.fieldSourceSetHash = field.sourceSetHash;
  const development = new GameSession(field, f.battle), original = development.checkpoint();
  assert.equal(GameSession.restore(original, field, f.battle).state.initialization, "development-checkpoint");
  const forged = structuredClone(original);
  forged.owned = GameState.createNewGame(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions).snapshot();
  assert.throws(() => GameSession.restore(forged, field, f.battle), /Checkpoint initialization origin mismatch/);
  assert.deepEqual(development.checkpoint(), original);
});

test("source PointIn placement does not invent collision data or grant legacy entry and later walking", () => {
  const { f, entry, fade } = title();
  f.map.map!.collisions = {};
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  assert.deepEqual(game.field.content.map.collisions, {});
  assert.deepEqual(game.field.player.native!.entity.position, { x: -104, y: 56, z: 349 });
  const request = { mapId: f.map.mapId, entrance: f.content.entry.entrance, birdview: false };
  const traveler = { asset: game.field.content.entry.player.asset,
    mount: game.field.content.entry.player.mount, transportationId: game.field.transportationId };
  for (const sourceCamera of [false, true]) {
    assert.throws(() => worldFieldContent(f.world, f.map, request, traveler,
      f.content.parentSourceSetHash, undefined, undefined, sourceCamera),
    /Unsupported entrance geometry\/layer/, "A camera capability alone cannot grant source actor placement");
  }
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  const readStop = () => game.field.stop;
  assert.equal(game.field.busy, false); assert.equal(game.field.stop, null);
  assert.equal(game.field.movementBlocker, null);
  const position = { ...game.field.player.native!.entity.position }, before = game.state.snapshot();
  assert.equal(game.field.move("right"), false);
  assert.equal(readStop()?.kind, "unsupported");
  assert.match(readStop()!.message, /Unsupported collision value undefined/);
  assert.deepEqual(game.field.player.native!.entity.position, position);
  assert.equal(game.field.player.motion, null);
  assert.deepEqual(game.field.content.map.collisions, {});
  assert.deepEqual(game.state.snapshot(), before);
});

test("fresh actors gain stable Web saves but retain missing map-dependency gates after a completed reserved script", () => {
  const { f, entry, fade } = title();
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  assert.equal(game.field.busy, false); assert.equal(game.field.entrySynchronized, true);
  assert.equal(game.checkpointReady, true);
  const saved = game.checkpoint();
  assert.equal(saved.origin.kind, "source-new-game");
  const before = game.state.snapshot(), player = game.field.player, oldField = game.field;
  game.field.previewMap(f.map.mapId, f.content.entry.entrance);
  assert.throws(() => game.world.prepare(f.world, f.map), /Missing source map actor entry/);
  assert.equal(game.field, oldField); assert.equal(game.field.player, player);
  assert.deepEqual(game.state.snapshot(), before);
});

test("source condition refresh uses the existing native actors and publishes the camera offset with owned state", () => {
  const { f, entry, fade } = title();
  f.battle.gameState.partyActors!.conditionTypes[9007] = 607;
  f.battle.gameState.partyActors!.viewpointOffsets = [{ fieldAssetId: 2, x: 3, y: 16 }];
  f.map.scriptSystemFlags = { reserved: { keepBadStatusVisual: false } };
  f.map.scripts.reserved = [{ kind: "owned-condition", script: "reserved", index: 0, source: f.source,
    command: { kind: "add-condition", conditionType: 607, target: 0 }, dependencies: [] },
  { kind: "wait", seconds: 0, script: "reserved", index: 1, source: f.source },
  { kind: "exit", script: "reserved", index: 2, source: f.source }];
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const player = game.field.player, entity = player.native!.entity, oldAnimation = entity.animation;
  const identities = Object.values(game.field.actors).map((actor) => [actor.id, actor, actor.native!.entity] as const);
  const position = { ...entity.position }, layer = entity.layer, direction = entity.direction;
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit();
  assert.equal(game.field.stop, null);
  assert.deepEqual(game.state.snapshot().roster[0]!.conditionIds, [9007]);
  assert.deepEqual(game.field.cameraOffset, { x: 3, y: 16 });
  assert.equal(player.native!.fieldAssetId, 2, "607 has no fabricated field sprite replacement");
  assert.notEqual(entity.animation, oldAnimation);
  assert.deepEqual(entity.position, position); assert.equal(entity.layer, layer); assert.equal(entity.direction, direction);
  assert.equal(player.native!.charaZOffset, 0.5);
  for (const [id, actor, nativeEntity] of identities) {
    assert.equal(game.field.actors[id], actor); assert.equal(actor.native!.entity, nativeEntity);
  }
  game.advance(10); assert.equal(game.field.stop, null); assert.equal(game.field.entrySynchronized, true);
});

test("missing source animation admission cannot partly apply a native condition or camera write", () => {
  const { f, entry, fade } = title();
  f.battle.gameState.partyActors!.conditionTypes[9007] = 607;
  f.battle.gameState.partyActors!.viewpointOffsets = [{ fieldAssetId: 2, x: 3, y: 16 }];
  f.map.scriptSystemFlags = { reserved: { keepBadStatusVisual: false } };
  f.map.scripts.reserved = [{ kind: "wait", seconds: 0, script: "reserved", index: 0, source: f.source },
  { kind: "owned-condition", script: "reserved", index: 1, source: f.source,
    command: { kind: "add-condition", conditionType: 607, target: 0 }, dependencies: [] }];
  delete f.content.animationKeys.assets.bravo;
  f.world.nativeAnimationKeys = structuredClone(f.content.animationKeys);
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit();
  const before = game.state.snapshot(), player = game.field.player, animation = player.animation,
    offset = game.field.cameraOffset;
  game.advance(10);
  assert.equal(game.field.stop?.kind, "unsupported");
  assert.match(game.field.stop!.message, /source animation/);
  assert.deepEqual(game.state.snapshot(), before);
  assert.equal(game.field.player, player); assert.equal(player.animation, animation);
  assert.equal(game.field.cameraOffset, offset);
});

test("ordinary native map handoff stages persistent residents and rejects a stale hidden actor before commit", () => {
  for (const stale of [false, true]) {
    const { f, entry, fade } = title();
    f.world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
    const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
    const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
    game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
    const resident = Object.values(game.field.actors).find((actor) => actor.id.startsWith("native:resident:"))!;
    assert.ok(resident);
    resident.native!.entity.position = { x: 96, y: 120, z: 349 };
    const oldField = game.field, before = game.state.snapshot();
    game.field.previewMap(f.map.mapId, f.content.entry.entrance);
    const prepared = game.world.prepare(f.world, f.map);
    assert.equal(game.field, oldField);
    assert.deepEqual(game.state.snapshot(), before);
    assert.deepEqual(prepared.field.actors[resident.id]!.native!.entity.position, resident.native!.entity.position);
    assert.notEqual(prepared.field.actors[resident.id]!.native!.entity, resident.native!.entity);
    assert.equal(prepared.field.cameraSnapshot!.target, "player", "completed destination initializer selects the actual player");
    if (stale) resident.native!.entity.position.x += 16;
    assert.equal(game.world.commit(prepared), !stale);
    if (stale) {
      assert.equal(game.field, oldField); assert.deepEqual(game.state.snapshot(), before);
    } else {
      assert.equal(game.field, prepared.field);
      game.advance(10);
      assert.equal(game.field.stop, null); assert.equal(game.field.entrySynchronized, true);
      assert.equal(game.field.cameraSnapshot!.target, "player");
      assert.deepEqual(game.field.actors[resident.id]!.native!.entity.position, { x: 96, y: 120, z: 349 });
      assert.equal(game.checkpointReady, true, "stable native maps have a separately validated Web codec");
    }
  }
});

test("native HidePlayer followed by ChangeMap retains the real visibility owner across PointIn", () => {
  const { f, entry, fade } = title();
  f.world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  f.map.initializer = null;
  f.map.scripts.reserved = [
    { kind: "player-visibility", command: { kind: "hide-player" }, script: "reserved", index: 0, source: f.source },
    { kind: "change-map", request: { mapId: f.map.mapId, entrance: f.content.entry.entrance,
      continuation: null, birdview: false, skipFade: false, skipBgm: true, origin: "script" },
    script: "reserved", index: 1, source: f.source },
  ];
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit();
  assert.equal(game.field.stop?.kind, "map-transition");
  assert.equal(game.field.player.native!.entity.visible, false);
  assert.equal(game.field.hiddenEntities.has(game.field.player.id), false, "legacy hidden set is not the native owner");
  const previous = game.field, prepared = game.world.prepare(f.world, f.map);
  assert.equal(game.field, previous); assert.equal(game.field.isEntityVisible(game.field.player.id), false);
  assert.equal(prepared.field.isEntityVisible(prepared.field.player.id), false);
  assert.equal(game.world.commit(prepared), true);
  assert.equal(game.field.isEntityVisible(game.field.player.id), false);
});
