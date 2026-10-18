import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:8788/";
const output = process.env.PLAY_MAGIC_REPORT || "build/play/deployment/magic-targets";
const results = [];
for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
  const directory = path.join(output, engine);
  await mkdir(directory, { recursive: true });
  const report = {
    engine,
    base,
    scope: "Real PR formation 4 in battle lab; ordinary UI inputs, no story/cloud saves",
    errors: [],
    cases: [],
  };
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" ? ["--use-angle=metal"] : [],
  });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    if (process.env.PLAY_HOST_PASSWORD_FILE) {
      const password = (await readFile(process.env.PLAY_HOST_PASSWORD_FILE, "utf8"))
        .trim()
        .split(/\r?\n/)
        .at(-1);
      assert.equal(
        (
          await context.request.post(new URL("api/session", base).href, {
            headers: { Origin: new URL(base).origin },
            data: { password },
          })
        ).status(),
        200,
      );
    }
    page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    await page.goto(new URL("battle-lab.html", base).href);
    await page.locator("#actor option").first().waitFor({ state: "attached" });
    await page.selectOption("#formation", "4");
    async function start() {
      await page.locator("#restart").click();
      await page.getByRole("button", { name: "魔法", exact: true }).click();
      await page.getByRole("button", { name: /^火炎 ·/ }).click();
      await page.getByRole("button", { name: "敌方全体", exact: true }).waitFor();
    }
    async function cast(name, select) {
      await start();
      await page.screenshot({ path: path.join(directory, `${name}-selection.png`) });
      await select();
      await page.waitForFunction(() =>
        document.querySelector("#action-log").textContent.includes("蒂娜 →"),
      );
      const log = await page.locator("#action-log").textContent();
      const actions = log.split("\n").filter((s) => s.startsWith("蒂娜 →"));
      await page.screenshot({ path: path.join(directory, `${name}-result.png`) });
      return { name, actions, log };
    }
    async function clickEnemy() {
      await page.waitForFunction(() => {
        const m = JSON.parse(document.querySelector("#render-metrics").textContent);
        return m.actorFrames.some((a) => a.side === "enemy" && a.drawn);
      });
      const m = JSON.parse(await page.locator("#render-metrics").textContent());
      const enemy = m.actorFrames.find((a) => a.side === "enemy" && a.drawn);
      const box = await page.locator("#screen").boundingBox();
      await page.locator("#screen").click({
        position: {
          x: (enemy.screen.x / m.logicalWidth) * box.width,
          y: ((enemy.screen.y - 8) / m.logicalHeight) * box.height,
        },
      });
    }
    report.cases.push(
      await cast("enemy-all-button", () =>
        page.getByRole("button", { name: "敌方全体", exact: true }).click(),
      ),
    );
    report.cases.push(
      await cast("enemy-all-field-click", async () => {
        await page.keyboard.press("Shift");
        await page.getByRole("button", { name: "目标：全体（Shift 切换）", exact: true }).waitFor();
        await clickEnemy();
      }),
    );
    report.cases.push(await cast("single-field-click", clickEnemy));
    assert.equal(report.cases[0].actions.length, 3);
    assert.equal(report.cases[1].actions.length, 3);
    assert.equal(report.cases[2].actions.length, 1);
    await page.locator("#injured-party").check();
    await page.locator("#restart").click();
    await page.getByRole("button", { name: "魔法", exact: true }).click();
    await page.getByRole("button", { name: /^治疗 ·/ }).click();
    await page.getByRole("button", { name: "我方全体", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("#action-log").textContent.includes("回复"),
    );
    const healing = (await page.locator("#action-log").textContent())
      .split("\n")
      .filter((s) => s.startsWith("蒂娜 →"));
    assert.equal(healing.length, 2);
    const recovery = JSON.parse(
      await page.locator("#render-metrics").textContent(),
    ).actionEvents.filter((e) => e.abilityId === 31);
    report.cases.push({ name: "party-all-healing", actions: healing, recovery });
    assert.equal(recovery.length, 2);
    assert(
      recovery.every((e) => e.result.amount <= -2000 && e.targetHp === e.targetMaxHp),
      "Cure must restore both injured allies to full HP, including any intervening enemy damage",
    );
    await page.screenshot({ path: path.join(directory, "party-all-healing.png") });
    assert.deepEqual(report.errors, []);
    report.status = "passed";
  } catch (e) {
    report.status = "failed";
    report.failure = e.stack;
    await page?.screenshot({ path: path.join(directory, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    results.push(report);
    await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        engine,
        status: report.status,
        cases: report.cases.map((c) => ({ name: c.name, targets: c.actions.length })),
        failure: report.failure,
      }),
    );
  }
}
await writeFile(
  path.join(output, "summary.json"),
  JSON.stringify(
    { status: results.every((r) => r.status === "passed") ? "passed" : "failed", results },
    null,
    2,
  ),
);
