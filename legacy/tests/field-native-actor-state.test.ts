import test from "node:test";
import assert from "node:assert/strict";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { createNativeFieldActorDraft, createNativeFieldActorProjection, createNativeFieldActorProjections,
  createNativeFieldPuppetActorsPort, prepareNativeFieldActorState, readNativeFieldActors, type NativeFieldActor,
  type NativeFieldActorEffectHost, type NativeFieldPuppetActorsHost } from "../src/core/field-native-actors.js";
import type { FieldActorMotion } from "../src/core/field-script-motion.js";
import { fieldCameraCellToWorld } from "../src/core/field-camera.js";
import { FieldPartyActors } from "../src/core/field-party-actors.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function fixture(presentation?: "framework-development") {
  const f = fieldActorFactoryFixture();
  f.input.player.position = fieldCameraCellToWorld(f.map.mapRange, { x: 3, y: 4 }, 0);
  const source = createFieldActorFactoryCandidate(f.input);
  const actors: Record<string, NativeFieldActor> = Object.fromEntries(
    createNativeFieldActorProjections(source, f.map.mapRange, f.partyCatalog, presentation).map((actor) => [actor.id, actor]));
  let camera = source.snapshot.camera;
  const host: NativeFieldActorEffectHost = {
    readActors: () => actors, readCamera: () => camera, readProviders: () => f.input.providers,
  };
  const draft = () => Object.fromEntries(Object.values(actors).map((actor) =>
    [actor.id, createNativeFieldActorDraft(actor, f.map.mapRange, f.partyCatalog)]));
  const snapshot = () => ({
    actors: readNativeFieldActors(actors, null).actors.map((actor) => ({ ...actor,
      animation: actor.animation?.snapshot() ?? null })),
    motions: Object.values(actors).map(({ id, motion, steps }) => ({ id, motion: structuredClone(motion), steps })),
  });
  return { f, source, actors, host, draft, snapshot,
    changeCamera: () => { camera = { id: "camera:0", position: { x: 9, y: 8, z: 7 }, layer: 9 }; } };
}

function move(actor: NativeFieldActor): FieldActorMotion {
  const motion: FieldActorMotion = {
    from: { x: 3, y: 4 }, to: { x: 4, y: 4 }, elapsed: 30, duration: 240, manual: false,
    route: { points: [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }], index: 0,
      pendingSegment: false, direction: "right", animation: "WalkR", animationSecondsPerCell: 0.24 },
  };
  actor.motion = motion; actor.steps = 7;
  return motion;
}

test("native drafts copy the whole route without installing or mutating the active actor", () => {
  const t = fixture(), actor = t.actors["-1001"]!, motion = move(actor), before = t.snapshot();
  assert.throws(() => createNativeFieldActorProjection(actor.native, t.f.map.mapRange, t.f.partyCatalog), /moving/);
  const copy = createNativeFieldActorDraft(actor, t.f.map.mapRange, t.f.partyCatalog);
  const copiedMotion = copy.motion as FieldActorMotion;
  assert.notEqual(copy, actor); assert.notEqual(copy.native, actor.native);
  assert.notEqual(copy.native.entity, actor.native.entity); assert.notEqual(copy.animation, actor.animation);
  assert.notEqual(copiedMotion, motion); assert.notEqual(copiedMotion.route, motion.route);
  assert.notEqual(copiedMotion.route!.points, motion.route!.points);
  assert.deepEqual(copiedMotion, motion); assert.equal(copy.steps, 7);
  assert.equal(copy.native.entity.moving, true);
  copy.x = 8; copy.steps++; copiedMotion.elapsed++; copiedMotion.route!.points[1]!.x++;
  copy.animation!.play("wave", false, 1);
  assert.deepEqual(t.snapshot(), before); assert.equal(t.actors[actor.id], actor);
  copy.motion = null;
  assert.equal(copy.native.entity.moving, false); assert.equal(actor.native.entity.moving, true);
});

test("containing publication changes only its static target and preserves every untouched moving identity", () => {
  const t = fixture(), moving = t.actors["-1001"]!, motion = move(moving), candidate = t.draft();
  const idle = t.actors["native:party:0"]!, target = t.actors["native:puppet:0"]!;
  const saved = { actor: moving, native: moving.native, entity: moving.native.entity,
    position: moving.native.entity.position, animation: moving.animation, motion, route: motion.route,
    idleEntity: idle.native.entity, idleAnimation: idle.animation, targetEntity: target.native.entity };
  candidate[target.id]!.native.entity.visible = true;
  candidate[target.id]!.animation!.play("wave", false, 1);
  Object.freeze(moving.native); Object.freeze(moving.native.entity);
  Object.freeze(idle.native); Object.freeze(idle.native.entity);
  const before = t.snapshot(), publication = prepareNativeFieldActorState(t.host, candidate);
  publication.validate(); assert.deepEqual(t.snapshot(), before);
  publication.commit();
  assert.equal(t.actors[moving.id], saved.actor); assert.equal(moving.native, saved.native);
  assert.equal(moving.native.entity, saved.entity); assert.equal(moving.native.entity.position, saved.position);
  assert.equal(moving.animation, saved.animation); assert.equal(moving.motion, saved.motion);
  assert.equal((moving.motion as FieldActorMotion).route, saved.route); assert.equal(moving.steps, 7);
  assert.equal(moving.native.entity.moving, true); assert.equal(idle.native.entity, saved.idleEntity);
  assert.equal(idle.animation, saved.idleAnimation); assert.equal(target.native.entity, saved.targetEntity);
  assert.equal(target.native.entity.visible, true); assert.equal(target.animation!.snapshot()!.key, "wave");
  assert.throws(() => publication.commit(), /current validation/);
  assert.throws(() => publication.validate(), /already committed/);
});

