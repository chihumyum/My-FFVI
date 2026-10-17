import test from "node:test";
import assert from "node:assert/strict";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { fieldPuppetActorsFixture, fieldPuppetActorHostFixture } from "./fixtures/field-puppet-actors.js";
import { projectFieldPuppetInitialization, projectFieldPuppetActorEntry, fieldPuppetAssignments } from "../src/core/field-puppet-actors.js";
import { projectFieldPuppetActorEffects, fieldPuppetSemiTransparent, fieldPuppetTransparentTextures,
  type FieldPuppetHostSnapshot, type FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";
import { fieldPuppetControlStep } from "../src/core/field-task-control.js";

function media() {
  const source = { file: "synthetic", assetPath: "puppet" };
  const animation = new ActorAnimation({ source,
    sprites: { body: { file: "body.png", width: 16, height: 24, pivot: [0.5, 0], sha256: "synthetic", source } },
    animations: Object.fromEntries(["Default", "WalkB", "WalkL", "WalkR", "wave"].map((key) => [key, {
      frames: [{ sprite: "body", x: 0, y: 0, alpha: 1, flip: false }], duration: 0.5, mode: 0, next: "", flip: false,
    }])),
  });
  animation.cue("Default", -1); return animation;
}
function host() {
  const f = fieldPuppetActorsFixture();
  const snapshot: FieldPuppetHostSnapshot = {
    actors: f.context.actors.map((a) => ({ ...a,
      position: a.id === "player" ? { x: 12, y: -24, z: 3 } : { x: 4, y: -8, z: 0 },
      layer: 9, direction: "down", animation: media(), visible: a.id === "player", fadeAlpha: a.id === "player" ? 1 : 0,
      childEntityObject: "absent", moving: false, riderAssetId: null, rideOnEntity: "idle",
      bodyOpaque: true, shadowVisible: true, viewBinding: { map: "synthetic-source-map", layer: 9 },
      transparentTextures: { first: null, second: null },
    })), camera: { id: "camera", position: { x: 0, y: 0, z: 0 }, layer: 9 },
  };
  const providers: FieldPuppetHostProviders = { mapRenderContext: "synthetic-source-map", transportationType: 1,
    footAttribute: () => 0, upperTexture: null, ceilTexture: null };
  return { ...f, snapshot, providers };
}
function serial(snapshot: FieldPuppetHostSnapshot) {
  return { camera: snapshot.camera, actors: snapshot.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() })) };
}

test("ordinary source actor lifecycle applies on a detached host then restores the moved leader", () => {
  const f = host(), before = serial(f.snapshot);
  const start = projectFieldPuppetInitialization({ ...f, phase: "start" });
  const next = projectFieldPuppetActorEffects(start.effects, f.snapshot, f.providers);
  assert.deepEqual(serial(f.snapshot), before);
  assert.deepEqual(next.camera?.position, { x: 12, y: -24, z: 3 });
  const leader = next.actors.find((a) => a.id === "puppet:2")!;
  assert.deepEqual(leader.position, { x: 12, y: -24, z: 3 });
  assert.equal(leader.visible, false);
  const entry = projectFieldPuppetActorEntry({ ...f, entityId: -1001, nextMnemonic: "Move", leaderId: start.leaderId,
    assignments: start.assignments ?? fieldPuppetAssignments() });
  const staged = projectFieldPuppetActorEffects(entry.effects, next, f.providers);
  assert.equal(staged.actors.find((a) => a.id === "player")!.visible, false);
  const moved = staged.actors.find((a) => a.id === "puppet:2")!;
  moved.position.x = 18; moved.direction = "left"; moved.animation!.cue("wave", -1);
  const finished = projectFieldPuppetActorEffects(projectFieldPuppetInitialization({ ...f, phase: "finish" }).effects, staged, f.providers);
  const player = finished.actors.find((a) => a.id === "player")!;
  assert.equal(player.position.x, 18); assert.equal(player.direction, "left");
  assert.equal(player.animation!.snapshot()!.key, "wave"); assert.equal(player.visible, true);
  assert.equal(finished.actors.find((a) => a.id === "puppet:2")!.visible, false);
});

test("late animation/media failure rolls back prior copied positions, visibility, camera and playback", () => {
  const f = host();
  const target = f.snapshot.actors.find((a) => a.id === "puppet:2")!;
  target.animation = null;
  const before = serial(f.snapshot), plan = projectFieldPuppetInitialization({ ...f, phase: "start" });
  assert.throws(() => projectFieldPuppetActorEffects(plan.effects, f.snapshot, f.providers), /animation/);
  assert.deepEqual(serial(f.snapshot), before);
});

test("source transparency depends on FF6 forest and river lists rather than every transport", () => {
  for (const foot of [9, 30]) for (const type of [1, 9, 12]) assert.equal(fieldPuppetSemiTransparent(type, foot), true);
  for (const foot of [10, 11, 12, 13]) {
    assert.equal(fieldPuppetSemiTransparent(9, foot), true);
    assert.equal(fieldPuppetSemiTransparent(1, foot), false);
  }
  assert.equal(fieldPuppetSemiTransparent(null, 0), false);
  assert.throws(() => fieldPuppetSemiTransparent("unknown", 0), /Unknown/);
  assert.throws(() => fieldPuppetSemiTransparent(1, null), /Unknown/);
});

