import test from "node:test";
import assert from "node:assert/strict";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { canonical } from "../src/core/canonical.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { FieldPartyActors } from "../src/core/field-party-actors.js";
import { createNativeFieldActorProjection, createNativeFieldActorProjections, createNativeFieldPuppetActorsPort,
  readNativeFieldActors, prepareNativeFieldActorState, type NativeFieldPuppetActorsHost } from "../src/core/field-native-actors.js";
import { prepareNativeFieldActorAppearance, type FieldNativeAnimationKeys } from "../src/core/field-native-appearance.js";
import { projectFieldTransportActorInstance, projectFieldTransportActors, projectFieldPuppetTransportationEffects,
  type FieldTransportActorOperation } from "../src/core/field-transport-actors.js";
import { projectFieldPuppetInitialization, type FieldPuppetActorCatalog } from "../src/core/field-puppet-actors.js";
import { prepareMapPartyEntry } from "../src/core/map-party-entry.js";
import { prepareSourceNativeMap } from "../src/core/source-native-map.js";
import { captureFieldNativeCheckpoint, restoreFieldNativeCheckpoint, type FieldNativeCheckpointContext } from "../src/core/field-native-checkpoint.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

const presentation = "framework-development" as const;
function fixture() {
  const f = fieldActorFactoryFixture(), prior = createFieldActorFactoryCandidate(f.input);
  const animationKeys: FieldNativeAnimationKeys = { kind: "native-field-animation-keys-v1",
    assets: Object.fromEntries(Object.entries(f.characters).map(([asset, media]) => [asset, {
      keys: Object.keys(media.animations), source: media.source, contentHash: "a".repeat(64),
    }])) };
  const operations: FieldTransportActorOperation[] = [{ kind: "ride-on", actorId: prior.bindings.player,
    frontAssetId: 38, skipIfSameOuter: true }];
  const input = { snapshot: prior.snapshot, assets: prior.assets, catalog: f.partyCatalog,
    characters: f.characters, animationKeys, operations, presentation };
  const bookkeeping = new FieldPartyActors(f.partyCatalog, f.entry.checkpoint, 1, presentation);
  return { ...f, prior, animationKeys, operations, transportInput: input, bookkeeping };
}
const serial = (snapshot: ReturnType<typeof projectFieldTransportActors>) => canonical({ ...snapshot,
  snapshot: { ...snapshot.snapshot, actors: snapshot.snapshot.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() ?? null })) } });

