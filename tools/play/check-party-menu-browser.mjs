import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(
  process.env.PLAY_MENU_REPORT || "build/play/deployment/menu-refinement",
);
await mkdir(output, { recursive: true });
const index = JSON.parse(await readFile(path.join(root, "build/web-data/web/data/index.json")));
const presentation = JSON.parse(
  await readFile(path.join(root, "build/web-data/web", index.presentation)),
);
const content = JSON.parse(await readFile(path.join(root, "build/web-data/web", index.battle)));
const assetAudit = {
  icons: Object.keys(presentation.icons).length,
  mappedContents: Object.keys(presentation.contentIcons).length,
  missingAssets: Object.entries(presentation.contentIcons)
    .filter(([, key]) => !index.assets.images[presentation.icons[key]?.url])
    .map(([id, key]) => ({ id, key })),
  intentionallyUnmapped: Object.entries(content.contents)
    .filter(([id]) => !presentation.contentIcons[id])
    .map(([id, item]) => ({ id, name: content.contentNames[id], type: item.type_id })),
};
assert.deepEqual(assetAudit.missingAssets, []);
await writeFile(path.join(output, "icons.json"), JSON.stringify(assetAudit, null, 2));
const server = await createServer({
  configFile: path.join(root, "vite.config.mjs"),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const results = [];
try {
  for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
    const row = {
      engine,
      errors: [],
      scope: "Real boosted Narshe checkpoint; ordinary menu controls, no production saves",
    };
    results.push(row);
    const browser = await { chromium, webkit }[engine].launch({
      headless: true,
      args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    let page;
    try {
      page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
      page.on("pageerror", (error) => row.errors.push(error.message));
      await page.goto(`${base}?checkpoint=narshe-rock&panel=道具`);
      await page.waitForFunction(
        () =>
          window.ffviUIDiagnostics?.().icons.some((icon) => icon.loaded) &&
          !window.ffviLoading().active,
        null,
        { timeout: 60000 },
      );
      row.items = await page.evaluate(() => window.ffviUIDiagnostics().icons);
      assert.ok(
        row.items.some(
          (icon) => icon.contentId === "2" && icon.resource === "UI_Common_Icon37" && icon.loaded,
        ),
      );
      assert.deepEqual(
        row.items.filter((icon) => icon.resource && !icon.loaded),
        [],
      );
      await page.screenshot({ path: path.join(output, `${engine}-items.png`) });
      await page.getByRole("button", { name: "装备", exact: true }).click();
      await page.waitForFunction(
        () =>
          window.ffviUIDiagnostics().icons.some((icon) => icon.contentId === "95" && icon.loaded) &&
          window.ffviUIDiagnostics().icons.every((icon) => !icon.resource || icon.loaded) &&
          !window.ffviLoading().active,
      );
      row.equipment = await page.evaluate(() => window.ffviUIDiagnostics().icons);
      assert.ok(
        row.equipment.some(
          (icon) => icon.contentId === "95" && icon.resource === "UI_Common_Icon05" && icon.loaded,
        ),
      );
      await page.screenshot({ path: path.join(output, `${engine}-equipment.png`) });
      await page.getByRole("button", { name: /^右手：/ }).click();
      await page.waitForFunction(
        () => window.ffviUIDiagnostics().icons.filter((icon) => icon.loaded).length > 4,
      );
      row.equipmentOptions = await page.evaluate(() => window.ffviUIDiagnostics().icons);
      assert.deepEqual(
        row.equipmentOptions.filter((icon) => icon.loaded && icon.labelRight > icon.width + 1),
        [],
        "Icon labels exceed their button width",
      );
      await page.screenshot({ path: path.join(output, `${engine}-equipment-options.png`) });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "饰品", exact: true }).click();
      await page.getByRole("button", { name: /^饰品 1：/ }).click();
      await page.waitForFunction(() =>
        window.ffviUIDiagnostics().icons.some((icon) => icon.contentId === "307" && icon.loaded),
      );
      row.coldPopupIcons = await page.evaluate(() => window.ffviUIDiagnostics().icons);
      assert.deepEqual(
        row.coldPopupIcons.filter((icon) => icon.loaded && icon.labelRight > icon.width + 1),
        [],
      );
      await page.screenshot({ path: path.join(output, `${engine}-relic-popup.png`) });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "装备", exact: true }).click();
      for (let n = 0; n < 4; n++) {
        await page.getByRole("button", { name: "最强装备", exact: true }).click();
        if (
          (await page.evaluate(() => window.ffviUIDiagnostics().notices)).includes(
            "已是当前最强装备。",
          )
        )
          break;
      }
      row.optimize = await page.evaluate(() => window.ffviUIDiagnostics().notices);
      assert.deepEqual(row.optimize, ["已是当前最强装备。"]);
      await page.screenshot({ path: path.join(output, `${engine}-optimal-notice.png`) });
      await page.getByRole("button", { name: "队列", exact: true }).click();
      await page.waitForFunction(
        () =>
          window.ffviUIDiagnostics().figures.length === window.ffvi.party.length &&
          window.ffviUIDiagnostics().figures.every((figure) => figure.loaded) &&
          !window.ffviLoading().active,
      );
      const party = await page.evaluate(() =>
        window.ffvi.party.map((unit) => ({ id: unit.id, name: unit.name, row: unit.row })),
      );
      await page.getByRole("button", { name: `1. ${party[0].name}`, exact: true }).click();
      await page.waitForFunction(
        () =>
          window.ffviUIDiagnostics().figures[0].active &&
          window.ffviUIDiagnostics().figures.every((figure) => figure.loaded) &&
          !window.ffviLoading().active,
      );
      const firstFrame = await page.evaluate(() => window.ffviUIDiagnostics().figures[0].frame);
      await page.waitForFunction(
        (frame) =>
          window.ffviUIDiagnostics().figures[0].frame !== frame &&
          window.ffviUIDiagnostics().figures.every((figure) => figure.loaded) &&
          !window.ffviLoading().active,
        firstFrame,
        { timeout: 5000 },
      );
      row.animation = await page.evaluate(() => window.ffviUIDiagnostics().figures);
      await page.screenshot({ path: path.join(output, `${engine}-formation-selected.png`) });
      await page
        .getByRole("button", { name: `${party.length}. ${party.at(-1).name}`, exact: true })
        .click();
      row.order = await page.evaluate(() => window.ffvi.party.map((unit) => unit.id));
      const expected = party.map((unit) => unit.id);
      [expected[0], expected[expected.length - 1]] = [expected.at(-1), expected[0]];
      assert.deepEqual(row.order, expected);
      const targetRow = party.at(-1).row === "back" ? "改为前排" : "改为后排";
      await page.getByRole("button", { name: targetRow, exact: true }).first().click();
      assert.equal(
        await page.evaluate(() => window.ffvi.party[0].row),
        party.at(-1).row === "back" ? "front" : "back",
      );
      await page.screenshot({ path: path.join(output, `${engine}-formation-reordered.png`) });
      await page.getByRole("button", { name: "状态", exact: true }).click();
      await page.waitForFunction(
        () => window.ffviUIDiagnostics().stats.length === 14 && !window.ffviLoading().active,
      );
      row.stats = await page.evaluate(() => window.ffviUIDiagnostics().stats);
      assert.deepEqual(
        row.stats.filter(
          (stat) =>
            stat.valueX + stat.valueWidth > stat.width + 1 || stat.labelWidth + 8 > stat.valueX,
        ),
        [],
        "Status labels/values overlap or exceed their columns",
      );
      await page.screenshot({ path: path.join(output, `${engine}-status.png`) });
      assert.deepEqual(row.errors, []);
      row.status = "passed";
    } catch (error) {
      row.status = "failed";
      row.failure = error.stack;
      row.ui = await page?.evaluate(() => window.ffviUIDiagnostics?.()).catch(() => null);
      await page?.screenshot({ path: path.join(output, `${engine}-failure.png`) }).catch(() => {});
      process.exitCode = 1;
    } finally {
      await browser.close();
      await writeFile(path.join(output, `${engine}.json`), JSON.stringify(row, null, 2));
      console.log(JSON.stringify({ engine, status: row.status, failure: row.failure }));
    }
  }
} finally {
  await server.close();
}
await writeFile(path.join(output, "report.json"), JSON.stringify({ assetAudit, results }, null, 2));
