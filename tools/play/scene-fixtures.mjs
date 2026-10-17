import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { WebData } from "../../apps/play/data.js";
import { withPresentation } from "../../apps/play/presentation-events.js";
import { PlayGame } from "../../src/play/game.js";
import { Battle } from "../../src/play/battle.js";
import { PresentationAudit } from "./audit-presentation.mjs";
import { BoundaryCheckpoints } from "./boundary-checkpoints.mjs";

const root = process.env.PLAY_STATIC_DIR || "dist/visual-current",
  directory = process.env.PLAY_BOUNDARY_DIR || "build/play/acceptance/step-4/scene-fixtures",
  repository = new WebData(pathToFileURL(path.resolve(root, "data/index.json")), {
    fetcher: async (url) => new Response(await readFile(fileURLToPath(url))),
  }),
  { data, battleData } = await repository.open();
await repository.preloadRegression();
const audit = await PresentationAudit.open({ data, battleData, assetRoot: root }),
  recorder = await new BoundaryCheckpoints(directory, audit).open(),
  Game = withPresentation(PlayGame),
  cases = [];
for (const [name, file] of [
  ["figaro-door", "build/play/acceptance/step-3/checkpoints/edgar.json"],
  ["jidoor-stairs", "build/play/optional/jidoor-occlusion-start.json"],
  ["terra-bed", "build/play/optional/ramuh-flash-fixed.json"],
  ["south-figaro-water", "build/play/acceptance/step-3/checkpoints/cider.json"],
  ["phoenix-lava", "build/play/optional/dragon-red-save.json"],
]) {
  const saved = JSON.parse(await readFile(file)),
    game = new Game({
      data,
      battleData,
      Battle,
      loadMap: (id) => repository.loadMap(id),
      onPresentation: (event) => {
        recorder.presentationEvent(event);
        audit.field.event(event);
      },
    });
  await game.restore(saved.snapshot || saved);
  const entry = recorder.capture(game, "fixture", { script: name });
  cases.push({
    name,
    sourceSave: file,
    entry: entry.sequence,
    inputs: [],
    scope: "Restored real save, no plot edits",
  });
  if (name === "figaro-door") {
    const inputs = [{ input: "interact", accepted: game.interact() }];
    for (let n = 0; n < 5; n++) game.tick(0.1);
    inputs.push({ input: "move-up", accepted: game.move("up") });
    for (let n = 0; n < 5; n++) {
      game.tick(0.1);
      if (game.loading) await game.pending;
    }
    const next = recorder.capture(game, "fixture", { script: name + "-inside" });
    cases.push({
      name: name + "-inside",
      sourceSave: file,
      entry: next.sequence,
      inputs,
      position: { x: game.player.x, y: game.player.y },
      scope: "Ordinary door interaction and one up input from the real save",
    });
  }
  if (name.endsWith("water") || name.endsWith("lava")) {
    const layer = game.map.layers.find((row) => row.sourceGroup === "WaterGroup"),
      cell = layer?.data.findIndex(Boolean);
    if (cell >= 0) {
      game.camera = { manual: true, x: cell % layer.width, y: Math.floor(cell / layer.width) };
      const next = recorder.capture(game, "fixture", { script: name + "-material-closeup" });
      cases.push({
        name: name + "-material-closeup",
        sourceSave: file,
        entry: next.sequence,
        camera: game.camera,
        scope: "Controlled render-only camera at a raw nonzero water cell, not gameplay coverage",
      });
    }
  }
}
await recorder.finish({
  start: "real-saves",
  scope:
    "Supplementary scene/door/material fixtures; not full story or original screenshot acceptance",
});
await writeFile(path.join(directory, "cases.json"), JSON.stringify(cases, null, 2));
console.log(JSON.stringify(cases.map(({ name, entry, position }) => ({ name, entry, position }))));
