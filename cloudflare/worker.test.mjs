import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, pbkdf2Sync } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("public profiles isolate saves/history, recover across devices and reject stale-tab identity", async () => {
  const root = new URL("../", import.meta.url);
  const password = "disposable-test-password";
  const verifier = JSON.stringify({
    salt: "fixture",
    iterations: 100000,
    hash: pbkdf2Sync(password, "fixture", 100000, 32, "sha256").toString("hex"),
  });
  const modules = await Promise.all(
    [
      "cloudflare/worker.mjs",
      "cloudflare/store.mjs",
      "cloudflare/ranges.mjs",
      "cloudflare/resources.mjs",
      "server/save-schema.mjs",
    ].map(async (file) => {
      let contents = await readFile(new URL(file, root), "utf8");
      if (file.endsWith("worker.mjs"))
        contents = contents.replace(/^import assetSizes[^\n]+/, "const assetSizes = {};");
      return { type: "ESModule", path: new URL(file, root).pathname, contents };
    }),
  );
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          modules,
          compatibilityDate: "2026-10-18",
          compatibilityFlags: ["nodejs_compat"],
          bindings: { FFVI_PUBLIC_SITE: "1", FFVI_PASSWORD: verifier },
          d1Databases: { DB: "profiles-test" },
          r2Buckets: { RESOURCES: "profiles-assets" },
          serviceBindings: { ASSETS: () => new Response("public shell") },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const schema = async (file) =>
      (await readFile(new URL("cloudflare/migrations/" + file, root), "utf8"))
        .replace(/^--.*$/gm, "")
        .replaceAll("\n", " ");
    await db.exec(await schema("0001_saves.sql"));
    const record = (time) => ({
      id: "normal:1",
      mode: "normal",
      slot: 1,
      savedAt: time,
      time,
      map: "测试",
      party: [],
      snapshot: { mapId: 1, time },
    });
    await db
      .prepare("INSERT INTO saves VALUES (?,1,?,?,?)")
      .bind("normal:1", JSON.stringify(record(99)), 99, "legacy-mutation-id")
      .run();
    const oldCookie = "old-private-session";
    await db
      .prepare("INSERT INTO sessions VALUES (?,?)")
      .bind(
        createHash("sha256")
          .update(oldCookie + "\0" + verifier)
          .digest("hex"),
        Date.now() + 86400000,
      )
      .run();
    await db.exec(await schema("0002_profiles.sql"));
    const request = async (
      path,
      { method = "GET", input, cookie, account, origin = "http://localhost" } = {},
    ) => {
      const response = await mf.dispatchFetch("http://localhost" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(account ? { "X-FFVI-Account": account } : {}),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      return {
        status: response.status,
        cookie: response.headers.get("set-cookie")?.split(";")[0],
        value: response.headers.get("content-type")?.includes("json")
          ? await response.json()
          : await response.text(),
      };
    };
    assert.equal((await request("/")).status, 200);
    assert.equal((await request("/api/saves")).status, 401);
    const a = await request("/api/identity", { method: "POST", input: {} });
    const b = await request("/api/identity", { method: "POST", input: {} });
    assert.equal(a.status, 200);
    assert.match(a.value.recoveryKey, /^ffvi_[a-f0-9]{64}$/);
    assert.notEqual(a.value.serverId, b.value.serverId);
    const options = (v) => ({ cookie: v.cookie, account: v.value.serverId });
    const put = (who, time, revision, mutation = crypto.randomUUID()) =>
      request("/api/saves/normal:1", {
        ...options(who),
        method: "PUT",
        input: {
          record: record(time),
          baseRevision: revision,
          mutationId: mutation,
          owner: a.value.serverId,
        },
      });
    assert.equal((await put(a, 1, 0)).status, 200);
    assert.deepEqual((await request("/api/saves", options(b))).value.saves, []);
    assert.equal((await request("/api/saves/normal:1", options(b))).status, 404);
    assert.deepEqual((await request("/api/saves/normal:1/history", options(b))).value.versions, []);
    assert.equal((await request("/api/saves/normal:1/1", options(b))).status, 404);
    assert.equal((await put(b, 7, 0)).status, 200);
    assert.equal((await request("/api/saves/normal:1", options(a))).value.record.time, 1);
    const recovered = await request("/api/session", {
      method: "POST",
      input: { recoveryKey: a.value.recoveryKey },
    });
    assert.equal(recovered.value.serverId, a.value.serverId);
    assert.equal((await request("/api/saves/normal:1", options(recovered))).value.record.time, 1);
    const compete = await Promise.all([put(a, 2, 1), put(recovered, 3, 1)]);
    assert.deepEqual(compete.map((r) => r.status).sort(), [200, 409]);
    const stale = await request("/api/saves/normal:1", {
      ...options(b),
      account: a.value.serverId,
      method: "PUT",
      input: { record: record(123), baseRevision: 1, mutationId: crypto.randomUUID() },
    });
    assert.equal(stale.status, 403);
    assert.equal((await request("/api/saves/normal:1", options(b))).value.record.time, 7);
    assert.equal((await request("/api/session", options(a))).value.recoveryKey, undefined);
    assert.equal(
      (
        await request("/api/session", {
          method: "POST",
          input: { recoveryKey: "ffvi_" + "0".repeat(64) },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/api/identity", {
          method: "POST",
          input: {},
          origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    const legacy = await request("/api/session", { cookie: "ffvi_session=" + oldCookie });
    assert.equal(legacy.value.legacy, true);
    assert.equal(
      (
        await request("/api/saves/normal:1", {
          cookie: "ffvi_session=" + oldCookie,
          account: legacy.value.serverId,
        })
      ).value.record.time,
      99,
    );
    const stored = await db.prepare("SELECT * FROM profiles WHERE id!='legacy'").all();
    assert.equal(stored.results.length, 2);
    assert.ok(!JSON.stringify(stored).includes(a.value.recoveryKey));
    const r2 = await mf.getR2Bucket("RESOURCES");
    await r2.put("audio/test-aaaaaaaaaaaa.ogg", "0123456789", {
      httpMetadata: { contentType: "audio/ogg" },
    });
    const range = await mf.dispatchFetch("http://localhost/resources/audio/test-aaaaaaaaaaaa.ogg", {
      headers: { Range: "bytes=2-5" },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("Content-Range"), "bytes 2-5/10");
    assert.equal(await range.text(), "2345");
    const full = await mf.dispatchFetch("http://localhost/resources/audio/test-aaaaaaaaaaaa.ogg");
    assert.equal(full.status, 200);
    assert.equal(await full.text(), "0123456789");
    for (const [header, status, expected] of [
      ["bytes=-3", 206, "789"],
      ["bytes=8-", 206, "89"],
      ["bytes=20-", 416, ""],
      ["bytes=-0", 416, ""],
    ]) {
      const response = await mf.dispatchFetch(
        "http://localhost/resources/audio/test-aaaaaaaaaaaa.ogg",
        { headers: { Range: header } },
      );
      assert.equal(response.status, status, header);
      assert.equal(await response.text(), expected);
    }
    const head = await mf.dispatchFetch("http://localhost/resources/audio/test-aaaaaaaaaaaa.ogg", {
      method: "HEAD",
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("Content-Length"), "10");
    assert.equal(await head.text(), "");
    const wrongCookie = await request("/api/session", {
      cookie: "other_ffvi_session=" + oldCookie,
    });
    assert.equal(wrongCookie.value.authenticated, false);
    const admin = await request("/api/session", { method: "POST", input: { password } });
    assert.equal(admin.value.legacy, true);
    assert.equal((await request("/api/saves/normal:1", options(admin))).value.record.time, 99);
    assert.equal((await request("/resources/no-secrets/here")).status, 404);
    assert.equal(
      (await request("/api/logout", { method: "POST", input: {}, cookie: a.cookie })).status,
      200,
    );
    assert.equal((await request("/api/saves", options(a))).status, 401);
  } finally {
    await mf.dispose();
  }
});
