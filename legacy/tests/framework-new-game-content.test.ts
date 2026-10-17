import assert from "node:assert/strict";
import test from "node:test";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { parseGameContentRefs, type GameContentRefsV2 } from "../src/core/game-content-refs.js";
import { GameSession } from "../src/core/game-session.js";
import { frameworkNewGameFixture } from "./fixtures/framework-new-game.js";
import { sealBatchContent } from "./fixtures/content-batch.js";

async function packageFixture() {
  const f = await frameworkNewGameFixture(), prefix = "/packages/initialized";
  const refs: GameContentRefsV2 = { kind: "game-content-refs-v2", profile: "framework", source: null, development: null,
    world: { url: prefix + "/world.json", contentHash: f.world.contentHash },
    initialized: { entry: { url: prefix + "/entry.json", contentHash: f.content.contentHash },
      battle: { url: prefix + "/battle.json", contentHash: f.battle.contentHash } } };
  const files = new Map<string, unknown>([[refs.world.url, f.world], [refs.initialized!.entry.url, f.content],
    [refs.initialized!.battle.url, f.battle], [f.world.maps[String(f.map.mapId)]!.url, f.map]]);
  const calls: string[] = [];
  const read = async (url: string): Promise<unknown> => {
    calls.push(url); assert.ok(files.has(url), "Undeclared URL: " + url); return structuredClone(files.get(url));
  };
  return { ...f, refs, files, calls, read };
}

test("reference v1 remains exact; v2 explicitly admits only framework initialized entries", async () => {
  const f = await packageFixture(), v1 = { kind: "game-content-refs-v1", profile: "framework", world: f.refs.world,
    source: null, development: f.refs.initialized };
  assert.deepEqual(parseGameContentRefs(v1), v1);
  const parsed = parseGameContentRefs(f.refs);
  assert.deepEqual(parsed, f.refs); f.refs.initialized!.entry.url = "/changed.json";
  assert.notEqual((parsed as GameContentRefsV2).initialized!.entry.url, f.refs.initialized!.entry.url);
  for (const bad of [{ ...v1, initialized: null }, { ...parsed, profile: "source" },
    { ...parsed, initialized: undefined }, { ...parsed, initialized: null },
    { ...parsed, kind: "game-content-refs-v3" },
    { ...parsed, initialized: { entry: { url: "https://untrusted/game.json", contentHash: "a".repeat(64) },
      battle: f.refs.initialized!.battle } }]) assert.throws(() => parseGameContentRefs(bad));
  let invoked = false;
  const accessor = { ...parsed };
  Object.defineProperty(accessor, "initialized", { enumerable: true, get: () => { invoked = true; return null; } });
  assert.throws(() => parseGameContentRefs(accessor)); assert.equal(invoked, false);
});

test("compiler preserves the exact source owned catalogs and original route while binding an authored map", async () => {
  const f = await frameworkNewGameFixture(), before = structuredClone(f);
  const built = await compileFrameworkNewGame({ ...f, world: f.world, entrance: f.content.entry.entrance });
  assert.deepEqual(f, before); assert.deepEqual(built, f.content);
  assert.deepEqual(f.battle.gameState, f.sourceBattle.gameState);
  assert.notEqual(f.content.entry.mapId, f.plan.entry.mapId);
  assert.equal(built.provenance.sourceEntryHash, f.sourceEntry.contentHash);
  assert.equal(built.provenance.sourceMapHash, f.sourceMap.contentHash);
  const changed = structuredClone(f.battle); changed.gameState.initialGil++;
  await assert.rejects(compileFrameworkNewGame({ ...f, world: f.world, battle: sealBatchContent(changed), entrance: 1 }), /owned catalog|initializer/i);
  const wrongEntry = sealBatchContent({ ...f.sourceEntry, battleCatalogHash: "e".repeat(64) });
  await assert.rejects(compileFrameworkNewGame({ ...f, sourceEntry: wrongEntry, world: f.world, entrance: 1 }), /source dependency/);
  const changedMap = structuredClone(f.map); delete changedMap.nativeFoot;
  const map = sealBatchContent(changedMap), world = structuredClone(f.world);
  world.maps[String(map.mapId)]!.contentHash = map.contentHash;
  await assert.rejects(compileFrameworkNewGame({ ...f, map, world: sealBatchContent(world), entrance: f.content.entry.entrance }), /foot/i);
});

