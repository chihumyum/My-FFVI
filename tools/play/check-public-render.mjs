import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit, devices } from "playwright";
const base = process.env.PLAY_WEB_URL || "https://ffvi.chihum.dev/";
const touch = process.env.PLAY_PUBLIC_TOUCH === "1";
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
    const context = await browser.newContext(
      touch
        ? {
            ...devices[name === "chromium" ? "Pixel 7" : "iPhone 13"],
            viewport: { width: 844, height: 390 },
          }
        : { viewport: { width: 1280, height: 800 } },
    );
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
    if (touch) {
      row.userAgent = await page.evaluate(() => navigator.userAgent);
      row.touch = await page.evaluate(() => {
        const rect = (selector) =>
          document.querySelector(selector).getBoundingClientRect().toJSON();
        return {
          screen: rect("#screen"),
          directions: rect(".touch-dpad"),
          actions: rect(".touch-actions"),
        };
      });
      const frame = row.touch.screen;
      assert(Math.abs(frame.height - 390) < 1);
      for (const cluster of [row.touch.directions, row.touch.actions])
        assert(
          cluster.left >= frame.left - 1 &&
            cluster.right <= frame.right + 1 &&
            cluster.top >= frame.top - 1 &&
            cluster.bottom <= frame.bottom + 1,
        );
      await page.screenshot({ path: path.join(output, `${name}-floating-controls.png`) });
      const back = page.locator('[data-game-key="Escape"]');
      assert.match(await back.textContent(), /返回/);
      await back.tap();
      await page.getByRole("button", { name: "设置", exact: true }).waitFor();
      await back.tap();
      await page.waitForFunction(() => !document.body.classList.contains("modern-menu"));
      const before = await page.locator("#screen").boundingBox();
      await page.locator("[data-touch-toggle]").tap();
      assert.deepEqual(await page.locator("#screen").boundingBox(), before);
      const y = before.y + before.height * 0.3,
        left = before.x + before.width * 0.4,
        right = before.x + before.width * 0.6;
      if (name === "chromium") {
        const cdp = await context.newCDPSession(page);
        for (const [type, touchPoints] of [
          ["touchStart", [{ id: 1, x: left, y }]],
          [
            "touchStart",
            [
              { id: 1, x: left, y },
              { id: 2, x: right, y },
            ],
          ],
          [
            "touchMove",
            [
              { id: 1, x: left - 60, y },
              { id: 2, x: right + 60, y },
            ],
          ],
          ["touchEnd", []],
        ])
          await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
        await cdp.detach();
      } else {
        const screen = page.locator("#screen");
        for (const [type, id, x] of [
          ["pointerdown", 1, left],
          ["pointerdown", 2, right],
          ["pointermove", 1, left - 60],
          ["pointermove", 2, right + 60],
          ["pointerup", 1, left - 60],
          ["pointerup", 2, right + 60],
        ])
          await screen.dispatchEvent(type, {
            pointerType: "touch",
            pointerId: id,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          });
      }
      const zoom = await page.evaluate(() => window.ffviRenderMetrics().gameZoom);
      assert(zoom.scale > 1.5);
      assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
      assert.deepEqual(await page.locator("#screen").boundingBox(), before);
      await page.screenshot({ path: path.join(output, `${name}-zoom-with-hidden-controls.png`) });
      await page.locator("[data-touch-toggle]").tap();
      assert.deepEqual(await page.evaluate(() => window.ffviRenderMetrics().gameZoom), zoom);
      row.touch.preservesFrame = row.touch.backWorks = row.touch.zoomWithoutGamepad = true;
    }
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
