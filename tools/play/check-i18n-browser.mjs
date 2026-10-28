import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { preview } from "vite";
import { chromium, webkit } from "playwright";
import { languages } from "../../src/play/languages.js";

const output = path.resolve(process.env.PLAY_I18N_REPORT_DIR || "build/play/deployment/i18n");
await mkdir(output, { recursive: true });
const server = await preview({
  configFile: false,
  build: { outDir: path.resolve("dist/web") },
  preview: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const catalogs = Object.fromEntries(
  await Promise.all(
    languages.map(async ({ id }) => [
      id,
      JSON.parse(await readFile(`src/play/locales/${id}.json`)),
    ]),
  ),
);
const results = [];
try {
  for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
    const result = {
      engine,
      status: "running",
      errors: [],
      languages: [],
      scope:
        "Disposable local static profiles; ordinary title, language, New Game and menu inputs. No production saves or native browsers.",
    };
    results.push(result);
    const browser = await { chromium, webkit }[engine].launch({
      headless: true,
      args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => result.errors.push(error.message));
    try {
      await page.goto(base);
      await page.waitForFunction(
        () => window.ffviPlayOptions && document.getElementById("boot-status").hidden,
        null,
        { timeout: 90000 },
      );
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      const select = page.locator("#game-language");
      assert.equal(await select.locator("option").count(), 12);
      for (const { id } of languages) {
        await select.selectOption(id);
        await page.waitForFunction(
          (id) =>
            document.documentElement.lang === id &&
            !document.getElementById("game-language").disabled,
          id,
        );
        await page
          .getByRole("button", { name: catalogs[id]["title.new_game"], exact: true })
          .waitFor();
        await page.waitForLoadState("networkidle");
        const screenshot = `${engine}-title-${id}.png`;
        await page.screenshot({ path: path.join(output, screenshot) });
        result.languages.push({ id, title: catalogs[id]["title.new_game"], screenshot });
      }
      result.extras = [];
      for (const id of ["en", "ja", "th"]) {
        await select.selectOption(id);
        await page.waitForFunction(
          (id) =>
            document.documentElement.lang === id &&
            !document.getElementById("game-language").disabled,
          id,
        );
        await page.getByRole("button", { name: catalogs[id]["title.extras"], exact: true }).click();
        await page.getByRole("button", { name: catalogs[id]["extras.music"], exact: true }).click();
        const locale = JSON.parse(await readFile(`build/web-data/locales/${id}.json`));
        await page.waitForFunction(
          (name) =>
            window.ffviUIDiagnostics().keyboardControls.some((row) => row.label.includes(name)),
          locale.extras.music[1],
        );
        await page.screenshot({ path: path.join(output, `${engine}-music-${id}.png`) });
        result.extras.push(id);
        await page
          .getByRole("button", { name: catalogs[id]["party_menu.back"], exact: true })
          .click();
      }
      await select.selectOption("en");
      await page.waitForFunction(() => !document.getElementById("game-language").disabled);
      await page.reload();
      await page.waitForFunction(
        () => window.ffviPlayOptions && document.getElementById("boot-status").hidden,
      );
      assert.equal(await select.inputValue(), "en", "Explicit preference must survive reload");
      await page.getByRole("button", { name: "New game", exact: true }).click();
      await page.waitForFunction(() => window.ffvi?.dialogue, null, { timeout: 120000 });
      result.opening = await page.evaluate(() => ({
        mapId: ffvi.mapId,
        key: ffvi.dialogue.key,
        text: ffvi.dialogue.text,
        speaker: ffvi.dialogue.speaker,
        boosted: !!ffvi.testBoost,
      }));
      assert.equal(result.opening.boosted, false);
      assert.ok(
        !/\p{Script=Han}/u.test(result.opening.text),
        "English opening must use PR English",
      );
      await page.locator("#screen").click({ position: { x: 3, y: 3 } });
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => ffvi.dialogue.key), result.opening.key);
      for (const { id } of languages) {
        const before = await page.evaluate(() => ({
          mapId: ffvi.mapId,
          key: ffvi.dialogue?.key,
          party: ffvi.party.map((u) => [u.id, u.hp, u.mp, u.exp]),
          identity: localStorage.getItem("ffvi-recovery-active"),
        }));
        await select.selectOption(id);
        await page.waitForFunction(
          (id) =>
            document.documentElement.lang === id &&
            !document.getElementById("game-language").disabled,
          id,
        );
        const after = await page.evaluate(() => ({
          mapId: ffvi.mapId,
          key: ffvi.dialogue?.key,
          party: ffvi.party.map((u) => [u.id, u.hp, u.mp, u.exp]),
          identity: localStorage.getItem("ffvi-recovery-active"),
        }));
        assert.deepEqual(
          after,
          before,
          `Language ${id} must not advance the story, alter stats or change identity`,
        );
        await page.screenshot({ path: path.join(output, `${engine}-opening-${id}.png`) });
        const text = await page.evaluate(() => ({
          actual: ffvi.dialogue.text,
          expected: ffvi.text(ffvi.dialogue.key),
          speaker: ffvi.dialogue.speaker,
          expectedSpeaker: ffvi.data.speakers[ffvi.dialogue.key] || "",
        }));
        assert.equal(text.actual, text.expected);
        assert.equal(text.speaker, text.expectedSpeaker);
      }
      await select.selectOption("en");
      await page.waitForFunction(() => !document.getElementById("game-language").disabled);
      await page.getByRole("button", { name: "Cloud saves", exact: true }).click();
      await page.getByRole("button", { name: "Export all local saves", exact: true }).waitFor();
      await page.getByRole("button", { name: "Return to game", exact: true }).click();
      await page.keyboard.press("F9");
      await page.getByRole("dialog").getByRole("heading", { name: "Report an issue" }).waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      result.mobile = [];
      for (const { id } of languages) {
        await select.selectOption(id);
        await page.waitForFunction(
          (id) =>
            document.documentElement.lang === id &&
            !document.getElementById("game-language").disabled,
          id,
        );
        const bounds = await select.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
        const cloud = await page.locator("#cloud-toggle").boundingBox();
        for (const control of await page
          .locator(".touch-toolbar button:visible, .touch-toolbar select")
          .all()) {
          const box = await control.boundingBox();
          assert.ok(
            box.x >= cloud.x + cloud.width ||
              box.y >= cloud.y + cloud.height ||
              box.x + box.width <= cloud.x ||
              box.y + box.height <= cloud.y,
            `${id}: toolbar overlaps cloud saves`,
          );
        }
        await page.screenshot({ path: path.join(output, `${engine}-mobile-${id}.png`) });
        result.mobile.push(id);
      }
      assert.deepEqual(result.errors, []);
      result.status = "passed";
    } catch (error) {
      result.status = "failed";
      result.failure = error.stack;
      await page.screenshot({ path: path.join(output, `${engine}-failure.png`) }).catch(() => {});
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify({ results }, null, 2));
}
console.log(
  JSON.stringify(
    results.map(({ engine, status, languages }) => ({
      engine,
      status,
      languages: languages.length,
    })),
  ),
);
