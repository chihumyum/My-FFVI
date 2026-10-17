import assert from "node:assert/strict";
import test from "node:test";
import { GameContentHistory, type GameContentHistoryRestore } from "../src/core/game-content-history.js";
import { GameContentSessions } from "../src/core/game-content-sessions.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameSession, type GameCheckpoint } from "../src/core/game-session.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import type { GameContentRefsV1 } from "../src/core/game-content-refs.js";
import { contentReleaseSessionFixture, releaseSessionHost as ready,
  releaseSessionRuntime as runtime } from "./fixtures/content-release-session.js";

test("known v4 saves without world identity reject two matching roots before restoring or replacing the running owner", async () => {
  const f = checkpointFixture(), field = sealBatchContent(f.field), battle = sealBatchContent(f.battle);
  const owner = new GameSession(field, battle), before = owner.checkpoint();
  if (before.formatVersion !== 5) assert.fail("Expected the current development save envelope");
  // v4 has the same supported development owner but no walking-encounter
  // field. Declare that historical envelope without changing any identity or
  // gameplay value; no restore is allowed to reach it in this ambiguity test.
  const { walkEncounters: _walk, ...v4 } = before;
  const checkpoint: GameCheckpoint = { ...v4, formatVersion: 4 };
  assert.equal(checkpoint.world.location, null);
  const worlds = ["old", "current"].map(name => sealBatchContent({ ...structuredClone(f.world), limitations: [name] }));
  const versions = await Promise.all(worlds.map(async world => {
    const refs: GameContentRefsV1 = { kind: "game-content-refs-v1", profile: "framework", source: null,
      development: { entry: { url: "/legacy/entry.json", contentHash: field.contentHash },
        battle: { url: "/legacy/battle.json", contentHash: battle.contentHash } },
      world: { url: "/legacy/world.json", contentHash: world.contentHash } };
    const bindings = { "/legacy/entry.json": field.contentHash, "/legacy/battle.json": battle.contentHash,
      "/legacy/world.json": world.contentHash };
    return { id: await contentDigest({ refs, bindings }), sourceSetHash: checkpoint.sourceSetHash,
      refs, bindings, mediaBindings: {} };
  }));
  const packageId = "legacy-ambiguous-world", indexUrl = `/content-releases/packages/${packageId}.json`;
  const index = sealBatchContent({ kind: "game-content-release-index-v1", contentHash: "", packageId,
    profile: "framework", currentReleaseId: versions[1]!.id, objectRoot: "/content-releases", releases: versions });
  const reads: string[] = [];
  const read = async (url: string): Promise<unknown> => {
    reads.push(url);
    assert.equal(url, indexUrl, "Ambiguity must stop before any current or archived content is restored");
    return structuredClone(index);
  };
  const current = new GameContentRepository(read, "framework", versions[1]!.refs);
  const flow = new GameFlow(owner), bindings = new GameContentSessions(flow, current);
  bindings.registerCandidate(owner, current); flow.start(); flow.observeHost(ready); flow.pause(true);
  const history = new GameContentHistory({ current, profile: "framework", packageId, refs: versions[1]!.refs, loadJson: read });
  const entries = new GameEntryLoader<null>(flow, { discard: () => assert.fail("No presentation was prepared") });
  const result = await entries.begin("load").prepare(async () => {
    const selection = await history.restoreSessionContent(checkpoint);
    const restored = GameSession.restore(checkpoint, selection.content.initial, selection.content.battle,
      selection.content.world, runtime);
    bindings.registerCandidate(restored, selection.repository, selection.release);
    return { session: restored, presentation: null };
  });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") assert.fail("Ambiguous content must not publish");
  assert.match(String(result.error), /ambiguous/i);
  assert.deepEqual(reads, [indexUrl]); assert.equal(flow.session, owner);
  assert.equal(flow.paused, true); assert.equal(flow.busy, false);
  assert.equal(bindings.repository, current); assert.equal(bindings.release, null);
  assert.deepEqual(owner.checkpoint(), before);
});

