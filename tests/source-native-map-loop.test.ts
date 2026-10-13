import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldActorView } from "../src/compiler/field-actor-view.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { projectFieldActorView } from "../src/core/field-actor-view.js";
import { fieldCameraCellToWorld } from "../src/core/field-camera.js";
import { prepareMapPartyEntry } from "../src/core/map-party-entry.js";
import { projectMapEntryView } from "../src/core/map-view.js";
import { prepareSourceNativeMap } from "../src/core/source-native-map.js";
import type { FieldNativeAnimationKeys } from "../src/core/field-native-appearance.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function fixture(loopType: 0 | 1 | 2 | 3 = 3) {
  const f = fieldActorFactoryFixture(), prior = createFieldActorFactoryCandidate(f.input);
  const definition = { ...structuredClone(f.map), mapId: 902, width: 32, height: 24,
    mapRange: { x: 2, y: 1, width: 28, height: 20 }, loopType,
    pointIns: [{ ...structuredClone(f.map.pointIns[0]!), id: 9, x: 8, y: 7, layer: 1, direction: "left" as const }] };
  const tilemap = structuredClone(f.tilemap); tilemap.data.width = 32; tilemap.data.height = 24;
  const view = compileFieldActorView(f.sources, tilemap, f.mapPackage, definition.mapRange);
  const providers = { ...f.input.providers, mapRenderContext: view.contextId,
    applyViewProperties: (layer: number) => projectFieldActorView(view, layer) };
  const player = prior.snapshot.actors.find(actor => actor.id === prior.bindings.player)!;
  const resident = prior.snapshot.actors.find(actor => actor.id === prior.bindings.residents[0]!.actor)!;
  resident.position = { x: -80, y: 64, z: -2 }; resident.layer = 10; resident.direction = "right";
  resident.animation!.play("wave", true, 1); resident.animation!.advance(170);
  resident.visible = false; resident.fadeAlpha = Math.fround(0.4);
  resident.viewBinding = { map: f.view.contextId, layer: 10, properties: projectFieldActorView(f.view, 10)! };
  const viewPlan = projectMapEntryView({ mapId: definition.mapId, isWorld: true, requestedViewType: 0, loopType });
  const entry = prepareMapPartyEntry(f.partyCatalog, { definition, entrance: 9, mapViewType: 0, viewPlan,
    prior: f.entry.checkpoint, playerVisible: player.visible, party: f.party,
    transportation: f.fresh.entry.transportation, canPartySwitching: false });
  const animationKeys: FieldNativeAnimationKeys = { kind: "native-field-animation-keys-v1",
    assets: Object.fromEntries(Object.entries(f.characters).map(([key, character]) => [key, {
      keys: Object.keys(character.animations), source: character.source, contentHash: "a".repeat(64),
    }])) };
  const input = { prior, priorCheckpoint: f.entry.checkpoint, entry, definition, catalog: f.partyCatalog,
    party: f.party, characters: f.characters, animationKeys, view, providers };
  return { ...f, prior, definition, entry, input, resident };
}
const serial = (candidate: ReturnType<typeof prepareSourceNativeMap>) => structuredClone({ ...candidate,
  snapshot: { ...candidate.snapshot, actors: candidate.snapshot.actors.map(actor => ({ ...actor,
    animation: actor.animation?.snapshot() ?? null })) } });

test("validated cyclic normal-world entry keeps existing native identities, residents and real PointIn placement", () => {
  for (const loop of [1, 2, 3] as const) {
    const f = fixture(loop), before = serial(f.prior), checkpoint = structuredClone(f.input.priorCheckpoint);
    const next = prepareSourceNativeMap(f.input);
    assert.deepEqual(next.bindings, f.prior.bindings);
    assert.deepEqual(next.snapshot.actors.map(actor => actor.id), f.prior.snapshot.actors.map(actor => actor.id));
    assert.deepEqual(next.snapshot.camera, f.prior.snapshot.camera);
    const player = next.snapshot.actors.find(actor => actor.id === next.bindings.player)!;
    assert.deepEqual(player.position, fieldCameraCellToWorld(f.definition.mapRange,
      { x: 6, y: 6 }, f.entry.player.layer));
    assert.equal(player.direction, "left"); assert.equal(player.visible, true);
    const resident = next.snapshot.actors.find(actor => actor.id === f.resident.id)!;
    assert.deepEqual(resident.position, f.resident.position);
    assert.deepEqual(resident.animation!.snapshot(), f.resident.animation!.snapshot());
    assert.equal(resident.visible, f.resident.visible);
    for (const id of [...next.bindings.partyPuppets, ...next.bindings.otherParties])
      assert.equal(next.snapshot.actors.find(actor => actor.id === id)!.visible, false);
    assert.deepEqual(serial(f.prior), before);
    assert.deepEqual(f.input.priorCheckpoint, checkpoint);
  }
});