function lifecycleFixture() {
  const f = fixture(), mounted = projectFieldTransportActors(f.transportInput);
  const start = f.bookkeeping.prepareTransportation({ operations: f.operations,
    currentTransport: { id: 6, typeId: 12, fieldAssetId: 38 } });
  start.validate(); start.commit();
  const owner = Object.fromEntries(createNativeFieldActorProjections({ ...f.prior, ...mounted },
    f.map.mapRange, f.partyCatalog, presentation).map((actor) => [actor.id, actor]));
  // An unrelated ordinary map object uses its own asset domain and must not
  // acquire field-character identity merely because a party puppet boards.
  const npc = createNativeFieldActorProjection({ entity: { ...mounted.snapshot.actors[0]!, id: "npc:7",
    position: { ...mounted.snapshot.actors[0]!.position }, riding: false, riderAssetId: null, rideOnEntity: "absent",
    animation: new ActorAnimation(f.characters.bravo!) }, fieldAssetId: null, charaZOffset: 0,
    mapObjectAsset: { id: 7, asset: "bravo", source: f.map.pointIns[0]!.source }, updateAttribute: 2,
    scope: { kind: "map-npc", group: "g", entityId: "npc:7", source: f.map.pointIns[0]!.source } },
    f.map.mapRange, f.partyCatalog, presentation);
  npc.animation!.look("left"); owner[npc.id] = npc;
  const catalog: FieldPuppetActorCatalog = { kind: "field-puppet-actors-v1", memberCount: 4,
    characteristics: true, corpsOrder: [0, 1, 2, 3], residents: [], conditionChanges: [], miscHash: "b".repeat(64) };
  const providers = { ...f.input.providers, transportationType: 12, transportationPresentation: presentation };
  const host: NativeFieldPuppetActorsHost = { readActors: () => owner, readCamera: () => null,
    readProviders: () => providers,
    readContext: () => ({ catalog, checkpoint: f.bookkeeping.checkpoint(), bindings: f.prior.bindings,
      owned: [{ ownedId: 17, sourceId: 2, enabled: true, conditionTypes: [] }], party: [17, 0, 0, 0],
      entities: [{ entityId: 7, actor: npc.id }], restorePartyInstruction: "absent" }),
    controlContext: () => ({ worldMapScript: false, callback: "absent" }), prepareCollision: () => () => {},
    transportation: { read: () => ({ catalog: f.partyCatalog, characters: f.characters,
      animationKeys: f.animationKeys, presentation }), prepare: (operations) => f.bookkeeping.prepareTransportation({ operations }) } };
  const port = createNativeFieldPuppetActorsPort(host);
  const plan = () => projectFieldPuppetInitialization({ ...port.read(), phase: "start", script: {
    skipInitialize: false, keepPlayerPuppet: false, keepBadStatusVisual: false, ridingVehicle: false,
    characteristics: true, scriptHash: "a".repeat(64), miscHash: catalog.miscHash } });
  const snapshot = () => ({ snapshot: readNativeFieldActors(owner, null),
    assets: Object.values(owner).map((actor) => ({ id: actor.id, fieldAssetId: actor.native.fieldAssetId,
      charaZOffset: actor.native.charaZOffset })) });
  return { ...f, owner, host, providers, port, plan, snapshot, npc };
}

test("script Init jointly mounts existing puppets and records their assets without changing the controller or unrelated NPC", () => {
  const f = lifecycleFixture(), before = serial(f.snapshot()), party = f.bookkeeping.checkpoint();
  const puppet = f.owner[f.prior.bindings.partyPuppets[0]!]!, entity = puppet.native.entity;
  const npcEntity = f.npc.native.entity, npcAnimation = f.npc.animation!.snapshot();
  const publish = f.port.prepare(f.plan());
  assert.equal(serial(f.snapshot()), before); assert.deepEqual(f.bookkeeping.checkpoint(), party);
  publish();
  assert.equal(f.owner[puppet.id], puppet); assert.equal(puppet.native.entity, entity);
  assert.equal(puppet.native.fieldAssetId, 38); assert.equal(puppet.mount, "armor"); assert.equal(puppet.asset, "bravo");
  assert.equal(puppet.native.entity.riderAssetId, 2);
  assert.equal(f.bookkeeping.checkpoint().context.puppets[0]!.riderFieldAssetId, 2);
  assert.deepEqual(f.bookkeeping.checkpoint().context.currentTransport, party.context.currentTransport);
  assert.equal(f.npc.native.entity, npcEntity); assert.equal(f.npc.native.fieldAssetId, null);
  assert.deepEqual(f.npc.animation!.snapshot(), npcAnimation);
  const repeated = f.port.prepare(f.plan()); repeated();
  assert.equal(puppet.native.entity.riderAssetId, 2, "accessor same-front does not cache armor as its own rider");
  assert.throws(publish, /already committed/);
});

test("script lifecycle rider return restores and clears the same puppet cache and party bookkeeping", () => {
  const f = lifecycleFixture(); f.port.prepare(f.plan())();
  const id = f.prior.bindings.partyPuppets[0]!, actor = f.owner[id]!;
  f.port.prepare({ leaderId: null, assignments: null, effects: [{ kind: "ride-out", actor: id }] })();
  assert.equal(actor.mount, null); assert.equal(actor.asset, "bravo"); assert.equal(actor.native.entity.riderAssetId, null);
  assert.equal(f.bookkeeping.checkpoint().context.puppets[0]!.riderFieldAssetId, null);
  assert.equal(f.bookkeeping.checkpoint().context.puppets[0]!.riding, false);
  assert.equal(f.bookkeeping.checkpoint().context.currentTransport!.id, 6);
});

