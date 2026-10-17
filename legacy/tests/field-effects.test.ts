import test from "node:test";
import assert from "node:assert/strict";
import { createFieldEffectState, FieldEffects, fieldEffectAnimationLoopLimit, fieldEffectUpdateAllowed, projectFieldEffectBoard, projectFieldEffectPlacement, projectFieldEffects,
  type FieldEffectOperation } from "../src/core/field-effects.js";
import { compileFieldEffectBoard, compileFieldEffectMedia, fieldEffectCompilationBlockers } from "../src/compiler/field-effects.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { effectCatalog, effectDefinition, effectMediaExport } from "./fixtures/field-effects.js";

const create = (id: string, awake = true): FieldEffectOperation => ({ kind: "create", id,
  definition: effectDefinition({ playOnAwake: awake }), position: { x: 5, y: 6, z: 49 } });
const setup = (ids: string[], groupUpdate = false): FieldEffectOperation => ({ kind: "setup", registeredBoards: ids, groupUpdate });
const project = (ops: FieldEffectOperation[], loop = true) => projectFieldEffects(createFieldEffectState(), effectCatalog(loop), ops);

test("board string animation overload maps only explicit mode zero to one playback", () => {
  assert.equal(fieldEffectAnimationLoopLimit(0), 1);
  for (const mode of [null, -1, 1, 7]) assert.equal(fieldEffectAnimationLoopLimit(mode), 0);
  assert.throws(() => fieldEffectAnimationLoopLimit(.5), /integer/);
});

test("particle update mask includes field, message and field-ready independently of board visibility", () => {
  for (const mask of [2, 3, 8, 9, 32, 42]) assert.equal(fieldEffectUpdateAllowed(mask), true);
  for (const mask of [0, 1, 4, 16, 64]) assert.equal(fieldEffectUpdateAllowed(mask), false);
  assert.throws(() => fieldEffectUpdateAllowed(-1), /integer/);
});

test("effect compiler uses native nullable defaults, constructor defaults and building overrides", () => {
  const raw = { object_type: 11, asset_id: 1 }, geometry = { x: 1, y: 2, width: 16, height: 16 };
  const def = compileFieldEffectBoard(raw, geometry, [{ id: "1", asset_name: "controlled_effect" }], effectDefinition().source);
  assert.equal(def.playOnAwake, true); assert.equal(def.front, true); assert.equal(def.split, true);
  assert.equal(def.zOffset, 2); assert.equal(def.collision, false); assert.equal(def.zTest, 4);
  assert.equal(def.assetName, "Prefabs/EffectPrefab");
  const building = compileFieldEffectBoard({ ...raw, building: true, split: true, birdview_puppet: true, zoffset: -7,
    front: false, ignore_depth_test: true, gimmick: false }, geometry, [{ id: 1, asset_name: "controlled_effect" }], def.source);
  assert.equal(building.split, false); assert.equal(building.birdviewPuppet, false); assert.equal(building.zOffset, -7);
  assert.equal(building.zTest, 8); assert.match(fieldEffectCompilationBlockers(building).join(), /building interaction/);
  assert.throws(() => compileFieldEffectBoard({ ...raw, script_id: 7 }, geometry,
    [{ id: 1, asset_name: "controlled_effect" }], def.source), /event provider/);
});

