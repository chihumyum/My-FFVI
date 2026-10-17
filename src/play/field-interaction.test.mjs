import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { pathTo } from "./m1-route.js";

function fixture(entities) {
  const events = [],
    game = new PlayGame({
      data: { programs: {}, messages: { locked: "上锁了……", welcome: "欢迎<C1>！" } },
      onEvent: (event) => events.push(event),
    });
  game.mapId = 1;
  game.map = { width: 6, height: 6, entities, groups: {}, collisions: {} };
  game.triggered = new Set();
  game.refreshActors();
  Object.assign(game.player, { x: 2, y: 3, layer: 1, direction: "up" });
  return { game, events };
}
const object = (id, definition) => ({
  id,
  kind: 5,
  x: 2,
  y: 2,
  layer: 1,
  mapObject: { acceptDirection: 15, collision: true, ...definition },
});

test("PR map-object direct messages use the same normal dialogue lifecycle as NPCs", () => {
  const door = object("door", {
      interaction: { actionId: 4, kind: "talk", message: { key: "locked" } },
    }),
    { game, events } = fixture([door]);
  assert.equal(game.move("up"), false);
  assert.equal(game.confirm(), true);
  assert.equal(game.dialogue.text, "上锁了……");
  assert.equal(game.busy, true);
  assert.equal(events.find((event) => event.kind === "dialogue").entityId, "door");
  assert.equal(game.confirm(), true);
  assert.equal(game.dialogue, null);
  assert.equal(game.move("up"), false, "a message is not permission to unlock the body");
});

test("same-cell opposite jump objects choose the PR contact side and route queries agree", () => {
  const south = object("south", {
      acceptDirection: 4,
      interaction: { actionId: 2, kind: "script", script: "jump-south" },
    }),
    north = object("north", {
      acceptDirection: 1,
      interaction: { actionId: 2, kind: "script", script: "jump-north" },
    }),
    { game, events } = fixture([south, north]),
    started = [];
  game.startScript = (name) => started.push(name);
  assert.equal(game.interactionDistance(south, 2, 3, 1), 1);
  assert.equal(game.interactionDistance(south, 2, 1, 1), 0);
  assert.equal(game.interactionDistance(north, 2, 1, 1), 1);
  assert.deepEqual(pathTo(game, north), ["right", "up", "up", "left"]);
  assert.equal(game.confirm(), true);
  Object.assign(game.player, { x: 2, y: 1, direction: "down" });
  assert.equal(game.confirm(), true);
  assert.deepEqual(started, ["jump-south", "jump-north"]);
  assert.deepEqual(
    events.filter((event) => event.kind === "field-interaction").map((event) => event.entityId),
    ["south", "north"],
  );
});

test("source scripts take priority over messages or shops after side eligibility", () => {
  const source = object("source", {
      acceptDirection: 1,
      interaction: {
        actionId: 8,
        kind: "talk",
        productGroup: 7,
        message: { key: "locked" },
      },
    }),
    { game } = fixture([source]),
    started = [];
  source.script = "source-event";
  game.startScript = (name) => started.push(name);
  assert.equal(game.confirm(), false);
  Object.assign(game.player, { x: 2, y: 1, direction: "down" });
  assert.equal(game.confirm(), true);
  assert.deepEqual(started, ["source-event"]);
  assert.equal(game.dialogue, null);
  assert.equal(game.shop, undefined);
});

test("NPC and map-object action8 use the same source product group without charging for opening", () => {
  for (const npc of [false, true]) {
    const source = object("shop", { interaction: { actionId: 8, productGroup: 7 } });
    if (npc) {
      source.kind = 17;
      source.npc = source.mapObject;
      delete source.mapObject;
    }
    const { game } = fixture([source]);
    game.gil = 321;
    assert.equal(game.confirm(), true);
    assert.equal(game.shop.groupId, 7);
    assert.equal(game.gil, 321);
  }
});

test("unrestricted floor objects remain confirmable on overlap and log their zero-mask inference", () => {
  const floor = object("floor", {
      acceptDirection: 0,
      collision: false,
      interaction: { actionId: 4, message: { key: "locked" } },
    }),
    { game } = fixture([floor]);
  assert.equal(game.move("up"), true);
  assert.equal(game.confirm(), true);
  assert.equal(game.dialogue.text, "上锁了……");
  assert.equal(game.warnings.length, 1);
  assert.match(game.warnings[0].message, /accept_action_direction=0/);
});

test("successful NPC talk honors source facing and sound while fixed-facing NPCs stay fixed", () => {
  const source = {
      ...object("speaker", {}),
      kind: 6,
      direction: "left",
      npc: {
        acceptDirection: 15,
        eyeContact: true,
        turnAround: true,
        soundId: 9,
        interaction: { actionId: 4, message: { key: "welcome" } },
      },
    },
    { game, events } = fixture([source]);
  delete source.mapObject;
  game.unit(1).name = "蒂娜";
  assert.equal(game.confirm(), true);
  assert.equal(game.dialogue.text, "欢迎蒂娜！");
  assert.equal(game.actors.get("speaker").direction, "down");
  assert.equal(events.filter((event) => event.kind === "se" && event.id === 9).length, 1);
  game.confirm();
  source.npc.turnAround = false;
  game.actors.get("speaker").direction = "left";
  assert.equal(game.confirm(), true);
  assert.equal(game.actors.get("speaker").direction, "left");
});
