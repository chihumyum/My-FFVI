import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/compiler/content.js";
import { deriveSourceAreaScope, parseSourceAreaScope, validateSourceAreaScope,
  type SourceAreaScope, type SourceAreaScopeInput } from "../src/compiler/source-area-scope.js";
import type { FieldEntity, Op } from "../src/field/types.js";
import type { WorldCatalog, WorldMapContent } from "../src/field/world.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const source = { file: "controlled-area.bundle", assetPath: "Controlled/entity.json",
  objectId: "9007199254740993", pointer: "/layers/0/objects/0" };
function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _, ...body } = value;
  return { ...body, contentHash: hash(body) } as T;
}
function fixture() {
  const f = checkpointFixture();
  const scope: SourceAreaScope = { kind: "source-area-scope-v1", areaId: 8 };
  const point: FieldEntity = { id: "point", kind: 0, objectId: 1, x: 7, y: 12, layer: 2,
    width: 1, height: 1, direction: "left", asset: null, script: null, collision: null,
    destinationLayer: null, source };
  const issue = { reason: "Controlled unresolved source dependency", source };
  const op = (value: Record<string, unknown>, index: number): Op =>
    ({ script: "event", index, source: { ...source, assetPath: "Controlled/event.json", pointer: "/Mnemonics/" + index }, ...value }) as Op;
  const request = { mapId: 12, entrance: 5, continuation: "later", birdview: true,
    skipFade: false, skipBgm: true, origin: "script" as const };
  const map = structuredClone(f.target);
  map.mapId = 10; map.areaId = 8; map.name = "ControlledVariantA";
  map.sourceSetHash = "a".repeat(64); map.parentSourceSetHash = "b".repeat(64); map.mediaSourceSetHash = "c".repeat(64);
  map.initializer = "initializer"; map.blockers = [issue]; map.actorViewBlockers = [issue];
  map.map!.identity = { mapId: 10, areaId: 8 }; map.map!.source = source;
  map.map!.entities = [point]; map.map!.initialGroups = ["entity_default"];
  map.map!.groups = {
    entity_default: { name: "entity_default", source, blockers: [], entities: [point,
      { ...point, id: "exit", kind: 3, destination: { mapId: 12, entrance: 2 } },
      { ...point, id: "inside", kind: 3, destination: { mapId: 11, entrance: 1 } }] },
    later: { name: "later", source, blockers: [issue], entities: [{ ...point, id: "later-point", objectId: 9 }] },
  };
  map.scripts = { initializer: [op({ kind: "exit" }, 0)], event: [
    op({ kind: "blocked", mnemonic: "ControlledUnknown", reason: "Keep unknown behavior" }, 0),
    op({ kind: "change-map", request }, 1),
    op({ kind: "change-map", request: { ...request, mapId: 99, continuation: null } }, 2),
  ] };
  const unavailable = structuredClone(map);
  unavailable.mapId = 11; unavailable.name = "ControlledVariantB"; unavailable.map = null;
  unavailable.initializer = null; unavailable.scripts = {}; unavailable.nativeFootBlockers = [issue];
  unavailable.partyEntry = { formatVersion: 1, kind: "map-party-entry", mapId: 11,
    width: 16, height: 16, mapRange: { x: 0, y: 0, width: 16, height: 16 }, loopType: 0,
    pointIns: [{ id: 2, x: 7, y: 12, layer: 2, direction: "left", linkObject: 3, source }],
    conditionColliders: [] };
  const outside = structuredClone(map);
  outside.mapId = 12; outside.areaId = 9; outside.name = "OtherArea";
  outside.map!.identity = { mapId: 12, areaId: 9 };
  const maps = [seal(map), seal(unavailable)], other = seal(outside);
  let catalog: WorldCatalog = { ...structuredClone(f.world), sourceSetHash: map.sourceSetHash,
    parentSourceSetHash: map.parentSourceSetHash, mediaSourceSetHash: map.mediaSourceSetHash,
    characters: {}, characterIssues: {}, maps: Object.fromEntries([...maps, other].map(m => [String(m.mapId), {
      url: "/world/maps/" + m.mapId + ".json", contentHash: m.contentHash, name: m.name, areaId: m.areaId,
      geometryReady: m.map !== null, defaultGroupReady: false, blockers: [issue],
    }])) };
  catalog = seal(catalog);
  const input: SourceAreaScopeInput = { scope, catalog, maps };
  const repin = (changed: WorldMapContent) => {
    const sealed = seal(changed), index = maps.findIndex(m => m.mapId === sealed.mapId);
    maps[index] = sealed;
    input.catalog = seal({ ...input.catalog, maps: { ...input.catalog.maps,
      [String(sealed.mapId)]: { ...input.catalog.maps[String(sealed.mapId)]!, contentHash: sealed.contentHash } } });
  };
  return { input, maps, other, repin };
}