test("late script riding failure and stale party/provider reject before either existing owner publishes", () => {
  const f = lifecycleFixture(), before = serial(f.snapshot()), party = f.bookkeeping.checkpoint();
  const invalid = f.plan(); invalid.effects.push({ kind: "look", actor: "native:party:0", from: f.prior.bindings.player });
  assert.throws(() => f.port.prepare(invalid), /media/);
  assert.equal(serial(f.snapshot()), before); assert.deepEqual(f.bookkeeping.checkpoint(), party);
  const stale = f.port.prepare(f.plan()); f.bookkeeping.restore(party);
  assert.throws(stale, /Stale/); assert.equal(serial(f.snapshot()), before); assert.deepEqual(f.bookkeeping.checkpoint(), party);
  const changed = f.port.prepare(f.plan()); delete f.host.transportation;
  assert.throws(changed, /Stale/); assert.equal(serial(f.snapshot()), before);
  assert.throws(() => f.port.prepare(f.plan()), /RideOn/); assert.equal(serial(f.snapshot()), before);
});

test("direct transport projection preserves unrelated animated map-object actors and rejects targeting their asset domain", () => {
  const f = lifecycleFixture(), before = serial(f.snapshot());
  const input = { ...f.transportInput, ...f.snapshot() };
  const next = projectFieldTransportActors(input), npc = next.snapshot.actors.find((actor) => actor.id === f.npc.id)!;
  assert.equal(npc.animation!.character, f.npc.animation!.character);
  assert.deepEqual(npc.animation!.snapshot(), f.npc.animation!.snapshot());
  assert.equal(next.assets.find((row) => row.id === f.npc.id)!.fieldAssetId, null);
  assert.equal(serial(f.snapshot()), before);
  assert.throws(() => projectFieldTransportActors({ ...input, operations: [{ kind: "ride-on", actorId: f.npc.id,
    frontAssetId: 38, skipIfSameOuter: true }] }), /asset\/playback/);
  const { transportationPresentation: _, ...strictProviders } = f.providers;
  assert.throws(() => projectFieldPuppetTransportationEffects({ ...input, effects: f.plan().effects,
    providers: strictProviders }), /trusted/);
});

test("RideOn caches the current outer and accessor same-front leaves all riding fields unchanged", () => {
  const f = fixture(), p = f.entry.checkpoint.context.player;
  const mounted = projectFieldTransportActorInstance(p, f.operations, f.partyCatalog, presentation);
  assert.deepEqual(mounted, { ...p, fieldAssetId: 38, riderFieldAssetId: p.fieldAssetId, riding: true });
  assert.deepEqual(projectFieldTransportActorInstance(mounted, f.operations, f.partyCatalog, presentation), mounted);
  const forced = projectFieldTransportActorInstance(mounted, [{ ...f.operations[0]!, skipIfSameOuter: false } as FieldTransportActorOperation], f.partyCatalog, presentation);
  assert.equal(forced.riderFieldAssetId, 38, "SetupCharaAsset must supply its base replacement before forced RideOn");
  assert.equal(p.riding, false);
});

test("NPC RideOut restores and clears rider cache while SetupCharaAsset RideOut preserves it", () => {
  const f = fixture(), mounted = projectFieldTransportActorInstance(f.entry.checkpoint.context.player, f.operations, f.partyCatalog, presentation);
  const npc = projectFieldTransportActorInstance(mounted, [{ kind: "ride-out", actorId: mounted.id, restoreRiderAsset: true }], f.partyCatalog, presentation);
  assert.equal(npc.riding, false); assert.equal(npc.fieldAssetId, mounted.riderFieldAssetId); assert.equal(npc.riderFieldAssetId, null);
  const setup = projectFieldTransportActorInstance(mounted, [
    { kind: "replace", actorId: mounted.id, fieldAssetId: 3 }, { kind: "ride-out", actorId: mounted.id, restoreRiderAsset: false },
  ], f.partyCatalog, presentation);
  assert.deepEqual(setup, { ...mounted, riding: false, fieldAssetId: 3 });
  assert.deepEqual(projectFieldTransportActorInstance(npc, [{ kind: "ride-out", actorId: npc.id, restoreRiderAsset: true }], f.partyCatalog), npc);
});

