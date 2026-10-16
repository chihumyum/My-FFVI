import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { pathTo } from "./m1-route.js";
import { routeToStory } from "./navigation.js";
import { executeInstruction } from "./instructions.js";
import { navigationRegions } from "../../scripts/play-navigation-regions.mjs";

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

test("an interaction avoids directions that immediately exit its own named script", () => {
  const npc = { id: "npc", kind: 6, x: 3, y: 3, layer: 1,
    script: "talk", group: "entity_default", regions: [1] };
  const data = {
    byMap: {}, global: { init: 0, talk: 1 }, programs: [
      { name: "init", ops: [["Exit"]] },
      { name: "talk", ops: [["BranchByPlayerDirection", [1, 2, 1, 2]],
        ["Exit"], ["SetFlag", [149], [], ["ScenarioFlag1"]], ["Exit"]] },
    ], navigation: { maps: { 1: { id: 1, initializer: "init", entrances: {}, entries: [npc] } } },
  };
  const game = new PlayGame({ data });
  game.mapId = 1; game.entities = [npc]; game.groups = new Set(["entity_default"]);
  const before = JSON.stringify(game.banks);
  const input = routeToStory(game, { scripts: ["talk"], complete: { flag: ["ScenarioFlag1", 149, 1] } }, () => []);
  assert.deepEqual(input.target.allowedDirections, ["right", "left"]);
  assert.equal(JSON.stringify(game.banks), before);
  assert.equal(game.tasks.length, 0);
});

test("a source player puppet jump connects separate collision islands without moving the live player", () => {
  const jump = { id: "jump", kind: 6, x: 1, y: 0, layer: 1,
    group: "entity_default", script: "jump", regions: [1] },
    exit = { id: "exit", kind: 3, group: "entity_default", regions: [2], destination: { mapId: 2, entrance: 1 } },
    goal = { id: "goal", kind: 6, group: "entity_default", script: "goal", regions: [1] };
  const data = {
    byMap: {}, global: { init: 0, jump: 1, goal: 2 }, programs: [
      { name: "init", ops: [["Exit"]] },
      { name: "jump", ops: [["SetPuppet", [0, -1001, 3]], ["ExecPuppet", [0]],
        ["Exit"], ["SetPos", [2, 0, 2]], ["Return"]] },
      { name: "goal", ops: [["Exit"]] },
    ], navigation: { maps: {
      1: { id: 1, width: 4, height: 1, initializer: "init", regionRuns: { 1: [[2, 1], [4, 2]] },
        entrances: { 1: { x: 0, y: 0, layer: 1, regions: [1] } }, entries: [jump, exit] },
      2: { id: 2, initializer: "init", entrances: { 1: { regions: [1] } }, entries: [goal] },
    } },
  };
  const game = new PlayGame({ data });
  game.mapId = 1; game.player = { x: 0, y: 0, layer: 1 }; game.entities = [jump, exit];
  game.groups = new Set(["entity_default"]);
  const input = routeToStory(game, "goal", (_game, target) => target.id === "exit" ? null : ["right"]);
  assert.equal(input.target.id, "jump");
  assert.deepEqual(game.player, { x: 0, y: 0, layer: 1 });
  assert.equal(game.tasks.length, 0);
});

test("PR all_layers permits bedside interaction from the floor while ordinary NPCs remain on their own layer", () => {
  const game = new PlayGame({ data: {} }), chosen = [];
  game.map = { width: 6, height: 6 };
  game.player = { x: 2, y: 3, layer: 1, direction: "right" };
  const npc = { id: "bed", kind: 6, x: 3, y: 3, layer: 2, script: "talk", npc: { allLayers: false } };
  game.entities = [npc]; game.startScript = name => chosen.push(name);
  assert.equal(game.interactionDistance(npc), 0);
  assert.equal(game.interact(), false);
  npc.npc.allLayers = true;
  assert.deepEqual(pathTo(game, { ...npc, allowedDirections: ["right"] }), []);
  assert.equal(game.interact(), true);
  assert.deepEqual(chosen, ["talk"]);
});

