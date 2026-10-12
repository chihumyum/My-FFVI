import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { GameState } from "../src/core/game-state.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { FieldFadeState } from "../src/core/field-fade.js";
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
  assert.equal(saved.formatVersion, 8);
  assert.equal(saved.initialization, "source-new-game");
  assert.deepEqual(saved.nativeState, { kind: "source-native-state-v1", entrySeed: f.plan.entry, ...f.plan.nativeInitialization });
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
    if (change === "missing-foot") delete f.map.map!.entryContext;
    if (change === "unknown-foot") f.map.map!.entryContext!.foot = { kind: "unresolved", reason: "Controlled unknown foot", source: f.source };
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
  assert.throws(() => GameSession.restore(forged, field, f.battle), /Source new-game restore requires the native actor\/world checkpoint codec/);
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

test("fresh actors retain explicit stable-save and next-map gates after a successfully completed reserved script", () => {
  const { f, entry, fade } = title();
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  assert.equal(game.field.busy, false); assert.equal(game.field.entrySynchronized, true);
  assert.equal(game.checkpointReady, false);
  assert.throws(() => game.checkpoint(), /Cannot save/);
  const before = game.state.snapshot(), player = game.field.player, oldField = game.field;
  game.field.previewMap(f.map.mapId, f.content.entry.entrance);
  assert.throws(() => game.world.prepare(f.world, f.map), /Native actor map handoff requires.*factory and codec/);
  assert.equal(game.field, oldField); assert.equal(game.field.player, player);
  assert.deepEqual(game.state.snapshot(), before);
});
