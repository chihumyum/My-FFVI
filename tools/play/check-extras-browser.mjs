import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const output = path.resolve(
  process.env.PLAY_EXTRAS_REPORT_DIR || "build/play/acceptance/step-2/extras",
);
await mkdir(output, { recursive: true });
const engine = process.env.PLAY_BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const browser = await { chromium, webkit }[engine].launch({
  headless: true,
  // Chromium otherwise uses CPU SwiftShader on this Mac. Use the same Metal
  // GPU path as ordinary browsing; keep layout/image assertions unchanged.
  args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
});
const result = { engine, viewports: [], errors: [] };
let inspectedPage;
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  inspectedPage = page;
  page.on("pageerror", (error) => result.errors.push(error.message));
  const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4174/",
    index = await (await page.request.get(new URL("data/index.json", base).href)).json(),
    presentation = await (await page.request.get(new URL(index.presentation, base).href)).json(),
    titlePage = index.assets.images[presentation.sprites.titleLogo.url].file;
  let releaseTitle;
  const titleGate = new Promise((resolve) => (releaseTitle = resolve));
  await page.route(`**/${titlePage}`, async (route) => {
    await titleGate;
    await route.continue();
  });
  await page.goto(base);
  result.webglRenderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
  });
  const extrasButton = page.getByRole("button", { name: "额外内容", exact: true });
  await extrasButton.waitFor();
  const before = await extrasButton.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  const titleResponse = page.waitForResponse((response) => response.url().endsWith(titlePage));
  releaseTitle();
  await (await titleResponse).finished();
  await page.waitForLoadState("networkidle");
  const after = await extrasButton.boundingBox();
  result.titleLayout = { titlePage, before, after };
  assert.deepEqual(after, before, "Title image decoding must not reflow clickable controls");
  await page.mouse.up();
  await page.getByRole("button", { name: "画廊", exact: true }).click();
  const cards = () => page.getByRole("button", { name: /^\d{3}\s/ });
  await cards().nth(23).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(await cards().count(), 24);
  await page.waitForFunction(() => {
    const rows = window.ffviUIDiagnostics().cards;
    return rows.length === 24 && rows.every((row) => row.loaded && row.url.includes("/previews/"));
  });
  result.previewCards = await page.evaluate(() => window.ffviUIDiagnostics().cards);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("F9");
  const download = await downloadPromise;
  const reportFile = path.join(output, "gallery-f9.json");
  await download.saveAs(reportFile);
  const report = JSON.parse(await readFile(reportFile));
  const png = Buffer.from(report.screenshot.dataURL.split(",")[1], "base64");
  const backing = await page.locator("#screen").evaluate((c) => [c.width, c.height]);
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], backing);
  assert.deepEqual([report.viewport.width, report.viewport.height], backing);
  result.bugReport = { screenshot: backing, bytes: png.length, file: reportFile };
  for (const size of [
    { width: 1600, height: 1000 },
    { width: 1000, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await cards().nth(23).waitFor();
    const bounds = await cards()
      .all()
      .then((rows) => Promise.all(rows.map((row) => row.boundingBox())));
    assert.ok(
      bounds.every(
        (b) =>
          b &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= size.width + 1 &&
          b.y + b.height <= size.height + 1,
      ),
      "All 24 gallery cards must be accessible inside the viewport",
    );
    const canvas = await page.locator("#screen").evaluate((c) => ({
      width: c.width,
      height: c.height,
      cssWidth: c.clientWidth,
      cssHeight: c.clientHeight,
    }));
    assert.ok(
      canvas.width >= size.width * 1.8,
      "Menu backing pixels must follow the real viewport and DPR",
    );
    result.viewports.push({ ...size, canvas, cards: bounds.length });
    await page.screenshot({ path: path.join(output, `gallery-${size.width}.png`) });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const label of ["图鉴", "画廊", "资料库", "画廊"]) {
    await page.getByRole("button", { name: label, exact: true }).hover();
    const state = await page.evaluate(() => window.ffviUIDiagnostics());
    assert.ok(state.hovered.length <= 1, JSON.stringify(state.hovered));
  }
  await page.getByRole("button", { name: "下一页 →", exact: true }).click();
  await page.getByRole("button", { name: /^025\s/ }).waitFor();
  assert.ok((await page.evaluate(() => window.ffviUIDiagnostics())).hovered.length <= 1);
  await page.getByRole("button", { name: "24 项 / 页", exact: true }).click();
  await cards().nth(31).waitFor();
  assert.equal(await cards().count(), 32);
  await page.getByRole("button", { name: /搜索名称或编号/ }).click();
  await page.getByRole("searchbox", { name: "搜索名称或编号", exact: true }).waitFor();
  await page.keyboard.type("003");
  await page.waitForFunction(() => {
    const cards = window.ffviUIDiagnostics().cards;
    return cards.length === 1 && cards[0].label.includes("Opera House");
  });
  // F9 must work while the native editor owns keyboard focus, not only after
  // Enter/Escape has returned focus to the game canvas.
  const searchDownload = page.waitForEvent("download");
  await page.keyboard.press("F9");
  const focusedReportFile = path.join(output, "search-focus-f9.json");
  await (await searchDownload).saveAs(focusedReportFile);
  const focusedReport = JSON.parse(await readFile(focusedReportFile));
  assert.equal(focusedReport.screenshot.mimeType, "image/png");
  assert.equal(
    await page.getByRole("searchbox", { name: "搜索名称或编号", exact: true }).inputValue(),
    "003",
  );
  result.focusedSearchReport = focusedReportFile;
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Opera");
  // The unfiltered first page already contains #003. Wait for the filtered
  // render, rather than mistaking that pre-existing button for a settled query.
  await page.waitForFunction(() => {
    const cards = window.ffviUIDiagnostics().cards;
    return cards.length === 1 && cards[0].label.includes("Opera House");
  });
  await page.getByRole("button", { name: "搜索名称或编号：Opera", exact: true }).waitFor();
  await page.getByRole("button", { name: /^003\s.*Opera/ }).waitFor();
  assert.equal(await cards().count(), 1);
  // Clicking a result while typing must work without a preliminary Enter.
  // Allow two real render frames between down/up to expose blur-triggered
  // reconstruction of the clicked control, rather than accidentally hiding it.
  const target = await cards().first().boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.down();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "← 返回网格", exact: true }).waitFor();
  result.searchCardPointerClick = true;
  await page.getByRole("button", { name: "放大 +", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(output, "opera-viewer.png") });
  await page.getByRole("button", { name: "← 返回网格", exact: true }).click();
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await cards().nth(31).waitFor();
  assert.equal(await cards().count(), 32);
  await page.getByRole("button", { name: "资料库", exact: true }).click();
  await page.getByRole("button", { name: /搜索名称或编号/ }).click();
  await page.keyboard.type("003");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const cards = window.ffviUIDiagnostics().cards;
    return cards.length === 1 && /^003\s/.test(cards[0].label);
  });
  assert.equal(await cards().count(), 1);
  result.libraryDisplayedNumber = await cards().first().innerText();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "新游戏", exact: true }).waitFor();
  assert.equal(
    await page.locator("body").evaluate((b) => b.classList.contains("modern-menu")),
    false,
  );
  result.finalUI = await page.evaluate(() => window.ffviUIDiagnostics());
  assert.ok(result.finalUI.hovered.length <= 1);
  assert.deepEqual(result.errors, []);
  await writeFile(path.join(output, "browser-check.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ viewports: result.viewports, errors: result.errors }));
} catch (error) {
  result.failure = error.message;
  if (inspectedPage) {
    result.text = await inspectedPage
      .locator("body")
      .innerText()
      .catch(() => "Page unavailable");
    result.diagnostics = await inspectedPage
      .evaluate(() => ({
        ui: window.ffviUIDiagnostics?.(),
        render: window.ffviRenderDiagnostics?.(),
      }))
      .catch(() => null);
    await inspectedPage.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  await writeFile(path.join(output, "failure.json"), JSON.stringify(result, null, 2));
  throw error;
} finally {
  await browser.close();
}
