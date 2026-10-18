import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4191/";
const password = (
  await readFile(
    process.env.PLAY_HOST_PASSWORD_FILE || "build/play/deployment/test-data/first-login.txt",
    "utf8",
  )
)
  .trim()
  .split(/\r?\n/)
  .at(-1);
const output = path.resolve(process.env.PLAY_HOST_REPORT_DIR || "build/play/deployment/cloud");
const fixture =
  process.env.PLAY_HOST_SAVE ||
  "build/play/acceptance/step-7/browsers-final-chromium/chromium/actual-save.json";
await mkdir(output, { recursive: true });
const original = JSON.parse(await readFile(fixture));
assert.equal(original.mapId, 1);
assert.equal(!!original.testBoost, false);
const seed = {
  format: "ffvi-reweb-saves",
  version: 1,
  records: [
    {
      id: "normal:1",
      mode: "normal",
      slot: 1,
      savedAt: Date.now(),
      time: original.time,
      map: "世界地图 · 真实 M1 回归存档",
      party: [],
      snapshot: original,
    },
  ],
};
const report = {
  base,
  fixture,
  scope:
    "Real login, import/read/save UI in separate empty browser profiles. The starting snapshot is an actual ordinary M1 regression save, imported via the user-facing backup form; no injected game state or plot edits. This is cloud/input acceptance, not additional story coverage.",
  checks: [],
  errors: [],
  status: "running",
};
const browsers = [];
// JSON save transport intentionally omits JavaScript's undefined properties,
// exactly like the existing quick-save serialization.
const wire = (value) => JSON.parse(JSON.stringify(value));
async function login(context, label) {
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    report.errors.push({ label, error: error.stack || error.message }),
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(base);
  await page.locator("#password").waitFor();
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "进入游戏", exact: true }).click();
  await page.getByRole("button", { name: "新游戏", exact: true }).waitFor();
  await page.waitForFunction(
    () => document.getElementById("cloud-toggle")?.dataset.state === "synced",
  );
  return page;
}
async function panel(page, open) {
  if ((await page.locator("#cloud-panel").evaluate((node) => node.open)) !== open) {
    if (open) await page.locator("#cloud-toggle").click();
    else
      await page
        .locator("#cloud-panel")
        .getByRole("button", { name: "返回游戏", exact: true })
        .click();
    if (!open && (await page.evaluate(() => !!window.ffvi)))
      await page.waitForFunction(() => document.activeElement?.id === "screen", null, {
        timeout: 2000,
      });
  }
}
async function sync(page) {
  await panel(page, true);
  await page.locator("#cloud-panel").getByRole("button", { name: "立即同步", exact: true }).click();
  await page.waitForFunction(() =>
    ["synced", "conflict", "offline"].includes(
      document.getElementById("cloud-toggle").dataset.state,
    ),
  );
}
async function cloud(context, id = "normal:1") {
  const response = await context.request.get(
    new URL(`/api/saves/${encodeURIComponent(id)}`, base).href,
  );
  assert.equal(response.status(), 200);
  return response.json();
}
async function local(page, id = "normal:1") {
  return page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ffvi-pr-saves", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction("slots").objectStore("slots").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  }, id);
}
async function continueGame(page) {
  await panel(page, false);
  await page.getByRole("button", { name: "继续游戏", exact: true }).click();
  await page.getByRole("button", { name: "读取存档 1", exact: true }).click();
  await page.waitForFunction(() => window.ffvi?.mapId === 1 && !window.ffvi.loading);
  await panel(page, true);
  return page.evaluate(() => window.ffvi.snapshot());
}
async function saveFromRunning(page) {
  await panel(page, false);
  await page.keyboard.down("d");
  await page.waitForTimeout(350);
  await page.keyboard.up("d");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "存档", exact: true }).click();
  await page.getByRole("button", { name: "覆盖存档 1", exact: true }).click();
  await page.waitForTimeout(300);
  const saved = await local(page);
  assert.ok(saved?.snapshot);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "返回游戏", exact: true }).click();
  await panel(page, true);
  return saved;
}
try {
  const browser = await chromium.launch({
    args: process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
  browsers.push(browser);
  const options = {
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    ignoreHTTPSErrors: process.env.PLAY_HOST_LOCAL_TLS === "1",
  };
  const contextA = await browser.newContext(options),
    contextB = await browser.newContext(options);
  const a = await login(contextA, "device-a");
  await a.screenshot({ path: path.join(output, "01-authenticated-title.png") });
  await panel(a, true);
  await a.locator('#cloud-panel input[type="file"]').setInputFiles({
    name: "real-m1.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(seed)),
  });
  await a.waitForTimeout(1200);
  await sync(a);
  const uploaded = await cloud(contextA);
  assert.deepEqual(uploaded.record.snapshot, original);
  report.checks.push({ name: "actual backup import and upload", revision: uploaded.revision });
  const aLoaded = await continueGame(a);
  for (const key of ["mapId", "player", "partySlots", "banks", "inventory", "gil"])
    assert.deepEqual(aLoaded[key], original[key], key);
  const b = await login(contextB, "device-b");
  const bLoaded = await continueGame(b);
  for (const key of ["mapId", "player", "partySlots", "banks", "inventory", "gil"])
    assert.deepEqual(bLoaded[key], original[key], key);
  await b.screenshot({ path: path.join(output, "02-second-device-read.png") });
  report.checks.push({
    name: "second empty browser pulls and reads actual game save",
    map: bLoaded.mapId,
  });
  await contextB.setOffline(true);
  const aSaved = await saveFromRunning(a);
  await sync(a);
  const aCloud = await cloud(contextA);
  assert.deepEqual(aCloud.record.snapshot, wire(aSaved.snapshot));
  const bSaved = await saveFromRunning(b);
  assert.equal(bSaved.sync.dirty, true);
  assert.notDeepEqual(bSaved.snapshot, aSaved.snapshot, "the two real running games must differ");
  assert.deepEqual((await cloud(contextA)).record.snapshot, wire(aSaved.snapshot));
  await b.screenshot({ path: path.join(output, "03-offline-local-save.png") });
  report.checks.push({
    name: "offline write survives without changing server",
    localTime: bSaved.snapshot.time,
    remoteTime: aSaved.snapshot.time,
  });
  await contextB.setOffline(false);
  await sync(b);
  await b.waitForFunction(
    () => document.getElementById("cloud-toggle").dataset.state === "conflict",
  );
  assert.deepEqual((await cloud(contextA)).record.snapshot, wire(aSaved.snapshot));
  assert.deepEqual((await local(b)).snapshot, bSaved.snapshot);
  await b.screenshot({ path: path.join(output, "04-conflict-both-versions.png") });
  const cards = await b.locator(".cloud-conflict").evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }),
  );
  for (let index = 1; index < cards.length; index++)
    assert.ok(
      cards[index].top >= cards[index - 1].bottom,
      "Conflict cards must not overlap or intercept each other's buttons",
    );
  report.checks.push({
    name: "stale offline device cannot overwrite newer remote",
    base: bSaved.sync.revision,
    remote: aCloud.revision,
  });
  let card = b.locator('.cloud-conflict[data-slot="normal:1"]');
  await card
    .getByRole("button", { name: "采用本机（覆盖云端，旧版保留历史）", exact: true })
    .click();
  await b.waitForTimeout(500);
  await sync(b);
  const resolved = await cloud(contextA);
  assert.deepEqual(resolved.record.snapshot, wire(bSaved.snapshot));
  assert.ok(resolved.revision > aCloud.revision);
  for (const item of await b.locator(".cloud-conflict").all())
    await item.getByRole("button", { name: "采用云端（本机版本保留在备份）", exact: true }).click();
  await sync(b);
  const downloadPromise = b.waitForEvent("download");
  await b
    .locator("#cloud-panel")
    .getByRole("button", { name: "导出本机全部存档", exact: true })
    .click();
  const download = await downloadPromise;
  await download.saveAs(path.join(output, "actual-local-backup.json"));
  const backup = JSON.parse(await readFile(path.join(output, "actual-local-backup.json")));
  assert.ok(
    backup.records.some(
      (row) => row.archivedAt && JSON.stringify(row.snapshot) === JSON.stringify(aSaved.snapshot),
    ),
    "conflicting remote version must also survive locally",
  );
  report.checks.push({
    name: "explicit conflict resolution preserves cloud history and local recovery backup",
    revision: resolved.revision,
  });
  // A still has its old running game. A passive pull may update the slot list,
  // but saving that stale running game must not inherit the new base revision.
  await sync(a);
  const stale = await saveFromRunning(a);
  await sync(a);
  assert.equal((await local(a)).sync.conflict.revision, resolved.revision);
  assert.deepEqual((await cloud(contextA)).record.snapshot, wire(bSaved.snapshot));
  report.checks.push({
    name: "passive synchronization cannot authorize a stale active game overwrite",
    runningTime: stale.snapshot.time,
  });
  await a.screenshot({ path: path.join(output, "05-stale-running-game-protected.png") });
  await a
    .locator('.cloud-conflict[data-slot="normal:1"]')
    .getByRole("button", { name: "采用云端（本机版本保留在备份）", exact: true })
    .click();
  const serverHistory = await contextA.request.get(
    new URL("/api/saves/normal%3A1/history", base).href,
  );
  const history = (await serverHistory.json()).versions;
  assert.ok(history.length >= 3);
  // Restore the original uploaded revision via the actual history UI.
  await b.locator('[aria-label="历史存档槽"]').selectOption("normal:1");
  await b.getByRole("button", { name: "查看历史", exact: true }).click();
  await b.getByRole("button", { name: new RegExp(`^恢复版本 ${uploaded.revision} ·`) }).click();
  await b.waitForTimeout(700);
  await sync(b);
  assert.deepEqual((await cloud(contextA)).record.snapshot, original);
  report.checks.push({
    name: "actual history UI restores old cloud revision as a new revision",
    historicalRevision: uploaded.revision,
  });
  const safari = await webkit.launch();
  browsers.push(safari);
  const contextC = await safari.newContext(options),
    c = await login(contextC, "webkit-device");
  const cLoaded = await continueGame(c);
  for (const key of ["mapId", "player", "partySlots", "banks", "inventory", "gil"])
    assert.deepEqual(cLoaded[key], original[key], key);
  await c.screenshot({ path: path.join(output, "06-webkit-cloud-read.png") });
  report.checks.push({ name: "WebKit login, cloud pull and game restore", map: cLoaded.mapId });
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.stack || error.message;
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  for (const browser of browsers) await browser.close();
  await writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output }));