type Presentation = { id: number };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function harness() {
  const f = await contentReleaseSessionFixture(), flow = new GameFlow();
  let reader = f.read;
  const current = new GameContentRepository(url => reader(url), "framework", f.current.refs);
  const history = new GameContentHistory({ current, profile: "framework", packageId: f.packageId,
    refs: f.current.refs, loadJson: url => reader(url) });
  const bindings = new GameContentSessions(flow, current), discarded: Presentation[] = [];
  let nextPresentation = 1;
  const entries = new GameEntryLoader<Presentation>(flow, { discard: value => { discarded.push(value); } });
  const maps = new GameMapLoader(flow, bindings, { prepare: async () => null, discard: () => {} });
  const handoff = new GameBattleHandoff(flow, {
    prepareStart: async () => null, prepareReturn: async () => null, discard: () => {},
  });
  const bytes = new Map<string, string>();
  const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { bytes.set(key, value); } }, "framework", f.packageId);
  const create = async (repository: GameContentRepository) => {
    const p = await repository.initializedNewGame();
    return GameSession.prepareFrameworkNewGame(p.content, p.catalog, p.map, p.battle, runtime, 314);
  };
  // This is a real previously running initialized release, not a rewritten
  // checkpoint whose hashes are made to resemble an older version.
  const prior = await create(f.oldRepository); prior.advance(10);
  const oldCheckpoint = prior.checkpoint();
  (await storage.prepareSave(oldCheckpoint, 1)).commit();

  const start = async () => {
    const result = await entries.begin("new-game").prepare(async context => {
      const session = await create(history.current);
      assert.equal(context.isCurrent(), true);
      bindings.registerCandidate(session, history.current);
      return { session, presentation: { id: nextPresentation++ } };
    });
    assert.equal(result.status, "committed");
    if (result.status !== "committed") assert.fail("Expected current-release start");
    flow.advance(10, ready);
    return result.session;
  };
  const load = (checkpoint: GameCheckpoint = oldCheckpoint,
    prepare?: (session: GameSession, selection: GameContentHistoryRestore) => Promise<Presentation>) => {
    const attempt = entries.begin("load");
    const pending = attempt.prepare(async context => {
      const selection = await history.restoreSessionContent(checkpoint);
      if (!context.isCurrent()) throw new Error("Obsolete release preparation");
      const session = GameSession.restore(checkpoint, selection.content.initial, selection.content.battle,
        selection.content.world, runtime);
      bindings.registerCandidate(session, selection.repository, selection.release);
      const presentation = prepare ? await prepare(session, selection) : { id: nextPresentation++ };
      return { session, presentation, options: { paused: true } };
    });
    return { attempt, pending };
  };
  const commands = () => new GameCommands(flow, flow.session);
  const tick = (ms = 10) => flow.advance(ms, ready);
  const move = (direction: "up" | "right" | "down" | "left") => {
    assert.equal(flow.move(direction), true);
    for (let i = 0; flow.session.field.player.motion; i++) {
      assert.ok(i < 200, "An accepted field step must finish"); tick();
    }
    assert.notEqual(flow.session.field.stop?.kind, "unsupported");
  };
  let savedAt = 2;
  const save = async () => {
    assert.equal(flow.session.checkpointReady, true);
    assert.equal(flow.pause(true), true); flow.observeHost(ready);
    const checkpoint = flow.session.checkpoint(), ticket = flow.beginOperation("save");
    try {
      const prepared = await storage.prepareSave(checkpoint, savedAt++);
      assert.equal(ticket.isCurrent(), true); prepared.commit(); assert.equal(ticket.finish(), true);
    } catch (error) { ticket.cancel(); throw error; }
    return checkpoint;
  };
  return { f, flow, current, history, bindings, entries, maps, handoff, storage, bytes, discarded,
    oldCheckpoint, prior, start, load, commands, tick, move, save,
    setReader: (next: typeof reader) => { reader = next; } };
}