test("repository initializes and restores v6 through the same trusted package with actual native owned state", async () => {
  const f = await packageFixture(), repo = new GameContentRepository(f.read, "framework", f.refs);
  assert.equal(repo.hasInitializedEntry, true); assert.equal(repo.hasSourceEntry, false); assert.equal(repo.hasDevelopmentEntry, false);
  const loaded = await repo.initializedNewGame();
  const game = await GameSession.prepareFrameworkNewGame(loaded.content, loaded.catalog, loaded.map, loaded.battle,
    { battleHandoff: "prepared" }, 314);
  assert.ok(game.state.nativeState); assert.equal(game.state.initialization, "source-new-game");
  assert.equal(game.field.stop, null); assert.equal(game.field.checkpointReady, true);
  assert.equal(game.field.content.map.identity!.mapId, f.map.mapId);
  assert.equal(game.field.eventState.read(f.initializerFlag), 1);
  const saved = game.checkpoint(); assert.equal(saved.formatVersion, 6);
  assert.deepEqual(saved.origin, { kind: "framework-new-game", entryContentHash: f.content.contentHash });
  const dependencies = await repo.restoreSessionContent(saved);
  const restored = GameSession.restore(saved, dependencies.initial, dependencies.battle, dependencies.world,
    { battleHandoff: "prepared" });
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.state.snapshot().items.find(item => item.id === 701)?.count,
    (f.plan.owned.items.find(item => item.id === 701)?.count ?? 0) + 1,
    "Authored initialization is not repeated on restore");
  assert.ok(f.calls.every(url => f.files.has(url))); assert.equal(f.calls.some(url => url.startsWith("/game/")), false);
  loaded.content.factory.sources[0]!.file = "tampered";
  assert.deepEqual((await repo.initializedNewGame()).content, f.content, "Caller projections do not replace cached ownership data");
});

test("initialized reads reject a resealed wrong initializer and cannot fall back to source or development", async () => {
  const f = await packageFixture(), content = sealBatchContent({ ...f.content, initializerHash: "e".repeat(64) });
  f.files.set(f.refs.initialized!.entry.url, content); f.refs.initialized!.entry.contentHash = content.contentHash;
  await assert.rejects(new GameContentRepository(f.read, "framework", f.refs).initializedNewGame(), /initializer.*hash/i);
  const { initialized: _, ...base } = f.refs;
  const v1 = { ...base, kind: "game-content-refs-v1" as const, development: f.refs.initialized };
  f.calls.length = 0;
  const legacy = new GameContentRepository(f.read, "framework", v1);
  assert.equal(legacy.hasInitializedEntry, false);
  await assert.rejects(legacy.initializedNewGame(), /initialized entry is unavailable/); assert.deepEqual(f.calls, []);
  assert.throws(() => new GameContentRepository(f.read, "source", f.refs), /profile mismatch/);
});

test("initialized restore pins origin, version and catalog before accepting any saved dependency", async () => {
  const f = await packageFixture(), repo = new GameContentRepository(f.read, "framework", f.refs);
  const game = await GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle, { battleHandoff: "prepared" });
  const saved = game.checkpoint(), malformed = [
    { ...saved, formatVersion: 5 },
    { ...saved, origin: { kind: "source-new-game", sourceContentHash: f.content.contentHash } },
    { ...saved, origin: { kind: "development-checkpoint" } },
    { ...saved, origin: { kind: "framework-new-game", entryContentHash: "e".repeat(64) } },
    { ...saved, battleCatalogHash: "e".repeat(64) },
    { ...saved, world: { ...saved.world, initialHash: "e".repeat(64) } },
  ];
  for (const bad of malformed) {
    f.calls.length = 0;
    await assert.rejects(repo.restoreSessionContent(bad as typeof saved), /version|origin|identity|pin/i);
    assert.deepEqual(f.calls, [], "Save cannot choose an alternative content location");
  }
});

test("a failed initialized dependency evicts the whole queued attempt and supports an unchanged retry", async () => {
  const f = await packageFixture(), mapUrl = f.world.maps[String(f.map.mapId)]!.url;
  let failed = false;
  const repo = new GameContentRepository(async url => {
    if (url === mapUrl && !failed) { failed = true; throw new Error("Controlled map transport failed"); }
    return f.read(url);
  }, "framework", f.refs);
  await assert.rejects(repo.initializedNewGame(), /Controlled map transport failed/);
  const loaded = await repo.initializedNewGame(); assert.deepEqual(loaded.content, f.content);
  assert.equal(f.calls.filter(url => url === f.refs.initialized!.entry.url).length, 2);
  assert.equal(f.calls.filter(url => url === f.refs.world.url).length, 2);
});
