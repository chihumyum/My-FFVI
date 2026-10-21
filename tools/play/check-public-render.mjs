import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit, devices } from "playwright";
const base = process.env.PLAY_WEB_URL || "https://ffvi.chihum.dev/";
const touch = process.env.PLAY_PUBLIC_TOUCH === "1";
const fullscreen = process.env.PLAY_PUBLIC_FULLSCREEN === "1";
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
  const row = { engine: name, errors: [], apiRequests: [], failedRequests: [], consoleErrors: [] };
  report.results.push(row);
  let page;
  try {
    const context = await browser.newContext(
      touch
        ? {
            ...devices[name === "chromium" ? "Pixel 7" : "iPhone 13"],
            viewport: { width: 844, height: 390 },
          }
        : { viewport: { width: 1280, height: 800 } },
    );
    page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    page.on("pageerror", (e) => row.errors.push(e.message));
    page.on("requestfailed", (request) =>
      row.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
    );
    page.on("console", (message) => {
      if (message.type() === "error") row.consoleErrors.push(message.text());
    });
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
    await page.waitForFunction(() => window.ffviUIDiagnostics && !window.ffviLoading().active);
    await page.getByRole("button", { name: "新游戏", exact: true }).hover();
    await page.waitForFunction(() =>
      window.ffviUIDiagnostics().cursors.some((c) => c.label === "新游戏"),
    );
    row.titleCursor = await page.evaluate(() =>
      window.ffviUIDiagnostics().cursors.find((c) => c.label === "新游戏"),
    );
    for (const mask of row.titleCursor.masks) {
      const bounds = row.titleCursor.bounds;
      assert(bounds.x >= mask.x - 0.01 && bounds.y >= mask.y - 0.01);
      assert(bounds.x + bounds.width <= mask.x + mask.width + 0.01);
      assert(bounds.y + bounds.height <= mask.y + mask.height + 0.01);
    }
    await page
      .locator("#screen")
      .screenshot({ path: path.join(output, `${name}-title-cursor.png`) });
    await page.getByRole("button", { name: "额外内容", exact: true }).click();
    await page.getByRole("button", { name: "图鉴", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `${name}-title-extras.png`) });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "新游戏", exact: true }).waitFor();
    row.titleExtras = true;
    await context.route("https://github.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>Game repository</title>",
      }),
    );
    const checkPageTools = async (stage) => {
      const before = await page.locator("#screen").boundingBox();
      await page.locator("[data-touch-tools]").click();
      assert(await page.locator("#play-tools #bug-report").isVisible());
      assert(await page.locator("#play-tools #repository-open").isVisible());
      assert.equal(await page.getByRole("button", { name: "作者 GitHub", exact: true }).count(), 0);
      assert.deepEqual(await page.locator("#screen").boundingBox(), before);
      await page.screenshot({ path: path.join(output, `${name}-${stage}-tools.png`) });
      const popup = page.waitForEvent("popup");
      await page.locator("#repository-open").click();
      const opened = await popup;
      await opened.waitForURL("https://github.com/chihumyum/My-FFVI");
      await opened.close();
      await page.locator("#bug-report").click();
      await page.locator(".feedback-dialog[open]").waitFor();
      assert(
        await page
          .locator(".feedback-preview")
          .evaluate((img) => img.src.startsWith("data:image/png")),
      );
      await page.locator(".feedback-close").click();
      await page.locator("#tools-close").click();
      await page.keyboard.press("F9");
      await page.locator(".feedback-dialog[open]").waitFor();
      await page.locator(".feedback-close").click();
      assert.deepEqual(await page.locator("#screen").boundingBox(), before);
    };
    await checkPageTools("title");
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
    await checkPageTools("game");
    row.pageTools = { repository: true, report: true, f9: true, titleAndGame: true };
    assert.deepEqual(row.errors, []);
    assert.deepEqual(row.apiRequests, []);
    if (!touch) {
      const before = await page.locator("#screen").boundingBox();
      const tools = page.locator("[data-touch-tools]");
      const toolbar = await tools.boundingBox();
      await page.keyboard.press("Meta+-");
      await page.waitForFunction(() => window.ffviRenderMetrics().gameZoom.scale < 1);
      assert((await page.locator("#screen").boundingBox()).width < before.width);
      assert.deepEqual(await tools.boundingBox(), toolbar);
      await page.screenshot({ path: path.join(output, `${name}-desktop-zoom-out.png`) });
      await page.keyboard.press("Meta+0");
      assert.equal(await page.evaluate(() => window.ffviRenderMetrics().gameZoom.scale), 1);
      row.desktopZoom = true;
    }
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
      assert(Math.abs(row.touch.directions.left - 18) < 1);
      assert(Math.abs(row.touch.actions.right - 826) < 1);
      for (const cluster of [row.touch.directions, row.touch.actions])
        assert(
          cluster.left >= 0 && cluster.right <= 845 && cluster.top >= 0 && cluster.bottom <= 391,
        );
      await page.screenshot({ path: path.join(output, `${name}-floating-controls.png`) });
      const back = page.locator('[data-game-key="Escape"]');
      assert.match(await back.textContent(), /返回/);
      await back.tap();
      await page.getByRole("button", { name: "设置", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "作者 GitHub", exact: true }).count(), 0);
      const menuLabels = await page.evaluate(() =>
        window.ffviUIDiagnostics().keyboardControls.map((control) => control.label),
      );
      for (const label of ["额外内容", "报告问题", "GitHub 项目"])
        assert.equal(menuLabels.includes(label), false, `Page-only entry in game menu: ${label}`);
      row.repositoryLinkOnly = true;
      await back.tap();
      await page.waitForFunction(() => !document.body.classList.contains("modern-menu"));
      const before = await page.locator("#screen").boundingBox();
      await page.locator("[data-touch-toggle]").tap();
      assert.deepEqual(await page.locator("#screen").boundingBox(), before);
      assert.equal(await page.locator("[data-touch-options]").count(), 0);
      const tools = page.locator("[data-touch-tools]");
      assert(await tools.isVisible());
      await tools.tap();
      assert(await page.locator("#play-tools").isVisible());
      assert(await page.locator("#bug-report").isVisible());
      assert(await page.locator("#repository-open").isVisible());
      assert.deepEqual(await page.locator("#screen").boundingBox(), before);
      await page.screenshot({ path: path.join(output, `${name}-tools-with-touch-off.png`) });
      await tools.tap();
      row.toolsWithoutGamepad = true;
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
      const zoomed = await page.locator("#screen").boundingBox();
      assert(Math.abs(zoomed.width - before.width * zoom.scale) < 1);
      assert(Math.abs(zoomed.height - before.height * zoom.scale) < 1);
      await page.screenshot({ path: path.join(output, `${name}-zoom-with-hidden-controls.png`) });
      await page.locator("[data-touch-toggle]").tap();
      assert.deepEqual(await page.evaluate(() => window.ffviRenderMetrics().gameZoom), zoom);
      row.touch.preservesFrame = row.touch.backWorks = row.touch.zoomWithoutGamepad = true;
    }
    if (fullscreen) {
      // Check fullscreen fitting at the reset display size. Zoomed canvases
      // may intentionally extend beyond the window and clip at screen edges.
      if (await page.locator("[data-touch-zoom]").isVisible())
        await page.locator("[data-touch-zoom]").click();
      const button = page.locator("[data-game-fullscreen]");
      const supported = await page.evaluate(() => !!document.fullscreenEnabled);
      row.fullscreen = { supported };
      if (!supported) {
        assert.notEqual(name, "chromium", "Chromium must expose the native Fullscreen API");
        assert.equal(await button.isVisible(), false);
      } else {
        const before = await page.locator("#screen").boundingBox();
        const zoom = await page.evaluate(() => window.ffviRenderMetrics().gameZoom);
        await button.click();
        await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
        await page.waitForFunction(
          () => document.querySelector("[data-game-fullscreen]").textContent === "退出全屏",
        );
        assert.equal(await button.getAttribute("aria-pressed"), "true");
        await page.waitForTimeout(200);
        row.fullscreen.viewport = await page.evaluate(() => {
          const rect = document.querySelector("#screen").getBoundingClientRect();
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            screen: rect.toJSON(),
            includesControls: document.fullscreenElement.contains(
              document.querySelector("#touch-controls"),
            ),
          };
        });
        const { screen, width, height, includesControls } = row.fullscreen.viewport;
        assert(includesControls);
        assert(screen.x >= -1 && screen.y >= -1);
        assert(screen.right <= width + 1 && screen.bottom <= height + 1);
        assert(Math.min(width - screen.width, height - screen.height) < 2);
        assert.deepEqual(await page.evaluate(() => window.ffviRenderMetrics().gameZoom), zoom);
        if (touch) {
          await page.locator('[data-game-key="Escape"]').tap();
          await page.getByRole("button", { name: "设置", exact: true }).waitFor();
          await page.locator('[data-game-key="Escape"]').tap();
          assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
          const frame = await page.locator("#screen").boundingBox();
          await page.locator("[data-touch-toggle]").tap();
          assert.deepEqual(await page.locator("#screen").boundingBox(), frame);
          assert.equal(await button.isVisible(), true);
          await page.locator("[data-touch-toggle]").tap();
        }
        await page.screenshot({ path: path.join(output, `${name}-fullscreen.png`) });
        await button.click();
        await page.waitForFunction(() => !document.fullscreenElement);
        await page.waitForTimeout(200);
        assert.equal(await button.textContent(), "全屏");
        assert.equal(await button.getAttribute("aria-pressed"), "false");
        assert.deepEqual(await page.locator("#screen").boundingBox(), before);
        assert.deepEqual(await page.evaluate(() => window.ffviRenderMetrics().gameZoom), zoom);
        await button.click();
        await page.waitForFunction(() => !!document.fullscreenElement);
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForFunction(
          () => document.querySelector("[data-game-fullscreen]").textContent === "全屏",
        );
        assert.equal(await page.locator("[data-fullscreen-status]").isVisible(), false);
        row.fullscreen.toggleRoundTrip = row.fullscreen.externalExit = true;
        if (touch) {
          const originalViewport = page.viewportSize();
          await page.setViewportSize({ width: 360, height: 800 });
          const cloud = await page.locator("#cloud-toggle").boundingBox();
          for (const control of await page.locator(".touch-toolbar button:visible").all()) {
            const box = await control.boundingBox();
            assert(box.x >= 0 && box.x + box.width <= 361);
            assert(
              box.x >= cloud.x + cloud.width || box.y >= cloud.y + cloud.height,
              "Fullscreen/zoom toolbar must not cover cloud saves on a narrow phone",
            );
          }
          await page.screenshot({ path: path.join(output, `${name}-portrait-toolbar.png`) });
          await page.setViewportSize(originalViewport);
          row.fullscreen.narrowToolbar = true;
        }
      }
    }
    await page.screenshot({ path: path.join(output, `${name}-loaded-world.png`) });
    row.status = "passed";
  } catch (error) {
    row.status = "failed";
    row.error = error.stack;
    row.failureState = await page
      ?.evaluate(() => ({
        boot: document.querySelector("#boot-status")?.textContent,
        loading: window.ffviLoading?.(),
        metrics: window.ffviRenderMetrics?.(),
      }))
      .catch(() => null);
    await page?.screenshot({ path: path.join(output, `${name}-failure.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
}
report.status = report.results.every((r) => r.status === "passed") ? "passed" : "failed";
await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exitCode = 1;
