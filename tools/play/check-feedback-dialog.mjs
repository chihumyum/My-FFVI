import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const output = path.resolve("build/play/deployment/mobile-feedback");
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: path.resolve("."),
  publicDir: false,
  cacheDir: path.join(output, "vite-cache"),
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { host: "127.0.0.1", port: 0 },
  appType: "custom",
});
server.middlewares.use((request, response, next) => {
  if (request.url !== "/feedback-fixture") return next();
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><button id="open">报告问题</button><script type="module">
    import { openFeedbackDialog } from "/apps/play/feedback-dialog.js";
    window.openFeedbackDialog = openFeedbackDialog;
    window.fixture = {schema:"ffvi-bug-report",version:1,createdAt:"2026-10-20T01:00:00.000Z",map:{id:34,name:"费加罗王宫"},script:{lastInstruction:{script:"sc_e_0026",index:8}},player:{x:102,y:42},actors:[],party:[],events:[],screenshot:{mimeType:"image/png",dataURL:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ssQAAAAASUVORK5CYII="}};
    window.keyEvents = 0; document.addEventListener("keydown", () => window.keyEvents++);
    document.querySelector("#open").onclick = () => { window.result = null; window.feedback = openFeedbackDialog(window.fixture, {hosted:true, account:"fixture-account"}).then(result => window.result=result); };
  </script></body></html>`);
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const results = [];
try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 844, height: 390 },
        acceptDownloads: true,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const uploads = [];
      await page.route("**/api/reports", async (route) => {
        uploads.push({
          report: route.request().postDataJSON(),
          account: route.request().headers()["x-ffvi-account"],
        });
        await route.fulfill({
          status: uploads.length === 1 ? 503 : 201,
          contentType: "application/json",
          body: JSON.stringify(
            uploads.length === 1 ? { error: "服务暂时离线" } : { id: "accepted-fixture" },
          ),
        });
      });
      await page.goto(origin + "/feedback-fixture");
      await page.waitForFunction(() => !!window.openFeedbackDialog);
      await page.getByRole("button", { name: "报告问题", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      assert.equal(uploads.length, 0, "opening captures only and must not upload");
      assert.equal(
        await page.locator(".feedback-preview").getAttribute("src"),
        await page.evaluate(() => window.fixture.screenshot.dataURL),
      );
      await page.locator("textarea").fill("进门后角色被门遮住");
      await page.keyboard.type(" WASD");
      assert.equal(await page.evaluate(() => window.keyEvents), 0, "typing must not move the game");
      await page.evaluate(() => {
        window.fixture.map.id = 999;
        window.fixture.player.x = 999;
      });
      await page.getByRole("button", { name: "发送报告", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "服务暂时离线" }).waitFor();
      assert.equal(await page.locator("textarea").inputValue(), "进门后角色被门遮住 WASD");
      await page.screenshot({ path: path.join(output, `${name}-feedback-retry.png`) });
      assert.equal(uploads[0].report.map.id, 34, "report must retain captured map");
      assert.equal(uploads[0].report.player.x, 102, "report must retain captured coordinates");
      assert.equal(uploads[0].account, "fixture-account");
      await page.getByRole("button", { name: "重试发送", exact: true }).click();
      await page.waitForFunction(() => window.result?.method === "cloud");
      assert.equal(uploads[1].report.submissionId, uploads[0].report.submissionId);
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.getByRole("button", { name: "报告问题", exact: true }).click();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await page.evaluate(() => window.result.method), "cancelled");
      assert.equal(uploads.length, 2, "cancel must not upload");
      await page.getByRole("button", { name: "报告问题", exact: true }).click();
      await page.locator("textarea").fill("离线手动报告");
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "下载报告", exact: true }).click();
      const download = await downloaded;
      const filename = path.join(output, `${name}-download.json`);
      await download.saveAs(filename);
      assert.equal(JSON.parse(await readFile(filename, "utf8")).description, "离线手动报告");
      assert.equal(uploads.length, 2, "download must not upload");
      assert.deepEqual(errors, []);
      results.push({
        engine: name,
        screenshotBeforeDescription: true,
        immutableCapture: true,
        explicitSubmitOnly: true,
        retainedFailureAndRetry: true,
        cancelAndDownload: true,
        textInputIsolated: true,
        errors,
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
await writeFile(path.join(output, "feedback-dialog.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results));
