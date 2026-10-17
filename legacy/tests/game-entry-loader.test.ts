import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { GameEntryLoader, type GameEntryCandidate, type GameEntryAttempt } from "../src/core/game-entry-loader.js";
import { GameFlow, type GameFlowTicket } from "../src/core/game-flow.js";
import { GameSession } from "../src/core/game-session.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

type View = { id: number };
const ready = { visible: true, mediaReady: true, overlayOpen: false };
function session(seed = 314) {
  const fixture = checkpointFixture();
  return new GameSession(fixture.field, fixture.battle, seed, { battleHandoff: "prepared" });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ title = false, paused = true } = {}) {
  const old = session(), flow = title ? new GameFlow() : new GameFlow(old);
  if (!title) { flow.start(); flow.advance(0, ready); flow.pause(paused); }
  const discarded: View[] = [], loader = new GameEntryLoader(flow, { discard: (view: View) => { discarded.push(view); } });
  const baseline = old.checkpoint();
  return { old, flow, loader, discarded, baseline };
}
function candidate(id = 1): GameEntryCandidate<View> {
  return { session: session(id), presentation: { id } };
}

test("an empty title reserves the existing Flow ticket and publishes the prepared owner once", async () => {
  const f = fixture({ title: true }), a = f.loader.begin("new-game"), wait = deferred<GameEntryCandidate<View>>();
  assert.equal(f.flow.phase, "loading"); assert.equal(f.flow.currentSession, null); assert.equal(f.loader.busy, true);
  let calls = 0;
  const pending = a.prepare(context => {
    calls++; assert.equal(Object.isFrozen(context), true); assert.equal(context.isCurrent(), true);
    assert.equal("publish" in context, false); return wait.promise;
  });
  f.flow.advance(60000, ready); assert.equal(f.flow.currentSession, null);
  const next = candidate(); wait.resolve(next);
  const result = await pending; assert.equal(result.status, "committed");
  if (result.status !== "committed") assert.fail("Expected entry publication");
  assert.equal(result.session, next.session); assert.equal(result.presentation, next.presentation);
  assert.equal(result.kind, "new-game"); assert.equal(f.flow.session, next.session); assert.equal(f.flow.started, true);
  assert.equal(f.flow.inputReady, false); assert.equal(f.flow.busy, false); assert.equal(calls, 1);
  assert.equal(a.isCurrent(), false); a.cancel(); f.loader.cancel();
  assert.deepEqual(f.discarded, []); assert.equal(a.commit(next).status, "cancelled");
  assert.deepEqual(f.discarded, []); assert.equal(f.flow.session, next.session);
  f.flow.advance(0, ready); assert.equal(f.flow.inputReady, true);
});

test("frame-driven commit preserves the original provider's scheduling and load pause option", () => {
  const f = fixture(), a = f.loader.begin("load"), next = candidate(); next.options = { paused: true };
  f.flow.advance(60000, ready); assert.deepEqual(f.old.checkpoint(), f.baseline);
  assert.equal(f.flow.currentSession, f.old); assert.equal(a.isCurrent(), true);
  const result = a.commit(next); assert.equal(result.status, "committed");
  assert.equal(f.flow.currentSession, next.session); assert.equal(f.flow.paused, true); assert.equal(f.flow.phase, "paused");
  assert.deepEqual(f.discarded, []); a.cancel();
  assert.equal(a.commit(next).status, "cancelled"); assert.deepEqual(f.discarded, []);
  const late = candidate(2); assert.equal(a.commit(late).status, "cancelled");
  assert.deepEqual(f.discarded, [late.presentation]); assert.equal(f.flow.currentSession, next.session);
  assert.equal(a.commit(late).status, "cancelled"); assert.deepEqual(f.discarded, [late.presentation]);
});

test("a failed complete preparation keeps the outgoing owner, pause and checkpoint for a clean retry", async () => {
  const f = fixture(), error = new Error("Controlled media failure"), a = f.loader.begin("load");
  const result = await a.prepare(async () => { throw error; });
  assert.equal(result.status, "failed"); if (result.status !== "failed") assert.fail("Expected failure");
  assert.equal(result.error, error); assert.equal(result.kind, "load");
  assert.equal(f.flow.currentSession, f.old); assert.equal(f.flow.paused, true); assert.equal(f.flow.busy, false);
  assert.deepEqual(f.old.checkpoint(), f.baseline); assert.deepEqual(f.discarded, []);
  const next = candidate(2); assert.equal((await f.loader.begin("load").prepare(() => next)).status, "committed");
  assert.equal(f.flow.currentSession, next.session); assert.deepEqual(f.old.checkpoint(), f.baseline);
});

