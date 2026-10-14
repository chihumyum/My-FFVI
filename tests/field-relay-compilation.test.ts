import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { compileFieldRelay, fieldRelayCompilationBlockers } from "../src/compiler/field-relay.js";
import { bindFieldRelays, fieldRelayGroupBlockers, parseFieldRelayInteractionHost, projectFieldRelayPolicyMapArea,
  FRAMEWORK_RELAY_INTERACTION_LIMITATIONS, type FieldRelayInteractionHost } from "../src/core/field-relay-policy.js";
import type { FieldContent } from "../src/field/types.js";

const source = { file: "synthetic.bundle", assetPath: "Map/entity_default.json",
  objectId: "-9223372036854775807", serializedFile: "CAB-synthetic", sha256: "a".repeat(64) };
const properties = (entityId = 0) => ({ entity_id: entityId, object_id: 7, object_type: 16 });
const object = (entityId = 0, changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 51, name: "RelayInteraction", type: "", gid: 1004, x: 32, y: 80, width: 16, height: 32,
  visible: true, rotation: 0,
  properties: Object.entries(properties(entityId)).map(([name, value]) => ({ name, type: "int", value })), ...changes,
});
const compile = (changes: Partial<Parameters<typeof compileFieldRelay>[0]> = {}) => compileFieldRelay({
  group: "entity_default", entityId: "entity_default:0:0", layer: 2, object: object(),
  properties: properties(), source: { ...source, pointer: "/layers/0/objects/0" }, ...changes,
});
const group = (objects = [object()], layer: Record<string, unknown> = {}) => compileEntityGroup("entity_default", {
  source, data: { layers: [{ name: "UpperObject", objects, ...layer }] },
}, {});
const onlySourceDiagnostics = (g: ReturnType<typeof group>, count: number) => {
  assert.equal(g.blockers.length, count);
  assert(g.blockers.every(b => b.reason === "Unsupported entity kind 16"));
};

test("source kind 16 preserves raw bottom-anchor geometry and all independent source identities", () => {
  const g = group(), e = g.entities[0]!;
  onlySourceDiagnostics(g, 1);
  assert.deepEqual(fieldRelayCompilationBlockers(), ["Unsupported entity kind 16"]);
  assert.deepEqual(e.relay, {
    kind: "source-field-relay-v1", group: "entity_default", entityId: "entity_default:0:0",
    sourceEntityId: 0, objectId: 7, editorObjectId: 51, layer: 2,
    rawGeometry: { x: 32, y: 80, width: 16, height: 32 }, editorGid: 1004,
    horizontalCellLimit: 1, verticalCellLimit: 2, source: { ...source, pointer: "/layers/0/objects/0" },
  });
  assert.deepEqual([e.x, e.y, e.width, e.height], [2, 3, 1, 2]);
  assert.equal(e.asset, null); assert.equal(e.script, null); assert.equal(e.npc, undefined);
  assert.equal(e.nativeNpc, undefined); assert.equal(e.destination, undefined);
  assert.equal("target" in e.relay!, false);
});

test("entity_id is the relay's identity and never another entity's interaction selector", () => {
  const g = group([object(42), object(-1)]);
  onlySourceDiagnostics(g, 2);
  assert.deepEqual(g.entities.map(e => [e.id, e.relay!.sourceEntityId]), [["42", 42], ["-1", -1]]);
  assert.throws(() => compile({ entityId: "some-keeper" }), /identity mismatch/);
  assert.throws(() => compile({ entityId: "41", properties: properties(42) }), /identity mismatch/);
});

test("source layer and row order are retained without sorting or eliminating anonymous rectangles", () => {
  const g = compileEntityGroup("event_group", { source, data: { layers: [
    { name: "CeilObject", objects: [object(9), object(0)] },
    { name: "GroundObject", objects: [object(2), object(0)] },
  ] } }, {});
  onlySourceDiagnostics(g, 4);
  assert.deepEqual(g.entities.map(e => [e.id, e.relay!.layer, e.relay!.source.pointer]), [
    ["9", 3, "/layers/0/objects/0"], ["event_group:0:1", 3, "/layers/0/objects/1"],
    ["2", 1, "/layers/1/objects/0"], ["event_group:1:1", 1, "/layers/1/objects/1"],
  ]);
  const duplicate = group([object(9), object(9)]);
  assert.equal(duplicate.entities.length, 2);
  assert(duplicate.blockers.some(b => b.reason === "Duplicate entity identity 9"));
});

