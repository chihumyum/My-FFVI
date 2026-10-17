import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { FieldGame } from "../src/core/field.js";
import type { Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

function fixture() {
  const { field } = checkpointFixture();
  const source = { file: "synthetic-regions.bundle", assetPath: "regions.json", sha256: "a".repeat(64),
    objectId: "9007199254740997", serializedFile: "synthetic-regions" };
  const group = (name: string, objectId: number, x: number) => compileEntityGroup(name, {
    source,
    data: { layers: [{ name: "GroundObject", objects: [{ x, y: 16, width: 32, height: 16,
      properties: [{ name: "object_type", value: 13 }, { name: "object_id", value: objectId },
        { name: "entity_id", value: 0 }] }] }] },
  }, {});
  const initial = group("entity_default", 77, 16), first = group("first", 78, 32), second = group("second", 78, 48);
  for (const entry of [initial, first, second]) assert.deepEqual(entry.blockers, []);
  field.map.entities = initial.entities;
  field.map.initialGroups = ["entity_default"];
  field.map.groups = { entity_default: initial, first, second };
  field.cameraHost = { kind: "source-field-camera-host-v1", mapRange: { x: 0, y: 0, width: 6, height: 4 },
    loop: { horizontal: false, vertical: false }, playerVisualOffset: { x: 0, y: -6 },
    callbacks: "fresh-normal-field-v1", sources: [{ file: "synthetic-native", sha256: "1".repeat(64) },
      { file: "synthetic-prefab", sha256: "2".repeat(64) }] };
  field.scripts = Object.fromEntries(["first", "second"].map((name) => [name,
    [{ kind: "entities", group: name }, { kind: "exit" }].map((op, index) =>
      ({ ...op, index, script: name, source: field.map.source }) as Op)]));
  return field;
}

test("move areas follow cumulative group registration and stable restoration without becoming actors", () => {
  const content = fixture(), game = new FieldGame(content);
  game.initializeMapCamera();
  assert.deepEqual(Object.keys(game.actors), ["-1001"]);
  assert.equal(game.startEvent("first"), true);
  assert.equal(game.startEvent("second"), true);
  assert.equal(game.stop, null);
  assert.deepEqual(game.moveAreas.map((area) => area.definition.group), ["entity_default", "first", "second"]);
  assert.equal(game.getMoveArea(78)!.definition.group, "first", "Lookup retains the source first-match order");
  assert.ok(!game.minimapEntities.some((entity) => entity.id.startsWith("first:")),
    "The latest property list is distinct from accumulated movement regions");
  assert.deepEqual(Object.keys(game.actors), ["-1001"]);
  const detached = game.getMoveArea(78)!;
  detached.definition.geometry.x = -999;
  assert.equal(game.getMoveArea(78)!.definition.geometry.x, 32);
  const saved = JSON.parse(JSON.stringify(game.checkpoint()));
  const restored = FieldGame.restore(content, saved);
  assert.deepEqual(restored.moveAreas, game.moveAreas);
  assert.deepEqual(restored.checkpoint(), game.checkpoint());
  assert.equal(restored.getMoveArea(999), null);
  const fresh = new FieldGame(content);
  assert.equal(fresh.getMoveArea(78), null, "A new map owner cannot inherit old group regions");
});

test("a failed region binding cannot partially publish an entity group or its actors", () => {
  const content = fixture();
  Object.assign(content.map.groups!.second!.entities[0]!.moveArea!.source, { sha256: "b".repeat(64) });
  const game = new FieldGame(content);
  game.initializeMapCamera();
  const entities = structuredClone(game.entities), areas = game.moveAreas, actors = Object.keys(game.actors);
  assert.equal(game.startEvent("second"), true);
  assert.match(game.stop?.message ?? "", /move area.*binding/i);
  assert.deepEqual(game.entities, entities);
  assert.deepEqual(game.moveAreas, areas);
  assert.deepEqual(Object.keys(game.actors), actors);
  assert.deepEqual([...game.activeGroups], ["entity_default"]);
});

test("region definitions remain bound to content and cannot grant missing spatial providers", () => {
  const content = fixture();
  delete content.map.entities[0]!.moveArea;
  assert.throws(() => new FieldGame(content), /Missing field move area definition/);
  const missingMapRange = fixture();
  delete missingMapRange.cameraHost;
  const game = new FieldGame(missingMapRange);
  assert.throws(() => game.getMoveArea(77), /map range is unavailable/);
  assert.throws(() => game.getMoveArea(1.5), /integer/);
});