test("unchanged moving candidate needs no writable fields and cannot publish a detached replacement", () => {
  const t = fixture(), actor = t.actors["-1001"]!, motion = move(actor), candidate = t.draft();
  const animation = actor.animation, before = t.snapshot();
  for (const value of Object.values(t.actors)) { Object.freeze(value.native); Object.freeze(value.native.entity); }
  const publication = prepareNativeFieldActorState(t.host, candidate);
  publication.validate(); publication.commit();
  assert.deepEqual(t.snapshot(), before); assert.equal(actor.motion, motion); assert.equal(actor.animation, animation);
  assert.notEqual(actor, candidate[actor.id]); assert.notEqual(actor.native.entity, candidate[actor.id]!.native.entity);
});

test("a changed moving actor requires takeover for pose, visibility, media, playback or route changes", () => {
  const changes = [
    (actor: NativeFieldActor) => { actor.x++; },
    (actor: NativeFieldActor) => { actor.native.entity.visible = false; },
    (actor: NativeFieldActor) => { actor.native.fieldAssetId = (actor.native.fieldAssetId ?? 0) + 1; },
    (actor: NativeFieldActor) => { actor.animation!.play("wave", false, 1); },
    (actor: NativeFieldActor) => { actor.motion!.elapsed++; },
    (actor: NativeFieldActor) => { (actor.motion as FieldActorMotion).route!.points[1]!.x++; },
    (actor: NativeFieldActor) => { actor.motion = null; },
  ];
  for (const change of changes) {
    const t = fixture(); move(t.actors["-1001"]!);
    const candidate = t.draft(), before = t.snapshot(); change(candidate["-1001"]!);
    assert.throws(() => prepareNativeFieldActorState(t.host, candidate), /movement takeover/);
    assert.deepEqual(t.snapshot(), before);
  }
});

test("containing actor state cannot introduce movement or claim moving without its motion owner", () => {
  const t = fixture(), candidate = t.draft(), before = t.snapshot();
  move(candidate["-1001"]!);
  assert.throws(() => prepareNativeFieldActorState(t.host, candidate), /movement takeover/);
  assert.deepEqual(t.snapshot(), before);
  const u = fixture(), moving = u.actors["-1001"]!; move(moving);
  const noMotion = { id: moving.id, native: { ...moving.native,
    entity: { ...moving.native.entity, moving: true } }, steps: moving.steps };
  assert.throws(() => createNativeFieldActorDraft(noMotion, u.f.map.mapRange, u.f.partyCatalog), /complete movement owner/);
  assert.throws(() => prepareNativeFieldActorState(u.host, { ...u.draft(), [moving.id]: noMotion }), /movement takeover/);
});

test("final validation rejects live elapsed, route values and equal replacement identities without publishing other actors", () => {
  const changes = [
    (actor: NativeFieldActor) => { actor.motion!.elapsed++; },
    (actor: NativeFieldActor) => { (actor.motion as FieldActorMotion).route!.points[2]!.y++; },
    (actor: NativeFieldActor) => { (actor.motion as FieldActorMotion).route!.pendingSegment = true; },
    (actor: NativeFieldActor) => { actor.motion = structuredClone(actor.motion); },
    (actor: NativeFieldActor) => { const m = actor.motion as FieldActorMotion; m.route = structuredClone(m.route!); },
    (actor: NativeFieldActor) => { const r = (actor.motion as FieldActorMotion).route!; r.points = structuredClone(r.points); },
  ];
  for (const change of changes) {
    const t = fixture(), actor = t.actors["-1001"]!; move(actor);
    const candidate = t.draft(); candidate["native:puppet:0"]!.native.entity.visible = true;
    const publication = prepareNativeFieldActorState(t.host, candidate);
    publication.validate(); change(actor); const before = t.snapshot();
    assert.throws(() => publication.validate(), /Stale.*owner/);
    assert.throws(() => publication.commit(), /current validation/);
    assert.deepEqual(t.snapshot(), before); assert.equal(t.actors["native:puppet:0"]!.native.entity.visible, false);
  }
});

