import test from "node:test";
import assert from "node:assert/strict";
import type { DevelopmentProfile } from "../src/core/development-profile.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { GameSession } from "../src/core/game-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { assertSourceEntryProfiles, type SourceEntryProfileDependency } from "../src/core/source-catalog.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

function profile(letter: string): DevelopmentProfile {
  return { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: letter.repeat(64), omissions: [], transportation: "walking-magitek-framework-v1" };
}

test("source entry profiles admit plain source dependencies and reject each implicit development or walking policy", () => {
  assert.equal(assertSourceEntryProfiles({}, {}, {}), "source");
  assert.equal(assertSourceEntryProfiles({}, {}, {}, {}), "source");
  for (const key of ["world", "initialMap", "destinationMap"] as const) {
    const deps: Record<"entry" | "world" | "initialMap" | "destinationMap", SourceEntryProfileDependency> =
      { entry: {}, world: {}, initialMap: {}, destinationMap: {} };
    deps[key].developmentProfile = profile("a");
    const before = structuredClone(deps);
    assert.throws(() => assertSourceEntryProfiles(deps.entry, deps.world, deps.initialMap, deps.destinationMap),
      /profile mismatch/, key);
    assert.deepEqual(deps, before);
  }
  for (const key of ["entry", "world", "initialMap", "destinationMap"] as const) {
    const deps: Record<"entry" | "world" | "initialMap" | "destinationMap", SourceEntryProfileDependency> =
      { entry: {}, world: {}, initialMap: {}, destinationMap: {} };
    deps[key].walkEncounters = { kind: "controlled-walking-policy" };
    assert.throws(() => assertSourceEntryProfiles(deps.entry, deps.world, deps.initialMap, deps.destinationMap),
      /profile mismatch/, key);
  }
});

test("explicit framework documents may name distinct source hashes while retaining one transportation variant", () => {
  const deps = { entry: { developmentProfile: profile("a") }, world: { developmentProfile: profile("b") },
    initialMap: { developmentProfile: profile("c") }, destinationMap: { developmentProfile: profile("d") } };
  const before = structuredClone(deps);
  assert.equal(assertSourceEntryProfiles(deps.entry, deps.world, deps.initialMap, deps.destinationMap), "framework");
  for (const key of ["world", "initialMap", "destinationMap"] as const) {
    const missing = structuredClone(deps);
    const { [key]: _, ...other } = missing;
    assert.throws(() => assertSourceEntryProfiles(other.entry, key === "world" ? {} : deps.world,
      key === "initialMap" ? {} : deps.initialMap, key === "destinationMap" ? {} : deps.destinationMap),
    /profile mismatch/, key);
    const mixed = structuredClone(deps);
    delete mixed[key].developmentProfile.transportation;
    assert.throws(() => assertSourceEntryProfiles(mixed.entry, mixed.world, mixed.initialMap, mixed.destinationMap),
      /profile mismatch/, key);
  }
  assert.deepEqual(deps, before);
});

test("an invalid explicit dependency cannot borrow a valid entry's framework authority", () => {
  const malformed = { developmentProfile: { ...profile("b"), sourceContentHash: "unknown" } };
  assert.throws(() => assertSourceEntryProfiles({ developmentProfile: profile("a") }, malformed,
    { developmentProfile: profile("c") }), /development profile mismatch/);
  assert.throws(() => assertSourceEntryProfiles({}, null as unknown as SourceEntryProfileDependency, {}),
    /profile mismatch: world/);
});

