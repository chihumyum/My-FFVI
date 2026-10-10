import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import type { FieldContent, Op, Site } from "../src/field/types.js";
const source = { file: "synthetic", assetPath: "/fixture" };
const site: Site = { script: "event", index: 0, source };
function fixture(): FieldContent {
  return {
    formatVersion: 1,
    kind: "field-development",
    contentHash: "fixture",
    sourceSetHash: "fixture",
    parentSourceSetHash: "fixture",
    map: {
      id: "fixture",
      width: 7,
      height: 7,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(49).fill(0) },
      entities: [],
      source,
    },
    characters: {},
    scripts: {},
    entry: {
      player: {
        x: 3,
        y: 3,
        layer: 1,
        direction: "up",
        asset: "hero",
        mount: "",
      },
      description: "synthetic",
      evidence: [source],
    },
    limitations: [],
  };
}
function entity(id: string, kind: number, x: number, y: number) {
  return {
    id,
    kind,
    x,
    y,
    layer: 1,
    width: 1,
    height: 1,
    asset: null,
    direction: "down" as const,
    script: null,
    collision: null,
    destinationLayer: null,
    source,
  };
}
type WithoutSite<T> = T extends Site ? Omit<T, keyof Site> : never;
function ops(...data: WithoutSite<Op>[]): Op[] {
  return data.map((d, index) => ({ ...d, ...site, index }) as Op);
}
function eventFixture() {
  const c = fixture();
  c.map.entities.push({ ...entity("trigger", 2, 3, 2), script: "event" });
  return c;
}
const start = (c: FieldContent) => {
  const g = new FieldGame(c);
  assert.equal(g.move("up"), true);
  g.advance(240);
  return g;
};
test("movement commits at its boundary and does not tunnel through static/dynamic walls", () => {
  const c = fixture();
  c.map.collisions[1]![2 * 7 + 3] = 1;
  c.map.entities.push({ ...entity("wall", 19, 4, 3), collision: 1 });
  const g = new FieldGame(c);
  assert.equal(g.move("up"), false);
  assert.equal(g.move("right"), false);
  assert.equal(g.move("left"), true);
  assert.equal(g.move("left"), false);
  g.advance(239);
  assert.equal(g.player.x, 3);
  g.advance(1);
  assert.equal(g.player.x, 2);
  assert.equal(g.move("left"), true);
  g.advance(240);
  assert.equal(g.move("left"), true);
  g.advance(240);
  assert.equal(g.move("left"), false);
});
test("directional collision checks both ends and unknown collision fails closed", () => {
  const c = fixture();
  c.map.collisions[1]![2 * 7 + 3] = 4;
  const g = new FieldGame(c);
  assert.equal(g.move("up"), false); // destination blocks its bottom edge
  c.map.collisions[1]![2 * 7 + 3] = 2;
  assert.equal(g.move("up"), true);
  g.advance(240);
  assert.equal(g.move("up"), false); // its upper edge is blocked
  c.map.collisions[1]![2 * 7 + 4] = 14;
  assert.equal(g.move("right"), false);
  assert.equal(g.stop?.kind, "unsupported");
});
test("trigger waits for committed movement; message blocks inputs; encounter never completes itself", () => {
  const c = eventFixture();
  c.scripts.event = ops(
    { kind: "message", key: "synthetic", speaker: "Fixture", text: "Hello" },
    { kind: "encounter", party: 3, continuation: "after" },
  );
  const g = new FieldGame(c);
  g.move("up");
  g.advance(230);
  assert.equal(g.dialogue, null);
  g.advance(10);
  assert.equal((g.dialogue as { text: string } | null)?.text, "Hello");
  assert.equal(g.move("up"), false);
  g.advance(10000);
  assert.equal(g.player.y, 2);
  g.confirm();
  assert.equal(g.stop?.kind, "encounter");
  g.confirm();
  g.advance(10000);
  assert.equal(g.stop?.party, 3);
  assert.equal(g.player.y, 2);
});
test("a sourced slope moves diagonally, triggers only its committed destination, and can be traversed in reverse", () => {
  const c = fixture();
  c.map.collisions[1]![3 * 7 + 4] = 8;
  c.map.entities.push({ ...entity("slope-event", 2, 4, 2), script: "event" });
  c.scripts.event = ops(
    { kind: "message", key: "synthetic", text: "arrived", speaker: "Fixture" },
    { kind: "exit" },
  );
  const g = new FieldGame(c);
  assert.equal(g.move("right"), true);
  g.advance(230);
  assert.deepEqual([g.player.x, g.player.y], [3, 3]);
  assert.equal(g.dialogue, null);
  g.advance(10);
  assert.deepEqual([g.player.x, g.player.y], [4, 2]);
  assert.equal((g.dialogue as { text: string } | null)?.text, "arrived");
  g.confirm();
  assert.equal(g.move("down"), true);
  g.advance(240);
  assert.deepEqual([g.player.x, g.player.y], [3, 3]);
  assert.equal(g.stop, null);
});
test("diagonal steps cannot pass dynamic walls or NPCs at the destination or swept corners", () => {
  for (const kind of [6, 19])
    for (const [x, y] of [
      [3, 3],
      [4, 3],
      [3, 2],
      [4, 2],
    ]) {
      const c = fixture();
      c.map.collisions[1]![3 * 7 + 4] = 8;
      c.map.entities.push({
        ...entity("blocker", kind, x!, y!),
        asset: kind === 6 ? "npc" : null,
        collision: kind === 19 ? 1 : null,
      });
      const g = new FieldGame(c);
      // An NPC sharing the origin is already overlapping, not an obstacle ahead.
      if (kind === 6 && x === 3 && y === 3) continue;
      assert.equal(g.move("right"), false);
      assert.equal(g.stop, null);
      g.hiddenEntities.add("blocker");
      assert.equal(g.move("right"), true);
    }
});
test("puppet tasks join before dialogue; movement/waits are independent of render frame partitioning", () => {
  const c = eventFixture();
  c.map.entities.push({ ...entity("npc", 6, 0, 0), asset: "npc" });
  c.scripts.event = ops(
    { kind: "call", target: 4 },
    { kind: "message", key: "test", speaker: "Fixture", text: "done" },
    { kind: "exit" },
    { kind: "nop" },
    { kind: "puppet", slot: 0, actor: "npc", target: 7 },
    { kind: "join" },
    { kind: "return" },
    { kind: "position", x: 1, y: 1, animation: "Default" },
    { kind: "move", direction: "down", steps: 2, secondsPerCell: 0.12 },
    { kind: "wait", seconds: 0.1 },
    { kind: "exit" },
  );
  const a = start(c),
    b = start(c);
  a.advance(1000);
  for (let n = 0; n < 100; n++) b.advance(10);
  assert.deepEqual(a.actors, b.actors);
  assert.deepEqual(a.dialogue, b.dialogue);
  assert.equal(a.actors.npc!.y, 3);
  assert.equal(a.dialogue?.text, "done");
  assert.equal(a.stop, null);
});
test("unknown instruction, bad jumps, runaway loops, and actor conflicts stop visibly", () => {
  for (const script of [
    ops({ kind: "blocked", mnemonic: "Unknown", reason: "fixture" }),
    ops({ kind: "call", target: 999 }),
    ops({ kind: "call", target: 0 }),
    ops(
      { kind: "puppet", slot: 0, actor: "missing", target: 0 },
      { kind: "join" },
    ),
  ]) {
    const c = eventFixture();
    c.scripts.event = script;
    assert.equal(start(c).stop?.kind, "unsupported");
  }
});
test("layer transition commits once and a missing destination cannot silently pass", () => {
  const c = fixture();
  c.map.collisions[2] = Array(49).fill(0);
  c.map.entities.push({ ...entity("stairs", 4, 3, 2), destinationLayer: 2 });
  const g = start(c);
  assert.equal(g.player.layer, 2);
  assert.equal(g.move("up"), true);
  g.advance(240);
  assert.equal(g.player.y, 1);
  delete c.map.collisions[2];
  assert.equal(start(c).stop?.kind, "unsupported");
});
test("unsupported operand forms and inline message controls are not erased", () => {
  const raw = (
    mnemonic: string,
    iValues = [0, 0, 0, 0],
    rValues = [0, 0, 0, 0],
    sValues = ["", "", "", ""],
  ) => ({ mnemonic, operands: { iValues, rValues, sValues } });
  assert.equal(
    decodeFieldOp(raw("Nop", [0, 0, 0, 1]), site, {}).kind,
    "blocked",
  );
  assert.equal(
    decodeFieldOp(raw("Move", [0, 1, 99, 0]), site, {}).kind,
    "blocked",
  );
  assert.equal(
    decodeFieldOp(
      raw("SetPos", [1, 1, 0, 0], [0, 0, 0, 0], ["Unknown", "", "", ""]),
      site,
      {},
    ).kind,
    "blocked",
  );
  const msg = raw("Msg", [0, 2, 0, 0], [0, 0, 0, 0], ["test", "", "", ""]);
  assert.equal(
    decodeFieldOp(msg, site, {
      story_mes_zhc: { test: "<wait>Text" },
      story_cha_zhc: { test: "Fixture" },
    }).kind,
    "blocked",
  );
});

