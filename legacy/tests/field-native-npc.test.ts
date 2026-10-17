import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldNativeNpc, compileFieldNativeNpcStandby } from "../src/compiler/field-native-npc.js";
import { FIELD_NATIVE_NPC_STANDBY_SOURCES, fieldNativeNpcPosition, fieldNativeNpcRetirement,
  fieldNativeNpcSelectorBinding, fieldNativeNpcStandbyPosition, prepareFieldNativeNpcGroup,
  type FieldNativeNpcDefinition } from "../src/core/field-native-npc.js";
import { createNativeFieldActorProjection } from "../src/core/field-native-actors.js";
import { compileFieldActorView } from "../src/compiler/field-actor-view.js";
import { compileFieldNativeComposition } from "../src/compiler/field-native-composition.js";
import { projectFieldActorView } from "../src/core/field-actor-view.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function fixture() {
  const f = fieldActorFactoryFixture(), asset = Object.keys(f.characters)[0]!;
  const input = { group: "event", object: { x: 48, y: 80, width: 16, height: 16, rotation: 0, visible: true },
    entity: { id: "71", kind: 6, layer: 1, source: { file: "synthetic.bundle", assetPath: "Map/event.json",
      objectId: "9223372036854775806", pointer: "/layers/0/objects/0" } },
    properties: { object_type: 6, entity_id: 71, asset_id: 11, direction: 1, move_type: 0, move_while_display_message: false },
    tables: { "mapobject.csv": [{ id: "11", asset_name: asset, shadow_type: "1", shadow_name: "None" }] } };
  const result = compileFieldNativeNpc(input); assert.deepEqual(result.blockers, []); assert.ok(result.definition);
  const definition = result.definition, prepare = { definitions: [definition], factory: f.factory, characters: f.characters,
    mapRange: f.map.mapRange, providers: f.input.providers, existingActorIds: ["-1001"], standbyAnchorPosition: { x: 30000, y: 30000 } };
  return { ...f, input, definition, prepare, asset };
}

