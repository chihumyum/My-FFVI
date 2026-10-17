import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { pathTo } from "./m1-route.js";
import { routeToStory, encountersForInput } from "./navigation.js";
import { executeInstruction } from "./instructions.js";
import { navigationRegions } from "../../tools/export/regions.mjs";

test("cross-map routing uses the source initializer NPC position without moving live actors", () => {
  const door = {
    id: "door",
    kind: 3,
    x: 2,
    y: 1,
    layer: 0,
    group: "entity_default",
    regions: [1],
    destination: { mapId: 2, entrance: 1 },
  };
  const npc = {
    id: "2",
    kind: 6,
    x: -1,
    y: 1,
    layer: 0,
    group: "entity_default",
    regions: [],
    script: "boss",
  };
  const data = {
    byMap: {},
    global: { init: 0, boss: 1 },
    programs: {
      0: {
        name: "init",
        ops: [
          ["SetPuppet", [0, 2, 3]],
          ["ExecPuppet", [0]],
          ["Exit"],
          ["SetPos", [3, 1, 1]],
          ["Exit"],
        ],
      },
      1: { name: "boss", ops: [["Exit"]] },
    },
    navigation: {
      maps: {
        1: { id: 1, entrances: { 1: { regions: [1] } }, entries: [door] },
        2: {
          id: 2,
          width: 5,
          height: 3,
          initializer: "init",
          regionRuns: {
            0: [
              [8, 1],
              [9, 0],
              [15, 1],
            ],
          },
          entrances: { 1: { regions: [1] } },
          entries: [npc],
        },
      },
    },
  };
  const game = new PlayGame({ data });
  Object.assign(game, {
    mapId: 1,
    entities: [door],
    player: { x: 1, y: 1, layer: 0 },
    groups: new Set(["entity_default"]),
  });
  const before = JSON.stringify([game.player, game.banks, npc]);
  const input = routeToStory(game, { scripts: ["boss"] }, () => ["right"]);
  assert.equal(input.target.id, "door");
  assert.equal(JSON.stringify([game.player, game.banks, npc]), before);
  assert.equal(game.tasks.length, 0);
});

test("a merchant without a dialogue script remains reachable through its PR product group", () => {
  const merchant = {
    id: "shop",
    kind: 6,
    x: 3,
    y: 2,
    layer: 0,
    productGroup: 8,
    group: "entity_default",
    regions: [1],
  };
  const data = {
    global: {},
    byMap: {},
    programs: {},
    navigation: {
      maps: {
        1: { id: 1, areaId: 1, entrances: {}, entries: [merchant] },
      },
    },
  };
  const game = new PlayGame({ data });
  Object.assign(game, {
    mapId: 1,
    areaId: 1,
    map: { width: 6, height: 6 },
    player: { x: 1, y: 2, layer: 0 },
    entities: [merchant],
    groups: new Set(["entity_default"]),
  });
  const input = routeToStory(game, { shops: [8] }, pathTo);
  assert.equal(input.target.id, "shop");
  assert.deepEqual(input.route, ["right"]);
  assert.deepEqual(game.banks, {});
});

test("supply shopping cannot use an unfinished source boss battle as a shortcut", () => {
  const gate = {
    id: "gate",
    kind: 2,
    x: 1,
    y: 0,
    layer: 0,
    script: "battle-door",
    regions: [1],
    group: "entity_default",
  };
  const merchant = {
    id: "merchant",
    kind: 6,
    x: 1,
    y: 0,
    layer: 0,
    productGroup: 8,
    regions: [1],
    group: "entity_default",
  };
  const data = {
    byMap: {},
    global: { "battle-door": 0 },
    programs: {
      0: { name: "battle-door", ops: [["Encount", [1]], ["ChangeMap", [2, 1]], ["Exit"]] },
    },
    navigation: {
      maps: {
        1: { id: 1, entrances: { 1: { regions: [1] } }, entries: [gate] },
        2: { id: 2, entrances: { 1: { regions: [1] } }, entries: [merchant] },
      },
    },
  };
  const g = new PlayGame({ data });
  Object.assign(g, { mapId: 1, entities: [gate], groups: new Set(["entity_default"]) });
  assert.equal(routeToStory(g, { shops: [8] }, () => []).status, "no-route");
  assert.equal(routeToStory(g, { action: "visit-map", maps: [2] }, () => []).target.id, "gate");
  assert.equal(g.tasks.length, 0);
});

