import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import { executeInstruction } from "./instructions.js";
import { pathTo } from "./m1-route.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { openFieldDoor, setTileFrame } from "./field-collision.js";

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

test("source collider groups block ordinary movement and release only when hidden or removed", () => {
  const barrier = {
    id: "202",
    kind: 19,
    x: 2,
    y: 1,
    layer: 1,
    collider: { type: 1, throughCondition: 0, transportationIds: [] },
  };
  const game = fixture([]);
  game.map.groups.opening = { entities: [barrier] };
  game.groups.add("opening");
  game.refreshActors();
  assert.equal(game.move("right"), false, "a PR road restriction is solid without a sprite");
  assert.equal(game.canMove(2, 1, 2), true, "the other walking floor is unaffected");
  game.actor("202").visible = false;
  assert.equal(game.move("right"), true, "source Hide releases the same cell");
  game.actor("202").visible = true;
  game.player.x = 1;
  assert.equal(game.move("right"), false);
  game.groups.delete("opening");
  game.refreshActors();
  assert.equal(game.move("right"), true, "a removed plot group leaves no invisible wall");
});

test("source collider transportation filters do not block other vehicles", () => {
  const game = fixture([
    {
      id: "226",
      kind: 19,
      x: 2,
      y: 1,
      layer: 1,
      collider: { type: 0, throughCondition: 0, transportationIds: [3] },
    },
  ]);
  assert.equal(game.canMove(2, 1), true);
  game.player.vehicle = 3;
  assert.equal(game.canMove(2, 1), false);
  game.player.vehicle = 5;
  assert.equal(game.canMove(2, 1), true);
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

test("door links cross visual layers and a source closed frame restores the body", () => {
  const door = {
      id: "1",
      kind: 8,
      x: 2,
      y: 1,
      layer: 2,
      door: { actionId: 5, linkObjectId: 9, direction: 15 },
    },
    region = {
      id: "2",
      kind: 1,
      objectId: 9,
      x: 2,
      y: 0,
      width: 1,
      height: 2,
      layer: 1,
      tileAnimation: { allLayers: false },
    },
    otherLayer = { ...region, id: "3", layer: 0 },
    unrelated = { ...region, id: "4", objectId: 10 },
    game = fixture([door, region, otherLayer, unrelated]);
  game.player.layer = 2;
  game.map.collisions[2] = Array(36).fill(0);
  game.map.collisions[2][8] = 1;
  assert.equal(game.canMove(2, 1), false);
  assert.equal(game.move("right"), true);
  assert.equal(game.actors.get("1").opened, true);
  assert.equal(game.actors.get("2").tileFrame, 1);
  assert.equal(game.actors.get("3").tileFrame, 1, "all linked visual layers open together");
  assert.equal(game.actors.get("4")?.tileFrame, undefined, "other object IDs stay untouched");
  game.data.programs.close = { name: "close", ops: [["CueAnim", [0], [0], []]] };
  game.step({ program: "close", pc: 0, actor: "2", locals: [] });
  game.step({ program: "close", pc: 0, actor: "3", locals: [] });
  assert.equal(game.actors.get("1").opened, false);
  assert.equal(game.canMove(2, 1), false);
});

test("opening a wide visual door never releases its pillars or upper wall", () => {
  const door = {
      id: "1",
      kind: 8,
      x: 2,
      y: 2,
      layer: 1,
      door: { actionId: 5, linkObjectId: 4, direction: 15 },
    },
    region = {
      id: "2",
      kind: 1,
      objectId: 4,
      x: 1,
      y: 1,
      width: 3,
      height: 2,
      layer: 1,
      tileAnimation: { allLayers: true },
    },
    grid = Array(36).fill(0);
  for (const x of [1, 3]) for (const y of [1, 2]) grid[y * 6 + x] = 1;
  grid[2 * 6 + 2] = 1;
  const game = fixture([door, region], grid);
  Object.assign(game.player, { x: 2, y: 3, direction: "up" });
  assert.equal(game.move("up"), true, "ordinary walking opens the actual door cell");
  assert.equal(game.player.y, 2);
  assert.equal(game.move("left"), false, "an open visual frame cannot turn its pillar into floor");
  assert.equal(game.move("right"), false);
  assert.equal(game.move("up"), true, "the source centre passage remains walkable");
  assert.equal(game.canWalk(1, 1), false);
  assert.equal(game.canWalk(3, 1), false);
  game.map.collisions[0] = grid;
  assert.equal(game.canWalk(1, 2, 0), false, "allLayers is visual, not a wall override");
});

test("all PR action5 doors preserve blocked source terrain outside their own body", async () => {
  const directory = path.resolve(import.meta.dirname, "../../build/web-data/maps");
  let doors = 0,
    protectedCells = 0,
    blockedApertures = 0;
  for (const file of await readdir(directory)) {
    if (!/^\d+\.json$/.test(file)) continue;
    const map = JSON.parse(await readFile(path.join(directory, file))),
      groups = [map.entities, ...Object.values(map.groups).map((group) => group.entities)],
      seen = new Set();
    for (const entities of groups) {
      const active = [...new Map([...map.entities, ...entities].map((e) => [e.id, e])).values()];
      for (const door of entities) {
        if (door.kind !== 8 || door.door?.actionId !== 5) continue;
        const key = JSON.stringify(door);
        if (seen.has(key)) continue;
        seen.add(key);
        doors++;
        const game = new PlayGame({ data: { programs: {} } });
        game.map = map;
        game.entities = active;
        game.player.direction =
          ["up", "right", "down", "left"].find(
            (_direction, index) => (door.door.direction ?? 15) & (1 << index),
          ) || "down";
        const regions = active.filter((e) => e.kind === 1 && e.objectId === door.door.linkObjectId);
        if (door.script) {
          // Geometry-only check, not quest coverage: scripted doors obtain this
          // state from their source CueAnim instead of the ordinary action5.
          for (const region of regions) setTileFrame(game, region, 1);
        } else assert.equal(openFieldDoor(game, door), true, `source door ${map.id}/${door.id}`);
        const grid = map.collisions[door.layer] || map.collisions[0],
          cells = new Set();
        for (const region of regions)
          for (let y = region.y; y < region.y + region.height; y++)
            for (let x = region.x; x < region.x + region.width; x++) {
              if (grid?.[y * map.width + x] !== 1 || cells.has(`${x},${y}`)) continue;
              cells.add(`${x},${y}`);
              const aperture =
                x >= door.x && x < door.x + door.width && y >= door.y && y < door.y + door.height;
              if (aperture) blockedApertures++;
              else protectedCells++;
              assert.equal(
                game.canWalk(x, y, door.layer),
                aperture,
                `door ${map.id}/${door.id} cell ${x},${y}: preserve source walls outside body`,
              );
            }
      }
    }
  }
  assert.equal(doors, 453);
  assert.ok(protectedCells > 300, "the real wide/pillar cases must be exercised");
  assert.ok(blockedApertures > 0, "source-blocked door apertures still need a local override");
});

test("real PR map103 string-key door opens by ordinary confirmation and its portal remains usable", async () => {
  const directory = path.resolve(import.meta.dirname, "../../build/web-data"),
    data = JSON.parse(await readFile(path.join(directory, "data.json"))),
    game = new PlayGame({
      data,
      loadMap: async (id) => JSON.parse(await readFile(path.join(directory, `maps/${id}.json`))),
    });
  // Source-map unit fixture, not a claimed played checkpoint or quest route.
  await game.enter(103, 1);
  game.tick(0.1);
  assert.equal(game.actor(0), game.camera);
  assert.equal(game.actor(-1001), game.player);
  assert.equal(game.actor(-1).id, -1, "negative role selectors retain their original meaning");
  const door = game.entities.find((e) => e.kind === 8),
    actor = game.actor(door.id);
  assert.equal(door.id, "entity_default:0:8");
  assert.equal(actor.kind, 8);
  assert.equal(actor.x, 12);
  assert.equal(actor.y, 5);
  assert.equal(actor.visible, true);
  for (let n = 0; n < 5; n++) assert.equal(game.move("up"), true);
  assert.deepEqual([game.player.x, game.player.y], [12, 6]);
  assert.equal(game.confirm(), true);
  assert.equal(actor.opened, true);
  assert.equal(actor.visible, false);
  assert.equal(game.actor("entity_default:0:9").kind, 1);
  assert.equal(game.actor("entity_default:0:9").tileNormalized, 1);
  assert.equal(game.canWalk(12, 4), false, "the upper visual panel remains a source wall");
  assert.equal(game.move("up"), true);
  if (game.loading) await game.pending;
  assert.equal(game.mapId, 104);
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
