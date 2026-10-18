import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4226/",
  output = path.resolve(
    process.env.PLAY_CONTROL_REPORT || "build/play/deployment/opening-background/field-browser",
  ),
  saves = "build/play/deployment/opening-background/figaro",
  cases = [
    { name: "maid", file: `${saves}/fixed-final/maid-sabin-memory-save.json`, key: "s", id: 1 },
    { name: "kefka", file: `${saves}/fixed-final/kefka-arrival-save.json`, key: "w", id: 5 },
    { name: "old-maid", file: `${saves}/maid-sabin-memory-save.json`, key: "s", id: 1 },
    {
      name: "old-kefka-autosave",
      file: `${saves}/legacy-kefka-source-autosave.json`,
      key: "w",
      id: 5,
    },
    {
      name: "falcon-landing",
      file: "build/play/stage1-checkpoints/kefka-tower.json",
      key: "a",
      id: 7,
      land: true,
    },
    {
      name: "kefka-arrival-flow",
      file: `${saves}/fixed-final/maid-sabin-memory-save.json`,
      key: "w",
      id: 5,
      arrival: true,
    },
  ];
await mkdir(output, { recursive: true });
const results = [];
for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
  try {
    for (const fixture of cases) {
      const saved = JSON.parse(await readFile(fixture.file)),
        context = await browser.newContext({ viewport: { width: 1280, height: 850 } }),
        page = await context.newPage(),
        errors = [],
        prefix = path.join(output, `${engine}-${fixture.name}`),
        result = { engine, ...fixture, errors, status: "running" };
      results.push(result);
      try {
        page.on("pageerror", (error) => errors.push(error.message));
        if (process.env.PLAY_HOST_PASSWORD_FILE) {
          const password = (await readFile(process.env.PLAY_HOST_PASSWORD_FILE, "utf8"))
              .trim()
              .split(/\r?\n/)
              .at(-1),
            response = await context.request.post(new URL("/api/session", base).href, {
              headers: { Origin: new URL(base).origin },
              data: { password },
            });
          assert.equal(response.status(), 200);
          await context.route("**/*", async (route) => {
            if (new URL(route.request().url()).pathname.startsWith("/api/saves")) {
              errors.push("Unexpected production save access");
              return route.abort();
            }
            if (
              route.request().isNavigationRequest() &&
              route.request().resourceType() === "document"
            ) {
              const response = await route.fetch();
              if ((response.headers()["content-type"] || "").includes("text/html"))
                return route.fulfill({
                  response,
                  body: (await response.text()).replace(
                    /<meta\b[^>]*name=["']ffvi-host["'][^>]*>/i,
                    "",
                  ),
                });
            }
            return route.continue();
          });
        }
        await context.addInitScript((saved) => {
          localStorage.setItem("ffvi-play-test", JSON.stringify(saved));
        }, saved);
        await page.goto(base);
        await page.getByRole("button", { name: "继续剧情测试", exact: true }).click();
        await page.getByRole("button", { name: "自动存档 / 最近继续", exact: true }).click();
        await page.waitForFunction(
          (map) => window.ffvi?.mapId === map && !window.ffvi.loading,
          saved.mapId,
        );
        for (const name of ["自动行走：开", "自动推进：开"])
          if (await page.getByRole("button", { name, exact: true }).count())
            await page.getByRole("button", { name, exact: true }).click();
        if (fixture.arrival) {
          // The existing regression route supplies ordinary walks/interactions
          // from the genuine maid checkpoint. Never dispatch a story script.
          await page.getByRole("button", { name: "自动推进：关", exact: true }).click();
          await page.getByRole("button", { name: "自动行走：关", exact: true }).click();
          await page.waitForFunction(
            () =>
              window.ffvi.history.some((row) => row.script === "sc_e_0029_1") &&
              window.ffvi.dialogue,
            null,
            { timeout: 60000 },
          );
          await page.getByRole("button", { name: "自动行走：开", exact: true }).click();
          await page.getByRole("button", { name: "自动推进：开", exact: true }).click();
          result.arrivalFrames = [];
          let last = "";
          const deadline = Date.now() + 90000;
          while (Date.now() < deadline) {
            const state = await page.evaluate(() => ({
              instruction: window.ffvi.lastInstruction,
              busy: window.ffvi.busy,
              arrived: window.ffvi.banks.ScenarioFlag1[17] === 1,
              dialogue: window.ffvi.dialogue
                ? { text: window.ffvi.dialogue.text, speaker: window.ffvi.dialogue.speaker }
                : null,
            }));
            if (state.dialogue) {
              const marker = JSON.stringify(state.instruction);
              if (marker !== last) {
                last = marker;
                const file = `${prefix}-arrival-${result.arrivalFrames.length}.png`;
                await page.locator("#screen").screenshot({ path: file });
                result.arrivalFrames.push({ file, ...state });
              }
              await page.keyboard.press("Space");
            }
            if (state.arrived && !state.busy) break;
            await page.waitForTimeout(200);
          }
          assert.ok(
            await page.evaluate(
              () => window.ffvi.banks.ScenarioFlag1[17] === 1 && !window.ffvi.busy,
            ),
            "Kefka's real source arrival must finish before ordinary walking",
          );
          assert.ok(result.arrivalFrames.length >= 3);
        }
        if (fixture.land) {
          await page.getByRole("button", { name: "载具操作", exact: true }).click();
          await page.getByRole("button", { name: "着陆", exact: true }).click();
          await page.waitForFunction(
            () => !window.ffvi.busy && !(window.ffvi.player.vehicle > 1),
            null,
            { timeout: 30000 },
          );
        }
        await page.waitForFunction(() => window.ffviRenderMetrics().texturesLoading === 0);
        await page.waitForTimeout(500);
        const state = () =>
          page.evaluate(() => ({
            player: { ...window.ffvi.player },
            camera: { ...window.ffvi.camera },
            leader: window.ffvi.partySlots[window.ffvi.partyIndex][0],
            actors: [...window.ffvi.actors.values()],
            script: window.ffvi.lastInstruction,
            history: window.ffvi.history.slice(-4),
            metrics: window.ffviRenderMetrics(),
          }));
        result.before = await state();
        await page.locator("#screen").screenshot({ path: `${prefix}-before.png` });
        // Ordinary keyboard dispatch, not game.move or a modified plot/save.
        await page.keyboard.down(fixture.key);
        try {
          await page.waitForFunction(
            (before) => {
              const player = window.ffvi.player;
              return player.x !== before.x || player.y !== before.y;
            },
            result.before.player,
            { timeout: 5000 },
          );
        } finally {
          await page.keyboard.up(fixture.key);
        }
        await page.waitForFunction(() => !window.ffvi.player.motion);
        await page.waitForTimeout(250);
        result.after = await state();
        const { player, camera, metrics, leader, actors } = result.after,
          body = metrics.actorFrames.find(
            (actor) => Number(actor.entityId) === -1001 && actor.drawn,
          );
        assert.equal(leader, fixture.id);
        assert.equal(player.characterId, fixture.id);
        assert.equal(player.visible, true);
        assert.equal(camera.manual, false);
        assert.ok(body, "The controlled body must actually select and draw its sprite");
        assert.ok(body.bounds.x < metrics.logicalWidth && body.bounds.x + body.bounds.width > 0);
        assert.ok(body.bounds.y < metrics.logicalHeight && body.bounds.y + body.bounds.height > 0);
        assert.ok(!actors.some((actor) => Number(actor.id) === -fixture.id && actor.visible));
        assert.equal(metrics.texturesFailed, 0);
        assert.deepEqual(errors, []);
        await page.locator("#screen").screenshot({ path: `${prefix}-after.png` });
        const box = await page.locator("#screen").boundingBox(),
          scale = box.width / metrics.logicalWidth,
          x = Math.max(0, body.bounds.x - 15),
          y = Math.max(0, body.bounds.y - 15),
          width = Math.min(metrics.logicalWidth - x, body.bounds.width + 30),
          height = Math.min(metrics.logicalHeight - y, body.bounds.height + 30);
        await page.screenshot({
          path: `${prefix}-body.png`,
          clip: {
            x: box.x + x * scale,
            y: box.y + y * scale,
            width: width * scale,
            height: height * scale,
          },
        });
        result.status = "passed";
      } catch (error) {
        result.status = "failed";
        result.error = error.stack;
      } finally {
        await context.close();
        await writeFile(
          path.join(output, "summary.json"),
          JSON.stringify(
            {
              base,
              scope:
                "Real Continue + WASD with automatic controls off. Genuine source saves, isolated browser profiles, no cloud-save access.",
              results,
            },
            null,
            2,
          ),
        );
      }
    }
  } finally {
    await browser.close();
  }
}
console.log(
  JSON.stringify(
    results.map(({ engine, name, status, error }) => ({ engine, name, status, error })),
  ),
);
if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