test("strict-source mode never treats an incomplete dual-layer renderer as implemented", () => {
  const f = fixture(), { presentation: _, ...strict } = f.transportInput;
  assert.throws(() => projectFieldTransportActors(strict), /framework-development/);
  assert.throws(() => new FieldPartyActors(f.partyCatalog, f.entry.checkpoint, 1).prepareTransportation({ operations: f.operations }), /framework-development/);
  const projected = projectFieldTransportActors(f.transportInput);
  assert.throws(() => createNativeFieldActorProjections({ ...f.prior, ...projected }, f.map.mapRange, f.partyCatalog), /framework-development/);
});

test("native riding changes media on a detached candidate and preserves all pose/material identities", () => {
  const f = fixture(), before = serial(f.prior), player = f.prior.snapshot.actors[0]!;
  player.animation!.playEntity("WalkR", true); player.animation!.advance(130);
  const original = serial(f.prior), projected = projectFieldTransportActors(f.transportInput), after = projected.snapshot.actors[0]!;
  assert.notEqual(original, before); assert.equal(serial(f.prior), original);
  assert.equal(projected.assets[0]!.fieldAssetId, 38); assert.equal(after.riderAssetId, 2); assert.equal(after.riding, true);
  assert.equal(after.rideOnEntity, "riding"); assert.equal(after.animation!.character, f.characters.armor);
  assert.equal(after.animation!.snapshot()!.elapsed, player.animation!.snapshot()!.elapsed);
  assert.deepEqual({ ...after, animation: null, riderAssetId: null, riding: false, rideOnEntity: "idle" }, { ...player, animation: null });
});

test("native actor getters read inner and outer from the same mutable entity and inactive caches remain legal", () => {
  const f = fixture(), mounted = projectFieldTransportActors(f.transportInput);
  const owner = createNativeFieldActorProjections({ ...f.prior, ...mounted }, f.map.mapRange, f.partyCatalog, presentation);
  const player = owner.find((a) => a.id === f.prior.bindings.player)!;
  assert.equal(player.asset, "bravo"); assert.equal(player.mount, "armor"); assert.equal(player.animation!.character, f.characters.armor);
  player.native.entity.riderAssetId = 3; assert.equal(player.asset, "charlie");
  player.native.entity.riding = false; player.native.entity.rideOnEntity = "idle";
  assert.equal(player.mount, null); assert.equal(player.asset, "armor");
  const preserved = createNativeFieldActorProjections({ ...f.prior, snapshot: readNativeFieldActors(Object.fromEntries(owner.map((a) => [a.id, a])), null), assets: mounted.assets }, f.map.mapRange, f.partyCatalog);
  assert.equal(preserved[0]!.native.entity.riderAssetId, 3);
  player.native.entity.riderAssetId = 999; assert.throws(() => player.asset, /Unbound/);
});

test("bad later media or missing native ride component leaves the complete old candidate untouched", () => {
  const f = fixture(), before = serial(f.prior);
  assert.throws(() => projectFieldTransportActors({ ...f.transportInput, operations: [...f.operations,
    { kind: "replace-rider", actorId: f.prior.bindings.player, fieldAssetId: 999 }] }), /Unknown/);
  assert.equal(serial(f.prior), before);
  const broken = { ...f.characters }; delete broken.armor;
  assert.throws(() => projectFieldTransportActors({ ...f.transportInput, characters: broken }), /Unbound/);
  assert.equal(serial(f.prior), before);
  f.prior.snapshot.actors[0]!.rideOnEntity = "absent";
  assert.throws(() => projectFieldTransportActors(f.transportInput), /no source ride-on/);
});

