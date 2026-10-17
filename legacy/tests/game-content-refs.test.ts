import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { parseGameContentRefs } from "../src/core/game-content-refs.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { FieldFadeState } from "../src/core/field-fade.js";
import { createSourcePresentationContext } from "../src/core/source-presentation.js";
import type { SourceEntryContent } from "../src/core/game-content.js";
import { sourceGameContentRefsFixture, developmentGameContentRefsFixture,
  sealGameContentRefsFixture as seal } from "./fixtures/game-content-refs.js";

const runtime = { battleHandoff: "prepared" as const, audioReadiness: { isReady: () => true },
  soundPresentation: { isPresented: () => true } };
const ready = { visible: true, mediaReady: true, overlayOpen: false };
function loader(files: Map<string, unknown>) {
  const calls: string[] = [];
  return { calls, read: async (url: string): Promise<unknown> => {
    calls.push(url); assert.ok(files.has(url), "Unprovided custom dependency: " + url); return files.get(url);
  } };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sourceSession(loaded: SourceEntryContent) {
  const presentation = createSourcePresentationContext({ kind: "title-new-game",
    titleCleanupComplete: true, openingCallbackStarted: false });
  const entry = new NewGameFieldEntry(loaded.content.entry, presentation);
  const initialFade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
    rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
  const start = entry.prepareStart(initialFade, { active: true, callbacks: "absent" }); start.commit();
  let fade = start.fade; fade.advance(0.5);
  for (let i = 0; i < 3; i++) {
    const next = entry.prepareResume(fade, true); assert.ok(next); next.commit(); fade = next.fade;
  }
  const game = GameSession.prepareNewGame(loaded.content, loaded.catalog, loaded.map, loaded.battle,
    fade, presentation, runtime);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  assert.equal(game.checkpointReady, true);
  return game;
}
function stable(game: GameSession) {
  for (let index = 0; index < 50 && !game.checkpointReady; index++) {
    assert.equal(game.field.stop, null); game.advance(10);
  }
  assert.equal(game.checkpointReady, true);
}

test("refs parse into detached source/development pins and do not depend on object realm", async () => {
  const f = await sourceGameContentRefsFixture(), raw = structuredClone(f.refs);
  const parsed = parseGameContentRefs(raw);
  raw.world.url = "/untrusted/world.json"; raw.source!.battle.contentHash = "f".repeat(64);
  assert.deepEqual(parsed, f.refs);
  const foreign = runInNewContext("JSON.parse(payload)", { payload: JSON.stringify(f.refs) });
  assert.deepEqual(parseGameContentRefs(foreign), f.refs);
  const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, f.refs);
  assert.deepEqual(parseGameContentRefs(nullPrototype), f.refs);
  const both = { ...f.refs, development: structuredClone(f.refs.source) };
  assert.deepEqual(parseGameContentRefs(both), both);
});

test("refs reject noncanonical external or ambiguous URLs and require explicit canonical hashes", async () => {
  const f = await sourceGameContentRefsFixture();
  for (const url of ["relative.json", "//other.test/world.json", "https://other.test/world.json",
    "/world/../catalog.json", "/world//catalog.json", "/world/catalog.json?version=1", "/world/catalog.json#x", "/world/%63atalog.json"]) {
    const invalid = structuredClone(f.refs); invalid.world.url = url;
    assert.throws(() => parseGameContentRefs(invalid), /url|URL|reference|refs/i, url);
  }
  for (const contentHash of ["", "f".repeat(63), "F".repeat(64), "g".repeat(64)]) {
    const invalid = structuredClone(f.refs); invalid.source!.battle.contentHash = contentHash;
    assert.throws(() => parseGameContentRefs(invalid), /hash|digest|reference|refs/i);
  }
  assert.throws(() => parseGameContentRefs({ ...f.refs, source: null, development: null }), /entry|reference|refs/i);
});

