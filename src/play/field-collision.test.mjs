import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { executeInstruction } from "./instructions.js";
import { pathTo } from "./m1-route.js";

// Small input fixtures isolate collision bugs; they are not played checkpoints.
function fixture(entities, grid = Array(36).fill(0)) {
  const game = new PlayGame({ data: { programs: {} } });
  game.mapId = 1;
  game.map = {
    width: 6,
    height: 6,
    entities,
    groups: {},
    collisions: { 1: grid },
  };
  game.triggered = new Set();
  game.refreshActors();
  Object.assign(game.player, { x: 1, y: 1, layer: 1, direction: "right" });
  return game;
}
const npc = (extra = {}) => ({
  id: "1",
  kind: 6,
  x: 2,
  y: 1,
  layer: 1,
  npc: { collision: true },
  ...extra,
});

test("ordinary movement respects live PR bodies while adjacent confirmation stays possible", () => {
  const target = npc({ script: "talk" }),
    game = fixture([target]),
    scripts = [];
  game.startScript = (name) => scripts.push(name);
  assert.equal(game.move("right"), false);
  assert.equal(game.player.x, 1);
  assert.equal(game.confirm(), true);
  assert.deepEqual(scripts, ["talk"]);
  Object.assign(game.actors.get("1"), { x: 3, y: 1 });
  assert.equal(game.move("right"), true, "a moved NPC does not leave a stale collision cell");
  assert.equal(game.move("right"), false);
  game.actors.get("1").visible = false;
  assert.equal(game.move("right"), true);
});

test("a complete Erase then Exit script does not resurrect the NPC body or interaction", () => {
  const game = fixture([npc({ script: "talk" })]);
  game.data.byMap = {};
  game.data.global = { erase: "erase" };
  game.data.programs.erase = {
    name: "erase",
    ops: [
      ["Erase", [], [], []],
      ["Exit", [], [], []],
    ],
  };
  game.actors.get("1").motion = { tx: 3, ty: 1, elapsed: 0, duration: 1 };
  assert.equal(game.canMove(2, 1), false);
  game.startScript("erase", { actor: "1" });
  game.tick(0);
  assert.equal(game.tasks.length, 0);
  assert.equal(game.actors.get("1").visible, false);
  assert.equal(game.actors.get("1").motion, null);
  assert.equal(game.canMove(2, 1), true);
  assert.equal(game.interact(), false);
  game.refreshActors();
  assert.equal(game.canMove(2, 1), true, "refreshing active source groups preserves removal");
});

test("opened chests remain solid and collision false scenery remains passable", () => {
  const chest = {
      id: "2",
      kind: 7,
      x: 2,
      y: 1,
      layer: 1,
      treasure: { presentation: { pickUp: false } },
    },
    scenery = {
      id: "3",
      kind: 10,
      x: 1,
      y: 2,
      layer: 1,
      mapObject: { collision: false },
    },
    game = fixture([chest, scenery]);
  game.actors.get("2").opened = true;
  assert.equal(game.canMove(2, 1), false);
  assert.equal(game.canMove(1, 2), true);
});

test("layer changes evaluate bodies on the arrival layer and honor source all_layers", () => {
  const change = { id: "2", kind: 4, x: 2, y: 1, layer: 1, destinationLayer: 2 },
    game = fixture([change, npc()]);
  assert.equal(game.move("right"), true, "a body below a bridge does not block the upper path");
  assert.equal(game.player.layer, 2);
  Object.assign(game.player, { x: 1, y: 1, layer: 1 });
  game.actors.get("1").npc = { collision: true, allLayers: true };
  assert.equal(game.move("right"), false);
});

