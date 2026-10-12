import assert from "node:assert/strict";
import test from "node:test";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { GameSession } from "../src/core/game-session.js";
import { CheckpointStorage, type PreparedSave } from "../src/core/saved-game.js";
import { afterEventSave, eventSaveReadyHost as ready, gameEventSaveFixture } from "./fixtures/game-event-save.js";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function memoryStorage() {
  const values = new Map<string, string>();
  let writes = 0, fail = false;
  return { values, get writes() { return writes; }, set fail(value: boolean) { fail = value; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) {
      if (fail) throw new Error("Controlled quota failure");
      writes++; values.set(key, value);
    } };
}
function nextTick(f: ReturnType<typeof gameEventSaveFixture>, session = f.session) {
  session.advance(10);
  assert.equal(session.eventSaveRequest, null);
  assert.equal(f.itemCount(session), 5);
  assert.equal(session.field.eventState.read(afterEventSave), 1);
  assert.equal(session.checkpointReady, true);
}

test("event save writes its continuation once, ACKs without pumping, and restore never repeats earlier grants", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const coordinator = new GameEventSaveCoordinator(f.flow, storage), request = f.start();
  const owned = f.session.state, field = f.session.field, world = f.session.world;
  assert.equal(f.itemCount(), 2); assert.equal(f.session.checkpointReady, false);
  const result = await coordinator.save(1000);
  assert.equal(result.status, "committed");
  if (result.status !== "committed") assert.fail("Expected committed save");
  assert.equal(result.session, f.session); assert.equal(result.request, request);
  assert.equal(memory.writes, 1); assert.equal(f.flow.busy, false);
  assert.equal(f.session.state, owned); assert.equal(f.session.field, field); assert.equal(f.session.world, world);
  assert.equal(f.session.eventSaveRequest, null);
  assert.equal(f.itemCount(), 2, "ACK must not execute the following grant");
  assert.equal(field.eventState.read(afterEventSave), 0);
  const saved = (await storage.load())!;
  assert.equal(saved.savedAt, 1000); assert.equal(saved.checkpoint.world.field.kind, "event-field-v1");
  const restored = GameSession.restore(saved.checkpoint, f.field, f.battle);
  assert.equal(restored.eventSaveRequest, null); assert.equal(f.itemCount(restored), 2);
  await assert.rejects(coordinator.save(1001), /pending event save request/);
  nextTick(f); nextTick(f, restored);
  assert.deepEqual(restored.checkpoint(), f.session.checkpoint());
  f.flow.confirm(); f.flow.advance(100, ready);
  assert.equal(f.itemCount(), 5); assert.equal(memory.writes, 1);
});

test("encoding waits freeze the real flow; concurrent save calls cannot reserve a second write", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const readyToEncode = deferred<void>(), entered = deferred<void>();
  const coordinator = new GameEventSaveCoordinator(f.flow, { prepareSave: async (checkpoint, savedAt) => {
    entered.resolve(); await readyToEncode.promise; return storage.prepareSave(checkpoint, savedAt);
  } });
  const request = f.start(), before = f.session.state.snapshot(), time = f.session.field.time;
  f.flow.pause(true);
  const pending = coordinator.save(1000); await entered.promise;
  assert.equal(f.flow.phase, "loading"); assert.equal(f.flow.inputReady, false);
  f.flow.advance(1000, ready); assert.equal(f.session.field.time, time);
  assert.deepEqual(f.session.state.snapshot(), before); assert.equal(f.session.eventSaveRequest, request);
  await assert.rejects(coordinator.save(1001), /already in progress/);
  readyToEncode.resolve(); assert.equal((await pending).status, "committed");
  assert.equal(f.flow.paused, true); assert.equal(memory.writes, 1); assert.equal(f.itemCount(), 2);
});

test("failed encoding retains the exact request and supports a fresh preparation", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const problem = new Error("Controlled encode failure"); let failures = 1;
  const coordinator = new GameEventSaveCoordinator(f.flow, { prepareSave: async (...args) => {
    if (failures-- > 0) throw problem; return storage.prepareSave(...args);
  } });
  const request = f.start(), before = f.session.state.snapshot();
  const failed = await coordinator.save(1000);
  assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected retryable failure");
  assert.equal(failed.error, problem); assert.equal(failed.request, request);
  assert.equal(f.session.eventSaveRequest, request); assert.deepEqual(f.session.state.snapshot(), before);
  assert.equal(memory.writes, 0); assert.equal(f.flow.busy, false);
  assert.equal((await coordinator.save(1001)).status, "committed");
  assert.equal(memory.writes, 1); nextTick(f);
});

