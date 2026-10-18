import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "https://ffvi.chihum.dev/";
const output = path.resolve(
  process.env.PLAY_LOAD_REPORT || "build/play/deployment/loading-csp/current",
);
const modes = (process.env.PLAY_LOAD_MODES || "original,blocked-workers,module-failure").split(",");
const results = [];
for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
  for (const mode of modes) {
    const directory = path.join(output, `${engine}-${mode}`);
    await mkdir(directory, { recursive: true });
    const report = {
      engine,
      mode,
      base,
      errors: [],
      consoleErrors: [],
      failedRequests: [],
      workers: [],
      blockedWrites: [],
      status: "running",
    };
    let browser, page;
    try {
      browser = await { chromium, webkit }[engine].launch({
        headless: true,
        args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
      });
      const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
      const password = (await readFile("private-data/cloudflare-first-login.txt", "utf8"))
        .trim()
        .split(/\r?\n/)
        .at(-1);
      const login = await context.request.post(new URL("/api/session", base).href, {
        headers: { Origin: new URL(base).origin },
        data: { password },
      });
      assert.equal(login.status(), 200);
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (
          new URL(request.url()).pathname.startsWith("/api/saves") &&
          request.method() !== "GET"
        ) {
          report.blockedWrites.push({ method: request.method(), url: request.url() });
          return route.abort();
        }
        if (
          mode === "module-failure" &&
          /\/assets\/app-[^/]+\.js$/.test(new URL(request.url()).pathname)
        ) {
          report.failedModule = request.url();
          return route.abort();
        }
        if (mode === "blocked-workers" && request.isNavigationRequest()) {
          const response = await route.fetch();
          const headers = { ...response.headers() };
          // Controlled negative case: actual browser CSP enforcement, not a
          // mocked Worker API. Original mode never rewrites HTML or headers.
          headers["content-security-policy"] =
            (headers["content-security-policy"] || "").replace(/worker-src[^;]*;?/g, "") +
            "; worker-src 'none'";
          return route.fulfill({ response, headers });
        }
        return route.continue();
      });
      await context.addInitScript(() => {
        window.loadingPolicyViolations = [];
        addEventListener("securitypolicyviolation", (event) => {
          window.loadingPolicyViolations.push({
            directive: event.effectiveDirective,
            blocked: event.blockedURI,
            file: event.sourceFile,
          });
        });
      });
      page = await context.newPage();
      page.on("pageerror", (error) => report.errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") report.consoleErrors.push(message.text());
      });
      page.on("worker", (worker) => report.workers.push(worker.url()));
      page.on("requestfailed", (request) =>
        report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
      );
      const documentResponse = await page.goto(base);
      report.responsePolicy = documentResponse.headers()["content-security-policy"];
      if (mode === "module-failure") {
        await page
          .getByText("游戏加载失败，请重新加载。", { exact: true })
          .waitFor({ timeout: 20000 });
        await page.getByRole("link", { name: "重新加载", exact: true }).waitFor();
        assert(report.failedModule, "The real game module request must have failed");
        await page.screenshot({ path: path.join(directory, "retry-screen.png") });
        report.status = "passed";
        continue;
      }
      const started = Date.now();
      await page.locator("#cloud-toggle").waitFor({ timeout: 60000 });
      await page.waitForFunction(
        () => {
          const metrics = window.ffviRenderMetrics?.();
          return (
            metrics?.texturesReady > 0 &&
            metrics.texturesLoading === 0 &&
            metrics.texturesFailed === 0
          );
        },
        null,
        { timeout: Number(process.env.PLAY_LOAD_TIMEOUT || 30000) },
      );
      report.titleReadyMs = Date.now() - started;
      report.cloudMetaPresent = (await page.locator('meta[name="ffvi-host"]').count()) === 1;
      assert(
        report.cloudMetaPresent,
        "Production cloud bootstrap must not be removed from acceptance",
      );
      await page.getByRole("button", { name: "新游戏", exact: true }).waitFor();
      await page.screenshot({ path: path.join(directory, "title.png") });
      if (process.env.PLAY_LOAD_EXISTING_SAVE === "1" && mode === "original") {
        const listed = await context.request.get(new URL("/api/saves", base).href);
        assert.equal(listed.status(), 200);
        const normal = (await listed.json()).saves.filter((row) => row.id.startsWith("normal:"));
        const selected = normal.find((row) => row.id === "normal:auto") || normal[0];
        assert(selected, "An existing ordinary cloud save is needed for this check");
        const response = await context.request.get(
          new URL(`/api/saves/${encodeURIComponent(selected.id)}`, base).href,
        );
        assert.equal(response.status(), 200);
        const { record } = await response.json();
        await page.getByRole("button", { name: "继续游戏", exact: true }).click();
        const label = selected.id.endsWith(":auto")
          ? "自动存档 / 最近继续"
          : `读取存档 ${record.slot}`;
        await page.getByRole("button", { name: label, exact: true }).click();
        await page.waitForFunction(
          (mapId) => window.ffvi?.mapId === mapId && !window.ffvi.loading,
          record.snapshot.mapId,
          { timeout: 60000 },
        );
        await page
          .getByRole("button", { name: "继续游戏", exact: true })
          .waitFor({ state: "hidden" });
        await page.waitForFunction(() => window.ffviRenderMetrics().texturesLoading === 0, null, {
          timeout: 30000,
        });
        report.loadedCloudSave = {
          id: selected.id,
          revision: selected.revision,
          mapId: record.snapshot.mapId,
        };
        await page.screenshot({ path: path.join(directory, "cloud-save.png") });
      } else if (process.env.PLAY_LOAD_START_GAME === "1") {
        await page.getByRole("button", { name: "新游戏", exact: true }).click();
        await page.waitForFunction(() => window.ffvi?.mapId && !window.ffvi.loading, null, {
          timeout: 60000,
        });
        await page.waitForFunction(() => window.ffviRenderMetrics().texturesLoading === 0, null, {
          timeout: 30000,
        });
        await page.screenshot({ path: path.join(directory, "new-game.png") });
      }
      report.metrics = await page.evaluate(() => window.ffviRenderMetrics());
      report.policyViolations = await page.evaluate(() => window.loadingPolicyViolations);
      assert.deepEqual(report.errors, []);
      assert.equal(report.metrics.texturesFailed, 0);
      if (process.env.PLAY_LOAD_REQUIRE_NO_WORKERS === "1") assert.deepEqual(report.workers, []);
      assert(!report.policyViolations.some((entry) => /worker-src/.test(entry.directive)));
      report.status = "passed";
    } catch (error) {
      report.status = "failed";
      report.failure = error.stack || String(error);
      if (page) {
        report.failureState = await page
          .evaluate(() => ({
            metrics: window.ffviRenderMetrics?.(),
            violations: window.loadingPolicyViolations,
            text: document.body.innerText,
          }))
          .catch(() => null);
        await page.screenshot({ path: path.join(directory, "failure.png") }).catch(() => {});
      }
      process.exitCode = 1;
    } finally {
      await browser?.close();
      await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
      results.push(report);
      console.log(
        JSON.stringify({
          engine,
          mode,
          status: report.status,
          workers: report.workers.length,
          error: report.failure,
        }),
      );
    }
  }
}
await writeFile(
  path.join(output, "summary.json"),
  JSON.stringify(
    { status: results.every((r) => r.status === "passed") ? "passed" : "failed", results },
    null,
    2,
  ) + "\n",
);