test("formation navigation follows a reachable source menu rather than a guarded-out menu name", () => {
  const entry = (id, script) => ({ id, kind: 6, script, group: "entity_default" });
  const data = { byMap: {}, global: { init: 0, blocked: 1, available: 2 }, programs: [
    { name: "init", ops: [["Exit"]] },
    { name: "blocked", ops: [["Branch", [1, 0, 2], [], ["ScenarioFlag1", "＝", "imm"]],
      ["SysCall", [], [], ["formation"]], ["Exit"]] },
    { name: "available", ops: [["SysCall", [], [], ["formation"]], ["Exit"]] },
  ], navigation: { maps: { 1: { id: 1, initializer: "init", entrances: {},
    entries: [entry("blocked", "blocked"), entry("available", "available")] } } } };
  const game = new PlayGame({ data });
  game.mapId = 1; game.entities = data.navigation.maps[1].entries; game.groups = new Set(["entity_default"]);
  assert.equal(routeToStory(game, { syscalls: ["formation"] }, () => []).target.id, "available");
  assert.equal(game.tasks.length, 0);
});

test("the field host cannot enter a walking town trigger while the player is airborne", () => {
  const game = new PlayGame({ data: {} });
  game.mapId = 1; game.map = { worldTerrain: {} }; game.player = { x: 4, y: 5, layer: 0, vehicle: 4 };
  game.groups = new Set(); game.triggered = new Set();
  game.entities = [{ id: "town", kind: 3, x: 4, y: 5, layer: 0, destination: { mapId: 2, entrance: 1 } }];
  const entered = []; game.enter = (map, entrance) => { entered.push([map, entrance]); };
  game.checkTriggers(); assert.deepEqual(entered, []);
  game.player.vehicle = null; game.checkTriggers(); assert.deepEqual(entered, [[2, 1]]);
});

test("world flight navigation wraps its search cells instead of exploring an infinite plane", () => {
  const game = new PlayGame({ data: {} });
  game.mapId = 1; game.map = { width: 256, height: 256,
    worldTerrain: { width: 256, height: 256, loopType: 3 } };
  game.player = { x: 84, y: 34, layer: 0, vehicle: 4 }; game.entities = [];
  game.groups = new Set(); game.warn = () => {};
  const route = pathTo(game, { id: "town", kind: 3, x: 165, y: 194, layer: 0 });
  assert.equal(route.length, 177);
  for (const direction of route) game.move(direction);
  assert.deepEqual([game.player.x, game.player.y], [165, 194]);
});

test("the navigation index connects PR kind17 innkeepers through a blocked counter", () => {
  const grid = Array(35).fill(0);
  for (let x = 0; x < 7; x++) grid[2 * 7 + x] = 1;
  const innkeeper = { id: "inn", kind: 17, x: 3, y: 1, layer: 2 },
    map = { width: 7, height: 5, collisions: { 2: grid }, entities: [
      { kind: 0, objectId: 1, x: 3, y: 4, layer: 2 },
    ] }, result = navigationRegions(map, [innkeeper], () => false);
  assert(result.entries[0].regions.some(region => result.entrances[1].regions.includes(region)));
});

test("a transition to layer zero changes the path and only triggers on its authored source layer", () => {
  const game = new PlayGame({ data: {} });
  game.mapId = 1; game.map = { width: 4, height: 3 };
  game.player = { x: 0, y: 1, layer: 1 };
  game.groups = new Set(); game.triggered = new Set();
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
  const door = (id, destination) => ({ id, kind: 3, group: "entity_default", destination, regions: [1] }),
    goal = { id: "goal", kind: 6, group: "entity_default", script: "goal", regions: [2] };
  const data = { byMap: {}, global: { init: 0, goal: 1 }, programs: [
    { name: "init", ops: [["Exit"]] }, { name: "goal", ops: [["Exit"]] },
  ], navigation: { maps: {
    1: { id: 1, initializer: "init", entrances: { 1: { regions: [1] } }, entries: [
      door("solid-spawn", { mapId: 2, entrance: 1 }), door("walkable-spawn", { mapId: 3, entrance: 1 }),
    ] },
    2: { id: 2, width: 4, height: 4, initializer: "init", regionRuns: { 1: [[8, 0], [16, 2]] },
      entrances: { 1: { regions: [] } }, entries: [goal] },
    3: { id: 3, initializer: "init", entrances: { 1: { regions: [2] } }, entries: [goal] },
  } } };
  const game = new PlayGame({ data });
  game.mapId = 1; game.entities = data.navigation.maps[1].entries; game.groups = new Set(["entity_default"]);
  assert.equal(routeToStory(game, "goal", () => []).target.id, "walkable-spawn");
});

