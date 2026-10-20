import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.AKTO_URL || "http://127.0.0.1:4175/akto.html";
const output = path.resolve("build/play/deployment/akto-art-test/browser");
await mkdir(output, { recursive: true });
const results = [];
for (const engine of ["chromium", "webkit"]) {
  const result = {
    engine,
    mode: "original authored art trial; ordinary input, no battle boost",
    status: "running",
    errors: [],
    failures: [],
    checks: [],
  };
  results.push(result);
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" ? ["--use-angle=metal"] : [],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => result.errors.push(error.stack || error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      result.failures.push({ url: response.url(), status: response.status() });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(base).origin)
      result.failures.push({ url: request.url(), reason: "Unexpected external request" });
  });
  async function walk(key, condition, timeout = 9000) {
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(condition, null, { timeout, polling: 20 });
    } finally {
      await page.keyboard.up(key);
    }
  }
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.akto && document.getElementById("loading").hidden);
    await page.waitForFunction(() =>
      akto.renderer.frameActors.some((row) => row.entityId === -1001 && row.drawn),
    );
    await page.screenshot({ path: path.join(output, `${engine}-arrival.png`), fullPage: true });
    await page.locator("#overview").screenshot({ path: path.join(output, `${engine}-map.png`) });
    const overview = await page
      .locator("#overview")
      .evaluate((canvas) => canvas.toDataURL("image/png"));
    await writeFile(
      path.join(output, `${engine}-map-native.png`),
      Buffer.from(overview.split(",")[1], "base64"),
    );
    result.checks.push(
      "Fresh town entry; original player and independently generated map modules render",
    );
    await walk("ArrowUp", () => akto.game.player.y <= 41);
    await walk("ArrowLeft", () => akto.game.player.x <= 30);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => akto.game.dialogue?.key === "traveller");
    await page.screenshot({ path: path.join(output, `${engine}-traveller.png`) });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !akto.game.busy);
    await walk("ArrowRight", () => akto.game.player.x >= 32);
    await walk("ArrowUp", () => akto.game.dialogue?.key === "halt");
    const halted = await page.evaluate(() => ({
      player: { ...akto.game.player },
      guards: [101, 102].map((id) => ({ ...akto.game.actor(id) })),
      busy: akto.game.busy,
    }));
    assert.equal(halted.player.y, 27);
    assert.equal(halted.busy, true);
    assert.equal(halted.guards[0].x, 31);
    assert.equal(halted.guards[1].x, 33);
    assert.ok(halted.guards.every((guard) => guard.y === 26 && !guard.motion));
    await page.screenshot({ path: path.join(output, `${engine}-halt.png`) });
    await page.locator("#game").screenshot({ path: path.join(output, `${engine}-halt-game.png`) });
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.evaluate(() => akto.game.player.y),
      27,
      "The player must stay put during guard dialogue",
    );
    for (const next of ["pass", "return", null]) {
      await page.getByRole("button", { name: /确认继续/ }).click();
      await page.waitForFunction(
        (key) => (key ? akto.game.dialogue?.key === key : !akto.game.busy),
        next,
      );
    }
    assert.equal(await page.evaluate(() => akto.game.banks.AktoStory[0]), 1);
    result.checks.push(
      "Touch event: both sentries approach; three authored VM messages block input and return control",
    );
    await walk("ArrowUp", () => akto.game.player.y <= 25);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowUp");
    assert.equal(
      await page.evaluate(() => akto.game.player.y),
      25,
      "Closed gate collision must remain closed after dialogue",
    );
    result.checks.push("Closed city gate remains impassable after the scene");
    await walk("ArrowDown", () => akto.game.player.y >= 35);
    await walk("ArrowRight", () => akto.game.player.x >= 35);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowRight");
    assert.equal(
      await page.evaluate(() => akto.game.player.x),
      35,
      "The bridge rail and moat must prevent walking into water",
    );
    result.checks.push("Bridge edge / moat collision; return movement works after the event");
    await page.getByRole("button", { name: "区域地图", exact: true }).click();
    await page.waitForFunction(() => akto.game.mapId === 9101 && !akto.game.busy);
    await page.waitForFunction(
      () =>
        akto.game.time >= akto.game.fade.start + akto.game.fade.duration &&
        document.getElementById("overview").dataset.mapId === "9101",
    );
    await page.screenshot({ path: path.join(output, `${engine}-region.png`) });
    await walk("ArrowUp", () => akto.game.mapId === 9100);
    await page.waitForFunction(() => !akto.game.busy && akto.game.player.y === 53);
    result.checks.push(
      "New world-map city icon is placed as map tiles; walking to it enters the town",
    );
    await page.getByRole("button", { name: "重新入城", exact: true }).click();
    await page.waitForFunction(() => !akto.game.busy && !akto.game.banks.AktoStory);
    const isolation = await page.evaluate(async () => ({
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
      databases: indexedDB.databases ? await indexedDB.databases() : null,
      warnings: akto.game.warnings,
    }));
    assert.equal(isolation.localStorage, 0);
    assert.equal(isolation.sessionStorage, 0);
    if (isolation.databases) assert.deepEqual(isolation.databases, []);
    assert.deepEqual(await context.cookies(), []);
    assert.deepEqual(isolation.warnings, []);
    result.checks.push(
      "Restart uses a fresh trial state; no cookies, account requests, local/session storage or save databases",
    );
    result.halted = halted;
    result.isolation = isolation;
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.failures, []);
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.error = error.stack;
    await page
      .screenshot({ path: path.join(output, `${engine}-failure.png`), fullPage: true })
      .catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
  console.log(
    JSON.stringify({ engine, status: result.status, checks: result.checks, error: result.error }),
  );
}
await writeFile(path.join(output, "report.json"), JSON.stringify({ base, results }, null, 2));