test("ordinary flat display authority must match the entry and every map dependency", () => {
  const dep = (letter: string) => ({ developmentProfile: {
    ...profile(letter), fieldPresentation: "framework-ordinary-field-flat-v1" as const,
  } });
  const deps = { entry: dep("a"), world: dep("b"), initialMap: dep("c"), destinationMap: dep("d") };
  assert.equal(assertSourceEntryProfiles(deps.entry, deps.world, deps.initialMap, deps.destinationMap), "framework");
  for (const key of ["world", "initialMap", "destinationMap"] as const) {
    const missing = structuredClone(deps);
    delete (missing[key].developmentProfile as DevelopmentProfile).fieldPresentation;
    const before = structuredClone(missing);
    assert.throws(() => assertSourceEntryProfiles(missing.entry, missing.world, missing.initialMap, missing.destinationMap),
      /profile mismatch/, key);
    assert.deepEqual(missing, before);
  }
  const inherited = { developmentProfile: profile("c") };
  assert.throws(() => assertSourceEntryProfiles(deps.entry, deps.world, inherited), /profile mismatch/);
  assert.throws(() => assertSourceEntryProfiles({}, {}, deps.initialMap), /profile mismatch/);
});

async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...payload } = JSON.parse(JSON.stringify(value)) as T;
  return { ...payload, contentHash: await contentDigest(payload) } as T;
}

async function packages(lane: "source" | "framework" | "mixed", destinationLane?: "source" | "framework") {
  const f = sourceNewGameFixture();
  f.world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  if (lane !== "source") {
    f.map.developmentProfile = profile("a");
    f.world.developmentProfile = profile("b");
  }
  if (lane === "framework") f.content.developmentProfile = profile("c");
  f.map = await seal(f.map);
  f.world.maps[String(f.map.mapId)]!.contentHash = f.map.contentHash;
  let destination: typeof f.map | undefined;
  if (destinationLane) {
    destination = structuredClone(f.map);
    destination.mapId = 902;
    destination.map!.identity!.mapId = 902; destination.partyEntry!.mapId = 902;
    destination.map!.entryContext!.mapId = 902; destination.actorView!.contextId = "e".repeat(64);
    if (destinationLane === "framework") destination.developmentProfile = profile("d");
    else delete destination.developmentProfile;
    destination = await seal(destination);
    f.world.maps[902] = { ...f.world.maps[String(f.map.mapId)]!, contentHash: destination.contentHash,
      url: "/controlled-destination.json" };
  }
  f.world = await seal(f.world); f.battle = await seal(f.battle);
  f.content = await seal({ ...f.content, battleCatalogHash: f.battle.contentHash,
    worldCatalogHash: f.world.contentHash, mapContentHash: f.map.contentHash });
  return { f, destination };
}

function title(f: ReturnType<typeof sourceNewGameFixture>) {
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
  let fade = start.fade; fade.advance(0.5);
  for (let i = 0; i < 3; i++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
  return { entry, fade };
}

function start(f: ReturnType<typeof sourceNewGameFixture>) {
  const { entry, fade } = title(f);
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
  return game;
}

function pendingState(game: GameSession) {
  return { owned: game.state.snapshot(), events: game.field.eventState.snapshot(), fade: game.field.fader.snapshot(),
    camera: game.field.cameraSnapshot, stop: structuredClone(game.field.stop), transitions: structuredClone(game.world.transitions) };
}

function expectPreparationFailure(game: GameSession, prepare: () => unknown, reason: RegExp) {
  const field = game.field, before = pendingState(game), original = game.state.prepareFieldState;
  let drafts = 0;
  game.state.prepareFieldState = () => { drafts++; return original.call(game.state); };
  try { assert.throws(prepare, reason); }
  finally { game.state.prepareFieldState = original; }
  assert.equal(drafts, 0, "profile/catalog admission precedes owned draft and candidate script preparation");
  assert.equal(game.field, field); assert.deepEqual(pendingState(game), before);
}

test("correctly hashed source and explicit framework entries both prepare and restore without changing lane", async () => {
  for (const lane of ["source", "framework"] as const) {
    const { f } = await packages(lane), before = structuredClone({ entry: f.content, world: f.world, map: f.map, battle: f.battle });
    const game = start(f), saved = game.checkpoint();
    const restored = GameSession.restore(saved, undefined, f.battle,
      { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } });
    assert.equal(game.field.transportationPresentation, lane === "framework" ? "framework-development" : undefined);
    assert.equal(restored.field.transportationPresentation, game.field.transportationPresentation);
    assert.deepEqual(restored.checkpoint(), saved);
    assert.deepEqual({ entry: f.content, world: f.world, map: f.map, battle: f.battle }, before);
  }
});

