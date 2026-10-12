import test from "node:test";
import assert from "node:assert/strict";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";
import { createFieldActorFactoryCandidate, createFreshFieldPartyActorCheckpoint, fieldPuppetContextFromActors } from "../src/core/field-actor-factory.js";
import { compileFieldActorFactory } from "../src/compiler/field-actor-factory.js";
import { compileFieldActorView } from "../src/compiler/field-actor-view.js";
import { projectFieldActorView } from "../src/core/field-actor-view.js";
import { projectFieldPuppetActorEffects } from "../src/core/field-puppet-effects.js";
import { projectFieldPuppetInitialization, resolveFieldPuppetActor, type FieldPuppetActorCatalog } from "../src/core/field-puppet-actors.js";

const serial = (candidate: ReturnType<typeof createFieldActorFactoryCandidate>) => ({ ...candidate,
  snapshot: { ...candidate.snapshot, actors: candidate.snapshot.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() ?? null })) } });

test("fresh factory keeps actual player identity separate from four aliases and native dormant transforms", () => {
  const f = fieldActorFactoryFixture(), before = structuredClone(f.entry.checkpoint), result = createFieldActorFactoryCandidate(f.input);
  assert.equal(f.initial.context.leaderIndex, -1);
  assert.equal(f.initial.context.player.fieldAssetId, null);
  assert.equal(f.initial.playerAssetCacheId, null);
  assert.equal(result.snapshot.actors.length, 18);
  assert.equal(result.bindings.player, "-1001");
  assert.equal(result.bindings.partyPuppets[0], "native:puppet:0");
  const player = result.snapshot.actors[0]!;
  assert.deepEqual(player.position, { x: -104, y: 72, z: -2 });
  assert.equal(player.layer, 9); assert.equal(player.direction, "up"); assert.equal(player.animation!.snapshot()!.key, "WalkB");
  for (const actor of result.snapshot.actors.slice(1)) {
    assert.deepEqual(actor.position, { x: 30000, y: 1000, z: -1000 });
    assert.equal(actor.layer, 0); assert.equal(actor.direction, null); assert.equal(actor.animation?.snapshot() ?? null, null);
    assert.equal(actor.viewBinding, null); assert.equal(actor.childEntityObject, "absent");
    assert.equal(actor.rideOnEntity, "idle"); assert.equal(actor.riderAssetId, null);
    assert.equal(actor.visible, actor.id.startsWith("native:resident:"));
  }
  assert.deepEqual(result.assets.filter((a) => a.id.startsWith("native:party:")).map((a) => a.fieldAssetId), [null, null, null]);
  assert.equal(result.assets[0]!.charaZOffset, 0.5, "PointIn finishes FieldPlayer.Init before this candidate");
  assert.ok(result.assets.slice(1).every((a) => a.charaZOffset === 0.5));
  assert.deepEqual(f.entry.checkpoint, before);
});

test("fresh metadata cannot borrow a development condition, changed owner, or mounted checkpoint", () => {
  const f = fieldActorFactoryFixture();
  const changed = structuredClone(f.party); changed.activeMembers[0]!.conditionIds.push(53);
  assert.throws(() => createFreshFieldPartyActorCheckpoint({ factory: f.factory, catalog: f.partyCatalog,
    fresh: f.fresh, party: changed, map: f.map, playerId: "-1001" }), /ownership/);
  const mounted = structuredClone(f.entry.checkpoint); mounted.context.player.riding = true;
  assert.throws(() => createFieldActorFactoryCandidate({ ...f.input, checkpoint: mounted }), /riding/);
  assert.throws(() => compileFieldActorFactory(f.sources.map((s, i) => i === 0 ? { ...s, sha256: "0".repeat(64) } : s)), /Unreviewed/);
});

test("missing resident media and unknown material providers fail before any actor publication", () => {
  const f = fieldActorFactoryFixture(), before = structuredClone(f.entry.checkpoint), characters = { ...f.characters };
  delete characters.frog;
  assert.throws(() => createFieldActorFactoryCandidate({ ...f.input, characters }), /media/);
  const { applyViewProperties, ...providers } = f.input.providers;
  assert.throws(() => createFieldActorFactoryCandidate({ ...f.input, providers }), /material provider/);
  assert.throws(() => createFieldActorFactoryCandidate({ ...f.input, providers: { ...f.input.providers,
    applyViewProperties: () => null } }), /material projection/);
  assert.deepEqual(f.entry.checkpoint, before);
});

