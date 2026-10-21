import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:8788/";
const output = path.resolve(
  process.env.PLAY_PUBLIC_REPORT || "build/play/deployment/public/browser",
);
await mkdir(output, { recursive: true });
const snapshot = JSON.parse(
  await readFile("build/play/acceptance/step-7/browsers-final-chromium/chromium/actual-save.json"),
);
const seed = {
  format: "ffvi-reweb-saves",
  version: 1,
  records: [
    {
      id: "normal:1",
      mode: "normal",
      slot: 1,
      savedAt: Date.now(),
      time: snapshot.time,
      map: "真实 M1 回归存档",
      party: [],
      snapshot,
    },
  ],
};
const report = {
  base,
  status: "running",
  scope:
    "Disposable random profiles only. Real backup/identity UI, IndexedDB, cross-device load, isolation, offline and stale-tab checks; no reads or writes to the owner's private saves.",
  results: [],
};
for (const engine of process.env.PLAY_BROWSER
  ? [process.env.PLAY_BROWSER]
  : ["chromium", "webkit"]) {
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
  const result = { engine, checks: [], errors: [] };
  report.results.push(result);
  try {
    const options = {
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      // Simulate independent client addresses only on the disposable local host.
      ...(new URL(base).hostname === "127.0.0.1"
        ? {
            extraHTTPHeaders: {
              "CF-Connecting-IP": engine === "chromium" ? "198.18.0.11" : "198.18.0.12",
            },
          }
        : {}),
    };
    const aContext = await browser.newContext(options),
      bContext = await browser.newContext(options);
    const open = async (context) => {
      const page = await context.newPage();
      page.on("dialog", (d) => d.accept());
      page.on("pageerror", (e) => result.errors.push(e.message));
      await page.goto(base);
      await page.locator("#cloud-toggle").waitFor({ timeout: 60000 });
      await page.waitForFunction(
        () => document.getElementById("cloud-toggle").dataset.state === "synced",
      );
      return page;
    };
    const session = (page) =>
      page.evaluate(async () => (await fetch("/api/session", { cache: "no-store" })).json());
    const request = (page, endpoint, method = "GET", input) =>
      page.evaluate(
        async ({ endpoint, method, input }) => {
          const identity = await (await fetch("/api/session")).json();
          const response = await fetch(endpoint, {
            method,
            cache: "no-store",
            headers: { "Content-Type": "application/json", "X-FFVI-Account": identity.serverId },
            ...(input ? { body: JSON.stringify(input) } : {}),
          });
          return { status: response.status, value: await response.json() };
        },
        { endpoint, method, input },
      );
    const panel = async (page) => {
      if (!(await page.locator("#cloud-panel").isVisible()))
        await page.locator("#cloud-toggle").click();
    };
    const uploaded = async (page, minimumRevision = 1) => {
      const identity = await session(page);
      const deadline = Date.now() + 60000;
      // waitForFunction tests Promise truthiness before awaiting its value in
      // the current Playwright runtime. Poll the resolved API result explicitly.
      while (Date.now() < deadline) {
        const complete = await page.evaluate(
          async ({ account, minimumRevision }) => {
            const response = await fetch("/api/saves/normal:1", {
              headers: { "X-FFVI-Account": account },
              cache: "no-store",
            });
            if (response.status === 404) return false;
            const value = await response.json();
            if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
            return value.revision >= minimumRevision;
          },
          { account: identity.serverId, minimumRevision },
        );
        if (complete) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw Error(`Cloud slot did not reach revision ${minimumRevision}`);
    };
    const a = await open(aContext),
      b = await open(bContext);
    const identityA = await session(a),
      identityB = await session(b);
    assert.notEqual(identityA.serverId, identityB.serverId);
    assert.deepEqual((await request(b, "/api/saves")).value.saves, []);
    result.checks.push("fresh browser profiles receive distinct identities and empty cloud slots");
    await panel(a);
    const downloadEvent = a.waitForEvent("download");
    await a.getByRole("button", { name: "备份恢复密钥", exact: true }).click();
    const downloaded = await downloadEvent;
    const credentials = JSON.parse(await readFile(await downloaded.path()));
    assert.match(credentials.recoveryKey, /^ffvi_[a-f0-9]{64}$/);
    // Never copy recovery credentials to screenshots/reports or terminal output.
    await a
      .locator('#cloud-panel input[type="file"]')
      .last()
      .setInputFiles({
        name: "actual-save.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(seed)),
      });
    await a.waitForFunction(() =>
      [...document.querySelectorAll("#cloud-panel [role='status']")].some(
        (node) => node.textContent === "已完成",
      ),
    );
    await a.getByRole("button", { name: "立即同步", exact: true }).click();
    await uploaded(a);
    const firstSave = await request(a, "/api/saves/normal:1");
    assert.equal(firstSave.status, 200, `uploaded slot read: ${firstSave.value.error}`);
    assert.deepEqual(firstSave.value.record.snapshot, snapshot);
    assert.equal((await request(b, "/api/saves/normal:1")).status, 404);
    assert.deepEqual((await request(b, "/api/saves/normal:1/history")).value.versions, []);
    await a.screenshot({ path: path.join(output, `${engine}-identity-panel.png`) });
    result.checks.push(
      "identity backup downloads; actual M1 backup imports/uploads; another identity cannot read its slot/history",
    );
    await panel(b);
    await b
      .locator('#cloud-panel input[type="file"]')
      .first()
      .setInputFiles({
        name: "identity.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(credentials)),
      });
    await b.waitForFunction(
      (expected) =>
        document.getElementById("cloud-toggle")?.dataset.state === "synced" &&
        document.querySelector(".cloud-identity")?.textContent.includes(expected),
      identityA.profileId,
    );
    assert.equal((await session(b)).serverId, identityA.serverId);
    await b.getByRole("button", { name: "继续游戏", exact: true }).click();
    await b.getByRole("button", { name: "读取存档 1", exact: true }).click();
    await b.waitForFunction(() => window.ffvi?.mapId === 1 && !window.ffvi.loading);
    await b.waitForFunction(
      () => {
        const m = window.ffviRenderMetrics();
        return (
          !window.ffviLoading().active &&
          !window.ffvi.busy &&
          m.visibleTiles > 0 &&
          m.visibleActors > 0 &&
          m.texturesLoading === 0
        );
      },
      null,
      { timeout: 60000 },
    );
    assert.equal(await b.evaluate(() => window.ffviRenderMetrics().texturesFailed), 0);
    const loaded = await b.evaluate(() => window.ffvi.snapshot());
    assert.equal(loaded.mapId, snapshot.mapId);
    assert.deepEqual(loaded.partySlots, snapshot.partySlots);
    await b.screenshot({ path: path.join(output, `${engine}-recovered-game.png`) });
    result.checks.push(
      "second device restores downloaded identity and loads the actual saved game",
    );
    // Warm the real save menu before going offline. This tests local save
    // persistence, without requiring uncached menu art to load without a network.
    await b.locator("[data-touch-toggle]").click();
    await b.locator('[data-game-key="Escape"]').click();
    await b.getByRole("button", { name: "存档", exact: true }).click();
    await b.getByRole("button", { name: "覆盖存档 1", exact: true }).waitFor();
    await bContext.setOffline(true);
    await b.getByRole("button", { name: "覆盖存档 1", exact: true }).click();
    await b.waitForTimeout(500);
    const dbs = await b.evaluate(() => indexedDB.databases());
    assert.ok(dbs.some((row) => row.name === `ffvi-pr-saves:${identityA.serverId}`));
    await bContext.setOffline(false);
    await panel(b);
    await b.getByRole("button", { name: "立即同步", exact: true }).click();
    await uploaded(b, 2);
    assert.ok((await request(b, "/api/saves/normal:1")).value.revision > 1);
    result.checks.push(
      "offline save stays in the profile's IndexedDB and uploads after reconnection",
    );
    const oldPage = await aContext.newPage();
    await oldPage.goto(base);
    await oldPage.locator("#cloud-toggle").waitFor();
    await a.getByRole("button", { name: "新建独立身份", exact: true }).click();
    await a.waitForFunction(
      (old) =>
        document.querySelector(".cloud-identity") &&
        !document.querySelector(".cloud-identity").textContent.includes(old) &&
        document.getElementById("cloud-toggle").dataset.state === "synced",
      identityA.profileId,
    );
    const identityC = await session(a);
    assert.notEqual(identityC.serverId, identityA.serverId);
    assert.deepEqual((await request(a, "/api/saves")).value.saves, []);
    const stale = await oldPage.evaluate(async (account) => {
      const r = await fetch("/api/saves", { headers: { "X-FFVI-Account": account } });
      return r.status;
    }, identityA.serverId);
    assert.equal(stale, 403);
    await panel(oldPage);
    await oldPage.getByRole("button", { name: "立即同步", exact: true }).click();
    await oldPage.waitForFunction(() =>
      document.getElementById("cloud-panel").textContent.includes("身份已切换"),
    );
    assert.deepEqual((await request(a, "/api/saves")).value.saves, []);
    await panel(a);
    await a.getByLabel("恢复密钥", { exact: true }).fill(credentials.recoveryKey);
    await a.getByRole("button", { name: "恢复已有身份", exact: true }).click();
    await a.waitForFunction(
      (expected) =>
        document.getElementById("cloud-toggle")?.dataset.state === "synced" &&
        document.querySelector(".cloud-identity")?.textContent.includes(expected),
      identityA.profileId,
    );
    assert.ok((await request(a, "/api/saves/normal:1")).value.revision > 1);
    result.checks.push(
      "same browser switches namespaces; stale tab is blocked; original identity and saves recover intact",
    );
    assert.deepEqual(result.errors, []);
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.failure = error.stack;
  } finally {
    await browser.close();
  }
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
report.status = report.results.every((r) => r.status === "passed") ? "passed" : "failed";
await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exitCode = 1;
