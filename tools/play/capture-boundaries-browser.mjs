import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";
import { inspectFramePixels } from "./check-frame-pixels.mjs";

const directory = path.resolve(
    process.env.PLAY_BOUNDARY_DIR || "build/play/acceptance/step-4/boundaries",
  ),
  output = path.resolve(
    process.env.PLAY_SCREENSHOT_DIR || "build/play/acceptance/step-4/screenshots",
  ),
  engine = process.env.PLAY_BROWSER || "chromium",
  manifest = JSON.parse(
    await readFile(path.join(directory, process.env.PLAY_FRAME_MANIFEST || "manifest.json")),
  ),
  mapEvents = JSON.parse(await readFile(path.join(directory, "manifest.json"))).entries.filter(
    (entry) => entry.kind === "map",
  ),
  range = (process.env.PLAY_FRAME_RANGE || "1:999999").split(":").map(Number),
  maps = process.env.PLAY_FRAME_MAPS?.split(",").map(Number),
  browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
await mkdir(output, { recursive: true });
const results = [],
  pixels = new Map();
let context, page, errors, harnessError;
const selected = manifest.entries.filter(
  (row) =>
    row.sequence >= range[0] && row.sequence <= range[1] && (!maps || maps.includes(row.mapId)),
);
async function open() {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  errors = [];
  page.on("pageerror", (error) => errors.push({ message: error.message, stack: error.stack }));
  await page.goto(process.env.PLAY_WEB_URL || "http://127.0.0.1:4181/?acceptance=1");
  await page.waitForFunction(() => !!window.ffviAcceptance);
}
try {
  await open();
  for (const entry of selected) {
    const name = entry.file.replace(/\.json$/, ""),
      result = { ...entry, screenshot: `${name}.png`, engine, staticURL: page.url() };
    try {
      const checkpoint = JSON.parse(await readFile(path.join(directory, entry.file)));
      checkpoint.mapEvents = mapEvents.filter((event) => event.sequence <= entry.sequence);
      const startErrors = errors.length,
        rendered = await page.evaluate(
          (checkpoint) => window.ffviAcceptance.load(checkpoint),
          checkpoint,
        );
      assert.equal(rendered.state.time, entry.time, "Frozen screenshot must not advance game time");
      assert.equal(rendered.state.map.id, entry.mapId);
      assert.equal(
        rendered.renderedFrame.mapId,
        entry.mapId,
        "The GPU must draw the requested map",
      );
      assert.equal(
        rendered.renderedFrame.time,
        entry.time,
        "The GPU must draw the frozen game time",
      );
      if (rendered.renderedFrame.inBattle) {
        assert.equal(
          rendered.renderedFrame.fieldFadeAlpha,
          0,
          "A field fade cannot black out combat",
        );
        if (entry.dialogue)
          assert.equal(
            rendered.ui.panels.battle.hidden,
            true,
            "Dialogue must not be covered by the battle HUD",
          );
      }
      assert.equal(
        rendered.metrics.texturesLoading,
        0,
        "All requested atlas pages must settle before capture",
      );
      assert.equal(
        rendered.metrics.texturesFailed,
        0,
        "No requested source texture may fail to load",
      );
      for (const actor of rendered.state.actors) {
        const segments = [...(actor.segments || [])].sort((a, b) => a.top - b.top);
        for (const [i, segment] of segments.entries()) {
          assert.ok(segment.height > 0, "A visible sprite segment must contain pixels");
          assert.equal(
            segment.top,
            i ? segments[i - 1].top + segments[i - 1].height : 0,
            "Head/body crops must have no gaps or overlap",
          );
        }
      }
      const missing = rendered.state.actors.filter(
        (actor) => actor.drawn && actor.resource && !pixels.has(actor.resource),
      );
      for (const row of await inspectFramePixels(page, missing)) pixels.set(row.resource, row);
      result.pixelIssues = rendered.state.actors
        .filter((actor) => actor.drawn && pixels.get(actor.resource)?.issue)
        .map((actor) => ({ actor, pixels: pixels.get(actor.resource) }));
      result.errors = errors.slice(startErrors);
      result.actors = rendered.state.actors;
      result.tasks = rendered.state.script.tasks;
      result.metrics = rendered.metrics;
      result.diagnostics = await page.evaluate(() => window.ffviRenderDiagnostics());
      result.ui = rendered.ui;
      result.renderedFrame = rendered.renderedFrame;
      await page.locator("#screen").screenshot({ path: path.join(output, result.screenshot) });
      result.completed = true;
    } catch (error) {
      result.completed = false;
      result.error = error.stack;
      result.errors = [...errors];
      console.error(entry.sequence, error.message);
      await open();
    }
    results.push(result);
    await writeFile(path.join(output, `${name}.json`), JSON.stringify(result, null, 2));
    if (entry.sequence % 25 === 0)
      console.log(
        `${entry.sequence} (${results.length}/${selected.length}) ${entry.kind} map${entry.mapId} ${entry.script}`,
      );
    if (results.length % 200 === 0) await open();
  }
} catch (error) {
  harnessError = { message: error.message, stack: error.stack, browserErrors: errors || [] };
  console.error(JSON.stringify(harnessError));
} finally {
  await browser.close();
  const summary = {
    engine,
    source: directory,
    selection: { range, maps },
    scope:
      "Real static-package WebGL and game UI, frozen diagnostic checkpoints; no original-game screenshot comparison. Zero-alpha source textures are independent pending issues; scene composition requires contact-sheet review.",
    captured: results.filter((row) => row.completed).length,
    failed: results.filter((row) => !row.completed).length,
    requested: selected.length,
    unattempted: selected.length - results.length,
    harnessError,
    pageErrors: results.filter((row) => row.errors?.length).length,
    entries: results.map(
      ({
        sequence,
        screenshot,
        completed,
        error,
        pixelIssues,
        kind,
        mapId,
        script,
        encounterId,
      }) => ({
        sequence,
        screenshot,
        completed,
        error,
        pixelIssues,
        kind,
        mapId,
        script,
        encounterId,
      }),
    ),
  };
  await writeFile(
    path.join(output, `summary-${range.join("-")}.json`),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(
    path.join(output, `selected-texture-pixels-${range.join("-")}.json`),
    JSON.stringify([...pixels.values()], null, 2),
  );
  console.log(
    JSON.stringify({
      engine,
      captured: summary.captured,
      failed: summary.failed,
      pageErrors: summary.pageErrors,
    }),
  );
  if (
    summary.failed ||
    summary.pageErrors ||
    summary.unattempted ||
    harnessError ||
    !selected.length
  )
    process.exitCode = 1;
}