test("archived initialized release continues through map, battle, menu, save, reload and next input", async () => {
  const h = await harness(), outgoing = await h.start(), previousCommands = h.commands();
  assert.notEqual(outgoing.battleCatalog.contentHash, h.oldCheckpoint.battleCatalogHash);
  const beforeOutgoing = outgoing.checkpoint();
  const loaded = await h.load().pending;
  assert.equal(loaded.status, "committed");
  const owner = h.flow.session, state = owner.state, world = owner.world;
  assert.notEqual(owner, outgoing); assert.deepEqual(owner.checkpoint(), h.oldCheckpoint);
  assert.equal(h.bindings.repository === h.current, false);
  assert.equal(h.bindings.release!.release.id, h.f.old.release.id);
  assert.equal((await h.bindings.world()).contentHash, h.f.old.world.contentHash);
  h.flow.observeHost(ready);
  assert.equal(previousCommands.menu({ kind: "set-preferences", preferences: { mode: "wait", speedIndex: 4 } }), false);
  assert.deepEqual(outgoing.checkpoint(), beforeOutgoing);
  assert.deepEqual(owner.checkpoint(), h.oldCheckpoint);

  h.flow.pause(false); h.tick(0);
  const itemCount = () => owner.state.snapshot().items.find(item => item.id === 701)!.count;
  const initialItems = itemCount();
  h.move("right"); assert.equal(owner.field.stop?.kind, "map-transition");
  const moved = await h.maps.load(); assert.equal(moved.status, "committed");
  h.tick(); assert.equal(owner.field.content.map.identity!.mapId, h.f.nextMapId);
  assert.equal(owner.field.content.contentHash, h.f.old.nextMap.contentHash);
  assert.equal(itemCount(), initialItems + h.f.old.grant);
  assert.equal(owner.state, state); assert.equal(owner.world, world);
  assert.equal(owner.field.eventState.read({ category: "MapLocalVariable", index: 0 }), 2);
  assert.ok(h.f.reads.includes(`/content-releases/objects/${h.f.old.nextMap.contentHash}.json`));
  assert.equal(h.f.reads.includes(h.f.urls.map(h.f.nextMapId)), false,
    "The active archived session must not read the current release's colliding map URL");

  h.move("right"); assert.equal(owner.field.stop?.kind, "encounter");
  assert.equal((await h.handoff.start()).status, "committed"); h.tick(0);
  const battle = owner.battle!, battleCommands = h.commands(), gil = owner.gil;
  assert.equal(owner.battleCatalog.common.abilities[10]!.name, "Authored old release attack");
  let submitted = 0;
  for (let i = 0; battle.phase === "active"; i++) {
    assert.ok(i < 5000, "The authored battle must finish through ordinary queued commands");
    for (const actor of battle.ready) {
      const target = battle.targets(actor.id, 10)[0];
      if (target && battleCommands.command(battle, actor.id, 10, target.id, 100)) submitted++;
    }
    h.tick();
  }
  assert.ok(submitted > 0); assert.equal(battle.phase, "victory");
  assert.equal(battle.previewVictory()!.gil, h.f.old.gil);
  assert.equal((await h.handoff.return()).status, "committed"); h.tick();
  assert.equal(owner.gil, gil + h.f.old.gil);
  assert.deepEqual(owner.state.snapshot().completedBattles, [{ serial: 0, encounterId: h.f.encounterId, outcome: "victory" }]);
  assert.equal(owner.state, state); assert.equal(owner.world, world);
  assert.equal(owner.field.content.contentHash, h.f.old.nextMap.contentHash);

  h.flow.pause(true); h.flow.observeHost(ready);
  const liveCommands = h.commands();
  assert.equal(liveCommands.menu({ kind: "set-preferences", preferences: { mode: "wait", speedIndex: 3 } }), true);
  const checkpoint = await h.save(), stored = await h.storage.load(); assert.ok(stored);
  assert.deepEqual(stored.checkpoint, checkpoint);
  const beforeReloadGil = owner.gil, beforeReloadItems = itemCount();
  assert.equal((await h.load(stored.checkpoint).pending).status, "committed");
  const restored = h.flow.session;
  assert.notEqual(restored, owner); assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(restored.gil, beforeReloadGil);
  assert.equal(restored.state.snapshot().items.find(item => item.id === 701)!.count, beforeReloadItems);
  assert.deepEqual(restored.battlePreferences, { mode: "wait", speedIndex: 3 });
  assert.equal(h.bindings.release!.release.id, h.f.old.release.id);
  h.flow.observeHost(ready);
  assert.equal(liveCommands.menu({ kind: "set-preferences", preferences: { mode: "active", speedIndex: 0 } }), false);
  assert.equal(battleCommands.command(battle, battle.players[0]!.id, 10, battle.enemies[0]!.id, 100), false);
  h.flow.pause(false); h.tick(0); h.move("down");
  assert.equal(restored.field.player.y, 5); assert.equal(restored.checkpointReady, true);
  assert.equal(restored.state.snapshot().completedBattles.length, 1);
});