test("source ordinary material projection changes layer atomically while preserving explicit defaults", () => {
  const f = fieldActorFactoryFixture(), c = createFieldActorFactoryCandidate(f.input), before = serial(c);
  const next = projectFieldPuppetActorEffects([
    { kind: "copy-layer", actor: "native:puppet:0", from: "-1001" },
    { kind: "apply-view-properties", actor: "native:puppet:0" },
    { kind: "look", actor: "native:puppet:0", from: "-1001" },
  ], c.snapshot, f.input.providers);
  const puppet = next.actors.find((a) => a.id === "native:puppet:0")!;
  assert.equal(puppet.viewBinding!.properties!.renderLayer, 0);
  assert.deepEqual(puppet.viewBinding!.properties!.mapPixels, { width: 320, height: 256 });
  assert.equal(puppet.viewBinding!.properties!.water.noiseSpeed, Math.fround(0.05));
  assert.equal(puppet.viewBinding!.properties!.textures.water, "black");
  assert.equal(puppet.direction, "up"); assert.equal(puppet.animation!.snapshot()!.key, "WalkB");
  assert.deepEqual(serial(c), before);
  assert.equal(projectFieldActorView(f.view, 0), null);
  assert.equal(projectFieldActorView(f.view, 12)!.renderLayer, 6);
  assert.throws(() => projectFieldPuppetActorEffects([{ kind: "look", actor: "-1001", from: "native:puppet:0" }], c.snapshot, f.input.providers), /zero-direction/);
  assert.deepEqual(serial(c), before);
});

test("custom shader, water and palette sources cannot inherit ordinary material admission", () => {
  const f = fieldActorFactoryFixture();
  const tilemap = structuredClone(f.tilemap);
  (tilemap.data.layers[0]!.layers[0] as Record<string, unknown>).properties = [{ name: "opaque_shader", value: "Water" }];
  assert.throws(() => compileFieldActorView(f.sources, tilemap, f.mapPackage, f.view.mapSize), /shader/);
  const pkg = structuredClone(f.mapPackage); pkg.data.texture.push({ name: "plain_pal_anim", asset: "plain_pal_anim" });
  assert.throws(() => compileFieldActorView(f.sources, f.tilemap, pkg, f.view.mapSize), /palette/);
  assert.throws(() => compileFieldActorView(f.sources, { ...f.tilemap, source: { ...f.tilemap.source, sha256: "b".repeat(64) } }, f.mapPackage, f.view.mapSize), /Foreign/);
});

test("runtime context derives current owned identity and poses without a second mutable actor store", () => {
  const f = fieldActorFactoryFixture(), c = createFieldActorFactoryCandidate(f.input);
  const catalog: FieldPuppetActorCatalog = { kind: "field-puppet-actors-v1", memberCount: 4, characteristics: true,
    corpsOrder: [0, 1, 2, 3], residents: [], conditionChanges: [], miscHash: "b".repeat(64) };
  const input = { catalog, checkpoint: f.entry.checkpoint, bindings: c.bindings, snapshot: c.snapshot,
    owned: [{ ownedId: 17, sourceId: 2, enabled: true, conditionTypes: [] }], party: [17, 0, 0, 0], entities: [],
    restorePartyInstruction: "absent" as const };
  const context = fieldPuppetContextFromActors(input);
  assert.equal(resolveFieldPuppetActor(catalog, context, -1001).actor, "native:puppet:0");
  assert.equal(context.player, "-1001"); assert.equal(context.owned[0]!.ownedId, 17);
  const script = { skipInitialize: false, keepPlayerPuppet: false, keepBadStatusVisual: false, ridingVehicle: false,
    characteristics: true, scriptHash: "a".repeat(64), miscHash: catalog.miscHash };
  const start = projectFieldPuppetInitialization({ catalog, context, script, phase: "start" });
  const next = projectFieldPuppetActorEffects(start.effects, c.snapshot, f.input.providers);
  assert.deepEqual(next.actors.find((a) => a.id === "native:puppet:0")!.position, c.snapshot.actors[0]!.position);
  input.owned[0]!.enabled = false;
  assert.equal(fieldPuppetContextFromActors(input).owned[0]!.enabled, false);
  assert.equal(context.owned[0]!.enabled, true);
  assert.throws(() => fieldPuppetContextFromActors({ ...input, party: [99, 0, 0, 0] }), /Corps/);
  assert.throws(() => fieldPuppetContextFromActors({ ...input, snapshot: { ...c.snapshot, actors: c.snapshot.actors.slice(1) } }), /incomplete/);
});
