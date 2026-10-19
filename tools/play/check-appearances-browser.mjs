import { clickRegressionControl } from "./browser-assists.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";
import { loadAppearanceAudit } from "./audit-appearances.mjs";
import { inspectFramePixels } from "./check-frame-pixels.mjs";

const engine = process.env.PLAY_BROWSER || "chromium",
  output = path.resolve(
    process.env.PLAY_APPEARANCE_SCREENSHOTS || `build/play/acceptance/step-3/browser-${engine}`,
  ),
  saves = path.resolve(
    process.env.PLAY_CHECKPOINT_DIR || "build/play/acceptance/step-3/checkpoints",
  ),
  names = (
    process.env.PLAY_APPEARANCE_CASES ||
    "edgar,choose-locke,merchant-passage,soldier-clothes,camp-clear,befriend-gau,zozo-terra,kefka-tower"
  ).split(","),
  oracle = await loadAppearanceAudit(),
  browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const name of names) {
    const saved = JSON.parse(await readFile(path.join(saves, `${name}.json`))),
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript(
      (saved) => localStorage.setItem("ffvi-play-test", JSON.stringify(saved)),
      saved,
    );
    await page.goto(process.env.PLAY_WEB_URL || "http://127.0.0.1:4178/");
    await clickRegressionControl(page, "继续剧情测试");
    await page.getByRole("button", { name: "自动存档 / 最近继续", exact: true }).click();
    await page.waitForFunction(
      (id) => window.ffvi?.mapId === id && !window.ffvi.loading,
      saved.mapId,
    );
    await page.waitForLoadState("networkidle");
    // Ordinary Continue uses the shipped save path. No plot flags, sprite
    // identities, renderer results or current tasks are injected by this test.
    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("F9");
    const download = await downloadPromise,
      file = path.join(output, `${name}-f9.json`);
    await download.saveAs(file);
    const report = JSON.parse(await readFile(file));
    oracle.reset();
    const state = await page.evaluate(() => window.ffvi.snapshot()),
      audit = oracle.compareRendered(report.actors, state),
      drawn = report.actors.filter((actor) => actor.drawn && actor.resource).length;
    const pixels = await inspectFramePixels(page, report.actors);
    assert.deepEqual(errors, []);
    assert.ok(drawn > 0, `${name} must draw actual sprite textures`);
    await writeFile(
      path.join(output, `${name}.png`),
      Buffer.from(report.screenshot.dataURL.split(",")[1], "base64"),
    );
    results.push({
      name,
      sourceSave: path.join(saves, `${name}.json`),
      map: report.map,
      drawn,
      summary: audit.summary,
      nonSpriteFrames: audit.nonSpriteFrames,
      selectedTexturePixels: pixels,
      pixelIssues: pixels.filter((row) => row.issue || row.error),
      mismatches: audit.mismatches,
      unknown: audit.unknown,
      errors,
      screenshot: `${name}.png`,
      report: `${name}-f9.json`,
    });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(
      {
        engine,
        scope:
          "Real browser static-package Continue + F9 render selection; scene composition still requires visual review.",
        results,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results.map(({ name, summary, drawn }) => ({ name, summary, drawn }))));
if (results.some((row) => row.summary.mismatches)) process.exitCode = 1;