test("source area scope declares identity only and rejects implicit filters or era selectors", () => {
  assert.deepEqual(parseSourceAreaScope({ kind: "source-area-scope-v1", areaId: 8 }), { kind: "source-area-scope-v1", areaId: 8 });
  for (const raw of [null, { areaId: 8 }, { kind: "source-area-scope-v1", areaId: 0 },
    { kind: "source-area-scope-v1", areaId: 8.5 }, { kind: "source-area-scope-v1", areaId: 8, readyOnly: true },
    { kind: "source-area-scope-v1", areaId: 8, era: "guessed" }]) assert.throws(() => parseSourceAreaScope(raw));
});

test("complete area selection retains unavailable geometry, every PointIn group and all blockers", () => {
  const f = fixture(), before = structuredClone(f.input), receipt = deriveSourceAreaScope(f.input);
  assert.deepEqual(receipt.mapIds, [10, 11]); assert.equal(receipt.maps[1]!.geometryPresent, false);
  assert.equal(receipt.maps[1]!.initializer, null); assert.deepEqual(receipt.maps[1]!.groups, []);
  assert.deepEqual(receipt.maps[1]!.partyEntryPointIns, f.maps[1]!.partyEntry!.pointIns);
  assert.equal(receipt.maps[1]!.partyEntryPointIns![0]!.linkObject, 3);
  assert.equal(receipt.maps[0]!.partyEntryPointIns, null, "Missing independent source entries are unknown, not an empty list");
  assert.equal(receipt.maps[0]!.groups[1]!.pointIns[0]!.objectId, 9);
  assert.equal(receipt.maps[0]!.groups[1]!.pointIns[0]!.source.objectId, "9007199254740993");
  assert.equal(receipt.maps[0]!.indexBlockers.length, 1); assert.equal(receipt.maps[0]!.blockers.length, 1);
  assert.equal(receipt.maps[0]!.groups[1]!.blockers.length, 1);
  assert.equal(receipt.maps[0]!.providerBlockers.actorView.length, 1);
  assert.equal(receipt.maps[1]!.providerBlockers.nativeFoot.length, 1);
  assert.equal(receipt.maps[0]!.instructionBlockers[0]!.mnemonic, "ControlledUnknown");
  assert.equal(receipt.worldPhase, "unknown"); assert.equal(receipt.storyReachability, "unverified");
  assert.equal(receipt.runtimeAdmission, "unassessed"); validateSourceAreaScope(receipt, f.input);
  receipt.maps[0]!.groups[0]!.pointIns[0]!.x = 1000;
  assert.deepEqual(f.input, before, "Receipt views never mutate source packages");
});

test("source area boundaries keep inactive groups, script request flags and missing outside targets", () => {
  const f = fixture(), receipt = deriveSourceAreaScope(f.input);
  assert.equal(receipt.boundaries.length, 3);
  const script = receipt.boundaries.find(b => b.kind === "script-change-map" && b.targetMapId === 12)!;
  assert.equal(script.kind, "script-change-map");
  if (script.kind === "script-change-map") {
    assert.equal(script.request.birdview, true); assert.equal(script.request.skipBgm, true);
    assert.equal(script.continuation, "later"); assert.equal(script.source.pointer, "/Mnemonics/1");
  }
  assert.equal(receipt.boundaries.find(b => b.targetMapId === 99)!.targetIndexed, false);
  assert.equal(receipt.boundaries.some(b => b.targetMapId === 11), false, "Internal exits are not outside boundaries");
});

test("map membership is exact: subsets, foreign maps and duplicate identities cannot masquerade as a complete area", () => {
  const f = fixture();
  assert.throws(() => deriveSourceAreaScope({ ...f.input, maps: [f.maps[0]!] }), /map set/);
  assert.throws(() => deriveSourceAreaScope({ ...f.input, maps: [...f.maps, f.other] }), /map set/);
  assert.throws(() => deriveSourceAreaScope({ ...f.input, maps: [f.maps[0]!, f.maps[0]!] }), /map set/);
  assert.throws(() => deriveSourceAreaScope({ ...f.input, maps: [f.maps[0]!, f.other] }), /map set/);
  assert.throws(() => deriveSourceAreaScope({ ...f.input, scope: { kind: "source-area-scope-v1", areaId: 99 } }), /no indexed/);
});

