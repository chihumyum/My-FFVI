import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:8788/";
const output = process.env.PLAY_PUBLIC_HTTP_REPORT || "build/play/deployment/public/http.json";
const report = {
  base,
  status: "running",
  checks: [],
  scope: "Anonymous shell/resources only; no owner session or production save data is read.",
};
try {
  const request = (pathname, options) =>
    fetch(new URL(pathname, base), { redirect: "manual", ...options });
  const shell = await request("/");
  assert.equal(shell.status, 200);
  const text = await shell.text();
  assert.match(text, /name="ffvi-identity"/);
  assert.match(shell.headers.get("cache-control"), /no-cache|no-store/);
  const indexPath = text.match(/name="ffvi-data-index" content="([^"]+)"/)[1];
  const indexResponse = await request(indexPath);
  assert.equal(indexResponse.status, 200);
  const index = await indexResponse.arrayBuffer();
  const localIndex = await readFile(
    path.join("dist/cloudflare/resources", indexPath.replace("/resources/", "")),
  );
  assert.equal(
    createHash("sha256").update(Buffer.from(index)).digest("hex"),
    createHash("sha256").update(localIndex).digest("hex"),
  );
  report.checks.push("anonymous game shell and versioned resource index match the built release");
  for (const kind of ["atlases", "audio", "fonts", "previews"]) {
    const file = (await readdir(path.join("dist/cloudflare/resources", kind))).find(
      (f) => !f.startsWith("."),
    );
    const local = await readFile(path.join("dist/cloudflare/resources", kind, file));
    const url = `/resources/${kind}/${file}`;
    const remote = await request(url);
    assert.equal(remote.status, 200);
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(await remote.arrayBuffer()))
        .digest("hex"),
      createHash("sha256").update(local).digest("hex"),
      kind,
    );
    assert.match(remote.headers.get("cache-control"), /public.*immutable/);
    const head = await request(url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get("content-length")), local.length);
    const range = await request(url, { headers: { Range: "bytes=0-15" } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), local.subarray(0, 16));
    const invalid = await request(url, { headers: { Range: `bytes=${local.length}-` } });
    assert.equal(invalid.status, 416);
    report.checks.push(`${kind}: anonymous bytes/hash, cache, HEAD, range and invalid range`);
  }
  assert.equal((await request("/api/saves")).status, 401);
  assert.equal((await request("/api/saves/normal:1/history")).status, 401);
  const session = await (await request("/api/session")).json();
  assert.equal(session.authenticated, false);
  assert.equal(session.serverId, null);
  assert.equal(session.recoveryKey, undefined);
  for (const file of [
    "/private-data/cloudflare-secrets.json",
    "/.dev.vars.local",
    "/resources/private-data/file",
    "/resources/data/.secret",
  ]) {
    const response = await request(file);
    assert.equal(response.status, 404, file);
  }
  report.checks.push(
    "anonymous save/history requests denied; no credentials or private files exposed",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exitCode = 1;