test("a private archived candidate never replaces the current repository before Flow publishes", async () => {
  const h = await harness(), outgoing = await h.start(), readyToPublish = deferred<void>(), media = deferred<Presentation>();
  const before = outgoing.checkpoint();
  let candidate!: GameSession;
  const load = h.load(h.oldCheckpoint, async (session, selected) => {
    candidate = session;
    assert.equal(h.bindings.contextFor(session).repository, selected.repository);
    assert.equal(h.flow.session, outgoing); assert.equal(h.bindings.repository, h.current);
    readyToPublish.resolve(); return media.promise;
  });
  await readyToPublish.promise; h.tick(60000);
  assert.deepEqual(outgoing.checkpoint(), before);
  assert.equal(h.bindings.repository, h.current); assert.equal(h.flow.inputReady, false);
  media.resolve({ id: 400 }); assert.equal((await load.pending).status, "committed");
  assert.equal(h.flow.session, candidate);
  assert.equal(h.bindings.repository, h.bindings.contextFor(candidate).repository);
  assert.equal(h.bindings.release!.release.id, h.f.old.release.id);
  assert.equal(h.flow.inputReady, false, "The restored owner needs fresh host readiness");
  assert.deepEqual(h.discarded, []);
});

test("missing archive objects retain owner, repository and save bytes and permit the same save to retry", async () => {
  const h = await harness(), outgoing = await h.start(), before = outgoing.checkpoint(), bytes = [...h.bytes];
  const missing = `/content-releases/objects/${h.f.old.battle.contentHash}.json`, payload = h.f.files.get(missing);
  h.f.files.delete(missing);
  const result = await h.load().pending;
  assert.equal(result.status, "failed"); if (result.status !== "failed") assert.fail("Expected download failure");
  assert.match(String(result.error), /Controlled release file is unavailable/);
  assert.equal(h.flow.session, outgoing); assert.equal(h.bindings.repository, h.current);
  assert.deepEqual(outgoing.checkpoint(), before); assert.deepEqual([...h.bytes], bytes); assert.equal(h.flow.busy, false);
  h.f.files.set(missing, payload);
  assert.equal((await h.load().pending).status, "committed");
  assert.equal(h.bindings.release!.release.id, h.f.old.release.id);
});

test("archive payload hash failure and media preparation failure both retain the exact current owner", async () => {
  const h = await harness(), outgoing = await h.start(), before = outgoing.checkpoint();
  const url = `/content-releases/objects/${h.f.old.nextMap.contentHash}.json`;
  // Initial map hash is checked by the Repository while restoring the entry.
  const entryUrl = `/content-releases/objects/${h.f.old.initialMap.contentHash}.json`;
  const original = h.f.files.get(entryUrl);
  h.f.files.set(entryUrl, { ...structuredClone(h.f.old.initialMap), name: "tampered archive bytes" });
  const invalid = await h.load().pending; assert.equal(invalid.status, "failed");
  if (invalid.status !== "failed") assert.fail("Expected hash failure");
  assert.match(String(invalid.error), /Content payload changed/);
  assert.equal(h.flow.session, outgoing); assert.equal(h.bindings.repository, h.current);
  h.f.files.set(entryUrl, original);
  const error = new Error("Controlled private presentation failed");
  const media = await h.load(h.oldCheckpoint, async () => { throw error; }).pending;
  assert.equal(media.status, "failed"); if (media.status !== "failed") assert.fail("Expected presentation failure");
  assert.equal(media.error, error); assert.equal(h.flow.session, outgoing); assert.equal(h.bindings.repository, h.current);
  assert.deepEqual(outgoing.checkpoint(), before); assert.equal(h.f.reads.includes(url), false);
  assert.equal((await h.load().pending).status, "committed");
});

test("cancelling archive download keeps a newer entry and its repository safe from late success", async () => {
  const h = await harness(), outgoing = await h.start(), waiting = deferred<void>(), download = deferred<unknown>();
  h.setReader(async url => {
    if (url === h.f.indexUrl) { waiting.resolve(); return download.promise; }
    return h.f.read(url);
  });
  const old = h.load(); await waiting.promise;
  old.attempt.cancel(); h.setReader(h.f.read);
  const replacement = await h.start(); assert.notEqual(replacement, outgoing);
  const before = replacement.checkpoint(), ticket = h.flow.beginOperation("save");
  download.resolve(h.f.index);
  assert.equal((await old.pending).status, "cancelled");
  assert.equal(ticket.isCurrent(), true); assert.equal(h.flow.session, replacement);
  assert.equal(h.bindings.repository, h.current); assert.deepEqual(replacement.checkpoint(), before);
  ticket.finish();
});

