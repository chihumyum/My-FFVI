import test from "node:test";
import assert from "node:assert/strict";
import { selectVisualPoints } from "./visual-points.mjs";
import { BoundaryCheckpoints } from "./boundary-checkpoints.mjs";
import { decodeAcceptanceState } from "../../apps/play/acceptance-state.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("current-run visual points retain changed positions instead of replaying old state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffvi-current-visual-"));
  try {
    const game = {
        mapId: 7,
        map: { name: "test" },
        time: 12,
        data: {},
        battleData: {},
        actors: new Map(),
        player: { x: 2, y: 3, layer: 1, visible: true },
        tasks: [],
      },
      select = selectVisualPoints([
        {
          sequence: 50,
          occurrence: 2,
          point: {
            kind: "script",
            mapId: 7,
            script: "entry",
            instruction: 0,
          },
        },
      ]),
      recorder = await new BoundaryCheckpoints(dir, null, { select }).open();
    recorder.event(game, { kind: "script", script: "entry" });
    recorder.event(game, { kind: "map" });
    game.player.x = 9;
    game.player.visible = false;
    game.time = 99;
    recorder.event(game, { kind: "script", script: "entry" });
    const manifest = await recorder.finish({});
    assert.equal(manifest.entries.length, 1);
    assert.equal(manifest.entries[0].sequence, 3);
    assert.equal(manifest.entries[0].referenceSequence, 50);
    const graph = JSON.parse(await readFile(path.join(dir, manifest.entries[0].file))),
      restored = decodeAcceptanceState(graph, {
        data: game.data,
        battleData: game.battleData,
        map: game.map,
      });
    assert.equal(restored.state.time, 99);
    assert.equal(restored.state.player.x, 9);
    assert.equal(restored.state.player.visible, false);
    assert.equal(game.time, 99);
    assert.deepEqual(game.tasks, []);
    assert.equal(select({ kind: "script", mapId: 8, script: "entry", instruction: 0 }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
