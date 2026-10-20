import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium, webkit } from "playwright";
import { createAktoStoryDemo } from "../../src/play/story-demo.js";
import { validateSourceDocument } from "../../src/play/story-authoring.js";
const root = path.resolve(import.meta.dirname, "../.."),
  output = path.resolve(process.env.STORY_REPORT_DIR || "build/play/deployment/story-editor"),
  port = Number(process.env.STORY_CHECK_PORT || 4187),
  base = `http://127.0.0.1:${port}`;
await mkdir(output, { recursive: true });
const sourceFile = path.join(root, "build/web-data/data.json"),
  originalBytes = await readFile(sourceFile),
  data = JSON.parse(originalBytes);
const roundtrip = { programs: 0, instructions: 0, errors: [] };
for (const [id, program] of Object.entries(data.programs)) {
  const doc = { source: { program: structuredClone(program) }, program: structuredClone(program) };
  assert.deepEqual(doc.program, program);
  const errors = validateSourceDocument(doc);
  if (errors.length) roundtrip.errors.push({ id, errors });
  roundtrip.programs++;
  roundtrip.instructions += program.ops.length;
}
assert.equal(roundtrip.errors.length, 0);
await writeFile(path.join(output, "corpus.json"), JSON.stringify(roundtrip, null, 2));
const child = spawn(process.execPath, ["tools/play/story-editor.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    STORY_PORT: String(port),
    STORY_DOCUMENT_DIR: path.join(output, "acceptance-documents"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (b) => (log += b));
child.stderr.on("data", (b) => (log += b));
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(log || "工作台未启动")), 30000);
  const interval = setInterval(() => {
    if (log.includes("剧情工作台：http")) {
      clearTimeout(timer);
      clearInterval(interval);
      resolve();
    }
    if (child.exitCode != null) {
      clearTimeout(timer);
      clearInterval(interval);
      reject(Error(log));
    }
  }, 100);
});
const results = [];
try {
  for (const engine of (process.env.PLAY_BROWSER || "chromium,webkit").split(",")) {
    const result = {
      engine,
      mode: "ordinary attributes, fixed named exploration routes, disposable editor profile and document directory",
      checks: [],
      errors: [],
      status: "running",
    };
    results.push(result);
    const browser = await { chromium, webkit }[engine].launch({
        headless: true,
        args: engine === "chromium" ? ["--use-angle=metal"] : [],
      }),
      context = await browser.newContext({
        viewport: { width: 1512, height: 1080 },
        acceptDownloads: true,
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => result.errors.push(e.stack || e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) result.errors.push(`${r.status()} ${r.url()}`);
    });
    page.on("request", (r) => {
      if (new URL(r.url()).origin !== base) result.errors.push(`external request ${r.url()}`);
    });
    const ready = () =>
      page.waitForFunction(
        () =>
          window.storyPreview &&
          !storyPreview.game.loading &&
          !storyPreview.game.busy &&
          document.getElementById("preview-loading").hidden,
      );
    const fill = async (label, value) => {
      const input = page.getByLabel(label, { exact: true });
      await input.fill(String(value));
      await input.press("Tab");
    };
    async function play() {
      await page.getByRole("button", { name: "地图与试玩", exact: true }).click();
      await page.getByRole("button", { name: "应用草稿并重新试玩", exact: true }).click();
      await ready();
    }
    async function route(name, points) {
      console.log(engine, name);
      const route = await page.evaluate(
        async ({ name, points }) => {
          const g = storyPreview.game,
            steps = [];
          for (const [x, y] of points) {
            for (let i = 0; i < 350 && (g.player.x !== x || g.player.y !== y); i++) {
              if (g.loading) {
                await g.pending;
                continue;
              }
              if (g.busy) throw Error(`${name}: unexpected event ${g.dialogue?.key}`);
              const before = [g.player.x, g.player.y, g.mapId],
                direction =
                  g.player.x !== x
                    ? g.player.x < x
                      ? "right"
                      : "left"
                    : g.player.y < y
                      ? "down"
                      : "up";
              const moved = g.move(direction);
              for (let tick = 0; tick < 6; tick++) g.tick(0.05);
              if (g.loading) await g.pending;
              if (g.mapId !== before[2])
                return { mapId: g.mapId, steps: steps.length + 1, transition: true };
              if (!moved || (g.player.x === before[0] && g.player.y === before[1]))
                throw Error(`${name}: blocked at ${before} toward ${x},${y} (${direction})`);
              steps.push(direction);
            }
            if (g.player.x !== x || g.player.y !== y)
              throw Error(`${name}: did not reach ${x},${y}`);
          }
          return {
            mapId: g.mapId,
            steps: steps.length,
            player: [g.player.x, g.player.y, g.player.layer],
          };
        },
        { name, points },
      );
      result.checks.push({ route: name, ...route });
      await ready();
    }
    async function talk(direction) {
      await page.evaluate((direction) => {
        storyPreview.game.move(direction);
        for (let i = 0; i < 5; i++) storyPreview.game.tick(0.05);
      }, direction);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => !!storyPreview.game.dialogue);
    }
    async function dismiss() {
      for (let i = 0; i < 12; i++) {
        await page.waitForFunction(() => storyPreview.game.dialogue || !storyPreview.game.busy);
        const d = await page.evaluate(
          () =>
            storyPreview.game.dialogue && {
              text: storyPreview.game.dialogue.text,
              choices: storyPreview.game.dialogue.choices,
            },
        );
        if (!d) break;
        if (d.choices) return d;
        await page.getByRole("button", { name: "确认继续", exact: true }).click();
      }
      await ready();
    }
    async function importDocument(document) {
      await page.locator("#import-file").setInputFiles({
        name: `${document.id}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ document })),
      });
      await page.waitForFunction((id) => storyEditor.state.doc.id === id, document.id);
    }
    const snap = async (name) => {
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(output, `${engine}-${name}.png`) });
    };
    try {
      await page.goto(`${base}/story-editor.html`);
      await page.waitForFunction(() => window.storyEditor);
      assert.ok(
        Number((await page.locator("#corpus-count").textContent()).replace(/,/g, "")) >= 3304,
      );
      await snap("workbench");
      // Edit an imported source program through its ordinary parameter form.
      await page.getByLabel("搜索脚本和对白").fill("sc_e_0013");
      await page.locator('[data-source="217"]').click();
      await page.locator('[data-node="10"]').click();
      await fill("对白", `工作台原版覆盖验收 ${engine}`);
      await page.getByRole("button", { name: "保存到文件", exact: true }).click();
      await page.waitForFunction(() => storyEditor.state.revision >= 1);
      const sourceDoc = await page.evaluate(() => structuredClone(storyEditor.state.doc));
      assert.equal(sourceDoc.source.program.ops[10][3][0], data.programs[217].ops[10][3][0]);
      assert.notEqual(sourceDoc.program.ops[10][3][0], sourceDoc.source.program.ops[10][3][0]);
      result.checks.push({ sourceOverride: "sc_e_0013", scopedMessage: true });
      // Build a new script, bind it by clicking the map, save, and run it.
      await page.getByRole("button", { name: "＋ 新建", exact: true }).click();
      await page.waitForFunction(
        () =>
          storyEditor.state.doc.mode !== "source" && storyEditor.state.doc.id.startsWith("story-"),
      );
      await fill("项目名称", `新建剧情验收 ${engine}`);
      await fill("对白", `这是通过可视化界面创建的剧情 ${engine}`);
      await page.getByRole("button", { name: "触发与世界", exact: true }).click();
      await page.getByRole("button", { name: "＋ 新世界状态", exact: true }).click();
      await fill("状态标识 state.0", "letter.received");
      await fill("状态名称 letter.received", "信件已取得");
      await page.getByRole("button", { name: "节点", exact: true }).click();
      await page.getByLabel("新节点类型").selectOption("set");
      await page.getByRole("button", { name: "＋ 插入节点", exact: true }).click();
      await play();
      const picker = await page.locator("#map-picker").boundingBox();
      await page
        .locator("#map-picker")
        .click({ position: { x: (70.5 / 128) * picker.width, y: (112.5 / 128) * picker.height } });
      await page.waitForFunction(() =>
        storyEditor.state.doc.bindings.some((b) => b.entityId === "517"),
      );
      await page.getByRole("button", { name: "保存到文件", exact: true }).click();
      await page.waitForFunction(() => storyEditor.state.revision === 1);
      await play();
      await route("new authored interaction", [
        [64, 118],
        [69, 118],
        [69, 112],
      ]);
      await talk("right");
      assert.match(await page.locator("#message").textContent(), /通过可视化界面创建/);
      await dismiss();
      assert.equal(
        await page.evaluate(() => storyPreview.game.banks[`Story:${storyEditor.state.doc.id}`][0]),
        1,
      );
      await page.getByRole("button", { name: "保存试玩进度", exact: true }).click();
      await snap("new-script");
      await page.reload();
      await page.waitForFunction(() => window.storyEditor);
      assert.equal(await page.evaluate(() => storyEditor.state.revision), 1);
      await play();
      await page.getByRole("button", { name: "读取试玩进度", exact: true }).click();
      await ready();
      assert.equal(
        await page.evaluate(() => storyPreview.game.banks[`Story:${storyEditor.state.doc.id}`][0]),
        1,
      );
      result.checks.push({
        newScript: "created, map-bound, saved, reloaded and played",
        persistentNamedState: true,
      });
      await page.getByRole("button", { name: "流程图", exact: true }).click();
      const hello = await page.locator('[data-node="hello"]').boundingBox();
      await page.mouse.move(hello.x + 30, hello.y + 25);
      await page.mouse.down();
      await page.mouse.move(hello.x + 60, hello.y + 45, { steps: 5 });
      await page.mouse.up();
      assert.ok(
        await page.evaluate(
          () => storyEditor.state.doc.scenes[0].nodes.find((n) => n.id === "hello").position,
        ),
      );
      await page.locator('[data-node="hello"]').click();
      await page.getByRole("button", { name: "在此节点暂停", exact: true }).click();
      await play();
      await route("debugger ordinary trigger", [
        [64, 118],
        [69, 118],
        [69, 112],
      ]);
      await page.evaluate(() => storyPreview.game.move("right"));
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => storyPreview.paused);
      assert.equal(await page.evaluate(() => storyPreview.game.dialogue), null);
      await page.getByRole("button", { name: "单步", exact: true }).click();
      await page.waitForFunction(() => storyPreview.paused && storyPreview.game.dialogue);
      assert.match(await page.locator("#message").textContent(), /通过可视化界面创建/);
      await page.locator("#pause").click();
      await dismiss();
      result.checks.push({
        graphDrag: true,
        breakpointBeforeNode: true,
        singleStepUsesExistingVM: true,
      });
      for (const outcome of ["water", "forge"]) {
        const project = createAktoStoryDemo();
        project.id = `acceptance-${engine}-${outcome}-${Date.now()}`;
        await importDocument(project);
        await page.getByRole("button", { name: "保存到文件", exact: true }).click();
        await page.waitForFunction(() => storyEditor.state.revision === 1);
        await play();
        await route(`${outcome}: courier`, [
          [64, 118],
          [69, 118],
          [69, 112],
        ]);
        await talk("right");
        await dismiss();
        await page.getByRole("button", { name: "我再考虑一下", exact: true }).click();
        await dismiss();
        assert.equal(
          await page.evaluate(
            () => storyPreview.game.banks[`Story:${storyEditor.state.doc.id}`][0],
          ),
          0,
        );
        await talk("right");
        await dismiss();
        await page
          .getByRole("button", {
            name: outcome === "water" ? "先送到水庭的护水人手中" : "先送到工区的炉工手中",
            exact: true,
          })
          .click();
        await dismiss();
        if (outcome === "water") {
          await route("water: ordinary streets and stairs", [
            [69, 118],
            [57, 118],
            [57, 55],
            [57, 40],
            [22, 40],
            [22, 31],
            [28, 31],
            [28, 29],
            [31, 29],
          ]);
          await talk("right");
          await snap("water-delivery");
          await dismiss();
          assert.equal(await page.evaluate(() => storyPreview.game.actor(512).x), 34);
          await route("water: leave through rooftop", [
            [28, 29],
            [28, 31],
            [22, 31],
            [22, 34],
            [22, 40],
            [48, 40],
            [48, 36],
          ]);
          assert.equal(await page.evaluate(() => storyPreview.game.mapId), 9103);
          await route("water: return from rooftop", [[24, 21]]);
          assert.equal(await page.evaluate(() => storyPreview.game.actor(512).x), 34);
          await route("water: changed resident dialogue", [
            [46, 40],
            [46, 39],
          ]);
          await talk("up");
          assert.match(await page.locator("#message").textContent(), /是你把许可送上去/);
          await dismiss();
        } else {
          await route("forge: ordinary south streets", [
            [69, 114],
            [71, 114],
            [71, 110],
            [104, 110],
            [104, 105],
          ]);
          await talk("up");
          await snap("forge-delivery");
          await dismiss();
          assert.equal(await page.evaluate(() => storyPreview.game.actor(516).x), 84);
          await route("forge: leave through rooftop", [
            [104, 110],
            [71, 110],
            [71, 65],
            [57, 65],
            [57, 40],
            [48, 40],
            [48, 36],
          ]);
          assert.equal(await page.evaluate(() => storyPreview.game.mapId), 9103);
          await route("forge: return from rooftop", [[24, 21]]);
          assert.equal(await page.evaluate(() => storyPreview.game.actor(516).x), 84);
          await route("forge: changed guard dialogue", [
            [57, 40],
            [57, 65],
            [71, 65],
            [71, 41],
            [84, 41],
          ]);
          await talk("up");
          assert.match(await page.locator("#message").textContent(), /检修通道开放/);
          await dismiss();
        }
        const values = await page.evaluate(
          () => storyPreview.game.banks[`Story:${storyEditor.state.doc.id}`],
        );
        assert.equal(values[1], 1);
        assert.equal(values[outcome === "water" ? 2 : 3], 1);
        assert.equal(values[outcome === "water" ? 3 : 2], 0);
        await page.getByRole("button", { name: "保存试玩进度", exact: true }).click();
        await play();
        await page.getByRole("button", { name: "读取试玩进度", exact: true }).click();
        await ready();
        assert.equal(
          await page.evaluate(() => storyPreview.game.actor(512).x),
          outcome === "water" ? 34 : 32,
        );
        assert.equal(
          await page.evaluate(() => storyPreview.game.actor(516).x),
          outcome === "forge" ? 84 : 82,
        );
        await snap(`${outcome}-persistent`);
        result.checks.push({
          outcome,
          declineAvailable: true,
          values,
          ordinaryLeaveAndReturn: true,
          saveLoad: true,
        });
      }
      // Export is the editable source; importing it preserves IDs and graph links.
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出", exact: true }).click();
      const download = await downloadPromise,
        exportFile = path.join(output, `${engine}-export.json`);
      await download.saveAs(exportFile);
      const exported = JSON.parse(await readFile(exportFile));
      assert.equal(exported.document.scenes.length, 5);
      await page.getByRole("button", { name: "查看歌剧时间轴", exact: true }).click();
      await page.locator("#opera-dialog").waitFor({ state: "visible" });
      assert.equal(await page.locator("#opera-select option").count(), 32);
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      result.status = result.errors.length ? "failed" : "passed";
      assert.deepEqual(result.errors, []);
    } catch (e) {
      result.status = "failed";
      result.failure = e.stack;
      await snap("failure");
      throw e;
    } finally {
      await writeFile(path.join(output, `${engine}-report.json`), JSON.stringify(result, null, 2));
      await browser.close();
    }
  }
} finally {
  child.kill("SIGTERM");
  await writeFile(path.join(output, "server.log"), log);
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify({ results }, null, 2));
  assert.deepEqual(
    await readFile(sourceFile),
    originalBytes,
    "original exported programs must remain unchanged",
  );
}
