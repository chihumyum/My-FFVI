import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, access, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, preview } from "vite";
import { chromium, webkit } from "playwright";
import { pixelDifference } from "./pixel-difference.mjs";

const project = path.resolve(import.meta.dirname, "../..");

export async function visualRegression({
  reportFile = "build/play/acceptance/step-5/current/report.json",
  dataRoot = "build/web-data",
  staticRoot,
  boundaryDirectory,
  negativeControl = false,
} = {}) {
  const config = JSON.parse(await readFile(path.join(import.meta.dirname, "visual-scenes.json"))),
    directory = path.resolve(project, boundaryDirectory || config.boundaryDirectory),
    references = path.resolve(project, config.referenceDirectory),
    output = path.dirname(path.resolve(reportFile)),
    baselineFile = path.join(references, "manifest.json");
  await mkdir(output, { recursive: true });
  const baselineExists = await access(baselineFile).then(
    () => true,
    (error) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    },
  );
  if (!baselineExists) {
    const report = {
      status: "not-run",
      reason: "Local reviewed PNG references are absent",
      baselineFile,
      checkpointDirectory: directory,
      stateSource: boundaryDirectory
        ? "current fresh boosted story regression"
        : "fixed reviewed renderer fixtures",
    };
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    return report;
  }
  const baseline = JSON.parse(await readFile(baselineFile));
  assert.deepEqual(
    baseline.limits,
    config.limits,
    "Changing limits requires explicit reference review",
  );
  assert.deepEqual(
    baseline.scenes.map((row) => row.sequence),
    config.scenes.map((row) => row.sequence),
  );
  await mkdir(path.join(project, "dist"), { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"))),
    mapEvents = manifest.entries.filter((row) => row.kind === "map"),
    engine = process.env.PLAY_BROWSER || "chromium",
    webRoot = staticRoot
      ? path.resolve(staticRoot)
      : await mkdtemp(path.join(project, "dist/visual-regression-"));
  let server, browser;
  const results = [],
    report = {
      status: "running",
      engine,
      limits: config.limits,
      baselineFile,
      checkpointDirectory: directory,
      stateSource: boundaryDirectory
        ? "current fresh boosted story regression"
        : "fixed reviewed renderer fixtures",
      scope:
        "Reviewed frozen static-package screenshots. No story-state advancement or original-game parity claim.",
      negativeControl,
      results,
    };
  try {
    if (!staticRoot)
      await build({
        configFile: path.join(project, "vite.config.mjs"),
        publicDir: path.resolve(dataRoot, "web"),
        build: { outDir: webRoot, emptyOutDir: true },
        logLevel: "error",
      });
    server = await preview({
      configFile: false,
      build: { outDir: webRoot },
      preview: { host: "127.0.0.1", port: 0 },
      logLevel: "error",
    });
    browser = await { chromium, webkit }[engine].launch({
      headless: true,
      args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    const context = await browser.newContext({
        locale: "zh-CN",
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push({ message: error.message, stack: error.stack }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?acceptance=1`);
    await page.waitForFunction(() => !!window.ffviAcceptance);
    // This is our pure comparison function, shared with Node arithmetic tests.
    await page.evaluate(`window.ffviPixelDifference = ${pixelDifference.toString()}`);
    for (const scene of config.scenes) {
      const entry = manifest.entries.find(
        (row) =>
          (boundaryDirectory ? row.referenceSequence : (row.referenceSequence ?? row.sequence)) ===
          scene.sequence,
      );
      assert.ok(
        entry,
        `Missing current-run visual point ${scene.sequence}: ${scene.name}; no old-state fallback is allowed`,
      );
      const checkpoint = JSON.parse(await readFile(path.join(directory, entry.file))),
        startErrors = errors.length;
      checkpoint.mapEvents = mapEvents.filter((row) => row.sequence <= entry.sequence);
      const rendered = await page.evaluate(
        (checkpoint) => window.ffviAcceptance.load(checkpoint),
        checkpoint,
      );
      assert.equal(rendered.renderedFrame.mapId, entry.mapId);
      assert.equal(rendered.renderedFrame.time, entry.time);
      assert.equal(rendered.metrics.texturesLoading, 0);
      assert.equal(rendered.metrics.texturesFailed, 0);
      const mutation = negativeControl && scene.sequence === 283;
      if (mutation) {
        // A separate frozen browser state simulates the real failure class:
        // omit the visible player, without touching source code or story runs.
        assert.equal(await page.evaluate(() => window.ffvi.player.visible), true);
        await page.evaluate(async () => {
          window.ffvi.player.visible = false;
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
      }
      const filename = `${String(scene.sequence).padStart(5, "0")}.png`,
        actual = await page.locator("#screen").screenshot({ path: path.join(output, filename) }),
        expected = await readFile(path.join(references, filename));
      const compared = await page.evaluate(
        async ({ actual, expected, limits }) => {
          async function decode(base64) {
            const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
              bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" })),
              canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            return {
              canvas,
              context,
              pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
            };
          }
          const a = await decode(expected),
            b = await decode(actual);
          if (a.canvas.width !== b.canvas.width || a.canvas.height !== b.canvas.height)
            return {
              passed: false,
              reason: "Screenshot dimensions changed; no implicit scaling is allowed",
              expectedSize: [a.canvas.width, a.canvas.height],
              actualSize: [b.canvas.width, b.canvas.height],
            };
          const result = window.ffviPixelDifference(
            a.pixels,
            b.pixels,
            a.canvas.width,
            a.canvas.height,
            limits,
          );
          a.context.putImageData(
            new ImageData(result.difference, a.canvas.width, a.canvas.height),
            0,
            0,
          );
          const { difference, ...metrics } = result;
          return { ...metrics, diffPNG: a.canvas.toDataURL("image/png").split(",")[1] };
        },
        {
          actual: actual.toString("base64"),
          expected: expected.toString("base64"),
          limits: config.limits,
        },
      );
      const { diffPNG, ...metrics } = compared;
      if (metrics.differentPixels)
        await writeFile(
          path.join(output, filename.replace(".png", "-diff.png")),
          Buffer.from(diffPNG, "base64"),
        );
      const layout = await page.evaluate(() => ({
        viewport: [innerWidth, innerHeight],
        mainWidth: document.querySelector("main").clientWidth,
        modernMenu: document.body.classList.contains("modern-menu"),
      }));
      results.push({
        ...scene,
        ...metrics,
        layout,
        renderer: {
          logicalWidth: rendered.metrics.logicalWidth,
          logicalHeight: rendered.metrics.logicalHeight,
          displayScale: rendered.metrics.displayScale,
        },
        screenshot: filename,
        browserErrors: errors.slice(startErrors),
        mutation: mutation ? "hide-visible-player" : null,
      });
      assert.deepEqual(errors.slice(startErrors), []);
    }
    const failures = results.filter((row) => !row.passed);
    report.status = negativeControl
      ? failures.length === 1 &&
        failures[0].mutation === "hide-visible-player" &&
        failures[0].differentPixels > config.limits.differentPixels &&
        !failures[0].reason
        ? "negative-control-detected"
        : "failed"
      : failures.length
        ? "failed"
        : "passed";
  } catch (error) {
    report.status = "failed";
    report.error = { message: error.message, stack: error.stack };
  } finally {
    await browser?.close();
    await new Promise((resolve) => (server ? server.httpServer.close(resolve) : resolve()));
    if (!staticRoot) await rm(webRoot, { recursive: true, force: true });
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await visualRegression({
    reportFile: process.env.PLAY_VISUAL_REPORT,
    dataRoot: process.env.PLAY_DATA_DIR,
    staticRoot: process.env.PLAY_STATIC_DIR,
    boundaryDirectory: process.env.PLAY_VISUAL_FRAMES,
    negativeControl: process.argv.includes("--negative-control"),
  });
  console.log(
    JSON.stringify({
      status: report.status,
      scenes: report.results?.length,
      failures: report.results?.filter((row) => !row.passed).length,
    }),
  );
  if (!["passed", "negative-control-detected"].includes(report.status)) process.exitCode = 1;
}
