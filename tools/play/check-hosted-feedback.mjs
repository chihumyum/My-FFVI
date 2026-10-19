import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit, request as apiRequest } from "playwright";

const base = new URL(process.env.PLAY_WEB_URL || "http://127.0.0.1:8788/");
const output = path.resolve(
  process.env.PLAY_FEEDBACK_REPORT || "build/play/deployment/mobile-feedback/hosted",
);
const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
const passwordFile =
  process.env.PLAY_ADMIN_PASSWORD_FILE || "private-data/cloudflare-first-login.txt";
const password = (await readFile(passwordFile, "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);
if (!password) throw Error("Administrator password file is empty");
if (base.protocol !== "https:" && !local) throw Error("Hosted feedback acceptance requires HTTPS");
await mkdir(output, { recursive: true });
const results = {
  base: base.origin,
  scope:
    "Fresh disposable anonymous identities. Browser save API is blocked; administrator reads only the report IDs submitted by this run, with an independent API session. Existing reports and saves are untouched.",
  status: "running",
  engines: [],
};
const engines = process.env.PLAY_BROWSER ? [process.env.PLAY_BROWSER] : ["chromium", "webkit"];
for (const name of engines) {
  const engine = { chromium, webkit }[name];
  assert.ok(engine, "Unknown browser engine");
  const browser = await engine.launch({
    headless: true,
    args: name === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
  const directory = path.join(output, name);
  await mkdir(directory, { recursive: true });
  const row = {
    engine: name,
    status: "running",
    errors: [],
    resourceFailures: [],
    saveApiBlocked: true,
  };
  results.engines.push(row);
  const address = name === "chromium" ? "198.18.1.101" : "198.18.1.102";
  const headers = { Origin: base.origin, ...(local ? { "CF-Connecting-IP": address } : {}) };
  const admin = await apiRequest.newContext({ baseURL: base.origin, extraHTTPHeaders: headers });
  const stranger = await apiRequest.newContext({
    baseURL: base.origin,
    extraHTTPHeaders: {
      ...headers,
      ...(local
        ? { "CF-Connecting-IP": name === "chromium" ? "198.18.1.201" : "198.18.1.202" }
        : {}),
    },
  });
  const unauthenticated = await apiRequest.newContext({
    baseURL: base.origin,
    extraHTTPHeaders: headers,
  });
  let adminConnected = false;
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...(local ? { extraHTTPHeaders: { "CF-Connecting-IP": address } } : {}),
    });
    // The real game can start without cloud save access. Do not touch any save route.
    await context.route(
      (url) => url.origin === base.origin && url.pathname.startsWith("/api/saves"),
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error:
              "Acceptance isolates report storage; cloud saves disabled in this disposable context",
          }),
        }),
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => row.errors.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        url.origin === base.origin &&
        url.pathname.startsWith("/resources/") &&
        response.status() >= 400
      )
        row.resourceFailures.push({ resource: url.pathname, status: response.status() });
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (url.origin === base.origin && url.pathname.startsWith("/resources/"))
        row.resourceFailures.push({ resource: url.pathname, error: request.failure()?.errorText });
    });
    await page.goto(base.href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.ffviRenderMetrics === "function" &&
        document.getElementById("boot-status").hidden,
      null,
      { timeout: 90_000 },
    );
    const identity = await context.request.get(new URL("/api/session", base).href, { headers });
    assert.equal(identity.status(), 200);
    const self = await identity.json();
    assert.equal(self.authenticated, true);
    assert.equal(self.legacy, false, "Acceptance must never use the owner's playing identity");
    // A new context has no storage; the recovery key is kept in memory only for the privacy assertion.
    const recoveryKey = await page.evaluate(() => localStorage.getItem("ffvi-recovery-active"));
    assert.match(recoveryKey, /^ffvi_[a-f0-9]{64}$/);
    await page.getByRole("button", { name: "新游戏", exact: true }).click();
    await page.getByRole("button", { name: "自动推进：关", exact: true }).click();
    await page.waitForFunction(
      () => {
        const m = window.ffviRenderMetrics?.();
        const fade = window.ffvi?.fade;
        const progress = fade
          ? Math.max(0, Math.min(1, (window.ffvi.time - fade.start) / (fade.duration || 0.000001)))
          : 1;
        const fadeAlpha = fade ? fade.from + (fade.to - fade.from) * progress : 0;
        return (
          window.ffvi?.mapId > 0 &&
          window.ffvi.lastInstruction?.script &&
          !window.ffvi.loading &&
          m?.visibleTiles > 0 &&
          m.visibleActors > 0 &&
          m.texturesLoading === 0 &&
          fadeAlpha < 0.001
        );
      },
      null,
      { timeout: 90_000 },
    );
    await page.screenshot({ path: path.join(directory, "before-report.png") });
    const uploadPromise = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/reports" && request.method() === "POST",
    );
    await page.keyboard.press("F9");
    await page.getByRole("dialog").waitFor({ timeout: 60_000 });
    const preview = await page.locator(".feedback-preview").getAttribute("src");
    assert.match(preview, /^data:image\/png;base64,/);
    const frozen = await page.evaluate(() => ({
      mapId: window.ffvi.mapId,
      time: window.ffvi.time,
      player: { x: window.ffvi.player.x, y: window.ffvi.player.y },
    }));
    const description = `[acceptance:${name}:${new Date().toISOString()}] F9 截图、剧情位置和私有报告存储自动验收；请忽略本条测试报告。`;
    await page.getByLabel("出了什么问题？", { exact: true }).fill(description);
    await page.screenshot({ path: path.join(directory, "feedback-dialog.png") });
    const freezeAfterInput = await page.evaluate(() => ({
      mapId: window.ffvi.mapId,
      time: window.ffvi.time,
      player: { x: window.ffvi.player.x, y: window.ffvi.player.y },
    }));
    assert.deepEqual(
      freezeAfterInput,
      frozen,
      "Game state must remain paused while describing the captured problem",
    );
    await page.getByRole("button", { name: "发送报告", exact: true }).click();
    const upload = await uploadPromise;
    const input = upload.postDataJSON();
    assert.equal(input.description, description);
    assert.equal(input.map.id, frozen.mapId);
    assert.deepEqual({ x: input.player.x, y: input.player.y }, frozen.player);
    assert.equal(input.screenshot.dataURL, preview);
    assert.ok(input.events.length > 0 && input.events.length <= 20);
    assert.ok(input.actors.some((actor) => actor.drawn && actor.resource));
    assert.ok(input.script.lastInstruction.script);
    assert.equal(upload.headers()["x-ffvi-account"], self.serverId);
    await page.waitForFunction(
      () => document.getElementById("bug-status").textContent.includes("已发送"),
      null,
      { timeout: 60_000 },
    );
    const status = await page.locator("#bug-status").innerText();
    const id = status.match(/[a-f0-9]{8}-[a-f0-9-]{27}/)?.[0];
    assert.ok(id, "Server report ID must appear after successful sending");
    row.id = id;
    const login = await admin.post("/api/session", { headers, data: { password } });
    assert.equal(login.status(), 200, "Independent administrator authentication failed");
    assert.equal((await login.json()).legacy, true);
    adminConnected = true;
    const response = await admin.get(`/api/admin/reports/${id}`, { headers });
    assert.equal(response.status(), 200);
    assert.match(response.headers()["cache-control"], /no-store/);
    const stored = await response.json();
    assert.deepEqual(
      stored,
      input,
      "Stored report must match the captured and explicitly submitted payload",
    );
    const serialized = JSON.stringify(stored);
    assert.ok(!serialized.includes(recoveryKey), "Recovery keys must never enter reports");
    assert.ok(!serialized.includes(password), "Administrator password must never enter reports");
    assert.ok(!/ffvi_session=/.test(serialized), "Session cookies must never enter reports");
    const png = Buffer.from(stored.screenshot.dataURL.split(",")[1], "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), stored.viewport.width);
    assert.equal(png.readUInt32BE(20), stored.viewport.height);
    assert.ok(
      png.length > 10_000,
      "Real rendered game screenshot must contain more than a blank diagnostic image",
    );
    const pixels = await page.evaluate(async (dataURL) => {
      const image = new Image();
      image.src = dataURL;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0,
        samples = 0;
      const colors = new Set();
      for (let i = 0; i < bytes.length; i += 128) {
        if (bytes[i] + bytes[i + 1] + bytes[i + 2] > 60) visible++;
        colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
        samples++;
      }
      return { visibleFraction: visible / samples, colors: colors.size };
    }, stored.screenshot.dataURL);
    assert.ok(
      pixels.visibleFraction > 0.05 && pixels.colors > 32,
      "Screenshot must show the real game scene after the authored fade",
    );
    row.pixels = pixels;
    await writeFile(path.join(directory, "report.json"), JSON.stringify(stored, null, 2) + "\n");
    await writeFile(path.join(directory, "screenshot.png"), png);
    assert.equal(
      (await unauthenticated.get(`/api/admin/reports/${id}`, { headers })).status(),
      401,
    );
    const otherIdentity = await stranger.post("/api/identity", { headers, data: {} });
    assert.equal(otherIdentity.status(), 200);
    for (const endpoint of ["/api/reports", "/api/admin/reports", `/api/admin/reports/${id}`])
      assert.equal((await stranger.get(endpoint, { headers })).status(), 403);
    assert.equal(
      (await unauthenticated.get(`/resources/reports/${id}.json`, { headers })).status(),
      404,
    );
    assert.equal((await unauthenticated.get(`/reports/${id}.json`, { headers })).status(), 404);
    assert.deepEqual(row.errors, []);
    assert.deepEqual(row.resourceFailures, []);
    row.status = "passed";
    row.context = {
      map: stored.map,
      script: stored.script.lastInstruction,
      actors: stored.actors.length,
      events: stored.events.length,
      screenshotBytes: png.length,
    };
    row.checks = [
      "actual-game-f9-screenshot",
      "paused-immutable-state",
      "explicit-description-and-send",
      "private-r2-readback",
      "no-recovery-key-or-cookie",
      "anonymous-and-other-account-denied",
      "no-public-resource-access",
    ];
  } catch (error) {
    row.status = "failed";
    row.error = error.message;
    results.status = "failed";
    process.exitCode = 1;
  } finally {
    if (adminConnected) await admin.post("/api/logout", { headers, data: {} });
    await Promise.all([
      admin.dispose(),
      stranger.dispose(),
      unauthenticated.dispose(),
      browser.close(),
    ]);
    await writeFile(
      path.join(output, "hosted-feedback.json"),
      JSON.stringify(results, null, 2) + "\n",
    );
  }
}
if (results.status !== "failed") results.status = "passed";
await writeFile(path.join(output, "hosted-feedback.json"), JSON.stringify(results, null, 2) + "\n");
console.log(
  JSON.stringify({
    status: results.status,
    engines: results.engines.map(({ engine, id, status, error, resourceFailures }) => ({
      engine,
      id,
      status,
      error,
      resourceFailures,
    })),
  }),
);
