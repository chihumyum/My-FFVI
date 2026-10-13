import test from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { compileFrameworkFieldPresentation } from "../src/compiler/framework-field-presentation.js";
import { compileFrameworkNewGame } from "../src/compiler/framework-new-game.js";
import { prepareFrameworkNewGameField, installFrameworkNewGameActors } from "../src/core/framework-new-game.js";
import { resolveFieldPresentation } from "../src/core/field-presentation.js";
import { projectFieldActorView, validateFieldActorView, validateFieldActorViewProjection } from "../src/core/field-actor-view.js";
import { ordinaryFieldCompositionRenderHost } from "../src/core/field-native-composition.js";
import { prepareNativeFieldProviders } from "../src/core/field-native-providers.js";
import { projectMapEntryView } from "../src/core/map-view.js";
import { GameState } from "../src/core/game-state.js";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { frameworkNewGameFixture } from "./fixtures/framework-new-game.js";
import { sealBatchContent } from "./fixtures/content-batch.js";

/** Authored mechanism data, including the material property that the source
 * lane rejects. No original map, source-state correction or story is asserted. */
async function fixture() {
  const f = await frameworkNewGameFixture(), map = structuredClone(f.map), geometry = map.map!;
  const range = { x: 2, y: 1, width: geometry.width - 3, height: geometry.height - 2 };
  map.partyEntry!.mapRange = structuredClone(range);
  map.cameraHost!.mapRange = structuredClone(range);
  const layers = ["BottomLayer", "GroundLayer", "UpperLayer", "CeilLayer"].map((name, index) => {
    const data = Array<number>(geometry.width * geometry.height).fill(0);
    if (index === 0 || index === 2) data[0] = 1;
    return { name, width: geometry.width, height: geometry.height, data, opacity: 1 };
  });
  geometry.layers = structuredClone(layers);
  const viewSources = map.actorView!.sources;
  const tilemap = { source: structuredClone(viewSources[0]!.source), data: {
    width: geometry.width, height: geometry.height, tilewidth: 16, tileheight: 16,
    orientation: "orthogonal", infinite: false, properties: [],
    layers: [{ type: "group", name: "TileGroup", visible: true, opacity: 1,
      properties: [{ name: "body_threshold", value: 12 }],
      layers: layers.map(layer => ({ ...layer, type: "tilelayer", visible: true, properties: [] })) }],
  } };
  geometry.source = structuredClone(tilemap.source);
  const mapPackage = { source: structuredClone(viewSources[1]!.source), data: {
    map: [{ tilemap: posix.relative(posix.dirname(viewSources[1]!.source.assetPath),
      viewSources[0]!.source.assetPath).replace(/\.json$/, "") }], texture: [],
  } };
  map.frameworkPresentation = compileFrameworkFieldPresentation({
    policy: "framework-ordinary-field-flat-v1",
    sources: [tilemap.source].map(source => ({ file: source.file, sha256: source.sha256 })),
    tilemap, mapPackage, mapSize: { width: geometry.width, height: geometry.height },
    mapRange: range, renderHost: ordinaryFieldCompositionRenderHost(),
  });
  const retained = { reason: "Source actor water/group material provider is unresolved", source: mapPackage.source };
  map.actorViewBlockers = [structuredClone(retained)];
  map.nativeCompositionBlockers = [structuredClone(retained)];
  map.entryView = { mapId: map.mapId, isWorld: false, loopType: 0, sources: {
    map: { file: "synthetic-master.bundle", assetPath: "authored/map.csv", pointer: "/id/" + map.mapId },
    area: { file: "synthetic-master.bundle", assetPath: "authored/area.csv", pointer: "/id/" + map.areaId },
  } };
  map.developmentProfile!.fieldPresentation = "framework-ordinary-field-flat-v1";
  const world = structuredClone(f.world);
  world.developmentProfile!.fieldPresentation = "framework-ordinary-field-flat-v1";
  const sealedMap = sealBatchContent(map);
  world.maps[String(map.mapId)]!.contentHash = sealedMap.contentHash;
  const sealedWorld = sealBatchContent(world);
  const content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry, sourceBattle: f.sourceBattle,
    sourceMap: f.sourceMap, world: sealedWorld, map: sealedMap, battle: f.battle,
    entrance: sealedMap.partyEntry!.pointIns[0]!.id });
  return { ...f, content, world: sealedWorld, map: sealedMap, range };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function privateField(f: Fixture) {
  const state = GameState.createNewGame(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions);
  const prepared = prepareFrameworkNewGameField(f.content, f.world, f.map, f.battle, state);
  const field = new FieldGame(prepared.field, new EventState(prepared.fresh.events), undefined, undefined, {
    nativeActorPreparation: true, partyAppearance: state.fieldPartyAppearance!, puppetRoster: state.fieldPuppetRoster,
    inventory: state.fieldInventory,
  });
  return { state, prepared, field };
}

test("ordinary presentation keeps source blockers and full geometry while binding a cropped native view", async () => {
  const f = await fixture(), before = structuredClone(f.map), result = resolveFieldPresentation(f.map);
  assert.equal(result.view.kind, "framework-flat-field-view-v1");
  assert.deepEqual(result.view.mapSize, { width: f.range.width, height: f.range.height });
  assert.notEqual(result.view.mapSize.width, f.map.map!.width);
  assert.deepEqual(result.composition!.renderTargets, { upper: "source-rendered", ceil: "clear-only" });
  assert.equal(f.map.actorView!.kind, "native-default-field-view-v1");
  assert.equal(f.map.actorViewBlockers!.length, 1);
  result.view.mapSize.width = 1; result.composition!.sources[0]!.file = "caller-change";
  assert.deepEqual(f.map, before, "Returned presentation and composition are detached views");
});

