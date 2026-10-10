import test from "node:test";
import assert from "node:assert/strict";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { FieldGame } from "../src/core/field.js";
import type {
  Animation,
  Character,
  FieldContent,
  Op,
} from "../src/field/types.js";

const source = { file: "synthetic", assetPath: "actor" };
const clip = (duration = 0.125, mode = 0, next = ""): Animation => ({
  frames: ["a", "b"].map((sprite) => ({
    sprite,
    x: 0,
    y: 0,
    flip: false,
    alpha: 1,
  })),
  duration,
  mode,
  next,
  flip: false,
});
function character(): Character {
  return {
    source,
    sprites: Object.fromEntries(
      ["a", "b", "c"].map((name) => [
        name,
        {
          file: `${name}.png`,
          width: 16,
          height: 24,
          pivot: [0.5, 0],
          sha256: "synthetic",
          source,
        },
      ]),
    ),
    animations: {
      ...Object.fromEntries(
        ["Default", "WalkB", "WalkL", "WalkR"].flatMap((key) => [
          [key, clip(0.5, 3, key + "-S")],
          [key + "-S", clip(0.5, 3, key)],
        ]),
      ),
      Wave: clip(),
    },
  };
}
function game(loop = false): FieldGame {
  const content: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic",
    contentHash: "synthetic",
    map: {
      id: "synthetic",
      width: 5,
      height: 5,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(25).fill(0) },
      entities: [],
      source,
    },
    characters: { hero: character() },
    scripts: {
      test: [
        { kind: "animation-play", animation: "Wave", speed: 1, loop },
        { kind: "exit" },
      ].map((op, index) => ({ ...op, source, script: "test", index })) as Op[],
    },
    entry: {
      player: {
        x: 2,
        y: 2,
        layer: 1,
        direction: "down",
        asset: "hero",
        mount: "",
      },
      description: "synthetic",
      evidence: [source],
    },
    limitations: [],
  };
  return new FieldGame(content);
}

test("actor cue uses normalized positions, negative means final, and source flip/offset survive", () => {
  const c = character(),
    a = new ActorAnimation(c);
  c.animations.Wave!.flip = true;
  c.animations.Wave!.frames[1]!.x = 3;
  a.cue("Wave", 0);
  assert.equal(a.frame().sprite, "a");
  a.cue("Wave", 0.5);
  assert.deepEqual(a.frame(), {
    sprite: "b",
    x: 3,
    y: 0,
    alpha: 1,
    flip: true,
  });
  for (const position of [-1, 1, 2]) {
    a.cue("Wave", position);
    assert.equal(a.frame().sprite, "b");
    assert.equal(a.playing, false);
  }
});

test("single playback uses source duration and reciprocal speed, with strict completion boundary", () => {
  const a = new ActorAnimation(character());
  a.play("Wave", false, 2);
  a.advance(62.5);
  assert.equal(a.playing, true);
  assert.equal(a.frame().sprite, "b");
  a.advance(1);
  assert.equal(a.playing, false);
  assert.equal(a.snapshot()!.elapsed, 0.0625);
});

test("cue alternation and Puppet pre-cue both use the current asset, independently for each actor", () => {
  const c = character(),
    a = new ActorAnimation(c),
    b = new ActorAnimation(c);
  a.cue("Default", -1);
  a.cue("Default", -1);
  assert.equal(a.snapshot()!.key, "Default-S");
  a.cue("Default", -1);
  a.play("Default", false, 1);
  assert.equal(a.snapshot()!.key, "Default");
  b.cue("Default", -1);
  assert.equal(b.snapshot()!.key, "Default");
  assert.equal(c.animations.Default!.frames[0]!.sprite, "a");
});

test("loop transitions preserve time scale and follow the next asset's mode and flip", () => {
  const c = character();
  c.animations.Wave = clip(0.125, 1, "End");
  c.animations.End = { ...clip(0.25), flip: true };
  const a = new ActorAnimation(c);
  a.cue("Wave", 0);
  a.play("Wave", true, 2);
  a.advance(62.5);
  assert.equal(a.snapshot()!.key, "Wave");
  a.advance(1);
  assert.equal(a.snapshot()!.key, "End");
  assert.equal(a.snapshot()!.mode, 0);
  assert.equal(a.snapshot()!.duration, 0.125);
  assert.equal(a.snapshot()!.loops, 1);
  assert.equal(a.frame().flip, true);
  a.advance(125);
  assert.equal(a.playing, false);
});

