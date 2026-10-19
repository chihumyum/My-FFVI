import { clickRegressionControl } from "./browser-assists.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("build/play/acceptance/step-1");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    acceptDownloads: true,
  });
  for (const [mode, url] of [
    ["development", process.env.PLAY_DEV_URL || "http://127.0.0.1:4173/?checkpoint=edgar"],
    ["static", process.env.PLAY_WEB_URL || "http://127.0.0.1:4174/"],
  ]) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator("#bug-report").waitFor({ state: "attached" });
    if (mode === "static") {
      await page.getByRole("button", { name: "新游戏", exact: true }).click();
      await clickRegressionControl(page, "自动推进：关");
      // Let the authored opening reveal the party, using ordinary game input.
      // The player is deliberately hidden during the initial establishing shot.
      await page.waitForFunction(
        () => window.ffvi && window.ffvi.player.visible !== false && !window.ffvi.busy,
        null,
        { timeout: 120_000 },
      );
      await clickRegressionControl(page, "自动推进：开");
    }
    await page
      .locator("#location")
      .filter({ hasText: mode === "development" ? "界面用例" : "·" })
      .waitFor({ state: "attached" });
    await page.waitForLoadState("networkidle");
    let bytes, reportPath;
    if (mode === "development") {
      await page.keyboard.press("F9");
      await page.getByRole("dialog").waitFor();
      await page
        .getByLabel("出了什么问题？", { exact: true })
        .fill("验收：记录当前地图、角色资源和剧情指令位置");
      await page.getByRole("button", { name: "发送报告", exact: true }).click();
      await page.waitForFunction(() =>
        /已保存|保存失败/.test(document.getElementById("bug-status").textContent),
      );
      const status = await page.locator("#bug-status").innerText();
      assert.match(status, /已保存/);
      const directory = status.slice(status.indexOf("已保存") + 3).trim();
      reportPath = path.resolve(directory, "report.json");
      assert.ok(reportPath.startsWith(path.resolve("bug-reports") + path.sep));
      bytes = await readFile(reportPath);
    } else {
      await page.keyboard.press("F9");
      await page.getByRole("dialog").waitFor();
      await page
        .getByLabel("出了什么问题？", { exact: true })
        .fill("验收：静态运行保留完整的问题报告下载");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "发送报告", exact: true }).click(),
      ]);
      reportPath = path.join(output, download.suggestedFilename());
      await download.saveAs(reportPath);
      bytes = await readFile(reportPath);
    }
    const report = JSON.parse(bytes);
    const canvasSize = await page.locator("#screen").evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    assert.equal(report.viewport.width, canvasSize.width);
    assert.equal(report.viewport.height, canvasSize.height);
    assert.equal(report.schema, "ffvi-bug-report");
    assert.equal(report.version, 1);
    assert.equal(typeof report.map.id, "number");
    assert.equal(typeof report.player.x, "number");
    assert.ok(report.script.lastInstruction?.script);
    assert.ok(report.party.length > 0);
    assert.ok(report.actors.some((actor) => actor.drawn && actor.resource));
    assert.ok(report.events.length > 0 && report.events.length <= 20);
    const png = Buffer.from(report.screenshot.dataURL.split(",")[1], "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), report.viewport.width);
    assert.equal(png.readUInt32BE(20), report.viewport.height);
    assert.deepEqual(errors, []);
    await writeFile(path.join(output, `${mode}-captured.png`), png);
    await page.screenshot({ path: path.join(output, `${mode}-browser.png`) });
    results.push({
      mode,
      url,
      reportPath,
      map: report.map,
      script: report.script.lastInstruction,
      actors: report.actors.length,
      drawn: report.actors.filter((actor) => actor.drawn).length,
      events: report.events.length,
      screenshotBytes: png.length,
      errors,
    });
    await page.close();
  }
  await writeFile(path.join(output, "bug-report-check.json"), JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(results.map(({ mode, map, drawn, events }) => ({ mode, map, drawn, events }))),
  );
} finally {
  await browser.close();
}