test("a flag-enabled initializer group is refreshed through an ordinary exit without activating it in place", () => {
  const exit = { id: "door", kind: 3, group: "entity_default", destination: { mapId: 2, entrance: 1 } },
    npc = { id: "cid", kind: 6, group: "new-scene", script: "goal" };
  const data = { byMap: {}, global: { init: 0, goal: 1 }, programs: [
    { name: "init", ops: [["Branch", [13, 1, 2], [], ["ScenarioFlag3", "＝", "imm"]],
      ["Exit"], ["SetEntities", [], [], ["new-scene"]], ["Exit"]] },
    { name: "goal", ops: [["Exit"]] },
  ], navigation: { maps: { 1: { id: 1, initializer: "init", entrances: {}, entries: [exit, npc] } } } };
  const game = new PlayGame({ data });
  game.mapId = 1; game.groups = new Set(["entity_default", "old-scene"]); game.entities = [exit];
  game.banks.ScenarioFlag3 = { 13: 1 };
  const result = routeToStory(game, "goal", () => ["down"]);
  assert.equal(result.target.id, "door"); assert.equal(result.refresh, true);
  assert.deepEqual([...game.groups], ["entity_default", "old-scene"]);
  assert.equal(game.tasks.length, 0);
});

test("an assigned moving NPC is allowed to finish instead of restarting its route through a map exit", () => {
  const npc={id:'7',kind:6,script:'goal',group:'entity_default',x:97,y:38,layer:1};
  const data={byMap:{},global:{init:0,goal:1},programs:[
    {name:'init',ops:[['Exit']]},{name:'goal',ops:[['Exit']]},
  ],navigation:{maps:{1:{id:1,initializer:'init',entrances:{},entries:[npc]}}}};
  const game=new PlayGame({data});game.mapId=1;game.groups=new Set(['entity_default']);game.entities=[npc];
  game.actors.set('7',{...npc,x:97.2,motion:{tx:99,ty:38}});
  game.assignedRouteTasks=new Map([[7,{done:false}]]);
  assert.equal(routeToStory(game,'goal',()=>null).status,'wait-npc');
  assert.deepEqual([...game.groups],['entity_default']);
});

test("a forced cinematic continuation does not expose the staging map's ordinary exits", () => {
  const entry=(id,script,destination,x=1)=>({id,kind:script?2:3,script,destination,x,y:0,layer:1,group:'entity_default',regions:[1]}),
    goal={id:'goal',kind:6,script:'goal',group:'entity_default',regions:[1]};
  const data={byMap:{},global:{init:0,trip:1,stage:2,goal:3},programs:[
    {name:'init',ops:[['Exit']]},{name:'trip',ops:[['ChangeMap',[2,1],[],['stage']]]},
    {name:'stage',ops:[['ChangeMap',[3,1]]]},{name:'goal',ops:[['Exit']]},
  ],navigation:{maps:{
    1:{id:1,initializer:'init',entrances:{1:{regions:[1]}},entries:[entry('cinematic','trip'),entry('real',null,{mapId:4,entrance:1},5)]},
    2:{id:2,initializer:'init',entrances:{1:{regions:[1]}},entries:[goal]},
    3:{id:3,initializer:'init',entrances:{1:{regions:[1]}},entries:[]},
    4:{id:4,initializer:'init',entrances:{1:{regions:[1]}},entries:[goal]},
  }}};
  const game=new PlayGame({data});game.mapId=1;game.player={x:0,y:0,layer:1};
  game.entities=data.navigation.maps[1].entries;game.groups=new Set(['entity_default']);
  assert.equal(routeToStory(game,'goal',()=>[]).target.id,'real');
});