test("rehashing mixed documents cannot grant framework transportation to an undeclared source entry", async () => {
  const { f } = await packages("mixed"), { fade } = title(f);
  assert.equal(f.content.developmentProfile, undefined);
  const before = structuredClone({ entry: f.content, world: f.world, map: f.map, battle: f.battle }), oldFade = fade.snapshot();
  assert.throws(() => GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation),
    /profile mismatch/);
  assert.deepEqual({ entry: f.content, world: f.world, map: f.map, battle: f.battle }, before);
  assert.deepEqual(fade.snapshot(), oldFade);
});

test("source-origin restore rejects a rehashed undeclared entry before reconstructing actors or changing held state", async () => {
  const { f } = await packages("framework"), game = start(f), held = game.checkpoint();
  const candidateEntry = structuredClone(f.content); delete candidateEntry.developmentProfile;
  const entry = await seal(candidateEntry), candidate = structuredClone(held);
  // Deliberately forged matching headers isolate the profile admission gate;
  // this is not an offered save migration and never relabels the owned catalog.
  candidate.origin = { kind: "source-new-game", sourceContentHash: entry.contentHash };
  candidate.world.initialHash = entry.contentHash; candidate.world.field.contentHash = entry.contentHash;
  const before = structuredClone(candidate);
  assert.throws(() => GameSession.restore(candidate, undefined, f.battle,
    { catalog: f.world, map: f.map, source: { content: entry, initialMap: f.map } }), /profile mismatch/);
  assert.deepEqual(candidate, before); assert.deepEqual(game.checkpoint(), held);
});

test("legal source and explicit framework transitions retain one bound catalog and round-trip their actual destination", async () => {
  for (const lane of ["source", "framework"] as const) {
    const { f, destination } = await packages(lane, lane), game = start(f);
    assert.ok(destination);
    game.field.previewMap(destination.mapId, f.content.entry.entrance);
    assert.equal(game.world.commit(game.world.prepare(f.world, destination)), true);
    game.advance(10); assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
    const held = game.checkpoint();
    assert.equal(held.world.location!.mapId, destination.mapId);
    const restore = () => GameSession.restore(held, undefined, f.battle,
      { catalog: f.world, map: destination, source: { content: f.content, initialMap: f.map } });
    assert.deepEqual(restore().checkpoint(), held);
    assert.deepEqual(game.checkpoint(), held);
  }
});

test("source map preparation rejects an indexed framework destination before any owned draft or partial publication", async () => {
  const { f, destination } = await packages("source", "framework"), game = start(f);
  assert.ok(destination); game.field.previewMap(destination.mapId, f.content.entry.entrance);
  expectPreparationFailure(game, () => game.world.prepare(f.world, destination), /profile mismatch: destination map/);
});

test("a source session binds its catalog before the first map and retains it after an initial-location restore", async () => {
  const { f, destination } = await packages("source", "source"), game = start(f);
  assert.ok(destination);
  const held = game.checkpoint(), restored = GameSession.restore(held, undefined, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } });
  assert.equal(held.world.location, null);
  const anotherCatalog = await seal({ ...f.world, limitations: [...f.world.limitations, "Different catalog"] });
  assert.notEqual(anotherCatalog.contentHash, f.world.contentHash);
  for (const session of [game, restored]) {
    session.field.previewMap(destination.mapId, f.content.entry.entrance);
    expectPreparationFailure(session, () => session.world.prepare(anotherCatalog, destination), /Source world catalog changed/);
    assert.equal(session.world.commit(session.world.prepare(f.world, destination)), true);
    session.advance(10); assert.equal(session.field.stop, null); assert.equal(session.checkpointReady, true);
    session.field.previewMap(f.map.mapId, f.content.entry.entrance);
    expectPreparationFailure(session, () => session.world.prepare(anotherCatalog, f.map), /Source world catalog changed/);
  }
});