test("cancelled pending media disposes only its late view and cannot finish a newer entry ticket", async () => {
  const f = fixture(), old = f.loader.begin("load"), media = deferred<GameEntryCandidate<View>>();
  let context!: { isCurrent(): boolean };
  const pending = old.prepare(value => { context = value; return media.promise; });
  old.cancel(); old.cancel(); assert.equal(context.isCurrent(), false); assert.equal(f.flow.busy, false);
  assert.equal(f.flow.currentSession, f.old); assert.equal(f.flow.paused, true);
  const next = f.loader.begin("new-game"), nextMedia = deferred<GameEntryCandidate<View>>(), waiting = next.prepare(() => nextMedia.promise);
  const obsolete = candidate(1); media.resolve(obsolete);
  assert.equal((await pending).status, "cancelled"); assert.equal(next.isCurrent(), true); assert.equal(f.flow.busy, true);
  assert.deepEqual(f.discarded, [obsolete.presentation]); old.cancel(); assert.equal(next.isCurrent(), true);
  const live = candidate(2); nextMedia.resolve(live); assert.equal((await waiting).status, "committed");
  assert.equal(f.flow.currentSession, live.session); assert.deepEqual(f.old.checkpoint(), f.baseline);
});

test("external Flow title and owner replacement revoke entry attempts before any late candidate publishes", async t => {
  for (const replace of [false, true]) await t.test(replace ? "owner replacement" : "return to title", async () => {
    const f = fixture(), a = f.loader.begin("load"), wait = deferred<GameEntryCandidate<View>>();
    const pending = a.prepare(() => wait.promise), replacement = session(99);
    if (replace) f.flow.start(replacement, { paused: false }); else f.flow.returnToTitle();
    assert.equal(a.isCurrent(), false); assert.equal(f.loader.busy, false); assert.equal(f.flow.busy, false);
    const late = candidate(); wait.resolve(late); assert.equal((await pending).status, "cancelled");
    assert.deepEqual(f.discarded, [late.presentation]);
    assert.equal(f.flow.currentSession, replace ? replacement : f.old); assert.equal(f.flow.started, replace);
    assert.deepEqual(f.old.checkpoint(), f.baseline);
  });
});

test("late preparation rejection is cancellation and does not change another operation", async () => {
  const f = fixture(), a = f.loader.begin("load"), wait = deferred<GameEntryCandidate<View>>();
  const pending = a.prepare(() => wait.promise); a.cancel();
  const save = f.flow.beginOperation("save"); wait.reject(new Error("Obsolete decode rejection"));
  assert.equal((await pending).status, "cancelled"); assert.equal(save.isCurrent(), true); assert.equal(f.flow.busy, true);
  assert.deepEqual(f.old.checkpoint(), f.baseline); save.finish();
});

test("once submitted preparation cannot run again or accept an external frame commit while pending", async () => {
  const f = fixture(), a = f.loader.begin("load"), wait = deferred<GameEntryCandidate<View>>(); let calls = 0;
  const pending = a.prepare(() => { calls++; return wait.promise; });
  await assert.rejects(a.prepare(() => { calls++; return candidate(2); }), /already been submitted/);
  const unowned = candidate(3); assert.throws(() => a.commit(unowned), /preparation is pending/);
  assert.deepEqual(f.discarded, []); assert.equal(a.isCurrent(), true);
  a.cancel(); assert.throws(() => a.commit(unowned), /preparation is pending/);
  const late = candidate(); wait.resolve(late); assert.equal((await pending).status, "cancelled"); assert.equal(calls, 1);
  await assert.rejects(a.prepare(() => { calls++; return candidate(4); }), /already been submitted/);
  assert.equal(calls, 1); assert.deepEqual(f.discarded, [late.presentation]);
});

