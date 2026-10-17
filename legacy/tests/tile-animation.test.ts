import test from "node:test";
import assert from "node:assert/strict";
import { TileAnimationState } from "../src/core/tile-animation.js";
import { bindTileAnimationRegions } from "../src/compiler/tile-animation.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { FieldGame } from "../src/core/field.js";
import type {
  EntityGroup,
  FieldContent,
  FieldEntity,
  TileLayer,
  Tileset,
} from "../src/field/types.js";
const source = { file: "synthetic", assetPath: "tile-region" };
const sets: Tileset[] = [
  {
    firstgid: 1,
    columns: 3,
    tilewidth: 16,
    tileheight: 16,
    image: "test.png",
    tiles: [
      {
        id: 0,
        animation: [
          { tileid: 0, duration: 10 },
          { tileid: 1, duration: 20 },
          { tileid: 2, duration: 30 },
        ],
      },
    ],
  },
];
const layer = (name: string): TileLayer => ({
  name,
  sourceGroup: name.includes("Water") ? "WaterGroup" : "TileGroup",
  width: 4,
  height: 1,
  data: [1, 1, 1, 1],
  opacity: 1,
});
const map = () => ({
  width: 4,
  height: 1,
  layers: [layer("BottomLayer"), layer("GroundLayer"), layer("GroundWater")],
  tilesets: sets,
});
const entity = (id = "1", x = 0, reverse = false): FieldEntity => ({
  id,
  x,
  y: 0,
  width: 1,
  height: 1,
  kind: 1,
  layer: 0,
  asset: null,
  direction: "down",
  script: null,
  collision: null,
  destinationLayer: null,
  source,
  tileAnimation: { allLayers: false, loop: false, reverse },
});
function setup(entities: FieldEntity[]) {
  const geometry = map(),
    group: EntityGroup = {
      name: "entity_default",
      entities,
      blockers: [],
      source,
    };
  bindTileAnimationRegions({ entity_default: group }, geometry);
  const state = new TileAnimationState(geometry);
  state.register(entities);
  return { geometry, group, state };
}
test("region binding uses half-open top-left vertices, source layers, water, and map crop", () => {
  const e = entity();
  e.x = 0.5;
  e.width = 1.5;
  e.layer = 1;
  const { group } = setup([e]);
  assert.deepEqual(e.tileAnimation!.cells, [
    { layer: 1, index: 1 },
    { layer: 2, index: 1 },
  ]);
  assert.equal(group.blockers.length, 0);
  const geometry = map();
  geometry.layers.push({ ...layer("GroundLayer"), sourceGroup: "OtherGroup" });
  bindTileAnimationRegions({ entity_default: group }, geometry);
  assert.ok(e.tileAnimation!.cells!.every((c) => c.layer < 3));
  e.tileAnimation!.allLayers = true;
  const range = { ...entity("range"), kind: 27, x: 2, width: 2 };
  delete range.tileAnimation;
  group.entities.push(range);
  bindTileAnimationRegions({ entity_default: group }, map());
  assert.deepEqual(e.tileAnimation!.cells, []);
});
test("same atlas animation stays independent in different regions; strict end boundary", () => {
  const { state } = setup([entity("1"), entity("2", 1)]);
  state.advance(200);
  assert.equal(state.tile(0, 0), 1);
  assert.equal(state.tile(0, 2), undefined);
  state.play("1", false, 1);
  state.advance(10);
  assert.equal(state.tile(0, 0), 1);
  state.advance(10);
  assert.equal(state.tile(0, 0), 2);
  assert.equal(state.tile(0, 1), 1);
  state.advance(40);
  assert.equal(state.tile(0, 0), 3);
  assert.equal(state.isPlaying("1"), true);
  state.advance(10);
  assert.equal(state.isPlaying("1"), false);
  state.cue("1", 0);
  assert.equal(state.tile(0, 0), 1);
  state.cue("2", 1);
  assert.equal(state.tile(0, 1), 3);
});
test("reverse initialization, cue clamping, and loop reset retain source orientation", () => {
  const { state } = setup([entity("1", 0, true)]);
  assert.equal(state.tile(0, 0), 3);
  state.cue("1", 2);
  assert.equal(state.tile(0, 0), 1);
  state.cue("1", -1);
  assert.equal(state.tile(0, 0), 3);
  state.play("1", true, 2);
  state.advance(10);
  assert.equal(state.tile(0, 0), 3);
  state.advance(10);
  assert.equal(state.tile(0, 0), 2);
  state.advance(10);
  assert.equal(state.tile(0, 0), 1);
  state.advance(10);
  assert.equal(state.tile(0, 0), 3);
  assert.equal(state.isPlaying("1"), true);
  state.cue("1", 0.5);
  assert.equal(state.tile(0, 0), 3);
  assert.equal(state.isPlaying("1"), false);
});
test("overlapping regions share a cell; failed additions preserve active playback atomically", () => {
  const { state, geometry } = setup([entity("1")]);
  state.play("1", true, 1);
  state.advance(20);
  const before = state.snapshot(),
    second = entity("2"),
    bad = entity("3");
  bindTileAnimationRegions(
    { new: { name: "new", source, blockers: [], entities: [second] } },
    geometry,
  );
  assert.throws(() => state.register([second, bad]), /Unbound/);
  assert.deepEqual(state.snapshot(), before);
  state.register([second]);
  assert.equal(state.tile(0, 0), 1); // InitTrigger disables the existing shared UV.
  state.cue("2", 1);
  assert.equal(state.tile(0, 0), 3);
  assert.equal(Object.keys(state.snapshot().cells).length, 1);
});
test("fractional source dimensions remain explicit, while non-grid integer pixels bind", () => {
  const raw = (height: number) => ({
    data: {
      layers: [
        {
          name: "BottomObject",
          objects: [
            {
              x: 8,
              y: 0,
              width: 24,
              height,
              properties: [{ name: "object_type", value: 1 }],
            },
          ],
        },
      ],
    },
    source,
  });
  const fractional = compileEntityGroup("entity_default", raw(15.75), {});
  assert.ok(fractional.blockers.some((b) => /fractional/.test(b.reason)));
  const integer = compileEntityGroup("entity_default", raw(16), {});
  assert.equal(integer.blockers[0]!.reason, "Unbound tile animation geometry");
  bindTileAnimationRegions({ entity_default: integer }, map());
  assert.equal(integer.blockers.length, 0);
  assert.equal(integer.entities[0]!.tileAnimation!.cells!.length, 3);
});
function game(instruction: unknown, target = "1") {
  const { geometry, group } = setup([entity()]);
  const raw = (mnemonic: string, iValues: number[] = []) => ({
    mnemonic,
    type: 1,
    operands: { iValues: [...iValues, ...Array(8 - iValues.length).fill(0)], rValues: Array(8).fill(0), sValues: Array(8).fill("") },
  });
  const instructions = [
    raw("SetPuppet", [0, Number(target), 3]),
    raw("ExecPuppet"),
    raw("Exit"),
    instruction,
    raw("Exit"),
  ];
  const content: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "test",
    parentSourceSetHash: "test",
    contentHash: "test",
    map: {
      ...geometry,
      id: "test",
      tileSize: 16,
      textures: {},
      collisions: { 0: [1, 1, 1, 1] },
      entities: group.entities,
      source,
    },
    characters: {},
    scripts: {
      test: instructions.map((m, index) =>
        decodeFieldOp(m, { script: "test", index, source }, {}),
      ),
    },
    scriptLocals: { test: { labels: [], values: [] } },
    entry: {
      player: {
        x: 2,
        y: 0,
        layer: 0,
        direction: "left",
        asset: "hero",
        mount: "",
      },
      description: "test",
      evidence: [source],
    },
    limitations: [],
  };
  return new FieldGame(content);
}
const play = (count: number, speed = 1) => ({
  mnemonic: "PlayAnim",
  type: 2,
  operands: {
    iValues: [0, count, 0, 0],
    rValues: [speed, 0, 0],
    sValues: [""],
  },
});
test("VM waits for one-shot region completion, async loops survive task end, replay partitions agree", () => {
  const a = game(play(1)),
    b = game(play(1));
  a.startEvent("test");
  b.startEvent("test");
  assert.equal(a.stop, null);
  assert.equal(a.busy, true);
  a.advance(60);
  assert.equal(a.busy, true);
  a.advance(10);
  assert.equal(a.busy, true); // Slot completed after the main core's clock.
  a.advance(10);
  assert.equal(a.busy, false);
  b.advance(7);
  b.advance(23);
  b.advance(50);
  assert.deepEqual(a.tileAnimations.snapshot(), b.tileAnimations.snapshot());
  const loop = game(play(-1));
  loop.startEvent("test");
  assert.equal(loop.busy, true);
  loop.advance(10);
  assert.equal(loop.busy, false);
  loop.advance(100);
  assert.equal(loop.tileAnimations.isPlaying("1"), true);
});
test("animation dispatch rejects missing actor media and unreviewed playback parameters", () => {
  const g = game(play(1), "-1001");
  g.startEvent("test");
  assert.match(g.stop!.message, /Missing actor animation media/);
  for (const input of [play(2), play(1, -1), { ...play(1), type: 1 }])
    assert.equal(
      decodeFieldOp(input, { script: "test", index: 0, source }, {}).kind,
      "blocked",
    );
  assert.equal(
    decodeFieldOp(play(1, 0), { script: "test", index: 0, source }, {}).kind,
    "animation-play",
  );
});
