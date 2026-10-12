import assert from "node:assert/strict";
import test from "node:test";
import { contentDigest } from "../src/core/content-integrity.js";
import type { FieldGame, MapTransitionStop } from "../src/core/field.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameSession } from "../src/core/game-session.js";
import type { PreparedMap } from "../src/core/world-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const initialized = { category: "ScenarioFlag1", index: 8 } as const;
const callerRan = { category: "ScenarioFlag1", index: 9 } as const;
const ready = { visible: true, mediaReady: true, overlayOpen: false };
type Presentation = { field: FieldGame; tag: number };

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...payload } = JSON.parse(JSON.stringify(value)) as T;
  return { ...payload, contentHash: await contentDigest(payload) } as T;
}

/** Signed synthetic content is loaded by the production repository. Session,
 * world, field, owned state and entry scripts are the real shared owners; only
 * network failures and private presentation allocation are controlled. */
async function fixture() {
  const f = checkpointFixture();
  const site = { script: "leave", index: 0, source: { file: "synthetic", assetPath: "map-loader" } };
  f.field.scripts.leave = [
    { ...site, kind: "flag", ref: callerRan, operation: "flip" },
    { ...site, index: 1, kind: "change-map", request: {
      mapId: 2, entrance: 1, continuation: null, birdview: false,
      skipFade: true, skipBgm: true, origin: "script",
    } },
  ];
  const field = await seal(f.field), battle = await seal(f.battle), map = await seal(f.target);
  f.world.maps[String(map.mapId)]!.contentHash = map.contentHash;
  const catalog = await seal(f.world);
  const mapUrl = catalog.maps[String(map.mapId)]!.url;
  const files = new Map<string, unknown>([["/world/catalog.json", catalog], [mapUrl, map]]);
  const reads: string[] = [];
  const read = async (url: string): Promise<unknown> => {
    reads.push(url);
    if (!files.has(url)) throw new Error("Missing controlled file: " + url);
    return files.get(url);
  };
  const game = new GameSession(field, battle, 314), flow = new GameFlow(game);
  game.field.eventState.write(initialized, 0);
  game.field.eventState.write(callerRan, 0);
  flow.start(); flow.advance(0, ready);
  game.field.startEvent("leave");
  assert.equal(game.field.stop?.kind, "map-transition");
  const request = game.field.stop as MapTransitionStop, from = game.field;
  const owned = game.state, before = owned.snapshot(), time = from.time;
  const candidates: PreparedMap[] = [], discardedCandidates: PreparedMap[] = [];
  const prepare = game.world.prepare.bind(game.world), discard = game.world.discard.bind(game.world);
  game.world.prepare = (...args) => { const next = prepare(...args); candidates.push(next); return next; };
  game.world.discard = (next) => { discardedCandidates.push(next); discard(next); };
  const presentations: Presentation[] = [], discarded: Presentation[] = [];
  const host = {
    prepare: async (next: FieldGame): Promise<Presentation> => {
      const value = { field: next, tag: presentations.length + 1 };
      presentations.push(value); return value;
    },
    discard: (value: Presentation): void => { discarded.push(value); },
  };
  const unchanged = () => {
    assert.equal(flow.session, game);
    assert.equal(game.state, owned);
    assert.equal(game.field, from);
    assert.equal(from.stop, request);
    assert.equal(from.time, time);
    assert.deepEqual(owned.snapshot(), before);
    assert.equal(from.eventState.read(initialized), 0);
    assert.equal(from.eventState.read(callerRan), 1);
    assert.equal(game.world.transitions.length, 0);
  };
  return { ...f, field, battle, map, catalog, mapUrl, files, read, reads, game, flow,
    from, request, owned, before, candidates, discardedCandidates, presentations, discarded, host, unchanged };
}

