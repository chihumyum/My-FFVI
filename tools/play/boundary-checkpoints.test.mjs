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

test("handoffs link the old scene to visible settled context and keep unresolved fades explicit", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffvi-handoffs-"));
  try {
    const game = {
      data: { programs: {} },
      battleData: {},
      map: { name: "old scene" },
      mapId: 1,
      time: 0,
      player: { x: 2, y: 3 },
      actors: new Map(),
      tasks: [],
      busy: true,
      camera: {},
      fade: null,
    };
    const recorder = await new BoundaryCheckpoints(dir, null, { handoffs: true }).open();
    const before = recorder.beforeBoundary(game, "map", { nextMapId: 2 });
    game.mapId = 2;
    game.map = { name: "new scene" };
    game.fade = { from: 1, to: 0, start: 0, duration: 2 };
    recorder.event(game, { kind: "map" });
    game.time = 1;
    recorder.observe(game);
    assert.equal(recorder.entries.at(-1).kind, "map", "A black transition is not accepted context");
    game.time = 2;
    game.camera.motion = { duration: 3 };
    recorder.observe(game);
    assert.equal(recorder.entries.at(-1).kind, "map", "Wait for the camera to settle");
    game.camera.motion = null;
    recorder.observe(game);
    const context = recorder.entries.at(-1);
    assert.equal(context.kind, "context");
    assert.deepEqual(context.parents, [before.sequence, before.sequence + 1]);
    game.busy = false;
    recorder.observe(game);
    assert.equal(recorder.entries.at(-1).kind, "control-return");
    game.fade = { from: 1, to: 1, start: 2, duration: 1 };
    recorder.event(game, { kind: "script", script: "unseen" });
    game.time = 3;
    game.mapId = 3;
    recorder.observe(game);
    const manifest = await recorder.finish({});
    assert.equal(manifest.unresolved.length, 1);
    assert.equal(manifest.unresolved[0].reason, "map-left-before-visible-context");
    const old = JSON.parse(await readFile(path.join(dir, before.file)));
    assert.equal(old.metadata.mapId, 1, "The before image retains the old map");
    assert.equal(old.metadata.nextMapId, 2);
    assert.equal(game.time, 3, "The observer never advances the game");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a source key wait preserves the final visible story frame without sending input", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffvi-key-frame-"));
  try {
    const game = {
        data: {},
        battleData: {},
        map: { name: "ending" },
        mapId: 584,
        time: 12,
        player: { x: 8, y: 9, visible: false },
        actors: new Map(),
        tasks: [],
      },
      task = { id: 1, program: 7, actor: null, pc: 23, stack: [] },
      program = { name: "ending", ops: [["SysCall", null, null, ["キー入力待ち"]]] },
      recorder = await new BoundaryCheckpoints(dir, null, { handoffs: true }).open();
    game.tasks.push(task);
    recorder.instruction(game, task, program, 0);
    const manifest = await recorder.finish({});
    assert.equal(manifest.counts["story-input"], 1);
    const entry = manifest.entries.find((row) => row.kind === "story-input"),
      frame = JSON.parse(await readFile(path.join(dir, entry.file))),
      restored = decodeAcceptanceState(frame, {
        data: game.data,
        battleData: game.battleData,
        map: game.map,
      });
    assert.equal(restored.state.player.visible, false);
    assert.equal(task.pc, 23);
    assert.equal(game.time, 12);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