test("own accessors, symbols and custom prototypes cannot execute a reference getter or invent an entry", async () => {
  const f = await sourceGameContentRefsFixture(); let getters = 0;
  const getter = structuredClone(f.refs);
  Object.defineProperty(getter.world, "url", { enumerable: true, get: () => { getters++; return "/untrusted/world.json"; } });
  const symbol = structuredClone(f.refs); Object.assign(symbol, { [Symbol("hidden-entry")]: f.refs.source });
  const prototype = Object.assign(Object.create({ hostFallback: f.refs.source }) as Record<string, unknown>, f.refs);
  for (const invalid of [getter, symbol, prototype, { ...f.refs, extra: true }])
    assert.throws(() => parseGameContentRefs(invalid), /data|plain|field|reference|refs/i);
  const calls: string[] = [];
  assert.throws(() => new GameContentRepository(async url => { calls.push(url); return null; }, "source", getter));
  assert.equal(getters, 0); assert.deepEqual(calls, []);
});

test("constructor rejects profile conflicts before loading and captures caller refs once", async () => {
  const f = await sourceGameContentRefsFixture(), raw = structuredClone(f.refs), host = loader(f.files);
  assert.throws(() => new GameContentRepository(host.read, "framework", raw), /profile/i);
  assert.deepEqual(host.calls, []);
  const repo = new GameContentRepository(host.read, "source", raw);
  raw.world.url = "/untrusted/world.json"; raw.source!.entry.url = "/untrusted/entry.json";
  raw.source!.battle.contentHash = "f".repeat(64); raw.source = null;
  assert.equal(repo.hasSourceEntry, true); assert.equal(repo.hasDevelopmentEntry, false);
  assert.equal((await repo.sourceNewGame()).content.contentHash, f.content.contentHash);
  assert.ok(host.calls.every(url => f.files.has(url)));
});

test("source-only and development-only refs do not request or fall back to the unrelated entry", async () => {
  const source = await sourceGameContentRefsFixture(), sh = loader(source.files), sr = new GameContentRepository(sh.read, "source", source.refs);
  assert.equal(sr.hasSourceEntry, true); assert.equal(sr.hasDevelopmentEntry, false);
  await assert.rejects(sr.opening(), /development|entry/i); assert.deepEqual(sh.calls, []);
  await sr.sourceNewGame();
  const development = await developmentGameContentRefsFixture(), dh = loader(development.files);
  const dr = new GameContentRepository(dh.read, "source", development.refs);
  assert.equal(dr.hasSourceEntry, false); assert.equal(dr.hasDevelopmentEntry, true);
  await assert.rejects(dr.sourceNewGame(), /source|entry/i); assert.deepEqual(dh.calls, []);
  await dr.opening();
  assert.deepEqual(new Set(dh.calls), new Set([development.refs.development!.entry.url, development.refs.development!.battle.url]));
});

test("restoring an unavailable origin cannot borrow the other entry or a legacy fallback", async () => {
  const source = await sourceGameContentRefsFixture(), development = await developmentGameContentRefsFixture();
  const sourceSaved = sourceSession({ content: source.content, catalog: source.catalog, map: source.map, battle: source.battle }).checkpoint();
  const developmentSaved = new GameSession(development.field, development.battle, 314, runtime).checkpoint();
  const sh = loader(new Map([...source.files, ["/game/content.json", development.field], ["/game/battle.json", development.battle]]));
  const dh = loader(new Map([...development.files, ["/game/new-game.json", source.content], ["/game/source-catalog.json", source.battle]]));
  await assert.rejects(new GameContentRepository(sh.read, "source", source.refs).restoreSessionContent(developmentSaved), /development entry is unavailable/);
  await assert.rejects(new GameContentRepository(dh.read, "source", development.refs).restoreSessionContent(sourceSaved), /source entry is unavailable/);
  assert.deepEqual(sh.calls, []); assert.deepEqual(dh.calls, []);
});