test("map download failure retains the exact request and paused session; retry publishes entry once", async () => {
  const f = await fixture(), error = new Error("Controlled HTTP 503");
  let failures = 1;
  const contents = new GameContentRepository(async (url) => {
    if (url === f.mapUrl && failures-- > 0) throw error;
    return f.read(url);
  });
  const loader = new GameMapLoader(f.flow, contents, f.host);
  f.flow.pause(true);
  const pending = loader.load();
  assert.equal(f.flow.phase, "transition");
  f.flow.advance(500, ready);
  const failed = await pending;
  assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected retryable preparation failure");
  assert.equal(failed.error, error);
  assert.equal(failed.session, f.game); assert.equal(failed.request, f.request);
  assert.equal(f.flow.busy, false); assert.equal(f.flow.paused, true);
  assert.equal(f.candidates.length, 0); f.unchanged();

  const result = await loader.load();
  assert.equal(result.status, "committed");
  if (result.status !== "committed") assert.fail("Expected committed map");
  assert.equal(result.session, f.game); assert.equal(result.request, f.request);
  assert.equal(result.field, f.game.field); assert.equal(result.presentation.field, result.field);
  assert.equal(f.game.state, f.owned); assert.equal(f.flow.paused, true); assert.equal(f.flow.busy, false);
  assert.equal(f.game.field.eventState.read(initialized), 1);
  assert.equal(f.game.field.eventState.read(callerRan), 1);
  assert.equal(f.game.world.transitions.length, 1);
  assert.equal(f.game.world.transitions[0]!.origin, "script");
  assert.equal(f.discarded.length, 0);
  await assert.rejects(loader.load(), /pending map request/);
  loader.cancel();
  assert.equal(f.discarded.length, 0);
});

test("media failure discards the private world candidate and retries without replaying its caller", async () => {
  const f = await fixture(), error = new Error("Controlled image decode failure");
  let failures = 1;
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), {
    ...f.host,
    prepare: async (field) => {
      assert.equal(field.eventState.read(initialized), 1);
      if (failures-- > 0) throw error;
      return f.host.prepare(field);
    },
  });
  const failed = await loader.load();
  assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected preparation failure");
  assert.equal(failed.error, error);
  assert.equal(f.discardedCandidates[0], f.candidates[0]);
  assert.equal(f.game.world.commit(f.candidates[0]!), false);
  f.unchanged();
  assert.equal((await loader.load()).status, "committed");
  assert.equal(f.candidates.length, 2);
  assert.equal(f.game.field.eventState.read(initialized), 1);
  assert.equal(f.game.field.eventState.read(callerRan), 1);
  assert.equal(f.game.world.transitions.length, 1);
});

test("cancellation during catalog download cannot release a newer flow operation", async () => {
  const f = await fixture(), download = deferred<unknown>(), entered = deferred<void>();
  const contents = new GameContentRepository(async (url) => {
    if (url === "/world/catalog.json") { entered.resolve(); return download.promise; }
    return f.read(url);
  });
  const loader = new GameMapLoader(f.flow, contents, f.host);
  const old = loader.load(); await entered.promise;
  loader.cancel();
  assert.equal(f.flow.busy, false);
  const newer = f.flow.beginOperation("save");
  download.resolve(f.catalog);
  assert.equal((await old).status, "cancelled");
  assert.equal(newer.isCurrent(), true); assert.equal(f.flow.busy, true);
  assert.equal(f.candidates.length, 0); assert.equal(f.presentations.length, 0);
  f.unchanged(); newer.cancel();
});

test("late presentation after cancel is disposed once without affecting a newer successful map", async () => {
  const f = await fixture(), media = deferred<Presentation>(), entered = deferred<FieldGame>();
  let call = 0;
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), {
    ...f.host,
    prepare: async (field) => {
      if (++call === 1) { entered.resolve(field); return media.promise; }
      return f.host.prepare(field);
    },
  });
  const old = loader.load(), oldField = await entered.promise;
  loader.cancel(); loader.cancel();
  f.unchanged();
  assert.equal(f.game.world.commit(f.candidates[0]!), false);
  assert.equal((await loader.load()).status, "committed");
  const current = f.game.field, newer = f.flow.beginOperation("save");
  const obsolete = { field: oldField, tag: 99 };
  media.resolve(obsolete);
  assert.equal((await old).status, "cancelled");
  assert.deepEqual(f.discarded, [obsolete]);
  assert.equal(f.game.field, current); assert.equal(f.game.world.transitions.length, 1);
  assert.equal(newer.isCurrent(), true); newer.cancel();
});

