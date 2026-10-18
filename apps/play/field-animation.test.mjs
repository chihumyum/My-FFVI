import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FieldAnimations,
  fieldActorParts,
  sampleFieldClip,
  fieldTileRegions,
  sampleFieldTile,
} from "./field-animation.js";
import { withPresentation } from "./presentation-events.js";
import { PlayGame } from "../../src/play/game.js";
import { executeVehicleInstruction } from "../../src/play/vehicle-input.js";

const data = JSON.parse(await readFile(new URL("../../build/web-data/data.json", import.meta.url)));
const edgar = data.characters.mo_ff6_p003;

test("boarding PR Magitek keeps Terra and the imperial soldiers as separate field riders", () => {
  for (const id of [1, 31, 32]) {
    const asset = data.fieldAssets[id].asset_name;
    const actor = { asset, x: 1, y: 1, direction: "up" };
    const host = { data, player: actor, actor: () => actor };
    executeVehicleInstruction(host, {}, "RideVehicleNPC", [6, -id]);
    const before = structuredClone(actor);
    const parts = fieldActorParts(actor);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].asset, asset, "the original rider remains visible above its mount");
    assert.equal(parts[1].asset, "mo_ff6_v006_c00");
    assert(data.characters[parts[0].asset]?.sprites);
    assert(parts[0].hideFeet > 0 && parts[0].offsetY > 0);
    assert.deepEqual(actor, before, "rendering does not rewrite a saved actor");
    executeVehicleInstruction(host, {}, "RideVehicleNPC", [1, -id]);
    assert.deepEqual(fieldActorParts(actor), [{ asset }]);
  }
});

test("right-facing PR walk uses its declared left sprite with horizontal mirroring", () => {
  const right = sampleFieldClip(edgar, "WalkR", 0.2);
  const left = sampleFieldClip(edgar, "WalkL", 0.2);
  assert.match(right.name, /^WalkL_/);
  assert.equal(right.name, left.name);
  assert.equal(right.flip, true);
  assert.equal(left.flip, false);
  assert.notEqual(right.name, sampleFieldClip(edgar, "Default", 0.2).name);
  assert.equal(sampleFieldClip(edgar, "WalkR", 0.6).clip, "WalkR-S");
  assert.equal(sampleFieldClip(edgar, "WalkR", 7200.6).clip, "WalkR-S");
});

test("idle facing remains stable, movement resumes both authored walking halves", () => {
  const animation = new FieldAnimations();
  const actor = { asset: "mo_ff6_p003", animation: "WalkR", direction: "right", x: 1, y: 1 };
  const initial = structuredClone(actor);
  assert.equal(animation.sample(actor, edgar, 0).name, "WalkL_01");
  assert.equal(animation.sample(actor, edgar, 8).name, "WalkL_01");
  assert.deepEqual(actor, initial);
  actor.motion = {};
  assert.equal(animation.sample(actor, edgar, 8.2).flip, true);
  assert.notEqual(animation.sample(actor, edgar, 8.25).name, "Default_00");
  actor.motion = null;
  actor.direction = "up";
  assert.match(animation.sample(actor, edgar, 9).name, /^WalkB_/);
});

test("PR one-shot clips hold their final frame while mode1 decor still loops", () => {
  const once = edgar.animation.data.animation.find((clip) => clip.name === "FingerUp");
  const last = once.frames.at(-1).sprite_name;
  assert.equal(sampleFieldClip(edgar, "FingerUp", once.play_speed + 1).name, last);
  assert.equal(sampleFieldClip(edgar, "FingerUp", 2000).name, last);
  const decor = data.characters.mo_ff6_b043_c00;
  assert.equal(
    sampleFieldClip(decor, "Default", 0).name,
    sampleFieldClip(decor, "Default", decor.animation.data.animation[0].play_speed).name,
  );
  assert.notEqual(
    sampleFieldClip(decor, "Default", 0).name,
    sampleFieldClip(decor, "Default", 0.5).name,
  );
});

