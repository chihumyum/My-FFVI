import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { pathTo } from "./m1-route.js";
import { routeToStory } from "./navigation.js";
import { executeInstruction } from "./instructions.js";

test("moving a portal preserves its entity visibility and pathfinding uses all current portal positions", () => {
  const game = new PlayGame({ data: {} });
  game.mapId = 1;
  game.map = { width: 8, height: 8 };
  game.player = { x: 2, y: 4, layer: 0 };
  game.entities = [
    { id: "1", kind: 3, x: 1, y: 5, layer: 0 },
    { id: "2", kind: 3, x: 2, y: 5, layer: 0 },
  ];
  const one = game.actor(1),
    two = game.actor(2);
  assert.equal(one.visible, true);
  one.x = 2;
  two.x = 1;
  assert.deepEqual(pathTo(game, one), ["down"]);
});

test("confirm selects the actor directly in front rather than an adjacent actor", () => {
  const game = new PlayGame({ data: {} }),
    chosen = [];
  game.player = { x: 28, y: 27, layer: 1, direction: "down" };
  game.entities = [
    { id: "soldier", x: 27, y: 27, layer: 1, script: "soldier" },
    { id: "kefka", x: 28, y: 28, layer: 1, script: "kefka" },
  ];
  game.startScript = (name) => chosen.push(name);
  assert.equal(game.interact(), true);
  assert.deepEqual(chosen, ["kefka"]);
});

test("an interaction route approaches from a direction that reaches the requested source branch", () => {
  const g = new PlayGame({ data: {} });
  g.mapId = 1;
  g.map = { width: 8, height: 8 };
  g.player = { x: 5, y: 4, layer: 1 };
  g.entities = [];
  const target = {
    id: "actor",
    kind: 6,
    x: 4,
    y: 4,
    layer: 1,
    allowedDirections: ["right"],
  };
  const route = pathTo(g, target),
    point = { x: 5, y: 4 };
  for (const step of route) {
    const [dx, dy] = {
      up: [0, -1],
      right: [1, 0],
      down: [0, 1],
      left: [-1, 0],
    }[step];
    point.x += dx;
    point.y += dy;
    assert.notDeepEqual(point, { x: 4, y: 4 });
  }
  assert.deepEqual(point, { x: 3, y: 4 });
});

test("a single exported layer zero accepts the PR default layer one without moving to a nonexistent layer", () => {
  const game = new PlayGame({ data: {} }),
    actor = { x: 1, y: 1, layer: 0 };
  game.map = { collisions: {}, entities: [{ layer: 0 }] };
  game.warn = () => {};
  executeInstruction(game, {}, "SetPos", [4, 5, 1], [], [], actor);
  assert.equal(actor.layer, 0);
});

test("cross-map navigation distinguishes two entrances of one disconnected map without writing plot flags", () => {
  const init = "init",
    entry = (id, region, destination, script) => ({
      id,
      kind: destination ? 3 : 6,
      x: 1,
      y: 1,
      layer: 1,
      group: "entity_default",
      regions: [region],
      destination,
      script,
    });
  const data = {
    global: { init: 0, goal: 1, helper: 2 },
    byMap: {},
    programs: [
      {
        name: init,
        ops: [
          ["ChangeScript", [1], [], ["helper"]],
          ["SetFlag", [99], [], ["ScenarioFlag1"]],
          ["SetEntities", [], [], ["goal-group"]],
          ["Exit"],
        ],
      },
      { name: "goal", ops: [["Exit"]] },
      { name: "helper", ops: [["Exit"]] },
    ],
    navigation: {
      maps: {
        1: {
          id: 1,
          areaId: 1,
          initializer: init,
          entrances: { 1: { regions: [1] }, 2: { regions: [2] } },
          entries: [
            entry("lower", 1, { mapId: 2, entrance: 1 }),
            entry("upper", 2, { mapId: 4, entrance: 1 }),
            entry("world", 1, { mapId: 3, entrance: 1 }),
          ],
        },
        2: {
          id: 2,
          areaId: 1,
          initializer: init,
          entrances: { 1: { regions: [1] } },
          entries: [entry("return-above", 1, { mapId: 1, entrance: 2 })],
        },
        3: {
          id: 3,
          areaId: 1,
          initializer: init,
          entrances: { 1: { regions: [1] } },
          entries: [entry("return-below", 1, { mapId: 1, entrance: 1 })],
        },
        4: {
          id: 4,
          areaId: 1,
          initializer: init,
          entrances: { 1: { regions: [1] } },
          entries: [{ ...entry("goal", 1, null, "goal"), group: "goal-group" }],
        },
      },
    },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.areaId = 1;
  game.entities = data.navigation.maps[1].entries;
  game.groups = new Set(["entity_default"]);
  game.banks = { ScenarioFlag1: { 14: 1 } };
  const before = JSON.stringify(game.banks);
  const result = routeToStory(game, "goal", (_game, target) =>
    target.id === "upper" ? null : ["up"],
  );
  assert.equal(result.target.id, "lower");
  assert.equal(JSON.stringify(game.banks), before);
});
