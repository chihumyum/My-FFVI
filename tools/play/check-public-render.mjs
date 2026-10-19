import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";
const base = process.env.PLAY_WEB_URL || "https://ffvi.chihum.dev/";
const output = path.resolve(
  process.env.PLAY_PUBLIC_RENDER_REPORT || "build/play/deployment/public/published-render",
);
await mkdir(output, { recursive: true });
const snapshot = JSON.parse(
  await readFile("build/play/acceptance/step-7/browsers-final-chromium/chromium/actual-save.json"),
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
const report = {
  status: "running",
  base,
  scope:
    "Published JS and same-origin R2 resources, real backup/load UI. Cloud identity markers removed only in these empty browser profiles to isolate rendering and avoid extra signup/rate limits. Separate published identity acceptance covers the actual cloud flows.",
  results: [],
};
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch({
    headless: true,
    args: name === "chromium" ? ["--use-angle=metal"] : [],
  });
  const row = { engine: name, errors: [], apiRequests: [] };
  report.results.push(row);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => row.errors.push(e.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        row.apiRequests.push(new URL(request.url()).pathname);
    });
    await page.route(
      (url) => url.origin === new URL(base).origin && url.pathname === "/",
      async (route) => {
        const response = await route.fetch();
        const html = (await response.text()).replace(
          /<meta name="ffvi-(host|identity)"[^>]*>/g,
          "",
        );
        await route.fulfill({ response, body: html });
      },
    );
    await page.goto(base);
    await page.locator("#cloud-toggle").waitFor({ timeout: 60000 });
    await page.locator("#cloud-toggle").click();
    await page.locator('#cloud-panel input[type="file"]').setInputFiles({
      name: "actual-save.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.waitForFunction(() =>
      document.getElementById("cloud-panel").textContent.includes("已完成"),
    );
    await page.getByRole("button", { name: "返回游戏", exact: true }).click();
    await page.getByRole("button", { name: "继续游戏", exact: true }).click();
    await page.getByRole("button", { name: "读取存档 1", exact: true }).click();
    await page.waitForFunction(() => window.ffvi?.mapId === 1 && !window.ffvi.loading);
    await page.waitForFunction(
      () => {
        const m = window.ffviRenderMetrics();
        return m.visibleTiles > 0 && m.visibleActors > 0 && m.texturesLoading === 0;
      },
      null,
      { timeout: 60000 },
    );
    row.metrics = await page.evaluate(() => {
      const m = window.ffviRenderMetrics();
      return {
        visibleTiles: m.visibleTiles,
        visibleActors: m.visibleActors,
        texturesLoading: m.texturesLoading,
        texturesReady: m.texturesReady,
        texturesFailed: m.texturesFailed,
      };
    });
    assert.equal(row.metrics.texturesFailed, 0);
    assert.deepEqual(row.errors, []);
    assert.deepEqual(row.apiRequests, []);
    await page.screenshot({ path: path.join(output, `${name}-loaded-world.png`) });
    row.status = "passed";
  } catch (error) {
    row.status = "failed";
    row.error = error.stack;
  } finally {
    await browser.close();
  }
}
report.status = report.results.every((r) => r.status === "passed") ? "passed" : "failed";
await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exitCode = 1;
