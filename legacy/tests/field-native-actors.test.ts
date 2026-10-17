import test from "node:test";
import assert from "node:assert/strict";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { fieldCameraCellToWorld, fieldCameraLayerFromLogical } from "../src/core/field-camera.js";
import { createNativeFieldActorProjections, createNativeFieldPuppetActorsPort, readNativeFieldActors,
  type NativeFieldPuppetActorsHost, type NativeFieldActor, type NativeFieldActorContextRead } from "../src/core/field-native-actors.js";
import { projectFieldPuppetActorEntry, projectFieldPuppetInitialization, resolveFieldPuppetActor,
  type FieldPuppetActorPlan, type FieldPuppetActorCatalog } from "../src/core/field-puppet-actors.js";
import type { FieldPuppetHostSnapshot } from "../src/core/field-puppet-effects.js";

const serial = (snapshot: FieldPuppetHostSnapshot) => ({ camera: snapshot.camera,
  actors: snapshot.actors.map((actor) => ({ ...actor, animation: actor.animation?.snapshot() ?? null })) });
const plan = (...effects: FieldPuppetActorPlan["effects"]): FieldPuppetActorPlan => ({ leaderId: null, assignments: null, effects });
function setup() {
  const f = fieldActorFactoryFixture();
  f.input.player.position = fieldCameraCellToWorld(f.map.mapRange, { x: 3, y: 4 }, 0);
  const candidate = createFieldActorFactoryCandidate(f.input);
  const projections = createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog);
  const owner: Record<string, NativeFieldActor> = Object.fromEntries(projections.map((actor) => [actor.id, actor]));
  const catalog: FieldPuppetActorCatalog = { kind: "field-puppet-actors-v1", memberCount: 4, characteristics: true,
    corpsOrder: [0, 1, 2, 3], residents: [], conditionChanges: [], miscHash: "b".repeat(64) };
  const context: NativeFieldActorContextRead = { catalog, checkpoint: f.entry.checkpoint, bindings: candidate.bindings,
    owned: [{ ownedId: 17, sourceId: 2, enabled: true, conditionTypes: [] }], party: [17, 0, 0, 0],
    entities: [], restorePartyInstruction: "absent" };
  let camera = structuredClone(candidate.snapshot.camera), collision = true, cameraRevision = 0;
  const host: NativeFieldPuppetActorsHost = {
    readActors: () => owner, readContext: () => context, readProviders: () => f.input.providers,
    readCamera: () => camera,
    prepareCamera: (next) => {
      const expected = cameraRevision, value = structuredClone(next);
      return () => {
        if (expected !== cameraRevision) throw new Error("Stale unique camera owner");
        camera = value; cameraRevision++;
      };
    },
    controlContext: () => ({ worldMapScript: false, callback: "absent" }),
    prepareCollision: (enabled) => () => { collision = enabled; },
  };
  const port = createNativeFieldPuppetActorsPort(host);
  const script = { skipInitialize: false, keepPlayerPuppet: false, keepBadStatusVisual: false, ridingVehicle: false,
    characteristics: true, scriptHash: "a".repeat(64), miscHash: catalog.miscHash };
  const snapshot = () => readNativeFieldActors(owner, camera);
  return { f, candidate, owner, context, host, port, script, snapshot, collision: () => collision,
    touchCamera: () => { cameraRevision++; } };
}

test("native actors use the actual shared 0-based layer and map coordinate projections", () => {
  const t = setup(), player = t.owner["-1001"]!;
  assert.deepEqual(player.native.entity.position, { x: -104, y: 56, z: 349 });
  assert.deepEqual({ x: player.x, y: player.y, layer: player.layer }, { x: 3, y: 4, layer: 0 });
  player.x = 3.25; player.y = 4.125;
  assert.deepEqual(player.native.entity.position, { x: -100, y: 54, z: 349 });
  player.native.entity.position.x = -96;
  assert.equal(player.x, 3.5);
  for (const layer of [0, 1, 2]) {
    player.layer = layer;
    assert.equal(player.native.entity.layer, fieldCameraLayerFromLogical(layer).layer);
    assert.equal(player.layer, layer);
  }
  assert.equal(player.native.entity.position.z, 349, "representation setter does not invent a native ChangeLayer call");
  player.native.entity.layer = 12;
  assert.equal(player.layer, 3);
  assert.throws(() => { player.layer = 3; }, /Invalid checkpoint/);
  assert.throws(() => { player.layer = null; }, /unplaced/);
  assert.equal(player.native.entity.layer, 12);
  const offMap = t.owner["native:puppet:0"]!;
  assert.equal(offMap.layer, null); assert.equal(offMap.direction, null);
  offMap.layer = null;
  assert.equal(offMap.native.entity.layer, 0);
  assert.throws(() => { player.x = Number.POSITIVE_INFINITY; }, /coordinate/);
  assert.equal(player.native.entity.position.x, -96);
});

