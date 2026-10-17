import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { updateNpcMovement } from "./npc-movement.js";

function fixture(extra = {}) {
  const npc = {
    id: "1",
    kind: 6,
    x: 4,
    y: 2,
    layer: 1,
    npc: {
      collision: true,
      moveType: 2,
      moveIntervalId: 6,
      moveSpeedId: 1,
      moveStep: 1,
      moveAreaId: 7,
      ...extra,
    },
  };
  const area = { id: "area", kind: 13, objectId: 7, x: 3, y: 2, width: 3, height: 1, layer: 1 };
  const game = new PlayGame({ data: { programs: {} }, random: () => 0.99 });
  Object.assign(game, {
    mapId: 1,
    control: true,
    map: {
      width: 9,
      height: 5,
      entities: [npc, area],
      groups: {},
      collisions: { 1: Array(45).fill(0) },
    },
    groups: new Set(["entity_default"]),
    triggered: new Set(),
    player: { id: -1001, x: 0, y: 2, layer: 1, visible: true },
  });
  game.refreshActors();
  return { game, npc, actor: game.actors.get("1") };
}

test("PR autonomous NPCs move inside their linked MoveArea and reserve body destinations", () => {
  const { game, actor } = fixture();
  game.tick(0.06);
  assert.equal(actor.motion.tx, 3);
  assert.equal(actor.motion.duration, 0.48);
  assert.equal(game.canMove(3, 2, 1), false);
  game.tick(0.5);
  assert.equal(actor.x, 3);
  assert.equal(actor.motion, null, "the following random step cannot leave the source area");
  assert.equal(game.canMove(4, 2, 1), true, "the departed body cell is released");
  assert.match(game.warnings[0].message, /interval durations are inferred/);
});

test("PR type3 NPCs patrol their authored polyline instead of chasing the player", () => {
  const { game, actor } = fixture({ moveType: 3, moveSpeedId: 0 });
  game.map.entities.push({
    id: "path",
    kind: 14,
    objectId: 7,
    layer: 1,
    polyline: {
      closed: false,
      points: [
        { x: 4, y: 2 },
        { x: 5, y: 2 },
      ],
    },
  });
  game.refreshActors();
  const positions = new Set();
  for (let tick = 0; tick < 40; tick++) {
    game.tick(0.1);
    assert(actor.x >= 4 && actor.x <= 5);
    assert.equal(actor.y, 2);
    positions.add(Math.round(actor.x));
  }
  assert.deepEqual([...positions].sort(), [4, 5]);
  assert.equal(game.player.x, 0);
});

test("polyline patrols preserve corners, stop at bodies and trigger source contact", () => {
  const { game, npc, actor } = fixture({ moveType: 3, moveStep: 3, moveSpeedId: 0 });
  game.map.entities.push({
    id: "path",
    kind: 14,
    objectId: 7,
    layer: 1,
    polyline: {
      closed: false,
      points: [
        { x: 4, y: 2 },
        { x: 5, y: 2 },
        { x: 5, y: 3 },
      ],
    },
  });
  Object.assign(game.player, { x: 5, y: 3 });
  game.refreshActors();
  for (let tick = 0; tick < 12; tick++) {
    game.tick(0.1);
    assert.equal(actor.y, 2, "neither the corner nor the player body is crossed");
  }
  assert.equal(actor.x, 5);
  npc.script = actor.script = "contact";
  npc.npc.interaction = { actionId: 9 };
  npc.npc.acceptDirection = 15;
  const scripts = [];
  game.startScript = (script) => scripts.push(script);
  for (let tick = 0; tick < 12; tick++) game.tick(0.1);
  assert.deepEqual(scripts, ["contact"]);
  assert.equal(actor.y, 2);
});

test("autonomous movement cannot cross players, closed chests or terrain", () => {
  for (const obstacle of ["player", "chest", "wall"]) {
    const { game, actor } = fixture();
    if (obstacle === "player") game.player.x = 3;
    if (obstacle === "chest") {
      game.map.entities.push({
        id: "chest",
        kind: 7,
        x: 3,
        y: 2,
        layer: 1,
        treasure: { presentation: { pickUp: false } },
      });
      game.refreshActors();
    }
    if (obstacle === "wall") game.map.collisions[1][2 * 9 + 3] = 1;
    game.tick(0.06);
    assert.equal(actor.x, 4, obstacle);
    assert.equal(actor.motion, null, obstacle);
  }
});

test("NPCs pause for events and their authored assigned routes keep ownership", () => {
  const { game, npc, actor } = fixture();
  game.dialogue = { elapsed: 0, auto: false };
  updateNpcMovement(game, 1);
  assert.equal(actor.motion, null);
  npc.npc.moveWhileDisplayMessage = true;
  updateNpcMovement(game, 1);
  assert.equal(actor.motion.tx, 3);
  actor.motion = null;
  game.dialogue = null;
  game.assignedRouteTasks = new Map([[1, { done: false }]]);
  updateNpcMovement(game, 1);
  assert.equal(actor.motion, null);
});

test("bumping an action9 NPC runs its source contact event once without overlapping bodies", () => {
  const { game, npc, actor } = fixture({
    moveType: 0,
    interaction: { actionId: 9 },
    acceptDirection: 15,
  });
  npc.script = "fall";
  actor.script = "fall";
  game.player.x = 3;
  const scripts = [];
  game.startScript = (name) => scripts.push(name);
  game.checkTriggers();
  assert.deepEqual(scripts, [], "mere adjacency is not a collision with a non-RTS NPC");
  assert.equal(game.move("right"), false);
  assert.equal(game.player.x, 3);
  assert.deepEqual(scripts, ["fall"]);
  game.move("right");
  assert.deepEqual(scripts, ["fall"]);
});

test("a wandering action9 NPC can initiate the same source event against the player", () => {
  const { game, npc } = fixture({ interaction: { actionId: 9 }, acceptDirection: 15 });
  npc.script = "fall";
  game.player.x = 3;
  const scripts = [];
  game.startScript = (name) => scripts.push(name);
  game.tick(0.06);
  assert.deepEqual(scripts, ["fall"]);
  assert.equal(game.actors.get("1").x, 4);
});
