import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { routeToStory } from "./navigation.js";
import { physicalNavigation } from "./navigation-geometry.js";
import { compileNavigation } from "../../tools/export/navigation.mjs";

function room(id, entities, width = 9) {
  return {
    id,
    areaId: id,
    width,
    height: 3,
    initializer: "init",
    collisions: {
      1: Array.from({ length: width * 3 }, (_, cell) => (Math.floor(cell / width) === 1 ? 0 : 1)),
    },
    entities: [{ id: "spawn", objectId: 1, kind: 0, x: 0, y: 1, layer: 1 }, ...entities],
  };
}
const intersects = (a, b) => a.some((region) => b.includes(region));

test("navigation connectivity follows the same NPC, hidden-body and openable-door collision queries as movement", () => {
  const blocker = { id: "7", kind: 6, x: 4, y: 1, layer: 1, npc: { collision: true } };
  const portal = {
    id: "exit",
    kind: 3,
    x: 8,
    y: 1,
    layer: 1,
    destination: { mapId: 2, entrance: 1 },
  };
  const source = room(1, [blocker, portal]);
  const data = { programs: {}, byMap: {}, global: {} };
  const index = compileNavigation([source], data).maps[1];
  const game = new PlayGame({ data });
  const initialized = {
    groups: new Set(["entity_default"]),
    actorPositions: new Map(),
    actorStates: new Map(),
  };
  const before = JSON.stringify([game.player, game.banks, [...game.actors]]);
  let mapped = physicalNavigation(game, index, initialized);
  assert.equal(intersects(mapped.entrances[1].regions, mapped.entries[0].regions), false);
  initialized.actorStates.set(7, { visible: false });
  mapped = physicalNavigation(game, index, initialized);
  assert.equal(intersects(mapped.entrances[1].regions, mapped.entries[0].regions), true);
  assert.equal(JSON.stringify([game.player, game.banks, [...game.actors]]), before);
  Object.assign(game, {
    mapId: 1,
    map: source,
    entities: source.entities,
    groups: new Set(["entity_default"]),
    actors: new Map([["7", { ...blocker, visible: true }]]),
  });
  mapped = physicalNavigation(game, index, initialized);
  assert.equal(intersects(mapped.entrances[1].regions, mapped.entries[0].regions), false);
  game.actors.get("7").y = 0;
  mapped = physicalNavigation(game, index, initialized);
  assert.equal(
    intersects(mapped.entrances[1].regions, mapped.entries[0].regions),
    true,
    "a live body moving off the corridor invalidates the cached connectivity",
  );
  // A normal PR door opens through walking input; it is not a permanent wall.
  const door = {
    id: "door",
    objectId: 3,
    kind: 8,
    x: 4,
    y: 1,
    layer: 1,
    door: { actionId: 5, direction: 15, linkObjectId: 9 },
  };
  const tile = { id: "tile", objectId: 9, kind: 1, x: 4, y: 1, layer: 1 };
  const doorRoom = room(2, [door, tile, portal]);
  doorRoom.collisions[1][13] = 1;
  mapped = physicalNavigation(game, compileNavigation([doorRoom], data).maps[2], initialized);
  assert.equal(intersects(mapped.entrances[1].regions, mapped.entries[0].regions), true);
});

test("a remote initializer's Hide affects routing without executing a puppet or writing flags", () => {
  const portal = (id, x, mapId) => ({
    id,
    x,
    y: 1,
    layer: 1,
    kind: 3,
    destination: { mapId, entrance: 1 },
  });
  const maps = [
    room(1, [portal("hall", 8, 2)]),
    {
      ...room(2, [
        { id: "7", kind: 5, x: 4, y: 1, layer: 1, collision: true },
        portal("goal-door", 8, 3),
      ]),
      initializer: "hall-init",
    },
    room(3, [{ id: "goal", kind: 6, x: 5, y: 1, layer: 1, script: "goal" }]),
  ];
  const data = {
    byMap: {},
    global: { init: 0, "hall-init": 1, goal: 2 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      {
        name: "hall-init",
        ops: [
          ["Branch", [1, 1, 2], [], ["ScenarioFlag1", "＝", "imm"]],
          ["Exit"],
          ["SetPuppet", [0, 7, 5]],
          ["ExecPuppet", [0]],
          ["Exit"],
          ["Hide"],
          ["Exit"],
        ],
      },
      { name: "goal", ops: [["Exit"]] },
    ],
  };
  data.navigation = compileNavigation(maps, data);
  const game = new PlayGame({ data });
  Object.assign(game, {
    mapId: 1,
    areaId: 1,
    map: maps[0],
    entities: maps[0].entities,
    groups: new Set(["entity_default"]),
  });
  assert.equal(
    routeToStory(game, "goal", () => [], { allowStateTravel: false }).status,
    "no-route",
  );
  game.banks.ScenarioFlag1 = { 1: 1 };
  const before = JSON.stringify([game.player, game.banks, [...game.actors]]);
  assert.equal(routeToStory(game, "goal", () => [], { allowStateTravel: false }).target.id, "hall");
  assert.equal(JSON.stringify([game.player, game.banks, [...game.actors]]), before);
  assert.equal(game.tasks.length, 0);
});