test("kind 6 and 17 bind mapobject identity, raw geometry and independent message-update attribute", () => {
  const f = fixture();
  for (const kind of [6, 17]) {
    const result = compileFieldNativeNpc({ ...f.input, entity: { ...f.input.entity, kind },
      properties: { ...f.input.properties, object_type: kind, move_while_display_message: true } });
    assert.deepEqual(result.blockers, []); assert.ok(result.definition);
    assert.equal(result.definition.objectType, kind); assert.equal(result.definition.updateAttribute, 10);
    assert.equal(result.definition.asset.id, 11); assert.equal(result.definition.asset.asset, f.asset);
    assert.equal(result.definition.asset.animationAsset, f.asset.toUpperCase());
    assert.equal(result.definition.source.objectId, "9223372036854775806");
    assert.deepEqual(result.definition.geometry, { x: 48, y: 80, width: 16, height: 16, layer: 1 });
  }
});
test("missing or zero source direction follows native fallback down, without inventing a diagonal", () => {
  const f = fixture(), p = { ...f.input.properties }; delete (p as Partial<typeof p>).direction;
  const r = compileFieldNativeNpc({ ...f.input, properties: p });
  assert.equal(r.definition!.sourceDirection, 0); assert.equal(r.definition!.direction, "down");
  const bad = compileFieldNativeNpc({ ...f.input, properties: { ...p, direction: 3 } });
  assert.equal(bad.definition, null); assert.match(bad.blockers.join(), /diagonal/);
});
test("anonymous source NPCs retain pointer identities without taking the camera's zero selector", () => {
  const f = fixture(), entity = { ...f.input.entity, id: "event:0:0" };
  const r = compileFieldNativeNpc({ ...f.input, entity, properties: { ...f.input.properties, entity_id: 0 } });
  assert.deepEqual(r.blockers, []); assert.ok(r.definition);
  const definition = r.definition;
  assert.equal(definition.sourceEntityId, 0); assert.equal(fieldNativeNpcSelectorBinding(definition), null);
  const candidate = prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [definition] });
  assert.equal(candidate.actors[0]!.entity.id, "event:0:0");
  assert.deepEqual(fieldNativeNpcSelectorBinding(f.definition), { entityId: 71, actor: "71" });
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [
    { ...definition, entityId: "event:0:1" },
  ] }), /identity/);
});
test("source selector mismatch, missing provenance and negative aliases fail before candidate publication", () => {
  const f = fixture();
  const noPointer = { ...f.definition.source }; delete noPointer.pointer;
  for (const definition of [
    { ...f.definition, entityId: "native:foreign" },
    { ...f.definition, sourceEntityId: 0, entityId: "event:0:0", source: noPointer },
    { ...f.definition, sourceEntityId: -1, entityId: "-1" },
  ]) assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [definition] }));
  const negative = compileFieldNativeNpc({ ...f.input, entity: { ...f.input.entity, id: "-1" },
    properties: { ...f.input.properties, entity_id: -1 } });
  assert.equal(negative.definition, null); assert.match(negative.blockers.join(), /negative entity selector/);
});
test("map origin is subtracted before pixel-to-native conversion and uses raw Tiled bottom anchor", () => {
  const f = fixture(), map = { x: 2, y: 1, width: 20, height: 16 };
  assert.deepEqual(fieldNativeNpcPosition(f.definition, map), { x: -136, y: 72, z: 249 });
  const a = prepareFieldNativeNpcGroup({ ...f.prepare, mapRange: map }).actors[0]!;
  const projected = createNativeFieldActorProjection(a, map, f.partyCatalog);
  assert.equal(projected.x, 3); assert.equal(projected.y, 4); assert.equal(projected.layer, 1);
  assert.equal(projected.native.charaZOffset, 0);
});
test("standby bounds preserve inclusive bottom and exclusive right edge, keeping source layer depth", () => {
  const f = fixture(), map = f.map.mapRange;
  const positioned = (x: number, y: number) => ({ ...f.definition, geometry: { ...f.definition.geometry, x, y } });
  for (const [x, y] of [[-1, 16], [map.width * 16, 16], [0, 0], [0, map.height * 16 + 1]]) {
    assert.throws(() => fieldNativeNpcPosition(positioned(x!, y!), map), /standby/);
    assert.deepEqual(fieldNativeNpcPosition(positioned(x!, y!), map, { x: 30000, y: 30000 }), { x: 30000, y: 30000, z: 249 });
  }
  assert.deepEqual(fieldNativeNpcPosition(positioned(0, map.height * 16), map), { x: -152, y: -120, z: 249 });
});
test("source standby binding verifies the real scene and is distinct from persistent resident factory pose", () => {
  const f = fixture(), binding = compileFieldNativeNpcStandby(FIELD_NATIVE_NPC_STANDBY_SOURCES);
  assert.deepEqual(fieldNativeNpcStandbyPosition(binding), { x: 30000, y: 30000 });
  assert.equal(f.factory.offMapPosition.y, 1000);
  const foreign = structuredClone(binding); foreign.sources[1]!.sha256 = "0".repeat(64);
  assert.throws(() => fieldNativeNpcStandbyPosition(foreign), /Foreign/);
  assert.throws(() => compileFieldNativeNpcStandby(f.sources), /Unreviewed/);
  assert.throws(() => fieldNativeNpcStandbyPosition({ ...binding, position: { x: 30000, y: 1000 } } as never), /Unbound/);
});
test("activation selects a stopped source pose and preserves source domain in the one live projection", () => {
  const f = fixture(), metadata = prepareFieldNativeNpcGroup(f.prepare).actors[0]!;
  assert.equal(metadata.fieldAssetId, null); assert.equal(metadata.mapObjectAsset!.id, 11);
  assert.equal(metadata.entity.animation!.snapshot()!.key, "WalkB"); assert.equal(metadata.entity.animation!.playing, false);
  assert.equal(metadata.entity.visible, true); assert.equal(metadata.entity.fadeAlpha, 1); assert.equal(metadata.updateAttribute, 2);
  assert.deepEqual(metadata.scope, { kind: "map-npc", group: "event", entityId: "71", source: f.definition.source });
  const actor = createNativeFieldActorProjection(metadata, f.map.mapRange, f.partyCatalog);
  actor.x = 9; actor.y = 8; actor.animation!.play("wave", true, 1);
  assert.equal(actor.native.entity.animation, actor.animation); assert.equal(actor.asset, f.asset);
  assert.notDeepEqual(actor.native.entity.position, metadata.entity.position);
  assert.equal(metadata.entity.animation!.playing, false);
});
test("candidate preparation is atomic for missing media or an unknown pose on a later NPC", () => {
  const f = fixture(), before = JSON.stringify(f.definition), media = structuredClone(f.characters);
  const second = structuredClone(f.definition); second.entityId = "72"; second.sourceEntityId = 72;
  second.asset.asset = "missing"; second.asset.animationAsset = "MISSING";
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [f.definition, second] }), /Missing native NPC/);
  assert.equal(JSON.stringify(f.definition), before); assert.deepEqual(f.characters, media);
  const broken = structuredClone(f.characters); delete broken[f.asset]!.animations.WalkB;
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, characters: broken }), /Missing actor animation/);
});
test("Wait controller turn-around performs its second stopped look and preserves authored next-pose selection", () => {
  const f = fixture(), characters = structuredClone(f.characters), first = characters[f.asset]!.animations.WalkB!;
  first.next = "WalkB-S";
  characters[f.asset]!.animations["WalkB-S"] = { ...first, next: "WalkB" };
  const definition = compileFieldNativeNpc({ ...f.input,
    properties: { ...f.input.properties, turn_around: true } }).definition!;
  assert.equal(definition.turnAround, true);
  const turning = prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [definition], characters }).actors[0]!;
  assert.equal(turning.entity.animation!.snapshot()!.key, "WalkB-S");
  assert.equal(turning.entity.animation!.playing, false);
  const fixed = prepareFieldNativeNpcGroup({ ...f.prepare, characters }).actors[0]!;
  assert.equal(fixed.entity.animation!.snapshot()!.key, "WalkB");
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [{ ...definition, turnAround: undefined } as never] }), /Unbound/);
});
test("first activation rejects existing ids, duplicate candidate ids and mixed groups", () => {
  const f = fixture();
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, existingActorIds: ["71"] }), /already exists/);
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [f.definition, f.definition] }), /already exists/);
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, definitions: [f.definition,
    { ...f.definition, entityId: "72", sourceEntityId: 72, group: "other" }] }), /mixes entity groups/);
});
test("material and transparent textures require explicit providers without silently declaring ordinary rendering", () => {
  const f = fixture();
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, providers: { ...f.prepare.providers,
    applyViewProperties: () => null } }), /material projection/);
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, providers: { ...f.prepare.providers,
    upperTexture: "unknown" } }), /texture|Texture/);
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, providers: { ...f.prepare.providers,
    upperTexture: "upper", ceilTexture: "ceil" } }), /composition/);
});
test("new NPC non-null render targets require a matching compiled clear compositor", () => {
  const f = fixture(), prefix = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/";
  f.sources.push({ file: prefix + "map_common_assets_all_320e510e7137e96ac91fe79e18fdd504.bundle",
    sha256: "c46413a1c208556af2ce202aab276e6ecefc54863229bbb77af38bb0f766233a" },
  { file: prefix + "shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle",
    sha256: "56bebde18b58f95d3e4f9cd23e7e2c13e83892075606f1a85b5c92ac81ce1c6e" });
  f.tilemap.data.layers[0]!.layers.push(...["UpperLayer", "CeilLayer"].map((name) => ({ type: "tilelayer", name,
    width: 20, height: 16, data: Array(320).fill(0) })));
  const view = compileFieldActorView(f.sources, f.tilemap, f.mapPackage, f.map.mapRange);
  const composition = compileFieldNativeComposition(f.sources, view, f.tilemap);
  const providers = { ...f.prepare.providers, mapRenderContext: view.contextId, composition,
    upperTexture: composition.upperTexture, ceilTexture: composition.ceilTexture,
    applyViewProperties: (layer: number) => projectFieldActorView(view, layer) };
  const transparent = prepareFieldNativeNpcGroup({ ...f.prepare, providers }).actors[0]!;
  assert.deepEqual(transparent.entity.transparentTextures, { first: composition.ceilTexture, second: null });
  const unresolved = structuredClone(composition); unresolved.renderTargets.ceil = "unresolved";
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, providers: { ...providers, composition: unresolved } }), /unresolved/);
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, providers: { ...providers, ceilTexture: "foreign" } }), /identity/);
});
test("unknown autonomous, minimap, stencil, cross-layer and custom shadow paths stay blockers", () => {
  const f = fixture();
  for (const p of [{ move_type: 1 }, { visible_minimap: true }, { affected: true }, { all_layers: true }, { birdview_puppet: true }]) {
    const r = compileFieldNativeNpc({ ...f.input, properties: { ...f.input.properties, ...p } });
    assert.equal(r.definition, null); assert.ok(r.blockers.length);
  }
  const r = compileFieldNativeNpc({ ...f.input, tables: { "mapobject.csv": [{ ...f.input.tables["mapobject.csv"][0], shadow_type: "2" }] } });
  assert.equal(r.definition, null); assert.match(r.blockers.join(), /custom shadow/);
});
test("master ambiguity, source shape and unbound factory never become a partial actor group", () => {
  const f = fixture();
  assert.match(compileFieldNativeNpc({ ...f.input, tables: { "mapobject.csv": [] } }).blockers.join(), /Ambiguous/);
  assert.match(compileFieldNativeNpc({ ...f.input, tables: { "mapobject.csv": [...f.input.tables["mapobject.csv"], ...f.input.tables["mapobject.csv"]] } }).blockers.join(), /Ambiguous/);
  assert.match(compileFieldNativeNpc({ ...f.input, object: { ...f.input.object, width: 32 } }).blockers.join(), /non-cell/);
  assert.throws(() => prepareFieldNativeNpcGroup({ ...f.prepare, factory: { ...f.factory, npcPrefab: { ...f.factory.npcPrefab, layer: 8 } } as never }), /prefab/);
});
test("map retirement selects only map NPC identities and leaves retained actors and animations unchanged", () => {
  const f = fixture(), local = prepareFieldNativeNpcGroup(f.prepare).actors[0]!;
  const retained = { entity: { ...local.entity, id: "resident:1" }, fieldAssetId: 11, charaZOffset: 0.5 };
  local.entity.animation!.play("wave", true, 1); local.entity.animation!.advance(120);
  const before = local.entity.animation!.snapshot();
  assert.deepEqual(fieldNativeNpcRetirement([retained, local]), ["71"]);
  assert.deepEqual(local.entity.animation!.snapshot(), before);
  assert.throws(() => fieldNativeNpcRetirement([local, local]), /Ambiguous/);
  assert.throws(() => fieldNativeNpcRetirement([{ ...local, scope: { ...local.scope!, entityId: "foreign" } }]), /scope/);
});
