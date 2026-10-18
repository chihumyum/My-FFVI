import test from "node:test";
import assert from "node:assert/strict";
import { SaveLibrary } from "./saves.js";

// Exercise the real synchronization/session policy with deterministic storage;
// the separate browser suite covers actual IndexedDB and two browser profiles.
const localValues = new Map();
globalThis.localStorage = {
  getItem: (key) => localValues.get(key) || null,
  setItem: (key, value) => localValues.set(key, value),
};
class MemoryLibrary extends SaveLibrary {
  constructor(record, remote, serverId = "server-a") {
    super({
      cloud: {
        enabled: true,
        serverId,
        connect: async () => true,
        list: async () => (remote ? [{ id: remote.record.id, revision: remote.revision }] : []),
        get: async () => structuredClone(remote),
        put: async () => {
          throw Error("Unexpected upload must not occur");
        },
      },
    });
    this.rows = new Map([[record.id, structuredClone(record)]]);
    this.account = "server-a";
  }
  async all() {
    return structuredClone([...this.rows.values()]);
  }
  async operation(_write, action) {
    return action({ get: (id) => structuredClone(this.rows.get(id)) });
  }
  async mutate(id, update) {
    const value = update(structuredClone(this.rows.get(id)), {
      put: (row) => this.rows.set(row.id, structuredClone(row)),
    });
    if (value) this.rows.set(id, structuredClone(value));
    return value;
  }
  schedule() {}
}
const row = (revision = 8) => ({
  id: "normal:1",
  mode: "normal",
  slot: 1,
  savedAt: 100,
  time: 99,
  map: "本机较新进度",
  party: [],
  snapshot: { mapId: 1, time: 99 },
  sync: { account: "server-a", revision, dirty: false },
});
test("restoring an older server backup cannot silently erase a newer local clean save", async () => {
  const before = row(),
    remote = { revision: 3, record: { ...row(3), snapshot: { mapId: 2, time: 3 } } };
  delete remote.record.sync;
  const library = new MemoryLibrary(before, remote);
  await library.sync();
  const after = library.rows.get(before.id);
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.equal(after.sync.conflict.revision, 3);
  assert.equal(library.status.state, "conflict");
});
test("an empty restored cloud database or a new server identity must preserve the local version", async () => {
  for (const serverId of ["server-a", "server-b"]) {
    const before = row(),
      library = new MemoryLibrary(before, null, serverId);
    await library.sync();
    const after = library.rows.get(before.id);
    assert.deepEqual(after.snapshot, before.snapshot);
    assert.deepEqual(after.sync.conflict, { id: before.id, revision: 0, record: null });
    assert.equal(library.status.state, "conflict");
  }
});
test("a passive pull cannot advance the revision held by an already running game", async () => {
  const before = row(1),
    remote = { revision: 2, record: { ...row(2), snapshot: { mapId: 2, time: 200 } } };
  delete remote.record.sync;
  const library = new MemoryLibrary(before, remote);
  await library.beginSession(false);
  await library.sync();
  assert.equal(library.rows.get(before.id).sync.revision, 2);
  await library.write({ ...before, snapshot: { mapId: 1, time: 110 } }, true);
  assert.equal(library.rows.get(before.id).sync.revision, 1);
  assert.equal(library.rows.get(before.id).sync.dirty, true);
  await library.sync();
  assert.equal(library.rows.get(before.id).sync.conflict.revision, 2);
  assert.deepEqual(library.rows.get(before.id).snapshot, { mapId: 1, time: 110 });
});