test("a world route requiring the parked airship cannot fall back to a town-and-back loop", () => {
  const door = (id, x, to) => ({
    id,
    kind: 3,
    x,
    y: 0,
    layer: 0,
    regions: [1],
    group: "entity_default",
    destination: { mapId: to, entrance: 1 },
  });
  const near = door("town", 0, 2),
    far = door("other-continent", 4, 3),
    back = door("back", 0, 1);
  const data = {
    byMap: {},
    global: {},
    programs: {},
    navigation: {
      maps: {
        1: {
          id: 1,
          world: true,
          width: 5,
          height: 1,
          entries: [near, far],
          entrances: { 1: { x: 0, y: 0, layer: 0, regions: [1] } },
        },
        2: { id: 2, entries: [back], entrances: { 1: { regions: [1] } } },
        3: { id: 3, entries: [], entrances: { 1: { regions: [1] } } },
      },
    },
  };
  const game = new PlayGame({ data });
  Object.assign(game, {
    mapId: 1,
    entities: [near, far],
    player: { x: 0, y: 0, layer: 0 },
    groups: new Set(["entity_default"]),
  });
  game.banks.PlaySystems = { vehicles: { 4: { mapId: 1, x: 1, y: 0, layer: 0, enabled: true } } };
  const input = routeToStory(game, { action: "visit-map", maps: [3] }, (_game, target) =>
    target.id === "other-continent" ? null : ["right"],
  );
  assert.equal(input.requiresVehicle, true);
  assert.equal(input.status, "no-route");
  assert.equal(game.player.vehicle, undefined);
  assert.equal(game.tasks.length, 0);
});

test("flight reaches a cliff-bound cave through its walking entrance rather than landing inside the cliff", () => {
  const front = {
      id: "base",
      kind: 3,
      x: 3,
      y: 0,
      layer: 0,
      regions: [1, 2],
      group: "entity_default",
      destination: { mapId: 2, entrance: 1 },
    },
    cave = {
      id: "cave",
      kind: 3,
      x: 7,
      y: 0,
      layer: 0,
      regions: [2],
      group: "entity_default",
      destination: { mapId: 3, entrance: 1 },
    },
    back = {
      id: "back",
      kind: 3,
      x: 0,
      y: 0,
      layer: 0,
      regions: [1],
      group: "entity_default",
      destination: { mapId: 1, entrance: 2 },
    };
  const data = {
    byMap: {},
    global: {},
    programs: {},
    systemTables: {
      transportation: [{ id: 4, landing_group_id: 1 }],
      landingGroup: [{ id: 1, type2: 0, type3: 1 }],
    },
    navigation: {
      maps: {
        1: {
          id: 1,
          world: true,
          width: 8,
          height: 1,
          regionRuns: {
            0: [
              [3, 1],
              [4, 0],
              [8, 2],
            ],
          },
          entries: [front, cave],
          entrances: { 1: { regions: [1] }, 2: { regions: [2] } },
        },
        2: { id: 2, entries: [back], entrances: { 1: { regions: [1] } } },
        3: { id: 3, entries: [], entrances: { 1: { regions: [1] } } },
      },
    },
  };
  const game = new PlayGame({ data });
  Object.assign(game, {
    mapId: 1,
    entities: [front, cave],
    groups: new Set(["entity_default"]),
    player: { x: 1, y: 0, layer: 0, vehicle: 4 },
    map: {
      width: 8,
      height: 1,
      worldTerrain: {
        width: 8,
        height: 1,
        cells: [3, 3, 3, 2, 2, 2, 2, 2],
        footRows: { 2: { typeId: 2 }, 3: { typeId: 3 } },
      },
    },
  });
  const input = routeToStory(game, { action: "visit-map", maps: [3] }, () => ["right"]);
  assert.equal(input.target.id, "base");
  assert.equal(game.player.vehicle, 4);
});