test("source area membership and receipt hashing are deterministic independently of caller map order", () => {
  const f = fixture(), first = deriveSourceAreaScope(f.input);
  const reverse = deriveSourceAreaScope({ ...f.input, maps: [...f.maps].reverse() });
  assert.deepEqual(reverse, first);
  const { contentHash, ...body } = first; assert.equal(contentHash, hash(body));
});

test("body tampering and foreign catalog pins fail before deriving selection evidence", () => {
  const f = fixture(), changed = structuredClone(f.maps[0]!);
  changed.initializer = "ChangedBody";
  assert.throws(() => deriveSourceAreaScope({ ...f.input, maps: [changed, f.maps[1]!] }), /content hash mismatch/);
  const wrong = structuredClone(f.input.catalog); wrong.maps["10"]!.url = "/world/maps/changed.json";
  assert.throws(() => deriveSourceAreaScope({ ...f.input, catalog: wrong }), /content hash mismatch/);
  const resealed = seal(changed);
  assert.throws(() => deriveSourceAreaScope({ ...f.input, maps: [resealed, f.maps[1]!] }), /source binding mismatch/);
});

test("resealed foreign source, parent, media and geometry identity do not inherit source area membership", () => {
  for (const mutate of [
    (m: WorldMapContent) => { m.sourceSetHash = "d".repeat(64); },
    (m: WorldMapContent) => { m.parentSourceSetHash = "d".repeat(64); },
    (m: WorldMapContent) => { m.mediaSourceSetHash = "d".repeat(64); },
    (m: WorldMapContent) => { m.areaId = 9; },
    (m: WorldMapContent) => { m.map!.identity!.mapId = 20; },
  ]) {
    const f = fixture(), m = structuredClone(f.maps[0]!); mutate(m); f.repin(m);
    assert.throws(() => deriveSourceAreaScope(f.input), /source binding mismatch/);
  }
});

test("framework markers and traversal policies never grant strict source area selection", () => {
  for (const mutate of [
    (m: WorldMapContent) => { m.developmentProfile = { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1", sourceContentHash: m.contentHash, omissions: [] }; },
    (m: WorldMapContent) => { m.developmentOmissions = []; },
    (m: WorldMapContent) => { m.walkEncounters = { kind: "framework-walk-encounters-v1", id: "controlled", minSteps: 1, maxSteps: 1, transportationIds: [1], parties: [{ partyId: 1, weight: 1 }] }; },
  ]) {
    const f = fixture(), m = structuredClone(f.maps[0]!); mutate(m); f.repin(m);
    assert.throws(() => deriveSourceAreaScope(f.input), /source binding mismatch/);
  }
  const f = fixture(), catalog = seal({ ...f.input.catalog, developmentProfile: {
    kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
    sourceContentHash: f.input.catalog.contentHash, omissions: [],
  } });
  assert.throws(() => deriveSourceAreaScope({ ...f.input, catalog }), /strict source world/);
});

test("resealed receipts cannot omit a variant, PointIn, blocker or outside boundary", () => {
  for (const mutate of [
    (r: ReturnType<typeof deriveSourceAreaScope>) => { r.mapIds.pop(); r.maps.pop(); },
    (r: ReturnType<typeof deriveSourceAreaScope>) => { r.maps[0]!.groups[1]!.pointIns = []; },
    (r: ReturnType<typeof deriveSourceAreaScope>) => { r.maps[1]!.partyEntryPointIns = null; },
    (r: ReturnType<typeof deriveSourceAreaScope>) => { r.maps[0]!.groups[1]!.blockers = []; },
    (r: ReturnType<typeof deriveSourceAreaScope>) => { r.boundaries.pop(); },
  ]) {
    const f = fixture(), receipt = deriveSourceAreaScope(f.input); mutate(receipt);
    assert.throws(() => validateSourceAreaScope(seal(receipt), f.input), /receipt binding mismatch/);
  }
});

test("source edits invalidate old area receipts while a newly pinned receipt still preserves their unknown scope", () => {
  const f = fixture(), before = deriveSourceAreaScope(f.input), changed = structuredClone(f.maps[0]!);
  changed.blockers.push({ reason: "Newly observed dependency", source }); f.repin(changed);
  assert.throws(() => validateSourceAreaScope(before, f.input), /receipt binding mismatch/);
  const next = deriveSourceAreaScope(f.input); validateSourceAreaScope(next, f.input);
  assert.notEqual(next.contentHash, before.contentHash); assert.equal(next.runtimeAdmission, "unassessed");
});
