import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("build/play/acceptance/step-2");
await mkdir(output, { recursive: true });
const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4174/";
const index = JSON.parse(
  await readFile(path.join(process.env.PLAY_STATIC_DIR || "dist/web", "data/index.json")),
);
const entry = Object.entries(index.assets.images).find(
  ([url]) => url.includes("/mo_ff6_v006_c00_") && /Default/i.test(url),
);
assert.ok(entry, "The source Magitek field sprite must exist in the real static index");
const pageFile = entry[1].file;
const browser = await chromium.launch({
  headless: true,
  args: process.platform === "darwin" ? ["--use-angle=metal"] : [],
});
try {
  // Deliberately fail a real required atlas page. This isolated network-fault
  // check is not counted as a missing game asset or as story coverage.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`**/${pageFile}`, (route) =>
    route.fulfill({ status: 404, body: "Deliberate acceptance fault" }),
  );
  await page.goto(new URL("?acceptance=1", base).href);
  try {
    await page.getByRole("button", { name: "新游戏", exact: true }).click();
  } catch (error) {
    await page.screenshot({ path: path.join(output, "diagnostic-startup-failure.png") });
    await writeFile(
      path.join(output, "diagnostic-startup-failure.json"),
      JSON.stringify(
        {
          errors,
          text: await page.locator("body").innerText(),
          issues: await page.evaluate(() => window.ffviRenderDiagnostics?.()),
          pageFile,
          error: error.message,
        },
        null,
        2,
      ),
    );
    throw error;
  }
  await page.getByRole("button", { name: "自动推进：关", exact: true }).click();
  await page.waitForFunction(
    () => window.ffviRenderDiagnostics?.().some((r) => r.category === "texture-load-failed"),
    null,
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "自动推进：开", exact: true }).click();
  const issues = await page.evaluate(() => window.ffviRenderDiagnostics());
  const failures = issues.filter((r) => r.category === "texture-load-failed");
  assert.ok(failures.length);
  assert.ok(
    failures.every(
      (r) =>
        typeof r.mapId === "number" &&
        r.mapName &&
        r.script &&
        Number.isInteger(r.instructionIndex) &&
        r.entityId != null &&
        r.resource &&
        r.animation,
    ),
  );
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "required-atlas-fault.png") });
  await writeFile(
    path.join(output, "diagnostic-browser-check.json"),
    JSON.stringify(
      {
        purpose:
          "Isolated deliberate HTTP 404: verifies required atlas failures are reported and do not crash rendering; excluded from real-game issue counts",
        pageFile,
        failures,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ pageFile, failures: failures.length, errors }));
  await context.close();
} finally {
  await browser.close();
}
