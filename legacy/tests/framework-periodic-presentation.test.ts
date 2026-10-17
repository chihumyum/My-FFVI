import test from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { compileFrameworkPeriodicPresentation } from "../src/compiler/framework-periodic-presentation.js";
import { hash } from "../src/compiler/content.js";
import { fieldMapPresentationBlockers, resolveFieldPresentation } from "../src/core/field-presentation.js";
import { ordinaryFieldCompositionRenderHost } from "../src/core/field-native-composition.js";
import { prepareMapPartyEntry } from "../src/core/map-party-entry.js";
import { projectMapEntryView } from "../src/core/map-view.js";
import { actorCatalog } from "./fixtures/party-actors.js";
import { mapEntryInput } from "./fixtures/map-party-entry.js";
import type { WorldMapContent } from "../src/field/world.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { worldLoopSessionFixture } from "./fixtures/world-loop-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { frameworkNewGameFixture } from "./fixtures/framework-new-game.js";

async function fixture(world = true, loop: 1 | 2 | 3 = 3, selectedMap?: WorldMapContent) {
  const f = await frameworkNewGameFixture(), map = structuredClone(selectedMap ?? f.map), geometry = map.map!,
    [tileSource, packageSource] = map.actorView!.sources.map(s => structuredClone(s.source));
  geometry.source = tileSource!;
  map.partyEntry!.loopType = loop;
  map.cameraHost!.loop = { horizontal: (loop & 1) !== 0, vertical: (loop & 2) !== 0 };
  map.entryView = { mapId: map.mapId, isWorld: world, loopType: loop,
    sources: { map: f.source, area: f.source } };
  geometry.layers = ["BottomLayer", ...(selectedMap ? [] : ["UpperLayer"])].map(name => ({ name, width: geometry.width,
    height: geometry.height, opacity: 1, data: Array<number>(geometry.width * geometry.height).fill(0) }));
  geometry.layers[0]!.data[0] = 1;
  const tilemap = { source: tileSource!, data: { width: geometry.width, height: geometry.height,
    tilewidth: 16, tileheight: 16, orientation: "orthogonal", infinite: false, properties: [],
    layers: [{ type: "group", name: "TileGroup", visible: true, opacity: 1,
      layers: geometry.layers.map(layer => ({ ...layer, type: "tilelayer", visible: true, properties: [] })) }] } };
  const mapPackage = { source: packageSource!, data: { map: [{ tilemap:
    posix.relative(posix.dirname(packageSource!.assetPath), tileSource!.assetPath).replace(/\.json$/, "") }], texture: [] } };
  const sources = [{ file: tileSource!.file, sha256: tileSource!.sha256 }];
  map.blockers = [{ reason: "Looping field presentation is not implemented", source: {
    file: "map.csv", assetPath: "map.csv", pointer: `/id/${map.mapId}/loop_type` } }];
  const strict = { reason: "Unresolved native field material", source: tileSource! };
  map.actorViewBlockers = [strict]; map.nativeCompositionBlockers = [strict];
  const { contentHash: _, ...body } = map; map.contentHash = hash(body);
  return { map, sources, tilemap, mapPackage, renderHost: ordinaryFieldCompositionRenderHost(),
    backgroundMedia: { parentSourceSetHash: "d".repeat(64), sources, sourceSetHash: hash(sources),
      images: {}, shader: {}, prefab: {}, renderHost: {} }, verify() {} };
}

test("periodic alternatives preserve strict source diagnostics, namespaces and world applicability", async () => {
  for (const world of [true, false]) for (const loop of [1, 2, 3] as const) {
    const f = await fixture(world, loop), before = structuredClone(f.map), result = compileFrameworkPeriodicPresentation(f);
    assert.deepEqual(f.map, before);
    assert.equal(result.alternative.kind, world ? "framework-world-field-presentation-v1" : "framework-ordinary-field-presentation-v1");
    assert.deepEqual(result.topology.loop, { horizontal: (loop & 1) !== 0, vertical: (loop & 2) !== 0 });
    const candidate = structuredClone(f.map);
    candidate.developmentProfile!.worldMap = "framework-world-map-flat-v1";
    candidate.developmentProfile!.fieldPresentation = "framework-ordinary-field-flat-v1";
    candidate.frameworkPresentation = result.alternative; candidate.map!.topology = result.topology;
    const resolved = resolveFieldPresentation(candidate).view;
    assert.equal(resolved.kind, "framework-flat-field-view-v1");
    assert.ok(resolved.kind === "framework-flat-field-view-v1");
    assert.equal(resolved.policy, result.alternative.view.policy);
    assert.deepEqual(fieldMapPresentationBlockers(candidate), []);
    assert.deepEqual(candidate.blockers, before.blockers);
    assert.deepEqual(candidate.scripts, before.scripts);
    assert.deepEqual(candidate.map!.groups, before.map!.groups);
    assert.equal(candidate.actorViewBlockers!.length, 1);
  }
});