test("effect placement uses source pixels/map range and strict native top/right standby boundaries", () => {
  const def = effectDefinition({ pixelPosition: { x: 40, y: 64 } }), range = { x: 1, y: 2, width: 10, height: 8 };
  assert.deepEqual(projectFieldEffectPlacement(def, { range, tileMapPresent: true, standbyAnchor: null }, 3),
    { position: { x: -48, y: 40, z: 49 }, layer: 12, tilePosition: { x: 24, y: 32 } });
  const top = effectDefinition({ pixelPosition: { x: 16, y: 32 } });
  assert.throws(() => projectFieldEffectPlacement(top, { range, tileMapPresent: true, standbyAnchor: null }, 3), /standby/);
  assert.deepEqual(projectFieldEffectPlacement(top, { range, tileMapPresent: true, standbyAnchor: { x: 30000, y: 1000 } }, 3).position,
    { x: 30000, y: 1000, z: 49 });
  const bottom = effectDefinition({ pixelPosition: { x: 16, y: 160 } });
  assert.equal(projectFieldEffectPlacement(bottom, { range, tileMapPresent: true, standbyAnchor: null }, 0).position.y, -56);
  assert.throws(() => projectFieldEffectPlacement(def, { range, tileMapPresent: true, standbyAnchor: null }, 4), /layer/);
});

test("board mesh recovers odd split rows, source UV/depth and signed remainder rather than uniform quads", () => {
  const mesh = projectFieldEffectBoard(effectDefinition(), { width: 32, height: 32 });
  assert.equal(mesh.vertices.length, 12); assert.equal(mesh.triangles.length, 18);
  assert.deepEqual(mesh.vertices.filter((_, i) => i % 4 === 0),
    [{ x: -16, y: 16, z: -2 }, { x: -16, y: 8, z: -4 }, { x: -16, y: -8, z: -6 }]);
  assert.deepEqual(mesh.uv.slice(0, 4), [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: .75 }, { x: 1, y: .75 }]);
  assert.equal(mesh.renderQueue, 2458); assert.equal(mesh.affectedMode, 0);
  assert.deepEqual(mesh.collider, { enabled: false, width: 14, height: 14 });
  const offset = projectFieldEffectBoard(effectDefinition({ pixelPosition: { x: 0, y: 12 } }), { width: 32, height: 32 });
  assert.equal(offset.vertices.length, 16); assert.equal(offset.vertices[2]!.y, 4);
  assert.equal(offset.vertices.at(-1)!.y, -16);
  const negative = projectFieldEffectBoard(effectDefinition({ pixelPosition: { x: 0, y: -12 } }), { width: 32, height: 32 });
  assert.deepEqual(negative, mesh);
  const flat = projectFieldEffectBoard(effectDefinition({ split: false, front: false, affected: false, zOffset: 0 }), { width: 32, height: 32 });
  assert.equal(flat.vertices.length, 4); assert.equal(flat.vertices[0]!.z, .25); assert.equal(flat.renderQueue, 2453);
});

test("play-on-awake shares a camera but each board clears RT and contributes a reference", () => {
  const plan = project([create("a"), create("b"), setup(["a", "b"])]);
  assert.equal(plan.after.instanceCount, 1); assert.equal(plan.after.players[0]!.references, 2);
  assert.deepEqual(plan.after.registeredCameraIds, [1]); assert.equal(plan.after.players[0]!.positionY, 16);
  assert.equal(plan.after.nextParticlePositionY, 132);
  assert.equal(plan.events.filter((event) => event.kind === "create-player").length, 1);
  assert.equal(plan.events.filter((event) => event.kind === "clear-render-texture").length, 2);
  assert.equal(plan.events.filter((event) => event.kind === "restart").length, 1);
  assert.equal(plan.after.players[0]!.loopLimit, 0);
  const hidden = projectFieldEffects(plan.after, effectCatalog(), [{ kind: "visibility", id: "a", visible: false, duration: 0 }]);
  assert.equal(hidden.after.boards[0]!.activeSelf, false); assert.equal(hidden.after.boards[1]!.activeSelf, true);
  assert.equal(hidden.after.players[0]!.playing, true); assert.equal(hidden.events.length, 0);
});