test("missing alternative preserves source rejection; an ordinary policy cannot relabel a native blocker", async () => {
  const f = await fixture(), changed = structuredClone(f.map);
  delete changed.frameworkPresentation;
  assert.throws(() => resolveFieldPresentation(changed), /water\/group material/);
  changed.actorView = structuredClone(f.map.frameworkPresentation!.view);
  changed.actorViewBlockers = []; changed.nativeCompositionBlockers = [];
  assert.throws(() => resolveFieldPresentation(changed), /explicit alternative/);
  const old = await frameworkNewGameFixture(), native = resolveFieldPresentation(old.map);
  assert.equal(native.view.kind, "native-default-field-view-v1");
  assert.equal(projectFieldActorView(native.view, 9)!.kind, "native-default-field-view-projection-v1");
});

test("policy, world applicability, source, composition and late geometry faults fail without modifying inputs", async () => {
  const f = await fixture();
  for (const fault of ["policy", "world", "entry", "tilemap", "package", "foot", "composition", "range", "late-layer"] as const) {
    const map = structuredClone(f.map);
    if (fault === "policy") delete map.developmentProfile!.fieldPresentation;
    if (fault === "world") map.entryView!.isWorld = true;
    if (fault === "entry") map.entryView!.mapId++;
    if (fault === "tilemap") map.frameworkPresentation!.view.sources[0]!.source.objectId = "42";
    if (fault === "package") map.frameworkPresentation!.view.sources[1]!.source.file = "foreign.bundle";
    if (fault === "foot") map.nativeFoot!.source.objectId = "43";
    if (fault === "composition") map.frameworkPresentation!.composition.upperTexture = null;
    if (fault === "range") map.cameraHost!.mapRange.x++;
    if (fault === "late-layer") map.map!.layers.at(-1)!.data.pop();
    const before = structuredClone(map);
    assert.throws(() => resolveFieldPresentation(map), /policy|binding|mismatch|target|incomplete/, fault);
    assert.deepEqual(map, before, fault);
  }
});

test("ordinary view uses the initialized native actors and existing foot/composition providers", async () => {
  const f = await fixture(), { state, field } = privateField(f), before = state.snapshot();
  installFrameworkNewGameActors(field, f.content, state, f.map);
  const player = field.player.native!.entity, projection = player.viewBinding!.properties;
  assert.ok(projection && projection.kind === "framework-flat-field-view-projection-v1");
  assert.equal(projection.policy, "framework-ordinary-field-flat-v1");
  validateFieldActorViewProjection(projection, f.content.view.contextId, player.layer);
  assert.ok(Object.values(field.actors).every(actor => actor.native !== undefined));
  const providers = prepareNativeFieldProviders(field, f.content.view, f.map.nativeFoot)();
  assert.equal(providers.footAttribute!(player.position), 0);
  assert.equal(providers.upperTexture, f.map.frameworkPresentation!.composition.upperTexture);
  assert.equal(providers.ceilTexture, f.map.frameworkPresentation!.composition.ceilTexture);
  assert.deepEqual(state.snapshot(), before, "Presentation owns no inventory, character or story state");
  assert.throws(() => prepareNativeFieldProviders(field, f.content.view, undefined), /foot provider/);
  assert.equal(field.player.native!.entity, player);
  assert.deepEqual(state.snapshot(), before);
});

test("world and ordinary authorization remain separate, and a flat definition alone grants neither", async () => {
  const f = await fixture(), { field } = privateField(f);
  const view = f.map.frameworkPresentation!.view, before = structuredClone(field.content);
  delete field.content.developmentProfile!.fieldPresentation;
  assert.throws(() => prepareNativeFieldProviders(field, view, f.map.nativeFoot), /declared framework map view/);
  field.content.developmentProfile = structuredClone(before.developmentProfile!);
  field.content.entry.viewPlan = projectMapEntryView({ mapId: f.map.mapId, isWorld: true,
    requestedViewType: 0, loopType: 0 }, "framework-world-map-flat-v1");
  assert.throws(() => prepareNativeFieldProviders(field, view, f.map.nativeFoot), /declared framework map view/);
  field.content.entry.viewPlan = structuredClone(before.entry.viewPlan!);
  const worldView = { ...structuredClone(view), policy: "framework-world-map-flat-v1" as const,
    omissions: ["perspective-world-view" as const] };
  assert.throws(() => prepareNativeFieldProviders(field, worldView, f.map.nativeFoot), /declared framework map view/);
  assert.throws(() => validateFieldActorView({ ...view, omissions: ["perspective-world-view"] }), /flat field view/);
  assert.throws(() => validateFieldActorView({ ...worldView, omissions: ["ordinary-group-materials"] }), /flat field view/);
});

test("prepared provider capabilities are detached from caller metadata and still require real RT qualification", async () => {
  const f = await fixture(), { field } = privateField(f), view = structuredClone(f.content.view);
  const foot = structuredClone(f.map.nativeFoot!), read = prepareNativeFieldProviders(field, view, foot);
  const before = read();
  view.contextId = "f".repeat(64);
  foot.mapName = "foreign-map";
  field.content.map.nativeComposition!.sources[0]!.file = "caller-mutated.bundle";
  assert.equal(read().mapRenderContext, before.mapRenderContext);
  assert.deepEqual(read().composition, before.composition);
  assert.equal(read().footAttribute!({ x: 0, y: 0, z: 0 }), 0);
  const bad = await fixture(), privateBad = privateField(bad);
  privateBad.field.content.map.nativeComposition!.renderTargets.upper = "unresolved";
  assert.throws(() => prepareNativeFieldProviders(privateBad.field, bad.content.view, bad.map.nativeFoot), /allocation and sampling/);
});
