import test from "node:test";
import assert from "node:assert/strict";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { GameFlow } from "../src/core/game-flow.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const slotKey = "ffvi-reweb.checkpoint.v1";
function memoryStorage() {
  const values = new Map<string, string>();
  let writes = 0, failWrite = false;
  return {
    values,
    get writes() { return writes; },
    set failWrite(value: boolean) { failWrite = value; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) {
      if (failWrite) throw new Error("QuotaExceeded");
      writes++;
      values.set(key, value);
    },
  };
}

test("prepared saves capture the checkpoint and publish current plus previous in one synchronous write", async () => {
  const memory = memoryStorage(), store = new CheckpointStorage(memory);
  const checkpoint = checkpointFixture().game.checkpoint();
  await store.save(checkpoint, 10);
  const before = memory.values.get(slotKey), expected = structuredClone(checkpoint);
  const pending = store.prepareSave(checkpoint, 20);
  checkpoint.owned.gil++;
  const prepared = await pending;
  assert.equal(memory.values.get(slotKey), before);
  assert.equal(memory.writes, 1, "encoding must not publish a slot");
  assert.equal(prepared.commit(), undefined, "commit is synchronous");
  assert.equal(memory.writes, 2);
  assert.equal((await store.load())!.savedAt, 20);
  assert.deepEqual((await store.load())!.checkpoint, expected);
  assert.equal((await store.load(true))!.savedAt, 10);
  assert.throws(() => prepared.commit(), /consumed|discarded/);
  prepared.discard();
  prepared.cancel();
  assert.equal(memory.writes, 2);
  assert.deepEqual(Object.keys(JSON.parse(memory.values.get(slotKey)!)).sort(),
    ["current", "formatVersion", "previous"], "the slot schema is unchanged");
});

test("discard and cancel invalidate a prepared save without changing either retained checkpoint", async () => {
  const memory = memoryStorage(), store = new CheckpointStorage(memory);
  const checkpoint = checkpointFixture().game.checkpoint();
  await store.save(checkpoint, 10);
  await store.save(checkpoint, 20);
  const before = memory.values.get(slotKey);
  for (const method of ["discard", "cancel"] as const) {
    const prepared = await store.prepareSave(checkpoint, 30);
    prepared[method]();
    prepared[method]();
    assert.throws(() => prepared.commit(), /consumed|discarded/);
    assert.equal(memory.values.get(slotKey), before);
    assert.equal(memory.writes, 2);
  }
});

test("the slot comparison runs at commit, including changes made while encoding", async () => {
  const memory = memoryStorage(), store = new CheckpointStorage(memory);
  const checkpoint = checkpointFixture().game.checkpoint();
  const pending = store.prepareSave(checkpoint, 10);
  memory.values.set(slotKey, "another writer during encoding");
  const prepared = await pending;
  assert.equal(memory.writes, 0);
  assert.throws(() => prepared.commit(), /slot changed/);
  assert.equal(memory.values.get(slotKey), "another writer during encoding");
  assert.throws(() => prepared.commit(), /consumed|discarded/);
  const next = await store.prepareSave(checkpoint, 20);
  memory.values.set(slotKey, "another writer after encoding");
  assert.throws(() => next.commit(), /slot changed/);
  assert.equal(memory.values.get(slotKey), "another writer after encoding");
  assert.equal(memory.writes, 0);
});

test("concurrent preparations from separate storage owners cannot replace the committed winner", async () => {
  const memory = memoryStorage(), first = new CheckpointStorage(memory), second = new CheckpointStorage(memory);
  const checkpoint = checkpointFixture().game.checkpoint();
  const [a, b] = await Promise.all([first.prepareSave(checkpoint, 10), second.prepareSave(checkpoint, 20)]);
  b.commit();
  const winner = memory.values.get(slotKey);
  assert.throws(() => a.commit(), /slot changed/);
  assert.equal(memory.values.get(slotKey), winner);
  assert.equal((await first.load())!.savedAt, 20);
  assert.equal(memory.writes, 1);
});

test("failed synchronous storage writes preserve the old slot and consume the attempted candidate", async () => {
  const memory = memoryStorage(), store = new CheckpointStorage(memory);
  const checkpoint = checkpointFixture().game.checkpoint();
  await store.save(checkpoint, 10);
  const before = memory.values.get(slotKey), prepared = await store.prepareSave(checkpoint, 20);
  memory.failWrite = true;
  assert.throws(() => prepared.commit(), /QuotaExceeded/);
  assert.equal(memory.values.get(slotKey), before);
  memory.failWrite = false;
  assert.throws(() => prepared.commit(), /consumed|discarded/);
  const retry = await store.prepareSave(checkpoint, 30);
  retry.commit();
  assert.equal((await store.load())!.savedAt, 30);
  assert.equal((await store.load(true))!.savedAt, 10);
  assert.equal(memory.writes, 2);
});

