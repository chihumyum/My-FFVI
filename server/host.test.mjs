import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { openStore } from "./store.mjs";
import { createHost } from "./host.mjs";

const password = "test-password-not-for-deployment";
const record = (id = "normal:1", mapId = 1) => ({
  id,
  mode: id.split(":")[0],
  slot: id.split(":")[1] === "auto" ? "auto" : Number(id.split(":")[1]),
  savedAt: Date.now(),
  time: 100,
  map: "纳尔谢",
  party: [{ id: 1, name: "蒂娜", level: 6 }],
  snapshot: {
    mapId,
    testBoost: id.startsWith("story-test"),
    player: { x: 1, y: 2 },
    banks: { ScenarioFlag1: [1] },
  },
});

test("private host protects resources and saves; atomic revisions preserve concurrent devices and restart history", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "ffvi-host-")),
    web = path.join(folder, "web"),
    data = path.join(folder, "data");
  await mkdir(web);
  await writeFile(path.join(web, "index.html"), "<!doctype html><title>FFVI</title>");
  await writeFile(path.join(web, "sample.ogg"), "0123456789");
  await writeFile(path.join(web, ".secret"), "never serve");
  let store = await openStore(data, { password }),
    host = await createHost({ store, staticDir: web });
  host.listen(0, "127.0.0.1");
  await once(host, "listening");
  t.after(async () => {
    host.closeAllConnections();
    await new Promise((resolve) => host.close(resolve));
    store.close();
    await rm(folder, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${host.address().port}`,
    headers = { Origin: base, "Content-Type": "application/json" };
  const request = (route, options = {}) =>
    fetch(base + route, {
      ...options,
      headers: { ...headers, ...options.headers },
      redirect: "manual",
    });
  assert.equal((await request("/sample.ogg")).status, 401);
  assert.equal((await request("/", { headers: { Accept: "text/html" } })).status, 302);
  assert.equal((await request("/login")).status, 200);
  assert.equal((await request("/manifest.webmanifest")).status, 200);
  assert.equal(
    (
      await request("/api/session", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: JSON.stringify({ password }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/session", { method: "POST", body: JSON.stringify({ password: "wrong" }) }))
      .status,
    401,
  );
  const login = await request("/api/session", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const auth = (route, options = {}) =>
    request(route, { ...options, headers: { Cookie: cookie, ...options.headers } });
  assert.match(await (await auth("/")).text(), /ffvi-host/);
  assert.equal((await auth("/.secret")).status, 404);
  const range = await auth("/sample.ogg", { headers: { Range: "bytes=2-4" } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "234");
  const etag = range.headers.get("etag");
  assert.equal((await auth("/sample.ogg", { headers: { Range: "bytes=99-100" } })).status, 416);
  const put = (value, revision = 0, mutationId = randomUUID()) =>
    auth(`/api/saves/${encodeURIComponent(value.id)}`, {
      method: "PUT",
      body: JSON.stringify({ record: value, baseRevision: revision, mutationId }),
    });
  const mutation = randomUUID(),
    first = record();
  assert.equal((await put(first, 0, mutation)).status, 200);
  assert.equal(
    (await (await put(first, 0, mutation)).json()).revision,
    1,
    "lost response retry must be idempotent",
  );
  const race = await Promise.all([put(record("normal:1", 2), 1), put(record("normal:1", 3), 1)]);
  assert.deepEqual(race.map((row) => row.status).sort(), [200, 409]);
  const winner = await (await auth("/api/saves/normal%3A1")).json();
  assert.equal(winner.revision, 2);
  const history = await (await auth("/api/saves/normal%3A1/history")).json();
  assert.equal(history.versions.length, 2);
  assert.deepEqual((await (await auth("/api/saves/normal%3A1/1")).json()).record, first);
  const bad = record("story-test:1");
  bad.snapshot.testBoost = false;
  assert.equal((await put(bad)).status, 400);
  assert.equal((await put(record("normal:99"))).status, 404);
  const backup = path.join(folder, "backup.sqlite");
  await store.backup(backup);
  assert.ok((await readFile(backup)).length > 0);
  host.closeAllConnections();
  await new Promise((resolve) => host.close(resolve));
  store.close();
  store = await openStore(data);
  host = await createHost({ store, staticDir: web });
  host.listen(Number(new URL(base).port), "127.0.0.1");
  await once(host, "listening");
  assert.deepEqual(
    (await (await auth("/api/saves/normal%3A1")).json()).record,
    winner.record,
    "persist across actual restart",
  );
  const copied = await openStore(path.join(folder, "restore"), { password });
  copied.close();
  await writeFile(path.join(folder, "restore/saves.sqlite"), await readFile(backup));
  const restored = await openStore(path.join(folder, "restore"));
  assert.deepEqual(restored.get("normal:1").record, winner.record);
  restored.close();
  assert.equal((await auth("/api/logout", { method: "POST", body: "{}" })).status, 200);
  assert.equal(
    (await auth("/sample.ogg", { headers: { "If-None-Match": etag } })).status,
    401,
    "cached resources still require a valid session",
  );
  const passwordCLI = await openStore(data);
  await passwordCLI.password("changed-by-another-process");
  passwordCLI.close();
  assert.equal(
    (await request("/api/session", { method: "POST", body: JSON.stringify({ password }) })).status,
    401,
  );
  assert.equal(
    (
      await request("/api/session", {
        method: "POST",
        body: JSON.stringify({ password: "changed-by-another-process" }),
      })
    ).status,
    200,
    "running server must read the changed password without restart",
  );
});

test("history retains 50 actual versions; resetting a password revokes old sessions", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "ffvi-store-"));
  const store = await openStore(folder, { password });
  t.after(async () => {
    store.close();
    await rm(folder, { recursive: true, force: true });
  });
  for (let revision = 0; revision < 53; revision++)
    store.put("normal:auto", {
      record: record("normal:auto", revision),
      baseRevision: revision,
      mutationId: randomUUID(),
    });
  assert.equal(store.history("normal:auto").length, 50);
  assert.equal(store.version("normal:auto", 1), undefined);
  assert.equal(store.version("normal:auto", 53).record.snapshot.mapId, 52);
  store.db.prepare("INSERT INTO sessions VALUES (?,?)").run("example", Date.now() + 10000);
  await store.password("a-new-private-test-password");
  assert.equal(await store.verify(password), false);
  assert.equal(await store.verify("a-new-private-test-password"), true);
  assert.equal(store.db.prepare("SELECT count(*) n FROM sessions").get().n, 0);
});
