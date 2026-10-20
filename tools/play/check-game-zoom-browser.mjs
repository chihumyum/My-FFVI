import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

const output = path.resolve("build/play/deployment/pinch-zoom/browser");
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: path.resolve("vite.config.mjs"),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const results = [];
const close = (actual, expected, label) =>
  assert(Math.abs(actual - expected) < 1, `${label}: ${actual} != ${expected}`);
const sameRectangle = (actual, expected, label) => {
  for (const key of ["x", "y", "width", "height"])
    close(actual[key], expected[key], `${label}.${key}`);
};
try {
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch({
      headless: true,
      args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    try {
      for (const touch of [false, true]) {
        const name = `${engine}-${touch ? "touch" : "trackpad"}`;
        const context = await browser.newContext({
          viewport: touch ? { width: 844, height: 390 } : { width: 1600, height: 1000 },
          hasTouch: touch,
          isMobile: touch,
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();
        const row = { name, errors: [] };
        results.push(row);
        page.on("pageerror", (error) => row.errors.push(error.message));
        const ready = () =>
          page.waitForFunction(
            () => window.ffviRenderMetrics?.().frames > 3 && !window.ffviLoading().active,
            null,
            {
              timeout: 60000,
            },
          );
        const screen = page.locator("#screen");
        const present = () =>
          page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
        const button = (label) =>
          page.locator(".pixi-accessibility").getByRole("button", { name: label, exact: true });
        const geometry = async () => ({
          canvas: await screen.boundingBox(),
          tools: await page.locator("[data-touch-tools]").boundingBox(),
          confirm: await page.locator('[data-game-key="Enter"]').boundingBox(),
        });
        const pinch = async (factor, anchor) => {
          if (touch) {
            const distance = 60;
            const points = (width) => [
              { id: 1, x: anchor.x - width / 2, y: anchor.y },
              { id: 2, x: anchor.x + width / 2, y: anchor.y },
            ];
            if (engine === "chromium") {
              const cdp = await context.newCDPSession(page);
              for (const [type, touchPoints] of [
                ["touchStart", points(distance)],
                ["touchMove", points(distance * factor)],
                ["touchEnd", []],
              ])
                await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
              await cdp.detach();
            } else {
              for (const [type, width] of [
                ["pointerdown", distance],
                ["pointermove", distance * factor],
                ["pointerup", distance * factor],
              ])
                for (const point of points(width))
                  await screen.dispatchEvent(type, {
                    pointerType: "touch",
                    pointerId: point.id,
                    clientX: point.x,
                    clientY: point.y,
                    bubbles: true,
                    cancelable: true,
                  });
            }
          } else if (engine === "chromium") {
            const cdp = await context.newCDPSession(page);
            await cdp.send("Input.dispatchMouseEvent", {
              type: "mouseWheel",
              x: anchor.x,
              y: anchor.y,
              deltaX: 0,
              deltaY: -Math.log(factor) * 100,
              modifiers: 2,
            });
            await cdp.detach();
          } else {
            await screen.evaluate(
              (canvas, { factor, anchor }) => {
                for (const [type, scale] of [
                  ["gesturestart", 1],
                  ["gesturechange", factor],
                  ["gestureend", factor],
                ]) {
                  const event = new Event(type, { bubbles: true, cancelable: true });
                  Object.defineProperties(event, {
                    clientX: { value: anchor.x },
                    clientY: { value: anchor.y },
                    scale: { value: scale },
                  });
                  canvas.dispatchEvent(event);
                }
              },
              { factor, anchor },
            );
          }
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
        };
        try {
          if (engine === "chromium" && !touch) {
            // Restore the reported world-only transform: a changing percentage
            // must fail the displayed-canvas assertion, even with real pixels moving.
            await page.route("**/renderer.js", async (route) => {
              const response = await route.fetch(),
                original = await response.text();
              const body = original.replace(
                'this.canvas.style.transformOrigin = "0 0";',
                'this.world.scale.x *= zoom.scale; this.world.scale.y *= zoom.scale; this.world.position.set(zoom.x * width, zoom.y * height); this.canvas.style.transform = "none"; return;',
              );
              assert.notEqual(body, original);
              await route.fulfill({ response, body });
            });
            await page.goto(`${base}?checkpoint=narshe-rock&panel=dialogue`);
            await ready();
            const before = await screen.boundingBox();
            await pinch(1.25, { x: before.x + before.width / 2, y: before.y + before.height / 2 });
            const changedScale = await page.evaluate(
              () => window.ffviRenderMetrics().gameZoom.scale,
            );
            assert(changedScale > 1.05);
            const fixedCanvas = await screen.boundingBox();
            assert.throws(() =>
              close(fixedCanvas.width, before.width * changedScale, "whole canvas must grow"),
            );
            sameRectangle(await screen.boundingBox(), before, "reported fixed frame");
            await page.screenshot({ path: path.join(output, "before-world-only.png") });
            row.negativeControl = "world-only zoom detected by unchanged canvas bounds";
            await page.unroute("**/renderer.js");
          }
          await page.goto(`${base}?checkpoint=narshe-rock&panel=dialogue`);
          await ready();
          const before = await geometry();
          const dialogue = await button("继续 ▸").boundingBox();
          const anchor = {
            x: before.canvas.x + before.canvas.width * 0.55,
            y: before.canvas.y + before.canvas.height * 0.45,
          };
          await page.screenshot({ path: path.join(output, `${name}-100.png`) });
          for (const factor of [1.2, 1.15]) await pinch(factor, anchor);
          const zoom = await page.evaluate(() => window.ffviRenderMetrics().gameZoom);
          const after = await geometry();
          close(after.canvas.width, before.canvas.width * zoom.scale, "canvas width scales");
          close(after.canvas.height, before.canvas.height * zoom.scale, "canvas height scales");
          close(
            after.canvas.x + (anchor.x - before.canvas.x) * zoom.scale,
            anchor.x,
            "stable anchor x",
          );
          close(
            after.canvas.y + (anchor.y - before.canvas.y) * zoom.scale,
            anchor.y,
            "stable anchor y",
          );
          const dialogueAfter = await button("继续 ▸").boundingBox();
          close(dialogueAfter.width, dialogue.width * zoom.scale, "dialogue button scales");
          close(
            dialogueAfter.x - after.canvas.x,
            (dialogue.x - before.canvas.x) * zoom.scale,
            "dialogue hit target follows canvas",
          );
          sameRectangle(after.tools, before.tools, "page toolbar");
          if (touch) sameRectangle(after.confirm, before.confirm, "virtual gamepad");
          assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
          await page.screenshot({ path: path.join(output, `${name}-zoom.png`) });
          await page.locator("[data-touch-zoom]").click();
          await page.keyboard.press("Meta+-");
          await present();
          const shrunk = await screen.boundingBox();
          close(shrunk.width, before.canvas.width / 1.2, "entire canvas shrinks");
          close(
            (await button("继续 ▸").boundingBox()).width,
            dialogue.width / 1.2,
            "dialogue shrinks with scene",
          );
          await page.screenshot({ path: path.join(output, `${name}-shrink.png`) });
          await button("继续 ▸").click();
          await page.waitForFunction(() => !window.ffvi.dialogue);
          row.scaledDialogueInput = true;
          await page.locator("[data-touch-zoom]").click();
          sameRectangle((await geometry()).canvas, before.canvas, "reset");

          // Real ordinary menu inputs; opening extras and saves must keep the
          // camera rectangle at both the normal and enlarged display size.
          for (const factor of [1, 1.2]) {
            await page.goto(`${base}?checkpoint=narshe-rock&panel=${encodeURIComponent("队伍")}`);
            await ready();
            sameRectangle(
              await screen.boundingBox(),
              before.canvas,
              "party menu matches field camera",
            );
            if (factor !== 1)
              await pinch(factor, {
                x: before.canvas.x + before.canvas.width / 2,
                y: before.canvas.y + before.canvas.height / 2,
              });
            const field = await screen.boundingBox();
            await button("额外内容").waitFor();
            sameRectangle(await screen.boundingBox(), field, "party menu");
            await button("额外内容").click();
            await button("画廊").waitFor();
            sameRectangle(await screen.boundingBox(), field, "extras");
            await page.screenshot({ path: path.join(output, `${name}-extras-${factor}.png`) });
            await button("画廊").click();
            await page.waitForFunction(() => {
              const cards = window.ffviUIDiagnostics().cards;
              return cards.length === 24 && cards.every((card) => card.loaded);
            });
            sameRectangle(await screen.boundingBox(), field, "gallery");
            await button(/^搜索名称或编号/).click();
            await page.getByRole("searchbox", { name: "搜索名称或编号", exact: true }).fill("003");
            await page.waitForFunction(() => window.ffviUIDiagnostics().cards.length === 1);
            await page.keyboard.press("Enter");
            await page.screenshot({ path: path.join(output, `${name}-gallery-${factor}.png`) });
            await page.keyboard.press("Escape");
            await button("存档").click();
            await button("写入存档 1").waitFor();
            sameRectangle(await screen.boundingBox(), field, "save menu");
            await page.screenshot({ path: path.join(output, `${name}-save-${factor}.png`) });
            await page.keyboard.press("Escape");
            await page.keyboard.press("Escape");
            sameRectangle(await screen.boundingBox(), field, "return to game");
          }
          await page.locator("[data-touch-zoom]").click();
          sameRectangle(await screen.boundingBox(), before.canvas, "final reset");
          row.input = touch
            ? `${engine === "chromium" ? "native CDP" : "synthetic WebKit pointer"} touch pinch`
            : `${engine === "chromium" ? "native CDP ctrl-wheel" : "synthetic WebKit gesture"} trackpad`;
          row.geometry = { before, after, zoom };
          row.menusMatchCamera = true;
          assert.deepEqual(row.errors, []);
          row.status = "passed";
        } catch (error) {
          row.status = "failed";
          row.error = error.stack;
          row.failureState = await page.evaluate(() => ({
            zoom: window.ffviRenderMetrics?.().gameZoom,
            busy: window.ffvi?.busy,
            dialogue: window.ffvi?.dialogue?.text,
            buttons: [...document.querySelectorAll(".pixi-accessibility button")].map(
              (b) => b.getAttribute("aria-label") || b.textContent,
            ),
          }));
          console.error(name, error.stack);
          await page.screenshot({ path: path.join(output, `${name}-failure.png`) }).catch(() => {});
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
await writeFile(path.join(output, "report.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results.map(({ name, status, error }) => ({ name, status, error }))));
if (results.some((row) => row.status !== "passed")) process.exitCode = 1;
