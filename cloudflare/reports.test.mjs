import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pbkdf2Sync } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readReport } from "./reports.mjs";
import { MAX_REPORT_BYTES } from "../server/report-schema.mjs";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ssQAAAAASUVORK5CYII=";
const report = () => ({
  schema: "ffvi-bug-report",
  version: 1,
  submissionId: crypto.randomUUID(),
  createdAt: "2026-10-20T01:00:00.000Z",
  description: "进门后贴图被门遮挡",
  map: { id: 34, name: "费加罗王宫" },
  script: { lastInstruction: { script: "sc_e_0026", index: 8 } },
  player: { x: 102, y: 42 },
  actors: [{ id: 19, resource: "/actors/WalkL_00.png" }],
  party: [{ id: 2, hp: 100 }],
  events: [{ kind: "field-interaction" }],
  screenshot: { mimeType: "image/png", dataURL: `data:image/png;base64,${png}` },
});
async function fixture(t) {
  const root = new URL("../", import.meta.url);
  const password = "disposable-report-admin-password";
  const verifier = JSON.stringify({
    salt: "report-fixture",
    iterations: 100000,
    hash: pbkdf2Sync(password, "report-fixture", 100000, 32, "sha256").toString("hex"),
  });
  const modules = await Promise.all(
    [
      "cloudflare/worker.mjs",
      "cloudflare/store.mjs",
      "cloudflare/ranges.mjs",
      "cloudflare/resources.mjs",
      "cloudflare/reports.mjs",
      "server/save-schema.mjs",
      "server/report-schema.mjs",
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
          d1Databases: { DB: "reports-test" },
          r2Buckets: { REPORTS: "private-report-test", RESOURCES: "assets-test" },
          serviceBindings: { ASSETS: () => new Response("public shell") },
        },
      ],
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  for (const file of ["0001_saves.sql", "0002_profiles.sql", "0003_reports.sql"])
    await db.exec(
      (await readFile(new URL("cloudflare/migrations/" + file, root), "utf8"))
        .replace(/^--.*$/gm, "")
        .replaceAll("\n", " "),
    );
  const request = async (path, { method = "GET", input, body, who, headers = {} } = {}) => {
    const response = await mf.dispatchFetch("http://localhost" + path, {
      method,
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/json",
        ...(who ? { Cookie: who.cookie, "X-FFVI-Account": who.value.serverId } : {}),
        ...headers,
      },
      ...(["POST", "PUT"].includes(method) ? { body: body ?? JSON.stringify(input ?? {}) } : {}),
    });
    return {
      status: response.status,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
      value: response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : await response.text(),
    };
  };
  return { mf, db, request, password };
}