test("NPC self identity, other characters and reserved motion destinations have separate bodies", () => {
  const game = fixture([npc()]),
    actor = game.actors.get("1");
  assert.equal(game.canMove(2, 1, 1, actor), true);
  assert.equal(game.canMove(1, 1, 1, actor), false, "an NPC cannot walk through the player");
  actor.motion = { tx: 3, ty: 1 };
  assert.equal(game.canMove(3, 1), false);
  actor.motion = null;
  actor.visible = false;
  game.partySlots[0] = [1];
  game.actors.set("-1", { id: -1, x: 2, y: 1, layer: 1, visible: true });
  assert.equal(game.canMove(2, 1), true, "a duplicate leader puppet is the player's own body");
  game.actors.set("-2", { id: -2, x: 2, y: 1, layer: 1, visible: true });
  assert.equal(game.canMove(2, 1), false);
});

test("source action5 doors open only their linked terrain and preserve reversed tile frames", () => {
  const door = {
      id: "1",
      kind: 8,
      x: 2,
      y: 1,
      layer: 1,
      door: { actionId: 5, linkObjectId: 5, direction: 15 },
    },
    region = {
      id: "2",
      kind: 1,
      objectId: 5,
      x: 2,
      y: 1,
      width: 1,
      height: 1,
      layer: 1,
      tileAnimation: { reverse: true },
    },
    grid = Array(36).fill(0);
  grid[8] = 1;
  grid[9] = 1;
  const game = fixture([door, region], grid);
  assert.equal(game.canMove(2, 1), false);
  assert.equal(game.canTraverse(2, 1, 1, "right"), true);
  assert.equal(game.move("right"), true);
  assert.equal(game.actors.get("1").opened, true);
  assert.equal(game.actors.get("2").tileFrame, 0);
  assert.equal(game.canWalk(3, 1), false, "unrelated walls stay blocked");
  game.data.programs.tile = { name: "tile", ops: [["CueAnim", [0], [0], []]] };
  game.step({ program: "tile", pc: 0, actor: "2", locals: [] });
  assert.equal(game.actors.get("2").tileFrame, 1);
  assert.equal(game.canMove(2, 1), false);
  const lock = {
    id: "lock",
    kind: 5,
    x: 2,
    y: 1,
    layer: 1,
    script: "locked-source-door",
    mapObject: { collision: true },
  };
  const lockedGame = fixture([door, region, lock], grid);
  assert.equal(lockedGame.canTraverse(2, 1, 1, "right"), false);
  const olderSave = fixture([door, region], grid);
  olderSave.actor("1").visible = false;
  assert.equal(
    olderSave.canMove(2, 1),
    true,
    "old source Hide state also removes the doorway wall",
  );
  olderSave.actor("2").tileNormalized = 0;
  assert.equal(olderSave.canMove(2, 1), false, "an explicit source closed frame wins over Hide");
});

test("a touch encounter is a route boundary but still physically blocks ordinary movement", () => {
  const enemy = npc({ script: "contact-battle", npc: { collision: true, moveType: 3 } }),
    grid = Array(36).fill(1);
  for (const x of [1, 2, 3, 4]) grid[6 + x] = 0;
  const game = fixture([enemy], grid),
    started = [];
  game.rts = { active: true };
  game.startScript = (name) => started.push(name);
  const target = { id: "destination", kind: 0, x: 4, y: 1, layer: 1 };
  assert.deepEqual(pathTo(game, target), ["right", "right", "right"]);
  assert.equal(game.move("right"), false);
  assert.equal(game.player.x, 1);
  assert.deepEqual(started, ["contact-battle"]);
  game.rts.active = false;
  game.walkCache = null;
  assert.equal(pathTo(game, target), null);
});

test("authored puppet movement still crosses ordinary bodies without collision rewriting source poses", () => {
  const game = fixture([npc()]);
  executeInstruction(game, { actor: -1001 }, "SetPos", [2, 1, 0], [], []);
  assert.equal(game.player.x, 2);
  executeInstruction(game, { actor: -1001 }, "Lerp", [4, 1, 0], [0.2], []);
  assert.equal(game.player.motion.tx, 4);
  assert.equal(game.player.motion.ty, 1);
});