test("PR movement loops without a next clip keep cycling, including all three opening armors", () => {
  const warnings = [];
  let checked = 0;
  for (const [asset, character] of Object.entries(data.characters)) {
    for (const clip of character.animation?.data?.animation || []) {
      if (clip.play_mode !== 3 || clip.next_anim_name || !(clip.play_speed > 0)) continue;
      for (const phase of [0.13, 0.47, 0.81]) {
        const sample = (cycles) =>
          sampleFieldClip(
            character,
            clip.name,
            clip.play_speed * (cycles + phase),
            null,
            (...row) => warnings.push({ asset, row }),
          );
        assert.equal(sample(20).name, sample(0).name, `${asset}/${clip.name} must wrap`);
      }
      checked++;
    }
  }
  assert(checked > 0);
  assert.deepEqual(warnings, [], "an empty next clip is valid PR movement playback");
  for (const name of ["DefaultC", "DefaultR", "DefaultL"]) {
    const actor = { id: name, asset: "mo_ff6_n076_c00", animation: name, x: 0, y: 0, motion: {} };
    const host = new FieldAnimations(),
      frames = new Set();
    for (let time = 0; time < 12; time += 0.1) {
      actor.y -= 0.01;
      const frame = host.sample(actor, data.characters[actor.asset], time);
      if (time > 5) frames.add(frame.name);
    }
    assert(frames.size >= 10, `${name} must still show the complete step cycle after five seconds`);
  }
});

test("a repeated source PlayAnim restarts without mutating the VM actor", () => {
  const animation = new FieldAnimations();
  const actor = { animation: "FingerUp", x: 0, y: 0 };
  animation.sample(actor, edgar, 0);
  const last = animation.sample(actor, edgar, 5).name;
  animation.event({ name: "PlayAnim", animationActor: actor, time: 5 });
  assert.notEqual(animation.sample(actor, edgar, 5).name, last);
  animation.event({ name: "CueAnim", animationActor: actor, time: 6, r: [1] });
  assert.equal(animation.sample(actor, edgar, 6).name, last);
  assert.deepEqual(actor, { animation: "FingerUp", x: 0, y: 0 });
});

test("a missing PR sprite reference keeps the NPC visible and logs the fallback", () => {
  const warnings = [];
  const frame = sampleFieldClip(data.characters.mo_ff6_n002_c00, "AngryB", 1, null, (_, message) =>
    warnings.push(message),
  );
  assert(frame?.info?.file);
  assert(warnings.some((message) => message.includes("AngryB_01")));
});

test("closed/open chest and door tiles use source state and never the global clock", async () => {
  const map = JSON.parse(
    await readFile(new URL("../../build/web-data/maps/16.json", import.meta.url)),
  );
  const game = { map, mapId: 16, actors: new Map(), banks: {} };
  const animation = map.tilesets[0].tiles.find((tile) => tile.id === 19).animation;
  for (const time of [0, 0.001, 1, 9999])
    assert.equal(sampleFieldTile(animation, time, 9, 13, 1, fieldTileRegions(game)), 19);
  game.actors.set("5", { opened: true });
  assert.equal(sampleFieldTile(animation, 0, 9, 13, 1, fieldTileRegions(game)), 18);
  assert.equal(sampleFieldTile(animation, 99, 7, 11, 1, fieldTileRegions(game)), 19);
  game.actors.clear();
  game.banks.TreasureFlag1 = { 4: 1 };
  assert.equal(sampleFieldTile(animation, 3, 9, 13, 1, fieldTileRegions(game)), 18);
  game.banks.TreasureFlag1[4] = 0;
  assert.equal(sampleFieldTile(animation, 3, 9, 13, 1, fieldTileRegions(game)), 19);
  const water = [
    { tileid: 2, duration: 200 },
    { tileid: 3, duration: 200 },
  ];
  assert.equal(sampleFieldTile(water, 0, 0, 0, 1, []), 2);
  assert.equal(sampleFieldTile(water, 0.3, 0, 0, 1, []), 3);
  // Same rectangle on another floor must not affect that floor's animation.
  assert.equal(
    sampleFieldTile(
      water,
      0.3,
      9,
      13,
      0,
      fieldTileRegions(game).map((region) => ({ ...region, tileAnimation: { allLayers: false } })),
    ),
    3,
  );
});

test("old saves with a hidden door show the opened tile, while explicit closing wins", async () => {
  const map = JSON.parse(
    await readFile(new URL("../../build/web-data/maps/8.json", import.meta.url)),
  );
  const game = { map, actors: new Map([["1", { visible: false }]]) };
  assert.equal(fieldTileRegions(game).find((region) => region.id === "2").frame, 1);
  game.actors.set("2", { tileFrame: 0, tileNormalized: 0 });
  assert.equal(fieldTileRegions(game).find((region) => region.id === "2").frame, 0);
});

test("observing field animation commands preserves game state exactly", () => {
  const options = {
    data: {
      programs: { p: { name: "p", ops: [["PlayAnim", [0, 1], [], ["FingerUp"]]] } },
      messages: {},
    },
    battleData: {},
  };
  const events = [];
  const observed = new (withPresentation(PlayGame))({
    ...options,
    onPresentation: (event) => events.push(event),
  });
  const plain = new PlayGame(options);
  const task = () => ({ program: "p", pc: 0, actor: null, locals: {}, bindings: {} });
  const a = task(),
    b = task();
  observed.step(a);
  plain.step(b);
  assert.deepEqual(observed.player, plain.player);
  assert.deepEqual(a, b);
  assert.equal(events[0].animationActor, observed.player);
});

