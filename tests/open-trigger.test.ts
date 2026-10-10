import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { FieldGame } from "../src/core/field.js";
import { TileAnimationState } from "../src/core/tile-animation.js";
import { OpenTriggerState } from "../src/core/open-trigger.js";
import type { FieldContent, FieldEntity, Op } from "../src/field/types.js";

const source = { file: "synthetic", assetPath: "door" };
const entity = (id: string, kind: number, x = 2, y = 1): FieldEntity => ({
  id,
  kind,
  x,
  y,
  layer: 0,
  width: 1,
  height: 1,
  asset: null,
  direction: "down",
  script: null,
  collision: null,
  destinationLayer: null,
  source,
});
const door = (id = "door"): FieldEntity => ({
  ...entity(id, 8),
  openTrigger: { direction: 15, linkObject: 7, soundId: 9 },
});
const region = (id = "region", index = 8): FieldEntity => ({
  ...entity(id, 1),
  objectId: 7,
  tileAnimation: {
    allLayers: true,
    loop: false,
    reverse: false,
    cells: [{ layer: 0, index }],
  },
});
function content(entities: FieldEntity[] = [door(), region()]): FieldContent {
  return {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic",
    contentHash: "synthetic",
    map: {
      id: "synthetic",
      width: 6,
      height: 3,
      tileSize: 16,
      textures: {},
      source,
      layers: [
        {
          name: "BottomLayer",
          width: 6,
          height: 3,
          opacity: 1,
          data: Array(18).fill(1),
        },
      ],
      tilesets: [
        {
          firstgid: 1,
          columns: 3,
          tilewidth: 16,
          tileheight: 16,
          image: "synthetic.png",
          tiles: [
            {
              id: 0,
              animation: [
                { tileid: 0, duration: 20 },
                { tileid: 1, duration: 20 },
                { tileid: 2, duration: 20 },
              ],
            },
          ],
        },
      ],
      collisions: { 0: Array(18).fill(0) },
      entities,
    },
    characters: {},
    scripts: {},
    entry: {
      player: {
        x: 1,
        y: 1,
        layer: 0,
        direction: "right",
        asset: "",
        mount: "",
      },
      evidence: [source],
      description: "synthetic",
    },
    limitations: [],
  };
}
const op = (value: Record<string, unknown>): Op =>
  ({ ...value, script: "test", index: 0, source }) as Op;

test("compiler retains contact direction masks and rejects unknown action/geometry", () => {
  const raw = (
    p: Record<string, unknown> = {},
    o: Record<string, unknown> = {},
  ) => ({
    gid: 999,
    x: 32,
    y: 32,
    width: 16,
    height: 16,
    properties: Object.entries({
      object_type: 8,
      action_id: 5,
      link_object_id: 7,
      se_id: 9,
      ...p,
    }).map(([name, value]) => ({ name, value })),
    ...o,
  });
  const compile = (object: unknown) =>
    compileEntityGroup(
      "entity_default",
      {
        source,
        data: { layers: [{ name: "BottomObject", objects: [object] }] },
      },
      {
        "action.csv": [
          { id: "5", action_name: "OpenTrigger" },
          { id: "6", action_name: "OpenTresureBox" },
        ],
      },
    );
  for (const direction of [undefined, 0, 1, 3, 5, 15]) {
    const g = compile(raw(direction === undefined ? {} : { direction }));
    assert.deepEqual(g.blockers, []);
    assert.deepEqual(g.entities[0]!.openTrigger, {
      direction: direction ?? 15,
      linkObject: 7,
      soundId: 9,
    });
    assert.equal(g.entities[0]!.y, 1);
  }
  for (const object of [
    raw({ direction: 16 }),
    raw({ direction: "15" }),
    raw({ action_id: 6 }),
    raw({ gimmick: true }),
    raw({}, { width: 32 }),
    raw({}, { x: 32.5 }),
  ])
    assert.ok(compile(object).blockers.length);
});

test("contact waits for the strict animation end, then opens once and permits movement", () => {
  const g = new FieldGame(content());
  g.confirm();
  assert.equal(g.busy, false); // Confirmation is not contact.
  assert.equal(g.move("right"), false);
  assert.equal(g.player.motion, null);
  assert.equal(g.busy, true);
  assert.equal(g.presentationOmissions.length, 1);
  assert.equal(g.presentationOmissions[0]!.soundId, 9);
  g.advance(60);
  assert.equal(g.busy, true);
  assert.equal(g.move("right"), false);
  g.advance(10);
  assert.equal(g.busy, false);
  assert.equal(g.tileAnimations.tile(0, 8), 3);
  assert.equal(g.move("right"), true);
  g.advance(240);
  assert.equal(g.player.x, 2);
  assert.equal(g.move("left"), true);
  g.advance(240);
  assert.equal(g.move("right"), true);
  assert.equal(g.presentationOmissions.length, 1);
  assert.equal(g.stop, null);
});