test("shared native publication retains actual actor identities and rejects stale or repeated candidate writes", () => {
  const f = fixture(), owner = Object.fromEntries(createNativeFieldActorProjections(f.prior, f.map.mapRange, f.partyCatalog, presentation).map((a) => [a.id, a]));
  const next = projectFieldTransportActors(f.transportInput), draft = Object.fromEntries(createNativeFieldActorProjections({ ...f.prior, ...next }, f.map.mapRange, f.partyCatalog, presentation).map((a) => [a.id, a]));
  const host = { readActors: () => owner, readCamera: () => f.prior.snapshot.camera, readProviders: () => f.input.providers };
  const old = owner[f.prior.bindings.player]!, entity = old.native.entity;
  const stale = prepareNativeFieldActorState(host, draft); old.native.entity.visible = false;
  assert.throws(() => stale.validate(), /Stale/); assert.equal(old.mount, null);
  old.native.entity.visible = true;
  const pending = prepareNativeFieldActorState(host, draft); pending.validate(); pending.commit();
  assert.equal(owner[old.id], old); assert.equal(old.native.entity, entity); assert.equal(old.mount, "armor");
  assert.throws(() => pending.commit(), /current validation/);
});

test("transport bookkeeping has one-use revisions, detached checkpoints and explicit current transport writes", () => {
  const f = fixture(), old = f.bookkeeping.checkpoint(), pending = f.bookkeeping.prepareTransportation({ operations: f.operations });
  assert.deepEqual(f.bookkeeping.checkpoint(), old); assert.deepEqual(pending.checkpoint.context.currentTransport, old.context.currentTransport);
  pending.checkpoint.context.player.riderFieldAssetId = 999;
  pending.validate(); pending.commit(); assert.equal(f.bookkeeping.checkpoint().context.player.riderFieldAssetId, 2);
  assert.throws(() => pending.commit(), /current validation/);
  const stale = f.bookkeeping.prepareTransportation({ operations: [], currentTransport: { id: 6, typeId: 12, fieldAssetId: 38 } });
  f.bookkeeping.restore(f.bookkeeping.checkpoint()); assert.throws(() => stale.validate(), /Stale/);
  const known = f.bookkeeping.prepareTransportation({ operations: [], currentTransport: { id: 6, typeId: 12, fieldAssetId: 38 } });
  known.validate(); known.commit(); assert.equal(f.bookkeeping.checkpoint().context.currentTransport!.id, 6);
  assert.throws(() => f.bookkeeping.prepareTransportation({ operations: [], currentTransport: { id: 6, typeId: 1, fieldAssetId: 38 } }), /mismatched/);
});

test("restore accepts only bound riding assets and the trusted host's explicit development capability", () => {
  const f = fixture(), pending = f.bookkeeping.prepareTransportation({ operations: f.operations,
    currentTransport: { id: 6, typeId: 12, fieldAssetId: 38 } }); pending.validate(); pending.commit();
  const saved = f.bookkeeping.checkpoint(), restored = new FieldPartyActors(f.partyCatalog, f.entry.checkpoint, 1, presentation);
  restored.restore(saved); assert.deepEqual(restored.checkpoint(), saved);
  const bad = structuredClone(saved); bad.context.player.fieldAssetId = 3;
  assert.throws(() => restored.restore(bad), /Unknown saved transportation outer/); assert.deepEqual(restored.checkpoint(), saved);
  assert.throws(() => new FieldPartyActors(f.partyCatalog, f.entry.checkpoint, 1).restore(saved), /provider change/);
});

test("mounted party appearance replaces only the inner asset and never restarts outer animation", () => {
  const f = fixture(), mounted = projectFieldTransportActors(f.transportInput), owner = Object.fromEntries(createNativeFieldActorProjections({ ...f.prior, ...mounted }, f.map.mapRange, f.partyCatalog, presentation).map((a) => [a.id, a]));
  const actor = owner[f.prior.bindings.player]!, oldAnimation = actor.animation;
  const host = { readActors: () => owner, readCatalog: () => f.partyCatalog, readCharacters: () => f.characters,
    readAnimationKeys: () => f.animationKeys, readProviders: () => f.input.providers, transportationPresentation: presentation };
  const step = { media: { asset: "charlie", mount: "armor" }, plan: { selectedLeaderIndex: 0, savedLeaderIndex: 0,
    changes: [{ actorId: actor.id, asset: f.partyCatalog.assets[3]!, mode: "rider" as const, reason: "leader" as const }],
    playerAssetCache: f.partyCatalog.assets[3]!, cameraOffset: null, colliderChanges: [], companionConditionTypes: null } };
  const update = prepareNativeFieldActorAppearance(host, [step]); update.validate(); update.commit();
  assert.equal(actor.asset, "charlie"); assert.equal(actor.mount, "armor"); assert.equal(actor.animation, oldAnimation);
  assert.equal(actor.native.fieldAssetId, 38); assert.equal(actor.native.entity.riderAssetId, 3);
});

