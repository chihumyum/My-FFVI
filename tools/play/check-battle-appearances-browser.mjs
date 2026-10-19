import { clickRegressionControl } from "./browser-assists.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";
import { BattleAppearanceAudit } from "./audit-battle-appearances.mjs";
import { inspectFramePixels } from "./check-frame-pixels.mjs";

const engine = process.env.PLAY_BROWSER || "chromium",
  output = path.resolve(`build/play/acceptance/step-3/battles-${engine}`),
  saved = JSON.parse(
    await readFile(
      "build/play/acceptance/step-3/checkpoints-before-specials/merchant-passage.json",
    ),
  ),
  oracle = await BattleAppearanceAudit.open(),
  cases = [
    { name: "magitek", party: [1, 31, 32], magitek: true },
    { name: "merchant", party: [2], condition: 80 },
    { name: "soldier", party: [2], condition: 79 },
    { name: "player-imp", party: [2], condition: 13 },
    { name: "enemy-imp", party: [2], enemyCondition: 13 },
    { name: "trance", party: [1], condition: 56 },
    { name: "temporary-characters", party: [33, 34] },
  ],
  browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const fixture of cases) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript(
      (saved) => localStorage.setItem("ffvi-play-test", JSON.stringify(saved)),
      saved,
    );
    await page.goto(process.env.PLAY_WEB_URL || "http://127.0.0.1:4179/");
    await clickRegressionControl(page, "继续剧情测试");
    await page.getByRole("button", { name: "自动存档 / 最近继续", exact: true }).click();
    await page.waitForFunction(() => window.ffvi && !window.ffvi.loading);
    // Controlled presentation fixture: construct a real PR formation using the
    // game's Battle entry, then vary only diagnostic party/condition inputs.
    // This is deliberately NOT credited as story or gameplay acceptance.
    await page.evaluate((fixture) => {
      const game = window.ffvi;
      game.partySlots = [fixture.party, [], []];
      game.partyIndex = 0;
      for (const id of fixture.party) {
        const unit = game.unit(id);
        unit.magitek = Boolean(fixture.magitek);
        unit.conditions = fixture.condition ? [fixture.condition] : [];
      }
      game.encounter(4, "", { pc: 0, waitFor: null });
      if (fixture.enemyCondition) game.battle.enemies[0].conditions = [fixture.enemyCondition];
    }, fixture);
    await page.waitForLoadState("networkidle");
    const pending = page.waitForEvent("download");
    await page.keyboard.press("F9");
    const file = path.join(output, `${fixture.name}-f9.json`);
    await (await pending).saveAs(file);
    const report = JSON.parse(await readFile(file)),
      battle = await page.evaluate(() => {
        const b = window.ffvi.battle,
          pick = (u) =>
            Object.fromEntries(
              [
                "id",
                "side",
                "jobId",
                "monsterId",
                "slot",
                "conditions",
                "magitek",
                "hp",
                "hidden",
                "removed",
                "escaped",
                "trance",
              ].map((key) => [key, u[key]]),
            );
        return {
          encounterId: b.encounterId,
          formation: b.formation,
          players: b.players.map(pick),
          enemies: b.enemies.map(pick),
        };
      });
    const audit = oracle.observe(battle, { frameActors: report.actors });
    const pixels = await inspectFramePixels(page, report.actors);
    assert.deepEqual(errors, []);
    assert.equal(audit.mismatches, 0, `${fixture.name}: raw source identity mismatch`);
    assert.ok(
      report.actors.filter((row) => row.side === "player" && row.drawn && row.resource).length >=
        fixture.party.length,
    );
    await writeFile(
      path.join(output, `${fixture.name}.png`),
      Buffer.from(report.screenshot.dataURL.split(",")[1], "base64"),
    );
    results.push({
      fixture,
      sourceSave: "checkpoints-before-specials/merchant-passage.json",
      ...audit,
      frames: report.actors,
      selectedTexturePixels: pixels,
      pixelIssues: pixels.filter((row) => row.issue || row.error),
      errors,
      screenshot: `${fixture.name}.png`,
    });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(
    path.join(output, "summary.json"),
    JSON.stringify(
      {
        engine,
        scope:
          "Controlled real-Battle presentation fixtures in the static package; no story or formula acceptance. Unresolved special bindings remain unknown.",
        results,
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify(
    results.map(({ fixture, mismatches, unknown, matches }) => ({
      name: fixture.name,
      mismatches,
      unknown,
      matches,
    })),
  ),
);
