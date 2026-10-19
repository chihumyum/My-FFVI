import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { openD1Store } from "./store.mjs";

test("D1 saves atomically preserve competing devices, retries and fifty historical versions", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          modules: true,
          script: "export default { fetch() { return new Response('ok') } }",
          compatibilityDate: "2026-10-18",
          d1Databases: { DB: "ffvi-test" },
        },
      ],
    }),
  );
  try {
    const binding = await mf.getD1Database("DB");
    const schema = await readFile(new URL("./migrations/0001_saves.sql", import.meta.url), "utf8");
    await binding.exec(schema.replaceAll("\n", " "));
    await binding.exec(
      (await readFile(new URL("./migrations/0002_profiles.sql", import.meta.url), "utf8"))
        .replace(/^--.*$/gm, "")
        .replaceAll("\n", " "),
    );
    const store = () => openD1Store(binding);
    const record = (time) => ({
      id: "normal:1",
      mode: "normal",
      slot: 1,
      savedAt: time,
      time,
      map: "测试",
      party: [],
      snapshot: { mapId: 1 },
    });
    const put = (time, baseRevision, mutationId = crypto.randomUUID()) =>
      store().put("normal:1", { record: record(time), baseRevision, mutationId });
    const mutation = crypto.randomUUID();
    const first = await put(1, 0, mutation);
    assert.equal(first.value.revision, 1);
    assert.equal((await put(1, 0, mutation)).value.revision, 1);
    assert.equal((await put(2, 0, mutation)).conflict, true);
    const competing = await Promise.all([put(2, 1), put(3, 1)]);
    assert.equal(competing.filter((r) => !r.conflict).length, 1);
    assert.equal(competing.filter((r) => r.conflict).length, 1);
    assert.equal((await store().get("normal:1")).revision, 2);
    const absent = await store().put("normal:2", {
      record: { ...record(2), id: "normal:2", slot: 2 },
      baseRevision: 1,
      mutationId: crypto.randomUUID(),
    });
    assert.equal(absent.conflict, true);
    assert.equal(absent.value.record, null);
    for (let revision = 2; revision < 53; revision++)
      assert.equal((await put(revision + 1, revision)).conflict, false);
    const history = await store().history("normal:1");
    assert.equal(history.length, 50);
    assert.equal(history[0].revision, 53);
    assert.equal(history.at(-1).revision, 4);
    assert.equal((await store().version("normal:1", 4)).record.time, 4);
    const serverId = await store().serverId();
    await binding.exec(schema.replaceAll("\n", " "));
    assert.equal(await store().serverId(), serverId);
    await assert.rejects(
      () =>
        store().put("normal:1", {
          record: { ...record(54), mode: "story-test" },
          baseRevision: 53,
          mutationId: crypto.randomUUID(),
        }),
      /存档/,
    );
  } finally {
    await mf.dispose();
  }
});
