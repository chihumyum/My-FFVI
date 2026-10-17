import test from "node:test";
import assert from "node:assert/strict";
import { FieldEffects, projectFieldEffects, createFieldEffectState } from "../src/core/field-effects.js";
import { createWebLogicalFieldEffectsHost, WEB_LOGICAL_FIELD_EFFECTS, validateLogicalEffectCatalog } from "../src/core/field-logical-effects.js";
import { compileWebLogicalEffectCatalog } from "../src/compiler/field-logical-effects.js";
import { logicalEffectCatalog } from "./fixtures/logical-field-effects.js";
import { sourceCatalogProfile, assertSourceEntryProfiles } from "../src/core/source-catalog.js";

function owner() {
  const f = logicalEffectCatalog(), host = createWebLogicalFieldEffectsHost(), effects = new FieldEffects(f.catalog, host);
  effects.prepare([{ kind: "create", id: "board", definition: f.definition, position: { x: 0, y: 0, z: 349 } },
    { kind: "setup", registeredBoards: ["board"], groupUpdate: false }]).commit();
  return { ...f, host, effects };
}
test("logical policy retains strict simulation blockers and requires its actual runtime port", () => {
  const f = logicalEffectCatalog(), before = structuredClone(f.input);
  assert.ok(f.catalog.media.controlled_effect!.blockers.some(reason => reason.includes("NoiseModule")));
  assert.equal(f.catalog.webPolicy!.nativeParity, false);
  assert.throws(() => new FieldEffects(f.catalog), /matching Web host/);
  assert.deepEqual(f.input, before);
  const strict = structuredClone(f.catalog); delete strict.webPolicy;
  assert.throws(() => projectFieldEffects(createFieldEffectState(), strict, [{ kind: "create", id: "x", definition: f.definition,
    position: { x: 0, y: 0, z: 349 } }]), /provider unavailable/);
});
test("non-loop, collision callbacks, Animator and source manifests never acquire a logical policy", () => {
  for (const change of [
    (f: ReturnType<typeof logicalEffectCatalog>) => { f.particle.data.looping = false; },
    (f: ReturnType<typeof logicalEffectCatalog>) => { (f.particle.data.CollisionModule as { enabled: boolean }).enabled = true; },
    (f: ReturnType<typeof logicalEffectCatalog>) => { f.graph.objects[2]!.type = "Animator"; },
    (f: ReturnType<typeof logicalEffectCatalog>) => { f.input.parentSourceSetHash = "foreign-source"; },
  ]) { const f = logicalEffectCatalog(); change(f); assert.throws(() => compileWebLogicalEffectCatalog(f.input, f.origin)); }
});
test("one actual owner performs automatic and positive playback without fabricated particle booleans", () => {
  const f = owner(); assert.equal(f.effects.logicalPolicy, WEB_LOGICAL_FIELD_EFFECTS);
  const observation = f.host.observe(f.effects.snapshot(), .01);
  assert.deepEqual(observation, [{ cameraId: 1, kind: "all-loop-completion-independent-v1" }]);
  f.effects.prepareTick(.01).commit(); assert.equal(f.effects.snapshot().players[0]!.playing, true);
  f.effects.prepare([{ kind: "play", id: "board", loopLimit: 3 }]).commit();
  for (let i = 1; i <= 3; i++) { f.effects.prepareTick(.01).commit();
    assert.equal(f.effects.snapshot().players[0]!.loopCount, i); assert.equal(f.effects.snapshot().players[0]!.playing, i < 3); }
  assert.equal(f.effects.snapshot().players[0]!.elapsedSec, Math.fround(Math.fround(Math.fround(.01) + Math.fround(.01)) + Math.fround(.02)));
  assert.equal(f.effects.snapshot().boards.length, 1);
});
test("proof observations reject strict catalogs, mixed loops, changed source binding and hybrid fake arrays", () => {
  const f = owner(), before = f.effects.snapshot();
  assert.throws(() => f.effects.prepare([{ kind: "tick", deltaSeconds: .01,
    observations: [{ cameraId: 1, kind: "all-loop-completion-independent-v1", particlePlaying: [] } as never] }]), /playback/);
  assert.deepEqual(f.effects.snapshot(), before);
  for (const change of [
    (x: typeof f.catalog) => { x.media.controlled_effect!.particles[0]!.loop = false; },
    (x: typeof f.catalog) => { x.webPolicy!.proofs.controlled_effect!.components.push({ id: "91", type: "MonoBehaviour" }); },
    (x: typeof f.catalog) => { x.webPolicy!.proofs.controlled_effect!.source.sha256 = "invalid"; },
  ]) { const catalog = structuredClone(f.catalog); change(catalog); assert.throws(() => validateLogicalEffectCatalog(catalog)); }
});
test("failed/stale candidate cannot publish; one retried journal retains release-before-reallocate identities", () => {
  const f = owner(), before = f.effects.snapshot(), stale = f.effects.fork();
  stale.prepare([{ kind: "release-prefab", assetGroup: "controlled_effect" }, { kind: "destroy", id: "board" }]).commit();
  assert.deepEqual(f.effects.snapshot(), before);
  f.effects.prepareTick(.01).commit(); assert.throws(() => stale.seal(), /Stale/); stale.discard();
  const next = f.effects.fork(); next.prepare([{ kind: "release-prefab", assetGroup: "controlled_effect" }, { kind: "destroy", id: "board" },
    { kind: "create", id: "next-board", definition: f.definition, position: { x: 0, y: 0, z: 349 } },
    { kind: "setup", registeredBoards: ["next-board"], groupUpdate: false }]).commit();
  next.seal().commit(); assert.equal(f.effects.snapshot().instanceCount, 2);
  assert.equal(f.effects.snapshot().players[0]!.cameraId, 2);
});
test("logical restore seeds one owner exactly and rejects extra fields, invalid refs and absent Web port", () => {
  const f = owner(); f.effects.prepareTick(.03).commit(); const snapshot = f.effects.snapshot();
  const restored = FieldEffects.restoreLogical(f.catalog, createWebLogicalFieldEffectsHost(), snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  for (const change of [
    (x: typeof snapshot) => { Object.assign(x, { rng: 123 }); },
    (x: typeof snapshot) => { x.players[0]!.references++; },
    (x: typeof snapshot) => { x.players[0]!.elapsedSec = .1; },
    (x: typeof snapshot) => { x.shared.unknown_group = 1; },
  ]) { const bad = structuredClone(snapshot); change(bad); assert.throws(() => FieldEffects.restoreLogical(f.catalog, f.host, bad)); }
  assert.deepEqual(f.effects.snapshot(), snapshot);
});
test("logical gameplay policy cannot appear on one destination or be granted by a checkpoint field", () => {
  const profile = { kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
    sourceContentHash: "a".repeat(64), omissions: [] };
  const declared = { ...profile, logicalFieldEffects: WEB_LOGICAL_FIELD_EFFECTS };
  assert.equal(sourceCatalogProfile(declared), "framework");
  assert.throws(() => assertSourceEntryProfiles({ developmentProfile: profile }, { developmentProfile: profile },
    { developmentProfile: profile }, { developmentProfile: declared }), /profile mismatch/);
});
