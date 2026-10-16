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

test("navigation uses a real tripwire before an interaction group appears", () => {
  const tripwire = { id: "wire", kind: 2, script: "wire", group: "entity_default" },
    target = { id: "npc", kind: 6, script: "goal", group: "revealed" };
  const data = {
    byMap: {}, global: { init: 0, wire: 1, goal: 2 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      { name: "wire", ops: [["SetEntities", [], [], ["revealed"]], ["Exit"]] },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: { maps: { 1: {
      id: 1, initializer: "init", entrances: {}, entries: [tripwire, target],
    } } },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.entities = [tripwire];
  game.groups = new Set(["entity_default"]);
  assert.equal(routeToStory(game, "goal", () => ["up"]).target.id, "wire");
  assert.deepEqual([...game.groups], ["entity_default"]);
  game.groups.add("revealed");
  game.entities.push(target);
  assert.equal(routeToStory(game, "goal", () => ["up"]).target.id, "npc");
});

test("approaching a directional exit cannot cross an adjacent exit that also displays dialogue", () => {
  const game = new PlayGame({ data: {
    global: { door: 0 }, byMap: {},
    programs: [{ name: "door", ops: [["Msg"], ["ChangeMap", [2, 1]]] }],
  } });
  game.mapId = 1;
  game.map = { width: 8, height: 8 };
  game.player = { x: 2, y: 4, layer: 1 };
  game.entities = [{ id: "other-exit", kind: 2, x: 4, y: 3, layer: 1, script: "door" }];
  const target = { id: "exit", kind: 2, x: 4, y: 4, layer: 1, approach: true, allowedDirections: ["down"] };
  assert.equal(pathTo(game, target), null);
});

test("navigation follows authored staging-map and battle continuations without executing them", () => {
  const wire = { id: "start", kind: 2, script: "start", group: "entity_default", regions: [1] },
    goal = { id: "goal", kind: 6, script: "goal", group: "entity_default", regions: [1] };
  const data = {
    global: { init: 0, start: 1, staged: 2, afterBattle: 3, goal: 4 }, byMap: {},
    programs: [
      { name: "init", ops: [["Exit"]] },
      { name: "start", ops: [["Calc", [1, 4], [], ["AreaLocalVariable", "←", "imm"]],
        ["ChangeMap", [2, 1], [], ["staged"]]] },
      { name: "staged", ops: [["Branch", [1, 4, 2], [], ["AreaLocalVariable", "＝", "imm"]],
        ["Exit"], ["Encount", [42], [], ["afterBattle"]]] },
      { name: "afterBattle", ops: [["ChangeMap", [3, 1]]] },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: { maps: Object.fromEntries([1, 2, 3].map(id => [id, {
      id, areaId: 1, initializer: "init", entrances: { 1: { regions: [1] } },
      entries: id === 1 ? [wire] : id === 3 ? [goal] : [],
    }])) },
  };
  const game = new PlayGame({ data });
  game.mapId = 1; game.areaId = 1; game.entities = [wire];
  game.groups = new Set(["entity_default"]);
  const before = JSON.stringify(game.banks);
  const input = routeToStory(game, "goal", () => ["up"]);
  assert.equal(input.target.id, "start");
  assert.equal(JSON.stringify(game.banks), before);
  assert.equal(game.tasks.length, 0);
});

test("an NPC across one blocked counter can be reached and interacted with from the public side", () => {
  const game = new PlayGame({ data: { programs: {}, byMap: {}, global: {} } }), chosen = [];
  game.mapId = 1;
  const grid = Array(36).fill(0);
  grid[2 * 6 + 3] = 1;
  game.map = { width: 6, height: 6, collisions: { 0: grid } };
  game.player = { x: 3, y: 3, layer: 0, direction: "up" };
  const npc = { id: "seller", kind: 6, x: 3, y: 1, layer: 0, script: "shop" };
  game.entities = [npc]; game.groups = new Set();
  game.startScript = name => chosen.push(name);
  game.warn = () => {};
  assert.deepEqual(pathTo(game, npc), []);
  assert.equal(game.interact(), true);
  assert.deepEqual(chosen, ["shop"]);
});
