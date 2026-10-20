import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

// This small UI fixture isolates viewport and pointer behavior. It is not game
// story or visual acceptance; the release harness separately loads real saves.
const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(
  process.env.PLAY_TOUCH_LAYOUT_REPORT || "build/play/deployment/mobile-controls/layout",
);
await mkdir(output, { recursive: true });
const fixture = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/touch-layout.css">
<main><canvas id="screen" width="320" height="180"></canvas><footer>debug</footer></main>
<script type="module">
import { mountTouchControls } from '/touch-controls.js';
const screen=document.querySelector('#screen');
window.fixture={keys:[],zooms:[],clicks:0,pointers:[]};
for(const type of ['pointerdown','pointerup','click'])window.addEventListener(type,e=>window.fixture.pointers.push([type,e.pointerId,e.pointerType,e.target?.id]),true);
screen.addEventListener('click',()=>window.fixture.clicks++);
window.controls=mountTouchControls({canvas:screen,
 onLayout:()=>{const main=screen.parentElement;const fit=Math.min(main.clientWidth/320,Number(main.style.getPropertyValue('--game-available-height'))/180);screen.style.width=320*fit+'px';screen.style.height=180*fit+'px'},
 onKeyDown:event=>window.fixture.keys.push(['down',event.key,event.repeat]),
 onKeyUp:event=>window.fixture.keys.push(['up',event.key]),
 onZoom:view=>window.fixture.zooms.push(view),getActions:()=>[]});
</script>`;
const files = new Set(["style.css", "touch-layout.css", "touch-controls.js", "game-zoom.js"]);
const server = createServer(async (request, response) => {
  const file = new URL(request.url, "http://localhost").pathname.slice(1);
  if (!file) {
    response.setHeader("Content-Type", "text/html");
    return response.end(fixture);
  }
  if (!files.has(file)) {
    response.statusCode = 404;
    return response.end();
  }
  response.setHeader("Content-Type", file.endsWith("css") ? "text/css" : "text/javascript");
  response.end(await readFile(path.join(root, "apps/play", file)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const result = [];
try {
  for (const [engine, launch] of Object.entries({ chromium, webkit })) {
    const row = { engine, errors: [] };
    result.push(row);
    const browser = await launch.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => row.errors.push(error.message));
      await page.goto(base);
      await page.waitForFunction(() => window.controls);
      const screen = page.locator("#screen");
      const metrics = () =>
        page.evaluate(() => ({
          screen: document.querySelector("#screen").getBoundingClientRect().toJSON(),
          pad: document.querySelector(".touch-pad").getBoundingClientRect().toJSON(),
          confirm: document
            .querySelector('[data-game-key="Enter"]')
            .getBoundingClientRect()
            .toJSON(),
          padding: getComputedStyle(document.body).paddingBottom,
          mode: document.querySelector("#touch-controls").dataset.layout,
        }));
      row.portrait = await metrics();
      assert.ok(row.portrait.screen.width >= 389, "Portrait must use the available phone width");
      assert.equal(row.portrait.padding, "0px", "Gamepad must not reserve body padding");
      await page.screenshot({ path: path.join(output, `${engine}-portrait.png`) });
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(100);
      row.landscape = await metrics();
      assert.ok(row.landscape.screen.height >= 389, "Landscape game must fill available height");
      assert.equal(row.landscape.mode, "floating");
      for (const selector of [".touch-dpad", ".touch-actions"]) {
        const cluster = await page.locator(selector).boundingBox();
        assert(cluster.x >= row.landscape.screen.left - 1);
        assert(cluster.x + cluster.width <= row.landscape.screen.right + 1);
        assert(cluster.y >= row.landscape.screen.top - 1);
        assert(cluster.y + cluster.height <= row.landscape.screen.bottom + 1);
      }
      const button = page.locator('[data-game-key="Enter"]');
      assert.ok(Number(await button.evaluate((node) => getComputedStyle(node).opacity)) < 1);
      await button.tap();
      assert.deepEqual(await page.evaluate(() => window.fixture.keys.slice(-2)), [
        ["down", "Enter", false],
        ["up", "Enter"],
      ]);
      const before = await metrics();
      const box = await screen.boundingBox();
      const y = box.y + box.height * 0.3;
      const left = box.x + box.width * 0.4;
      const right = box.x + box.width * 0.6;
      const pointer = (type, id, x) =>
        screen.dispatchEvent(type, {
          pointerType: "touch",
          pointerId: id,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        });
      if (engine === "chromium") {
        const cdp = await context.newCDPSession(page);
        const touch = (type, points) =>
          cdp.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: points.map(([id, x]) => ({ id, x, y })),
          });
        await touch("touchStart", [[1, left]]);
        await touch("touchStart", [
          [1, left],
          [2, right],
        ]);
        await touch("touchMove", [
          [1, left - 65],
          [2, right + 65],
        ]);
        await touch("touchEnd", [[1, left - 65]]);
        await touch("touchEnd", []);
        row.pinchInput = "Chromium native touch input via CDP";
        const pad = await page.locator('[data-game-key="ArrowRight"]').boundingBox();
        const confirm = await button.boundingBox();
        const native = (type, points) =>
          cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
        const a = { id: 11, x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 };
        const b = { id: 12, x: confirm.x + confirm.width / 2, y: confirm.y + confirm.height / 2 };
        await page.evaluate(() => (window.fixture.keys = []));
        await native("touchStart", [a]);
        await native("touchStart", [a, b]);
        await native("touchEnd", [b]);
        await native("touchEnd", []);
        assert.deepEqual(await page.evaluate(() => window.fixture.keys), [
          ["down", "ArrowRight", false],
          ["down", "Enter", false],
          ["up", "Enter"],
          ["up", "ArrowRight"],
        ]);
        row.independentHeldButtons = true;
      } else {
        await pointer("pointerdown", 1, left);
        await pointer("pointerdown", 2, right);
        await pointer("pointermove", 1, left - 65);
        await pointer("pointermove", 2, right + 65);
        await pointer("pointerup", 1, left - 65);
        await pointer("pointerup", 2, right + 65);
        await screen.dispatchEvent("click", { pointerId: 2, pointerType: "touch" });
        row.pinchInput = "WebKit pointer events; single taps use native Playwright touch";
      }
      row.zoom = await page.evaluate(() => window.fixture.zooms.at(-1));
      assert.ok(row.zoom.scale > 1.5 && row.zoom.scale <= 3);
      assert.equal(await page.evaluate(() => window.fixture.clicks), 0, "Pinch must not click");
      assert.deepEqual((await metrics()).confirm, before.confirm, "Gamepad must not zoom");
      await screen.tap({ position: { x: box.width / 2, y: box.height * 0.25 } });
      row.pointers = await page.evaluate(() => window.fixture.pointers);
      assert.equal(
        await page.evaluate(() => window.fixture.clicks),
        1,
        "Single taps remain usable",
      );
      await page.screenshot({ path: path.join(output, `${engine}-landscape.png`) });
      await page.locator("[data-touch-zoom]").tap();
      assert.deepEqual(await page.evaluate(() => window.fixture.zooms.at(-1)), {
        scale: 1,
        x: 0,
        y: 0,
        active: false,
      });
      assert.deepEqual(row.errors, []);
      row.status = "passed";
      await context.close();
    } catch (error) {
      row.status = "failed";
      row.error = error.stack;
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
await writeFile(path.join(output, "report.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.some((row) => row.status !== "passed")) process.exitCode = 1;
