// Source regression fixture: normal entrance -> NPC passage -> map-object action.
// These are test inputs, not map-specific runtime behavior or injected story state.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FieldGame, DELTA } from "../dist/src/core/field.js";
import { WorldSession } from "../dist/src/core/world-session.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
const root = new URL("..", import.meta.url);
const read = async (p) =>
  verifyContent(JSON.parse(await readFile(new URL(p, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  bootstrap = await read("build/game/narshe.json"),
  map = await read("build/world/maps/293.json");
assert.equal(catalog.maps[293].contentHash, map.contentHash);
const world = new WorldSession(bootstrap);
world.field.previewMap(293, 1);
assert.ok(world.commit(world.prepare(catalog, map)));
const game = world.field,
  paths = [],
  messages = [];
assert.ok(
  !game.entities.some((e) => [2, 4, 8].includes(e.kind)),
  "Movement-only planner cannot simulate contact actions/layer changes",
);

function walkTo(x, y) {
  // Candidate movement queries run in a disposable instance. The selected path
  // must then succeed from the actual entrance/session, with no teleportation.
  const planner = new FieldGame(game.content),
    key = (p) => `${p.x},${p.y}`;
  for (const [id, actor] of Object.entries(game.actors))
    Object.assign(planner.actors[id], {
      x: actor.x,
      y: actor.y,
      layer: actor.layer,
    });
  for (const id of game.hiddenEntities) planner.hiddenEntities.add(id);
  const queue = [{ x: game.player.x, y: game.player.y, inputs: [] }],
    seen = new Set([key(game.player)]);
  let inputs;
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i];
    if (point.x === x && point.y === y) {
      inputs = point.inputs;
      break;
    }
    for (const input of Object.keys(DELTA)) {
      Object.assign(planner.player, { x: point.x, y: point.y, motion: null });
      const moved = planner.move(input);
      assert.equal(planner.stop, null);
      if (!moved) continue;
      const next = planner.player.motion.to;
      if (
        seen.has(key(next)) ||
        game.entities.some(
          (e) =>
            e.kind === 3 &&
            next.x >= e.x &&
            next.x < e.x + e.width &&
            next.y >= e.y &&
            next.y < e.y + e.height,
        )
      )
        continue;
      seen.add(key(next));
      queue.push({ ...next, inputs: [...point.inputs, input] });
    }
  }
  assert.ok(inputs, `No supported path to ${x},${y}`);
  const from = [game.player.x, game.player.y];
  for (const input of inputs) {
    assert.ok(game.move(input));
    game.advance(240);
    assert.equal(game.stop, null);
    assert.equal(game.busy, false);
  }
  assert.deepEqual([game.player.x, game.player.y], [x, y]);
  paths.push({ from, to: [x, y], inputs });
}
function finishAction() {
  for (let i = 0; i < 3000 && game.busy && !game.stop; i++) {
    if (game.dialogue) {
      messages.push({ key: game.dialogue.key, hash: hash(game.dialogue.text) });
      game.confirm();
    } else game.advance(10);
  }
  assert.equal(game.stop, null);
  assert.equal(game.busy, false);
}
walkTo(117, 29);
assert.equal(game.move("right"), false);
game.confirm();
finishAction();
assert.deepEqual(
  messages.map((m) => m.key),
  ["E0892_00_115_a_01"],
);
assert.deepEqual([game.actors[9].x, game.actors[9].y], [119, 29]);
assert.equal(
  game.eventState.read({ category: "MapLocalVariable", index: 2 }),
  1,
);
walkTo(116, 27);
assert.equal(game.move("up"), false);
const before = game.eventState.snapshot();
game.confirm();
finishAction();
// Starting another real script reinitializes its own locals, while map/story state persists.
const locals = map.scriptLocals.sc_e_0335;
assert.ok(locals);
assert.deepEqual(game.eventState.snapshot(), {
  ...before,
  script: locals.values,
  scriptLabels: locals.labels,
});
assert.equal(game.presentationOmissions.length, 2);
assert.ok(
  game.presentationOmissions.every((o) => o.site.script === "sc_e_0335"),
);
assert.equal(game.presentationOmissions[0].soundId, 102);
walkTo(115, 27);
const report = {
  kind: "source-map-object-approach-check",
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  mapHash: map.contentHash,
  mapId: 293,
  entrance: 1,
  entityId: "4",
  paths,
  messages,
  sources: ["9", "4", "14"].map(
    (id) => game.entities.find((e) => e.id === id).source,
  ),
  scripts: ["sc_e_0892", "sc_e_0335"],
  presentationOmissions: game.presentationOmissions,
  result: "completed",
  final: [game.player.x, game.player.y],
  limitations: [
    "Source entities and initialization; actual walking from a development entrance with unknown story flags.",
    "Sound and SyncSE are explicit muted omissions; cue frame 1 resets to 0 without waiting for audible sound.",
    "This is not original parity, full map completion, or migration of the opera performance.",
  ],
};
await writeFile(
  new URL("build/reports/map-object-approach-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(JSON.stringify({ ...report, sources: undefined }, null, 2));
