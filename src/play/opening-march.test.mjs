import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "./game.js";
const read = async (name) =>
  JSON.parse(await readFile(new URL(`../../build/web-data/${name}`, import.meta.url)));
test("the real opening waits for all 117-second snowfield puppets instead of cutting straight to Narshe", async () => {
  const data = await read("data.json"),
    battleData = await read("battle.json");
  const game = new PlayGame({
    data,
    battleData,
    random: () => 0.5,
    loadMap: (id) => read(`maps/${id}.json`),
  });
  await game.start();
  for (let n = 0; n < 2000 && game.mapId !== 572; n++) {
    game.tick(0.1, { auto: true });
    if (game.loading) await game.pending;
  }
  assert.equal(game.mapId, 572);
  for (let n = 0; n < 50; n++) game.tick(0.1, { auto: true });
  assert.equal(game.tasks.find((t) => t.actor === null && !t.done)?.waitFor, "children");
  const start = game.time,
    actors = ["2", "3", "4"].map((id) => game.actors.get(id));
  assert(actors.every((a) => a.motion?.duration === 117));
  const initial = actors.map((a) => a.y);
  for (let n = 0; n < 500; n++) game.tick(0.1, { auto: true });
  assert.equal(game.mapId, 572);
  assert(
    actors.every((a, i) => a.y < initial[i]),
    "all three source armors move",
  );
  for (let n = 0; n < 900 && game.mapId === 572; n++) {
    game.tick(0.1, { auto: true });
    if (game.loading) await game.pending;
  }
  assert.equal(game.mapId, 3);
  assert(game.time - start >= 110, "original authored duration must not be shortened");
  assert(game.history.some((h) => h.script === "sc_e_0001_5"));
});
