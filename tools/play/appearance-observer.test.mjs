import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PlayGame } from "../../src/play/game.js";
import { AppearanceObserver } from "./appearance-observer.mjs";

const observer = await AppearanceObserver.open();
test("source appearance observation never constructs game actors or changes a snapshot", () => {
  const game = new PlayGame({ data: { programs: {} } }),
    before = structuredClone(game.snapshot());
  observer.observe(game);
  assert.deepEqual(game.snapshot(), before);
  assert.equal(observer.samples, 1);
  assert.ok(observer.report().field.checked > 0);
});

test("every exported PR sprite spawn keeps its independent raw mapobject identity", async () => {
  const root = new URL("../../build/web-data/maps/", import.meta.url);
  let maps = 0,
    spawns = 0;
  for (const file of await readdir(root)) {
    if (!file.endsWith(".json")) continue;
    const map = JSON.parse(await readFile(new URL(file, root))),
      report = observer.field.compareMap(map);
    assert.ok(
      map.entities.every((entity) => !(Number(entity.id) < 0)),
      `Map ${map.id}: map objects must not claim character selectors`,
    );
    assert.deepEqual(report.mismatches, [], `Map ${map.id}`);
    maps++;
    spawns += report.summary.checked;
  }
  assert.equal(maps, 649);
  assert.equal(spawns, 3650);
});

test("ordinary movement audit rejects invisible control without changing the game", async () => {
  const audit = await AppearanceObserver.open(),
    game = new PlayGame({ data: { programs: {} } });
  game.player.visible = false;
  const before = structuredClone(game.snapshot());
  audit.movement(game, true, "down");
  assert.equal(audit.report().field.ordinaryMovement.mismatches.length, 1);
  assert.deepEqual(game.snapshot(), before);
  game.player.visible = true;
  audit.movement(game, true, "up");
  assert.equal(audit.report().field.ordinaryMovement.checked, 2);
  assert.equal(audit.report().field.ordinaryMovement.mismatches.length, 1);
});
