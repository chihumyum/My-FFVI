import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:8788/";
const password = (await readFile("private-data/cloudflare-first-login.txt", "utf8")).trim();
const output = process.env.PLAY_CF_REPORT || "build/play/deployment/cloudflare/http.json";
const origin = new URL(base).origin;
const headers = { Origin: origin, "Content-Type": "application/json" };
const report = { base, checks: [], status: "running" };
const request = (url, options = {}) =>
  fetch(new URL(url, base), { redirect: "manual", ...options });
try {
  const config = JSON.parse(
    (await readFile("wrangler.jsonc", "utf8")).replace(/,\s*([}\]])/g, "$1"),
  );
  assert.equal(
    config.assets.run_worker_first,
    true,
    "Every static request must pass authentication",
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  if (origin.startsWith("https:")) {
    const http = await fetch(new URL("/login", origin.replace("https:", "http:")), {
      redirect: "manual",
    });
    assert.ok([301, 302, 307, 308].includes(http.status), "Never serve a password form over HTTP");
    assert.equal(new URL(http.headers.get("location"), origin).origin, origin);
  }
  const samples = ["/index.html", "/api/saves"];
  for (const entry of await readdir("dist/cloudflare/web", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = (
      await readdir(path.join("dist/cloudflare/web", entry.name), { withFileTypes: true })
    ).find((x) => x.isFile() && !x.name.startsWith("."));
    if (file) samples.push(`/${entry.name}/${file.name}`);
  }
  const root = await request("/", { headers: { Accept: "text/html" } });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/login");
  const loginPage = await request("/login");
  assert.equal(loginPage.status, 200);
  for (const url of samples) {
    const response = await request(url);
    assert.equal(response.status, 401, `Unauthenticated resource exposed: ${url}`);
  }
  report.checks.push({
    name: "All asset categories, raw HTML and save API require authentication",
    samples,
  });
  const bad = await request("/api/session", {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "incorrect-password" }),
  });
  assert.equal(bad.status, 401);
  const logged = await request("/api/session", {
    method: "POST",
    headers,
    body: JSON.stringify({ password }),
  });
  assert.equal(logged.status, 200);
  const cookie = logged.headers.getSetCookie()[0].split(";")[0];
  assert.match(logged.headers.getSetCookie()[0], /HttpOnly/);
  if (origin.startsWith("https:")) assert.match(logged.headers.getSetCookie()[0], /Secure/);
  const auth = { ...headers, Cookie: cookie };
  const page = await request("/", { headers: auth });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /name="ffvi-host"/);
  for (const url of samples.filter((x) => !x.endsWith("index.html"))) {
    const response = await request(url, { headers: auth });
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get("cache-control"), /private|no-store/);
    await response.body?.cancel();
    assert.equal(
      (await request(url)).status,
      401,
      `A warmed resource cache must remain private: ${url}`,
    );
  }
  report.checks.push({ name: "Authenticated static resources and cloud bootstrap load" });
  const audio = samples.find((x) => x.startsWith("/audio/"));
  const ranged = await request(audio, { headers: { ...auth, Range: "bytes=0-15" } });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 16);
  report.checks.push({ name: "Authenticated music supports byte ranges" });
  const cross = await request("/api/logout", {
    method: "POST",
    headers: { ...auth, Origin: "https://unrelated.invalid" },
    body: "{}",
  });
  assert.equal(cross.status, 403);
  const malformed = await request("/api/saves/normal%3A12", {
    method: "PUT",
    headers: auth,
    body: "{",
  });
  assert.equal(malformed.status, 400);
  await request("/api/logout", { method: "POST", headers: auth, body: "{}" });
  assert.equal((await request("/api/saves", { headers: auth })).status, 401);
  report.checks.push({ name: "CSRF, malformed saves and revoked sessions fail closed" });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  process.exitCode = 1;
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    status: report.status,
    checks: report.checks.length,
    output,
    error: report.error,
  }),
);