test("prepared saves retain unreadable prior bytes instead of discarding them", async () => {
  const memory = memoryStorage(), store = new CheckpointStorage(memory);
  memory.values.set(slotKey, "unreadable existing progress");
  const prepared = await store.prepareSave(checkpointFixture().game.checkpoint(), 10);
  assert.equal(memory.values.get(slotKey), "unreadable existing progress");
  prepared.commit();
  assert.equal(JSON.parse(memory.values.get(slotKey)!).previous, "unreadable existing progress");
  assert.equal((await store.load())!.savedAt, 10);
});

test("returning to title during save encoding permits discarding the old request before a new session saves", async () => {
  const memory = memoryStorage(), store = new CheckpointStorage(memory);
  const first = checkpointFixture().game, replacement = checkpointFixture().game;
  const flow = new GameFlow(first);
  flow.start();
  const oldTicket = flow.beginOperation("save");
  const pending = store.prepareSave(first.checkpoint(), 10);
  flow.returnToTitle();
  replacement.state.changeItems([{ id: 10, count: 1 }], "grant");
  flow.start(replacement);
  const newTicket = flow.beginOperation("save");
  const oldSave = await pending;
  assert.equal(oldTicket.isCurrent(), false);
  oldSave.discard();
  assert.equal(oldTicket.finish(), false, "an old ticket cannot finish the new request");
  assert.equal(flow.busy, true);
  assert.equal(memory.writes, 0);
  const current = await store.prepareSave(flow.session.checkpoint(), 20);
  assert.equal(newTicket.isCurrent(), true);
  current.commit();
  assert.equal(newTicket.finish(), true);
  assert.equal(flow.session, replacement);
  assert.deepEqual((await store.load())!.checkpoint, replacement.checkpoint());
  assert.equal(memory.writes, 1);
  assert.throws(() => oldSave.commit(), /consumed|discarded/);
});

test("source and framework preparations compare only their own existing slots", async () => {
  const memory = memoryStorage(), source = new CheckpointStorage(memory), framework = new CheckpointStorage(memory, "framework");
  const checkpoint = checkpointFixture().game.checkpoint();
  const [strict, variant] = await Promise.all([source.prepareSave(checkpoint, 10), framework.prepareSave(checkpoint, 20)]);
  strict.commit();
  variant.commit();
  assert.equal((await source.load())!.savedAt, 10);
  assert.equal((await framework.load())!.savedAt, 20);
  assert.equal(memory.writes, 2);
});

test("content packages retain independent progress and do not replace legacy slots", async () => {
  const memory = memoryStorage(), checkpoint = checkpointFixture().game.checkpoint();
  const source = new CheckpointStorage(memory), framework = new CheckpointStorage(memory, "framework");
  await source.save(checkpoint, 10); await framework.save(checkpoint, 20);
  const legacySource = memory.values.get(slotKey), legacyFramework = memory.values.get("ffvi-reweb.framework.checkpoint.v1");
  const playground = new CheckpointStorage(memory, "framework", "systems-playground");
  const figaro = new CheckpointStorage(memory, "framework", "figaro-development");
  const alternate = new CheckpointStorage(memory, "source", "systems-playground");
  assert.equal(await playground.load(), null);
  const pending = await playground.prepareSave(checkpoint, 30);
  await figaro.save(checkpoint, 40); await alternate.save(checkpoint, 50);
  pending.commit(); await playground.save(checkpoint, 60);
  assert.equal((await playground.load())!.savedAt, 60);
  assert.equal((await playground.load(true))!.savedAt, 30);
  assert.equal((await figaro.load())!.savedAt, 40);
  assert.equal((await alternate.load())!.savedAt, 50);
  assert.equal(memory.values.get(slotKey), legacySource);
  assert.equal(memory.values.get("ffvi-reweb.framework.checkpoint.v1"), legacyFramework);
  assert.equal((await new CheckpointStorage(memory, "framework", "systems-playground").load())!.savedAt, 60);
});

test("invalid package namespaces cannot access storage or masquerade as legacy entries", () => {
  const port = { getItem: () => { assert.fail("Invalid namespace accessed storage"); },
    setItem: () => { assert.fail("Invalid namespace wrote storage"); } };
  for (const namespace of ["", "../source", "source/framework", "UPPER", "a".repeat(81), null, 3])
    assert.throws(() => new CheckpointStorage(port, "framework", namespace as string), /Invalid save namespace/);
});

test("encoding failures cannot publish a candidate or change the prior slot", async () => {
  const memory = memoryStorage(), store = new CheckpointStorage(memory);
  const checkpoint = checkpointFixture().game.checkpoint();
  await store.save(checkpoint, 10);
  const before = memory.values.get(slotKey);
  await assert.rejects(() => store.prepareSave(checkpoint, -1));
  await assert.rejects(() => store.prepareSave({ ...checkpoint,
    sourceSetHash: "x".repeat(4 * 1024 * 1024) }, 20), /Oversized/);
  assert.equal(memory.values.get(slotKey), before);
  assert.equal(memory.writes, 1);
});