test("an indoor route still honors landing restrictions on a future world map", () => {
  const portal = (id, x, y, regions, destination) => ({
    id,
    x,
    y,
    kind: 3,
    layer: 0,
    regions,
    destination,
    group: "entity_default",
  });
  const south = portal("south", 0, 1, [1], { mapId: 1, entrance: 1 }),
    north = portal("north", 6, 1, [1], { mapId: 1, entrance: 2 });
  const data = {
    byMap: {},
    global: {},
    programs: {},
    navigation: {
      maps: {
        1: {
          id: 1,
          world: true,
          width: 8,
          height: 1,
          regionRuns: {
            0: [
              [4, 1],
              [8, 2],
            ],
          },
          landingRegions: { 4: [1] },
          entrances: {
            1: { x: 1, y: 0, layer: 0, regions: [1] },
            2: { x: 5, y: 0, layer: 0, regions: [2] },
          },
          entries: [
            portal("base", 2, 0, [1], { mapId: 2, entrance: 1 }),
            portal("cave", 6, 0, [2], { mapId: 3, entrance: 1 }),
          ],
        },
        2: {
          id: 2,
          width: 8,
          height: 3,
          entries: [south, north],
          entrances: { 1: { regions: [1] }, 2: { regions: [1] } },
        },
        3: { id: 3, entries: [], entrances: { 1: { regions: [1] } } },
      },
    },
  };
  const game = new PlayGame({ data });
  Object.assign(game, {
    mapId: 2,
    map: { width: 8, height: 3 },
    entities: [south, north],
    player: { x: 1, y: 1, layer: 0 },
    groups: new Set(["entity_default"]),
  });
  game.banks.PlaySystems = {
    vehicles: {
      4: { mapId: 1, x: 1, y: 0, layer: 0, enabled: true },
    },
  };
  assert.equal(pathTo(game, south).length, 1);
  assert.equal(pathTo(game, north).length, 5);
  const before = JSON.stringify([game.player, game.banks, [...game.groups]]);
  const input = routeToStory(game, { action: "visit-map", maps: [3] }, pathTo);
  assert.equal(input.target.id, "north");
  assert.deepEqual(input.route, Array(5).fill("right"));
  assert.equal(JSON.stringify([game.player, game.banks, [...game.groups]]), before);
  assert.equal(game.tasks.length, 0);
});

