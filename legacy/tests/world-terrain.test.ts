import test from "node:test";
import assert from "node:assert/strict";
import { compileWorldTerrain, compileWorldMapEntryView } from "../src/compiler/world-terrain.js";
import { readWorldTerrainFoot, validateWorldTerrain, worldTerrainCollisionMask } from "../src/core/world-terrain.js";
import { worldTerrainFixture } from "./fixtures/world-terrain.js";

test("world identity follows the bound Area.map_type, independently of loop/name", () => {
  const input = worldTerrainFixture();
  assert.equal(compileWorldMapEntryView(input.reader, input.mapId, input.sources).isWorld, true);
  (input.tables["area.csv"]![0] as Record<string, string>).map_type = "1";
  const view = compileWorldMapEntryView(input.reader, input.mapId, input.sources);
  assert.equal(view.isWorld, false); assert.equal(view.loopType, 3);
  assert.throws(() => compileWorldTerrain(input), /limited to bound world maps/);
});

test("the raw foot grid and exact transport-group source layer share one lookup", () => {
  const input = worldTerrainFixture(), terrain = compileWorldTerrain(input);
  assert.equal(readWorldTerrainFoot(terrain, { x: 0, y: 0 }), 7);
  assert.equal(terrain.footRows["7"]!.typeId, 16);
  assert.equal(terrain.transportRules["9"]!.groupId, 6);
  assert.equal(worldTerrainCollisionMask(terrain, 9, { x: 0, y: 0 }), 15);
  assert.equal(worldTerrainCollisionMask(terrain, 9, { x: 1, y: 0 }), 0);
  assert.equal(worldTerrainCollisionMask(terrain, 6, { x: 0, y: 0 }), 0);
  assert.equal(worldTerrainCollisionMask(terrain, 6, { x: 1, y: 0 }), 15);
  assert.throws(() => worldTerrainCollisionMask(terrain, 1, { x: 0, y: 0 }), /not implemented/);
  assert.throws(() => worldTerrainCollisionMask(terrain, 12, { x: 0, y: 0 }), /not implemented/);
  assert.equal(terrain.transportRules["9"]!.groupFlags.every(v => v === 1), true);
  assert.equal(terrain.sources.attribute.objectId, "-9007199254740998");
});

test("loop axes preserve raw foot IDs at negative and positive seams", () => {
  const terrain = compileWorldTerrain(worldTerrainFixture());
  assert.equal(readWorldTerrainFoot(terrain, { x: -1, y: -1 }), 21);
  assert.equal(readWorldTerrainFoot(terrain, { x: 3, y: 2 }), 7);
  assert.equal(worldTerrainCollisionMask(terrain, 9, { x: -1, y: -1 }), 0);
  terrain.loopType = 1;
  assert.equal(readWorldTerrainFoot(terrain, { x: 3, y: -1 }), 0);
  assert.equal(worldTerrainCollisionMask(terrain, 9, { x: 3, y: -1 }), 0);
  assert.throws(() => readWorldTerrainFoot(terrain, { x: 0.5, y: 0 }), /integer/);
});

test("spatial collision variation cannot be replaced by a foot type or a passing default", () => {
  const input = worldTerrainFixture();
  const group = input.assets[2]!.data as { layers: { data: number[] }[] };
  group.layers[0]!.data[2] = 1;
  assert.throws(() => compileWorldTerrain(input), /varies within one raw foot ID/);
});

test("missing, foreign or ambiguous package assets and groups reject", () => {
  const missing = worldTerrainFixture(); missing.assets = missing.assets.slice(0, 2);
  assert.throws(() => compileWorldTerrain(missing), /Missing or ambiguous/);
  const foreign = worldTerrainFixture(); foreign.assets[1]!.source.file = "another.bundle";
  assert.throws(() => compileWorldTerrain(foreign), /Missing or ambiguous/);
  const duplicate = worldTerrainFixture(); duplicate.assets = [...duplicate.assets, duplicate.assets[1]!];
  assert.throws(() => compileWorldTerrain(duplicate), /Missing or ambiguous/);
  const group = worldTerrainFixture();
  (group.assets[2]!.data as { layers: { id: number }[] }).layers[0]!.id = 8;
  assert.throws(() => compileWorldTerrain(group), /Missing world terrain source transportation group layer/);
});

test("unknown foot rows, crops, directional collisions and overrides remain blocked", () => {
  const missing = worldTerrainFixture(); (missing.tables["foot_information.csv"] as Record<string, string>[]).pop();
  assert.throws(() => compileWorldTerrain(missing), /Unresolved world terrain foot master/);
  const crop = worldTerrainFixture(); crop.mapRange.x = 1;
  assert.throws(() => compileWorldTerrain(crop), /full map range/);
  const collision = worldTerrainFixture();
  (collision.assets[2]!.data as { layers: { data: number[] }[] }).layers[0]!.data[0] = 2;
  assert.throws(() => compileWorldTerrain(collision), /unsupported directional/);
  const override = worldTerrainFixture();
  (override.packageAsset.data as { map: Record<string, unknown>[] }).map[0]!.sub_collision = "Map_W/sub_collision";
  assert.throws(() => compileWorldTerrain(override), /sub-collision override/);
});

test("compiled content is detached and preserves exact decimal identities", () => {
  const input = worldTerrainFixture(), terrain = compileWorldTerrain(input), before = structuredClone(terrain);
  (input.assets[1]!.data as { layers: { data: number[] }[] }).layers[0]!.data[0] = 21;
  input.assets[0]!.source.objectId = "42";
  (input.tables["foot_information.csv"]![0] as Record<string, string>).type_id = "1";
  assert.deepEqual(terrain, before);
  assert.equal(terrain.sources.package.objectId, "-9007199254740999");
});

test("complete validation rejects forged grid/row/layer binding while per-cell reads do not scan", () => {
  const terrain = compileWorldTerrain(worldTerrainFixture());
  assert.throws(() => validateWorldTerrain(terrain, { mapId: 41, mapName: terrain.mapName, width: 3, height: 2 }), /another map/);
  const forged = structuredClone(terrain); forged.transportRules["9"]!.collisionSource.objectId = "42";
  assert.throws(() => validateWorldTerrain(forged), /row\/layer/);
  const incomplete = structuredClone(terrain); delete incomplete.transportRules["9"]!.collisionByFoot["7"];
  assert.throws(() => validateWorldTerrain(incomplete), /Incomplete/);
  const wrong = structuredClone(terrain); wrong.cells[0] = 0;
  assert.throws(() => validateWorldTerrain(wrong), /integer|number/);
  // A validated immutable caller may query one cell without touching another.
  Object.defineProperty(terrain.cells, "5", { get() { throw new Error("unrequested cell scanned"); } });
  assert.equal(worldTerrainCollisionMask(terrain, 9, { x: 0, y: 0 }), 15);
});