test("atomic storage failure preserves both slots and the request; retry writes once and then continues", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  await storage.save(f.session.checkpoint(), 10);
  const before = [...memory.values], request = f.start(); memory.fail = true;
  const coordinator = new GameEventSaveCoordinator(f.flow, storage);
  const failed = await coordinator.save(20);
  assert.equal(failed.status, "failed"); assert.equal(f.session.eventSaveRequest, request);
  assert.deepEqual([...memory.values], before); assert.equal(memory.writes, 1); assert.equal(f.itemCount(), 2);
  memory.fail = false;
  assert.equal((await coordinator.save(30)).status, "committed");
  assert.equal((await storage.load(true))!.savedAt, 10); assert.equal(memory.writes, 2);
  nextTick(f);
});

test("slot CAS conflict retains another writer's progress and keeps the event request retryable", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const candidate = deferred<void>(), entered = deferred<void>();
  const coordinator = new GameEventSaveCoordinator(f.flow, { prepareSave: async (...args) => {
    const result = await storage.prepareSave(...args); entered.resolve();
    await candidate.promise; return result;
  } });
  const beforeCheckpoint = f.session.checkpoint(), request = f.start(), pending = coordinator.save(1000);
  await entered.promise; await storage.save(beforeCheckpoint, 2000);
  const winningBytes = [...memory.values]; candidate.resolve();
  const failed = await pending;
  assert.equal(failed.status, "failed");
  if (failed.status !== "failed") assert.fail("Expected CAS failure");
  assert.match(String(failed.error), /slot changed/);
  assert.deepEqual([...memory.values], winningBytes); assert.equal(memory.writes, 1);
  assert.equal(f.session.eventSaveRequest, request); assert.equal(f.itemCount(), 2);
  const retry = new GameEventSaveCoordinator(f.flow, storage);
  assert.equal((await retry.save(3000)).status, "committed");
  assert.equal((await storage.load(true))!.savedAt, 2000); nextTick(f);
});

test("cancelled encoding cannot write or finish a later operation, and late candidates are discarded once", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const encoded = deferred<void>(), entered = deferred<void>(); let discarded = 0;
  const coordinator = new GameEventSaveCoordinator(f.flow, { prepareSave: async (...args) => {
    const prepared = await storage.prepareSave(...args); entered.resolve(); await encoded.promise;
    return { ...prepared, discard: () => { discarded++; prepared.discard(); } };
  } });
  const request = f.start(), pending = coordinator.save(1000); await entered.promise;
  coordinator.cancel(); coordinator.cancel();
  assert.equal(f.flow.busy, false); assert.equal(f.session.eventSaveRequest, request);
  const newer = f.flow.beginOperation("load"); encoded.resolve();
  assert.equal((await pending).status, "cancelled");
  assert.equal(newer.isCurrent(), true); assert.equal(discarded, 1); assert.equal(memory.writes, 0);
  assert.equal(f.itemCount(), 2); newer.cancel();
  assert.equal((await new GameEventSaveCoordinator(f.flow, storage).save(1001)).status, "committed");
});

test("returning to title or replacing the session makes a late encoder failure harmless", async (t) => {
  for (const replace of [false, true]) await t.test(replace ? "replacement" : "title", async () => {
    const f = gameEventSaveFixture(), encoded = deferred<PreparedSave>(), entered = deferred<void>();
    const coordinator = new GameEventSaveCoordinator(f.flow, { prepareSave: async () => { entered.resolve(); return encoded.promise; } });
    const request = f.start(), pending = coordinator.save(1000); await entered.promise;
    f.flow.returnToTitle();
    const next = gameEventSaveFixture().session;
    if (replace) f.flow.start(next);
    const newer = f.flow.beginOperation("new-game");
    encoded.reject(new Error("Obsolete encoder failure"));
    assert.equal((await pending).status, "cancelled");
    assert.equal(newer.isCurrent(), true); assert.equal(f.session.eventSaveRequest, request);
    assert.equal(f.flow.currentSession, replace ? next : f.session); assert.equal(f.itemCount(), 2); newer.cancel();
  });
});

