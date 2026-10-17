import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BoundaryCheckpoints } from "./boundary-checkpoints.mjs";
import { decodeAcceptanceState } from "../../apps/play/acceptance-state.js";

test("every boundary retains VM/battle state and black frames without touching live getters", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffvi-frames-"));
  try {
    const actor = { id: -1001, x: 2, y: 3, animation: "Walk" },
      task = { program: 1, pc: 7, stack: [], scriptFrames: [] },
      game = {
        data: {},
        battleData: {},
        map: { name: "test" },
        mapId: 21,
        time: 0,
        player: actor,
        actors: new Map([["-1001", actor]]),
        tasks: [task],
        fade: { from: 1, to: 0, start: 0, duration: 2 },
      };
    Object.defineProperty(game, "party", {
      get() {
        throw Error("Lazy getter is forbidden");
      },
      enumerable: true,
    });
    const recorder = await new BoundaryCheckpoints(dir).open();
    for (const kind of ["script", "map"]) recorder.event(game, { kind, script: "entry" });
    const battle = { encounterId: 4, players: [], enemies: [], phase: "active" };
    game.battle = battle;
    recorder.event(game, { kind: "battle", encounterId: 4 });
    recorder.observe(game);
    assert.equal(recorder.entries.length, 3, "Black boundaries stay, no premature visible context");
    game.time = 2;
    recorder.observe(game);
    assert.equal(recorder.entries.at(-1).kind, "context");
    battle.phase = battle.outcome = "victory";
    game.battle = null;
    recorder.event(game, { kind: "battle-end", encounterId: 4 });
    const manifest = await recorder.finish({});
    assert.deepEqual(manifest.counts, {
      map: 1,
      script: 1,
      battle: 1,
      "battle-end": 1,
      "program-entry": 0,
      context: 1,
    });
    const file = JSON.parse(await readFile(path.join(dir, manifest.entries.at(-1).file))),
      restored = decodeAcceptanceState(file, {
        data: game.data,
        battleData: game.battleData,
        map: game.map,
      });
    assert.equal(restored.state.battle.outcome, "victory");
    assert.equal(restored.state.tasks[0].pc, 7);
    assert.equal(restored.state.actors.get("-1001"), restored.state.player);
    assert.equal(game.battle, null);
    assert.equal(task.pc, 7);
    assert.deepEqual(actor, { id: -1001, x: 2, y: 3, animation: "Walk" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
