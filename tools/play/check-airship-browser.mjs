import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4232/",
  output = process.env.PLAY_FLIGHT_REPORT || "build/play/deployment/pr-flight/browser";
await mkdir(output, { recursive: true });
const results = [];
for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
  });
  try {
    for (const fixture of [
      { name: "falcon", file: "build/play/stage1-checkpoints/kefka-tower.json" },
      { name: "blackjack-story", file: "build/play/stage1-checkpoints/blackjack-deal.json" },
    ]) {
      const folder = path.join(output, `${engine}-${fixture.name}`);
      await mkdir(folder, { recursive: true });
      const context = await browser.newContext({
          viewport: { width: 1280, height: 850 },
          recordVideo: { dir: folder, size: { width: 960, height: 640 } },
        }),
        page = await context.newPage();
      const result = {
        engine,
        ...fixture,
        status: "running",
        errors: [],
        frames: [],
        scope:
          "Real regression save restored through the actual Continue UI. Ordinary keyboard/vehicle menu and existing automatic story inputs only. No flags, positions, task lists or plot scripts injected; isolated browser storage, no cloud saves.",
      };
      results.push(result);
      page.on("pageerror", (e) => result.errors.push(e.message));
      try {
        if (process.env.PLAY_HOST_PASSWORD_FILE) {
          const password = (await readFile(process.env.PLAY_HOST_PASSWORD_FILE, "utf8"))
            .trim()
            .split(/\r?\n/)
            .at(-1);
          const response = await context.request.post(new URL("/api/session", base).href, {
            headers: { Origin: new URL(base).origin },
            data: { password },
          });
          assert.equal(response.status(), 200);
        }
        // Acceptance owns a disposable save profile. Disable only host sync UI;
        // shipped JS/data bytes are unchanged, and production saves are blocked.
        await context.route("**/*", async (route) => {
          if (new URL(route.request().url()).pathname.startsWith("/api/saves")) {
            result.errors.push("Unexpected production save access");
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
                body: (await response.text()).replace(/<meta name="ffvi-host" content="1">/g, ""),
              });
          }
          return route.continue();
        });
        await context.addInitScript(
          (saved) => localStorage.setItem("ffvi-play-test", JSON.stringify(saved)),
          JSON.parse(await readFile(fixture.file)),
        );
        await page.goto(base);
        await page.getByRole("button", { name: "继续剧情测试", exact: true }).click();
        await page.getByRole("button", { name: "自动存档 / 最近继续", exact: true }).click();
        await page.waitForFunction(() => window.ffvi && !window.ffvi.loading);
        for (const name of ["自动行走：开", "自动推进：开"])
          if (await page.getByRole("button", { name, exact: true }).count())
            await page.getByRole("button", { name, exact: true }).click();
        const state = () =>
          page.evaluate(() => ({
            time: window.ffvi.time,
            mapId: window.ffvi.mapId,
            player: window.ffvi.player,
            busy: window.ffvi.busy,
            last: window.ffvi.lastInstruction,
            field: window.ffviRenderMetrics().field,
            actorFrames: window.ffviRenderMetrics().actorFrames,
            failed: window.ffviRenderMetrics().texturesFailed,
          }));
        const capture = async (label) => {
          const row = { label, ...(await state()) };
          row.file = path.join(
            folder,
            `${String(result.frames.length).padStart(3, "0")}-${label}.png`,
          );
          await page.locator("#screen").screenshot({ path: row.file });
          result.frames.push(row);
          return row;
        };
        if (fixture.name === "falcon") {
          await page.waitForFunction(() => window.ffviRenderMetrics().texturesLoading === 0);
          await capture("normal");
          await page.waitForTimeout(120);
          await capture("normal-animation");
          for (const key of ["w", "a", "s", "d", "s", "a", "w", "d"]) {
            const before = await state();
            await page.keyboard.down(key);
            await page.waitForFunction(
              (p) => window.ffvi.player.x !== p.x || window.ffvi.player.y !== p.y,
              before.player,
            );
            await capture(`turn-${key}`);
            await page.keyboard.up(key);
            await page.waitForFunction(() => !window.ffvi.player.motion);
            await page.waitForTimeout(350);
            const row = await capture(`steady-${key}`);
            assert.equal(row.field.flight, true);
            assert.ok(row.actorFrames.some((a) => Number(a.entityId) === -1001 && a.drawn));
          }
          // This exact source checkpoint lands on legal ground. Restore it through
          // Continue again rather than teach a test pilot to find a landing tile.
          await page.reload();
          await page.getByRole("button", { name: "继续剧情测试", exact: true }).click();
          await page.getByRole("button", { name: "自动存档 / 最近继续", exact: true }).click();
          await page.waitForFunction(
            () => window.ffvi && !window.ffvi.loading && !window.ffvi.busy,
          );
          await page.getByRole("button", { name: "载具操作", exact: true }).click();
          await page.getByRole("button", { name: "着陆", exact: true }).click();
          for (let n = 0; n < 8; n++) {
            await capture(`landing-${n}`);
            await page.waitForTimeout(100);
          }
          await page.waitForFunction(
            () => Number(window.ffvi.player.vehicle || 1) === 1 && !window.ffvi.busy,
            {},
            { timeout: 15000 },
          );
          await capture("landed");
          await page.getByRole("button", { name: "载具操作", exact: true }).click();
          await page.getByRole("button", { name: "起飞", exact: true }).click();
          for (let n = 0; n < 18; n++) {
            await capture(`takeoff-${n}`);
            await page.waitForTimeout(100);
          }
          await page.waitForFunction(
            () => window.ffvi.player.vehicle === 5 && !window.ffvi.busy,
            {},
            { timeout: 15000 },
          );
          await page.waitForFunction(
            () => window.ffviRenderMetrics().field.flightState?.camera.pitch === 35,
          );
          const airborne = await capture("flying-again");
          if (process.env.PLAY_FLIGHT_CHECK_AUDIO === "1") {
            await page.waitForTimeout(1500);
            const pending = page.waitForEvent("download");
            await page.keyboard.press("F9");
            const download = await pending,
              file = path.join(folder, "flight-audio.json");
            await download.saveAs(file);
            const audio = JSON.parse(await readFile(file)).audio;
            const expected = await page.evaluate(() =>
              Number(
                window.ffvi.data.systemTables.transportation.find(
                  (r) => Number(r.id) === Number(window.ffvi.player.vehicle),
                ).bgm_id,
              ),
            );
            const last = audio.commands.filter((c) => c.name === "PlayBGM").at(-1);
            assert.equal(
              last.i[0],
              expected,
              "Source boarding SysCall must emit its PR transportation BGM",
            );
            assert.equal(audio.currentId, expected, "The PR ship theme must actually be playing");
            result.audio = { file, expected, currentId: audio.currentId, last };
          }
          assert.equal(airborne.player.visible, true);
          assert.ok(
            airborne.actorFrames.some(
              (a) =>
                Number(a.entityId) === -1001 &&
                a.drawn &&
                a.screen.x >= 0 &&
                a.screen.x <= 320 &&
                a.screen.y >= 0 &&
                a.screen.y <= 180,
            ),
            "Completed takeoff must draw the controlled ship",
          );
          assert.ok(
            result.frames.some((f) => f.field.flightState?.pose === "LookRight"),
            "Right bank must use PR's mirrored right clip",
          );
          assert.ok(
            result.frames.some(
              (f) =>
                f.field.flightState?.camera.pitch > 35 && f.field.flightState?.camera.pitch < 82.8,
            ),
            "Must actually observe a transition, not just two endpoints",
          );
        } else {
          await page.getByRole("button", { name: "自动推进：关", exact: true }).click();
          await page.getByRole("button", { name: "自动行走：关", exact: true }).click();
          const deadline = Date.now() + 180000;
          let got = false,
            last = "",
            after = 0;
          while (Date.now() < deadline) {
            const row = await state(),
              flight = row.field.flightState;
            if (row.field.flight && row.player.vehicle === 4) {
              if (!got) {
                // Once the source flight starts, stop regression input speed.
                // The real VM/fade clock continues at ordinary play speed.
                for (const name of ["自动行走：开", "自动推进：开"])
                  if (await page.getByRole("button", { name, exact: true }).count())
                    await page.getByRole("button", { name, exact: true }).click();
                result.ordinaryFlightClock = true;
              }
              got = true;
              const marker = `${Math.floor(row.time * 4)}:${flight.pose}`;
              if (marker !== last) {
                await capture("source-flight");
                last = marker;
              }
            } else if (got && ++after > 5) break;
            await page.waitForTimeout(60);
          }
          assert.ok(got, "The real Blackjack deal must reach its authored automatic flight");
          const flights = result.frames.filter((f) => f.field.flight);
          assert.ok(flights.length >= 3);
          assert.ok(
            flights.some((f) => f.field.flightState.active),
            "Source Add/Start must reach the renderer",
          );
          assert.ok(
            new Set(
              flights.map((f) =>
                JSON.stringify([
                  Math.round(f.field.flightState.offset.x),
                  Math.round(f.field.flightState.offset.y),
                ]),
              ),
            ).size > 1,
            "The 41-second PR move must move the captured terrain",
          );
        }
        assert.deepEqual(result.errors, []);
        assert.ok(result.frames.every((f) => f.failed === 0));
        result.status = "passed";
      } catch (error) {
        result.status = "failed";
        result.error = error.stack;
      } finally {
        const video = page.video();
        await context.close();
        result.video = await video?.path();
        await writeFile(
          path.join(output, "summary.json"),
          JSON.stringify({ results }, null, 2) + "\n",
        );
      }
      console.log(engine, fixture.name, result.status, result.error?.split("\n")[0] || "");
    }
  } finally {
    await browser.close();
  }
}
if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