test("map handoff repeats base-to-rider setup while retaining hidden mounted actors and current transport", () => {
  const f = fixture(), puppetId = f.prior.bindings.partyPuppets[0]!;
  const operations: FieldTransportActorOperation[] = [...f.operations,
    { kind: "ride-on", actorId: puppetId, frontAssetId: 38, skipIfSameOuter: true }];
  const mounted = projectFieldTransportActors({ ...f.transportInput, operations });
  const pending = f.bookkeeping.prepareTransportation({ operations, currentTransport: { id: 6, typeId: 12, fieldAssetId: 38 } });
  pending.validate(); pending.commit(); const priorCheckpoint = f.bookkeeping.checkpoint();
  const entry = prepareMapPartyEntry(f.partyCatalog, { definition: f.map, entrance: 7, mapViewType: 0,
    prior: priorCheckpoint, playerVisible: true, party: f.party,
    transportation: { id: 6, type: 12, assetId: 38 }, canPartySwitching: false });
  const input = { prior: { ...f.prior, ...mounted }, priorCheckpoint, entry, definition: f.map, catalog: f.partyCatalog,
    party: f.party, characters: f.characters, animationKeys: f.animationKeys, view: f.view,
    providers: { ...f.input.providers, transportationType: 12 }, transportationPresentation: presentation };
  const next = prepareSourceNativeMap(input), player = next.snapshot.actors.find((a) => a.id === f.prior.bindings.player)!;
  assert.equal(player.riding, true); assert.equal(player.riderAssetId, 2); assert.equal(next.assets[0]!.fieldAssetId, 38);
  assert.equal(player.animation!.character, f.characters.armor); assert.equal(player.direction, "up");
  const puppet = next.snapshot.actors.find((a) => a.id === puppetId)!;
  assert.equal(puppet.riding, true);
  assert.equal(puppet.riderAssetId, mounted.snapshot.actors.find((a) => a.id === puppetId)!.riderAssetId);
  assert.equal(puppet.visible, false);
  assert.deepEqual(puppet.position, mounted.snapshot.actors.find((a) => a.id === puppetId)!.position);
  const { transportationPresentation: _, ...strict } = input;
  assert.throws(() => prepareSourceNativeMap(strict), /walking transportation|framework-development/);
});

test("ordinary map handoff preserves an inactive rider cache without pretending the actor remains mounted", () => {
  const f = fixture(), id = f.prior.bindings.player, operations: FieldTransportActorOperation[] = [...f.operations,
    { kind: "replace", actorId: id, fieldAssetId: 2 }, { kind: "ride-out", actorId: id, restoreRiderAsset: false }];
  const native = projectFieldTransportActors({ ...f.transportInput, operations });
  const pending = f.bookkeeping.prepareTransportation({ operations }); pending.validate(); pending.commit();
  const priorCheckpoint = f.bookkeeping.checkpoint();
  const entry = prepareMapPartyEntry(f.partyCatalog, { definition: f.map, entrance: 7, mapViewType: 0,
    prior: priorCheckpoint, playerVisible: true, party: f.party, transportation: f.fresh.entry.transportation, canPartySwitching: false });
  const next = prepareSourceNativeMap({ prior: { ...f.prior, ...native }, priorCheckpoint, entry, definition: f.map,
    catalog: f.partyCatalog, party: f.party, characters: f.characters, animationKeys: f.animationKeys,
    view: f.view, providers: f.input.providers });
  assert.equal(next.snapshot.actors[0]!.riding, false); assert.equal(next.snapshot.actors[0]!.riderAssetId, 2);
});

