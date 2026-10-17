import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import type { FieldContent, FieldEntity } from "../src/field/types.js";
import { compileWorldTerrain } from "../src/compiler/world-terrain.js";
import { worldTerrainFixture } from "./fixtures/world-terrain.js";

const source = { file: "synthetic", assetPath: "authored/loop-contract" };
function fixture(horizontal = true, vertical = true): FieldContent {
  return { formatVersion: 1, kind: "field-development", contentHash: "loop-fixture",
    sourceSetHash: "synthetic", parentSourceSetHash: "synthetic",
    map: { id: "loop-fixture", width: 4, height: 3, tileSize: 16,
      topology: { range: { x: 0, y: 0, width: 4, height: 3 }, loop: { horizontal, vertical } },
      collisions: { 1: Array<number>(12).fill(0) }, layers: [], tilesets: [], textures: {}, entities: [], source },
    characters: {}, scripts: {}, entry: { player: { x: 3, y: 1, layer: 1,
      direction: "right", asset: "hero", mount: "" }, description: "controlled loop", evidence: [source] }, limitations: [] };
}
function entity(extra: Partial<FieldEntity>): FieldEntity {
  return { id: "seam", kind: 5, x: 0, y: 1, layer: 1, width: 1, height: 1,
    asset: null, direction: "left", script: null, collision: null, destinationLayer: null, source, ...extra };
}

test("seam input interpolates one cell and publishes a canonical stable endpoint", () => {
  const content = fixture(), game = new FieldGame(content);
  assert.equal(game.move("right"), true);
  assert.deepEqual(game.player.motion!.from, { x: 3, y: 1 });
  assert.deepEqual(game.player.motion!.to, { x: 4, y: 1 });
  assert.equal(game.move("down"), false);
  assert.throws(() => game.checkpoint(), /movement/);
  game.advance(120); assert.equal(game.player.motion!.elapsed, 120);
  game.advance(120);
  assert.equal(game.player.x, 0); assert.equal(game.player.y, 1); assert.equal(game.player.steps, 1);
  assert.equal(game.player.motion, null);
  const saved = game.checkpoint(), restored = FieldGame.restore(content, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.move("left"), true); restored.advance(240);
  assert.equal(restored.player.x, 3); assert.equal(restored.player.steps, 2);
});

test("vertical seams obey declared axes and a closed axis keeps its original boundary", () => {
  const content = fixture(false, true); content.entry.player.x = 0; content.entry.player.y = 0;
  const game = new FieldGame(content);
  assert.equal(game.move("left"), false); assert.equal(game.player.steps, 0);
  assert.equal(game.move("up"), true); assert.deepEqual(game.player.motion!.to, { x: 0, y: -1 });
  game.advance(240); assert.equal(game.player.y, 2); assert.equal(game.player.steps, 1);
});

test("terrain and objects at the canonical seam destination still block travel", () => {
  const content = fixture(); content.map.collisions[1]![4] = 1;
  const wall = new FieldGame(content);
  assert.equal(wall.move("right"), false); assert.equal(wall.player.motion, null); assert.equal(wall.player.steps, 0);
  content.map.collisions[1]![4] = 0;
  content.map.entities.push(entity({ mapObject: { collision: true, acceptDirection: 15, talkMounts: [""],
    soundId: 0, interaction: { kind: "none" } } }));
  const object = new FieldGame(content);
  assert.equal(object.move("right"), false); assert.equal(object.player.steps, 0); assert.equal(object.stop, null);
});

test("canonical seam arrival dispatches the destination event exactly once", () => {
  const content = fixture();
  content.map.entities.push(entity({ kind: 2, script: "arrive" }));
  content.scripts.arrive = [{ kind: "message", key: "ARRIVED", speaker: "", text: "arrived", script: "arrive", index: 0, source },
    { kind: "exit", script: "arrive", index: 1, source }];
  const game = new FieldGame(content);
  assert.equal(game.move("right"), true); game.advance(240);
  assert.equal(game.player.x, 0); assert.equal(game.player.steps, 1); assert.equal(game.dialogue!.text, "arrived");
  game.confirm(); game.advance(20); assert.equal(game.dialogue, null); assert.equal(game.busy, false);
  assert.equal(game.player.steps, 1); game.advance(100); assert.equal(game.dialogue, null);
});

test("confirmation reaches an interactive object across the same seam without moving", () => {
  const content = fixture(); content.map.entities.push(entity({ script: "talk", mapObject: { collision: true,
    acceptDirection: 15, talkMounts: [""], soundId: 0, interaction: { kind: "script", script: "talk" } } }));
  content.scripts.talk = [{ kind: "message", key: "SEAM", speaker: "", text: "seam talk", script: "talk", index: 0, source },
    { kind: "exit", script: "talk", index: 1, source }];
  const game = new FieldGame(content); game.confirm();
  assert.equal(game.dialogue!.text, "seam talk"); assert.equal(game.player.x, 3); assert.equal(game.player.steps, 0);
});

test("wrong crop cannot authorize a different movement topology and absent topology preserves boundaries", () => {
  const content = fixture(); content.map.topology!.range.width = 3;
  assert.throws(() => new FieldGame(content), /collision range/);
  const nonloop = fixture(); delete nonloop.map.topology;
  const game = new FieldGame(nonloop); assert.equal(game.move("right"), false); assert.equal(game.player.steps, 0);
});

function terrainField(): FieldContent {
  const terrain = compileWorldTerrain(worldTerrainFixture()), content = fixture();
  content.sourceSetHash = terrain.sourceSetHash; content.parentSourceSetHash = terrain.parentSourceSetHash;
  Object.assign(content.map, { id: terrain.mapName, width: terrain.width, height: terrain.height,
    identity: { mapId: terrain.mapId, areaId: 3 }, collisions: {}, worldTerrain: terrain,
    topology: { range: { x: 0, y: 0, width: terrain.width, height: terrain.height },
      loop: { horizontal: true, vertical: true } } });
  Object.assign(content.entry.player, { x: 2, y: 0, layer: 0 }); content.entry.transportationId = 9;
  return content;
}

test("actual actor input uses its bound transport terrain across a seam and keeps water blocked", () => {
  const content = terrainField(), game = new FieldGame(content);
  assert.equal(game.move("right"), true); game.advance(240);
  assert.equal(game.player.x, 0); assert.equal(game.player.y, 0); assert.equal(game.player.steps, 1);
  assert.equal(game.stop, null);
  assert.equal(game.move("down"), false); assert.equal(game.player.steps, 1); assert.equal(game.stop, null);
  const restored = FieldGame.restore(content, game.checkpoint());
  assert.equal(restored.move("left"), true); restored.advance(240); assert.equal(restored.player.x, 2);
});

test("a source terrain from another source set cannot authorize this field's walking rules", () => {
  for (const key of ["sourceSetHash", "parentSourceSetHash"] as const) {
    const content = terrainField(); content[key] = "f".repeat(64);
    assert.throws(() => new FieldGame(content), /terrain.*topology/);
  }
});
