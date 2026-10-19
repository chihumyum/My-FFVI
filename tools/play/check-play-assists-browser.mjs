import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";
import { setBrowserAssists, openBrowserTools } from "./browser-assists.mjs";
const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4173/";
const output = path.resolve(
  process.env.PLAY_ASSISTS_REPORT || "build/play/deployment/menu-assists/controls",
);
await mkdir(output, { recursive: true });
const saved = await readFile(
  "build/play/acceptance/step-7/browsers-final-chromium/chromium/actual-save.json",
);
const results = [];
for (const name of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
  const row = {
    engine: name,
    errors: [],
    checks: [],
    scope:
      "Real ordinary M1 save and PR Guard battle; ordinary tool buttons only after DEV checkpoint setup; no plot flags or combat-stat edits",
  };
  results.push(row);
  const browser = await { chromium, webkit }[name].launch({
    headless: true,
    args: name === "chromium" ? ["--use-angle=metal"] : [],
  });
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    page = await context.newPage();
    page.on("pageerror", (e) => row.errors.push(e.message));
    await page.route("**/evidence/stage1-checkpoints/narshe-rock.json", (route) =>
      route.fulfill({ contentType: "application/json", body: saved }),
    );
    await page.goto(base);
    await page.waitForFunction(
      () =>
        typeof window.ffviPlayOptions === "function" &&
        document.getElementById("boot-status").hidden,
    );
    await page.getByRole("button", { name: "新游戏", exact: true }).waitFor();
    assert.equal(await page.locator("#play-tools").isVisible(), false);
    assert.equal(await page.locator("#location").isVisible(), false);
    assert.equal(await page.locator("#loadtest").count(), 0);
    assert.equal(await page.locator("#test").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "强化回归（开发）", exact: true }).count(),
      0,
    );
    await page.locator("[data-touch-toggle]").tap();
    assert.equal(await page.locator("#play-tools").isVisible(), false);
    assert.equal(await page.locator("#location").isVisible(), false);
    await setBrowserAssists(page, { showLocation: true, invincible: true });
    await page.locator("[data-touch-toggle]").tap();
    assert.equal(await page.locator("#location").isVisible(), true);
    assert.equal(await page.locator("#play-tools").isVisible(), false);
    row.checks.push(
      "Touch off hides tool buttons and location by default; location can remain independently enabled",
    );
    await page.screenshot({ path: path.join(output, `${name}-touch-off-location.png`) });
    const enter = async (panel = "") => {
      await page.goto(
        new URL(`?checkpoint=narshe-rock${panel ? "&panel=" + panel : ""}`, base).href,
      );
      await page.waitForFunction(
        () => window.ffvi && !window.ffviLoading().active && !window.ffvi.loading,
      );
    };
    await enter();
    assert.equal(await page.evaluate(() => window.ffvi.testBoost), false);
    await openBrowserTools(page);
    await page.keyboard.press("F9");
    const feedback = page.getByRole("dialog");
    await feedback.waitFor();
    assert.equal(
      await feedback.getByRole("button", { name: "发送报告", exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await feedback.getByRole("button", { name: "下载报告", exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await feedback.locator("footer").evaluate((e) => getComputedStyle(e).position),
      "static",
    );
    await page.getByRole("button", { name: "关闭问题报告", exact: true }).click();
    await page.locator("#tools-close").click();
    row.checks.push("Touch tool styles cannot hide or reposition feedback dialog actions");
    const stats = await page.evaluate(() =>
      window.ffvi.party.map((u) => ({
        id: u.id,
        level: u.level,
        hp: u.maxHp,
        attack: u.attack,
        strength: u.strength,
        magic: u.magic,
        equipment: u.equipment,
      })),
    );
    await setBrowserAssists(page, { showLocation: false, invincible: false, autoBattle: true });
    const initial = await page.evaluate(() => ({
      map: window.ffvi.mapId,
      x: window.ffvi.player.x,
      y: window.ffvi.player.y,
      time: window.ffvi.time,
    }));
    await page.waitForTimeout(1200);
    const outside = await page.evaluate(() => ({
      map: window.ffvi.mapId,
      x: window.ffvi.player.x,
      y: window.ffvi.player.y,
      time: window.ffvi.time,
    }));
    assert.deepEqual([outside.map, outside.x, outside.y], [initial.map, initial.x, initial.y]);
    const normalTime = outside.time - initial.time;
    await setBrowserAssists(page, { fastForward: true });
    const t = await page.evaluate(() => window.ffvi.time);
    await page.waitForTimeout(1200);
    const fastTime = await page.evaluate((t) => window.ffvi.time - t, t);
    assert(fastTime > normalTime * 2, `normal=${normalTime}, fast=${fastTime}`);
    row.clock = { normalTime, fastTime };
    await setBrowserAssists(page, { fastForward: false, invincible: true, autoBattle: false });
    assert.deepEqual(
      await page.evaluate(() =>
        window.ffvi.party.map((u) => ({
          id: u.id,
          level: u.level,
          hp: u.maxHp,
          attack: u.attack,
          strength: u.strength,
          magic: u.magic,
          equipment: u.equipment,
        })),
      ),
      stats,
    );
    row.checks.push(
      "Auto battle alone does not explore; speed changes only when fast-forward is enabled; invincibility does not rewrite real stats",
    );
    await enter("dialogue");
    await setBrowserAssists(page, { fastForward: true, skipDialogue: false });
    await page.waitForTimeout(700);
    assert(await page.evaluate(() => !!window.ffvi.dialogue));
    await setBrowserAssists(page, { fastForward: false, skipDialogue: true });
    await page.waitForFunction(() => !window.ffvi.dialogue, null, { timeout: 15000 });
    row.checks.push(
      "Fast-only retains dialogue; skip-only advances dialogue without fast-forward or exploration",
    );
    await setBrowserAssists(page, { skipDialogue: false, invincible: true, autoBattle: false });
    await setBrowserAssists(page, { skipDialogue: true });
    await enter("battle&formation=3");
    await page.waitForFunction(() => !!window.ffvi.battle);
    await openBrowserTools(page);
    const pausedTime = await page.evaluate(() => window.ffvi.time);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.ffvi.time), pausedTime);
    await page.screenshot({ path: path.join(output, `${name}-tools.png`) });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#play-tools").isVisible(), false);
    const party = await page.evaluate(() =>
      window.ffvi.party.map((u) => ({
        id: u.id,
        name: u.name,
        hp: u.hp,
        maxHp: u.maxHp,
        level: u.level,
        strength: u.strength,
        magic: u.magic,
        attack: u.attack,
      })),
    );
    const hpBefore = party.map((u) => u.hp);
    await page.waitForFunction(() => window.ffvi.battle?.log.some((l) => l.includes(" → ")), null, {
      timeout: 30000,
    });
    assert.deepEqual(await page.evaluate(() => window.ffvi.party.map((u) => u.hp)), hpBefore);
    assert(
      !(await page.evaluate(() => window.ffvi.battle.log)).some((l) =>
        party.some((u) => l.startsWith(u.name + " →")),
      ),
    );
    await setBrowserAssists(page, { invincible: false });
    await page.waitForFunction(
      (before) => window.ffvi.party.some((u, i) => u.hp < before[i]),
      hpBefore,
      { timeout: 30000 },
    );
    const battles = await page.evaluate(() => window.ffvi.battles.length);
    await setBrowserAssists(page, { invincible: true, autoBattle: true });
    await page.waitForFunction(
      ({ names, battles }) =>
        window.ffvi.battles.length > battles ||
        window.ffvi.battle?.log.some((l) => names.some((n) => l.startsWith(n + " →"))),
      { names: party.map((u) => u.name), battles },
      { timeout: 30000 },
    );
    assert.equal(await page.evaluate(() => window.ffviPlayOptions().story), false);
    row.checks.push(
      "Real normal-stat Guard battle: enemy damage blocked on, player attacks only after auto-battle on, damage resumes immediately off; tools pause combat",
    );
    row.party = party;
    await page.screenshot({ path: path.join(output, `${name}-ordinary-invincible-battle.png`) });
    assert.deepEqual(row.errors, []);
    row.status = "passed";
  } catch (e) {
    row.status = "failed";
    row.failure = e.stack;
    process.exitCode = 1;
    row.state = await page
      ?.evaluate(() => ({
        options: window.ffviPlayOptions?.(),
        time: window.ffvi?.time,
        battle: window.ffvi?.battle?.log,
        loading: window.ffviLoading?.(),
      }))
      .catch(() => null);
    await page?.screenshot({ path: path.join(output, `${name}-failure.png`) }).catch(() => {});
  } finally {
    await browser.close();
    await writeFile(path.join(output, `${name}.json`), JSON.stringify(row, null, 2));
    console.log(JSON.stringify({ engine: name, status: row.status, failure: row.failure }));
  }
}
await writeFile(path.join(output, "report.json"), JSON.stringify(results, null, 2));
