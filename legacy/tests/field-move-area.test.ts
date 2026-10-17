import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { compileFieldMoveArea } from "../src/compiler/field-move-area.js";
import { fieldMoveAreas, findFieldMoveArea, projectFieldMoveArea, validateFieldMoveAreas } from "../src/core/field-move-area.js";
import type { FieldEntity } from "../src/field/types.js";

const source = { file: "synthetic.bundle", assetPath: "Map/entity.json", objectId: "9223372036854775806" };
const map = { x: 2, y: 1, width: 20, height: 16 };
function object(entityId = 31, objectId = 7, geometry = { x: 48, y: 80, width: 48, height: 32 }) {
  return { ...geometry, rotation: 0, visible: true,
    properties: Object.entries({ entity_id: entityId, object_id: objectId, object_type: 13 })
      .map(([name, value]) => ({ name, type: "int", value })) };
}
function group(name = "entity_default", objects = [object()]) {
  return compileEntityGroup(name, { data: { layers: [{ name: "GroundObject", objects }] }, source }, {});
}
function entity() {
  const result = group(); assert.deepEqual(result.blockers, []);
  return result.entities[0]!;
}

test("ordinary kind 13 compiles to bound area data without granting actor or collision behavior", () => {
  const e = entity(); validateFieldMoveAreas([e]);
  assert.equal(e.moveArea!.kind, "field-move-area-v1");
  assert.equal(e.moveArea!.source.objectId, source.objectId);
  assert.equal(e.asset, null); assert.equal(e.script, null); assert.equal(e.collision, null);
  assert.equal(e.nativeNpc, undefined); assert.equal(e.npc, undefined);
  assert.deepEqual(e.moveArea!.geometry, { x: 48, y: 80, width: 48, height: 32, layer: 1 });
});
test("map origin and native Y direction are applied once to MoveArea, independently of CellArea", () => {
  const area = projectFieldMoveArea(entity().moveArea!, map);
  assert.deepEqual(area.cellArea, { x: 1, y: 4, width: 3, height: 2 });
  assert.deepEqual(area.moveArea, { x: -144, y: 64, width: 48, height: 32 });
});
test("unaligned integer source rectangles retain pixel bounds and nearest-even cell bounds", () => {
  const e = group("odd", [object(31, 7, { x: 40, y: 56, width: 25, height: 41 })]).entities[0]!;
  const area = projectFieldMoveArea(e.moveArea!, { x: 0, y: 0, width: 20, height: 16 });
  assert.deepEqual(area.cellArea, { x: 2, y: 4, width: 2, height: 3 });
  assert.deepEqual(area.moveArea, { x: -120.5, y: 71.5, width: 25, height: 41 });
});
test("negative and anonymous source entity IDs remain data identities rather than camera/party selectors", () => {
  const result = group("areas", [object(0), object(-1, 9)]);
  assert.deepEqual(result.blockers, []); validateFieldMoveAreas(result.entities);
  assert.deepEqual(result.entities.map((e) => [e.id, e.moveArea!.sourceEntityId]), [["areas:0:0", 0], ["-1", -1]]);
  assert.equal(findFieldMoveArea(result.entities, -1, map), null);
  assert.equal(findFieldMoveArea(result.entities, 9, map)!.definition.entityId, "-1");
});
test("append-only group order preserves earlier regions after later groups and first ObjectId match", () => {
  const first = group("entity_default", [object(31, 7)]).entities;
  const next = group("first_event", [object(32, 7), object(33, 8)]).entities;
  const last = group("second_event", [object(34, 9)]).entities;
  const active = [...first, ...next, ...last];
  assert.deepEqual(fieldMoveAreas(active, map).map((a) => a.definition.group), ["entity_default", "first_event", "first_event", "second_event"]);
  assert.equal(findFieldMoveArea(active, 7, map)!.definition.entityId, "31");
  assert.equal(findFieldMoveArea(active, 8, map)!.definition.entityId, "33");
  assert.equal(findFieldMoveArea(last, 7, map), null); // A new map has its own entity owner.
});
test("region queries return detached data and never mutate the content or preceding query", () => {
  const e = entity(), before = structuredClone(e), first = fieldMoveAreas([e], map);
  first[0]!.definition.geometry.width = 1; first[0]!.definition.source.file = "foreign";
  first[0]!.moveArea.x = 999;
  const second = findFieldMoveArea([e], 7, map)!;
  assert.deepEqual(e, before); assert.equal(second.definition.geometry.width, 48);
  assert.equal(second.definition.source.file, source.file); assert.equal(second.moveArea.x, -144);
});
test("all candidate definitions validate before lookup can return an earlier matching region", () => {
  const first = entity(), bad = structuredClone(first);
  bad.moveArea!.geometry.x += 1;
  assert.throws(() => findFieldMoveArea([first, bad], 7, map), /compiled entity binding/);
  assert.equal(first.moveArea!.geometry.x, 48);
});
test("missing definitions and changed provenance/rectangle/identity cannot publish as passive regions", () => {
  const missing = entity(); delete missing.moveArea;
  assert.throws(() => validateFieldMoveAreas([missing]), /Missing/);
  for (const mutate of [
    (e: FieldEntity) => { e.objectId = 8; },
    (e: FieldEntity) => { e.x++; },
    (e: FieldEntity) => { e.moveArea!.source.file = "other.bundle"; },
    (e: FieldEntity) => { Object.assign(e.moveArea!.source, { sha256: "0".repeat(64) }); },
    (e: FieldEntity) => { Object.assign(e.moveArea!.source, { serializedFile: "foreign-cab" }); },
    (e: FieldEntity) => { e.moveArea!.entityId = "camera"; },
    (e: FieldEntity) => { e.kind = 6; },
    (e: FieldEntity) => { e.script = "unexpected"; },
  ]) { const e = entity(); mutate(e); assert.throws(() => validateFieldMoveAreas([e])); }
});
test("unsupported geometry, hidden regions and extra source behavior remain specific compiler blockers", () => {
  for (const change of [
    { rotation: 90 }, { visible: false }, { gid: 1 }, { polygon: [{ x: 0, y: 0 }] },
    { x: 0.5 }, { width: 0 }, { height: -1 },
    { properties: [...object().properties, { name: "move_type", type: "int", value: 2 }] },
    { properties: object().properties.filter((p) => p.name !== "object_id") },
  ]) {
    const result = group("bad", [{ ...object(), ...change }]);
    assert.ok(result.blockers.length); assert.equal(result.entities.some((e) => e.moveArea), false);
    assert.equal(result.blockers.some((b) => b.reason === "Unsupported entity kind 13"), false);
  }
});
test("map range must be explicit and source integer arithmetic cannot overflow silently", () => {
  const e = entity();
  assert.throws(() => projectFieldMoveArea(e.moveArea!, undefined as never));
  assert.throws(() => projectFieldMoveArea(e.moveArea!, { ...map, width: 0 }));
  assert.throws(() => projectFieldMoveArea(e.moveArea!, { ...map, x: 0x7fffffff }));
  assert.throws(() => findFieldMoveArea([e], 1.5, map));
});
test("compiler does not alias raw source identity and rejects stringified source integers", () => {
  const input = { group: "plain", entityId: "31", layer: 1, object: object(),
    properties: { object_type: 13, entity_id: 31, object_id: 7 }, source: { ...source, pointer: "/layers/0/objects/0" } };
  const result = compileFieldMoveArea(input); input.source.file = "changed";
  assert.equal(result.source.file, source.file);
  assert.throws(() => compileFieldMoveArea({ ...input, properties: { ...input.properties, entity_id: "31" } }));
});
test("a registered region does not admit an unresolved AreaMove NPC controller", () => {
  const area = object(), npc = { x: 64, y: 96, width: 16, height: 16, gid: 1, rotation: 0, visible: true,
    properties: Object.entries({ entity_id: 32, object_id: 8, object_type: 6, asset_id: 1, move_type: 2,
      link_object_id: 7, action_id: 0 }).map(([name, value]) => ({ name, type: "int", value })) };
  const result = compileEntityGroup("mixed", { data: { layers: [{ name: "GroundObject", objects: [area, npc] }] }, source },
    { "mapobject.csv": [{ id: "1", asset_name: "synthetic-npc", shadow_type: "0" }] });
  assert.ok(result.entities.find((e) => e.kind === 13)?.moveArea);
  assert.ok(result.blockers.some((b) => /movement controller/.test(b.reason)));
});
