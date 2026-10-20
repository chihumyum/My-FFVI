import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";
const base = process.env.AKTO_URL || "http://127.0.0.1:4176/akto.html";
const output = path.resolve("build/play/deployment/akto-city/browser");
await mkdir(output, { recursive: true });
const results = [];
for (const engine of ["chromium", "webkit"]) {
  const result = {
    engine,
    status: "running",
    mode: "Original authored city; ordinary field inputs, no battle boost. Fixed named routes; individual room door fixtures are identified separately.",
    checks: [],
    errors: [],
    failures: [],
  };
  results.push(result);
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    args: engine === "chromium" ? ["--use-angle=metal"] : [],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }),
    page = await context.newPage();
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) result.failures.push({ url: r.url(), status: r.status() });
  });
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(base).origin)
      result.failures.push({ url: r.url(), error: "external request" });
  });
  const ready = () =>
    page.waitForFunction(() => window.akto && !akto.game.loading && !akto.game.busy);
  async function route(name, points) {
    console.log(engine, name, points);
    const actual = await page.evaluate(
      async ({ name, points }) => {
        const g = akto.game,
          steps = [];
        for (const [x, y] of points) {
          for (let i = 0; i < 300 && (g.player.x !== x || g.player.y !== y); i++) {
            if (g.loading) {
              await g.pending;
              continue;
            }
            if (g.busy)
              throw Error(name + ": unexpected dialogue/task " + JSON.stringify(g.dialogue));
            const from = [g.player.x, g.player.y, g.mapId],
              direction =
                g.player.x !== x
                  ? g.player.x < x
                    ? "right"
                    : "left"
                  : g.player.y < y
                    ? "down"
                    : "up";
            g.move(direction);
            for (let n = 0; n < 6; n++) g.tick(0.05);
            if (g.loading) await g.pending;
            if (g.mapId !== from[2])
              return {
                transition: g.mapId,
                steps,
                player: [g.player.x, g.player.y, g.player.layer],
              };
            if (g.player.x === from[0] && g.player.y === from[1])
              throw Error(
                name +
                  ": blocked " +
                  JSON.stringify({ from, target: [x, y], direction, layer: g.player.layer }),
              );
            steps.push(direction);
            await new Promise((r) => setTimeout(r, 0));
          }
          if (g.player.x !== x || g.player.y !== y) throw Error(name + ": did not arrive");
        }
        return {
          mapId: g.mapId,
          player: [g.player.x, g.player.y, g.player.layer],
          steps: steps.length,
        };
      },
      { name, points },
    );
    result.checks.push({ route: name, ...actual });
    await ready();
    return actual;
  }
  async function snap(name) {
    await page.waitForTimeout(300);
    await page.locator("#game").screenshot({ path: path.join(output, `${engine}-${name}.png`) });
  }
  try {
    await page.goto(base);
    await ready();
    await page.waitForFunction(() => document.getElementById("loading").hidden);
    await page.keyboard.down("ArrowUp");
    try {
      await page.waitForFunction(() => akto.game.dialogue?.key === "halt", null, {
        timeout: 10000,
      });
    } finally {
      await page.keyboard.up("ArrowUp");
    }
    assert.equal(await page.evaluate(() => akto.game.player.y), 27);
    await snap("gate-check");
    for (const key of ["pass", "return", null]) {
      await page.keyboard.press("Enter");
      await page.waitForFunction((k) => (k ? akto.game.dialogue?.key === k : !akto.game.busy), key);
    }
    await route("gate admission", [[32, 25]]);
    assert.equal(await page.evaluate(() => akto.game.mapId), 9102);
    await route("south quay to bazaar", [
      [64, 118],
      [57, 118],
      [57, 110],
      [32, 110],
      [32, 100],
    ]);
    await snap("bazaar");
    await route("bazaar to old-city stair", [
      [32, 92],
      [57, 92],
      [57, 55],
      [57, 40],
      [22, 40],
      [22, 31],
    ]);
    assert.equal(await page.evaluate(() => akto.game.player.layer), 1);
    await route("walk upper water garden", [
      [28, 31],
      [28, 29],
    ]);
    await snap("water-garden");
    await route("descend water garden", [
      [28, 31],
      [22, 31],
      [22, 34],
    ]);
    assert.equal(await page.evaluate(() => akto.game.player.layer), 0);
    await route("walk to horizon stair", [
      [22, 40],
      [48, 40],
      [48, 36],
    ]);
    assert.equal(await page.evaluate(() => akto.game.mapId), 9103);
    await snap("horizon");
    await route("leave rooftop", [[24, 21]]);
    assert.equal(await page.evaluate(() => akto.game.mapId), 9102);
    await route("cross scales bridge", [
      [57, 40],
      [57, 55],
      [57, 65],
      [64, 65],
      [71, 65],
    ]);
    await snap("bridge");
    await route("upper-city giant", [
      [71, 41],
      [89, 41],
      [104, 41],
    ]);
    await snap("giant");
    await route("industrial wheel", [
      [89, 41],
      [89, 109],

      [103, 109],
      [103, 104],
    ]);
    await snap("wheel");
    // Each door is then exercised from its authored return entrance fixture, without changing collision or player attributes.
    for (let n = 0; n < 8; n++) {
      await page.evaluate(async (n) => {
        await akto.game.enter(9102, n + 10);
      }, n);
      await ready();
      const door = await page.evaluate((n) => akto.content.city.interiors[n].door, n);
      await route("enter room " + n, [[door.x, door.y]]);
      assert.equal(await page.evaluate(() => akto.game.mapId), 9200 + n);
      await route("walk to room speaker " + n, [
        [16, 17],
        [16, 7],
        [13, 7],
      ]);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => !!akto.game.dialogue);
      if (n === 0) await snap("interior");
      await page.keyboard.press("Enter");
      await ready();
      await route("leave room " + n, [
        [16, 7],
        [16, 17],
        [12, 17],
        [12, 19],
      ]);
      assert.equal(await page.evaluate(() => akto.game.mapId), 9102);
    }
    await page.evaluate(async () => {
      await akto.game.enter(9102, 1);
    });
    await ready();
    // A static graph audit measures authored terrain connectivity; it is not used to steer the automatic player.
    result.connectivity = await page.evaluate(() => {
      const m = akto.content.maps[9102],
        key = (x, y, p) => `${x},${y},${p}`,
        seen = new Set(),
        q = [[64, 122, 0]];
      const blocked = new Set(
        m.entities.filter((e) => e.kind === 6).map((e) => key(e.x, e.y, e.layer)),
      );
      for (let n = 0; n < q.length; n++) {
        const [x, y, p] = q[n],
          k = key(x, y, p);
        if (
          x < 0 ||
          y < 0 ||
          x >= m.width ||
          y >= m.height ||
          seen.has(k) ||
          m.collisions[p][y * m.width + x] ||
          blocked.has(k)
        )
          continue;
        seen.add(k);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          q.push([x + dx, y + dy, p]);
        for (const e of m.entities)
          if (e.kind === 4 && e.x === x && e.y === y && e.layer === p)
            q.push([x, y, e.destinationLayer]);
      }
      return {
        reachableCells: seen.size,
        doors: akto.content.city.interiors.map((p) => ({
          title: p.title,
          reachable: seen.has(key(p.door.x, p.door.y, 0)),
        })),
        stairs: m.entities
          .filter((e) => e.kind === 4)
          .map((e) => ({ id: e.id, reachable: seen.has(key(e.x, e.y, e.layer)) })),
      };
    });
    assert.ok(result.connectivity.doors.every((x) => x.reachable));
    assert.ok(result.connectivity.stairs.every((x) => x.reachable));
    await page.waitForFunction(() => document.getElementById("overview").dataset.mapId === "9102");
    await page.screenshot({ path: path.join(output, `${engine}-city.png`), fullPage: true });
    const png = await page.locator("#overview").evaluate((c) => c.toDataURL());
    await writeFile(
      path.join(output, `${engine}-map-native.png`),
      Buffer.from(png.split(",")[1], "base64"),
    );
    await route("return through south gate", [[64, 127]]);
    assert.equal(await page.evaluate(() => akto.game.mapId), 9100);
    await page.getByRole("button", { name: "区域地图", exact: true }).click();
    await ready();
    assert.equal(await page.evaluate(() => akto.game.mapId), 9101);
    await route("regional city icon", [[16, 9]]);
    assert.equal(await page.evaluate(() => akto.game.mapId), 9100);
    result.isolation = await page.evaluate(async () => ({
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
      databases: indexedDB.databases ? await indexedDB.databases() : [],
      warnings: akto.game.warnings,
    }));
    assert.equal(result.isolation.localStorage, 0);
    assert.equal(result.isolation.sessionStorage, 0);
    assert.deepEqual(result.isolation.databases, []);
    assert.deepEqual(await context.cookies(), []);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.failures, []);
    result.status = "passed";
  } catch (e) {
    result.status = "failed";
    result.error = e.stack;
    process.exitCode = 1;
    await page
      .screenshot({ path: path.join(output, `${engine}-failure.png`), fullPage: true })
      .catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ engine, status: result.status, error: result.error }));
}
await writeFile(path.join(output, "report.json"), JSON.stringify({ base, results }, null, 2));