test("non-awake boards have distinct players, Show does not Play, and explicit Play controls all shared boards", () => {
  const plan = project([create("a", false), create("b", false), setup(["a", "b"]),
    { kind: "visibility", id: "a", visible: true, duration: 0 }]);
  assert.equal(plan.after.players.length, 2); assert.deepEqual(plan.after.shared, {});
  assert.equal(plan.after.players[0]!.playing, false); assert.equal(plan.after.boards[0]!.activeSelf, true);
  const played = projectFieldEffects(plan.after, effectCatalog(), [{ kind: "play", id: "a", loopLimit: 3 }]);
  assert.equal(played.after.players[0]!.playing, true); assert.equal(played.after.players[0]!.loopLimit, 3);
  assert.equal(played.after.players[1]!.playing, false);
});

test("map group activity preserves board alpha and shared particle playback independently", () => {
  const base = project([create("a"), create("b"), setup(["a", "b"])]).after;
  const off = projectFieldEffects(base, effectCatalog(), [{ kind: "active", id: "a", active: false }]).after;
  assert.equal(off.boards[0]!.activeSelf, false); assert.equal(off.boards[0]!.fadeAlpha, 1);
  assert.equal(off.players[0]!.playing, true); assert.equal(off.boards[1]!.activeSelf, true);
  const hidden = projectFieldEffects(off, effectCatalog(), [{ kind: "visibility", id: "a", visible: false, duration: 0 },
    { kind: "active", id: "a", active: true }]).after;
  assert.equal(hidden.boards[0]!.activeSelf, true); assert.equal(hidden.boards[0]!.fadeAlpha, 0);
  assert.equal(hidden.players[0]!.playing, true);
  const shown = projectFieldEffects(hidden, effectCatalog(), [{ kind: "visibility", id: "a", visible: true, duration: 0 }]).after;
  assert.equal(shown.boards[0]!.activeSelf, true); assert.equal(shown.boards[0]!.fadeAlpha, 1);
});

test("setup deduplicates by camera in board order and group update retains unselected playback", () => {
  const base = project([create("a", false), create("b", false), setup(["b", "a"]),
    { kind: "play", id: "b", loopLimit: -1 }]).after;
  const group = projectFieldEffects(base, effectCatalog(), [setup(["a"], true)]);
  assert.equal(group.after.players[1]!.playing, true); assert.deepEqual(group.after.registeredCameraIds, [1]);
  assert.deepEqual(group.events[0], { kind: "unregister", cameraIds: [2, 1] });
  const full = projectFieldEffects(base, effectCatalog(), [setup(["a"], false)]);
  assert.equal(full.after.players[1]!.playing, false); assert.equal(full.after.players[1]!.activeSelf, false);
});

test("last release removes live owner but preserves native shared tombstone; duplicate destroy cannot underflow", () => {
  const base = project([create("a"), create("b")]).after;
  const one = projectFieldEffects(base, effectCatalog(), [{ kind: "destroy", id: "a" }]).after;
  assert.equal(one.players[0]!.references, 1);
  const empty = projectFieldEffects(one, effectCatalog(), [{ kind: "destroy", id: "b" }]).after;
  assert.equal(empty.players.length, 0); assert.deepEqual(empty.shared, { controlled_effect: 1 });
  assert.throws(() => projectFieldEffects(empty, effectCatalog(), [create("c")]), /Released/);
  assert.throws(() => projectFieldEffects(empty, effectCatalog(), [{ kind: "destroy", id: "b" }]), /Unknown/);
});

test("asset unload removes a released shared entry without resetting global allocation order", () => {
  const retired = project([create("old"), { kind: "destroy", id: "old" }]).after;
  const released = projectFieldEffects(retired, effectCatalog(), [{ kind: "release-prefab", assetGroup: "controlled_effect" }]);
  assert.deepEqual(released.after.shared, {});
  assert.equal(released.after.instanceCount, retired.instanceCount);
  assert.equal(released.after.nextParticlePositionY, retired.nextParticlePositionY);
  assert.deepEqual(released.events, [{ kind: "release-prefab", assetGroup: "controlled_effect" }]);
  const recreated = projectFieldEffects(released.after, effectCatalog(), [create("new")]).after;
  assert.equal(recreated.players[0]!.cameraId, 2);
  assert.equal(recreated.players[0]!.positionY, 148);
  assert.deepEqual(recreated.shared, { controlled_effect: 2 });
  assert.deepEqual(projectFieldEffects(released.after, effectCatalog(),
    [{ kind: "release-prefab", assetGroup: "controlled_effect" }]).after, released.after);
});