test("96ms source movement keeps input locked until all cells commit across frame partitions", () => {
  const c = eventFixture();
  const movement = decodeFieldOp(
    {
      mnemonic: "Move",
      type: 2,
      operands: { iValues: [2, 3, 7], rValues: [], sValues: [] },
    },
    site,
    {},
  );
  c.scripts.event = [movement, ...ops({ kind: "exit" })];
  const a = start(c),
    b = start(c);
  a.advance(290);
  assert.equal(a.player.y, 4);
  assert.equal(a.move("left"), false);
  a.advance(10);
  for (let n = 0; n < 30; n++) b.advance(10);
  assert.deepEqual(a.actors, b.actors);
  assert.equal(a.player.y, 5);
  assert.equal(a.move("left"), true);
});

test("victory continuation hides a visual blocker and a non-visual trigger before releasing movement", () => {
  const c = eventFixture();
  c.map.entities.push({ ...entity("guard", 6, 2, 2), asset: "hero" });
  c.scripts.event = ops({ kind: "encounter", party: 3, continuation: "after" });
  c.scripts.after = ops(
    { kind: "puppet", slot: 0, actor: "guard", target: 4 },
    { kind: "puppet", slot: 1, actor: "trigger", target: 6 },
    { kind: "join" },
    { kind: "exit" },
    { kind: "hide" },
    { kind: "exit" },
    { kind: "hide" },
    { kind: "exit" },
  );
  const g = start(c);
  assert.equal(g.stop?.kind, "encounter");
  assert.throws(() => g.finishEncounter(4));
  g.finishEncounter(3);
  assert.equal(g.busy, false);
  assert.deepEqual([...g.hiddenEntities].sort(), ["guard", "trigger"]);
  assert.equal(g.move("left"), true);
  g.advance(240);
  assert.equal(g.move("right"), true);
  g.advance(240);
  assert.equal(g.stop, null);
  assert.throws(() => g.finishEncounter(3));
});
