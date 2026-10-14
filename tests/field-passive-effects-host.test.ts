import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { bindPassiveEffects, passiveEffectsGroupBlockers, parseFieldPassiveEffectsHost,
  PASSIVE_FIELD_EFFECTS_LIMITATIONS, type FieldPassiveEffectsHost } from "../src/core/field-passive-effects-host.js";
import type { EntityGroup, FieldContent } from "../src/field/types.js";

const source = { file: "synthetic.bundle", assetPath: "Map/entity_default.json", objectId: "-9223372036854775807",
  serializedFile: "CAB-synthetic", sha256: "a".repeat(64) };
const values = { action_id: 0, affected: true, asset_id: 269, birdview_puppet: false, blend_type: 0, collision: false,
  direction: 0, entity_id: 0, flight_altitude_ratio: 1, front: true, ignore_depth_test: false, link_object_id: 0,
  object_id: 0, object_type: 11, play_on_awake: true, script_id: 0, split: true, visible_minimap: true, zoffset: -1 };
function fixture(): { host: FieldPassiveEffectsHost; content: FieldContent & {
  frameworkPassiveEffects?: FieldPassiveEffectsHost;
  developmentProfile: NonNullable<FieldContent["developmentProfile"]> & { passiveEffects?: string };
}; group: EntityGroup } {
  const rawSource = { id: 10, name: "EffectEntity_fire", type: "", gid: 1008, x: 160, y: 178, width: 16, height: 16,
    rotation: 0, visible: true, properties: Object.entries(values).map(([name, value]) => ({ name,
      type: name === "flight_altitude_ratio" ? "float" : typeof value === "boolean" ? "bool" : "int", value })) },
    group = compileEntityGroup("entity_default", { source, data: { layers: [{ name: "GroundObject", objects: [rawSource] }] } },
      { "mapobject.csv": [{ id: "269", asset_name: "synthetic_fire" }] }),
    mapSource = { ...source, assetPath: "Map/tilemap.json", objectId: "9223372036854775806" },
    host: FieldPassiveEffectsHost = { kind: "framework-passive-field-effects-host-v1", policy: "framework-passive-field-effects-v1",
      deferral: "omit-particle-render-and-effect-minimap-v1", sourceMapHash: "b".repeat(64), sourceSetHash: "c".repeat(64),
      parentSourceSetHash: "d".repeat(64), mapId: 59, sourceMapRef: mapSource,
      bindings: [{ group: "entity_default", entity: structuredClone(group.entities[0]!), rawSource: structuredClone(rawSource) }],
      limitations: [...PASSIVE_FIELD_EFFECTS_LIMITATIONS], nativeRulesVerified: false },
    content = { formatVersion: 1, kind: "field-development", sourceSetHash: host.sourceSetHash, parentSourceSetHash: host.parentSourceSetHash,
      contentHash: "e".repeat(64), map: { id: "synthetic", identity: { mapId: 59, areaId: 1 }, width: 24, height: 24, tileSize: 16,
        layers: [], tilesets: [], textures: {}, collisions: { 1: Array(576).fill(0) }, source: structuredClone(mapSource),
        entities: group.entities, groups: { entity_default: group }, initialGroups: ["entity_default"] },
      characters: {}, scripts: {}, entry: { player: { x: 0, y: 0, layer: 1, direction: "down", asset: "hero", mount: "" },
        description: "Pure passive-display binding fixture", evidence: [source] }, limitations: [],
      developmentProfile: { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
        sourceContentHash: host.sourceMapHash, omissions: [], passiveEffects: host.policy }, frameworkPassiveEffects: host,
    } as ReturnType<typeof fixture>["content"];
  return { host, content, group };
}
function property(host: FieldPassiveEffectsHost, name: string, value: unknown): void {
  const p = host.bindings[0]!.rawSource.properties as { name: string; type: string; value: unknown }[];
  p.find(p => p.name === name)!.value = value;
}

test("declared passive display leaves source entities, raw parameters and both diagnostics intact", () => {
  const { host, content, group } = fixture(), before = structuredClone(content), result = bindPassiveEffects(content);
  assert.deepEqual([...result], ["entity_default:0:0"]);
  assert.equal(result.has("0"), false);
  assert.equal(host.bindings[0]!.entity.effect!.pixelPosition.y, 178);
  assert.equal(host.bindings[0]!.entity.y, 10.125);
  assert.deepEqual(group.blockers.map(b => b.reason), ["Field effect minimap provider is unavailable",
    "Field effect particle provider unavailable: synthetic_fire (serialized particle/material admission required)"]);
  assert.deepEqual(passiveEffectsGroupBlockers(group, host), []);
  assert.deepEqual(content, before);
  result.clear(); assert.equal(bindPassiveEffects(content).size, 1);
});

test("a passive omission needs a trusted profile and underived baseline, and never comes from save or display data", () => {
  const { host, content } = fixture();
  delete content.frameworkPassiveEffects;
  assert.equal(bindPassiveEffects(content).size, 0);
  content.frameworkPassiveEffects = host; delete content.developmentProfile.passiveEffects;
  assert.throws(() => bindPassiveEffects(content), /Unbound/);
  content.developmentProfile.passiveEffects = host.policy;
  content.developmentProfile.sourceContentHash = content.contentHash;
  assert.throws(() => bindPassiveEffects(content), /Unbound/);
  assert.deepEqual(passiveEffectsGroupBlockers(content.map.groups!.entity_default!), content.map.groups!.entity_default!.blockers);
});