test("custom source roots launch, cross a real native map and restore without any legacy URL", async () => {
  for (const profile of ["source", "framework"] as const) {
    const f = await sourceGameContentRefsFixture(profile), host = loader(f.files);
    const repo = new GameContentRepository(host.read, profile, f.refs), loaded = await repo.sourceNewGame();
    const game = sourceSession(loaded), owned = game.state, world = game.world;
    const flow = new GameFlow(), entries = new GameEntryLoader(flow, { discard: () => {} });
    assert.equal(entries.begin("new-game").commit({ session: game, presentation: null }).status, "committed");
    flow.advance(0, ready);
    game.field.previewMap(f.destination.mapId, f.content.entry.entrance);
    const maps = new GameMapLoader(flow, repo, { prepare: async () => null, discard: () => {} });
    const moved = await maps.load();
    assert.equal(moved.status, "committed", moved.status === "failed" ? String(moved.error) : moved.status); stable(game);
    assert.equal(game.state, owned); assert.equal(game.world, world);
    assert.equal(game.field.content.map.identity!.mapId, f.destination.mapId);
    const saved = game.checkpoint(), dependencies = await repo.restoreSessionContent(saved);
    const restored = GameSession.restore(saved, dependencies.initial, dependencies.battle, dependencies.world, runtime);
    assert.deepEqual(restored.checkpoint(), saved);
    assert.ok(host.calls.every(url => f.files.has(url)), profile);
    assert.equal(host.calls.some(url => url.startsWith("/game/") || url.startsWith("/world/") || url.startsWith("/framework/")), false);
    assert.ok(host.calls.includes(f.refs.source!.battle.url));
    assert.ok(host.calls.includes(f.catalog.maps[String(f.destination.mapId)]!.url));
  }
});

test("custom development roots preserve the checkpoint adapter through map entry and restore", async () => {
  for (const profile of ["source", "framework"] as const) {
    const f = await developmentGameContentRefsFixture(profile), host = loader(f.files);
    const repo = new GameContentRepository(host.read, profile, f.refs), opening = await repo.opening();
    const game = new GameSession(opening.field, opening.battle, 314, runtime), state = game.state;
    const flow = new GameFlow(), entries = new GameEntryLoader(flow, { discard: () => {} });
    assert.equal((await entries.begin("new-game").prepare(() => ({ session: game, presentation: null }))).status, "committed");
    flow.advance(0, ready); game.field.previewMap(f.map.mapId, 1);
    const maps = new GameMapLoader(flow, repo, { prepare: async () => null, discard: () => {} });
    const moved = await maps.load();
    assert.equal(moved.status, "committed", moved.status === "failed" ? String(moved.error) : moved.status); stable(game);
    assert.equal(game.state, state); assert.equal(game.state.initialization, "development-checkpoint");
    const saved = game.checkpoint(), dependencies = await repo.restoreSessionContent(saved);
    assert.equal(dependencies.world!.map.mapId, f.map.mapId);
    const restored = GameSession.restore(saved, dependencies.initial, dependencies.battle, dependencies.world, runtime);
    assert.deepEqual(restored.checkpoint(), saved);
    assert.ok(host.calls.every(url => f.files.has(url))); assert.equal(host.calls.some(url => url.startsWith("/game/")), false);
  }
});

test("host pins and saved hashes intersect instead of allowing a checkpoint to select content", async () => {
  const f = await sourceGameContentRefsFixture(), game = sourceSession({ content: f.content, catalog: f.catalog, map: f.map, battle: f.battle });
  const saved = game.checkpoint();
  for (const change of ["battle", "entry", "world"] as const) {
    const copy = structuredClone(saved), host = loader(f.files), repo = new GameContentRepository(host.read, "source", f.refs);
    if (change === "battle") copy.battleCatalogHash = "f".repeat(64);
    if (change === "entry") {
      assert.equal(copy.origin.kind, "source-new-game");
      if (copy.origin.kind === "source-new-game") copy.origin.sourceContentHash = "f".repeat(64);
    }
    if (change === "world") copy.world.location = { catalogHash: "f".repeat(64), mapId: f.destination.mapId, entrance: 1, traveler: null };
    await assert.rejects(repo.restoreSessionContent(copy), /identity|hash|pin|binding/i, change);
    assert.ok(host.calls.every(url => f.files.has(url)));
  }
});