test("changed gameplay state before commit refuses the stale candidate without writing or acknowledging", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const encoded = deferred<void>(), entered = deferred<void>();
  const coordinator = new GameEventSaveCoordinator(f.flow, { prepareSave: async (...args) => {
    const prepared = await storage.prepareSave(...args); entered.resolve(); await encoded.promise; return prepared;
  } });
  const request = f.start(), pending = coordinator.save(1000); await entered.promise;
  f.session.state.changeItems([{ id: 10, count: 1 }], "grant");
  encoded.resolve(); const result = await pending;
  assert.equal(result.status, "failed"); assert.equal(memory.writes, 0);
  assert.equal(f.session.eventSaveRequest, request); assert.equal(f.itemCount(), 3);
  assert.equal((await new GameEventSaveCoordinator(f.flow, storage).save(1001)).status, "committed");
  assert.equal(f.itemCount(), 3);
});

test("cancellation during final validation is rechecked inside the write callback", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const prepare = f.session.prepareEventSave.bind(f.session);
  f.session.prepareEventSave = (request) => {
    const next = prepare(request);
    return { ...next, commitWith: (write) => next.commitWith(() => { f.flow.returnToTitle(); write(); }) };
  };
  const request = f.start();
  const result = await new GameEventSaveCoordinator(f.flow, storage).save(1000);
  assert.equal(result.status, "cancelled"); assert.equal(memory.writes, 0);
  assert.equal(f.session.eventSaveRequest, request); assert.equal(f.flow.started, false);
});

test("an ACK exception after a successful write is fatal and cannot be turned into a second save", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const request = f.start(), problem = new Error("Controlled ACK failure");
  const acknowledge = f.session.field.acknowledgeEventSave.bind(f.session.field);
  f.session.field.acknowledgeEventSave = () => { throw problem; };
  const coordinator = new GameEventSaveCoordinator(f.flow, storage);
  await assert.rejects(coordinator.save(1000), (error) => error === problem);
  assert.equal(memory.writes, 1); assert.equal(f.session.eventSaveRequest, request);
  assert.equal(f.flow.busy, false); assert.equal(f.itemCount(), 2);
  f.session.field.acknowledgeEventSave = acknowledge;
  await assert.rejects(coordinator.save(1001), /written but not acknowledged/);
  assert.equal(memory.writes, 1);
  const restored = GameSession.restore((await storage.load())!.checkpoint, f.field, f.battle);
  nextTick(f, restored);
});

test("a new title operation during storage publication is fatal after the write and cannot ACK an obsolete owner", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const request = f.start();
  const coordinator = new GameEventSaveCoordinator(f.flow, { prepareSave: async (...args) => {
    const prepared = await storage.prepareSave(...args);
    return { ...prepared, commit: () => { prepared.commit(); f.flow.returnToTitle(); } };
  } });
  await assert.rejects(coordinator.save(1000), /owner changed after storage/);
  assert.equal(memory.writes, 1); assert.equal(f.session.eventSaveRequest, request);
  assert.equal(f.flow.started, false); assert.equal(f.itemCount(), 2);
});

test("a broken core that ACKs without invoking storage is fatal rather than a retryable save", async () => {
  const f = gameEventSaveFixture(), memory = memoryStorage(), storage = new CheckpointStorage(memory);
  const prepare = f.session.prepareEventSave.bind(f.session);
  f.session.prepareEventSave = (request) => {
    const next = prepare(request);
    return { ...next, commitWith: () => { f.session.field.acknowledgeEventSave(request); } };
  };
  f.start();
  await assert.rejects(new GameEventSaveCoordinator(f.flow, storage).save(1000), /without writing/);
  assert.equal(memory.writes, 0); assert.equal(f.session.eventSaveRequest, null);
});

test("cleanup failures do not hide the original encoding failure or release a newer ticket", async () => {
  const f = gameEventSaveFixture(), prepare = f.session.prepareEventSave.bind(f.session);
  const problem = new Error("Encode failure"), cleanup = new Error("Discard failure");
  f.session.prepareEventSave = (request) => {
    const next = prepare(request);
    return { ...next, discard: () => { next.discard(); throw cleanup; } };
  };
  f.start();
  const result = await new GameEventSaveCoordinator(f.flow, { prepareSave: async () => { throw problem; } }).save(1000);
  assert.equal(result.status, "failed");
  if (result.status !== "failed") assert.fail("Expected failure");
  assert.equal(result.error, problem); assert.deepEqual(result.cleanupErrors, [cleanup]);
  assert.equal(f.flow.busy, false); assert.equal(f.itemCount(), 2);
});