function checkpointFixture(mounted: boolean) {
  const f = fixture(), id = f.prior.bindings.player;
  const operations: FieldTransportActorOperation[] = mounted ? f.operations : [...f.operations,
    { kind: "replace", actorId: id, fieldAssetId: 2 }, { kind: "ride-out", actorId: id, restoreRiderAsset: false }];
  const projected = projectFieldTransportActors({ ...f.transportInput, operations });
  const state = f.bookkeeping.prepareTransportation({ operations }); state.validate(); state.commit();
  const owner = Object.fromEntries(createNativeFieldActorProjections({ ...f.prior, ...projected }, f.map.mapRange, f.partyCatalog, presentation).map((a) => [a.id, a]));
  const context: FieldNativeCheckpointContext = { mapRange: f.map.mapRange, bindings: f.prior.bindings, factory: f.factory,
    partyCatalog: f.partyCatalog, partyCheckpoint: f.bookkeeping.checkpoint(), characters: f.characters,
    npcs: [], providers: f.input.providers, transportationPresentation: presentation };
  return { ...f, owner, context };
}

test("native checkpoint restores mounted asset ownership from trusted party context without replaying RideOn", () => {
  const f = checkpointFixture(true), id = f.prior.bindings.player, player = f.owner[id]!;
  player.animation!.playEntity("WalkR", true); player.animation!.advance(125);
  const saved = captureFieldNativeCheckpoint(f.owner, f.context);
  assert.ok(saved.actors.every((a) => !Object.hasOwn(a, "riderAssetId") && !Object.hasOwn(a, "fieldAssetId")));
  const look = ActorAnimation.prototype.look, cue = ActorAnimation.prototype.cue;
  ActorAnimation.prototype.look = () => { throw new Error("No init during restore"); };
  ActorAnimation.prototype.cue = () => { throw new Error("No RideOn cue during restore"); };
  try {
    const recovered = Object.fromEntries(restoreFieldNativeCheckpoint(saved, f.context).map((a) => [a.id, a]));
    assert.equal(recovered[id]!.mount, "armor"); assert.equal(recovered[id]!.asset, "bravo");
    assert.deepEqual(recovered[id]!.animation!.snapshot(), player.animation!.snapshot());
    assert.deepEqual(captureFieldNativeCheckpoint(recovered, f.context), saved);
  } finally { ActorAnimation.prototype.look = look; ActorAnimation.prototype.cue = cue; }
});

test("native checkpoint permits a proven inactive cache without a riding presentation host", () => {
  const f = checkpointFixture(false), { transportationPresentation: _, ...context } = f.context;
  const saved = captureFieldNativeCheckpoint(f.owner, context), recovered = restoreFieldNativeCheckpoint(saved, context)[0]!;
  assert.equal(recovered.mount, null); assert.equal(recovered.native.entity.riderAssetId, 2);
  assert.equal(recovered.native.entity.rideOnEntity, "idle");
});

test("native checkpoint rejects context drift, missing inner media and source-mode mounted restoration", () => {
  const f = checkpointFixture(true), saved = captureFieldNativeCheckpoint(f.owner, f.context);
  const { transportationPresentation: _, ...strict } = f.context;
  assert.throws(() => restoreFieldNativeCheckpoint(saved, strict), /framework-development/);
  f.owner[f.prior.bindings.player]!.native.entity.riderAssetId = 3;
  assert.throws(() => captureFieldNativeCheckpoint(f.owner, f.context), /lifecycle provider/);
  const characters = { ...f.characters }; delete characters.bravo;
  assert.throws(() => restoreFieldNativeCheckpoint(saved, { ...f.context, characters }), /rider media/);
  const corrupted = structuredClone(saved); Object.assign(corrupted.actors[0]!, { riding: false, riderAssetId: 999 });
  assert.throws(() => restoreFieldNativeCheckpoint(corrupted, f.context), /fields/);
});
