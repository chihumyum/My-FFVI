import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4203/";
const output = path.resolve(
  process.env.PLAY_COMPAT_REPORT_DIR || "build/play/acceptance/step-7/browsers",
);
const boosted = process.env.PLAY_COMPAT_BOOST === "1";
await mkdir(output, { recursive: true });
const results = [];
async function clickPagedSaveButton(page, label) {
  for (let pass = 0; pass < 12; pass++) {
    const target = page.getByRole("button", { name: label, exact: true });
    if (await target.count()) {
      await target.click();
      return;
    }
    const next = page.getByRole("button", { name: "↓ 下页", exact: true });
    if (!(await next.count()) || !(await next.isEnabled())) break;
    await next.click();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  throw Error(`Cannot reach save control through actual menu paging: ${label}`);
}
for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
  assert.ok(["chromium", "webkit"].includes(engine));
  const folder = path.join(output, engine);
  await mkdir(folder, { recursive: true });
  const result = {
    engine,
    base,
    mode: boosted ? "explicit boosted story-test" : "ordinary attributes",
    scope:
      "Fresh empty browser storage; actual title/New Game, existing automatic regression controls, IndexedDB save/load and Web Audio lab UI on a generic static server. No injected game state, flag writes, synthetic victory or native Safari/Chrome claim. Existing auto-walk explicitly preloads scripts; this is not a manual lazy-loading measurement.",
    errors: [],
    failedResponses: [],
    progress: [],
    status: "running",
  };
  let browser, page;
  try {
    browser = await { chromium, webkit }[engine].launch({
      headless: true,
      args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      ignoreHTTPSErrors: process.env.PLAY_HOST_LOCAL_TLS === "1",
    });
    if (process.env.PLAY_HOST_PASSWORD_FILE) {
      const password = (await readFile(process.env.PLAY_HOST_PASSWORD_FILE, "utf8"))
        .trim()
        .split(/\r?\n/)
        .at(-1);
      const response = await context.request.post(new URL("/api/session", base).href, {
        headers: { Origin: new URL(base).origin },
        data: { password },
      });
      assert.equal(response.status(), 200, "Private host login failed");
    }
    page = await context.newPage();
    page.on("pageerror", (error) => {
      result.errors.push(error.stack || error.message);
      console.error(engine, "browser error", error.message);
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        result.failedResponses.push({ url: response.url(), status: response.status() });
    });
    await page.goto(new URL("?through=M1", base).href);
    await page.getByRole("button", { name: "新游戏", exact: true }).waitFor();
    await page.screenshot({ path: path.join(folder, "title.png") });
    await page
      .getByRole("button", {
        name: boosted ? "剧情测试（强化队伍）" : "新游戏",
        exact: true,
      })
      .click();
    await page.waitForFunction(() => window.ffvi && !window.ffvi.loading);
    assert.equal(await page.evaluate(() => !!window.ffvi.testBoost), boosted);
    await page.getByRole("button", { name: "自动行走：关", exact: true }).click();
    const deadline = Date.now() + 480_000;
    let finished = false;
    while (Date.now() < deadline) {
      try {
        await page.waitForFunction(
          () =>
            window.ffvi.over ||
            (window.ffvi.mapId === 1 &&
              !window.ffvi.busy &&
              document.getElementById("walk").textContent.includes("关")),
          null,
          { timeout: 15_000 },
        );
        finished = true;
      } catch (error) {
        if (error.name !== "TimeoutError") throw error;
      }
      const state = await page.evaluate(() => ({
        time: window.ffvi.time,
        map: window.ffvi.mapId,
        over: window.ffvi.over,
        busy: window.ffvi.busy,
        script: window.ffvi.lastInstruction,
        walk: document.getElementById("walk").textContent,
        location: document.getElementById("location").textContent,
      }));
      result.progress.push(state);
      console.log(engine, JSON.stringify(state));
      assert.deepEqual(result.errors, [], "The actual browser raised a runtime exception");
      if (finished) break;
    }
    assert.ok(finished, "The actual browser did not reach the M1 exit before the wall limit");
    assert.equal(await page.evaluate(() => !!window.ffvi.over), false);
    assert.equal(await page.evaluate(() => window.ffvi.mapId), 1);
    await page.screenshot({ path: path.join(folder, "left-narshe.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "存档", exact: true }).click();
    // The optional host synchronizes asynchronously before populating this menu.
    await page
      .getByRole("button", { name: /^(写入|覆盖)存档 \d+$/ })
      .first()
      .waitFor();
    const used = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("ffvi-pr-saves", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction("slots").objectStore("slots").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return rows
        .filter(
          (row) =>
            row.mode === (window.ffvi.testBoost ? "story-test" : "normal") &&
            Number.isInteger(row.slot),
        )
        .map((row) => row.slot);
    });
    const saveSlot = Array.from({ length: 12 }, (_, i) => i + 1).find(
      (slot) => !used.includes(slot),
    );
    assert.ok(
      saveSlot <= 12,
      "No empty save slot; acceptance must not overwrite existing player saves",
    );
    await clickPagedSaveButton(page, `写入存档 ${saveSlot}`);
    // Game menus are Pixi widgets, not document nodes. The changed slot label
    // confirms the UI's completed write; inspect the actual IDB record below.
    await page.getByRole("button", { name: `覆盖存档 ${saveSlot}`, exact: true }).waitFor();
    const saved = await page.evaluate(async (saveSlot) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("ffvi-pr-saves", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise((resolve, reject) => {
        const request = db
          .transaction("slots", "readonly")
          .objectStore("slots")
          .get(`${window.ffvi.testBoost ? "story-test" : "normal"}:${saveSlot}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return record.snapshot;
    }, saveSlot);
    assert.equal(saved.mapId, 1);
    assert.equal(!!saved.testBoost, boosted);
    await writeFile(path.join(folder, "actual-save.json"), JSON.stringify(saved) + "\n");
    await page.screenshot({ path: path.join(folder, "saved.png") });
    await page.reload();
    await page
      .getByRole("button", { name: boosted ? "继续剧情测试" : "继续游戏", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^读取存档 \d+$/ })
      .first()
      .waitFor();
    await clickPagedSaveButton(page, `读取存档 ${saveSlot}`);
    await page.waitForFunction(() => window.ffvi?.mapId === 1 && !window.ffvi.loading);
    const restored = await page.evaluate(() => window.ffvi.snapshot());
    await writeFile(path.join(folder, "restored-save.json"), JSON.stringify(restored) + "\n");
    for (const key of ["mapId", "player", "partySlots", "inventory", "gil"])
      assert.deepEqual(restored[key], saved[key], `Save round trip changed ${key}`);
    const plotBanks = Object.keys(saved.banks).filter((key) =>
      /^(ScenarioFlag|ScenarioVariable)/.test(key),
    );
    assert.ok(plotBanks.length > 0, "The actual save must contain source plot banks");
    for (const key of plotBanks)
      assert.deepEqual(restored.banks[key], saved.banks[key], `Save round trip changed ${key}`);
    assert.deepEqual(restored.completedStoryObjectives, saved.completedStoryObjectives);
    result.story = {
      start: "fresh-new-game",
      endMap: restored.mapId,
      visited: saved.visited,
      battles: saved.battles.length,
      time: saved.time,
      over: false,
      saveSlot,
      readAfterPageReload: true,
      savedPlotBanks: plotBanks,
    };
    result.renderer = await page.evaluate(() => window.ffviRenderMetrics());
    await page.screenshot({ path: path.join(folder, "loaded.png") });
    await page.goto(new URL("audio-lab.html", base).href);
    await page.locator("#examples tr").nth(9).waitFor();
    await page.locator("#test").click();
    await page.waitForFunction(() => !document.getElementById("test").disabled, null, {
      timeout: 180_000,
    });
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#download").click();
    const download = await downloadPromise;
    await download.saveAs(path.join(folder, "audio.json"));
    result.audio = JSON.parse(await readFile(path.join(folder, "audio.json")));
    assert.equal(result.audio.passed, true);
    assert.equal(result.audio.tracks.length, 10);
    assert.ok(result.audio.tracks.every((row) => row.codec === "opus" && row.sampleRate === 48000));
    await page.locator("#play").click();
    await page.waitForFunction(() => {
      const state = JSON.parse(document.getElementById("status").textContent);
      return (
        state.context === "running" &&
        String(state.currentId) === document.getElementById("tracks").value &&
        state.position > 0.05
      );
    });
    result.realTimeAudio = JSON.parse(await page.locator("#status").textContent());
    await page.locator("#pause").click();
    await page.waitForFunction(() => {
      const state = JSON.parse(document.getElementById("status").textContent);
      return state.currentId === null && state.pausedMusic;
    });
    await page.locator("#resume").click();
    await page.waitForFunction(() => {
      const state = JSON.parse(document.getElementById("status").textContent);
      return state.context === "running" && state.currentId !== null;
    });
    await page.screenshot({ path: path.join(folder, "audio.png") });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.failedResponses, []);
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.failure = { message: error.message, stack: error.stack };
    result.diagnostics = await page
      ?.evaluate(() => ({
        render: window.ffviRenderMetrics?.(),
        issues: window.ffviRenderDiagnostics?.(),
        loading: window.ffvi?.loading,
      }))
      .catch(() => null);
    const saved = await page?.evaluate(() => window.ffvi?.snapshot()).catch(() => null);
    if (saved) await writeFile(path.join(folder, "failure-save.json"), JSON.stringify(saved));
    await page?.screenshot({ path: path.join(folder, "failure.png") }).catch(() => {});
  } finally {
    await browser?.close();
    await writeFile(path.join(folder, "report.json"), JSON.stringify(result, null, 2) + "\n");
    results.push(result);
  }
}
await writeFile(path.join(output, "summary.json"), JSON.stringify(results, null, 2) + "\n");
console.log(
  JSON.stringify(results.map(({ engine, status, failure }) => ({ engine, status, failure }))),
);
if (results.some((row) => row.status !== "passed")) process.exitCode = 1;