test("integer pixel bounds retain signed positions and truncated non-cell sizes without map placement guesses", () => {
  const d = compile({ object: object(0, { x: -15, y: 41, width: 31, height: 15 }) });
  assert.deepEqual(d.rawGeometry, { x: -15, y: 41, width: 31, height: 15 });
  assert.deepEqual([d.horizontalCellLimit, d.verticalCellLimit], [1, 0]);
  assert.equal("worldPosition" in d, false); assert.equal("parentContext" in d, false);
  for (const geometry of [{ x: 0.5 }, { height: 16.5 }, { width: 0 }, { height: -1 }, { width: 0x80000000 }])
    assert.throws(() => compile({ object: object(0, geometry) }));
});

test("unknown relay properties, transformed geometry and editor bindings retain specific blockers", () => {
  for (const changes of [
    { rotation: 90 }, { visible: false }, { gid: 0 }, { gid: 0x100003ec },
    { polygon: [{ x: 0, y: 0 }] }, { point: true }, { type: "custom" }, { template: "custom.tx" },
  ]) {
    const g = group([object(0, changes)]);
    assert.equal(g.entities.length, 1);
    assert.equal(g.entities[0]!.relay, undefined);
    assert(g.blockers.length > 0);
  }
  for (const extra of [{ target_entity_id: 42 }, { asset_id: 0 }, { script_id: 0 }, { action_id: 0 }]) {
    const g = group([object(0, { properties: Object.entries({ ...properties(), ...extra })
      .map(([name, value]) => ({ name, type: "int", value })) })]);
    assert.equal(g.entities[0]!.relay, undefined);
    assert(g.blockers.some(b => b.reason === "Unresolved field relay properties"));
  }
  for (const layer of [-1, 4, 0.5]) assert.throws(() => compile({ layer }), /layer/);
  const transformed = group([object()], { offsetx: 16 });
  assert(transformed.blockers.some(b => b.reason === "Unsupported entity layer transform"));
});

test("missing or lossy source provenance cannot compile and outputs detach from source metadata", () => {
  for (const patch of [{ objectId: 9223372036854776000 }, { objectId: "1e18" }, { pointer: "/objects/0" },
    { serializedFile: "" }, { sha256: "abc" }, { unknownIdentity: "value" }])
    assert.throws(() => compile({ source: { ...source, pointer: "/layers/0/objects/0", ...patch } as never }));
  for (const key of ["objectId", "pointer", "sha256", "serializedFile"]) {
    const incomplete: Record<string, unknown> = { ...source, pointer: "/layers/0/objects/0" };
    delete incomplete[key];
    assert.throws(() => compile({ source: incomplete as never }));
  }
  const original = { ...source, pointer: "/layers/0/objects/0" }, d = compile({ source: original });
  original.file = "changed.bundle";
  assert.equal(d.source.file, "synthetic.bundle"); assert.equal(d.source.objectId, source.objectId);
});

test("relay admission does not reinterpret other source kinds by editor gid or object label", () => {
  const unsupported = group([object(0, { properties: Object.entries({ ...properties(), object_type: 9 })
    .map(([name, value]) => ({ name, type: "int", value })) })]);
  assert.equal(unsupported.entities[0]!.relay, undefined);
  assert(unsupported.blockers.some(b => b.reason === "Unsupported entity kind 9"));
});

