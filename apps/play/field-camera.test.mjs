import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fieldCameraFrame } from "./field-camera.js";

test("PR forest MapRange clamps the camera before the editor padding", async () => {
  const map = JSON.parse(
    await readFile(new URL("../../build/web-data/maps/351.json", import.meta.url)),
  );
  assert.equal(map.width, 64);
  const view = fieldCameraFrame(map, { x: 28, y: 7 }, 320, 180);
  assert.deepEqual(view.range, { x: 0, y: 0, width: 512, height: 256 });
  assert.equal(view.x, 192);
  assert.ok(view.x + view.width <= 512);
});
test("offset PR rooms center within their own range; looping world maps retain their wrap", () => {
  const map = {
    width: 128,
    height: 64,
    tileSize: 16,
    name: "room",
    entities: [{ kind: 27, x: 40, y: 32, width: 12, height: 10 }],
  };
  let view = fieldCameraFrame(map, { x: 46, y: 37 }, 320, 180);
  assert.equal(view.x, 576);
  assert.equal(view.y, 502);
  map.name = "Map_10010";
  map.worldTerrain = { loopType: 3 };
  view = fieldCameraFrame(map, { x: 0, y: 0 }, 320, 180);
  assert.equal(view.x, -160);
  assert.equal(view.y, -90);
});
test("every exported PR MapRange keeps the viewport inside its authored rectangle or centers small rooms", async () => {
  let checked = 0;
  for (let id = 1; id <= 649; id++) {
    let map;
    try {
      map = JSON.parse(
        await readFile(new URL(`../../build/web-data/maps/${id}.json`, import.meta.url)),
      );
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    if (/^Map_100(?:10|20|30)/i.test(map.name)) continue;
    const range = map.entities?.find((e) => e.kind === 27 && e.width > 0 && e.height > 0);
    if (!range) continue;
    for (const [x, y] of [
      [range.x, range.y],
      [range.x + range.width, range.y + range.height],
      [-100, -100],
      [map.width + 100, map.height + 100],
    ]) {
      const frame = fieldCameraFrame(map, { x, y }, 320, 180);
      for (const [position, start, extent, size] of [
        [frame.x, frame.range.x, frame.range.width, 320],
        [frame.y, frame.range.y, frame.range.height, 180],
      ])
        if (extent >= size) {
          assert.ok(position >= start - 1, `map${id}`);
          assert.ok(position + size <= start + extent, `map${id}`);
        } else assert.ok(Math.abs(position + size / 2 - (start + extent / 2)) < 1, `map${id}`);
    }
    checked++;
  }
  assert.ok(checked > 500, `Audit source MapRange rectangles, actual ${checked}`);
});