test("direction uses player-facing bits, not the opposite NPC action side", () => {
  const d = door();
  d.openTrigger!.direction = 1;
  const c = content([d, region()]),
    g = new FieldGame(c);
  assert.equal(g.move("right"), false);
  assert.equal(g.busy, false);
  assert.equal(g.presentationOmissions.length, 0);
  c.entry.player.x = 2;
  c.entry.player.y = 2;
  const fromBelow = new FieldGame(c);
  assert.equal(fromBelow.move("up"), false);
  assert.equal(fromBelow.busy, true);
  fromBelow.advance(70);
  assert.equal(fromBelow.move("up"), true);
});

test("native contact overload preserves cue progress and source looping", () => {
  const c = content(),
    state = new TileAnimationState(c.map);
  state.register(c.map.entities);
  state.cue("region", 0.5);
  const gates = new OpenTriggerState(state);
  assert.equal(gates.start(c.map.entities[0]!, c.map.entities, "right"), true);
  state.advance(30);
  gates.advance();
  assert.equal(gates.busy, true);
  state.advance(10);
  gates.advance();
  assert.equal(gates.busy, false);
  const looping = region();
  looping.tileAnimation!.loop = true;
  const loopContent = content([door(), looping]);
  const loopGame = new FieldGame(loopContent);
  loopGame.move("right");
  loopGame.advance(1000);
  assert.equal(loopGame.busy, true);
  assert.equal(loopGame.openTriggers.blocks("door"), true);
});

test("linked peers disable immediately and only the first registered region plays", () => {
  const peer = door("peer");
  peer.x = 4;
  peer.layer = 1;
  const second = region("second", 9);
  const g = new FieldGame(content([door(), region(), peer, second]));
  g.move("right");
  assert.equal(g.openTriggers.blocks("peer"), false);
  assert.equal(g.openTriggers.blocks("door"), true);
  assert.equal(g.tileAnimations.isPlaying("region"), true);
  assert.equal(g.tileAnimations.isPlaying("second"), false);
  g.advance(70);
  assert.equal(g.tileAnimations.tile(0, 9), 1);
});

test("entering on a door cues every linked region but leaves remote peers closed", () => {
  const peer = door("peer");
  peer.x = 4;
  const otherLayer = door("upper");
  otherLayer.layer = 1;
  const c = content([door(), region(), peer, otherLayer, region("second", 9)]);
  c.entry.player.x = 2;
  const g = new FieldGame(c);
  assert.deepEqual(g.openTriggers.snapshot().inactive, ["door"]);
  assert.equal(g.tileAnimations.tile(0, 8), 3);
  assert.equal(g.tileAnimations.tile(0, 9), 3);
  assert.equal(g.presentationOmissions.length, 0);
  assert.equal(g.busy, false);
  assert.equal(g.move("left"), true);
  // A new map lifetime does not inherit the previous door's open state.
  c.entry.player.x = 1;
  const reentered = new FieldGame(c);
  assert.equal(reentered.openTriggers.blocks("door"), true);
  assert.equal(reentered.tileAnimations.tile(0, 8), 1);
});

test("missing links and overlapping contacts stop explicitly without partial state changes", () => {
  const peer = door("peer");
  peer.x = 4;
  const g = new FieldGame(content([door(), peer]));
  const before = g.openTriggers.snapshot();
  g.move("right");
  assert.equal(g.stop?.kind, "unsupported");
  assert.match(g.stop!.message, /Missing open trigger animation/);
  assert.deepEqual(g.stop!.site!.source, source);
  assert.deepEqual(g.openTriggers.snapshot(), before);
  assert.equal(g.presentationOmissions.length, 0);
  const overlapping = new FieldGame(
    content([door(), door("overlap"), region()]),
  );
  overlapping.move("right");
  assert.equal(overlapping.stop?.kind, "unsupported");
  assert.equal(overlapping.tileAnimations.isPlaying("region"), false);
});

test("event groups use existing tile bindings, hidden doors do not obstruct, and updates replay", () => {
  const c = content([region()]);
  c.map.groups = {
    later: { name: "later", source, entities: [door()], blockers: [] },
  };
  c.scripts.test = [
    op({ kind: "entities", group: "later" }),
    op({ kind: "exit" }),
  ];
  const a = new FieldGame(c),
    b = new FieldGame(c);
  for (const g of [a, b]) {
    g.startEvent("test");
    g.move("right");
  }
  a.advance(70);
  for (const ms of [9, 12, 1, 48]) b.advance(ms);
  assert.deepEqual(a.openTriggers.snapshot(), b.openTriggers.snapshot());
  assert.deepEqual(a.tileAnimations.snapshot(), b.tileAnimations.snapshot());
  const hidden = new FieldGame(content());
  hidden.hiddenEntities.add("door");
  assert.equal(hidden.move("right"), true);
  assert.equal(hidden.presentationOmissions.length, 0);
});