test("source sessions reject a different correctly hashed framework catalog and target on the first transition", async () => {
  const { f, destination } = await packages("source", "source"), game = start(f);
  assert.ok(destination);
  const target = await seal({ ...destination, developmentProfile: profile("d") });
  const candidateCatalog = structuredClone(f.world);
  candidateCatalog.maps[String(target.mapId)]!.contentHash = target.contentHash;
  const catalog = await seal({ ...candidateCatalog, developmentProfile: profile("b") });
  game.field.previewMap(target.mapId, f.content.entry.entrance);
  expectPreparationFailure(game, () => game.world.prepare(catalog, target), /Source world catalog changed/);
});

test("late edits to the caller's profile and catalog metadata cannot change the captured session origin", async () => {
  const { f, destination } = await packages("framework", "framework"), game = start(f);
  assert.ok(destination);
  const held = game.checkpoint(), originalEntry = structuredClone(f.content), originalWorld = structuredClone(f.world),
    originalMap = structuredClone(f.map), originalDestination = structuredClone(destination);
  f.content.contentHash = "late-entry-identity";
  delete f.content.developmentProfile!.transportation;
  delete f.world.developmentProfile!.transportation;
  delete f.map.developmentProfile!.transportation;
  delete destination.developmentProfile!.transportation;
  assert.deepEqual(game.checkpoint(), held, "checkpoint origin is captured rather than read from the caller's mutable entry");
  game.field.previewMap(destination.mapId, f.content.entry.entrance);
  expectPreparationFailure(game, () => game.world.prepare(f.world, destination), /profile mismatch/);
  f.content.worldCatalogHash = "f".repeat(64); f.world.contentHash = f.content.worldCatalogHash;
  expectPreparationFailure(game, () => game.world.prepare(f.world, destination), /Source world catalog changed/);
  assert.equal(game.world.commit(game.world.prepare(originalWorld, originalDestination)), true);
  game.advance(10); assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
  const after = game.checkpoint();
  assert.deepEqual(after.origin, held.origin);
  assert.deepEqual(GameSession.restore(after, undefined, f.battle,
    { catalog: originalWorld, map: originalDestination, source: { content: originalEntry, initialMap: originalMap } }).checkpoint(), after);
});

test("direct WorldSession restoration also rejects a mixed destination and preserves the live map and owned state", async () => {
  const { f, destination } = await packages("source", "source"), game = start(f);
  assert.ok(destination);
  game.field.previewMap(destination.mapId, f.content.entry.entrance);
  assert.equal(game.world.commit(game.world.prepare(f.world, destination)), true); game.advance(10);
  const held = game.checkpoint(), field = game.field;
  const wrongTarget = { ...destination, developmentProfile: profile("d") };
  const dependencies = { content: f.content, initialMap: f.map };
  assert.throws(() => GameSession.restore(held, undefined, f.battle,
    { catalog: f.world, map: wrongTarget, source: dependencies }), /profile mismatch: destination map/);
  assert.throws(() => game.world.restore(held.world, f.world, wrongTarget, dependencies), /profile mismatch: destination map/);
  assert.equal(game.field, field); assert.deepEqual(game.checkpoint(), held);
});

test("invalid source world hashes reject before creating any field owner and never become a captured alias", async () => {
  const { f } = await packages("source"), { fade } = title(f), before = fade.snapshot();
  f.content.worldCatalogHash = "not-a-digest"; f.world.contentHash = f.content.worldCatalogHash;
  assert.throws(() => GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation),
    /Invalid source world catalog hash/);
  assert.deepEqual(fade.snapshot(), before);
});