test("loop flags alone, nonworld applicability and stale or forged view metadata never authorize native handoff", () => {
  for (const change of ["missing", "submap", "map", "loop", "view", "policy"] as const) {
    const f = fixture(), before = serial(f.prior), checkpoint = structuredClone(f.input.priorCheckpoint);
    if (change === "missing") delete f.entry.viewPlan;
    if (change === "submap") f.entry.viewPlan = projectMapEntryView({ mapId: f.definition.mapId,
      isWorld: false, requestedViewType: 0, loopType: 3 });
    if (change === "map") f.entry.viewPlan!.mapId++;
    if (change === "loop") f.definition.loopType = 2;
    if (change === "view") f.entry.viewPlan!.presentationViewType = 1;
    if (change === "policy") f.entry.viewPlan!.mapViewType = 1;
    assert.throws(() => prepareSourceNativeMap(f.input), /lifecycle|binding mismatch|projection mismatch/, change);
    assert.deepEqual(serial(f.prior), before, change);
    assert.deepEqual(f.input.priorCheckpoint, checkpoint, change);
  }
});

test("explicit framework flat Bird keeps source view metadata without claiming a native Bird handoff", () => {
  const f = fixture(), before = serial(f.prior);
  f.entry.viewPlan = projectMapEntryView({ mapId: f.definition.mapId, isWorld: true,
    requestedViewType: 1, loopType: 3 }, "framework-world-map-flat-v1");
  const next = prepareSourceNativeMap(f.input);
  assert.equal(f.entry.viewPlan.mapViewType, 1);
  assert.equal(f.entry.checkpoint.context.camera.mapViewType, 0);
  assert.deepEqual(next.bindings, f.prior.bindings);
  assert.deepEqual(serial(f.prior), before);
  f.entry.viewPlan = projectMapEntryView({ mapId: f.definition.mapId, isWorld: true, requestedViewType: 1, loopType: 3 });
  assert.throws(() => prepareSourceNativeMap(f.input), /binding mismatch/);
  assert.deepEqual(serial(f.prior), before);
});

test("cyclic entry still rejects active movement, companions, transport changes and missing native providers", () => {
  for (const change of ["movement", "companion", "party", "transport", "camera", "material", "foot"] as const) {
    const f = fixture();
    if (change === "movement") f.prior.snapshot.actors[0]!.moving = true;
    if (change === "companion") f.entry.checkpoint.context.companion = { fieldAssetId: 3,
      conditionTypes: [], actor: null, puppet: null };
    if (change === "party") f.entry.checkpoint.context.multiParty[0]!.members = structuredClone(f.party.activeMembers);
    if (change === "transport") f.entry.checkpoint.context.currentTransport!.typeId = 12;
    if (change === "camera") f.entry.checkpoint.context.camera.mapViewType = 1;
    if (change === "material") f.input.providers.applyViewProperties = () => null;
    if (change === "foot") f.input.providers.footAttribute = () => 9;
    const before = serial(f.prior), checkpoint = structuredClone(f.input.priorCheckpoint);
    assert.throws(() => prepareSourceNativeMap(f.input),
      /movement|companion\/party|walking transportation|material|disagrees|transparency/, change);
    assert.deepEqual(serial(f.prior), before, change);
    assert.deepEqual(f.input.priorCheckpoint, checkpoint, change);
  }
});

test("legacy nonlooping native entry remains identical without a view plan", () => {
  const f = fixture(0), withPlan = prepareSourceNativeMap(f.input);
  delete f.entry.viewPlan;
  const withoutPlan = prepareSourceNativeMap(f.input);
  assert.deepEqual(serial(withoutPlan), serial(withPlan));
});