test("movement-linked clips use movement progress, alternate on wrap, and stop at the final pose", () => {
  const a = new ActorAnimation(character());
  a.cue("Default", -1);
  a.move("down", 0.24);
  assert.equal(a.snapshot()!.key, "Default-S");
  a.advance(1000);
  assert.equal(a.frame().sprite, "a");
  a.linkToMovement(0.5);
  assert.equal(a.frame().sprite, "b");
  a.linkToMovement(1);
  a.linkToMovement(0);
  assert.equal(a.snapshot()!.key, "Default");
  a.stop();
  assert.equal(a.frame().sprite, "b");
  assert.equal(a.playing, false);
});

test("invalid keys, dependencies, alpha interpolation and speed fail without replacing the previous cue", () => {
  const c = character(),
    a = new ActorAnimation(c);
  a.cue("Wave", 0);
  const before = a.snapshot();
  c.animations.Bad = clip(1, 0, "missing");
  c.animations.Fade = clip();
  c.animations.Fade.frames[1]!.alpha = 0;
  for (const key of ["missing", "Bad", "Fade"])
    assert.throws(() => a.play(key, false, 1));
  for (const speed of [0, -1, NaN, Infinity, Number.MIN_VALUE])
    assert.throws(() => a.play("Wave", false, speed));
  assert.deepEqual(a.snapshot(), before);
});

test("VM waits for the actor, loops continue after script exit, and render-frame partitions replay equally", () => {
  const a = game(),
    b = game();
  a.startEvent("test");
  b.startEvent("test");
  assert.equal(a.busy, true);
  a.advance(120);
  assert.equal(a.busy, true);
  a.advance(10);
  assert.equal(a.busy, false);
  b.advance(3);
  b.advance(57);
  b.advance(70);
  assert.deepEqual(
    a.player.animation!.snapshot(),
    b.player.animation!.snapshot(),
  );
  const loop = game(true);
  loop.startEvent("test");
  assert.equal(loop.busy, false);
  loop.advance(200);
  assert.equal(loop.player.animation!.playing, true);
  assert.equal(loop.player.animation!.snapshot()!.loops, 1);
});

test("explicit missing and mounted animation commands block with source site; ordinary motion resumes a field pose", () => {
  const bad = game();
  (
    bad.content.scripts.test![0] as Extract<Op, { kind: "animation-play" }>
  ).animation = "absent";
  const before = bad.player.animation!.snapshot();
  bad.startEvent("test");
  assert.match(bad.stop!.message, /Missing actor animation/);
  assert.equal(bad.stop!.site!.index, 0);
  assert.deepEqual(bad.player.animation!.snapshot(), before);
  const mounted = game();
  mounted.player.mount = "vehicle";
  mounted.startEvent("test");
  assert.match(mounted.stop!.message, /Mounted actor/);
  const a = game();
  a.startEvent("test");
  a.advance(130);
  assert.equal(a.move("left"), true);
  a.advance(240);
  assert.equal(a.player.x, 1);
  assert.equal(a.player.animation!.snapshot()!.key, "WalkL");
  assert.equal(a.player.animation!.playing, false);
  assert.equal(a.move("left"), true);
  assert.equal(a.player.animation!.snapshot()!.key, "WalkL-S");
});

test("bad animation in an appended actor group cannot leave earlier actors partially registered", () => {
  const g = game(),
    c = g.content;
  c.characters.bad = character();
  c.characters.bad.animations.Default!.next = "missing";
  c.map.groups = {
    cast: {
      name: "cast",
      source,
      blockers: [],
      entities: ["hero", "bad"].map((asset, index) => ({
        id: String(index + 1),
        kind: 6,
        asset,
        x: index,
        y: 0,
        width: 1,
        height: 1,
        layer: 1,
        direction: "down",
        script: null,
        collision: null,
        destinationLayer: null,
        source,
      })),
    },
  };
  c.scripts.test = [
    { kind: "entities", group: "cast", script: "test", index: 0, source },
  ];
  g.startEvent("test");
  assert.match(g.stop!.message, /Missing actor animation/);
  assert.deepEqual(Object.keys(g.actors), ["-1001"]);
  assert.equal(g.entities.length, 0);
  assert.equal(g.activeGroups.size, 0);
});
