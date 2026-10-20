import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4208/";
const output = path.resolve(process.env.PLAY_MOBILE_REPORT_DIR || "build/play/deployment/mobile");
const checkpoint = "mobile-world-start";
const staticMode = process.env.PLAY_MOBILE_STATIC === "1";
await mkdir(output, { recursive: true });
// A real ordinary-attribute M1 save is restored through the existing development
// fixture host. This verifies controls, never grants new plot coverage.
await writeFile(
  `build/play/optional/${checkpoint}.json`,
  await readFile("build/play/acceptance/step-7/browsers-strict-chromium/chromium/actual-save.json"),
);
const realSave = JSON.parse(await readFile(`build/play/optional/${checkpoint}.json`));
const backupPath = path.join(output, "mobile-real-save-backup.json");
await writeFile(
  backupPath,
  JSON.stringify({
    format: "ffvi-reweb-saves",
    version: 1,
    records: [
      {
        id: "normal:1",
        mode: "normal",
        slot: 1,
        savedAt: Date.now(),
        map: "世界地图",
        party: [],
        time: realSave.time,
        snapshot: realSave,
      },
    ],
  }),
);
const results = [];
for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    ...(process.env.PLAY_MOBILE_STORAGE_STATE
      ? { storageState: process.env.PLAY_MOBILE_STORAGE_STATE }
      : {}),
  });
  const page = await context.newPage();
  const result = {
    engine,
    scope:
      "Mobile emulation; real trusted pointer/touch actions on ordinary M1 development save fixture, not a native device or new story completion claim.",
    restore: staticMode
      ? "Actual save-backup import UI and title/slot read on the built static website"
      : "Existing development checkpoint fixture host",
    errors: [],
    checks: [],
    status: "running",
  };
  page.on("pageerror", (error) => result.errors.push(error.message));
  const screenshot = (name) =>
    page.screenshot({ path: path.join(output, `${engine}-${name}.png`) });
  const visit = async (panel = "") => {
    const url = new URL(base);
    url.searchParams.set("checkpointSet", "optional");
    url.searchParams.set("checkpoint", checkpoint);
    if (panel) url.searchParams.set("panel", panel);
    if (panel === "battle") url.searchParams.set("formation", "1");
    await page.goto(staticMode ? base : url.href);
    if (staticMode) {
      await page.locator("#cloud-toggle").click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#cloud-panel input[type=file]").setInputFiles(backupPath);
      await page.getByRole("status").filter({ hasText: "已完成" }).waitFor();
      await page
        .locator("#cloud-panel")
        .getByRole("button", { name: "返回游戏", exact: true })
        .click();
      await choose("继续游戏");
      await choose(/(^| · )读取存档 1$/);
      await page.locator("[data-touch-close]").tap();
    }
    await page.waitForFunction(() => window.ffvi?.mapId === 1 && !window.ffvi.loading);
    await page.waitForFunction(() => document.body.classList.contains("touch-enabled"));
  };
  const button = (label) =>
    page.locator("#touch-controls").getByRole("button", { name: label, exact: true });
  const press = async (label, hold = 80) => {
    const rect = await button(label).boundingBox();
    assert.ok(rect);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(hold);
    await page.mouse.up();
  };
  const openOptions = async () => {
    if ((await page.locator("[data-touch-options]").getAttribute("aria-expanded")) !== "true")
      await page.locator("[data-touch-options]").tap();
  };
  const choose = async (name) => {
    await openOptions();
    await page.locator(".touch-options-list").getByRole("button", { name, exact: true }).tap();
  };
  try {
    if (staticMode && process.env.PLAY_MOBILE_STORAGE_STATE && results.length === 0) {
      const response = await context.request.get(new URL("/api/saves", base).href);
      if (response.ok()) {
        const remote = await response.json();
        assert.ok(
          remote.saves.length === 0 || process.env.PLAY_HOST_DISPOSABLE_DB === "1",
          "Mobile acceptance requires empty cloud saves or an explicitly disposable test database",
        );
      }
    }
    await visit();
    assert.equal(await page.evaluate(() => window.ffvi.testBoost), false);
    const before = await page.evaluate(() => ({ ...window.ffvi.player }));
    await press("向下", 700);
    const after = await page.evaluate(() => ({ ...window.ffvi.player }));
    assert.ok(
      before.x !== after.x || before.y !== after.y,
      "Held pointer failed to move the real player",
    );
    await page.waitForTimeout(150);
    const released = await page.evaluate(() => [window.ffvi.player.x, window.ffvi.player.y]);
    await page.waitForTimeout(500);
    assert.deepEqual(
      await page.evaluate(() => [window.ffvi.player.x, window.ffvi.player.y]),
      released,
    );
    result.checks.push({ name: "held movement and pointer release", before, after, released });
    await screenshot("field-portrait");

    if (engine === "chromium") {
      const protocol = await context.newCDPSession(page);
      const right = await button("向右").boundingBox();
      const up = await button("向上").boundingBox();
      const points = [right, up].map((rect, id) => ({
        id: id + 1,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      }));
      await protocol.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: points.slice(0, 1),
      });
      await protocol.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
      assert.equal(await page.locator("[data-game-key].pressed").count(), 2);
      await protocol.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: points.slice(1),
      });
      assert.equal(await page.locator("[data-game-key].pressed").count(), 1);
      assert.equal(
        await button("向右").evaluate((node) => node.classList.contains("pressed")),
        true,
      );
      await protocol.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      assert.equal(await page.locator("[data-game-key].pressed").count(), 0);
      await protocol.detach();
      result.checks.push({
        name: "real Chromium protocol multi-touch keeps the other finger held",
      });
    }

    const down = await button("向下").boundingBox();
    await page.mouse.move(down.x + down.width / 2, down.y + down.height / 2);
    await page.mouse.down();
    // Lifecycle notification is simulated; the held input itself uses the real
    // browser pointer API. No gameplay state is injected.
    await page.evaluate(() => dispatchEvent(new Event("blur")));
    assert.equal(await page.locator("[data-game-key].pressed").count(), 0);
    await page.mouse.up();
    const blurredPosition = await page.evaluate(() => [window.ffvi.player.x, window.ffvi.player.y]);
    await page.waitForTimeout(300);
    assert.deepEqual(
      await page.evaluate(() => [window.ffvi.player.x, window.ffvi.player.y]),
      blurredPosition,
    );
    result.checks.push({ name: "simulated blur notification releases real held pointer input" });

    // A native login field must not leak the account password into game input.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "mobile-account-focus-probe";
      input.style.cssText = "position:fixed;top:55px;left:10px;z-index:99";
      document.body.append(input);
      input.focus();
    });
    const focusedPosition = await page.evaluate(() => [window.ffvi.player.x, window.ffvi.player.y]);
    await page.keyboard.type("wasd WASD");
    await page.waitForTimeout(250);
    assert.deepEqual(
      await page.evaluate(() => [window.ffvi.player.x, window.ffvi.player.y]),
      focusedPosition,
    );
    assert.equal(await page.locator("#mobile-account-focus-probe").inputValue(), "wasd WASD");
    await page.locator("#mobile-account-focus-probe").evaluate((input) => input.remove());
    result.checks.push({ name: "native text entry does not move the game" });

    const up = await button("向上").boundingBox();
    await page.mouse.move(up.x + up.width / 2, up.y + up.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    assert.equal(await page.locator("[data-game-key].pressed").count(), 0);
    await page.mouse.up();
    const rotatedPosition = await page.evaluate(() => [window.ffvi.player.x, window.ffvi.player.y]);
    await page.waitForTimeout(400);
    assert.deepEqual(
      await page.evaluate(() => [window.ffvi.player.x, window.ffvi.player.y]),
      rotatedPosition,
    );
    result.checks.push({ name: "rotation releases held directions", position: rotatedPosition });
    const canvas = await page.locator("#screen").boundingBox();
    const pad = await page.locator(".touch-pad").boundingBox();
    assert.ok(
      canvas.x >= 0 &&
        canvas.y >= 0 &&
        canvas.x + canvas.width <= 844 &&
        canvas.y + canvas.height <= 391 &&
        pad.y < canvas.y + canvas.height,
    );
    for (const selector of [".touch-dpad", ".touch-actions"]) {
      const cluster = await page.locator(selector).boundingBox();
      assert(cluster.x >= canvas.x - 1 && cluster.x + cluster.width <= canvas.x + canvas.width + 1);
      assert(
        cluster.y >= canvas.y - 1 && cluster.y + cluster.height <= canvas.y + canvas.height + 1,
      );
    }
    await screenshot("field-landscape");

    await press("返回或打开菜单");
    await choose("道具");
    await page.waitForTimeout(300);
    const itemLabels = await page.locator(".touch-options-list button").allTextContents();
    assert.ok(itemLabels.some((label) => /· 使用$/.test(label)));
    assert.ok(!itemLabels.includes("使用"), "Generic item actions lost the item they belong to");
    assert.equal(new Set(itemLabels).size, itemLabels.length);
    await screenshot("menu-landscape");
    await choose("装备");
    await page.waitForTimeout(300);
    const equipmentLabels = await page.locator(".touch-options-list button").allTextContents();
    assert.ok(equipmentLabels.some((label) => label.includes("右手")));
    assert.ok(equipmentLabels.some((label) => label.includes("左手")));
    assert.equal(new Set(equipmentLabels).size, equipmentLabels.length);
    await screenshot("equipment-landscape");
    await choose("设置");
    await page.waitForTimeout(300);
    const settingsLabels = await page.locator(".touch-options-list button").allTextContents();
    assert.ok(settingsLabels.some((label) => label.includes("ATB 模式")));
    assert.ok(settingsLabels.some((label) => label.includes("战斗速度")));
    assert.ok(settingsLabels.some((label) => /ATB 模式：等待 ▾$/.test(label)));
    assert.ok(settingsLabels.some((label) => /战斗速度：4 ▾$/.test(label)));
    assert.equal(new Set(settingsLabels).size, settingsLabels.length);
    await screenshot("settings-landscape");
    await choose("存档");
    await page.waitForTimeout(300);
    const saveLabels = await page.locator(".touch-options-list button").allTextContents();
    assert.ok(saveLabels.some((label) => label.includes("存档 2")));
    assert.equal(new Set(saveLabels).size, saveLabels.length);
    const saveAction = saveLabels.find((label) => /(写入|覆盖)存档 2$/.test(label));
    assert.ok(saveAction, "Slot 2 must expose its actual write or overwrite control");
    await choose(saveAction);
    await page
      .locator(".touch-options-list")
      .getByRole("button", { name: /(^| · )覆盖存档 2$/, exact: true })
      .waitFor();
    await screenshot("save-landscape");
    await choose("返回");
    await button("收起").tap();
    await press("返回或打开菜单");
    result.checks.push({
      name: "virtual menu, readable original actions and distinct item/equipment/settings/save labels",
      itemLabels,
      equipmentLabels,
      settingsLabels,
      saveLabels,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    if (!staticMode) {
      await visit("dialogue");
      await openOptions();
      assert.ok((await page.locator(".touch-readout").innerText()).length > 5);
      await screenshot("dialogue-portrait");
      await button("收起").tap();
      await press("确认或交互");
      await press("确认或交互");
      assert.equal(await page.evaluate(() => !!window.ffvi.dialogue), false);
      result.checks.push({ name: "readable dialogue and confirm input" });

      await visit("battle");
      await page.waitForFunction(
        () => window.ffvi.battle?.players.some((unit) => unit.ready),
        null,
        {
          timeout: 20000,
        },
      );
      await choose("攻击");
      const optionsText = await page.locator(".touch-options-list").innerText();
      result.targetOptions = optionsText;
      const enemyName = await page.evaluate(
        () => window.ffvi.battle.enemies.find((unit) => unit.hp > 0).name,
      );
      const target = page
        .locator(".touch-options-list")
        .getByRole("button", { name: enemyName, exact: true });
      for (let n = 0; n < 6 && !(await target.count()); n++) {
        await page
          .locator(".touch-options-list")
          .getByRole("button", { name: "↓ 下页", exact: true })
          .tap();
        await page.waitForTimeout(300);
      }
      await target.waitFor();
      await screenshot("battle-target-portrait");
      await target.tap();
      await page.waitForTimeout(400);
      assert.ok(
        await page.evaluate(() =>
          window.ffvi.battle
            ? window.ffvi.battle.players.some((unit) => unit.pendingAction || !unit.ready)
            : window.ffvi.battles.at(-1)?.encounterId === 1 &&
              window.ffvi.battles.at(-1)?.outcome === "victory",
        ),
      );
      await screenshot("battle-portrait");
      result.checks.push({
        name: "battle command and target through actual mirrored Pixi controls",
      });
    }

    await page.locator("[data-touch-toggle]").tap();
    assert.equal(await page.locator(".touch-pad").isVisible(), false);
    await page.reload();
    await page.locator("[data-touch-toggle]").waitFor();
    assert.equal(await page.locator(".touch-pad").isVisible(), false);
    await page.locator("[data-touch-toggle]").tap();
    assert.equal(await page.locator(".touch-pad").isVisible(), true);
    result.checks.push({ name: "touch preference persists and can be restored" });
    assert.deepEqual(result.errors, []);
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.failure = error.stack;
    await screenshot("failure").catch(() => {});
    process.exitCode = 1;
  } finally {
    await writeFile(
      path.join(output, `${engine}-report.json`),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(engine, result.status, result.failure || "");
    results.push(result);
    await browser.close();
  }
}
await writeFile(path.join(output, "summary.json"), JSON.stringify(results, null, 2) + "\n");
