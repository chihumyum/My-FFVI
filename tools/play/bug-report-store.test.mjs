import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBugReportMiddleware } from "./bug-report-store.mjs";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ssQAAAAASUVORK5CYII=";
const report = () => ({
  schema: "ffvi-bug-report",
  version: 1,
  createdAt: "2026-10-18T01:00:00.000Z",
  map: { id: 3 },
  script: null,
  player: { x: 4, y: 8, direction: "right" },
  actors: [{ id: "npc-1", visible: true }],
  party: [{ id: 1, hp: 100 }],
  events: [{ kind: "field-interaction", time: 10 }],
  screenshot: { mimeType: "image/png", dataURL: `data:image/png;base64,${png}` },
});
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "ffvi-bug-report-")),
    middleware = createBugReportMiddleware({ directory, ...options }),
    server = http.createServer((req, res) =>
      middleware(req, res, () => {
        res.statusCode = 404;
        res.end("not-found");
      }),
    );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const send = (body, { headers = {}, method = "POST", route = "/__bug-reports" } = {}) =>
    fetch(origin + route, {
      method,
      headers: { Origin: origin, "Content-Type": "application/json", ...headers },
      ...(method !== "GET" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
  return { directory, origin, send };
}

test("local same-origin report writes matching JSON and PNG using only server paths", async (t) => {
  const { directory, send } = await fixture(t),
    value = { ...report(), directory: "../../escape", filename: "/tmp/evil.png", custom: [1, 2] },
    response = await send(value),
    saved = await response.json();
  assert.equal(response.status, 201);
  assert.match(saved.directory, /^bug-reports\/\d{4}-.*-[a-f0-9-]{36}$/);
  assert.equal(saved.json, `${saved.directory}/report.json`);
  assert.equal(saved.screenshot, `${saved.directory}/screenshot.png`);
  const folder = path.join(directory, saved.directory.split("/")[1]);
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, "report.json"))), value);
  assert.deepEqual(await readFile(path.join(folder, "screenshot.png")), Buffer.from(png, "base64"));
  assert.deepEqual(await readdir(directory), [path.basename(folder)]);
});

test("title screen can report without an active map, script or player", async (t) => {
  const { directory, send } = await fixture(t),
    value = {
      ...report(),
      map: null,
      script: null,
      player: null,
      actors: [],
      party: [],
      events: [],
    },
    response = await send(value),
    saved = await response.json();
  assert.equal(response.status, 201);
  const stored = JSON.parse(
    await readFile(path.join(directory, saved.directory.split("/")[1], "report.json")),
  );
  assert.deepEqual(stored, value);
});

test("bad schema, JSON, PNG and cross-origin requests produce no report directory", async (t) => {
  const { directory, send } = await fixture(t);
  for (const [body, options, status] of [
    [{ ...report(), schema: "other" }, {}, 400],
    ["{", {}, 400],
    [
      { ...report(), screenshot: { mimeType: "image/png", dataURL: "data:image/png;base64,abcd" } },
      {},
      400,
    ],
    [
      { ...report(), screenshot: { mimeType: "image/png", dataURL: "data:image/png;base64,%%%=" } },
      {},
      400,
    ],
    [report(), { headers: { Origin: "http://evil.example" } }, 403],
    [report(), { headers: { "Sec-Fetch-Site": "cross-site" } }, 403],
    [report(), { headers: { "Content-Type": "text/plain" } }, 415],
    [null, { method: "GET" }, 405],
  ]) {
    const response = await send(body, options);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.deepEqual(await readdir(directory), []);
  assert.equal((await send(report(), { route: "/another-route" })).status, 404);
});

test("oversized declared or streamed bodies are refused before any files are created", async (t) => {
  const { directory, origin, send } = await fixture(t, { maxBytes: 1024 });
  const response = await send({ ...report(), events: ["x".repeat(2048)] });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /oversized|exceeds/);
  const streamed = await new Promise((resolve, reject) => {
    const req = http.request(origin + "/__bug-reports", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      },
    });
    req.on("error", reject);
    req.on("response", (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode, value: JSON.parse(Buffer.concat(chunks)) }),
      );
    });
    req.write("x".repeat(800));
    req.end("x".repeat(800));
  });
  assert.equal(streamed.status, 413);
  assert.match(streamed.value.error, /exceeds/);
  assert.deepEqual(await readdir(directory), []);
});