function hostFixture(objects = [object()]): { host: FieldRelayInteractionHost; content: FieldContent } {
  const g = group(objects), mapSource = { ...source, assetPath: "Map/tilemap.json", objectId: "9223372036854775806" },
    mapRange = { x: 0, y: 0, width: 5, height: 5 }, loop = { horizontal: false, vertical: false },
    host: FieldRelayInteractionHost = {
      kind: "framework-relay-interaction-host-v1", policy: "framework-relay-interaction-v1", sourceMapHash: "b".repeat(64),
      mapId: 12, sourceSetHash: "c".repeat(64), parentSourceSetHash: "d".repeat(64), sourceMapRef: mapSource,
      mapRange, loop, coordinateHost: "ordinary-field-native-positions-v1",
      scope: "walking-stationary-same-layer-known-wait-v1", nativeRulesVerified: false,
      parentContext: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      bindings: g.entities.map(e => structuredClone(e.relay!)), limitations: [...FRAMEWORK_RELAY_INTERACTION_LIMITATIONS],
    };
  const content: FieldContent = {
    formatVersion: 1, kind: "field-development", sourceSetHash: host.sourceSetHash, parentSourceSetHash: host.parentSourceSetHash,
    contentHash: "e".repeat(64), map: { id: "synthetic", identity: { mapId: 12, areaId: 1 }, width: 5, height: 5,
      tileSize: 16, layers: [], tilesets: [], textures: {}, collisions: { 2: Array(25).fill(0) },
      groups: { entity_default: g }, initialGroups: ["entity_default"], entities: g.entities, source: structuredClone(mapSource) },
    characters: {}, scripts: {}, entry: { player: { x: 0, y: 0, layer: 2, direction: "up", asset: "hero", mount: "" },
      description: "Synthetic pure Relay binding", evidence: [source] }, limitations: [],
    cameraHost: { kind: "source-field-camera-host-v1", mapRange: structuredClone(mapRange), loop: structuredClone(loop),
      playerVisualOffset: { x: 0, y: 0 }, callbacks: "fresh-normal-field-v1", sources: [] },
    developmentProfile: { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
      sourceContentHash: host.sourceMapHash, omissions: [], fieldPresentation: "framework-ordinary-field-flat-v1", relayInteraction: host.policy },
    frameworkRelayInteraction: host,
  };
  return { host, content };
}

test("only an explicit trusted Web host binds source relays; flat presentation and final hashes cannot grant it", () => {
  const { host, content } = hostFixture(), result = bindFieldRelays(content);
  assert.equal(result.size, 1); assert.equal(result.get("entity_default:0:0")!.source.objectId, source.objectId);
  result.get("entity_default:0:0")!.rawGeometry.width = 999;
  assert.equal(host.bindings[0]!.rawGeometry.width, 16); assert.equal(content.map.entities[0]!.relay!.rawGeometry.width, 16);
  delete content.frameworkRelayInteraction;
  assert.equal(bindFieldRelays(content).size, 0);
  content.frameworkRelayInteraction = host; delete content.developmentProfile!.relayInteraction;
  assert.throws(() => bindFieldRelays(content), /Unbound/);
  content.developmentProfile!.relayInteraction = host.policy;
  content.developmentProfile!.sourceContentHash = content.contentHash;
  assert.throws(() => bindFieldRelays(content), /Unbound/);
});

test("raw map, baseline, source fingerprint and actual geometry must all match the declared content host", () => {
  for (const mutate of [
    (c: FieldContent) => { c.map.identity!.mapId++; },
    (c: FieldContent) => { c.sourceSetHash = "f".repeat(64); },
    (c: FieldContent) => { c.parentSourceSetHash = "f".repeat(64); },
    (c: FieldContent) => { c.map.source.objectId = "9223372036854775807"; },
    (c: FieldContent) => { Object.assign(c.map.source, { sha256: "f".repeat(64) }); },
    (c: FieldContent) => { c.cameraHost!.mapRange.x++; },
    (c: FieldContent) => { c.cameraHost!.loop.horizontal = true; },
    (c: FieldContent) => { c.map.entities[0]!.x++; },
    (c: FieldContent) => { const e = c.map.entities[0]!; e.objectId = e.objectId! + 1; },
    (c: FieldContent) => { delete c.map.entities[0]!.relay; },
    (c: FieldContent) => { c.map.entities[0]!.script = "foreign"; },
    (c: FieldContent) => { c.map.entities[0]!.source.pointer = "/layers/0/objects/1"; },
  ]) { const { content } = hostFixture(); mutate(content); assert.throws(() => bindFieldRelays(content)); }
});