test("private report submission is account-pinned, retry-safe and readable only by legacy admin", async (t) => {
  const { mf, db, request, password } = await fixture(t);
  const a = await request("/api/identity", { method: "POST" });
  const b = await request("/api/identity", { method: "POST" });
  const input = report();
  input.description += ` ${a.value.recoveryKey}`;
  input.cookie = "do-not-store-cookie";
  input.headers = { Authorization: "Bearer do-not-store-token" };
  input.location = `http://localhost/?recovery=${a.value.recoveryKey}#secret`;
  assert.equal((await request("/api/reports", { method: "POST", input })).status, 401);
  assert.equal(
    (
      await request("/api/reports", {
        method: "POST",
        input,
        who: a,
        headers: { Origin: "https://evil.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/reports", {
        method: "POST",
        input,
        who: b,
        headers: { "X-FFVI-Account": a.value.serverId },
      })
    ).status,
    403,
  );
  const sent = await request("/api/reports", { method: "POST", input, who: a });
  assert.equal(sent.status, 201);
  assert.match(sent.value.id, /^[a-f0-9-]{36}$/);
  const duplicate = await request("/api/reports", { method: "POST", input, who: a });
  assert.equal(duplicate.value.id, sent.value.id);
  assert.equal(duplicate.value.duplicate, true);
  for (const who of [a, b]) {
    assert.equal((await request("/api/reports", { who })).status, 403);
    assert.equal((await request("/api/admin/reports", { who })).status, 403);
    assert.equal((await request(`/api/admin/reports/${sent.value.id}`, { who })).status, 403);
  }
  assert.equal((await request(`/resources/reports/${sent.value.id}.json`)).status, 404);
  const admin = await request("/api/session", { method: "POST", input: { password } });
  const list = await request("/api/admin/reports", { who: admin });
  assert.equal(list.status, 200);
  assert.equal(list.value.reports.length, 1);
  assert.equal(list.value.reports[0].map_id, 34);
  assert.equal(list.value.reports[0].instruction, 8);
  const download = await request(`/api/admin/reports/${sent.value.id}`, { who: admin });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("cache-control"), /no-store/);
  assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.equal(download.value.screenshot.dataURL, input.screenshot.dataURL);
  assert.equal(download.value.location, "http://localhost/");
  const stored = JSON.stringify(download.value);
  for (const forbidden of [a.value.recoveryKey, "do-not-store-cookie", "do-not-store-token"])
    assert.ok(!stored.includes(forbidden));
  assert.equal((await db.prepare("SELECT count(*) AS count FROM bug_reports").first()).count, 1);
  assert.equal((await (await mf.getR2Bucket("REPORTS")).list()).objects.length, 1);
  const concurrentInput = report();
  const concurrent = await Promise.all([
    request("/api/reports", { method: "POST", input: concurrentInput, who: b }),
    request("/api/reports", { method: "POST", input: concurrentInput, who: b }),
  ]);
  assert.ok(concurrent.every((response) => [200, 201].includes(response.status)));
  assert.equal(concurrent[0].value.id, concurrent[1].value.id);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM bug_reports").first()).count, 2);
  assert.equal((await (await mf.getR2Bucket("REPORTS")).list()).objects.length, 2);
});

test("report body limit rejects declared and streamed overflow, and allows exactly 8 MiB", async () => {
  // Test the identical Worker reader directly: an early 413 is permitted to
  // close an unfinished HTTP upload, so reading its response through Miniflare's
  // undici transport races EPIPE under parallel-suite load.
  const declared = new Request("http://localhost/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(MAX_REPORT_BYTES + 1) },
    body: "{}",
  });
  await assert.rejects(readReport(declared), { status: 413 });
  assert.equal(
    declared.bodyUsed,
    false,
    "Declared overflow must be rejected without reading bytes",
  );
  const value = { ...report(), padding: "" };
  const overhead = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  value.padding = "x".repeat(MAX_REPORT_BYTES - overhead);
  const exact = new TextEncoder().encode(JSON.stringify(value));
  assert.equal(exact.byteLength, 8 * 1024 * 1024);
  let cancelled = false;
  const streamRequest = (bytes) => {
    let offset = 0;
    return new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      duplex: "half",
      body: new ReadableStream({
        pull(controller) {
          if (offset === bytes.length) return controller.close();
          const end = Math.min(offset + 256 * 1024, bytes.length);
          controller.enqueue(bytes.subarray(offset, end));
          offset = end;
        },
        cancel() {
          cancelled = true;
        },
      }),
    });
  };
  const accepted = await readReport(streamRequest(exact));
  assert.equal(accepted.padding.length, value.padding.length);
  assert.equal(accepted.submissionId, value.submissionId);
  assert.equal(cancelled, false);
  const overflow = new Uint8Array(MAX_REPORT_BYTES + 1);
  overflow.set(exact);
  overflow[exact.length] = 32; // Valid JSON whitespace still counts toward the byte limit.
  const streamed = streamRequest(overflow);
  assert.equal(streamed.headers.has("Content-Length"), false);
  await assert.rejects(readReport(streamed), { status: 413 });
  assert.equal(cancelled, true, "Overflow must cancel the remaining request stream");
});

test("reports reject malformed payloads; per-account hourly quota leaves other accounts usable", async (t) => {
  const { db, request } = await fixture(t);
  const a = await request("/api/identity", { method: "POST" });
  const b = await request("/api/identity", { method: "POST" });
  for (const input of [
    { ...report(), description: " " },
    { ...report(), description: "x".repeat(6001) },
    { ...report(), events: Array(21).fill({ kind: "event" }) },
    {
      ...report(),
      screenshot: { mimeType: "image/png", dataURL: "data:image/png;base64,YWJjZA==" },
    },
  ])
    assert.equal((await request("/api/reports", { method: "POST", input, who: a })).status, 400);
  assert.equal((await request("/api/reports", { method: "POST", body: "{", who: a })).status, 400);
  assert.equal(
    (
      await request("/api/reports", {
        method: "POST",
        input: report(),
        who: a,
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal((await db.prepare("SELECT count(*) AS count FROM bug_reports").first()).count, 0);
  const first = report();
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await request("/api/reports", { method: "POST", input: i ? report() : first, who: a }))
        .status,
      201,
    );
  assert.equal(
    (await request("/api/reports", { method: "POST", input: report(), who: a })).status,
    429,
  );
  assert.equal(
    (await request("/api/reports", { method: "POST", input: first, who: a })).status,
    200,
  );
  assert.equal(
    (await request("/api/reports", { method: "POST", input: report(), who: b })).status,
    201,
  );
});