test("an unsubmitted revoked attempt never calls its factory and discards completed external candidates once", async () => {
  const f = fixture(), a = f.loader.begin("new-game"); a.cancel(); let calls = 0;
  assert.equal((await a.prepare(() => { calls++; return candidate(); })).status, "cancelled"); assert.equal(calls, 0);
  const stale = candidate(); assert.equal(a.commit(stale).status, "cancelled");
  assert.equal(a.commit(stale).status, "cancelled"); assert.deepEqual(f.discarded, [stale.presentation]);
  assert.equal(f.flow.currentSession, f.old); assert.deepEqual(f.old.checkpoint(), f.baseline);
});

test("invalid complete candidates reject before publication and release their claimed presentation", async t => {
  for (const mutate of [
    (value: GameEntryCandidate<View>) => { (value as unknown as { session: unknown }).session = {}; },
    (value: GameEntryCandidate<View>) => { value.options = { paused: "yes" } as never; },
    (value: GameEntryCandidate<View>) => { (value as unknown as Record<string, unknown>).extra = 1; },
    (value: GameEntryCandidate<View>) => { value.options = { paused: false, extra: true } as never; },
  ]) await t.test(String(mutate), async () => {
    const f = fixture(), next = candidate(); mutate(next);
    const result = await f.loader.begin("load").prepare(() => next); assert.equal(result.status, "failed");
    assert.deepEqual(f.discarded, [next.presentation]); assert.equal(f.flow.currentSession, f.old); assert.equal(f.flow.paused, true);
    assert.equal(f.flow.busy, false); assert.deepEqual(f.old.checkpoint(), f.baseline);
  });
});

test("candidate and option accessors never run reentrant owner changes", () => {
  for (const top of [false, true]) {
    const f = fixture(), next = candidate(); let calls = 0;
    const accessor = { enumerable: true, get: () => { calls++; f.flow.start(session(999)); return true; } };
    if (top) Object.defineProperty(next, "session", accessor);
    else { next.options = {}; Object.defineProperty(next.options, "paused", accessor); }
    const result = f.loader.begin("load").commit(next); assert.equal(result.status, "failed");
    assert.equal(calls, 0); assert.equal(f.flow.currentSession, f.old); assert.equal(f.flow.paused, true);
    assert.deepEqual(f.discarded, [next.presentation]); assert.deepEqual(f.old.checkpoint(), f.baseline);
  }
});

test("foreign-realm data candidates publish without reading their prototypes", () => {
  const f = fixture(), expected = session(), view = { id: 1 };
  const next = runInNewContext("({session: expected, presentation: view, options: {paused: true}})", { expected, view }) as GameEntryCandidate<View>;
  assert.notEqual(Object.getPrototypeOf(next), Object.prototype);
  const result = f.loader.begin("load").commit(next); assert.equal(result.status, "committed");
  assert.equal(f.flow.currentSession, expected); assert.equal(f.flow.paused, true); assert.deepEqual(f.discarded, []);
});

test("captured data is not redirected by a Flow invalidation callback during own publication", () => {
  const f = fixture(), next = candidate(), original = next.session, view = next.presentation;
  next.options = { paused: true };
  const begin = f.flow.beginOperation.bind(f.flow);
  f.flow.beginOperation = kind => {
    const ticket = begin(kind);
    ticket.onInvalidate(() => { next.session = session(999); next.presentation = { id: 999 }; next.options!.paused = false; });
    return ticket;
  };
  const result = f.loader.begin("load").commit(next); assert.equal(result.status, "committed");
  if (result.status !== "committed") assert.fail("Expected captured publication");
  assert.equal(result.session, original); assert.equal(result.presentation, view); assert.equal(f.flow.session, original);
  assert.equal(f.flow.paused, true); assert.deepEqual(f.discarded, []);
});

test("cleanup failure remains secondary to a validation failure and does not dispose twice", () => {
  const f = fixture(), cleanup = new Error("Controlled view disposal failure"); let calls = 0;
  const loader = new GameEntryLoader<View>(f.flow, { discard: () => { calls++; throw cleanup; } });
  const next = candidate(); next.options = { paused: 1 } as never;
  const a = loader.begin("load"), result = a.commit(next); assert.equal(result.status, "failed");
  if (result.status !== "failed") assert.fail("Expected validation failure");
  assert.match(String(result.error), /start options/); assert.deepEqual(result.cleanupErrors, [cleanup]);
  a.cancel(); assert.equal(a.commit(next).status, "cancelled"); assert.equal(calls, 1);
  assert.equal(f.flow.currentSession, f.old); assert.equal(f.flow.busy, false); assert.deepEqual(f.old.checkpoint(), f.baseline);
});

