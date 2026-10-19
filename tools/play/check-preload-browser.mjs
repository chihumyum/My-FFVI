import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { build, preview } from "vite";
import { chromium, webkit } from "playwright";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(
  process.env.PLAY_PRELOAD_REPORT || "build/play/deployment/preloading/browser",
);
await mkdir(output, { recursive: true });
const web = await mkdtemp(path.join(root, "dist/preload-check-"));
const source = path.join(root, "build/web-data/web");
const index = JSON.parse(await readFile(path.join(source, "data/index.json")));
const snapshot = JSON.parse(
  await readFile(
    path.join(
      root,
      "build/play/acceptance/step-7/browsers-final-chromium/chromium/actual-save.json",
    ),
  ),
);
const backup = {
  format: "ffvi-reweb-saves",
  version: 1,
  records: [
    {
      id: "normal:1",
      mode: "normal",
      slot: 1,
      time: snapshot.time,
      savedAt: Date.now(),
      map: "真实 M1 存档",
      party: [],
      snapshot,
    },
  ],
};
let server;
const results = [];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const until = async (predicate, message) => {
  const end = Date.now() + 60000;
  while (!predicate()) {
    if (Date.now() > end) throw Error(message);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
try {
  await build({
    configFile: path.join(root, "vite.config.mjs"),
    publicDir: false,
    build: { outDir: web },
    logLevel: "error",
  });
  for (const dir of ["data", "atlases", "fonts", "audio", "previews"])
    await symlink(path.join(source, dir), path.join(web, dir));
  server = await preview({
    configFile: false,
    build: { outDir: web },
    preview: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
  for (const name of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
    const row = { engine: name, errors: [], status: "running" };
    results.push(row);
    const browser = await { chromium, webkit }[name].launch({
      headless: true,
      args: name === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    const page = await context.newPage();
    page.on("dialog", (dialog) => dialog.accept());
    page.on("pageerror", (error) => row.errors.push(error.message));
    let releaseMap, releaseImages;
    let recoveryPage;
    const mapGate = new Promise((resolve) => {
      releaseMap = resolve;
    });
    const imageGate = new Promise((resolve) => {
      releaseImages = resolve;
    });
    let failMap = true,
      mapRequested = false,
      holdMap = true,
      holdImages = false,
      failImages = false;
    try {
      await page.route("**/*", async (route) => {
        const file = new URL(route.request().url()).pathname.slice(1);
        if (file === index.maps[3] && holdMap) {
          mapRequested = true;
          await mapGate;
          if (failMap) return route.fulfill({ status: 503, body: "Controlled map failure" });
        }
        if (file.startsWith("atlases/")) {
          if (holdImages) await imageGate;
          if (failImages) return route.fulfill({ status: 503, body: "Controlled atlas failure" });
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (file.startsWith("data/")) await new Promise((resolve) => setTimeout(resolve, 150));
        return route.continue();
      });
      await page.goto(base, { waitUntil: "commit" });
      await page.locator("#load-progress").waitFor();
      await page.screenshot({ path: path.join(output, `${name}-boot-progress.png`) });
      await page.waitForFunction(() => window.ffviLoading && !window.ffviLoading().active, null, {
        timeout: 60000,
      });
      assert.equal(await page.locator("#boot-status").isVisible(), false);
      assert.equal(await page.evaluate(() => window.ffviRenderMetrics().texturesFailed), 0);
      await page.locator("#cloud-toggle").click();
      await page.locator('#cloud-panel input[type="file"]').setInputFiles({
        name: "m1.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup)),
      });
      await page.waitForFunction(() =>
        document.getElementById("cloud-panel").textContent.includes("已完成"),
      );
      await page.getByRole("button", { name: "返回游戏", exact: true }).click();
      await page.getByRole("button", { name: "继续游戏", exact: true }).click();
      await page.getByRole("button", { name: "读取存档 1", exact: true }).click();
      await page.waitForFunction(
        () => window.ffvi?.mapId === 1 && !window.ffviLoading().active,
        null,
        { timeout: 60000 },
      );
      await until(() => mapRequested, "Nearby Narshe exit was not prefetched");
      assert.equal(await page.evaluate(() => window.ffvi.mapId), 1);
      assert.equal(
        await page.evaluate(() => window.ffviLoading().active),
        false,
        "Background preload must not block the current map",
      );
      row.prefetchedBeforeEntry = true;
      holdImages = true;
      await page.keyboard.down("ArrowUp");
      await page.waitForFunction(() => window.ffvi.loading && window.ffviLoading().active);
      await page.keyboard.up("ArrowUp");
      const box = await page.locator("#screen").boundingBox();
      const clip = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: Math.min(250, box.height * 0.4),
      };
      const held = await page.screenshot({ clip });
      const time = await page.evaluate(() => window.ffvi.time);
      await page.waitForTimeout(600);
      assert.equal(
        digest(await page.screenshot({ clip })),
        digest(held),
        "Old canvas changed while map data was pending",
      );
      assert.equal(
        await page.evaluate(() => window.ffvi.time),
        time,
        "VM clock advanced during loading",
      );
      await page.screenshot({ path: path.join(output, `${name}-held-world.png`) });
      holdMap = false;
      releaseMap();
      await page.waitForFunction(() => window.ffviLoading().state === "failed");
      assert.equal(await page.evaluate(() => window.ffvi.mapId), 1);
      failMap = false;
      await page.getByRole("button", { name: "重试", exact: true }).click();
      row.retriedDataWithoutReset = true;
      await page.waitForFunction(
        () => window.ffvi.mapId === 3 && !window.ffvi.loading && window.ffviLoading().active,
        null,
        { timeout: 60000 },
      );
      await page.waitForTimeout(400);
      assert.equal(
        digest(await page.screenshot({ clip })),
        digest(held),
        "New map was presented before its atlas was ready",
      );
      row.heldCanvasAcrossMapAssignment = true;
      row.pending = await page.evaluate(() => window.ffviLoading());
      await page.screenshot({ path: path.join(output, `${name}-texture-progress.png`) });
      // Exercise a real failed fetch, then retry without resetting the VM/save.
      failImages = true;
      holdImages = false;
      releaseImages();
      await page.waitForFunction(() => window.ffviLoading().state === "failed", null, {
        timeout: 60000,
      });
      const failedTime = await page.evaluate(() => window.ffvi.time);
      failImages = false;
      await page.getByRole("button", { name: "重试", exact: true }).click();
      await page.waitForFunction(() => !window.ffviLoading().active, null, { timeout: 60000 });
      assert.equal(await page.evaluate(() => window.ffvi.mapId), 3);
      row.retriedWithoutReset = true;
      row.failedAtTime = failedTime;
      row.metrics = await page.evaluate(() => {
        const m = window.ffviRenderMetrics();
        return {
          tiles: m.visibleTiles,
          actors: m.visibleActors,
          failed: m.texturesFailed,
          loading: m.texturesLoading,
        };
      });
      assert(row.metrics.tiles > 0 && row.metrics.actors > 0);
      assert.equal(row.metrics.failed, 0);
      assert.equal(row.metrics.loading, 0);
      assert.deepEqual(row.errors, []);
      await page.screenshot({ path: path.join(output, `${name}-loaded-narshe.png`) });
      await rm(path.join(output, `${name}-failed.png`), { force: true });
      const broken = await context.newPage();
      recoveryPage = broken;
      row.recoveryRequests = [];
      broken.on("request", (request) => {
        if (/\/assets\/app-/.test(request.url())) row.recoveryRequests.push(request.url());
      });
      await broken.route("**/assets/app-*.js", (route) => route.abort());
      await broken.goto(base, { waitUntil: "commit" });
      await broken.locator("#boot-status[data-state='failed']").waitFor({ timeout: 30000 });
      await broken.getByRole("link", { name: "重新加载", exact: true }).waitFor();
      await broken.screenshot({ path: path.join(output, `${name}-module-failure.png`) });
      row.moduleFailureHasRecovery = true;
      await broken.unroute("**/assets/app-*.js");
      await broken.getByRole("link", { name: "重新加载", exact: true }).click();
      await broken.waitForFunction(() => window.ffviLoading && !window.ffviLoading().active, null, {
        timeout: 60000,
      });
      await broken.getByRole("button", { name: "新游戏", exact: true }).click();
      await broken.waitForFunction(
        () => window.ffvi?.mapId && !window.ffvi.loading && !window.ffviLoading().active,
        null,
        { timeout: 60000 },
      );
      assert.equal(await broken.evaluate(() => window.ffviRenderMetrics().texturesFailed), 0);
      row.newGameReady = true;
      await broken.screenshot({ path: path.join(output, `${name}-new-game.png`) });
      await broken.close();
      row.status = "passed";
    } catch (error) {
      row.status = "failed";
      row.error = error.stack;
      row.state = await page
        .evaluate(() => ({
          load: window.ffviLoading?.(),
          map: window.ffvi?.mapId,
          player: window.ffvi?.player,
          metrics: window.ffviRenderMetrics?.(),
        }))
        .catch(() => null);
      if (recoveryPage && !recoveryPage.isClosed()) {
        row.recovery = await recoveryPage
          .evaluate(() => ({
            url: location.href,
            load: window.ffviLoading?.(),
            message: document.getElementById("boot-message")?.textContent,
            metrics: window.ffviRenderMetrics?.(),
          }))
          .catch(() => null);
        await recoveryPage
          .screenshot({ path: path.join(output, `${name}-recovery-failed.png`) })
          .catch(() => {});
      }
      await page.screenshot({ path: path.join(output, `${name}-failed.png`) }).catch(() => {});
    } finally {
      releaseMap();
      releaseImages();
      await browser.close();
    }
  }
} finally {
  await server?.httpServer.close();
  await rm(web, { recursive: true, force: true });
}
const report = {
  status: results.every((row) => row.status === "passed") ? "passed" : "failed",
  scope:
    "Real static build, disposable local saves, ordinary ArrowUp into Narshe; delayed JSON/atlases and a controlled HTTP 503. No plot mutations or cloud owner data.",
  results,
};
await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exitCode = 1;