test("only exact bound source kind16 diagnostics are projected away and original arrays stay intact", () => {
  const { host, content } = hostFixture([object(), object(2)]), g = content.map.groups!.entity_default!;
  host.bindings.splice(1);
  g.blockers.push({ reason: "Unsupported entity transform", source: { ...g.entities[0]!.source } });
  const before = structuredClone(g), projected = fieldRelayGroupBlockers(g, host);
  assert.equal(projected.length, 2);
  assert.equal(projected[0]!.reason, "Unsupported entity kind 16");
  assert.equal(projected[0]!.source.pointer, "/layers/0/objects/1");
  assert.equal(projected[1]!.reason, "Unsupported entity transform");
  assert.deepEqual(g, before);
  assert.deepEqual(fieldRelayGroupBlockers(g), g.blockers);
  host.bindings[0]!.source.sha256 = "f".repeat(64);
  assert.equal(fieldRelayGroupBlockers(g, host).length, 3);
});

test("policy rejects unknown or transformed parents, altered scope, unverifiable sources and duplicate bindings", () => {
  for (const mutate of [
    (h: FieldRelayInteractionHost) => { Object.assign(h.parentContext, { translation: { x: 1, y: 0, z: 0 } }); },
    (h: FieldRelayInteractionHost) => { Object.assign(h.parentContext, { scale: { x: 1, y: 1, z: 2 } }); },
    (h: FieldRelayInteractionHost) => { delete (h as Partial<FieldRelayInteractionHost>).parentContext; },
    (h: FieldRelayInteractionHost) => { Object.assign(h, { nativeRulesVerified: true }); },
    (h: FieldRelayInteractionHost) => { Object.assign(h, { scope: "all-npc-any-transport" }); },
    (h: FieldRelayInteractionHost) => { Object.assign(h, { sourceMapContentHash: "e".repeat(64) }); },
    (h: FieldRelayInteractionHost) => { Object.assign(h.loop, { horizontal: 0 }); },
    (h: FieldRelayInteractionHost) => { Object.assign(h.sourceMapRef, { objectId: 9223372036854776000 }); },
    (h: FieldRelayInteractionHost) => { h.sourceMapRef.objectId = "1e18"; },
    (h: FieldRelayInteractionHost) => { h.bindings[0]!.horizontalCellLimit++; },
    (h: FieldRelayInteractionHost) => { h.bindings.push(structuredClone(h.bindings[0]!)); },
    (h: FieldRelayInteractionHost) => { h.limitations.length = 0; },
  ]) { const { host } = hostFixture(); mutate(host); assert.throws(() => parseFieldRelayInteractionHost(host)); }
  const { host } = hostFixture(), parsed = parseFieldRelayInteractionHost(host);
  parsed.mapRange.x = 99; parsed.bindings[0]!.source.file = "foreign";
  assert.equal(host.mapRange.x, 0); assert.equal(host.bindings[0]!.source.file, "synthetic.bundle");
  const getters = { ...host };
  Object.defineProperty(getters, "nativeRulesVerified", { enumerable: true, get() { throw new Error("must not read accessor"); } });
  assert.throws(() => parseFieldRelayInteractionHost(getters), /fields/);
});

test("MapArea derives each loop extent from the source crop rather than complete map size or origin", () => {
  const { host } = hostFixture(); host.mapRange = { x: 44, y: 0, width: 18, height: 22 };
  assert.deepEqual(projectFieldRelayPolicyMapArea(host), { xMin: 0, yMin: 0, width: 0, height: 0 });
  host.loop.horizontal = true;
  assert.deepEqual(projectFieldRelayPolicyMapArea(host), { xMin: -144, yMin: 0, width: 288, height: 0 });
  host.loop.vertical = true;
  assert.deepEqual(projectFieldRelayPolicyMapArea(host), { xMin: -144, yMin: 176, width: 288, height: 352 });
});
