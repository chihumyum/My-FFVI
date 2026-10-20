import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { chromium, webkit, devices } from "playwright";
import { directionalControl } from "../../apps/play/ui-interaction.js";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(
  process.env.PLAY_VIRTUAL_GAME_REPORT || "build/play/deployment/mobile-controls/game",
);
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: path.join(root, "vite.config.mjs"),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const result = [];
try {
  for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
    const row = {
      engine,
      errors: [],
      inputs: [],
      scope: "Real boosted Narshe checkpoint and PR formation 4; virtual gamepad only after setup",
    };
    result.push(row);
    const browser = await { chromium, webkit }[engine].launch({
      headless: true,
      args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    let page;
    try {
      const context = await browser.newContext({
        ...devices[engine === "chromium" ? "Pixel 7" : "iPhone 13"],
        viewport: { width: 844, height: 390 },
        hasTouch: true,
        isMobile: true,
      });
      page = await context.newPage();
      page.on("pageerror", (error) => row.errors.push(error.message));
      const tap = async (key) => {
        await page.locator(`[data-game-key="${key}"]`).tap();
        row.inputs.push(key);
        await page.waitForTimeout(90);
      };
      const available = () =>
        page.evaluate(() =>
          window.ffviUIDiagnostics().keyboardControls.map((row, node) => ({ ...row, node })),
        );
      const focus = async (pattern) => {
        for (let attempt = 0; attempt < 30; attempt++) {
          let controls = await available();
          for (
            let wait = 0;
            wait < 30 && !controls.some((control) => pattern.test(control.label));
            wait++
          ) {
            await page.waitForTimeout(100);
            controls = await available();
          }
          const wanted = controls.find((control) => pattern.test(control.label));
          assert.ok(
            wanted,
            `No visible control matching ${pattern}: ${controls.map((c) => c.label).join(" / ")}`,
          );
          const selected = await page.evaluate(() => window.ffviUIDiagnostics().keyboard[0]);
          const current = controls.find((control) => control.current)?.node;
          if (current === wanted.node) return;
          const queue = [{ current, keys: [] }],
            visited = new Set([current]);
          let path;
          while (queue.length) {
            const point = queue.shift();
            if (point.current === wanted.node) {
              path = point.keys;
              break;
            }
            for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
              const next = directionalControl(controls, point.current, key);
              if (next !== null && !visited.has(next)) {
                visited.add(next);
                queue.push({ current: next, keys: [...point.keys, key] });
              }
            }
          }
          assert.ok(path?.length, `No directional UI route to ${wanted.label}; focus=${selected}`);
          await tap(path[0]);
        }
        throw Error(`Virtual focus did not reach ${pattern}`);
      };
      const activate = async (label) => {
        await focus(label);
        await tap("Enter");
      };
      await page.goto(`${base}?checkpoint=narshe-rock&panel=battle&formation=4`);
      await page.waitForFunction(
        () =>
          window.ffvi?.battle?.phase === "active" &&
          !window.ffviLoading().active &&
          window.ffvi.battle.players.filter((unit) => unit.ready).length > 1,
        null,
        { timeout: 60000 },
      );
      await page.getByRole("button", { name: "魔法", exact: true }).waitFor();
      row.userAgent = await page.evaluate(() => navigator.userAgent);
      row.layout = [];
      for (const size of [
        { width: 844, height: 390 },
        { width: 932, height: 430 },
        { width: 844, height: 330 },
        { width: 844, height: 430 },
        { width: 1024, height: 768 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(250);
        const geometry = await page.evaluate(() => {
          const rect = (selector) =>
            document.querySelector(selector).getBoundingClientRect().toJSON();
          return {
            screen: rect("#screen"),
            directions: rect(".touch-dpad"),
            actions: rect(".touch-actions"),
            bodyPadding: getComputedStyle(document.body).padding,
            mode: document.querySelector("#touch-controls").dataset.layout,
            back: document.querySelector('[data-game-key="Escape"]').textContent,
            opacity: getComputedStyle(document.querySelector('[data-game-key="Escape"]')).opacity,
          };
        });
        const frame = geometry.screen;
        assert.equal(geometry.bodyPadding, "0px", "Controls must not reserve viewport space");
        const expectedWidth = Math.min(size.width, (size.height * 16) / 9);
        assert(
          Math.abs(frame.width - expectedWidth) < 2,
          "Game must use the full aspect-correct viewport",
        );
        assert.match(geometry.back, /返回/);
        if (size.width > size.height) {
          assert.equal(geometry.mode, "floating");
          assert(Number(geometry.opacity) < 1);
          for (const cluster of [geometry.directions, geometry.actions])
            assert(
              cluster.left >= frame.left - 1 &&
                cluster.right <= frame.right + 1 &&
                cluster.top >= frame.top - 1 &&
                cluster.bottom <= frame.bottom + 1,
              `Buttons must float inside the actual game frame: ${JSON.stringify({ size, geometry })}`,
            );
        }
        row.layout.push({ size, ...geometry });
        await page.screenshot({
          path: path.join(output, `${engine}-layout-${size.width}x${size.height}.png`),
        });
      }
      row.start = await page.evaluate(() => ({
        mapId: window.ffvi.mapId,
        party: window.ffvi.battle.players.map((u) => u.name),
        enemies: window.ffvi.battle.enemies.map((u) => u.name),
        metrics: window.ffviRenderMetrics(),
        battles: window.ffvi.battles.length,
      }));
      await page.screenshot({ path: path.join(output, `${engine}-battle-start.png`) });
      await tap("Tab");
      await page.getByRole("button", { name: "机械", exact: true }).waitFor();
      row.actorCycle = true;
      await activate(/^道具$/);
      await page.getByRole("button", { name: "← 指令", exact: true }).waitFor();
      await tap("Escape");
      await page.getByRole("button", { name: "机械", exact: true }).waitFor();
      row.submenuCancel = true;
      await activate(/^(攻击|战斗)$/);
      await page.getByRole("button", { name: "取消", exact: true }).waitFor();
      await tap("Escape");
      if (!(await available()).some((control) => control.label === "机械")) await tap("Escape");
      await page.getByRole("button", { name: "机械", exact: true }).waitFor();
      row.targetCancel = true;
      for (
        let n = 0;
        n < 4 && !(await available()).some((control) => control.label === "魔法");
        n++
      )
        await tap("Tab");
      await page.getByRole("button", { name: "魔法", exact: true }).waitFor();
      await activate(/^魔法$/);
      await focus(/^火炎 ·/);
      await page.screenshot({ path: path.join(output, `${engine}-magic-submenu.png`) });
      await tap("Enter");
      await page.getByRole("button", { name: "敌方全体", exact: true }).waitFor();
      await focus(/^敌方全体$/);
      await page.screenshot({ path: path.join(output, `${engine}-magic-target.png`) });
      await tap("Enter");
      await page.waitForFunction(
        (count) =>
          window.ffvi.battles.length > count ||
          window.ffvi.battle?.log.some((line) => line.includes("火炎")),
        row.start.battles,
        { timeout: 30000 },
      );
      row.magicAndTarget = true;
      await page
        .getByRole("button", { name: "继续（空格 / Enter）", exact: true })
        .waitFor({ timeout: 30000 });
      await tap("Enter");
      await page.waitForFunction(() => !window.ffvi.battle && !window.ffvi.busy, null, {
        timeout: 30000,
      });
      await tap("Escape");
      await page.getByRole("button", { name: "设置", exact: true }).waitFor();
      await activate(/^设置$/);
      await focus(/^ATB 模式：/);
      await tap("Enter");
      await focus(/^主动$/);
      await tap("Enter");
      await page.waitForFunction(() => window.ffvi.settings.atbMode === "active");
      row.menuSelect = true;
      await page.screenshot({ path: path.join(output, `${engine}-settings.png`) });
      const pinch = async (name) => {
        const controlsBefore = await available();
        const buttonBefore = await page.locator('[data-game-key="Enter"]').boundingBox();
        const box = await page.locator("#screen").boundingBox();
        const y = box.y + box.height * 0.45;
        const left = box.x + box.width * 0.4,
          right = box.x + box.width * 0.6;
        const pointer = (type, id, x) =>
          page.locator("#screen").dispatchEvent(type, {
            pointerType: "touch",
            pointerId: id,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          });
        if (engine === "chromium") {
          const cdp = await context.newCDPSession(page);
          const touch = (type, points) =>
            cdp.send("Input.dispatchTouchEvent", {
              type,
              touchPoints: points.map(([id, x]) => ({ id, x, y })),
            });
          await touch("touchStart", [[1, left]]);
          await touch("touchStart", [
            [1, left],
            [2, right],
          ]);
          await touch("touchMove", [
            [1, left - 60],
            [2, right + 60],
          ]);
          await touch("touchEnd", []);
        } else {
          await pointer("pointerdown", 1, left);
          await pointer("pointerdown", 2, right);
          await pointer("pointermove", 1, left - 60);
          await pointer("pointermove", 2, right + 60);
          await pointer("pointerup", 1, left - 60);
          await pointer("pointerup", 2, right + 60);
        }
        const zoom = await page.evaluate(() => window.ffviRenderMetrics().gameZoom);
        assert.equal(
          await page.evaluate(() => window.visualViewport?.scale || 1),
          1,
          "Pinch must resize the game world, not the Android browser page",
        );
        assert.ok(zoom.scale > 1.5, "Pinch did not update the real world renderer");
        assert.deepEqual(await page.locator('[data-game-key="Enter"]').boundingBox(), buttonBefore);
        assert.deepEqual(
          await page.locator("#screen").boundingBox(),
          box,
          "Pinch resized the canvas instead of the world",
        );
        assert.deepEqual(
          (await available()).map(({ current, ...control }) => control),
          controlsBefore.map(({ current, ...control }) => control),
        );
        assert.equal(
          await page.evaluate(() => window.ffvi.settings.atbMode),
          "active",
          "Pinch accidentally selected a menu action",
        );
        row[name] = { zoom, keepsUI: true, canvas: box };
        await page.screenshot({ path: path.join(output, `${engine}-${name}.png`) });
        if (name === "worldZoom") {
          await page.locator("[data-touch-toggle]").tap();
          assert.deepEqual(await page.evaluate(() => window.ffviRenderMetrics().gameZoom), zoom);
          assert.deepEqual(await page.locator("#screen").boundingBox(), box);
          await page.locator("[data-touch-toggle]").tap();
          assert.deepEqual(await page.evaluate(() => window.ffviRenderMetrics().gameZoom), zoom);
          row.preservesZoomAcrossTouchToggle = true;
        }
        await page.locator("[data-touch-zoom]").tap();
      };
      await pinch("menuZoom");
      await tap("Escape");
      await page.waitForFunction(() => !document.body.classList.contains("modern-menu"));
      await page.waitForFunction(() => !window.ffviLoading().active);
      await page.screenshot({ path: path.join(output, `${engine}-world-before-zoom.png`) });
      await pinch("worldZoom");
      const touchOnFrame = await page.locator("#screen").boundingBox();
      await page.locator("[data-touch-toggle]").tap();
      assert.equal(await page.locator("[data-touch-toggle]").getAttribute("aria-pressed"), "false");
      await page.waitForTimeout(150);
      assert.deepEqual(
        await page.locator("#screen").boundingBox(),
        touchOnFrame,
        "Hiding the gamepad must not shrink or move the game frame",
      );
      await pinch("touchOffZoom");
      await page.locator("[data-touch-toggle]").tap();
      await tap("Escape");
      row.github = [];
      assert.ok(
        (await available()).some((control) => control.label === "报告问题"),
        "Menu report entry is clipped or inaccessible",
      );
      row.reportEntryVisible = true;
      await context.route("https://github.com/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<title>Captured GitHub destination</title>",
        }),
      );
      for (const [label, url] of [
        [/^GitHub 项目$/, "https://github.com/chihumyum/My-FFVI"],
        [/^作者 GitHub$/, "https://github.com/chihumyum"],
      ]) {
        await focus(label);
        const popup = page.waitForEvent("popup");
        await tap("Enter");
        const opened = await popup;
        await opened.waitForURL(url);
        row.github.push(opened.url());
        await opened.close();
      }
      await tap("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base);
      await page.waitForFunction(
        () => window.ffviUIDiagnostics && !window.ffviLoading().active,
        null,
        { timeout: 60000 },
      );
      await activate(/^额外内容$/);
      await page.getByRole("button", { name: "图鉴", exact: true }).waitFor();
      await tap("Escape");
      await page.getByRole("button", { name: "新游戏", exact: true }).waitFor();
      row.titleNavigation = true;
      await page.screenshot({ path: path.join(output, `${engine}-portrait-title.png`) });
      assert.deepEqual(row.errors, []);
      row.status = "passed";
      await context.close();
    } catch (error) {
      row.status = "failed";
      row.failure = error.stack;
      row.diagnostics = await page?.evaluate(() => window.ffviUIDiagnostics?.()).catch(() => null);
      row.failureState = await page
        ?.evaluate(() => ({
          metrics: window.ffviRenderMetrics?.(),
          loading: window.ffviLoading?.(),
          body: document.body.className,
          canvas: {
            width: document.querySelector("canvas").width,
            height: document.querySelector("canvas").height,
            rect: document.querySelector("canvas").getBoundingClientRect().toJSON(),
          },
          controls: [...document.querySelectorAll(".pixi-accessibility button")].map((node) => ({
            label: node.getAttribute("aria-label"),
            rect: node.getBoundingClientRect().toJSON(),
          })),
        }))
        .catch(() => null);
      await page?.screenshot({ path: path.join(output, `${engine}-failure.png`) }).catch(() => {});
      process.exitCode = 1;
    } finally {
      await browser.close();
      await writeFile(path.join(output, `${engine}.json`), JSON.stringify(row, null, 2));
      console.log(
        JSON.stringify({ engine, status: row.status, failure: row.failure, inputs: row.inputs }),
      );
    }
  }
} finally {
  await server.close();
}
await writeFile(path.join(output, "report.json"), JSON.stringify(result, null, 2));