test("readiness previews a portal that immediately starts a source battle on entry", () => {
  const data = {
    byMap: {},
    global: { init: 0, battle: 1 },
    programs: {
      0: { name: "init", ops: [["ChangeScript", [0], [], ["battle"]], ["Exit"]] },
      1: { name: "battle", ops: [["EncountBoss", [437]], ["Exit"]] },
    },
    navigation: {
      maps: {
        1: { id: 1, entries: [], entrances: {} },
        2: { id: 2, initializer: "init", entries: [], entrances: { 1: { x: 1, y: 2, layer: 0 } } },
      },
    },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  assert.deepEqual(
    encountersForInput(game, { target: { destination: { mapId: 2, entrance: 1 } } }),
    [437],
  );
  assert.equal(game.tasks.length, 0);
  assert.deepEqual(game.banks, {});
});

test("preparation forecasts timer battle chains without taking their future flags or map exits", () => {
  const input = {
    id: "board",
    kind: 6,
    x: 1,
    y: 0,
    layer: 0,
    regions: [1],
    group: "entity_default",
    script: "board",
  };
  const data = {
    byMap: {},
    global: { board: 0, timer: 1, after: 2 },
    programs: {
      0: { name: "board", ops: [["SetTimer", [1, 1], [8], ["timer"]], ["Exit"]] },
      1: {
        name: "timer",
        ops: [
          ["SetFlag", [8], [], ["ScenarioFlag1"]],
          ["Encount", [10, 11, 10, 12], [], ["after"]],
          ["Exit"],
        ],
      },
      2: { name: "after", ops: [["EncountBoss", [13]], ["ChangeMap", [2, 1]], ["Exit"]] },
    },
    navigation: {
      maps: {
        1: { id: 1, entries: [input], entrances: { 1: { regions: [1] } } },
        2: { id: 2, entries: [], entrances: { 1: { regions: [1] } } },
      },
    },
  };
  const game = new PlayGame({ data });
  Object.assign(game, { mapId: 1, entities: [input], groups: new Set(["entity_default"]) });
  const before = JSON.stringify([game.banks, game.player]);
  assert.deepEqual(encountersForInput(game, { target: input }), [10, 11, 12, 13]);
  assert.equal(routeToStory(game, { action: "visit-map", maps: [2] }, () => []).status, "no-route");
  assert.equal(JSON.stringify([game.banks, game.player]), before);
  assert.equal(game.tasks.length, 0);
});

test("PR walking terrain blocks ocean both in actual movement and the navigation connectivity index", () => {
  const door = (id, x, to) => ({
    id,
    kind: 3,
    x,
    y: 1,
    layer: 0,
    objectId: 1,
    group: "entity_default",
    destination: { mapId: to, entrance: 1 },
  });
  const map = {
    width: 5,
    height: 3,
    collisions: {},
    entities: [door("left", 0, 2), door("right", 4, 3)],
    worldTerrain: {
      width: 5,
      height: 3,
      loopType: 0,
      cells: [3, 3, 16, 3, 3, 3, 3, 16, 3, 3, 3, 3, 16, 3, 3],
      footRows: { 3: { typeId: 3 }, 16: { typeId: 16 } },
      transportRules: { 1: { collisionByFoot: { 3: 0, 16: 1 } } },
    },
  };
  const game = new PlayGame({ data: {} });
  Object.assign(game, { mapId: 1, map, entities: [], player: { x: 1, y: 1, layer: 0 } });
  assert.equal(game.move("right"), false);
  assert.equal(game.player.x, 1);
  const indexed = navigationRegions(map, map.entities, () => false);
  assert(!indexed.entries[0].regions.some((region) => indexed.entries[1].regions.includes(region)));
  assert(indexed.regionRuns[0].some(([, region]) => region === 0));
});

test("a source transport returning to its room can change the world exit without injecting its flag", () => {
  const entry = (id, x, regions, extra = {}) => ({
    id,
    kind: 3,
    x,
    y: 0,
    layer: 0,
    group: "entity_default",
    regions,
    ...extra,
  });
  const castle = entry("castle", 1, [1], { destination: { mapId: 2, entrance: 1 } });
  const operator = entry("operator", 1, [1], { kind: 6, script: "travel" });
  const exit = entry("exit", 2, [1], { kind: 2, script: "leave" });
  const data = {
    byMap: {},
    global: { travel: 0, leave: 1, init: 2 },
    programs: {
      0: {
        name: "travel",
        ops: [["SetFlag", [1], [], ["ScenarioFlag1"]], ["ChangeMap", [2, 1]], ["Exit"]],
      },
      1: {
        name: "leave",
        ops: [
          ["Branch", [1, 1, 2], [], ["ScenarioFlag1", "＝", "imm"]],
          ["ChangeMap", [1, 1]],
          ["ChangeMap", [1, 2]],
          ["Exit"],
        ],
      },
      2: { name: "init", ops: [["Exit"]] },
    },
    navigation: {
      maps: {
        1: {
          id: 1,
          width: 5,
          height: 1,
          initializer: "init",
          entrances: {
            1: { x: 0, y: 0, layer: 0, regions: [1] },
            2: { x: 4, y: 0, layer: 0, regions: [2] },
          },
          entries: [castle, entry("goal-door", 4, [2], { destination: { mapId: 3, entrance: 1 } })],
        },
        2: {
          id: 2,
          width: 3,
          height: 1,
          initializer: "init",
          entrances: { 1: { x: 0, y: 0, layer: 0, regions: [1] } },
          entries: [operator, exit],
        },
        3: {
          id: 3,
          width: 1,
          height: 1,
          initializer: "init",
          entrances: { 1: { x: 0, y: 0, layer: 0, regions: [1] } },
          entries: [],
        },
      },
    },
  };
  const g = new PlayGame({ data });
  Object.assign(g, {
    mapId: 1,
    map: data.navigation.maps[1],
    entities: [castle],
    player: { x: 0, y: 0, layer: 0 },
    groups: new Set(["entity_default"]),
  });
  const objective = { action: "visit-map", maps: [3] },
    path = () => ["right"];
  assert.equal(routeToStory(g, objective, path, { allowStateTravel: false }).status, "no-route");
  const before = JSON.stringify([g.player, g.banks]);
  const input = routeToStory(g, objective, path);
  assert.equal(input.target.id, "castle");
  assert.equal(input.transport, true);
  assert.equal(JSON.stringify([g.player, g.banks]), before);
  assert.equal(g.tasks.length, 0);
});

test("rest navigation checks the real inn fee and does not seek healing behind a boss", () => {
  const entry = (id, x, script) => ({
    id,
    kind: 6,
    x,
    y: 2,
    layer: 0,
    script,
    group: "entity_default",
    regions: [1],
  });
  const inn = entry("inn", 3, "inn"),
    trap = entry("boss", 1, "boss");
  const data = {
    global: { inn: 0, boss: 1 },
    byMap: {},
    programs: {
      0: {
        name: "inn",
        ops: [
          ["RemoveGil", [100]],
          ["Branch", [0, 0, 4], [], ["MapLocalVariable", "＝", "imm"]],
          ["RecoveryHP"],
          ["Exit"],
          ["Exit"],
        ],
      },
      1: { name: "boss", ops: [["EncountBoss", [100]], ["RecoveryHP"], ["Exit"]] },
    },
    navigation: { maps: { 1: { id: 1, areaId: 1, entrances: {}, entries: [inn, trap] } } },
  };
  const game = new PlayGame({ data });
  Object.assign(game, {
    mapId: 1,
    areaId: 1,
    map: { width: 6, height: 6 },
    gil: 90,
    player: { x: 2, y: 2, layer: 0 },
    entities: [inn, trap],
    groups: new Set(["entity_default"]),
  });
  assert.equal(routeToStory(game, { rest: "hp" }, pathTo).status, "no-route");
  game.gil = 100;
  assert.equal(routeToStory(game, { rest: "hp" }, pathTo).target.id, "inn");
  assert.equal(game.gil, 100);
  assert.deepEqual(game.banks, {});
});

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
    byMap: {},
    global: { init: 0, wire: 1, goal: 2 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      { name: "wire", ops: [["SetEntities", [], [], ["revealed"]], ["Exit"]] },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: {
      maps: {
        1: {
          id: 1,
          initializer: "init",
          entrances: {},
          entries: [tripwire, target],
        },
      },
    },
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
  const game = new PlayGame({
    data: {
      global: { door: 0 },
      byMap: {},
      programs: [{ name: "door", ops: [["Msg"], ["ChangeMap", [2, 1]]] }],
    },
  });
  game.mapId = 1;
  game.map = { width: 8, height: 8 };
  game.player = { x: 2, y: 4, layer: 1 };
  game.entities = [{ id: "other-exit", kind: 2, x: 4, y: 3, layer: 1, script: "door" }];
  const target = {
    id: "exit",
    kind: 2,
    x: 4,
    y: 4,
    layer: 1,
    approach: true,
    allowedDirections: ["down"],
  };
  assert.equal(pathTo(game, target), null);
});