test("embedded source hashes cannot override host battle or world pins even after valid resealing", async () => {
  const f = await sourceGameContentRefsFixture();
  for (const key of ["battleCatalogHash", "worldCatalogHash"] as const) {
    const content = await seal({ ...f.content, [key]: "f".repeat(64) }), files = new Map(f.files), refs = structuredClone(f.refs);
    refs.source!.entry.contentHash = content.contentHash; files.set(refs.source!.entry.url, content);
    const host = loader(files), repo = new GameContentRepository(host.read, "source", refs);
    await assert.rejects(repo.sourceNewGame(), /identity|hash|pin|binding/i, key);
    assert.ok(host.calls.every(url => files.has(url)));
  }
});

test("custom world pins reject a separately signed supplied catalog while undefined refs retain legacy behavior", async () => {
  const f = await developmentGameContentRefsFixture(), supplied = await seal({ ...f.catalog, limitations: ["A different declared package"] });
  const host = loader(f.files), pinned = new GameContentRepository(host.read, "source", f.refs);
  await assert.rejects(pinned.map(f.map.mapId, supplied), /identity|hash|pin/i);
  assert.deepEqual(host.calls, [], "An unpinned map URL cannot be fetched through a caller-supplied catalog");
  assert.deepEqual(await new GameContentRepository(host.read).map(f.map.mapId, supplied), f.map);
  assert.deepEqual(host.calls, [supplied.maps[String(f.map.mapId)]!.url]);
});

test("rehashed wrong source and profile identities remain blocked underneath valid host pins", async () => {
  const f = await sourceGameContentRefsFixture();
  const wrongSource = await seal({ ...f.content, parentSourceSetHash: "another-source" });
  const wrongProfile = await seal({ ...f.content, developmentProfile: {
    kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
    sourceContentHash: f.content.contentHash, omissions: [] } });
  for (const content of [wrongSource, wrongProfile]) {
    const refs = structuredClone(f.refs), files = new Map(f.files);
    refs.source!.entry.contentHash = content.contentHash; files.set(refs.source!.entry.url, content);
    await assert.rejects(new GameContentRepository(loader(files).read, "source", refs).sourceNewGame(), /source|profile|binding/i);
  }
  const development = await developmentGameContentRefsFixture();
  const battle = await seal({ ...development.battle,
    common: { ...development.battle.common, fieldSourceSetHash: "another-field-source" } });
  development.refs.development!.battle.contentHash = battle.contentHash;
  development.files.set(development.refs.development!.battle.url, battle);
  await assert.rejects(new GameContentRepository(loader(development.files).read, "source", development.refs).opening(), /source mismatch/i);
});

test("save-added URL fields never redirect repository reads and the runtime still rejects the malformed checkpoint", async () => {
  const f = await sourceGameContentRefsFixture(), game = sourceSession({ content: f.content, catalog: f.catalog, map: f.map, battle: f.battle });
  game.field.previewMap(f.destination.mapId, f.content.entry.entrance);
  assert.equal(game.world.commit(game.world.prepare(f.catalog, f.destination)), true); stable(game);
  const saved = game.checkpoint(); Object.assign(saved.origin, { url: "/untrusted/entry.json" });
  Object.assign(saved.world.location!, { url: "/untrusted/world.json" });
  const host = loader(f.files), repo = new GameContentRepository(host.read, "source", f.refs);
  const dependencies = await repo.restoreSessionContent(saved);
  assert.ok(host.calls.every(url => f.files.has(url)));
  assert.throws(() => GameSession.restore(saved, dependencies.initial, dependencies.battle, dependencies.world, runtime), /fields|checkpoint|origin/i);
});

test("custom entry caching coalesces concurrent reads but never shares mutable results", async () => {
  const f = await sourceGameContentRefsFixture(), host = loader(f.files), repo = new GameContentRepository(host.read, "source", f.refs);
  const [first, second] = await Promise.all([repo.sourceNewGame(), repo.sourceNewGame()]);
  assert.equal(host.calls.length, 4); assert.equal(new Set(host.calls).size, 4);
  first.catalog.maps[String(f.map.mapId)]!.url = "/untrusted/map.json";
  first.content.entry.mapId = 999; first.battle.common.players[0]!.hp = 0;
  assert.deepEqual(second, { content: f.content, catalog: f.catalog, map: f.map, battle: f.battle });
  assert.deepEqual(await repo.sourceNewGame(), second); assert.equal(host.calls.length, 4);
});