test("global cells include map-range offsets and float32 values without changing native Z", () => {
  const t = setup(), shifted = { ...t.f.map.mapRange, x: 11, y: -7 };
  const player = createNativeFieldActorProjections(t.candidate, shifted, t.f.partyCatalog)[0]!;
  assert.deepEqual({ x: player.x, y: player.y }, { x: 14, y: -3 });
  player.x = 14.25; player.y = -2.75;
  assert.deepEqual(player.native.entity.position, { x: -100, y: 52, z: 349 });
  player.x = 14 + 1 / 3;
  assert.equal(Math.fround(player.native.entity.position.x), player.native.entity.position.x);
  assert.equal(player.native.entity.position.z, 349);
});

test("empty factory media and zero direction remain empty until explicit source effects", () => {
  const t = setup(), empty = t.owner["native:party:0"]!, puppet = t.owner["native:puppet:0"]!;
  assert.equal(empty.asset, null); assert.equal(empty.animation, null); assert.equal(empty.direction, null);
  assert.equal(puppet.animation!.snapshot(), null); assert.equal(puppet.direction, null);
  const detached = t.snapshot();
  detached.actors[0]!.position.x = 99;
  detached.actors[0]!.animation!.play("wave", false, 1);
  assert.equal(t.owner["-1001"]!.native.entity.position.x, -104);
  assert.equal(t.owner["-1001"]!.animation!.snapshot()!.key, "WalkB");
  assert.throws(() => t.port.prepare(plan({ kind: "look", actor: "-1001", from: puppet.id })), /zero-direction/);
  assert.equal(puppet.direction, null);
});

test("start, source alias entry and finish commit into existing Actor and native entity identities", () => {
  const t = setup(), refs = Object.fromEntries(Object.values(t.owner).map((actor) => [actor.id, { actor, entity: actor.native.entity }]));
  const before = serial(t.snapshot());
  const start = projectFieldPuppetInitialization({ ...t.port.read(), script: t.script, phase: "start" });
  const publish = t.port.prepare(start);
  assert.deepEqual(serial(t.snapshot()), before);
  publish();
  assert.equal(t.owner["-1001"]!.native.entity.visible, true);
  assert.equal(t.owner["native:puppet:0"]!.native.entity.visible, false);
  assert.deepEqual(t.owner["native:puppet:0"]!.native.entity.position, { x: -104, y: 56, z: 349 });
  assert.equal(t.owner["native:puppet:0"]!.layer, 0);
  assert.equal(t.owner["native:puppet:0"]!.direction, "up");
  assert.equal(resolveFieldPuppetActor(t.context.catalog, t.port.read().context, -1001).actor, "native:puppet:0");
  const entry = projectFieldPuppetActorEntry({ ...t.port.read(), script: t.script, entityId: -1001,
    nextMnemonic: "Move", leaderId: start.leaderId, assignments: start.assignments! });
  t.port.prepare(entry)();
  assert.equal(t.owner["-1001"]!.native.entity.visible, false);
  t.owner["native:puppet:0"]!.x = 4;
  const finish = projectFieldPuppetInitialization({ ...t.port.read(), script: t.script, phase: "finish" });
  t.port.prepare(finish)();
  assert.equal(t.owner["-1001"]!.x, 4);
  assert.equal(t.owner["-1001"]!.native.entity.visible, true);
  assert.equal(t.owner["native:puppet:0"]!.native.entity.visible, false);
  for (const [id, ref] of Object.entries(refs)) {
    assert.equal(t.owner[id], ref.actor); assert.equal(t.owner[id]!.native.entity, ref.entity);
    assert.equal(t.owner[id]!.animation, ref.entity.animation);
  }
  assert.throws(publish, /already committed/);
});

test("late missing media rejects all effects before visibility or animation publication", () => {
  const t = setup();
  const before = serial(t.snapshot()), animation = t.owner["-1001"]!.animation;
  assert.throws(() => t.port.prepare(plan(
    { kind: "hide", actor: "-1001" },
    { kind: "look", actor: "native:party:0", from: "-1001" },
  )), /media/);
  assert.deepEqual(serial(t.snapshot()), before); assert.equal(t.owner["-1001"]!.animation, animation);
});