test("a candidate changed after validation loses permission when the containing transaction validates again", () => {
  for (const change of ["position", "elapsed", "route", "actor", "entity", "animation"] as const) {
    const t = fixture(); move(t.actors["-1001"]!);
    const candidate = t.draft(); candidate["native:puppet:0"]!.native.entity.visible = true;
    const publication = prepareNativeFieldActorState(t.host, candidate), before = t.snapshot();
    publication.validate(); const actor = candidate["-1001"]!;
    if (change === "position") actor.x++;
    if (change === "elapsed") actor.motion!.elapsed++;
    if (change === "route") (actor.motion as FieldActorMotion).route!.points[1]!.x++;
    if (change === "actor") candidate[actor.id] = createNativeFieldActorDraft(actor, t.f.map.mapRange, t.f.partyCatalog);
    if (change === "entity") actor.native.entity = { ...actor.native.entity };
    if (change === "animation") actor.animation = actor.animation!.clone();
    assert.throws(() => publication.validate(), /Stale.*draft/);
    assert.throws(() => publication.commit(), /current validation/);
    assert.deepEqual(t.snapshot(), before);
  }
});

test("late writeability failure invalidates a prior validation without publishing any target", () => {
  const t = fixture(), candidate = t.draft();
  candidate["-1001"]!.native.entity.visible = false;
  candidate["native:puppet:0"]!.native.entity.visible = true;
  const publication = prepareNativeFieldActorState(t.host, candidate), before = t.snapshot();
  publication.validate(); Object.freeze(t.actors["native:puppet:0"]!.native.entity);
  assert.throws(() => publication.validate(), /writable/);
  assert.throws(() => publication.commit(), /current validation/);
  assert.deepEqual(t.snapshot(), before);
});

test("commit publishes its frozen write set without reading candidates, providers or other owners", () => {
  const t = fixture(), candidate = t.draft(), actor = t.actors["-1001"]!;
  candidate[actor.id]!.native.entity.visible = false; candidate[actor.id]!.x = 8;
  const publication = prepareNativeFieldActorState(t.host, candidate);
  assert.throws(() => publication.commit(), /current validation/);
  publication.validate();
  // The containing owner must call final validation after all fallible work.
  // Even if its callback mutates a private draft, plain commit never imports
  // that new value or reads a now-published owned/camera context.
  candidate[actor.id]!.x = 99; candidate[actor.id]!.native.entity.visible = true;
  t.host.readActors = () => { throw new Error("No late owner reads"); };
  t.host.readCamera = () => { throw new Error("No late camera reads"); };
  t.host.readProviders = () => { throw new Error("No late provider reads"); };
  publication.commit(); assert.equal(actor.x, 8); assert.equal(actor.native.entity.visible, false);
});

test("the containing camera transaction stays separate from the actor candidate", () => {
  const t = fixture(), candidate = t.draft(), before = t.snapshot();
  candidate["-1001"]!.native.entity.visible = false;
  const publication = prepareNativeFieldActorState(t.host, candidate);
  t.changeCamera(); publication.validate(); assert.deepEqual(t.snapshot(), before);
  publication.commit(); assert.equal(t.actors["-1001"]!.native.entity.visible, false);
});

test("joint puppet transportation carries an unrelated motion through its private actor candidate", () => {
  const t = fixture("framework-development"), moving = t.actors["-1001"]!, motion = move(moving);
  const animation = moving.animation, entity = moving.native.entity;
  const party = new FieldPartyActors(t.f.partyCatalog, t.f.entry.checkpoint, 1, "framework-development");
  const host: NativeFieldPuppetActorsHost = { ...t.host,
    readProviders: () => ({ ...t.f.input.providers, transportationPresentation: "framework-development" }),
    readContext: () => ({ catalog: { kind: "field-puppet-actors-v1", memberCount: 4, characteristics: true,
      corpsOrder: [0, 1, 2, 3], residents: [], conditionChanges: [], miscHash: "b".repeat(64) },
      checkpoint: party.checkpoint(), bindings: t.source.bindings,
      owned: [{ ownedId: 17, sourceId: 2, enabled: true, conditionTypes: [] }],
      party: [17, 0, 0, 0], entities: [], restorePartyInstruction: "absent" }),
    controlContext: () => ({ worldMapScript: false, callback: "absent" }), prepareCollision: () => () => {},
    transportation: { read: () => ({ catalog: t.f.partyCatalog, characters: t.f.characters,
      animationKeys: { kind: "native-field-animation-keys-v1", assets: Object.fromEntries(
        Object.entries(t.f.characters).map(([asset, media]) => [asset, { keys: Object.keys(media.animations),
          source: media.source, contentHash: "a".repeat(64) }])) }, presentation: "framework-development" }),
      prepare: (operations) => party.prepareTransportation({ operations }) },
  };
  const port = createNativeFieldPuppetActorsPort(host), target = t.actors["native:puppet:0"]!;
  port.prepare({ leaderId: null, assignments: null,
    effects: [{ kind: "ride-on", actor: target.id, transportationId: 6 }] })();
  assert.equal(target.native.entity.riding, true); assert.equal(target.native.fieldAssetId, 38);
  assert.equal(party.checkpoint().context.puppets[0]!.riding, true);
  assert.equal(moving.native.entity, entity); assert.equal(moving.animation, animation); assert.equal(moving.motion, motion);
});
