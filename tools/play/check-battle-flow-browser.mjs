import { clickRegressionControl } from "./browser-assists.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const base = process.env.PLAY_WEB_URL || "http://127.0.0.1:4207/";
const output = path.resolve(
  process.env.PLAY_BATTLE_FLOW_REPORT || "build/play/battle-flow/browser",
);
const catalog = JSON.parse(await readFile("build/web-data/battle-presentation.json"));
const results = [];
async function openingFrames(page, directory) {
  // Actor coordinates and falling snow cannot prove the armors animate.
  // Check the rendered sprite selections well after their first cycle.
  await clickRegressionControl(page, "自动行走：开");
  await page.waitForFunction(() => {
    const game = window.ffvi;
    return !game.fade || game.time >= game.fade.start + game.fade.duration;
  });
  const samples = [];
  await mkdir(path.join(directory, "march-frames"), { recursive: true });
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(200);
    const sample = await page.evaluate(() => ({
      time: window.ffvi.time,
      actors: window.ffviRenderMetrics().actorFrames,
      failed: window.ffviRenderMetrics().texturesFailed,
    }));
    // Read the compositor's screenshot, not a discarded WebGL back buffer.
    const screenshot = await page.locator("#screen").screenshot({
      path: path.join(directory, "march-frames", `${String(i).padStart(2, "0")}.png`),
    });
    sample.distantCityPixels = await page.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: "image/png" }),
      );
      const copy = document.createElement("canvas");
      copy.width = 320;
      copy.height = 180;
      const ctx = copy.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, 0, 0, 320, 180);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, 320, 180).data;
      let distantCityPixels = 0;
      for (let y = 25; y < 94; y++)
        for (let x = 50; x < 250; x++) {
          const at = (y * 320 + x) * 4,
            [r, g, b] = pixels.slice(at, at + 3);
          if (r > 45 && r > g * 1.15 && g > b * 1.2) distantCityPixels++;
        }
      return distantCityPixels;
    }, screenshot.toString("base64"));
    samples.push(sample);
  }
  const actors = ["2", "3", "4"].map((id) => ({
    id,
    frames: [
      ...new Set(
        samples.flatMap((s) =>
          s.actors.filter((a) => String(a.entityId) === id).map((a) => a.frame),
        ),
      ),
    ],
  }));
  const report = { mode: "ordinary inputs; automatic walking/advance both off", samples, actors };
  await writeFile(path.join(directory, "march-frames.json"), JSON.stringify(report, null, 2));
  assert(
    samples.every((s) => s.failed === 0 && s.actors.length === 3 && s.actors.every((a) => a.drawn)),
  );
  assert(
    actors.every((a) => a.frames.length >= 6),
    "each armor must keep stepping after its first cycle",
  );
  assert(
    samples.every((sample) => sample.distantCityPixels >= 12),
    "The original distant Narshe lights must be present in the actual composed canvas",
  );
  await clickRegressionControl(page, "自动行走：关");
  await clickRegressionControl(page, "自动推进：开");
  return report;
}
async function sceneAudioChecks(page, directory) {
  const fixtures = [
    { file: "build/play/stage1-checkpoints/befriend-gau.json", bgm: 19, slot: 1 },
    { file: "build/play/stage1-checkpoints/figaro-escape.json", bgm: 44, slot: 2 },
  ];
  const originals = await Promise.all(
    fixtures.map(async (row) => ({ ...row, snapshot: JSON.parse(await readFile(row.file)) })),
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#cloud-toggle").click();
  await page.locator('#cloud-panel input[type="file"]').setInputFiles({
    name: "actual-legacy-regression-saves.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "ffvi-reweb-saves",
        version: 1,
        records: originals.map((row) => ({
          id: `story-test:${row.slot}`,
          mode: "story-test",
          slot: row.slot,
          savedAt: Date.now(),
          time: row.snapshot.time,
          map: `实际回归地图 ${row.snapshot.mapId}`,
          party: [],
          snapshot: row.snapshot,
        })),
      }),
    ),
  });
  await page.locator("#cloud-panel").getByText("已完成", { exact: true }).waitFor();
  await page.locator("#cloud-panel").getByRole("button", { name: "返回游戏", exact: true }).click();
  const findings = [];
  for (const row of originals) {
    await clickRegressionControl(page, "继续剧情测试");
    await page.getByRole("button", { name: `读取存档 ${row.slot}`, exact: true }).click();
    await page.waitForFunction(
      ({ map, bgm }) =>
        window.ffvi?.mapId === map && !window.ffvi.loading && window.ffviBattleFlow().music === bgm,
      { map: row.snapshot.mapId, bgm: row.bgm },
      { timeout: 20000 },
    );
    const state = await page.evaluate(() => ({
      audio: window.ffvi.snapshot().audio,
      flags: Object.fromEntries(
        [1, 2, 3, 4].map((n) => [n, window.ffvi.banks[`ScenarioFlag${n}`]]),
      ),
      inventory: window.ffvi.inventory,
      gil: window.ffvi.gil,
    }));
    for (const n of [1, 2, 3, 4])
      assert.deepEqual(state.flags[n], row.snapshot.banks[`ScenarioFlag${n}`]);
    assert.deepEqual(state.inventory, row.snapshot.inventory);
    assert.equal(state.gil, row.snapshot.gil);
    assert.equal(state.audio.music.id, row.bgm);
    await page.screenshot({
      path: path.join(directory, `06-scene-audio-${row.snapshot.mapId}.png`),
    });
    findings.push({
      file: row.file,
      mapId: row.snapshot.mapId,
      bgm: row.bgm,
      flagsUnchanged: true,
    });
    if (row.slot === 1) {
      await page.waitForTimeout(1200);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "存档", exact: true }).click();
      await page.getByRole("button", { name: "覆盖存档 1", exact: true }).click();
      await page.waitForTimeout(300);
      const saved = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open("ffvi-pr-saves", 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        return new Promise((resolve, reject) => {
          const r = db.transaction("slots").objectStore("slots").get("story-test:1");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      });
      assert.equal(saved.snapshot.audio.music.id, row.bgm);
      assert(saved.snapshot.audio.music.offset > 0);
      await page.reload();
      await page.locator("#cloud-toggle").waitFor();
      await clickRegressionControl(page, "继续剧情测试");
      await page.getByRole("button", { name: "读取存档 1", exact: true }).click();
      await page.waitForFunction(() => window.ffviBattleFlow().music === 19);
      assert(
        await page.evaluate(
          (offset) => window.ffviBattleFlow().musicPosition >= offset - 0.05,
          saved.snapshot.audio.music.offset,
        ),
      );
      findings.at(-1).savedOffset = saved.snapshot.audio.music.offset;
      findings.at(-1).reloadPreservesOffset = true;
    }
  }
  return findings;
}
for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
  const directory = path.join(output, engine);
  await mkdir(directory, { recursive: true });
  const report = { engine, base, checks: [], errors: [], failedResponses: [], status: "running" };
  let browser, page;
  try {
    browser = await { chromium, webkit }[engine].launch({
      headless: true,
      args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
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
      // Authenticated production assets, isolated gameplay acceptance. Disable
      // ONLY this disposable profile's cloud adapter to avoid writing the user's
      // live autosave. No save API responses or gameplay state are fabricated.
      await context.route("**/*", async (route) => {
        if (new URL(route.request().url()).pathname.startsWith("/api/saves")) {
          report.errors.push("Acceptance profile unexpectedly attempted the cloud-save API");
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
      report.cloud = "Disabled only in isolated acceptance profile; production saves untouched";
    }
    page = await context.newPage();
    report.audioWarnings = [];
    page.on("console", (message) => {
      if (message.text().startsWith("[audio]")) report.audioWarnings.push(message.text());
    });
    page.on("pageerror", (error) => report.errors.push(error.stack || error.message));
    page.on("response", (r) => {
      if (r.status() >= 400) report.failedResponses.push({ url: r.url(), status: r.status() });
    });
    await page.goto(new URL("?through=M1", base).href);
    await page.locator("#cloud-toggle").waitFor();
    await page.getByRole("button", { name: "新游戏", exact: true }).click();
    await page.waitForFunction(() => window.ffvi && !window.ffvi.loading && window.ffvi.mapId);
    await clickRegressionControl(page, "自动行走：关");
    if (process.env.PLAY_CHECK_AUDIO_SYNC === "1") {
      await page.waitForFunction(
        () => window.ffvi?.mapId === 609 && window.ffvi.furthest?.script === "sc_e_0001_3",
        null,
        { timeout: 60000 },
      );
      await clickRegressionControl(page, "自动行走：开");
      await clickRegressionControl(page, "自动推进：开");
      const deadline = Date.now() + 60000;
      while (!(await page.evaluate(() => window.ffviBattleFlow().musicSyncPending))) {
        assert(Date.now() < deadline, "manual opening must reach its original SyncBGM");
        await page.keyboard.press("Space");
        await page.waitForTimeout(250);
      }
      const held = await page.evaluate(() => ({
        time: window.ffvi.time,
        instruction: window.ffvi.lastInstruction,
        flow: window.ffviBattleFlow(),
      }));
      assert.equal(held.instruction.script, "sc_e_0001_3");
      assert.equal(held.instruction.index, 18);
      assert.equal(held.flow.music, 1);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => window.ffvi.time), held.time);
      await page.waitForFunction(() => !window.ffviBattleFlow().musicSyncPending, null, {
        timeout: 80000,
      });
      report.openingMusicSync = held;
      report.checks.push(
        "Original opening SyncBGM holds before the next source instruction until BGM1 actually finishes",
      );
      await clickRegressionControl(page, "自动行走：关");
    }
    await page.waitForFunction(
      () =>
        window.ffvi?.mapId === 609 &&
        window.ffvi.furthest?.script === "sc_e_0001_3" &&
        [-1001, -31, -32].every((id) =>
          window.ffviRenderMetrics().actorFrames.some((a) => Number(a.entityId) === id && a.drawn),
        ),
      null,
      { timeout: 60000 },
    );
    await clickRegressionControl(page, "自动推进：开");
    await clickRegressionControl(page, "自动行走：开");
    await page.waitForFunction(() => window.ffviRenderMetrics().texturesLoading === 0);
    report.cliff = await page.evaluate(() => window.ffviRenderMetrics().actorFrames);
    for (const id of [-1001, -31, -32])
      assert(
        report.cliff.some((a) => Number(a.entityId) === id && a.drawn),
        `cliff actor ${id} must be drawn`,
      );
    await page.screenshot({ path: path.join(directory, "00-cliff-three-actors.png") });
    report.checks.push("Cliff source party puppets display Terra and both soldiers");
    await clickRegressionControl(page, "自动行走：关");
    await page.waitForFunction(
      () => window.ffvi?.mapId === 572 && window.ffvi.actors.get("2")?.motion,
      null,
      { timeout: 120000 },
    );
    await clickRegressionControl(page, "自动推进：开");
    await page.waitForTimeout(4200);
    const march = await page.evaluate(() => ({
      map: window.ffvi.mapId,
      time: window.ffvi.time,
      positions: ["2", "3", "4"].map((id) => {
        const a = window.ffvi.actors.get(id);
        return { id, y: a.y, animation: a.animation, duration: a.motion?.duration };
      }),
      frame: window.ffviRenderMetrics(),
      audio: window.ffviBattleFlow(),
    }));
    assert(march.positions.every((a) => a.duration === 117));
    assert.equal(march.audio.music, 2, "snow march uses the distinct original BGM2 segment");
    await page.screenshot({ path: path.join(directory, "01-snow-march.png") });
    await page.waitForTimeout(650);
    const after = await page.evaluate(() =>
      [...window.ffvi.actors.values()]
        .filter((a) => ["2", "3", "4"].includes(String(a.id)))
        .map((a) => ({ id: String(a.id), y: a.y })),
    );
    assert(after.every((a) => a.y < march.positions.find((old) => old.id === a.id).y));
    await page.screenshot({ path: path.join(directory, "02-snow-march-moving.png") });
    report.march = march;
    report.checks.push(
      "Original 117-second opening puppets, PR scenery and moving armor in browser",
    );
    report.marchAnimation = await openingFrames(page, directory);
    report.checks.push(
      "All three rendered armor sprites keep stepping with both automatic controls off",
    );
    if (process.env.PLAY_OPENING_ONLY === "1") {
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.failedResponses, []);
      report.status = "passed";
      continue;
    }
    await clickRegressionControl(page, "自动推进：关");
    await page.waitForFunction(() => !!window.ffvi?.battle, null, { timeout: 120000 });
    await clickRegressionControl(page, "自动行走：开");
    await clickRegressionControl(page, "自动推进：开");
    await page.getByRole("button", { name: "魔导", exact: true }).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => window.ffviBattleFlow().music === 6);
    report.entry = await page.evaluate(() => window.ffviBattleFlow());
    assert.equal(report.entry.audioState, "running");
    await page.getByRole("button", { name: "魔导", exact: true }).click();
    await page.getByRole("button", { name: /^火炎射线/ }).click();
    const target = await page.evaluate(() => {
      const b = window.ffvi.battle,
        unit = b.enemies.find((u) => b.targetable(u));
      return { slot: unit.slot, x: unit.x || 0, y: unit.y || 0, height: unit.sprite.height };
    });
    const rectangle = await page.locator("#screen").boundingBox();
    const slot = catalog.enemySlots[target.slot];
    await page.locator("#screen").click({
      position: {
        x: ((192 + catalog.enemyOrigin.x + slot.x + target.x) / 384) * rectangle.width,
        y:
          ((108 - catalog.enemyOrigin.y - slot.y - target.y - target.height / 2) / 216) *
          rectangle.height,
      },
    });
    await page.waitForFunction(() => window.ffviBattleFlow().banner === "火炎射线", null, {
      timeout: 15000,
    });
    const frozen = await page.evaluate(() => ({
      time: window.ffvi.time,
      atb: window.ffvi.battle.players.map((p) => p.atb),
    }));
    await page.waitForTimeout(350);
    assert.equal(
      await page.getByRole("button", { name: /[↑↓] [上下]页/ }).count(),
      0,
      "a skill banner must not be clipped into a scrollable menu",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        time: window.ffvi.time,
        atb: window.ffvi.battle.players.map((p) => p.atb),
      })),
      frozen,
    );
    await page.screenshot({ path: path.join(directory, "03-action-banner.png") });
    report.checks.push(
      "Battle BGM6 playing; actual Magitek spell selected and enemy clicked; ATB/time frozen while banner/effect plays",
    );
    await clickRegressionControl(page, "自动推进：关");
    await page.waitForFunction(() => window.ffviBattleFlow().phase === "victory", null, {
      timeout: 60000,
    });
    await clickRegressionControl(page, "自动推进：开");
    await page
      .getByRole("button", { name: "继续（空格 / Enter）", exact: true })
      .waitFor({ timeout: 15000 });
    await page.waitForFunction(() => window.ffviBattleFlow().music === 7);
    report.victory = await page.evaluate(() => ({
      flow: window.ffviBattleFlow(),
      result: window.ffvi.battles.at(-1),
      gil: window.ffvi.gil,
      time: window.ffvi.time,
    }));
    await page.screenshot({ path: path.join(directory, "04-victory-result.png") });
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.ffvi.time), report.victory.time);
    assert.equal(report.victory.result.outcome, "victory");
    await page.keyboard.press("Space");
    await page.waitForFunction(() => window.ffviBattleFlow().phase === "idle");
    if (report.victory.flow.previousMusic?.id)
      await page.waitForFunction(
        (id) => window.ffviBattleFlow().music === id,
        report.victory.flow.previousMusic.id,
      );
    report.return = await page.evaluate(() => window.ffviBattleFlow());
    await page.screenshot({ path: path.join(directory, "05-field-return.png") });
    report.checks.push(
      "Victory BGM7, real rewards held until Space, original field music restored",
    );
    report.sceneAudio = await sceneAudioChecks(page, directory);
    report.checks.push(
      "Actual old saves: map-table BGM19, flag-selected Figaro BGM44, unchanged flags/inventory; new audio save/reload preserves song position",
    );
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.failedResponses, []);
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failure = error.stack || String(error);
    if (page) {
      report.failureState = await page
        .evaluate(() => ({
          mapId: window.ffvi?.mapId,
          loading: window.ffvi?.loading,
          instruction: window.ffvi?.lastInstruction,
          audio: window.ffviBattleFlow?.(),
          cloudEnabled: !!document.querySelector('meta[name="ffvi-host"]'),
          buttons: [...document.querySelectorAll("button")].map((button) => button.textContent),
        }))
        .catch(() => null);
      await page.screenshot({ path: path.join(directory, "failure.png") }).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    await browser?.close();
    results.push(report);
    await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
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