test("host and caller mutation during a pinned read cannot redirect pending dependencies", async () => {
  const f = await sourceGameContentRefsFixture(), refs = structuredClone(f.refs), original = structuredClone(f.catalog);
  const started = deferred<void>(), waiting = deferred<unknown>(), calls: string[] = [];
  const repo = new GameContentRepository(async url => {
    calls.push(url);
    if (url === f.refs.world.url) { refs.source!.entry.url = "/untrusted/entry.json"; started.resolve(); return waiting.promise; }
    return f.files.get(url);
  }, "source", refs);
  const pending = repo.sourceNewGame(); await started.promise;
  refs.world.contentHash = "f".repeat(64); refs.source!.battle.url = "/untrusted/battle.json";
  waiting.resolve(f.catalog); const loaded = await pending;
  f.catalog.maps[String(f.map.mapId)]!.url = "/untrusted/map.json";
  assert.deepEqual(loaded.catalog, original); assert.ok(calls.every(url => f.files.has(url)));
});

test("network, body and pin failures retry only the same nominated custom package", async () => {
  const f = await developmentGameContentRefsFixture(), host = loader(f.files), repo = new GameContentRepository(host.read, "source", f.refs);
  f.files.delete(f.refs.world.url); await assert.rejects(repo.world(), /Unprovided/);
  f.files.set(f.refs.world.url, { ...f.catalog, limitations: ["corrupt payload"] });
  await assert.rejects(repo.world(), /payload|identity|hash/i);
  f.files.set(f.refs.world.url, await seal({ ...f.catalog, limitations: ["valid different package"] }));
  await assert.rejects(repo.world(), /identity|hash|pin/i);
  f.files.set(f.refs.world.url, f.catalog); assert.deepEqual(await repo.world(), f.catalog);
  assert.deepEqual(host.calls, Array(4).fill(f.refs.world.url));
});

test("a cleared late pinned failure cannot evict the replacement cache entry", async () => {
  const f = await developmentGameContentRefsFixture(), started = deferred<void>(), waiting = deferred<unknown>(); let calls = 0;
  const repo = new GameContentRepository(async url => {
    assert.equal(url, f.refs.world.url);
    if (++calls === 1) { started.resolve(); return waiting.promise; } return f.catalog;
  }, "source", f.refs);
  const old = repo.world(), rejected = assert.rejects(old, /late network failure/); await started.promise;
  repo.clear(); assert.deepEqual(await repo.world(), f.catalog); waiting.reject(new Error("late network failure"));
  await rejected; assert.deepEqual(await repo.world(), f.catalog); assert.equal(calls, 2);
});

test("cancelling a pinned entry keeps the old owner and cannot release a newer Flow ticket", async () => {
  const f = await sourceGameContentRefsFixture(), previous = await developmentGameContentRefsFixture();
  const owner = new GameSession(previous.field, previous.battle, 314, runtime), before = owner.checkpoint();
  const flow = new GameFlow(); flow.start(owner, { paused: true });
  const entries = new GameEntryLoader(flow, { discard: () => {} });
  const started = deferred<void>(), waiting = deferred<unknown>();
  const repo = new GameContentRepository(async url => {
    if (url === f.refs.world.url) { started.resolve(); return waiting.promise; } return f.files.get(url);
  }, "source", f.refs);
  const attempt = entries.begin("new-game"), pending = attempt.prepare(async context => {
    const loaded = await repo.sourceNewGame();
    if (!context.isCurrent()) throw new Error("Obsolete custom entry");
    return { session: sourceSession(loaded), presentation: null };
  });
  await started.promise; attempt.cancel(); const save = flow.beginOperation("save");
  waiting.resolve(f.catalog); assert.equal((await pending).status, "cancelled");
  assert.equal(save.isCurrent(), true); assert.equal(flow.currentSession, owner); assert.equal(flow.paused, true);
  assert.deepEqual(owner.checkpoint(), before); assert.equal((await repo.sourceNewGame()).content.contentHash, f.content.contentHash);
  save.finish();
});
