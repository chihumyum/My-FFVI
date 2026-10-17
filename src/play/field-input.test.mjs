import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";

test("a confirm action opens the source door instead of invoking an overlapping touch warp", () => {
  const started = [];
  const game = new PlayGame({ data: { init: [], programs: {} } });
  game.startScript = (name) => started.push(name);
  game.mapId = 445;
  game.triggered = new Set();
  game.map = { width: 100, height: 100 };
  game.entities = [
    { id: "57", kind: 2, x: 76, y: 51, layer: 1, script: "sc_e_0766" },
    {
      id: "1",
      kind: 5,
      x: 76,
      y: 51,
      layer: 1,
      script: "sc_e_0771",
      mapObject: { collision: true },
    },
  ];
  Object.assign(game.player, { x: 76, y: 52, layer: 1, direction: "up" });
  assert.equal(game.interact(), true);
  assert.deepEqual(started, ["sc_e_0771"]);
  game.actors.set("1", { visible: false });
  assert.equal(
    game.move("up"),
    true,
    "after the source removes the door, the original touch warp works",
  );
  assert.deepEqual(started, ["sc_e_0771", "sc_e_0766"]);
});

test("vehicle-specific touch triggers cannot fire from walking into a flight body", () => {
  const started = [];
  const game = new PlayGame({ data: { init: [], programs: {} } });
  game.startScript = (name) => started.push(name);
  game.map = { width: 4, height: 4 };
  game.mapId = 2;
  game.entities = [
    { id: "171", kind: 2, x: 1, y: 0, layer: 0, script: "sc_e_0964", transportationIds: [5] },
  ];
  assert.equal(game.move("right"), true);
  assert.deepEqual(started, []);
});

test("a source-armed trigger interruption survives Hide without enabling ordinary hidden triggers", () => {
  const started = [];
  const game = new PlayGame({
    data: { init: [], programs: { hide: { name: "source-hide", ops: [["Hide", [], [], []]] } } },
  });
  game.startScript = (name) => started.push(name);
  game.mapId = 631;
  game.map = { width: 4, height: 4 };
  game.triggered = new Set();
  const trigger = { id: "168", kind: 2, x: 1, y: 0, layer: 0, script: "sc_e_0608", visible: true };
  game.entities = [trigger];
  game.actors.set("168", { ...trigger });
  game.step({ program: "hide", pc: 0, actor: "168", locals: [], stack: [] });
  assert.equal(game.move("right"), true);
  assert.deepEqual(started, []);
  game.player.x = 0;
  game.triggerChangesScript = true;
  game.triggerActor = -1001;
  game.triggerScriptProgram = "hide";
  game.step({ program: "hide", pc: 0, actor: "168", locals: [], stack: [] });
  assert.equal(game.actors.get("168").visible, false);
  assert.equal(game.move("right"), true);
  assert.deepEqual(started, ["sc_e_0608"]);
  game.checkTriggers();
  assert.equal(started.length, 1);
});
