import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { executeInstruction } from "./instructions.js";

test("Figaro's first king conversation takes the camera from the followed player, not the entrance", async () => {
  // PR map34 enters at102,55. NPC19 starts sc_e0026 on confirmation; its
  // first puppet routes both player and camera to101,43 before the dialogue.
  const npc = {
    id: "19",
    kind: 6,
    x: 101,
    y: 42,
    layer: 1,
    script: "sc_e_0026",
    npc: { collision: true, acceptDirection: 15, interaction: { actionId: 2 } },
  };
  const game = new PlayGame({
    data: {
      byMap: {},
      global: { init: 0, sc_e_0026: 1 },
      programs: {
        0: { name: "init", ops: [["Exit", [], [], []]] },
        1: {
          name: "sc_e_0026",
          ops: [
            ["SetPuppet", [0, -1001, 5], [], []],
            ["SetPuppet", [1, 0, 7], [], []],
            ["ExecPuppet", [0], [], []],
            ["Msg", [], [], ["greeting"]],
            ["Exit", [], [], []],
            ["Route", [101, 43, 0, 0], [], []],
            ["Exit", [], [], []],
            ["Route", [101, 43, 0, 0], [], []],
            ["Exit", [], [], []],
          ],
        },
      },
      messages: { greeting: "欢迎。" },
      speakers: {},
    },
    loadMap: async () => ({
      width: 120,
      height: 70,
      initializer: "init",
      entities: [{ id: "5", kind: 0, objectId: 1, x: 102, y: 55, layer: 1 }, npc],
    }),
  });
  await game.enter(34, 1);
  game.tick(0.05);
  for (let step = 0; step < 13; step++) assert.equal(game.move("up"), true);
  assert.equal(game.dialogue, null, "the PR NPC is not an automatic arrival scene");
  assert.equal(game.move("left"), false, "the king's body stops ordinary movement");
  assert.equal(game.confirm(), true);
  game.tick(0.05);
  game.tick(0.05);
  assert.deepEqual(
    [game.camera.motion.x, game.camera.motion.y, game.camera.motion.duration],
    [102, 42, 0.48],
  );
  assert.deepEqual(game.camera.motion, game.player.motion);
  for (let step = 0; step < 14; step++) game.tick(0.05);
  assert.equal(game.dialogue.key, "greeting");
  assert.deepEqual([game.camera.x, game.camera.y], [101, 43]);
});

test("relative camera moves use the follow anchor while explicit positions and manual moves stay authored", () => {
  const game = new PlayGame({ data: { programs: {} } });
  Object.assign(game.player, { x: 40, y: 25 });
  Object.assign(game.camera, { x: 4, y: 6, manual: false });
  const run = (name, i = [], r = []) => {
    const task = { actor: 0 };
    assert.equal(executeInstruction(game, task, name, i, r, [], game.camera), true);
  };
  run("Move", [1, 2, 0]);
  assert.deepEqual(
    [game.camera.motion.x, game.camera.motion.y, game.camera.motion.tx, game.camera.motion.ty],
    [40, 25, 42, 25],
  );
  assert.equal(game.camera.motion.duration, 0.48);
  Object.assign(game.camera, { x: 4, y: 6, manual: false, motion: null });
  run("Lerp", [44, 25, 0], [0.8]);
  assert.equal(game.camera.motion.x, 40);
  assert.equal(game.camera.motion.duration, 0.8, "explicit tween duration is retained");
  run("SetPos", [80, 90, 0]);
  assert.deepEqual([game.camera.x, game.camera.y, game.camera.manual], [80, 90, true]);
  run("Route", [82, 90, 0, 0]);
  assert.deepEqual(
    [game.camera.motion.x, game.camera.motion.y, game.camera.motion.tx, game.camera.motion.ty],
    [80, 90, 82, 90],
  );
  assert.equal(game.camera.motion.duration, 0.48);
});
