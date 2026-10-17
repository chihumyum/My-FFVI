import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

// Isolated renderer check; PLAY_WEB_URL must serve the Vite source modules.
// The ordinary packaged UI is separately checked by check-extras-browser.mjs.
const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4173/",
  output = path.resolve(
    process.env.PLAY_ACCESSIBILITY_REPORT_DIR || "build/play/acceptance/step-5/accessibility",
  ),
  engine = process.env.PLAY_BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
await mkdir(output, { recursive: true });
const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  }),
  page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 }),
  result = { engine, base, errors: [], sizes: [] };
page.on("pageerror", (error) => result.errors.push(error.message));
try {
  await page.route("**/__accessibility-check", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><title>Back buffer accessibility regression</title></head><body style="margin:0"><canvas id="probe"></canvas></body></html>',
    }),
  );
  await page.goto(new URL("__accessibility-check", base).href);
  result.initial = await page.evaluate(async () => {
    const { GameRenderer } = await import("./renderer.js"),
      renderer = new GameRenderer(document.getElementById("probe"));
    await renderer.init();
    renderer.setMenuMode(true);
    const controls = [];
    window.probeClicks = [];
    for (let index = 0; index < 3; index++) {
      const control = new renderer.layers.ui.constructor({ label: `probe-${index}` }),
        fill = new renderer._background.constructor(renderer._background.texture);
      control.accessible = true;
      control.accessibleTitle = control.accessibleHint = `Accessible control ${index + 1}`;
      control.accessibleType = "button";
      control.eventMode = "static";
      control.position.set(80 + index * 320, 140);
      control.hitArea = renderer.app.renderer.screen.clone();
      Object.assign(control.hitArea, { x: 0, y: 0, width: 240, height: 100 });
      fill.width = 240;
      fill.height = 100;
      fill.tint = [0xe04848, 0x48c068, 0x4868e0][index];
      control.addChild(fill);
      control.on("pointertap", () => window.probeClicks.push(index + 1));
      renderer.layers.ui.addChild(control);
      controls.push(control);
    }
    window.probe = { renderer, controls };
    renderer.render(null);
    const gpu = renderer.app.renderer,
      digest = () => {
        const gl = gpu.gl,
          pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(
          0,
          0,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        return pixels.reduce((hash, value) => Math.imul(hash ^ value, 16777619) >>> 0, 2166136261);
      };
    // A raw Pixi screen pass still leaves its flag describing the intermediate
    // texture. Compare its real screen pixels with the corrected host pass.
    renderer.app.render();
    const raw = {
      renderingToScreen: gpu.renderingToScreen,
      physicalRoot: gpu.renderTarget.renderTarget.isRoot,
      digest: digest(),
    };
    renderer.render(null);
    return {
      raw,
      fixed: {
        renderingToScreen: gpu.renderingToScreen,
        physicalRoot: gpu.renderTarget.renderTarget.isRoot,
        digest: digest(),
      },
      backBuffer: gpu.backBuffer.useBackBuffer,
      metrics: renderer.metrics(),
    };
  });
  assert.equal(result.initial.backBuffer, true);
  assert.equal(result.initial.fixed.renderingToScreen, true);
  assert.equal(result.initial.fixed.physicalRoot, true);
  assert.equal(
    result.initial.fixed.digest,
    result.initial.raw.digest,
    "Accessibility synchronization cannot alter rendered pixels",
  );
  const controls = page.getByRole("button", { name: /^Accessible control/ });
  assert.equal(await controls.count(), 3);
  await controls.nth(0).focus();
  await page.keyboard.press("Enter");
  await controls.nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.probeClicks), [1, 2]);
  result.offscreen = await page.evaluate(() => {
    const { renderer } = window.probe,
      gpu = renderer.app.renderer,
      scratch = new renderer.layers.ui.constructor({ label: "offscreen" });
    scratch.accessible = true;
    scratch.accessibleTitle = scratch.accessibleHint = "Offscreen must not become a control";
    scratch.accessibleType = "button";
    scratch.eventMode = "static";
    scratch.hitArea = gpu.screen.clone();
    const texture = gpu.generateTexture({ target: renderer.app.stage });
    gpu.render({ container: scratch, target: texture, clear: false });
    const state = {
      renderingToScreen: gpu.renderingToScreen,
      physicalRoot: gpu.renderTarget.renderTarget.isRoot,
      labels: [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
    };
    renderer.render(null);
    scratch.destroy();
    texture.destroy(true);
    return state;
  });
  assert.equal(result.offscreen.renderingToScreen, false);
  assert.equal(result.offscreen.physicalRoot, false);
  assert.equal(result.offscreen.labels.length, 3);
  assert.ok(result.offscreen.labels.every((label) => label.startsWith("Accessible control")));
  await page.evaluate(() => {
    const { renderer, controls } = window.probe;
    controls[1].visible = false;
    renderer.render(null);
  });
  assert.equal(await controls.count(), 2, "Hidden controls must lose their DOM overlay");
  for (const size of [
    { width: 960, height: 600 },
    { width: 640, height: 480 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => {
      const { renderer, controls } = window.probe;
      controls[1].visible = true;
      renderer.resize();
      for (let n = 0; n < 5; n++) renderer.render(null);
    });
    assert.equal(await controls.count(), 3, "Repeated renders must not duplicate controls");
    const bounds = await controls.evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().toJSON()),
    );
    assert.ok(
      bounds.every(
        (b) =>
          b.width > 0 &&
          b.height > 0 &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.right <= size.width + 1 &&
          b.bottom <= size.height + 1,
      ),
    );
    result.sizes.push({ ...size, bounds });
  }
  result.withoutBackBuffer = await page.evaluate(() => {
    const { renderer } = window.probe;
    const before = renderer.metrics().accessibilityScreenSyncs;
    renderer.app.renderer.backBuffer.useBackBuffer = false;
    renderer.render(null);
    return {
      before,
      after: renderer.metrics().accessibilityScreenSyncs,
      renderingToScreen: renderer.app.renderer.renderingToScreen,
    };
  });
  assert.equal(result.withoutBackBuffer.before, result.withoutBackBuffer.after);
  assert.equal(result.withoutBackBuffer.renderingToScreen, true);
  assert.equal(await controls.count(), 3);
  assert.deepEqual(result.errors, []);
  await page.screenshot({ path: path.join(output, "controls-fixed.png") });
  await writeFile(path.join(output, "browser-check.json"), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      engine,
      controls: 3,
      pixelDigest: result.initial.fixed.digest,
      errors: result.errors,
    }),
  );
} catch (error) {
  result.failure = error.message;
  await writeFile(path.join(output, "failure.json"), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