test("transparent head texture mapping uses actual Unity layer 9/10 and clears other layers", () => {
  assert.deepEqual(fieldPuppetTransparentTextures(9, "upper", "ceil"), { first: "upper", second: "ceil" });
  assert.deepEqual(fieldPuppetTransparentTextures(10, "upper", "ceil"), { first: "ceil", second: null });
  assert.deepEqual(fieldPuppetTransparentTextures(11, "upper", "ceil"), { first: null, second: null });
  assert.throws(() => fieldPuppetTransparentTextures(9, "unknown", null), /Unknown/);
});

test("same-layer source shader refresh is admitted; unbound or different-layer projection rejects", () => {
  const f = host(), effects = [{ kind: "apply-view-properties", actor: "player" }] as const;
  assert.doesNotThrow(() => projectFieldPuppetActorEffects(effects, f.snapshot, f.providers));
  f.snapshot.actors[0]!.viewBinding = null;
  assert.throws(() => projectFieldPuppetActorEffects(effects, f.snapshot, f.providers), /shader/);
  f.snapshot.actors[0]!.viewBinding = { map: "synthetic-source-map", layer: 10 };
  assert.throws(() => projectFieldPuppetActorEffects(effects, f.snapshot, f.providers), /shader/);
});

test("source RideOut never silently clears a cached rider asset or a mounted renderer", () => {
  const f = host(), effects = [{ kind: "ride-out", actor: "player" }] as const;
  assert.doesNotThrow(() => projectFieldPuppetActorEffects(effects, f.snapshot, f.providers));
  f.snapshot.actors[0]!.riderAssetId = 1;
  assert.throws(() => projectFieldPuppetActorEffects(effects, f.snapshot, f.providers), /RideOut/);
  f.snapshot.actors[0]!.riderAssetId = null; f.snapshot.actors[0]!.rideOnEntity = "riding";
  assert.throws(() => projectFieldPuppetActorEffects(effects, f.snapshot, f.providers), /RideOut/);
});

test("unknown child hierarchy, semi-transparent terrain, active movement and new RT composition retain gates", () => {
  const f = host(), before = serial(f.snapshot);
  const changed = host(); changed.snapshot.actors[0]!.childEntityObject = "unknown";
  assert.throws(() => projectFieldPuppetActorEffects([{ kind: "hide", actor: "player" }], changed.snapshot, changed.providers), /child/);
  assert.throws(() => projectFieldPuppetActorEffects([{ kind: "switch-transparent", actor: "player" }], f.snapshot,
    { ...f.providers, footAttribute: () => 9 }), /semi-transparent/);
  assert.throws(() => projectFieldPuppetActorEffects([{ kind: "attach-transparent", actor: "player" }], f.snapshot,
    { ...f.providers, upperTexture: "upper-rt" }), /composition/);
  changed.snapshot.actors[0]!.moving = true;
  assert.throws(() => projectFieldPuppetActorEffects([{ kind: "copy-position", actor: "puppet:0", from: "player", mode: "overwrite" }],
    changed.snapshot, changed.providers), /movement/);
  assert.deepEqual(serial(f.snapshot), before);
});

test("source host prepares actor lifecycle and all three collision gates before one publication", () => {
  const f = fieldPuppetActorHostFixture({ worldMapScript: false, callback: "absent" });
  const before = serial(f.snapshot());
  const publish = f.port.prepare(projectFieldPuppetInitialization({ ...f, phase: "start" }));
  const slots = Array(32).fill("sleep"); slots[3] = "awake";
  const exec = fieldPuppetControlStep({ kind: "exec", firstClock: true, asynchronous: true,
    slots, ...f.port.controlContext() });
  const collision = f.port.prepareCollision(exec.collisionEnabled!);
  assert.deepEqual(serial(f.snapshot()), before);
  assert.deepEqual(f.collision(), { mapColliders: true, entityCollision: true, interactiveObservation: true });
  publish(); collision();
  assert.deepEqual(f.snapshot().camera?.position, { x: 12, y: -24, z: 3 });
  assert.deepEqual(f.collision(), { mapColliders: false, entityCollision: false, interactiveObservation: false });
});

test("unknown Exec callback is rejected before actor or collision publication", () => {
  const f = fieldPuppetActorHostFixture({ worldMapScript: false, callback: "unknown" });
  const before = serial(f.snapshot()), slots = Array(32).fill("sleep"); slots[4] = "awake";
  assert.throws(() => fieldPuppetControlStep({ kind: "exec", firstClock: true, asynchronous: false,
    slots, ...f.port.controlContext() }), /callback/);
  assert.deepEqual(serial(f.snapshot()), before);
  assert.deepEqual(f.collision(), { mapColliders: true, entityCollision: true, interactiveObservation: true });
});