test("late archived media success is discarded once without rebinding a replacement current release", async () => {
  const h = await harness(); await h.start();
  const waiting = deferred<void>(), media = deferred<Presentation>();
  const old = h.load(h.oldCheckpoint, async () => { waiting.resolve(); return media.promise; });
  await waiting.promise; old.attempt.cancel(); old.attempt.cancel();
  const replacement = await h.start(), before = replacement.checkpoint(), ticket = h.flow.beginOperation("save");
  const obsolete = { id: 700 }; media.resolve(obsolete);
  assert.equal((await old.pending).status, "cancelled");
  assert.deepEqual(h.discarded, [obsolete]); assert.equal(ticket.isCurrent(), true);
  assert.equal(h.flow.session, replacement); assert.equal(h.bindings.repository, h.current);
  assert.deepEqual(replacement.checkpoint(), before); ticket.finish();
});

test("late archived media rejection after title return cannot fail a replacement current session", async () => {
  const h = await harness(); await h.start();
  const waiting = deferred<void>(), media = deferred<Presentation>();
  const old = h.load(h.oldCheckpoint, async () => { waiting.resolve(); return media.promise; });
  await waiting.promise; h.flow.returnToTitle();
  assert.equal(h.bindings.repository, h.current); assert.equal(h.bindings.release, null);
  const replacement = await h.start(), before = replacement.checkpoint();
  media.reject(new Error("Obsolete archived media failure"));
  assert.equal((await old.pending).status, "cancelled");
  assert.equal(h.flow.session, replacement); assert.equal(h.bindings.repository, h.current);
  assert.deepEqual(replacement.checkpoint(), before); assert.deepEqual(h.discarded, []);
});

test("returning to title after old-save continuation starts the current release without changing the old save", async () => {
  const h = await harness(); await h.start();
  assert.equal((await h.load().pending).status, "committed");
  const old = h.flow.session, oldCommands = h.commands(), saved = await h.storage.load();
  h.flow.returnToTitle(); assert.equal(h.bindings.repository, h.current); assert.equal(h.bindings.release, null);
  const latest = await h.start();
  assert.notEqual(latest, old); assert.equal(latest.battleCatalog.contentHash, h.f.current.battle.contentHash);
  assert.equal(latest.field.content.contentHash, h.f.current.content.contentHash);
  assert.equal(latest.state.snapshot().items.find(item => item.id === 701)!.count,
    h.oldCheckpoint.owned.items.find(item => item.id === 701)!.count - h.f.old.grant + h.f.current.grant);
  h.flow.pause(true); h.flow.observeHost(ready);
  assert.equal(oldCommands.setBattlePreferences({ mode: "wait", speedIndex: 4 }), false);
  assert.deepEqual(await h.storage.load(), saved);
  assert.equal((await h.bindings.world()).contentHash, h.f.current.world.contentHash);
});

test("current-release I/O failure never searches archive as a playable fallback", async () => {
  const h = await harness(), latest = await h.start();
  // A real published map supplies the catalog identity that makes the
  // checkpoint uniquely current. A null-location save must use its index.
  h.move("right"); assert.equal((await h.maps.load()).status, "committed"); h.tick();
  const checkpoint = latest.checkpoint(), before = [...h.bytes];
  assert.equal(checkpoint.world.location?.catalogHash, h.f.current.world.contentHash);
  h.current.clear(); const error = new Error("Current release HTTP 503");
  h.setReader(async url => { if (url === h.f.urls.entry) throw error; return h.f.read(url); });
  const start = h.f.reads.length, result = await h.load(checkpoint).pending;
  assert.equal(result.status, "failed"); if (result.status !== "failed") assert.fail("Expected current-release failure");
  assert.equal(result.error, error); assert.equal(h.f.reads.slice(start).includes(h.f.indexUrl), false);
  assert.equal(h.flow.session, latest); assert.equal(h.bindings.repository, h.current);
  assert.deepEqual([...h.bytes], before); assert.deepEqual(latest.checkpoint(), checkpoint);
});

