import assert from "node:assert/strict";
import test from "node:test";
import { GameContentHistory, type GameContentHistoryCurrent,
  type GameContentHistoryRestoreOptions } from "../src/core/game-content-history.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { GameContentSessions } from "../src/core/game-content-sessions.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameSession } from "../src/core/game-session.js";
import { resolveGameContentReleaseMedia } from "../src/core/game-content-release.js";
import type { GameContentReleaseIndex } from "../src/core/game-content-release.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { runInNewContext } from "node:vm";
import { contentReleaseSessionFixture, releaseSessionHost as ready,
  releaseSessionRuntime as runtime } from "./fixtures/content-release-session.js";
import { sourceGameContentRefsFixture } from "./fixtures/game-content-refs.js";

type Fixture = Awaited<ReturnType<typeof contentReleaseSessionFixture>>;
function history(f: Fixture, read = f.read, current = f.repository, refs = f.current.refs) {
  return new GameContentHistory({ current, profile: "framework", packageId: f.packageId, refs, loadJson: read });
}
async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...payload } = structuredClone(value);
  return { ...payload, contentHash: await contentDigest(payload) } as T;
}
async function create(selection: GameContentHistoryCurrent) {
  const p = await selection.repository.initializedNewGame();
  return GameSession.prepareFrameworkNewGame(p.content, p.catalog, p.map, p.battle, runtime, 314);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const objectURL = (hash: string) => `/content-releases/objects/${hash}.json`;
function move(flow: GameFlow, direction: "right" | "down") {
  assert.equal(flow.move(direction), true);
  for (let index = 0; flow.session.field.player.motion; index++) {
    assert.ok(index < 200); flow.advance(10, ready);
  }
}
async function active(f: Fixture) {
  const h = history(f), selected = await h.openCurrent(), owner = await create(selected), flow = new GameFlow();
  const contexts = new GameContentSessions(flow, f.repository), entries = new GameEntryLoader<null>(flow, { discard: () => {} });
  contexts.registerCandidate(owner, selected.repository, selected.release);
  assert.equal(entries.begin("new-game").commit({ session: owner, presentation: null }).status, "committed");
  flow.advance(10, ready);
  const maps = new GameMapLoader(flow, contexts, { prepare: async () => null, discard: () => {} });
  move(flow, "right"); assert.equal((await maps.load()).status, "committed"); flow.advance(10, ready);
  assert.equal(owner.checkpointReady, true); assert.notEqual(owner.checkpoint().world.location, null);
  return { h, owner, flow, contexts, entries, maps };
}

test("declared references and prepared selections are detached, while unpinned legacy hosts stay explicit", async () => {
  const f = await contentReleaseSessionFixture(), refs = structuredClone(f.current.refs), h = history(f, f.read, f.repository, refs);
  refs.world.contentHash = "f".repeat(64); refs.initialized!.entry.url = "/changed/entry.json";
  const declared = f.repository.declaredReferences!;
  assert.equal(declared.kind, "game-content-refs-v2");
  if (declared.kind !== "game-content-refs-v2") assert.fail("Expected initialized refs");
  declared.world.url = "/changed/world.json"; declared.initialized!.battle.contentHash = "f".repeat(64);
  assert.deepEqual(f.repository.declaredReferences, f.current.refs);
  const selected = await h.openCurrent();
  assert.notEqual(selected.repository, f.repository); assert.ok(selected.release);
  assert.equal(selected.release.release.id, f.current.release.id);
  selected.release.release.bindings[f.urls.map(f.nextMapId)] = "f".repeat(64);
  assert.equal((await selected.repository.map(f.nextMapId)).contentHash, f.current.nextMap.contentHash);
  assert.equal(f.index.releases[1]!.bindings[f.urls.map(f.nextMapId)], f.current.nextMap.contentHash);
  const legacy = new GameContentRepository(async () => assert.fail("Legacy opening must not infer history I/O"));
  assert.equal(legacy.declaredReferences, undefined);
  const oldHost = new GameContentHistory({ current: legacy, profile: "source", loadJson: async () => assert.fail("No declared archive") });
  assert.deepEqual(await oldHost.openCurrent(), { repository: legacy, release: null });
  const unbound = new GameContentHistory({ current: f.repository, profile: "framework", loadJson: f.read });
  await assert.rejects(unbound.openCurrent(), /trusted package history/);
});

test("a new current session keeps its map and media release when logical URLs are republished", async () => {
  const f = await contentReleaseSessionFixture({ uiMedia: { old: "a".repeat(64), current: "b".repeat(64) } });
  const selected = await history(f).openCurrent(), session = await create(selected), flow = new GameFlow();
  const contexts = new GameContentSessions(flow, f.repository), entries = new GameEntryLoader<null>(flow, { discard: () => {} });
  contexts.registerCandidate(session, selected.repository, selected.release);
  assert.equal(entries.begin("new-game").commit({ session, presentation: null }).status, "committed");
  flow.advance(10, ready); assert.equal(session.checkpointReady, true);
  const owner = session.state, world = session.world, before = owner.snapshot().items.find(item => item.id === 701)!.count;
  // Another completed publication changes every colliding mutable URL. The
  // active session may use only the previously selected immutable closure.
  for (const [url, value] of f.old.files) f.files.set(url, structuredClone(value));
  f.files.set(f.indexUrl, await seal({ ...f.index, currentReleaseId: f.old.release.id }));
  selected.repository.clear();
  f.reads.length = 0;
  const maps = new GameMapLoader(flow, contexts, { prepare: async () => null, discard: () => {} });
  assert.equal(flow.move("right"), true);
  for (let index = 0; session.field.player.motion; index++) {
    assert.ok(index < 200); flow.advance(10, ready);
  }
  assert.equal(session.field.stop?.kind, "map-transition");
  assert.equal((await maps.load()).status, "committed"); flow.advance(10, ready);
  assert.equal(session.state, owner); assert.equal(session.world, world);
  assert.equal(session.field.content.contentHash, f.current.nextMap.contentHash);
  assert.equal(session.state.snapshot().items.find(item => item.id === 701)!.count, before + f.current.grant);
  assert.equal(contexts.release!.release.id, f.current.release.id);
  assert.deepEqual(resolveGameContentReleaseMedia(contexts.release!, f.mediaFiles.nextMap), {
    url: `/content-releases/media/${"b".repeat(64)}.png`, sha256: "b".repeat(64), extension: "png",
  });
  assert.ok(f.reads.length > 0); assert.ok(f.reads.every(url => url.startsWith("/content-releases/objects/")));
  assert.equal(session.checkpoint().world.location?.catalogHash, f.current.world.contentHash);
});

test("declared strict source entries use their fixed archive without gaining a framework profile or mutable URL fallback", async () => {
  const f = await sourceGameContentRefsFixture("source", "/controlled/current-source"), packageId = "controlled-source-current";
  const bindings = Object.fromEntries([...f.files].map(([url, value]) => [url, (value as { contentHash: string }).contentHash]));
  const release = { id: await contentDigest({ refs: f.refs, bindings }), sourceSetHash: f.content.parentSourceSetHash,
    refs: f.refs, bindings, mediaBindings: {} };
  const index = await seal({ kind: "game-content-release-index-v1" as const, contentHash: "", packageId,
    profile: "source" as const, currentReleaseId: release.id, objectRoot: "/content-releases" as const, releases: [release] });
  const files = new Map<string, unknown>([[`/content-releases/packages/${packageId}.json`, index],
    ...[...f.files.values()].map(value => [objectURL((value as { contentHash: string }).contentHash), value] as [string, unknown])]);
  const reads: string[] = [], read = async (url: string): Promise<unknown> => {
    reads.push(url); assert.ok(files.has(url), "Undeclared archived source URL: " + url); return structuredClone(files.get(url));
  };
  const current = new GameContentRepository(read, "source", f.refs);
  const selected = await new GameContentHistory({ current, profile: "source", packageId, refs: f.refs, loadJson: read }).openCurrent();
  const loaded = await selected.repository.sourceNewGame();
  assert.equal(selected.release!.profile, "source"); assert.equal(loaded.content.developmentProfile, undefined);
  assert.deepEqual(loaded.content, f.content); assert.deepEqual(loaded.battle, f.battle); assert.deepEqual(loaded.catalog, f.catalog);
  assert.ok(reads.every(url => url.startsWith("/content-releases/")));
});

test("current selection requires all exact host URLs and pins, the current release, namespace and profile", async () => {
  for (const fault of ["host", "current", "url", "battle-pin", "package", "profile", "missing-current"] as const) {
    const f = await contentReleaseSessionFixture();
    let current = f.repository;
    if (fault === "host") current = new GameContentRepository(f.read, "framework", f.old.refs);
    else {
      const index = structuredClone(f.index);
      if (fault === "current") index.currentReleaseId = f.old.release.id;
      else if (fault === "url") {
        const release = index.releases[1]!, previous = release.refs.world.url;
        release.refs.world.url = "/another/world.json";
        release.bindings[release.refs.world.url] = release.bindings[previous]!; delete release.bindings[previous];
      } else if (fault === "battle-pin") {
        const release = index.releases[1]!;
        if (release.refs.kind !== "game-content-refs-v2") assert.fail("Expected initialized refs");
        release.refs.initialized!.battle.contentHash = "f".repeat(64);
        release.bindings[release.refs.initialized!.battle.url] = "f".repeat(64);
      } else if (fault === "package") index.packageId = "different-package";
      else if (fault === "profile") {
        index.profile = "source";
        for (const release of index.releases) {
          assert.equal(release.refs.kind, "game-content-refs-v2");
          if (release.refs.kind !== "game-content-refs-v2") assert.fail("Expected initialized source inputs");
          release.refs = { kind: "game-content-refs-v1", profile: "source", world: release.refs.world,
            source: release.refs.initialized, development: null };
        }
      } else index.currentReleaseId = "f".repeat(64);
      f.files.set(f.indexUrl, await seal(index));
    }
    await assert.rejects(history(f, f.read, current).openCurrent(), /references|namespace|profile|release.*identity|unknown.*release/i, fault);
    assert.ok(f.reads.every(url => url === f.indexUrl), "Mismatch must stop before any mutable or archived payload is selected");
  }
});

test("archive I/O, source and integrity failures never fall back to a mutable current repository", async () => {
  for (const fault of ["missing-index", "index-hash", "source", "world-missing", "world-hash"] as const) {
    const f = await contentReleaseSessionFixture(), worldURL = objectURL(f.current.world.contentHash);
    if (fault === "missing-index") f.files.delete(f.indexUrl);
    else if (fault === "index-hash") f.files.set(f.indexUrl, { ...f.index, currentReleaseId: f.old.release.id });
    else if (fault === "source") {
      const index = structuredClone(f.index); index.releases[1]!.sourceSetHash = "another-source-parent";
      f.files.set(f.indexUrl, await seal(index));
    } else if (fault === "world-missing") f.files.delete(worldURL);
    else f.files.set(worldURL, { ...f.current.world, limitations: ["Changed immutable object"] });
    await assert.rejects(history(f).openCurrent(), /unavailable|payload changed|source identity/i, fault);
    assert.ok(f.reads.every(url => url === f.indexUrl || url === worldURL), fault);
    assert.equal(f.reads.some(url => [...f.current.files.keys()].includes(url)), false, fault);
  }
});

test("an explicitly pinned current save restores and keeps its later map loads fixed across another publication", async () => {
  const f = await contentReleaseSessionFixture(), h = await active(f), saved = h.owner.checkpoint();
  const selected = await h.h.restoreSessionContent(saved, { pinCurrent: true });
  assert.ok(selected.release); assert.equal(selected.release.release.id, f.current.release.id);
  const restored = GameSession.restore(saved, selected.content.initial, selected.content.battle, selected.content.world, runtime);
  h.contexts.registerCandidate(restored, selected.repository, selected.release);
  const loading = await h.entries.begin("load").prepare(() => ({ session: restored, presentation: null }));
  assert.equal(loading.status, "committed"); assert.deepEqual(restored.checkpoint(), saved);
  h.flow.advance(0, ready); const state = restored.state, world = restored.world;
  for (const [url, value] of f.old.files) f.files.set(url, structuredClone(value));
  f.files.set(f.indexUrl, await seal({ ...f.index, currentReleaseId: f.old.release.id }));
  selected.repository.clear();
  f.reads.length = 0;
  move(h.flow, "down"); assert.equal((await h.maps.load()).status, "committed"); h.flow.advance(10, ready);
  assert.equal(restored.state, state); assert.equal(restored.world, world);
  assert.equal(restored.field.content.contentHash, f.current.initialMap.contentHash);
  assert.equal(h.contexts.release!.release.id, f.current.release.id);
  assert.ok(f.reads.length); assert.ok(f.reads.every(url => url.startsWith("/content-releases/objects/")));
  assert.deepEqual(h.owner.checkpoint(), saved, "Restored inputs must leave the previous owner intact");
});

test("current restore pinning is a captured strict host option and never a checkpoint-selected or I/O fallback policy", async () => {
  const f = await contentReleaseSessionFixture(), h = await active(f), saved = h.owner.checkpoint();
  f.files.delete(f.indexUrl); f.reads.length = 0;
  const compatible = await h.h.restoreSessionContent(saved);
  assert.equal(compatible.repository, f.repository); assert.equal(compatible.release, null);
  assert.equal(f.reads.includes(f.indexUrl), false, "Default API keeps the established current-repository path");
  f.reads.length = 0;
  await assert.rejects(h.h.restoreSessionContent(saved, { pinCurrent: true }), /unavailable/);
  assert.deepEqual(f.reads, [f.indexUrl]); f.files.set(f.indexUrl, f.index);
  let reads = 0;
  const accessor = Object.defineProperty({}, "pinCurrent", { enumerable: true, get: () => { reads++; return true; } });
  const hidden = Object.defineProperty({}, "pinCurrent", { value: true });
  const inherited = Object.create({ pinCurrent: true }) as unknown;
  for (const bad of [null, 0, [], { pinCurrent: undefined }, { pinCurrent: "true" }, { other: false },
    { [Symbol("pinCurrent")]: true }, accessor, hidden, inherited]) {
    f.reads.length = 0;
    await assert.rejects(h.h.restoreSessionContent(saved, bad as GameContentHistoryRestoreOptions), /restore options/);
    assert.deepEqual(f.reads, []);
  }
  assert.equal(reads, 0);
  const suppliedBySave = structuredClone(saved); Reflect.set(suppliedBySave, "pinCurrent", true);
  await assert.rejects(h.h.restoreSessionContent(suppliedBySave), /fields/);
  const foreign = runInNewContext("({pinCurrent:true})") as GameContentHistoryRestoreOptions;
  assert.ok((await h.h.restoreSessionContent(saved, foreign)).release);
  const began = deferred<void>(), index = deferred<GameContentReleaseIndex>(), option = { pinCurrent: true };
  const pending = history(f, async url => {
    if (url === f.indexUrl) { began.resolve(); return index.promise; }
    return f.read(url);
  }).restoreSessionContent(saved, option);
  await began.promise; option.pinCurrent = false; index.resolve(f.index);
  assert.equal((await pending).release!.release.id, f.current.release.id);
});

test("a cancelled late current-content preparation cannot publish its session or cancel a newer operation", async () => {
  const f = await contentReleaseSessionFixture(), flow = new GameFlow(), contexts = new GameContentSessions(flow, f.repository);
  const outgoing = await create({ repository: f.repository, release: null });
  contexts.registerCandidate(outgoing, f.repository); flow.start(outgoing); flow.advance(10, ready);
  const before = outgoing.checkpoint(), begun = deferred<void>(), downloaded = deferred<GameContentReleaseIndex>();
  const h = history(f, async url => {
    if (url === f.indexUrl) { begun.resolve(); return downloaded.promise; }
    return f.read(url);
  });
  const discarded: number[] = [], entries = new GameEntryLoader<number>(flow, { discard: value => { discarded.push(value); } });
  const attempt = entries.begin("new-game"), result = attempt.prepare(async () => {
    const selected = await h.openCurrent(), candidate = await create(selected);
    contexts.registerCandidate(candidate, selected.repository, selected.release);
    return { session: candidate, presentation: 7 };
  });
  await begun.promise;
  flow.advance(60000, ready); assert.deepEqual(outgoing.checkpoint(), before);
  assert.equal(contexts.repository, f.repository); assert.equal(contexts.release, null);
  attempt.cancel(); const ticket = flow.beginOperation("save"); downloaded.resolve(f.index);
  assert.equal((await result).status, "cancelled"); assert.deepEqual(discarded, [7]);
  assert.equal(ticket.isCurrent(), true); assert.equal(flow.session, outgoing);
  assert.equal(contexts.repository, f.repository); assert.equal(contexts.release, null);
  assert.deepEqual(outgoing.checkpoint(), before); ticket.finish();
});

test("failed current-entry preparation retains the old owner and can retry the same declared release", async () => {
  const f = await contentReleaseSessionFixture(), flow = new GameFlow(), contexts = new GameContentSessions(flow, f.repository);
  const outgoing = await create({ repository: f.repository, release: null });
  contexts.registerCandidate(outgoing, f.repository); flow.start(outgoing); flow.advance(10, ready); flow.pause(true);
  const before = outgoing.checkpoint(), h = history(f), discarded: null[] = [];
  const entries = new GameEntryLoader<null>(flow, { discard: value => { discarded.push(value); } });
  const missing = objectURL(f.current.battle.contentHash), original = f.files.get(missing); f.files.delete(missing);
  const run = () => entries.begin("new-game").prepare(async () => {
    const selected = await h.openCurrent(), candidate = await create(selected);
    contexts.registerCandidate(candidate, selected.repository, selected.release);
    return { session: candidate, presentation: null };
  });
  const failed = await run(); assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Archive failure cannot become successful entry publication");
  assert.match(String(failed.error), /unavailable/); assert.equal(flow.session, outgoing);
  assert.equal(flow.paused, true); assert.equal(flow.busy, false); assert.deepEqual(outgoing.checkpoint(), before);
  assert.equal(contexts.repository, f.repository); assert.deepEqual(discarded, []);
  f.files.set(missing, original);
  const retried = await run(); assert.equal(retried.status, "committed"); assert.notEqual(flow.session, outgoing);
  assert.equal(contexts.release!.release.id, f.current.release.id);
  assert.notEqual(contexts.repository, f.repository); assert.deepEqual(outgoing.checkpoint(), before);
});