test("prefab release preserves referenced live players while subsequent boards obtain a new shared instance", () => {
  const live = project([create("old"), setup(["old"])]).after;
  const released = projectFieldEffects(live, effectCatalog(), [{ kind: "release-prefab", assetGroup: "controlled_effect" }]).after;
  assert.deepEqual(released.players, live.players); assert.deepEqual(released.boards, live.boards);
  assert.deepEqual(released.registeredCameraIds, live.registeredCameraIds);
  const next = projectFieldEffects(released, effectCatalog(), [create("new"), { kind: "destroy", id: "old" }]).after;
  assert.deepEqual(next.players.map((p) => [p.cameraId, p.references]), [[2, 1]]);
  assert.deepEqual(next.shared, { controlled_effect: 2 });
  assert.throws(() => projectFieldEffects(live, effectCatalog(), [{ kind: "release-prefab", assetGroup: "unknown" }]), /media/);
});

test("failed prefab cache publication preserves logical sharing and the host cache", () => {
  let fail = false, loaded = true;
  const owner = new FieldEffects(effectCatalog(), { prepare: (plan) => ({
    validate: () => { if (fail) throw new Error("asset cache changed"); },
    commit: () => { if (plan.events.some((event) => event.kind === "release-prefab")) loaded = false; },
  }) });
  owner.prepare([create("a")]).commit(); const before = owner.snapshot();
  const release = owner.prepare([{ kind: "release-prefab", assetGroup: "controlled_effect" }]);
  fail = true; assert.throws(() => release.commit(), /asset cache changed/);
  assert.deepEqual(owner.snapshot(), before); assert.equal(loaded, true);
  fail = false; owner.prepare([{ kind: "release-prefab", assetGroup: "controlled_effect" }]).commit();
  assert.deepEqual(owner.snapshot().shared, {}); assert.equal(loaded, false);
  assert.deepEqual(owner.snapshot().players, before.players);
});

test("native playback clock accumulates f32 across restarts; positive loops await non-looping particles", () => {
  const base = project([create("a"), setup(["a"]), { kind: "play", id: "a", loopLimit: 2 }], false).after;
  const tick = (playing: boolean): FieldEffectOperation => ({ kind: "tick", deltaSeconds: .1,
    observations: [{ cameraId: 1, particlePlaying: [playing] }] });
  const active = projectFieldEffects(base, effectCatalog(false), [tick(true)]).after;
  assert.equal(active.players[0]!.loopCount, 0);
  const restarted = projectFieldEffects(active, effectCatalog(false), [tick(false)]).after;
  assert.equal(restarted.players[0]!.loopCount, 1); assert.equal(restarted.players[0]!.playing, true);
  const stopped = projectFieldEffects(restarted, effectCatalog(false), [tick(false)]).after;
  assert.equal(stopped.players[0]!.loopCount, 2); assert.equal(stopped.players[0]!.playing, false);
  const replay = projectFieldEffects(stopped, effectCatalog(false), [{ kind: "play", id: "a", loopLimit: -1 }]).after;
  assert.equal(replay.players[0]!.loopCount, 0); assert.equal(replay.players[0]!.elapsedSec, stopped.players[0]!.elapsedSec);
  assert.equal(replay.players[0]!.loopLimit, 1);
});