test("a valid archive index for another namespace and an unsupported saved codec cannot replace the owner", async () => {
  const h = await harness(), latest = await h.start(), before = latest.checkpoint();
  h.f.files.set(h.f.indexUrl, sealBatchContent({ ...h.f.index, packageId: "another-package" }));
  const wrong = await h.load().pending; assert.equal(wrong.status, "failed");
  if (wrong.status !== "failed") assert.fail("Expected namespace failure");
  assert.match(String(wrong.error), /namespace\/profile/);
  h.f.files.set(h.f.indexUrl, h.f.index);
  const obsolete = structuredClone(h.oldCheckpoint); Reflect.set(obsolete, "formatVersion", 99);
  const unsupported = await h.load(obsolete).pending; assert.equal(unsupported.status, "failed");
  if (unsupported.status !== "failed") assert.fail("Expected codec failure");
  assert.match(String(unsupported.error), /Unsupported game content release checkpoint/);
  assert.equal(h.flow.session, latest); assert.equal(h.bindings.repository, h.current);
  assert.deepEqual(latest.checkpoint(), before);
});

test("archive restore preserves saved identity and rejects replacement of an already registered owner binding", async () => {
  const h = await harness(); await h.start();
  const hash = await contentDigest(h.oldCheckpoint);
  assert.equal((await h.load().pending).status, "committed");
  const session = h.flow.session, repository = h.bindings.repository;
  assert.equal(await contentDigest(session.checkpoint()), hash);
  assert.throws(() => h.bindings.registerCandidate(session, h.current), /registered|published|binding/);
  assert.equal(h.bindings.repository, repository);
  assert.equal(h.bindings.release!.release.id, h.f.old.release.id);
  assert.equal(await contentDigest(session.checkpoint()), hash);
});

test("an archived map download can retry the same request without selecting current content or replaying entry", async () => {
  const h = await harness(); await h.start();
  assert.equal((await h.load().pending).status, "committed");
  h.flow.pause(false); h.tick(0); h.move("right");
  const owner = h.flow.session, field = owner.field, request = field.stop, repository = h.bindings.repository;
  const before = owner.state.snapshot(), url = `/content-releases/objects/${h.f.old.nextMap.contentHash}.json`;
  const payload = h.f.files.get(url); h.f.files.delete(url);
  const failed = await h.maps.load(); assert.equal(failed.status, "failed");
  assert.equal(h.flow.session, owner); assert.equal(owner.field, field); assert.equal(field.stop, request);
  assert.equal(h.bindings.repository, repository); assert.deepEqual(owner.state.snapshot(), before);
  assert.equal(owner.world.transitions.length, 0);
  assert.equal(h.f.reads.includes(h.f.urls.map(h.f.nextMapId)), false);
  h.f.files.set(url, payload);
  assert.equal((await h.maps.load()).status, "committed"); h.tick();
  assert.equal(owner.field.content.contentHash, h.f.old.nextMap.contentHash);
  assert.equal(owner.world.transitions.length, 1);
  assert.equal(owner.state.snapshot().items.find(item => item.id === 701)!.count,
    before.items.find(item => item.id === 701)!.count + h.f.old.grant);
});

test("an obsolete archived map completion cannot replace or unlock a new current-release session", async () => {
  const h = await harness(); await h.start();
  assert.equal((await h.load().pending).status, "committed");
  h.flow.pause(false); h.tick(0); h.move("right");
  const old = h.flow.session, oldField = old.field, beforeOwned = old.state.snapshot();
  const waiting = deferred<void>(), download = deferred<unknown>();
  const url = `/content-releases/objects/${h.f.old.nextMap.contentHash}.json`;
  h.setReader(async path => {
    if (path === url) { waiting.resolve(); return download.promise; }
    return h.f.read(path);
  });
  const pending = h.maps.load(); await waiting.promise;
  h.flow.returnToTitle(); h.setReader(h.f.read);
  const current = await h.start(), checkpoint = current.checkpoint(), ticket = h.flow.beginOperation("save");
  download.resolve(h.f.old.nextMap);
  assert.equal((await pending).status, "cancelled");
  assert.equal(h.flow.session, current); assert.equal(h.bindings.repository, h.current);
  assert.equal(ticket.isCurrent(), true); assert.deepEqual(current.checkpoint(), checkpoint);
  assert.equal(old.field, oldField); assert.equal(old.world.transitions.length, 0);
  assert.deepEqual(old.state.snapshot(), beforeOwned); ticket.finish();
});
