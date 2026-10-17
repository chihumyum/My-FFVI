// Source regression fixture: normal entrance -> NPC passage -> map-object action.
// These are test inputs, not map-specific runtime behavior or injected story state.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FieldGame, DELTA } from "../dist/src/core/field.js";
import { WorldSession } from "../dist/src/core/world-session.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
import { controlledAudioRuntime } from "./controlled-audio.mjs";
const root = new URL("..", import.meta.url);
const read = async (p) =>
  verifyContent(JSON.parse(await readFile(new URL(p, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  bootstrap = await read("build/game/narshe.json"),
  map = await read("build/world/maps/293.json");
assert.equal(catalog.maps[293].contentHash, map.contentHash);
const runtime = controlledAudioRuntime();
// This geometry probe has no owned-game state. The disposable map candidate
// receives only the same explicit audio observation ports as the initial map.
const world = new WorldSession(bootstrap, undefined, {
  current: runtime,
  prepare: () => ({ ports: runtime, commit: () => true }),
});
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
  const planner = new FieldGame(game.content, undefined, undefined, undefined, controlledAudioRuntime()),
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
      if (game.dialogue.manual) game.advance(10);
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
const played = game.soundExecutions.find((execution) => execution.site.script === "sc_e_0335" && execution.command.kind === "play");
assert.ok(played && Number.isInteger(played.handle) && played.handle > 0);
assert.equal(played.command.soundId, 102);
for (let i = 0; i < 100 && !game.soundExecutions.some((execution) => execution.command.kind === "sync"); i++) {
  assert.equal(game.stop, null);
  game.advance(10);
}
const voice = game.se.voices.find((v) => v.id === played.handle);
assert.ok(voice, "The map object reaches SyncSE while its sound is still playing");
assert.equal(game.busy, true);
assert.equal(game.eventState.read({ category: "ScriptLocalVariable", index: 0 }), played.handle);
const track = catalog.se.tracks[102], durationMs = track.frames / track.sampleRate * 1000;
const beforeEnd = Math.floor((voice.started + durationMs - game.se.time) / 10) * 10;
assert.ok(beforeEnd > 0);
game.advance(beforeEnd);
assert.equal(game.se.isPlaying(played.handle), true);
assert.equal(game.busy, true, "SyncSE retains its task before the real media duration finishes");
const waitEvidence = { handle: played.handle, started: voice.started, durationMs, stillWaitingAt: game.se.time };
finishAction();
assert.equal(game.se.isPlaying(played.handle), false);
assert.ok(game.se.time >= voice.started + durationMs);
waitEvidence.completedAt = game.se.time;
// Starting another real script reinitializes its own locals, while map/story state persists.
const locals = map.scriptLocals.sc_e_0335;
assert.ok(locals);
const expectedLocals = [...locals.values];
expectedLocals[played.command.handleSlot] = played.handle;
assert.deepEqual(game.eventState.snapshot(), {
  ...before,
  script: expectedLocals,
  scriptLabels: locals.labels,
});
assert.deepEqual(game.soundExecutions.map(({ site, command, handle }) => [site.script, site.index, command.kind, handle]), [
  ["sc_e_0335", 1, "play", played.handle], ["sc_e_0335", 3, "sync", null],
]);
for (const { site, command } of game.soundExecutions)
  assert.deepEqual(command, map.scripts[site.script][site.index].command);
assert.equal(game.presentationOmissions.length, 0);
walkTo(115, 27);
const report = {
  kind: "source-map-object-approach-check",
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  mapHash: map.contentHash,
  soundSourceSetHash: catalog.se.sourceSetHash,
  mapId: 293,
  entrance: 1,
  entityId: "4",
  paths,
  messages,
  sources: ["9", "4", "14"].map(
    (id) => game.entities.find((e) => e.id === id).source,
  ),
  scripts: ["sc_e_0892", "sc_e_0335"],
  soundExecutions: game.soundExecutions,
  soundWait: waitEvidence,
  audioHost: "controlled-headless-readiness-and-presentation",
  result: "completed",
  final: [game.player.x, game.player.y],
  limitations: [
    "Source entities and initialization; actual walking from a development entrance with unknown story flags.",
    "The headless host explicitly reports ready/presented media; the real sound instance duration gates SyncSE and the later cue. No audible output is measured.",
    "This is not original parity, full map completion, or migration of the opera performance.",
  ],
};
await writeFile(
  new URL("build/reports/map-object-approach-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(JSON.stringify({ ...report, sources: undefined }, null, 2));