test("no guessed range, loop identity, alternative policy or native dependency waiver", async () => {
  for (const kind of ["range", "loop", "party", "camera", "world", "package", "source"] as const) {
    const f = await fixture(), before = structuredClone(f.map);
    if (kind === "range") f.map.cameraHost!.mapRange.width--;
    if (kind === "loop") f.map.entryView!.loopType = 1;
    if (kind === "party") delete f.map.partyEntry;
    if (kind === "camera") f.map.cameraHostBlockers = [{ source: f.map.map!.source, reason: "Unknown camera" }];
    if (kind === "world") f.map.entryView!.isWorld = null as unknown as boolean;
    if (kind === "package") f.mapPackage.source.assetPath = "foreign/package.json";
    if (kind === "source") f.tilemap.source = { ...f.tilemap.source, objectId: "9007199254740993" };
    const changed = structuredClone(f.map);
    assert.throws(() => compileFrameworkPeriodicPresentation(f), /source|binding|mismatch|geometry|range|unavailable/i, kind);
    assert.deepEqual(f.map, changed);
    assert.notEqual(f.map, before);
  }
});

test("only the exact loop diagnostic is discharged, with valid source topology and alternative", async () => {
  const f = await fixture(), result = compileFrameworkPeriodicPresentation(f), candidate = structuredClone(f.map);
  candidate.developmentProfile!.worldMap = "framework-world-map-flat-v1";
  candidate.frameworkPresentation = result.alternative; candidate.map!.topology = result.topology;
  const unrelated = { reason: "Looping field presentation is not implemented", source: { file: "foreign", assetPath: "map.csv" } };
  candidate.blockers.push(unrelated, { reason: "Original gameplay dependency", source: f.tilemap.source });
  assert.deepEqual(fieldMapPresentationBlockers(candidate), candidate.blockers.slice(1));
  delete candidate.map!.topology;
  assert.throws(() => fieldMapPresentationBlockers(candidate), /topology/);
  delete candidate.frameworkPresentation;
  assert.deepEqual(fieldMapPresentationBlockers(candidate), candidate.blockers);
});

test("ordinary periodic PointIn uses its validated source view without acquiring world identity", () => {
  for (const loopType of [1, 2, 3] as const) {
    const input = mapEntryInput(); input.definition.loopType = loopType;
    assert.throws(() => prepareMapPartyEntry(actorCatalog(), input), /presentation/);
    input.viewPlan = projectMapEntryView({ mapId: input.definition.mapId, isWorld: false, requestedViewType: 1, loopType });
    assert.throws(() => prepareMapPartyEntry(actorCatalog(), input), /presentation/);
    input.ordinaryPeriodicPresentation = "framework-ordinary-field-flat-v1";
    const before = structuredClone(input), plan = prepareMapPartyEntry(actorCatalog(), input);
    assert.deepEqual(plan.player, { x: 8, y: 9, layer: 2, direction: "left", visible: true, asset: "same-media", mount: "" });
    assert.equal(plan.checkpoint.context.camera.mapViewType, 0);
    assert.deepEqual(input, before);
  }
});

async function continuousFixture(worldMapIdentity = true) {
  const f = await worldLoopSessionFixture({ requestedViewType: 1 }), p = await fixture(worldMapIdentity, 3, f.worldMap),
    plan = compileFrameworkPeriodicPresentation(p), target = structuredClone(p.map);
  target.frameworkPresentation = plan.alternative; target.map!.topology = plan.topology;
  target.developmentProfile = structuredClone(f.worldMap.developmentProfile!);
  if (!worldMapIdentity) target.developmentProfile.fieldPresentation = "framework-ordinary-field-flat-v1";
  // This source-shaped mechanism fixture has no global render-target host.
  // Keep its Bottom-only display; enabled/disabled global RT retention is
  // independently exercised by source-native-map tests and remains gated.
  const initialDraft = structuredClone(f.map), worldDraft = structuredClone(f.world);
  if (!worldMapIdentity) {
    initialDraft.developmentProfile!.fieldPresentation = "framework-ordinary-field-flat-v1";
    worldDraft.developmentProfile!.fieldPresentation = "framework-ordinary-field-flat-v1";
  }
  const initial = sealBatchContent(initialDraft), worldMap = sealBatchContent(target);
  worldDraft.maps[initial.mapId]!.contentHash = initial.contentHash;
  worldDraft.maps[worldMap.mapId]!.contentHash = worldMap.contentHash;
  const world = sealBatchContent(worldDraft), content = await compileFrameworkNewGame({
    sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle, sourceMap: f.sourceMap,
    world, map: initial, battle: f.battle, entrance: f.content.entry.entrance });
  const game = await GameSession.prepareFrameworkNewGame(content, world, initial, f.battle, { battleHandoff: "prepared" }),
    flow = new GameFlow(game), host = { visible: true, mediaReady: true, overlayOpen: false };
  flow.start(); flow.observeHost(host); flow.advance(10, host);
  assert.equal(flow.move("right"), true); flow.advance(240, host);
  assert.equal(game.field.stop?.kind, "map-transition");
  return { ...f, map: initial, world, worldMap, content, game, flow, host };
}

