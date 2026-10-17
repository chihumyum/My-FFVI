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
