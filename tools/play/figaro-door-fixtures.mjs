import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { PlayGame } from "../../src/play/game.js";
import { Battle } from "../../src/play/battle.js";
import { findStoryTarget, followTarget } from "../../src/play/story-route.js";
import { pathTo } from "../../src/play/m1-route.js";
import { withPresentation } from "../../apps/play/presentation-events.js";
import { FieldAnimations } from "../../apps/play/field-animation.js";
import { decodeAcceptanceState } from "../../apps/play/acceptance-state.js";
import { BoundaryCheckpoints } from "./boundary-checkpoints.mjs";

const args = process.argv.slice(2),
  option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback),
  source = option("--start", "build/play/acceptance/step-3/checkpoints/edgar.json"),
  out = option("--out", "build/play/acceptance/step-4/figaro-door"),
  dataRoot = option("--data", "build/web-data"),
  json = async (file) => JSON.parse(await readFile(file)),
  data = await json(path.join(dataRoot, "data.json")),
  battleData = await json(path.join(dataRoot, "battle.json")),
  field = new FieldAnimations(),
  recorder = await new BoundaryCheckpoints(out, {
    field,
    shared: { catalogs: { presentation: {} } },
  }).open(),
  journal = [],
  events = [],
  Game = withPresentation(PlayGame);
data.navigation = await json(path.join(dataRoot, "navigation.json"));
const game = new Game({
  data,
  battleData,
  Battle,
  loadMap: (id) => json(path.join(dataRoot, `maps/${id}.json`)),
  onEvent: (event) => events.push(event),
  onPresentation: (event) => {
    field.event(event);
    recorder.presentationEvent(event);
  },
});
const state = () => ({
  mapId: game.mapId,
  x: game.player.x,
  y: game.player.y,
  layer: game.player.layer,
  direction: game.player.direction,
  busy: game.busy,
});
const saved = await json(source);
if (saved.schema === "ffvi-frozen-frame") {
  const map = await json(path.join(dataRoot, `maps/${saved.metadata.mapId}.json`)),
    restored = decodeAcceptanceState(
      saved,
      { data, battleData, map },
      { Battle: Battle.prototype },
    );
  Object.assign(game, restored.state);
  field.restore(restored.field);
  recorder.visualEvents = restored.visualEvents;
  recorder.recentEvents = restored.recentEvents;
} else await game.restore(saved.snapshot || saved);
await mkdir(out, { recursive: true });
async function settle() {
  for (let tick = 0; tick < 200; tick++) {
    game.tick(0.05);
    if (game.loading) await game.pending;
    if (game.dialogue || game.battle || game.choice) break;
    if (
      !game.busy &&
      !game.player.motion &&
      (!game.fade || game.time >= game.fade.start + game.fade.duration)
    )
      break;
  }
}
async function capture(label) {
  recorder.capture(game, "fixture", { script: label });
  await recorder.flush();
  await writeFile(path.join(out, `${label}-save.json`), JSON.stringify(game.snapshot()));
}
async function input(kind, value) {
  const before = state();
  let accepted;
  if (kind === "move") accepted = game.move(value);
  else if (kind === "confirm") accepted = game.confirm();
  else throw Error(`Unsupported ordinary input ${kind}`);
  await settle();
  journal.push({ input: kind, value, accepted, before, after: state() });
}
async function visit(mapId) {
  for (let step = 0; game.mapId !== mapId && step < 400; step++) {
    if (game.dialogue) await input("confirm");
    if (game.battle || game.choice) throw Error("Unexpected source battle or choice");
    await settle();
    const before = state(),
      target = findStoryTarget(game, { action: "visit-map", maps: [mapId] }),
      result = followTarget(game, target);
    await settle();
    journal.push({ input: "existing-fixed-visit-route", mapId, result, before, after: state() });
    if (["no-route", "no-input"].includes(result.status))
      throw Error(`Cannot ordinarily visit ${mapId}: ${JSON.stringify(state())}`);
  }
  if (game.mapId !== mapId) throw Error(`Visit budget exhausted for ${mapId}`);
}
async function cell(x, y, layer = game.player.layer) {
  for (let step = 0; step < 150; step++) {
    if (game.player.x === x && game.player.y === y && game.player.layer === layer) return;
    const route = pathTo(game, { id: `fixed-${x}-${y}`, x, y, layer, kind: 0 });
    if (!route?.length) throw Error(`Fixed ordinary cell unavailable ${x},${y},${layer}`);
    await input("move", route[0]);
  }
  throw Error("Fixed cell input budget exhausted");
}
let stop = "completed";
try {
  await settle();
  await capture("real-edgar-start");
  await visit(31);
  await capture("figaro-central-corridor");
  if (args.includes("--corridor-only")) {
    await cell(26, 15);
    await capture("figaro-central-door-left-closed");
    await input("move", "up");
    await capture("figaro-central-door-left-bump");
    await cell(27, 15);
    await input("move", "up");
    await capture("figaro-central-door-open");
    await input("move", "down");
    await input("move", "left");
    await input("move", "up");
    await capture("figaro-central-door-open-left");
    assert.deepEqual(
      [game.player.x, game.player.y],
      [26, 15],
      "The open central door must not release the source pillar at26,14",
    );
    await cell(27, 14);
    await input("move", "up");
    await capture("figaro-central-door-inside");
    assert.equal(game.mapId, 34);
    await visit(31);
    await capture("figaro-central-door-return");
  } else {
    await visit(32);
    await capture("figaro-shop32-entry");
    await cell(11, 14);
    await capture("figaro-shop32-merchant-side");
    await input("move", "up");
    await capture("figaro-shop32-before-chest");
    await input("move", "up");
    await capture("figaro-shop32-chest-collision");
    await input("confirm");
    if (game.dialogue) await input("confirm");
    await capture("figaro-shop32-chest-open");
    await visit(31);
    await capture("figaro-shop32-return-door");
    await visit(33);
    await capture("figaro-shop33-entry");
    await cell(43, 16);
    await capture("figaro-shop33-merchant-side");
    await input("move", "left");
    await capture("figaro-shop33-merchant-west");
    await visit(31);
    await capture("figaro-shop33-return-door");
  }
} catch (error) {
  stop = error.stack;
  await capture("stopped");
} finally {
  await writeFile(
    path.join(out, "journal.json"),
    JSON.stringify({ source, stop, end: state(), journal, events }, null, 2),
  );
  await recorder.finish({
    start: source,
    stop,
    scope: "Real save; ordinary fixed move/confirm and existing route queries only",
  });
}
console.log(JSON.stringify({ stop, end: state(), inputs: journal.length }));