test("a binding error after commitment cannot dispose or replay the published session", async () => {
  const f = fixture(), a = f.loader.begin("load"), next = candidate();
  const result = await a.prepare(() => next); assert.equal(result.status, "committed");
  assert.throws(() => { throw new Error("Controlled postpublication widget error"); }, /widget error/);
  a.cancel(); f.loader.cancel(); assert.equal(a.commit({ ...next }).status, "cancelled");
  assert.equal(f.flow.currentSession, next.session); assert.deepEqual(f.discarded, []);
  await assert.rejects(a.prepare(() => candidate(2)), /already been submitted/);
});

test("a malformed duplicate envelope cannot claim and discard a transferred view", () => {
  const f = fixture(), a = f.loader.begin("load"), next = candidate();
  assert.equal(a.commit(next).status, "committed");
  const copy = { ...next, options: { paused: "invalid" } } as never;
  assert.equal(a.commit(copy).status, "cancelled");
  assert.equal(f.flow.currentSession, next.session); assert.deepEqual(f.discarded, []);
});

test("an exception after the actual Flow owner write is fatal and never becomes a retryable failure", async t => {
  for (const asyncPrepare of [false, true]) await t.test(asyncPrepare ? "async factory" : "external frame", async () => {
    const f = fixture(), error = new Error("Controlled postpublication violation"), next = candidate();
    const begin = f.flow.beginOperation.bind(f.flow);
    f.flow.beginOperation = kind => {
      const ticket = begin(kind), publish = ticket.publish;
      return { ...ticket, publish: (...args: Parameters<GameFlowTicket["publish"]>) => { assert.equal(publish(...args), true); throw error; } };
    };
    const a = f.loader.begin("load");
    if (asyncPrepare) await assert.rejects(a.prepare(() => next), value => value === error);
    else assert.throws(() => a.commit(next), value => value === error);
    assert.equal(f.flow.currentSession, next.session); assert.deepEqual(f.discarded, []); assert.equal(f.flow.busy, false);
    a.cancel(); assert.equal(a.commit(next).status, "cancelled"); assert.deepEqual(f.discarded, []);
  });
});

test("a publish guard failure stays before the owner write and cleans its private presentation", () => {
  const f = fixture(), next = candidate(), error = new Error("Controlled Flow guard refusal");
  const begin = f.flow.beginOperation.bind(f.flow);
  f.flow.beginOperation = kind => { const ticket = begin(kind); ticket.onInvalidate(() => { throw error; }); return ticket; };
  const result = f.loader.begin("load").commit(next); assert.equal(result.status, "failed");
  if (result.status !== "failed") assert.fail("Expected guard failure");
  assert.equal(result.error, error); assert.equal(f.flow.currentSession, f.old); assert.equal(f.flow.paused, true);
  assert.equal(f.flow.busy, false); assert.deepEqual(f.discarded, [next.presentation]); assert.deepEqual(f.old.checkpoint(), f.baseline);
});

test("reentrant entry cancellation in Flow.publish cannot discard a candidate during its publication fence", () => {
  const f = fixture(), next = candidate(); let a!: GameEntryAttempt<View>;
  const begin = f.flow.beginOperation.bind(f.flow);
  f.flow.beginOperation = kind => { const ticket = begin(kind); ticket.onInvalidate(() => a.cancel()); return ticket; };
  a = f.loader.begin("load"); const result = a.commit(next); assert.equal(result.status, "failed");
  if (result.status !== "failed") assert.fail("Expected publication fence refusal");
  assert.match(String(result.error), /publication is in progress/); assert.equal(f.flow.currentSession, f.old);
  assert.equal(f.flow.busy, false); assert.deepEqual(f.discarded, [next.presentation]); assert.deepEqual(f.old.checkpoint(), f.baseline);
});

test("only entry kinds are accepted and an existing nonentry Flow operation remains untouched", () => {
  const f = fixture(); assert.throws(() => f.loader.begin("save" as never), /Unknown game entry kind/);
  const save = f.flow.beginOperation("save"); assert.throws(() => f.loader.begin("load"), /already in progress/);
  f.loader.cancel(); assert.equal(save.isCurrent(), true); save.finish();
  const a = f.loader.begin("new-game"); assert.throws(() => f.loader.begin("load"), /entry preparation is already/);
  assert.equal(a.isCurrent(), true); a.cancel();
});