test("navigation follows authored staging-map and battle continuations without executing them", () => {
  const wire = { id: "start", kind: 2, script: "start", group: "entity_default", regions: [1] },
    goal = { id: "goal", kind: 6, script: "goal", group: "entity_default", regions: [1] };
  const data = {
    global: { init: 0, start: 1, staged: 2, afterBattle: 3, goal: 4 },
    byMap: {},
    programs: [
      { name: "init", ops: [["Exit"]] },
      {
        name: "start",
        ops: [
          ["Calc", [1, 4], [], ["AreaLocalVariable", "←", "imm"]],
          ["ChangeMap", [2, 1], [], ["staged"]],
        ],
      },
      {
        name: "staged",
        ops: [
          ["Branch", [1, 4, 2], [], ["AreaLocalVariable", "＝", "imm"]],
          ["Exit"],
          ["Encount", [42], [], ["afterBattle"]],
        ],
      },
      { name: "afterBattle", ops: [["ChangeMap", [3, 1]]] },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: {
      maps: Object.fromEntries(
        [1, 2, 3].map((id) => [
          id,
          {
            id,
            areaId: 1,
            initializer: "init",
            entrances: { 1: { regions: [1] } },
            entries: id === 1 ? [wire] : id === 3 ? [goal] : [],
          },
        ]),
      ),
    },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.areaId = 1;
  game.entities = [wire];
  game.groups = new Set(["entity_default"]);
  const before = JSON.stringify(game.banks);
  const input = routeToStory(game, "goal", () => ["up"]);
  assert.equal(input.target.id, "start");
  assert.equal(JSON.stringify(game.banks), before);
  assert.equal(game.tasks.length, 0);
});

test("an NPC across one blocked counter can be reached and interacted with from the public side", () => {
  const game = new PlayGame({ data: { programs: {}, byMap: {}, global: {} } }),
    chosen = [];
  game.mapId = 1;
  const grid = Array(36).fill(0);
  grid[2 * 6 + 3] = 1;
  game.map = { width: 6, height: 6, collisions: { 0: grid } };
  game.player = { x: 3, y: 3, layer: 0, direction: "up" };
  const npc = { id: "seller", kind: 6, x: 3, y: 1, layer: 0, script: "shop" };
  game.entities = [npc];
  game.groups = new Set();
  game.startScript = (name) => chosen.push(name);
  game.warn = () => {};
  assert.deepEqual(pathTo(game, npc), []);
  assert.equal(game.interact(), true);
  assert.deepEqual(chosen, ["shop"]);
});

test("an interaction avoids directions that immediately exit its own named script", () => {
  const npc = {
    id: "npc",
    kind: 6,
    x: 3,
    y: 3,
    layer: 1,
    script: "talk",
    group: "entity_default",
    regions: [1],
  };
  const data = {
    byMap: {},
    global: { init: 0, talk: 1 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      {
        name: "talk",
        ops: [
          ["BranchByPlayerDirection", [1, 2, 1, 2]],
          ["Exit"],
          ["SetFlag", [149], [], ["ScenarioFlag1"]],
          ["Exit"],
        ],
      },
    ],
    navigation: { maps: { 1: { id: 1, initializer: "init", entrances: {}, entries: [npc] } } },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.entities = [npc];
  game.groups = new Set(["entity_default"]);
  const before = JSON.stringify(game.banks);
  const input = routeToStory(
    game,
    { scripts: ["talk"], complete: { flag: ["ScenarioFlag1", 149, 1] } },
    () => [],
  );
  assert.deepEqual(input.target.allowedDirections, ["right", "left"]);
  assert.equal(JSON.stringify(game.banks), before);
  assert.equal(game.tasks.length, 0);
});

test("a source player puppet jump connects separate collision islands without moving the live player", () => {
  const jump = {
      id: "jump",
      kind: 6,
      x: 1,
      y: 0,
      layer: 1,
      group: "entity_default",
      script: "jump",
      regions: [1],
    },
    exit = {
      id: "exit",
      kind: 3,
      group: "entity_default",
      regions: [2],
      destination: { mapId: 2, entrance: 1 },
    },
    goal = { id: "goal", kind: 6, group: "entity_default", script: "goal", regions: [1] };
  const data = {
    byMap: {},
    global: { init: 0, jump: 1, goal: 2 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      {
        name: "jump",
        ops: [
          ["SetPuppet", [0, -1001, 3]],
          ["ExecPuppet", [0]],
          ["Exit"],
          ["SetPos", [2, 0, 2]],
          ["Return"],
        ],
      },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: {
      maps: {
        1: {
          id: 1,
          width: 4,
          height: 1,
          initializer: "init",
          regionRuns: {
            1: [
              [2, 1],
              [4, 2],
            ],
          },
          entrances: { 1: { x: 0, y: 0, layer: 1, regions: [1] } },
          entries: [jump, exit],
        },
        2: { id: 2, initializer: "init", entrances: { 1: { regions: [1] } }, entries: [goal] },
      },
    },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.player = { x: 0, y: 0, layer: 1 };
  game.entities = [jump, exit];
  game.groups = new Set(["entity_default"]);
  const input = routeToStory(game, "goal", (_game, target) =>
    target.id === "exit" ? null : ["right"],
  );
  assert.equal(input.target.id, "jump");
  assert.deepEqual(game.player, { x: 0, y: 0, layer: 1 });
  assert.equal(game.tasks.length, 0);
});

test("PR all_layers permits bedside interaction from the floor while ordinary NPCs remain on their own layer", () => {
  const game = new PlayGame({ data: {} }),
    chosen = [];
  game.map = { width: 6, height: 6 };
  game.player = { x: 2, y: 3, layer: 1, direction: "right" };
  const npc = {
    id: "bed",
    kind: 6,
    x: 3,
    y: 3,
    layer: 2,
    script: "talk",
    npc: { allLayers: false },
  };
  game.entities = [npc];
  game.startScript = (name) => chosen.push(name);
  assert.equal(game.interactionDistance(npc), 0);
  assert.equal(game.interact(), false);
  npc.npc.allLayers = true;
  assert.deepEqual(pathTo(game, { ...npc, allowedDirections: ["right"] }), []);
  assert.equal(game.interact(), true);
  assert.deepEqual(chosen, ["talk"]);
});

test("formation navigation follows a reachable source menu rather than a guarded-out menu name", () => {
  const entry = (id, script) => ({ id, kind: 6, script, group: "entity_default" });
  const data = {
    byMap: {},
    global: { init: 0, blocked: 1, available: 2 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      {
        name: "blocked",
        ops: [
          ["Branch", [1, 0, 2], [], ["ScenarioFlag1", "＝", "imm"]],
          ["SysCall", [], [], ["formation"]],
          ["Exit"],
        ],
      },
      { name: "available", ops: [["SysCall", [], [], ["formation"]], ["Exit"]] },
    ],
    navigation: {
      maps: {
        1: {
          id: 1,
          initializer: "init",
          entrances: {},
          entries: [entry("blocked", "blocked"), entry("available", "available")],
        },
      },
    },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.entities = data.navigation.maps[1].entries;
  game.groups = new Set(["entity_default"]);
  assert.equal(routeToStory(game, { syscalls: ["formation"] }, () => []).target.id, "available");
  assert.equal(game.tasks.length, 0);
});

test("the field host cannot enter a walking town trigger while the player is airborne", () => {
  const game = new PlayGame({ data: {} });
  game.mapId = 1;
  game.map = { worldTerrain: {} };
  game.player = { x: 4, y: 5, layer: 0, vehicle: 4 };
  game.groups = new Set();
  game.triggered = new Set();
  game.entities = [
    { id: "town", kind: 3, x: 4, y: 5, layer: 0, destination: { mapId: 2, entrance: 1 } },
  ];
  const entered = [];
  game.enter = (map, entrance) => {
    entered.push([map, entrance]);
  };
  game.checkTriggers();
  assert.deepEqual(entered, []);
  game.player.vehicle = null;
  game.checkTriggers();
  assert.deepEqual(entered, [[2, 1]]);
});

test("world flight navigation wraps its search cells instead of exploring an infinite plane", () => {
  const game = new PlayGame({ data: {} });
  game.mapId = 1;
  game.map = { width: 256, height: 256, worldTerrain: { width: 256, height: 256, loopType: 3 } };
  game.player = { x: 84, y: 34, layer: 0, vehicle: 4 };
  game.entities = [];
  game.groups = new Set();
  game.warn = () => {};
  const route = pathTo(game, { id: "town", kind: 3, x: 165, y: 194, layer: 0 });
  assert.equal(route.length, 177);
  for (const direction of route) game.move(direction);
  assert.deepEqual([game.player.x, game.player.y], [165, 194]);
});

test("the navigation index connects PR kind17 innkeepers through a blocked counter", () => {
  const grid = Array(35).fill(0);
  for (let x = 0; x < 7; x++) grid[2 * 7 + x] = 1;
  const innkeeper = { id: "inn", kind: 17, x: 3, y: 1, layer: 2 },
    map = {
      width: 7,
      height: 5,
      collisions: { 2: grid },
      entities: [{ kind: 0, objectId: 1, x: 3, y: 4, layer: 2 }],
    },
    result = navigationRegions(map, [innkeeper], () => false);
  assert(result.entries[0].regions.some((region) => result.entrances[1].regions.includes(region)));
});

test("a transition to layer zero changes the path and only triggers on its authored source layer", () => {
  const game = new PlayGame({ data: {} });
  game.mapId = 1;
  game.map = { width: 4, height: 3 };
  game.player = { x: 0, y: 1, layer: 1 };
  game.groups = new Set();
  game.triggered = new Set();
  game.entities = [
    { id: "wrong-floor", kind: 4, x: 1, y: 1, layer: 0, destinationLayer: 2 },
    { id: "stairs", kind: 4, x: 1, y: 1, layer: 1, destinationLayer: 0 },
  ];
  const route = pathTo(game, { id: "bottom", kind: 0, x: 2, y: 1, layer: 0 });
  assert.deepEqual(route, ["right", "right"]);
  for (const direction of route) game.move(direction);
  assert.equal(game.player.layer, 0);
});

test("a solid staging entrance does not grant walking access to every collision island", () => {
  const door = (id, destination) => ({
      id,
      kind: 3,
      group: "entity_default",
      destination,
      regions: [1],
    }),
    goal = { id: "goal", kind: 6, group: "entity_default", script: "goal", regions: [2] };
  const data = {
    byMap: {},
    global: { init: 0, goal: 1 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: {
      maps: {
        1: {
          id: 1,
          initializer: "init",
          entrances: { 1: { regions: [1] } },
          entries: [
            door("solid-spawn", { mapId: 2, entrance: 1 }),
            door("walkable-spawn", { mapId: 3, entrance: 1 }),
          ],
        },
        2: {
          id: 2,
          width: 4,
          height: 4,
          initializer: "init",
          regionRuns: {
            1: [
              [8, 0],
              [16, 2],
            ],
          },
          entrances: { 1: { regions: [] } },
          entries: [goal],
        },
        3: { id: 3, initializer: "init", entrances: { 1: { regions: [2] } }, entries: [goal] },
      },
    },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.entities = data.navigation.maps[1].entries;
  game.groups = new Set(["entity_default"]);
  assert.equal(routeToStory(game, "goal", () => []).target.id, "walkable-spawn");
});

test("a flag-enabled initializer group is refreshed through an ordinary exit without activating it in place", () => {
  const exit = {
      id: "door",
      kind: 3,
      group: "entity_default",
      destination: { mapId: 2, entrance: 1 },
    },
    npc = { id: "cid", kind: 6, group: "new-scene", script: "goal" };
  const data = {
    byMap: {},
    global: { init: 0, goal: 1 },
    programs: [
      {
        name: "init",
        ops: [
          ["Branch", [13, 1, 2], [], ["ScenarioFlag3", "＝", "imm"]],
          ["Exit"],
          ["SetEntities", [], [], ["new-scene"]],
          ["Exit"],
        ],
      },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: {
      maps: { 1: { id: 1, initializer: "init", entrances: {}, entries: [exit, npc] } },
    },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.groups = new Set(["entity_default", "old-scene"]);
  game.entities = [exit];
  game.banks.ScenarioFlag3 = { 13: 1 };
  const result = routeToStory(game, "goal", () => ["down"]);
  assert.equal(result.target.id, "door");
  assert.equal(result.refresh, true);
  assert.deepEqual([...game.groups], ["entity_default", "old-scene"]);
  assert.equal(game.tasks.length, 0);
});

test("an assigned moving NPC is allowed to finish instead of restarting its route through a map exit", () => {
  const npc = { id: "7", kind: 6, script: "goal", group: "entity_default", x: 97, y: 38, layer: 1 };
  const data = {
    byMap: {},
    global: { init: 0, goal: 1 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: { maps: { 1: { id: 1, initializer: "init", entrances: {}, entries: [npc] } } },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.groups = new Set(["entity_default"]);
  game.entities = [npc];
  game.actors.set("7", { ...npc, x: 97.2, motion: { tx: 99, ty: 38 } });
  game.assignedRouteTasks = new Map([[7, { done: false }]]);
  assert.equal(routeToStory(game, "goal", () => null).status, "wait-npc");
  assert.deepEqual([...game.groups], ["entity_default"]);
});

test("a forced cinematic continuation does not expose the staging map's ordinary exits", () => {
  const entry = (id, script, destination, x = 1) => ({
      id,
      kind: script ? 2 : 3,
      script,
      destination,
      x,
      y: 0,
      layer: 1,
      group: "entity_default",
      regions: [1],
    }),
    goal = { id: "goal", kind: 6, script: "goal", group: "entity_default", regions: [1] };
  const data = {
    byMap: {},
    global: { init: 0, trip: 1, stage: 2, goal: 3 },
    programs: [
      { name: "init", ops: [["Exit"]] },
      { name: "trip", ops: [["ChangeMap", [2, 1], [], ["stage"]]] },
      { name: "stage", ops: [["ChangeMap", [3, 1]]] },
      { name: "goal", ops: [["Exit"]] },
    ],
    navigation: {
      maps: {
        1: {
          id: 1,
          initializer: "init",
          entrances: { 1: { regions: [1] } },
          entries: [entry("cinematic", "trip"), entry("real", null, { mapId: 4, entrance: 1 }, 5)],
        },
        2: { id: 2, initializer: "init", entrances: { 1: { regions: [1] } }, entries: [goal] },
        3: { id: 3, initializer: "init", entrances: { 1: { regions: [1] } }, entries: [] },
        4: { id: 4, initializer: "init", entrances: { 1: { regions: [1] } }, entries: [goal] },
      },
    },
  };
  const game = new PlayGame({ data });
  game.mapId = 1;
  game.player = { x: 0, y: 0, layer: 1 };
  game.entities = data.navigation.maps[1].entries;
  game.groups = new Set(["entity_default"]);
  assert.equal(routeToStory(game, "goal", () => []).target.id, "real");
});