test("PR script-defined poses preserve offsets, mirroring and the character's own clip priority", async () => {
  const bundle = JSON.parse(
    await readFile(
      new URL(
        "../../build/web-data/raw/bundles/map_30410_assets_all_3a0fcd17ae2e239f93aef97c86d25daa.json",
        import.meta.url,
      ),
    ),
  );
  const source = bundle.find((row) => row.source.assetPath.endsWith("/sc_map_30410.json"));
  assert(source?.data.Animations?.length);
  const warnings = [],
    animation = new FieldAnimations((...row) => warnings.push(row));
  const actor = { id: "tent", asset: "mo_ff6_b121_c00", animation: "Tent_Yoffset", x: 1, y: 1 };
  const before = structuredClone(actor);
  animation.event({
    name: "CueAnim",
    s: [actor.animation],
    r: [0],
    script: "sc_map_30410",
    time: 0,
    animationActor: actor,
    customAnimations: source.data.Animations,
  });
  const frame = animation.sample(actor, data.characters[actor.asset], 0);
  assert.equal(frame.name, "Default_00");
  assert.equal(frame.offsety, 16);
  assert.equal(frame.clip, "Tent_Yoffset");
  assert.deepEqual(warnings, []);
  assert.deepEqual(actor, before);
  actor.asset = "mo_ff6_p003";
  actor.animation = "WalkR";
  animation.event({
    name: "Move",
    s: ["WalkR"],
    script: "sc_map_30410",
    time: 1,
    animationActor: actor,
    customAnimations: source.data.Animations,
  });
  assert.equal(
    animation.clips(actor, edgar).get("WalkR"),
    edgar.animation.data.animation.find((clip) => clip.name === "WalkR"),
  );
});

test("custom animation chains retain authored color, alpha and the native last-pose cue", () => {
  const custom = [
    {
      name: "Start",
      play_mode: 3,
      play_speed: 0.5,
      next_anim_name: "End",
      frames: [{ sprite_name: "first" }],
    },
    {
      name: "End",
      play_mode: 0,
      play_speed: 1,
      is_reverse: true,
      frames: [
        { sprite_name: "first" },
        {
          sprite_name: "last",
          offsetx: 3,
          offsety: 7,
          flip: true,
          alpha: 0.25,
          rgb: { r: 1, g: 0.5, b: 0 },
        },
      ],
    },
  ];
  const character = { sprites: { first: { file: "first.png" }, last: { file: "last.png" } } };
  const actor = { id: 7, animation: "Start", x: 0, y: 0 },
    warnings = [];
  const animation = new FieldAnimations((...row) => warnings.push(row));
  animation.event({ name: "PlayAnim", time: 0, animationActor: actor, customAnimations: custom });
  animation.sample(actor, character, 0);
  const end = animation.sample(actor, character, 2);
  assert.equal(end.name, "last");
  assert.deepEqual(
    [end.offsetx, end.offsety, end.alpha, end.tint, end.flip],
    [3, 7, 0.25, 0xff8000, false],
  );
  actor.animation = "End";
  animation.event({
    name: "CueAnim",
    time: 3,
    r: [-1],
    animationActor: actor,
    customAnimations: custom,
  });
  assert.equal(animation.sample(actor, character, 3).name, "last");
  // Once resolved, native animation caches keep that script clip available.
  animation.event({
    name: "SetPos",
    time: 4,
    s: ["End"],
    animationActor: actor,
    customAnimations: [],
  });
  assert.equal(animation.sample(actor, character, 4).name, "last");
  assert.deepEqual(warnings, []);
});

test("observing a script custom animation does not lazily create or rewrite actors", () => {
  const custom = [{ name: "Offset", frames: [{ sprite_name: "Default_00", offsety: 16 }] }];
  class Base {
    constructor() {
      this.data = {
        programs: {
          p: { name: "p", animations: custom, ops: [["SetPos", [1, 2], [], ["Offset"]]] },
        },
      };
      this.player = { id: -1 };
      this.actors = new Map();
    }
    actor() {
      throw Error("observer must never materialize actors");
    }
    step(task) {
      task.pc++;
    }
  }
  const events = [],
    game = new (withPresentation(Base))({ onPresentation: (event) => events.push(event) });
  const before = structuredClone([...game.actors]);
  game.step({ program: "p", pc: 0, actor: -1001 });
  assert.equal(events[0].animationActor, game.player);
  assert.equal(events[0].customAnimations, custom);
  assert.deepEqual([...game.actors], before);
});