test("late media rejection after title/session replacement is cancelled instead of a fatal new-session error", async () => {
  const f = await fixture(), media = deferred<Presentation>(), entered = deferred<void>();
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), {
    ...f.host, prepare: async () => { entered.resolve(); return media.promise; },
  });
  const old = loader.load(); await entered.promise;
  f.flow.returnToTitle();
  const next = checkpointFixture().game;
  f.flow.start(next, { paused: true });
  const newer = f.flow.beginOperation("load");
  loader.cancel();
  assert.equal(newer.isCurrent(), true);
  media.reject(new Error("Obsolete decode failed"));
  assert.equal((await old).status, "cancelled");
  assert.equal(f.flow.session, next); assert.equal(f.flow.paused, true);
  assert.equal(newer.isCurrent(), true); assert.equal(f.game.field, f.from);
  assert.equal(f.game.world.commit(f.candidates[0]!), false);
  assert.equal(f.game.world.transitions.length, 0); newer.cancel();
});

test("replacing a session without explicit cancel still disposes a late successful presentation", async () => {
  const f = await fixture(), media = deferred<Presentation>(), entered = deferred<FieldGame>();
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), {
    ...f.host, prepare: async (field) => { entered.resolve(field); return media.promise; },
  });
  const old = loader.load(), field = await entered.promise;
  const next = checkpointFixture().game;
  f.flow.start(next);
  const newer = f.flow.beginOperation("new-game"), obsolete = { field, tag: 51 };
  media.resolve(obsolete);
  assert.equal((await old).status, "cancelled");
  assert.equal(f.flow.session, next); assert.equal(newer.isCurrent(), true);
  assert.deepEqual(f.discarded, [obsolete]);
  assert.equal(f.game.world.commit(f.candidates[0]!), false); newer.cancel();
});

test("request mutation at every asynchronous boundary cannot redirect or publish a loaded map", async (t) => {
  for (const boundary of ["world", "map", "presentation"] as const) await t.test(boundary, async () => {
    const f = await fixture(), gate = deferred<void>(), entered = deferred<void>();
    const repository = new GameContentRepository(f.read);
    const contents = {
      world: async () => {
        const value = await repository.world();
        if (boundary === "world") { entered.resolve(); await gate.promise; }
        return value;
      },
      map: async (...args: Parameters<GameContentRepository["map"]>) => {
        const value = await repository.map(...args);
        if (boundary === "map") { entered.resolve(); await gate.promise; }
        return value;
      },
    };
    const loader = new GameMapLoader(f.flow, contents, {
      ...f.host, prepare: async (field) => {
        if (boundary === "presentation") { entered.resolve(); await gate.promise; }
        return f.host.prepare(field);
      },
    });
    const pending = loader.load(); await entered.promise;
    f.request.request.entrance = 999;
    gate.resolve();
    assert.equal((await pending).status, "cancelled");
    assert.equal(f.flow.busy, false); assert.equal(f.game.field, f.from);
    assert.equal(f.game.world.transitions.length, 0);
    assert.deepEqual(f.game.state.snapshot(), f.before);
    assert.equal(f.discarded.length, boundary === "presentation" ? 1 : 0);
    for (const candidate of f.candidates) assert.equal(f.game.world.commit(candidate), false);
  });
});

test("world staleness during media preparation is retryable and does not overwrite newer owned state", async () => {
  const f = await fixture(), media = deferred<void>(), entered = deferred<void>();
  let call = 0;
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), {
    ...f.host, prepare: async (field) => {
      if (++call === 1) { entered.resolve(); await media.promise; }
      return f.host.prepare(field);
    },
  });
  const pending = loader.load(); await entered.promise;
  // This is deliberately outside Flow's ordinary input gate: another owner
  // transaction can make the candidate stale while network/media is pending.
  f.from.eventState.write(callerRan, 0);
  const changed = f.game.state.snapshot();
  media.resolve();
  const failed = await pending;
  assert.equal(failed.status, "failed");
  assert.equal(f.game.field, f.from); assert.equal(f.from.stop, f.request);
  assert.deepEqual(f.game.state.snapshot(), changed);
  assert.equal(f.from.eventState.read(initialized), 0);
  assert.equal(f.game.world.transitions.length, 0); assert.equal(f.discarded.length, 1);
  assert.equal((await loader.load()).status, "committed");
  assert.equal(f.game.field.eventState.read(callerRan), 0);
  assert.equal(f.game.field.eventState.read(initialized), 1);
  assert.equal(f.game.world.transitions.length, 1);
});

