import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

const output = path.resolve(
  process.env.PLAY_CURSOR_REPORT || "build/play/deployment/menu-cursor/browser",
);
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: path.resolve("vite.config.mjs"),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const clipped = ({ bounds: b, masks }) =>
  masks.some(
    (m) =>
      b.x < m.x - 0.01 ||
      b.y < m.y - 0.01 ||
      b.x + b.width > m.x + m.width + 0.01 ||
      b.y + b.height > m.y + m.height + 0.01,
  );
const results = [];
try {
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({
      headless: true,
      args: engine === "chromium" ? ["--use-angle=metal"] : [],
    });
    const row = { engine, errors: [], cursors: [] };
    results.push(row);
    let page;
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      page = await context.newPage();
      page.on("pageerror", (error) => row.errors.push(error.message));
      const ready = () =>
        page.waitForFunction(() => window.ffviUIDiagnostics && !window.ffviLoading().active, null, {
          timeout: 60000,
        });
      const hover = async (label) => {
        await page
          .locator(".pixi-accessibility")
          .getByRole("button", { name: label, exact: true })
          .first()
          .hover();
        await page.waitForFunction(
          (label) => window.ffviUIDiagnostics().cursors.some((c) => c.label === label),
          label,
        );
        return page.evaluate(() => window.ffviUIDiagnostics().cursors);
      };
      if (engine === "chromium") {
        await page.route("**/ui.js", async (route) => {
          const response = await route.fetch();
          const original = await response.text();
          const body = original.replace(
            ".rect(bodyX - cursorOverhang, bodyY, bodyWidth + cursorOverhang, pinY - bodyY - 12)",
            ".rect(bodyX, bodyY, bodyWidth, pinY - bodyY - 12)",
          );
          assert.notEqual(body, original, "Negative control must restore the original mask");
          await route.fulfill({ response, body });
        });
        await page.goto(base);
        await ready();
        const before = await hover("新游戏");
        assert(before.some(clipped), "Check must detect the original cropped title cursor");
        row.negativeControl = before;
        await page
          .locator("#screen")
          .screenshot({ path: path.join(output, "chromium-title-before.png") });
        await page.unroute("**/ui.js");
      }
      await page.goto(base);
      await ready();
      for (const label of ["新游戏", "继续游戏", "额外内容"]) {
        const cursors = await hover(label);
        assert(cursors.length === 1 && cursors[0].masks.length > 0);
        assert.deepEqual(cursors.filter(clipped), [], `Cropped title cursor: ${label}`);
        row.cursors.push({ panel: "title", cursors });
      }
      await hover("新游戏");
      await page
        .locator("#screen")
        .screenshot({ path: path.join(output, `${engine}-title-after.png`) });
      for (const panel of ["道具", "装备", "魔法", "shop", "save", "battle"]) {
        await page.goto(
          `${base}?checkpoint=narshe-rock&panel=${encodeURIComponent(panel)}&formation=4`,
        );
        await ready();
        await page.waitForFunction(() => window.ffviUIDiagnostics().keyboardControls.length > 0);
        if (panel === "battle") {
          await page.waitForFunction(
            () =>
              window.ffvi.battle?.players.some((unit) => unit.ready) &&
              window.ffviUIDiagnostics().keyboardControls.length > 1,
          );
          // Use the ordinary tools pause while inspecting changing ATB controls.
          await page.locator("[data-touch-tools]").click();
        }
        const controls = await page.evaluate(() => window.ffviUIDiagnostics().keyboardControls);
        const labels = [
          ...new Set([...controls.slice(0, 4), ...controls.slice(-8)].map((c) => c.label)),
        ];
        for (const label of labels) {
          const cursors = await hover(label);
          assert.deepEqual(cursors.filter(clipped), [], `Cropped ${panel} cursor: ${label}`);
          row.cursors.push({ panel, cursors });
        }
        await page
          .locator("#screen")
          .screenshot({ path: path.join(output, `${engine}-${panel}.png`) });
      }
      await page.goto(`${base}?checkpoint=narshe-rock`);
      await ready();
      const canvas = page.locator("#screen"),
        tools = page.locator("[data-touch-tools]");
      const geometry = async () => ({
        canvas: await canvas.boundingBox(),
        tools: await tools.boundingBox(),
      });
      const before = await geometry();
      assert.equal(await page.locator("[data-touch-options]").count(), 0);
      for (let n = 0; n < 2; n++) {
        await page.locator("[data-touch-toggle]").click();
        assert.deepEqual(
          await geometry(),
          before,
          "Touch toggle must not resize the desktop game or toolbar",
        );
      }
      assert.equal(await page.locator("[data-touch-toggle]").getAttribute("aria-pressed"), "false");
      await tools.click();
      assert(await page.locator("#play-tools").isVisible(), "Tools must work while touch is off");
      await tools.click();
      const dpr = await page.evaluate(() => window.devicePixelRatio);
      await page.keyboard.press("Meta+-");
      assert((await page.evaluate(() => window.ffviRenderMetrics().gameZoom.scale)) < 1);
      assert.deepEqual(await geometry(), before);
      await page.keyboard.press("Meta+=");
      await page.keyboard.press("Meta+=");
      assert((await page.evaluate(() => window.ffviRenderMetrics().gameZoom.scale)) > 1);
      await page.keyboard.press("Meta+0");
      assert.deepEqual(await page.evaluate(() => window.ffviRenderMetrics().gameZoom), {
        scale: 1,
        x: 0,
        y: 0,
      });
      const box = before.canvas,
        x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      if (engine === "chromium") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x,
          y,
          deltaX: 0,
          deltaY: -45,
          modifiers: 2,
        });
        await cdp.detach();
        row.trackpadInput = "Native Chromium ctrl-wheel pinch input via CDP";
      } else {
        await page.evaluate(
          ({ x, y }) => {
            for (const [type, scale] of [
              ["gesturestart", 1],
              ["gesturechange", 1.5],
              ["gestureend", 1.5],
            ]) {
              const event = new Event(type, { bubbles: true, cancelable: true });
              Object.defineProperties(event, {
                clientX: { value: x },
                clientY: { value: y },
                scale: { value: scale },
              });
              document.querySelector("#screen").dispatchEvent(event);
            }
          },
          { x, y },
        );
        row.trackpadInput = "Synthetic WebKit GestureEvent shape; physical trackpad not tested";
      }
      await page.waitForFunction(() => window.ffviRenderMetrics().gameZoom.scale > 1.2);
      assert.deepEqual(await geometry(), before);
      assert.equal(await page.evaluate(() => window.devicePixelRatio), dpr);
      assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
      row.shortcutsAndIndependentSizing = true;
      await page.screenshot({ path: path.join(output, `${engine}-desktop-zoom.png`) });
      assert.deepEqual(row.errors, []);
      row.status = "passed";
    } catch (error) {
      row.status = "failed";
      row.error = error.stack;
      row.diagnostics = await page?.evaluate(() => window.ffviUIDiagnostics?.()).catch(() => null);
      await page?.screenshot({ path: path.join(output, `${engine}-failure.png`) }).catch(() => {});
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
await writeFile(path.join(output, "report.json"), JSON.stringify(results, null, 2));
console.log(
  JSON.stringify(results.map(({ engine, status, error }) => ({ engine, status, error }))),
);
if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