test("direct position, playback and owner replacement invalidate a prepared actor transaction", () => {
  for (const change of ["position", "playback", "owner"] as const) {
    const t = setup(), publish = t.port.prepare(plan({ kind: "hide", actor: "-1001" }));
    if (change === "position") t.owner["-1001"]!.x += 1;
    if (change === "playback") t.owner["-1001"]!.animation!.play("wave", false, 1);
    if (change === "owner") t.owner["-1001"] = createNativeFieldActorProjections(t.candidate, t.f.map.mapRange, t.f.partyCatalog)[0]!;
    const changed = serial(t.snapshot());
    assert.throws(publish, /Stale/);
    assert.deepEqual(serial(t.snapshot()), changed); assert.equal(t.owner["-1001"]!.native.entity.visible, true);
  }
});

test("live owned state and material provider changes cannot silently reuse a prepared plan", () => {
  const t = setup(), publish = t.port.prepare(plan({ kind: "hide", actor: "-1001" }));
  t.context.owned[0]!.enabled = false;
  assert.equal(t.port.read().context.owned[0]!.enabled, false);
  assert.throws(publish, /context/); assert.equal(t.owner["-1001"]!.native.entity.visible, true);
  const u = setup(), pending = u.port.prepare(plan({ kind: "hide", actor: "-1001" }, { kind: "switch-transparent", actor: "-1001" }));
  u.host.readProviders = () => ({ ...u.f.input.providers, footAttribute: () => 9 });
  assert.throws(pending, /transparent/); assert.equal(u.owner["-1001"]!.native.entity.visible, true);
});

test("camera remains one external owner and camera rejection cannot partially publish actors", () => {
  const t = setup(); delete t.host.prepareCamera;
  const effects = plan({ kind: "hide", actor: "-1001" }, { kind: "init-camera-dummy", actor: "camera:0", player: "-1001" });
  const before = serial(t.snapshot());
  assert.throws(() => t.port.prepare(effects), /camera owner/);
  assert.deepEqual(serial(t.snapshot()), before);
  const u = setup(), pending = u.port.prepare(effects); u.touchCamera();
  assert.throws(pending, /unique camera/);
  assert.equal(u.owner["-1001"]!.native.entity.visible, true);
});

test("read-only or frozen entities are rejected before a prepared camera can commit", () => {
  const t = setup(), before = serial(t.snapshot());
  const pending = t.port.prepare(plan({ kind: "hide", actor: "-1001" }, { kind: "init-camera-dummy", actor: "camera:0", player: "-1001" }));
  Object.freeze(t.owner["native:puppet:0"]!.native.entity);
  assert.throws(pending, /writable/);
  assert.deepEqual(serial(t.snapshot()), before);
});

test("moving is derived from the existing Motion owner and clears without a stale second flag", () => {
  const t = setup(), player = t.owner["-1001"]!;
  player.motion = { from: { x: 3, y: 4 }, to: { x: 4, y: 4 }, elapsed: 0, duration: 0.24, manual: true };
  assert.equal(player.native.entity.moving, true);
  assert.equal(t.snapshot().actors[0]!.moving, true);
  assert.throws(() => t.port.prepare(plan({ kind: "copy-position", actor: "native:puppet:0", from: "-1001", mode: "overwrite" })), /movement/);
  player.motion = null;
  assert.equal(player.native.entity.moving, false);
  assert.doesNotThrow(() => t.port.prepare(plan({ kind: "copy-position", actor: "native:puppet:0", from: "-1001", mode: "overwrite" }))());
});

test("unbound legacy map actors cannot acquire native child or pose admission by being mapped", () => {
  const t = setup(), legacy = { id: "npc:1" };
  t.host.readActors = () => ({ ...t.owner, "npc:1": legacy });
  assert.equal(t.snapshot().actors.length, Object.keys(t.owner).length);
  t.context.entities = [{ entityId: 1, actor: legacy.id }];
  assert.throws(() => t.port.read(), /entity binding/);
  assert.throws(() => t.port.prepare(plan({ kind: "hide", actor: legacy.id })), /binding|Missing/);
});

test("collision preparation delegates the real owner and effect intent is captured once", () => {
  const t = setup(), collision = t.port.prepareCollision(false);
  assert.equal(t.collision(), true); collision(); assert.equal(t.collision(), false);
  const effectPlan = plan({ kind: "hide", actor: "-1001" }), publish = t.port.prepare(effectPlan);
  effectPlan.effects.length = 0;
  publish(); assert.equal(t.owner["-1001"]!.native.entity.visible, false);
});