test("nonanonymous identities, behavior, physical effects and unknown property fields cannot be deferred", () => {
  for (const mutate of [
    (h: FieldPassiveEffectsHost) => { property(h, "entity_id", 7); },
    (h: FieldPassiveEffectsHost) => { property(h, "object_id", 1); },
    (h: FieldPassiveEffectsHost) => { property(h, "script_id", 123); },
    (h: FieldPassiveEffectsHost) => { property(h, "action_id", 6); },
    (h: FieldPassiveEffectsHost) => { property(h, "link_object_id", 9); },
    (h: FieldPassiveEffectsHost) => { property(h, "flight_altitude_ratio", .5); },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.id = "0"; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.group = "event_group"; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.script = "source-script"; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.collision = 1; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.asset = "actor"; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.effect!.collision = true; property(h, "collision", true); },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.effect!.building = true; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.effect!.screen = true; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.effect!.birdviewPuppet = true; },
    (h: FieldPassiveEffectsHost) => { Object.assign(h.bindings[0]!.entity, { destination: { mapId: 1, entrance: 1 } }); },
    (h: FieldPassiveEffectsHost) => { Object.assign(h.bindings[0]!.entity.effect!, { callback: "unknown" }); },
    (h: FieldPassiveEffectsHost) => { (h.bindings[0]!.rawSource.properties as unknown[]).push({ name: "gimmick", type: "bool", value: false }); },
  ]) { const { host } = fixture(); mutate(host); assert.throws(() => parseFieldPassiveEffectsHost(host)); }
});

test("source raw geometry, compiler definition and copied entity must agree before any diagnostic projection", () => {
  for (const mutate of [
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.rawSource.x = 161; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.rawSource.width = 16.5; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.rawSource.gid = 0x100003f0; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.rawSource.visible = false; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.rawSource.rotation = 90; },
    (h: FieldPassiveEffectsHost) => { Object.assign(h.bindings[0]!.rawSource, { ellipse: true }); },
    (h: FieldPassiveEffectsHost) => { property(h, "asset_id", 270); },
    (h: FieldPassiveEffectsHost) => { property(h, "split", false); },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.effect!.zOffset = -1; },
    (h: FieldPassiveEffectsHost) => { h.bindings[0]!.entity.effect!.source.pointer = "/layers/0/objects/1"; },
  ]) { const { host } = fixture(); mutate(host); assert.throws(() => parseFieldPassiveEffectsHost(host)); }
  const { host, content } = fixture(); content.map.entities[0]!.effect!.front = false;
  assert.throws(() => bindPassiveEffects(content), /source entity/);
});

test("raw map, source-set and exact effect provenance stay bound independently of derived package hashes", () => {
  for (const mutate of [
    (c: ReturnType<typeof fixture>["content"]) => { c.map.identity!.mapId++; },
    (c: ReturnType<typeof fixture>["content"]) => { c.sourceSetHash = "f".repeat(64); },
    (c: ReturnType<typeof fixture>["content"]) => { c.parentSourceSetHash = "f".repeat(64); },
    (c: ReturnType<typeof fixture>["content"]) => { c.map.source.objectId = "9223372036854775807"; },
    (c: ReturnType<typeof fixture>["content"]) => { Object.assign(c.map.source, { sha256: "f".repeat(64) }); },
    (c: ReturnType<typeof fixture>["content"]) => { c.map.entities[0]!.source.pointer = "/layers/0/objects/1"; },
  ]) { const { content } = fixture(); mutate(content); assert.throws(() => bindPassiveEffects(content)); }
  const { host } = fixture(); Object.assign(host.sourceMapRef, { objectId: 9223372036854776000 });
  assert.throws(() => parseFieldPassiveEffectsHost(host), /identity/);
});

test("only the matched particle-render and effect-minimap failures are deferred; all other gates remain", () => {
  const { host, group } = fixture(), original = structuredClone(group);
  group.blockers.push({ reason: "Field effect collider host is unavailable", source: { ...group.entities[0]!.source } },
    { reason: "Field effect particle provider unavailable: another_group (serialized particle/material admission required)", source: { ...group.entities[0]!.source } },
    { reason: "Field effect particle provider unavailable: synthetic_fire: Unknown behavior component", source: { ...group.entities[0]!.source } },
    { reason: "Field effect minimap provider is unavailable", source: { ...group.entities[0]!.source, pointer: "/layers/0/objects/1" } });
  const projected = passiveEffectsGroupBlockers(group, host);
  assert.equal(projected.length, 4); assert.equal(group.blockers.length, 6);
  assert.deepEqual(group.entities, original.entities);
  host.bindings[0]!.entity.effect!.visibleMinimap = false; property(host, "visible_minimap", false);
  assert.equal(passiveEffectsGroupBlockers(group, host).length, 6, "A changed entity cannot authorize either deferral");
});

test("parsing returns detached immutable declaration data and rejects duplicate bindings or asserted native acceptance", () => {
  const { host } = fixture(), parsed = parseFieldPassiveEffectsHost(host);
  parsed.bindings[0]!.entity.effect!.pixelPosition.y = 0;
  assert.equal(host.bindings[0]!.entity.effect!.pixelPosition.y, 178);
  host.bindings.push(structuredClone(host.bindings[0]!));
  assert.throws(() => parseFieldPassiveEffectsHost(host), /Duplicate/);
  host.bindings.pop(); Object.assign(host, { nativeRulesVerified: true });
  assert.throws(() => parseFieldPassiveEffectsHost(host), /declaration/);
});