test("explicit positive loop limit is not held by a looped particle, and every updated player needs exact observations", () => {
  const base = project([create("a"), setup(["a"]), { kind: "play", id: "a", loopLimit: 1 }]).after;
  const ticked = projectFieldEffects(base, effectCatalog(), [{ kind: "tick", deltaSeconds: .1,
    observations: [{ cameraId: 1, particlePlaying: [true] }] }]).after;
  assert.equal(ticked.players[0]!.playing, false);
  assert.throws(() => projectFieldEffects(base, effectCatalog(), [{ kind: "tick", deltaSeconds: .1, observations: [] }]), /observations/);
  assert.throws(() => projectFieldEffects(base, effectCatalog(), [{ kind: "tick", deltaSeconds: .1,
    observations: [{ cameraId: 1, particlePlaying: [] }] }]), /playback state/);
});

test("prepare failures and stale publications preserve one owner and do not publish renderer state", () => {
  let generation = 0, commits = 0;
  const owner = new FieldEffects(effectCatalog(), { prepare: () => { const start = generation; return {
    validate: () => { if (start !== generation) throw new Error("stale renderer"); }, commit: () => { commits++; },
  }; } });
  const initial = owner.snapshot();
  assert.throws(() => owner.prepare([create("a"), { kind: "visibility", id: "a", visible: false, duration: 1 }]), /fade/);
  assert.deepEqual(owner.snapshot(), initial); assert.equal(commits, 0);
  const stale = owner.prepare([create("a")]); generation++;
  assert.throws(() => stale.commit(), /stale renderer/); assert.deepEqual(owner.snapshot(), initial);
  const first = owner.prepare([create("a")]), second = owner.prepare([create("b")]); first.commit();
  assert.throws(() => second.commit(), /Stale field effect/); assert.equal(commits, 1);
  const returned = owner.snapshot(); returned.boards.length = 0;
  assert.equal(owner.snapshot().boards.length, 1);
  assert.throws(() => new FieldEffects(effectCatalog()).prepare([create("a")]), /host is unavailable/);
});

test("strict media inspection preserves large PPtrs, follows only EffectPrefab graph, and never admits Unity noise", () => {
  const raw = effectMediaExport(), result = compileFieldEffectMedia("controlled_effect", raw);
  assert.equal(result.particles.length, 1);
  assert.ok(result.blockers.includes("Unity ParticleSystem NoiseModule simulation"));
  assert.ok(result.blockers.includes("Particle material shader 1:9007199254740993"));
  assert.equal(result.renderTexture.width, 32);
  const catalog = { media: { controlled_effect: result } };
  assert.throws(() => new FieldEffects(catalog, { prepare: () => { throw new Error("must not reach host"); } }).prepare([create("a")]), /particle provider unavailable/);
  const numeric = structuredClone(raw); numeric.objects[5]!.data.m_Shader = { m_FileID: 1, m_PathID: 9007199254740992 };
  assert.throws(() => compileFieldEffectMedia("controlled_effect", numeric));
  const corrupt = structuredClone(raw); corrupt.hierarchyIds.push("6");
  assert.throws(() => compileFieldEffectMedia("controlled_effect", corrupt), /receipt mismatch/);
  assert.throws(() => compileFieldEffectMedia("other", raw), /Unbound/);
});

test("entity compiler retains the real effect object with a specific provider blocker", () => {
  const properties = { object_type: 11, asset_id: 1, direction: 0, play_on_awake: true };
  const group = compileEntityGroup("entity_default", { source: effectDefinition().source,
    data: { layers: [{ name: "CeilObject", objects: [{ id: 7, gid: 1000, x: 32, y: 32, width: 16, height: 16,
      properties: Object.entries(properties).map(([name, value]) => ({ name, value })) }] }] } },
    { "mapobject.csv": [{ id: 1, asset_name: "controlled_effect" }] });
  assert.equal(group.entities.length, 1); assert.equal(group.entities[0]!.effect!.assetGroup, "controlled_effect");
  assert.equal(group.entities[0]!.asset, null);
  assert.deepEqual(group.blockers.map((b) => b.reason),
    ["Field effect particle provider unavailable: controlled_effect (serialized particle/material admission required)"]);
});