test("a declared periodic alternative shares native owners across cancel, seam movement, save and ordinary return", async () => {
  const h = await continuousFixture(), old = h.game.field, before = h.game.state.snapshot(), native = old.player.native!.entity;
  const cancelled = h.game.world.prepare(h.world, h.worldMap);
  h.game.world.discard(cancelled); assert.equal(h.game.world.commit(cancelled), false);
  assert.equal(h.game.field, old); assert.equal(old.player.native!.entity, native);
  assert.deepEqual(h.game.state.snapshot(), before);
  const candidate = h.game.world.prepare(h.world, h.worldMap);
  assert.equal(h.game.world.commit(candidate), true); h.flow.advance(10, h.host);
  assert.equal(h.game.field.player.native!.entity.id, native.id);
  assert.equal(h.game.field.player.native!.entity.viewBinding!.properties!.kind, "framework-flat-field-view-projection-v1");
  assert.equal(h.game.field.eventState.read(h.initializerRef), 1);
  const width = h.worldMap.map!.width, height = h.worldMap.map!.height;
  assert.deepEqual([h.game.field.player.x, h.game.field.player.y], [width - 1, height - 1]);
  for (const direction of ["right", "down"] as const) { assert.equal(h.flow.move(direction), true); h.flow.advance(240, h.host); }
  assert.deepEqual([h.game.field.player.x, h.game.field.player.y], [0, 0]);
  const saved = h.game.checkpoint(), owned = h.game.state.snapshot(), restored = GameSession.restore(saved, undefined, h.battle,
    { catalog: h.world, map: h.worldMap, initialized: { content: h.content, initialMap: h.map } }, { battleHandoff: "prepared" });
  assert.deepEqual(restored.checkpoint(), saved); restored.advance(10);
  assert.deepEqual(restored.state.snapshot(), owned); assert.equal(restored.field.eventState.read(h.initializerRef), 1);
  for (const direction of ["right", "down"] as const) { assert.equal(h.flow.move(direction), true); h.flow.advance(240, h.host); }
  assert.equal(h.game.field.stop?.kind, "map-transition");
  const returning = h.game.world.prepare(h.world, h.map);
  assert.equal(h.game.world.commit(returning), true); h.flow.advance(10, h.host);
  assert.equal(h.game.field.content.map.identity!.mapId, h.map.mapId);
  assert.equal(h.game.field.content.entry.viewPlan!.isWorld, false);
  assert.equal(h.game.field.player.native!.entity.id, native.id);
  assert.equal(h.game.checkpointReady, true);
});

test("an unrelated source dependency remains blocking after periodic display preparation and can retry unchanged", async () => {
  const h = await continuousFixture(), old = h.game.field, before = h.game.state.snapshot(), wrong = structuredClone(h.worldMap);
  wrong.blockers.push({ reason: "Unknown original gameplay dependency", source: wrong.map!.source });
  assert.throws(() => h.game.world.prepare(h.world, wrong), /Unknown original gameplay dependency/);
  assert.equal(h.game.field, old); assert.deepEqual(h.game.state.snapshot(), before);
  const candidate = h.game.world.prepare(h.world, h.worldMap);
  assert.equal(h.game.world.commit(candidate), true); h.flow.advance(10, h.host);
  assert.equal(h.game.field.eventState.read(h.initializerRef), 1);
});


test("ordinary looping fields enter with their source identity and restore the same canonical seam", async () => {
  const h = await continuousFixture(false), candidate = h.game.world.prepare(h.world, h.worldMap);
  assert.equal(h.game.world.commit(candidate), true); h.flow.advance(10, h.host);
  assert.equal(h.game.field.content.entry.viewPlan!.isWorld, false);
  assert.equal(h.game.field.content.entry.viewPlan!.mapViewType, 0);
  assert.equal(h.game.field.content.entry.viewPlan!.presentationPolicy, null);
  for (const direction of ["right", "down"] as const) { assert.equal(h.flow.move(direction), true); h.flow.advance(240, h.host); }
  assert.deepEqual([h.game.field.player.x, h.game.field.player.y], [0, 0]);
  const saved = h.game.checkpoint(), restored = GameSession.restore(saved, undefined, h.battle,
    { catalog: h.world, map: h.worldMap, initialized: { content: h.content, initialMap: h.map } }, { battleHandoff: "prepared" });
  assert.deepEqual(restored.checkpoint(), saved);
});
