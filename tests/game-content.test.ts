import assert from "node:assert/strict";
import test from "node:test";
import { createBattleFormationPlan } from "../src/core/battle-formations.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { GameContentRepository, fieldMediaUrls, openingMediaUrls, sessionMediaUrls,
  sourceEntryMediaUrls } from "../src/core/game-content.js";
import type { GameCheckpoint } from "../src/core/game-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...payload } = JSON.parse(JSON.stringify(value)) as T;
  return { ...payload, contentHash: await contentDigest(payload) } as T;
}
function loader(files: Map<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    read: async (url: string): Promise<unknown> => {
      calls.push(url);
      if (!files.has(url)) throw new Error("Missing fixture: " + url);
      // Deliberately return the same mutable object. The repository owns the
      // snapshot boundary, independent of a host's JSON/cache implementation.
      return files.get(url);
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("framework content uses separate dependency roots and never falls back to strict packages", async () => {
  const f = await freshFixture();
  const profile = (sourceContentHash: string) => ({ kind: "framework-development-v1" as const,
    policy: "omit-anonymous-environment-particles-v1" as const, sourceContentHash, omissions: [] });
  const map = await seal({ ...f.map, developmentProfile: profile(f.map.contentHash) });
  const candidate = structuredClone(f.catalog);
  candidate.maps[String(map.mapId)]!.url = `/framework/world/maps/${map.mapId}.json`;
  candidate.maps[String(map.mapId)]!.contentHash = map.contentHash;
  const catalog = await seal({ ...candidate, developmentProfile: profile(f.catalog.contentHash) });
  const content = await seal({ ...f.content, developmentProfile: profile(f.content.contentHash),
    worldCatalogHash: catalog.contentHash, mapContentHash: map.contentHash });
  const files = new Map(f.files);
  files.set("/framework/world/catalog.json", catalog);
  files.set("/framework/new-game.json", content);
  files.set(`/framework/world/maps/${map.mapId}.json`, map);
  const host = loader(files), framework = new GameContentRepository(host.read, "framework");
  const loaded = await framework.sourceNewGame();
  assert.deepEqual(loaded, { content, catalog, map, battle: f.battle });
  const saved = structuredClone(f.saved);
  saved.origin = { kind: "source-new-game", sourceContentHash: content.contentHash };
  saved.world.initialHash = content.contentHash;
  assert.equal((await framework.restoreWorld(saved))!.source!.content.contentHash, content.contentHash);
  const strict = new GameContentRepository(host.read);
  await assert.rejects(() => strict.restoreWorld(saved), /identity|hash/i);
  await assert.rejects(() => framework.restoreWorld(f.saved), /identity|hash/i);
  files.delete("/framework/new-game.json");
  framework.clear();
  await assert.rejects(() => framework.sourceNewGame(), /Missing fixture/);
  assert.equal((await strict.sourceNewGame()).content.contentHash, f.content.contentHash);
  files.set("/framework/new-game.json", f.content);
  await assert.rejects(() => framework.sourceNewGame(), /profile mismatch/);
});
async function fixture() {
  const f = checkpointFixture();
  const field = await seal(f.field), battle = await seal(f.battle), map = await seal(f.target);
  f.world.maps[String(map.mapId)]!.contentHash = map.contentHash;
  const catalog = await seal(f.world), saved = f.game.checkpoint();
  saved.battleCatalogHash = battle.contentHash;
  saved.world.initialHash = field.contentHash;
  saved.world.field.contentHash = field.contentHash;
  const files = new Map<string, unknown>([
    ["/game/content.json", field], ["/game/battle.json", battle],
    ["/world/catalog.json", catalog], [catalog.maps[String(map.mapId)]!.url, map],
  ]);
  return { field, battle, map, catalog, saved, files };
}
async function freshFixture() {
  const f = sourceNewGameFixture(), opening = checkpointFixture();
  const map = await seal(f.map);
  f.world.maps[String(map.mapId)]!.contentHash = map.contentHash;
  const catalog = await seal(f.world), battle = await seal(f.battle);
  const content = await seal({ ...f.content, battleCatalogHash: battle.contentHash,
    worldCatalogHash: catalog.contentHash, mapContentHash: map.contentHash });
  // This fixture only supplies checkpoint dependency headers. The repository
  // deliberately does not validate or reconstruct owned/field runtime state.
  const saved: GameCheckpoint = { ...opening.game.checkpoint(), sourceSetHash: content.parentSourceSetHash,
    battleCatalogHash: battle.contentHash, origin: { kind: "source-new-game", sourceContentHash: content.contentHash } };
  saved.world.initialHash = content.contentHash;
  const files = new Map<string, unknown>([
    ["/game/new-game.json", content], ["/game/battle.json", battle],
    ["/world/catalog.json", catalog], [catalog.maps[String(map.mapId)]!.url, map],
  ]);
  return { content, catalog, map, battle, saved, files };
}

test("opening verifies both payloads and coalesces concurrent loads without sharing mutable results", async () => {
  const f = await fixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  const [a, b] = await Promise.all([repo.opening(), repo.opening()]);
  assert.equal(host.calls.filter((url) => url === "/game/content.json").length, 1);
  assert.equal(host.calls.filter((url) => url === "/game/battle.json").length, 1);
  a.field.entry.player.x = 99;
  a.battle.common.players[0]!.hp = 1;
  assert.notEqual(b.field.entry.player.x, 99);
  assert.deepEqual((await repo.opening()).battle, f.battle);
  assert.deepEqual((await repo.opening()).field, f.field);
});

test("opening rejects independently signed content from different field sources, then retries repaired files", async () => {
  const f = await fixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  f.files.set("/game/battle.json", await seal({ ...f.battle,
    common: { ...f.battle.common, fieldSourceSetHash: "different-source" } }));
  await assert.rejects(repo.opening(), /Field\/battle source mismatch/);
  f.files.set("/game/battle.json", f.battle);
  assert.equal((await repo.opening()).battle.contentHash, f.battle.contentHash);
  assert.equal(host.calls.filter((url) => url === "/game/battle.json").length, 2);
});

test("fetch, digest and shape failures never become a permanent cached failure", async () => {
  const f = await fixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  f.files.delete("/world/catalog.json");
  await assert.rejects(repo.world(), /Missing fixture/);
  f.files.set("/world/catalog.json", { ...f.catalog, limitations: ["tampered"] });
  await assert.rejects(repo.world(), /Content payload changed/);
  f.files.set("/world/catalog.json", await seal({ ...f.catalog, kind: "wrong-kind" }));
  await assert.rejects(repo.world(), /kind\/version mismatch/);
  f.files.set("/world/catalog.json", f.catalog);
  assert.deepEqual(await repo.world(), f.catalog);
  assert.equal(host.calls.length, 4);
});

test("world/map returns private copies and same URL plus hash is read once", async () => {
  const f = await fixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  const [a, b, catalog] = await Promise.all([repo.map(f.map.mapId), repo.map(f.map.mapId), repo.world()]);
  assert.equal(host.calls.filter((url) => url === "/world/catalog.json").length, 1);
  assert.equal(host.calls.filter((url) => url === f.catalog.maps[String(f.map.mapId)]!.url).length, 1);
  a.map!.entities[0]!.x = 99;
  catalog.maps[String(f.map.mapId)]!.url = "/untrusted.json";
  assert.notEqual(b.map!.entities[0]!.x, 99);
  assert.deepEqual(await repo.map(f.map.mapId), f.map);
  assert.deepEqual(await repo.world(), f.catalog);
});

test("map requires an indexed id and valid supplied catalog before loading its URL", async () => {
  const f = await fixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  await assert.rejects(repo.map(900, f.catalog), /Missing map content dependency/);
  for (const id of [0, -1, 2.5, NaN, 0x80000000])
    await assert.rejects(repo.map(id, f.catalog), /map\/entrance identity/);
  const corrupt = structuredClone(f.catalog);
  corrupt.maps[String(f.map.mapId)]!.url = "/untrusted.json";
  await assert.rejects(repo.map(f.map.mapId, corrupt), /Content payload changed/);
  assert.deepEqual(host.calls, []);
});

test("map rejects content hash conflicts and all source/id/area mismatches", async () => {
  const f = await fixture();
  const variants = [
    { ...f.map, contentHash: "f".repeat(64) },
    await seal({ ...f.map, sourceSetHash: "other" }),
    await seal({ ...f.map, parentSourceSetHash: "other" }),
    await seal({ ...f.map, mediaSourceSetHash: "other" }),
    await seal({ ...f.map, mapId: 9 }),
    await seal({ ...f.map, areaId: 9 }),
    await seal({ ...f.map, map: { ...f.map.map!, identity: { mapId: 9, areaId: f.map.areaId } } }),
  ];
  for (const [index, changed] of variants.entries()) {
    const catalog = structuredClone(f.catalog);
    if (index > 0) catalog.maps[String(f.map.mapId)]!.contentHash = changed.contentHash;
    const bound = await seal(catalog);
    const files = new Map(f.files); files.set(bound.maps[String(f.map.mapId)]!.url, changed);
    await assert.rejects(new GameContentRepository(loader(files).read).map(f.map.mapId, bound),
      /Content identity mismatch|Map package\/source identity mismatch/);
  }
});

test("a changed hash at one URL cannot reuse a different cached map version", async () => {
  const f = await fixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  await repo.map(f.map.mapId, f.catalog);
  const next = await seal({ ...f.map, limitations: ["new revision"] });
  const catalog = structuredClone(f.catalog);
  catalog.maps[String(f.map.mapId)]!.contentHash = next.contentHash;
  f.files.set(catalog.maps[String(f.map.mapId)]!.url, next);
  assert.deepEqual(await repo.map(f.map.mapId, await seal(catalog)), next);
  assert.equal(host.calls.length, 2);
});

test("caller and loader mutation during asynchronous loads cannot change captured package dependencies", async () => {
  const f = await fixture(), waiting = deferred<unknown>(), started = deferred<void>();
  const repo = new GameContentRepository(async () => { started.resolve(); return waiting.promise; });
  const catalog = structuredClone(f.catalog), original = structuredClone(f.map);
  const result = repo.map(f.map.mapId, catalog);
  catalog.maps[String(f.map.mapId)]!.contentHash = "f".repeat(64);
  await started.promise;
  waiting.resolve(f.map);
  const loaded = await result;
  f.map.name = "loader mutation";
  assert.deepEqual(loaded, original);
  assert.deepEqual(await repo.map(original.mapId, f.catalog), original);
});

test("clear invalidates cached and in-flight reads without old completion replacing the new cache", async () => {
  const f = await fixture(), first = deferred<unknown>(), started = deferred<void>();
  const next = await seal({ ...f.catalog, limitations: ["new catalog"] });
  let calls = 0;
  const repo = new GameContentRepository(async () => {
    calls++;
    if (calls === 1) { started.resolve(); return first.promise; }
    return next;
  });
  const old = repo.world();
  await started.promise;
  repo.clear();
  assert.deepEqual(await repo.world(), next);
  first.resolve(f.catalog);
  assert.deepEqual(await old, f.catalog);
  assert.deepEqual(await repo.world(), next);
  assert.equal(calls, 2);
  repo.clear();
  await repo.world();
  assert.equal(calls, 3);
});

test("a cleared in-flight failure cannot evict a replacement cache entry", async () => {
  const f = await fixture(), first = deferred<unknown>(), started = deferred<void>();
  let calls = 0;
  const repo = new GameContentRepository(async () => {
    if (++calls === 1) { started.resolve(); return first.promise; }
    return f.catalog;
  });
  const old = repo.world(), rejected = assert.rejects(old, /network error/);
  await started.promise;
  repo.clear();
  await repo.world();
  first.reject(new Error("network error"));
  await rejected;
  assert.deepEqual(await repo.world(), f.catalog);
  assert.equal(calls, 2);
});

test("fresh entry binds source, world, battle, map and reserved script without requiring the development field", async () => {
  const f = await freshFixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  const [actual, other] = await Promise.all([repo.sourceNewGame(), repo.sourceNewGame()]);
  const expected = { content: f.content, catalog: f.catalog, map: f.map, battle: f.battle };
  assert.deepEqual(actual, expected);
  assert.equal(host.calls.includes("/game/content.json"), false);
  assert.equal(host.calls.length, 4);
  actual.content.entry.mapId = 999;
  actual.map.scripts = {};
  actual.battle.common.players[0]!.hp = 1;
  assert.deepEqual(other, expected);
  assert.deepEqual(await repo.sourceNewGame(), expected);
});

test("a source new game rejects authored formation selection even with matching package identities", async () => {
  const f = await freshFixture(), battle = structuredClone(f.battle);
  const encounter = Object.values(battle.encounters)[0]!;
  encounter.formation = null;
  encounter.formationPlan = createBattleFormationPlan([1, 1, 0, 0, 0, 0], {
    kind: "framework-battle-formations-v1", id: "normal-only", weights: [1, 0, 0, 0, 0, 0],
  });
  const next = await seal(battle);
  f.files.set("/game/battle.json", next);
  f.files.set("/game/new-game.json", await seal({ ...f.content, battleCatalogHash: next.contentHash }));
  await assert.rejects(new GameContentRepository(loader(f.files).read).sourceNewGame(), /Source new game.*formation/);
});

test("a source new game rejects authored escape even when content hashes are rebound", async () => {
  for (const misplaced of [false, true]) {
    const f = await freshFixture(), battle = structuredClone(f.battle);
    const policy = { kind: "framework-battle-escape-v1" as const, id: "ordinary-retreat" };
    if (misplaced) Object.assign(battle.common, { escapePolicy: policy });
    else Object.values(battle.encounters)[0]!.escapePolicy = policy;
    const next = await seal(battle);
    f.files.set("/game/battle.json", next);
    f.files.set("/game/new-game.json", await seal({ ...f.content, battleCatalogHash: next.contentHash }));
    await assert.rejects(new GameContentRepository(loader(f.files).read).sourceNewGame(), /Source new game.*escape/);
  }
});

test("fresh entry refuses stale manifest dependencies, alien parent and a missing reserved script", async () => {
  const f = await freshFixture();
  for (const key of ["battleCatalogHash", "worldCatalogHash", "mapContentHash", "sourceSetHash", "parentSourceSetHash"] as const) {
    const files = new Map(f.files);
    files.set("/game/new-game.json", await seal({ ...f.content, [key]: "f".repeat(64) }));
    await assert.rejects(new GameContentRepository(loader(files).read).sourceNewGame(), /source\/content binding mismatch/);
  }
  const badMap = await seal({ ...f.map, scripts: {} }), catalog = structuredClone(f.catalog);
  catalog.maps[String(badMap.mapId)]!.contentHash = badMap.contentHash;
  const bound = await seal(catalog);
  const files = new Map(f.files);
  files.set("/world/catalog.json", bound);
  files.set(bound.maps[String(badMap.mapId)]!.url, badMap);
  files.set("/game/new-game.json", await seal({ ...f.content, worldCatalogHash: bound.contentHash, mapContentHash: badMap.contentHash }));
  await assert.rejects(new GameContentRepository(loader(files).read).sourceNewGame(), /entry\/script dependency mismatch/);
});

test("development checkpoint resolves no world for its initial map, and the exact indexed world after travel", async () => {
  const f = await fixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  assert.equal(await repo.restoreWorld(f.saved), undefined);
  assert.equal(host.calls.includes("/world/catalog.json"), false);
  f.saved.world.location = { catalogHash: f.catalog.contentHash, mapId: f.map.mapId, entrance: 1, traveler: null };
  assert.deepEqual(await repo.restoreWorld(f.saved), { catalog: f.catalog, map: f.map });
});

test("session restore dependencies retain the development initial field and read only its required origin", async () => {
  const f = await fixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  assert.deepEqual(await repo.restoreSessionContent(f.saved), { initial: f.field, battle: f.battle });
  assert.deepEqual(host.calls.sort(), ["/game/battle.json", "/game/content.json"]);
  f.saved.world.location = { catalogHash: f.catalog.contentHash, mapId: f.map.mapId, entrance: 1, traveler: null };
  assert.deepEqual(await repo.restoreSessionContent(f.saved), {
    initial: f.field, battle: f.battle, world: { catalog: f.catalog, map: f.map },
  });
  assert.equal(host.calls.some((url) => url.includes("new-game")), false);
});

test("source restore content supplies battle and trusted world without constructing or loading a legacy field", async () => {
  const f = await freshFixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  const expected = { battle: f.battle, world: { catalog: f.catalog, map: f.map,
    source: { content: f.content, initialMap: f.map } } };
  const [first, second] = await Promise.all([
    repo.restoreSessionContent(f.saved), repo.restoreSessionContent(f.saved),
  ]);
  assert.deepEqual(first, expected);
  assert.equal(Object.hasOwn(first, "initial"), false);
  assert.equal(host.calls.includes("/game/content.json"), false);
  assert.equal(host.calls.length, 4);
  first.battle.common.players[0]!.hp = 1;
  first.world!.source!.content.entry.mapId = 999;
  first.world!.map.scripts = {};
  assert.deepEqual(second, expected);
  assert.deepEqual(await repo.restoreSessionContent(f.saved), expected);
});

test("source restore rejects a mismatched battle and retries the repaired dependency without clearing caches", async () => {
  const f = await freshFixture(), host = loader(f.files), repo = new GameContentRepository(host.read);
  const differentBattle = await seal({ ...f.battle, limitations: ["different signed battle package"] });
  f.files.set("/game/battle.json", differentBattle);
  await assert.rejects(repo.restoreSessionContent(f.saved), /source\/content binding mismatch/);
  f.files.set("/game/battle.json", f.battle);
  assert.deepEqual((await repo.restoreSessionContent(f.saved)).battle, f.battle);
  assert.equal(host.calls.filter((url) => url === "/game/battle.json").length, 2);
  assert.equal(host.calls.includes("/game/content.json"), false);
  const wrongSave = structuredClone(f.saved); wrongSave.battleCatalogHash = differentBattle.contentHash;
  await assert.rejects(repo.restoreSessionContent(wrongSave), /checkpoint source identity mismatch/);
  assert.deepEqual((await repo.restoreSessionContent(f.saved)).battle, f.battle);
});

test("restore captures its checkpoint before pending reads and retries a missing saved destination", async () => {
  const f = await fixture(), host = loader(f.files), started = deferred<void>(), waiting = deferred<void>();
  const repo = new GameContentRepository(async (url) => {
    if (url === "/game/content.json") { started.resolve(); await waiting.promise; }
    return host.read(url);
  });
  const snapshot = structuredClone(f.saved), pending = repo.restoreSessionContent(f.saved);
  await started.promise;
  f.saved.origin = { kind: "source-new-game", sourceContentHash: "a".repeat(64) };
  f.saved.world.initialHash = "f".repeat(64);
  waiting.resolve();
  assert.deepEqual(await pending, { initial: f.field, battle: f.battle });
  snapshot.world.location = { catalogHash: f.catalog.contentHash, mapId: f.map.mapId, entrance: 1, traveler: null };
  const url = f.catalog.maps[String(f.map.mapId)]!.url;
  f.files.delete(url);
  await assert.rejects(repo.restoreSessionContent(snapshot), /Missing fixture/);
  f.files.set(url, f.map);
  assert.deepEqual((await repo.restoreSessionContent(snapshot)).world, { catalog: f.catalog, map: f.map });
});

test("source checkpoint resolves the original entry separately from the saved destination and reuses hash-bound reads", async () => {
  const f = await freshFixture(), destination = await seal({ ...f.map, mapId: 900, name: "Saved destination",
    map: { ...f.map.map!, identity: { mapId: 900, areaId: f.map.areaId } } });
  f.catalog.maps[900] = { ...f.catalog.maps[String(f.map.mapId)]!, url: "/saved-map.json", contentHash: destination.contentHash };
  f.catalog = await seal(f.catalog);
  f.content = await seal({ ...f.content, worldCatalogHash: f.catalog.contentHash });
  f.saved.origin = { kind: "source-new-game", sourceContentHash: f.content.contentHash };
  f.saved.world.initialHash = f.content.contentHash;
  f.files.set("/world/catalog.json", f.catalog); f.files.set("/game/new-game.json", f.content);
  f.files.set("/saved-map.json", destination);
  const host = loader(f.files), repo = new GameContentRepository(host.read);
  await repo.sourceNewGame();
  const initial = await repo.restoreWorld(f.saved);
  assert.deepEqual(initial, { catalog: f.catalog, map: f.map, source: { content: f.content, initialMap: f.map } });
  f.saved.world.location = { catalogHash: f.catalog.contentHash, mapId: 900, entrance: 1, traveler: null };
  const restored = await repo.restoreWorld(f.saved);
  assert.deepEqual(restored, { catalog: f.catalog, map: destination, source: { content: f.content, initialMap: f.map } });
  assert.deepEqual(await repo.restoreSessionContent(f.saved), { battle: f.battle, world: restored });
  assert.equal(host.calls.includes("/game/content.json"), false);
  assert.equal(host.calls.filter((url) => url === "/game/new-game.json").length, 1);
  assert.equal(host.calls.filter((url) => url === f.catalog.maps[String(f.map.mapId)]!.url).length, 1);
  assert.equal(host.calls.filter((url) => url === "/saved-map.json").length, 1);
});

test("restore rejects changed game/world hashes, unknown map and old save schema", async () => {
  const f = await fixture();
  const variants = [
    { ...f.saved, formatVersion: 3 },
    { ...f.saved, sourceSetHash: "other" },
    { ...f.saved, battleCatalogHash: "f".repeat(64) },
    { ...f.saved, origin: { kind: "unknown" } },
    { ...f.saved, world: { ...f.saved.world, kind: "idle-world-v8" } },
    { ...f.saved, world: { ...f.saved.world, initialHash: "f".repeat(64) } },
    { ...f.saved, world: { ...f.saved.world, location: { catalogHash: "f".repeat(64), mapId: 2, entrance: 1, traveler: null } } },
    { ...f.saved, world: { ...f.saved.world, location: { catalogHash: f.catalog.contentHash, mapId: 900, entrance: 1, traveler: null } } },
  ];
  for (const saved of variants)
    await assert.rejects(new GameContentRepository(loader(f.files).read).restoreWorld(saved as GameCheckpoint),
      /mismatch|Unknown game checkpoint origin|Missing map content dependency/);
  const fresh = await freshFixture();
  fresh.saved.origin = { kind: "source-new-game", sourceContentHash: "f".repeat(64) };
  await assert.rejects(new GameContentRepository(loader(fresh.files).read).restoreWorld(fresh.saved), /Content identity mismatch/);
});

test("media collection includes every existing image channel, deduplicates URLs and leaves inputs untouched", async () => {
  const { field, battle } = await fixture(), source = { file: "synthetic", assetPath: "background", objectId: "1",
    serializedFile: "synthetic", sha256: "a".repeat(64) };
  field.map.textures = { first: "/map.png", shared: "/shared.png" };
  field.map.backgrounds = [{ kind: "native-center-repeat-background-v1", layerId: 0, name: "FarBGLayer",
    source, mapSize: { width: 16, height: 16 }, size: { width: 16, height: 16 }, offset: { x: 0, y: 0 },
    manualSpeed: { x: 0, y: 0 }, renderHost: { kind: "source-fresh-normal-background-host-v1",
      rendererWorld: { x: 0, y: 0 }, renderCamera: { x: 0, y: 0 }, sources: [source] },
    texture: { url: "/background.png", sha256: source.sha256, width: 16, height: 16, source, textureSource: source } }];
  const sprite = field.characters.hero!.sprites.pose!;
  sprite.file = "/actor.png";
  field.minimap = { sourceSetHash: "synthetic", source, icons: { marker: { ...sprite, file: "/minimap.png" } } };
  battle.common.sprites = { shared: { file: "/shared.png", width: 1, height: 1 },
    enemy: { file: "/enemy.png", width: 1, height: 1 } };
  const before = structuredClone({ field, battle });
  assert.deepEqual(fieldMediaUrls(field), ["/map.png", "/shared.png", "/background.png", "/actor.png", "/minimap.png"]);
  const urls = openingMediaUrls(field, battle);
  assert.deepEqual(urls, ["/map.png", "/shared.png", "/background.png", "/actor.png", "/minimap.png", "/enemy.png"]);
  assert.deepEqual(sessionMediaUrls(field, battle), urls);
  const fresh = await freshFixture();
  fresh.map.map = structuredClone(field.map);
  fresh.catalog.characters = structuredClone(field.characters);
  fresh.catalog.minimap = structuredClone(field.minimap);
  fresh.battle = structuredClone(battle);
  const entry = { content: fresh.content, catalog: fresh.catalog, map: fresh.map, battle: fresh.battle };
  const beforeEntry = structuredClone(entry);
  const sourceUrls = sourceEntryMediaUrls(entry);
  assert.deepEqual(sourceUrls, urls);
  sourceUrls.push("/another-mutation.png");
  assert.deepEqual(entry, beforeEntry);
  assert.equal(sourceEntryMediaUrls(entry).includes("/another-mutation.png"), false);
  entry.map.map = null;
  assert.throws(() => sourceEntryMediaUrls(entry), /entry map media is unavailable/);
  urls.push("/mutation.png");
  assert.deepEqual({ field, battle }, before);
  assert.equal(openingMediaUrls(field, battle).includes("/mutation.png"), false);
});