test("concurrent load calls and another flow I/O cannot double prepare or commit", async () => {
  const f = await fixture(), gate = deferred<Presentation>(), entered = deferred<FieldGame>();
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), {
    ...f.host, prepare: async (field) => { entered.resolve(field); return gate.promise; },
  });
  const pending = loader.load(), field = await entered.promise;
  await assert.rejects(loader.load(), /already in progress/);
  assert.throws(() => f.flow.beginOperation("save"), /already in progress/);
  assert.equal(f.candidates.length, 1);
  gate.resolve({ field, tag: 1 });
  assert.equal((await pending).status, "committed");
  assert.equal(f.game.world.commit(f.candidates[0]!), false);
  assert.equal(f.game.world.transitions.length, 1);
});

test("missing map capability stays a preparation failure without weakening its gate", async () => {
  const f = await fixture();
  const map = await seal({ ...f.map, blockers: [{ reason: "Controlled native capability unavailable",
    source: { file: "synthetic", assetPath: "missing-capability" } }] });
  const catalog = structuredClone(f.catalog);
  catalog.maps[String(map.mapId)]!.contentHash = map.contentHash;
  f.files.set(f.mapUrl, map); f.files.set("/world/catalog.json", await seal(catalog));
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), f.host);
  for (let i = 0; i < 2; i++) {
    const result = await loader.load();
    assert.equal(result.status, "failed");
    if (result.status !== "failed") assert.fail("Expected strict capability gate");
    assert.match(String(result.error), /Controlled native capability unavailable/);
    f.unchanged();
  }
  assert.equal(f.presentations.length, 0); assert.equal(f.candidates.length, 0);
});

test("commit exceptions remain the original fatal error and are never offered as a retry result", async () => {
  const f = await fixture(), error = new Error("Controlled publication contract violation");
  const commit = f.game.world.commit.bind(f.game.world);
  // The real world commits first. This models a downstream publication hook
  // throwing after owned state has changed, where rollback cannot be promised.
  f.game.world.commit = (candidate) => { assert.equal(commit(candidate), true); throw error; };
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), f.host);
  await assert.rejects(loader.load(), (caught) => caught === error);
  assert.equal(f.game.world.transitions.length, 1);
  assert.equal(f.game.field.eventState.read(initialized), 1);
  assert.equal(f.flow.busy, false);
  await assert.rejects(loader.load(), /pending map request/);
});

test("cleanup failures are diagnostic and do not replace the original preparation error", async () => {
  const f = await fixture(), error = new Error("Original decode failure"), cleanup = new Error("Cleanup fault");
  const discard = f.game.world.discard.bind(f.game.world);
  f.game.world.discard = (candidate) => { discard(candidate); throw cleanup; };
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), {
    ...f.host, prepare: async () => { throw error; },
  });
  const result = await loader.load();
  assert.equal(result.status, "failed");
  if (result.status !== "failed") assert.fail("Expected failure");
  assert.equal(result.error, error); assert.deepEqual(result.cleanupErrors, [cleanup]);
  assert.equal(f.flow.busy, false); f.unchanged();
});

test("undefined is a valid prepared presentation and cancellation still disposes it", async () => {
  const f = await fixture(), media = deferred<undefined>(), entered = deferred<void>();
  const discarded: unknown[] = [];
  const loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), {
    prepare: async () => { entered.resolve(); return media.promise; },
    discard: (value) => { discarded.push(value); },
  });
  const pending = loader.load(); await entered.promise;
  loader.cancel(); media.resolve(undefined);
  assert.equal((await pending).status, "cancelled");
  assert.deepEqual(discarded, [undefined]); f.unchanged();
});

test("title and unrelated flow operations reject map loading without disturbing their owner", async () => {
  const f = await fixture(), loader = new GameMapLoader(f.flow, new GameContentRepository(f.read), f.host);
  f.flow.returnToTitle();
  await assert.rejects(loader.load(), /started session/);
  assert.equal(f.flow.phase, "title");
  f.flow.start();
  const saved = f.flow.beginOperation("save");
  await assert.rejects(loader.load(), /already in progress/);
  assert.equal(saved.isCurrent(), true); assert.equal(f.candidates.length, 0);
  f.unchanged(); saved.cancel();
});
