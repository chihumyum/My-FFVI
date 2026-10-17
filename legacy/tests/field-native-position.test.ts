import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldNativePosition } from "../src/compiler/field-native-position.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { createNativeFieldActorProjections, prepareNativeFieldActorProjection, readNativeFieldActors } from "../src/core/field-native-actors.js";
import { projectNativeFieldPosition, type FieldNativePosition } from "../src/core/field-native-position.js";
import { fieldCameraCellToWorld } from "../src/core/field-camera.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

function setup() {
  const f = fieldActorFactoryFixture();
  f.input.player.position = { x: -100, y: 54, z: 349 };
  const candidate = createFieldActorFactoryCandidate(f.input);
  const owner = Object.fromEntries(createNativeFieldActorProjections(candidate, f.map.mapRange, f.partyCatalog).map((a) => [a.id, a]));
  const snapshot = () => readNativeFieldActors(owner, candidate.snapshot.camera);
  const host = { readActors: () => owner, readCamera: () => candidate.snapshot.camera, readProviders: () => f.input.providers };
  const command: FieldNativePosition = { x: 8, y: 7, layer: 0, animation: "" };
  const prepare = (c = command) => prepareNativeFieldActorProjection(host,
    (s, providers) => projectNativeFieldPosition(s, providers, "-1001", c, f.map.mapRange, "source-absent"));
  return { f, owner, snapshot, host, command, prepare };
}
const serial = (s: ReturnType<ReturnType<typeof setup>["snapshot"]>) => ({ ...s,
  actors: s.actors.map((a) => ({ ...a, animation: a.animation?.snapshot() ?? null })) });

test("native SetPos converts global map cells before negative-axis retention and cell-centre snapping", () => {
  const t = setup(), before = t.snapshot(), map = { ...t.f.map.mapRange, x: 11, y: -7 };
  const next = projectNativeFieldPosition(before, t.f.input.providers, "-1001",
    { x: 10, y: 0, layer: 0, animation: "" }, map, "source-absent");
  assert.deepEqual(next.actors[0]!.position, { x: -104, y: 8, z: 349 });
  assert.deepEqual(before.actors[0]!.position, { x: -100, y: 54, z: 349 });
  assert.deepEqual(next.camera, before.camera);
});

test("native SetPos preserves hidden identity and direction while replacing position, layer material and cue together", () => {
  const t = setup(), actor = t.owner["-1001"]!, entity = actor.native.entity;
  entity.visible = false; entity.fadeAlpha = 0;
  const before = serial(t.snapshot()), publish = t.prepare({ ...t.command, layer: 3, animation: "wave" });
  assert.deepEqual(serial(t.snapshot()), before);
  publish();
  assert.equal(t.owner[actor.id], actor); assert.equal(actor.native.entity, entity);
  assert.deepEqual(entity.position, { x: -24, y: 8, z: 149 });
  assert.equal(entity.layer, 11); assert.equal(entity.viewBinding!.layer, 11);
  assert.equal(entity.animation!.snapshot()!.key, "wave");
  assert.equal(entity.direction, "up"); assert.equal(entity.visible, false); assert.equal(entity.fadeAlpha, 0);
  assert.equal(actor.native.charaZOffset, 0.5);
  assert.throws(publish, /already committed/);
});

test("SetPos failures in animation, new material or preserved Z leave every actor untouched", () => {
  for (const failure of ["animation", "material", "z", "motion"] as const) {
    const t = setup(), actor = t.owner["-1001"]!;
    const command: FieldNativePosition = { ...t.command, layer: failure === "material" ? 2 : 0,
      animation: failure === "animation" ? "missing" : "" };
    if (failure === "material") t.f.input.providers.applyViewProperties = () => null;
    if (failure === "z") actor.native.entity.position.z = 49;
    if (failure === "motion") actor.motion = { from: { x: 3, y: 4 }, to: { x: 4, y: 4 }, elapsed: 0, duration: 240, manual: false };
    const before = serial(t.snapshot());
    assert.throws(() => t.prepare(command), /Missing actor animation|material projection|Z layer|active movement/);
    assert.deepEqual(serial(t.snapshot()), before, failure);
  }
});

test("SetPos transactions reject changed actors or provider results before publication", () => {
  const t = setup(), actor = t.owner["-1001"]!;
  const publish = t.prepare({ ...t.command, layer: 2 });
  actor.native.entity.visible = false;
  const before = serial(t.snapshot());
  assert.throws(publish, /Stale native/); assert.deepEqual(serial(t.snapshot()), before);
  const pending = t.prepare({ ...t.command, layer: 2 });
  t.f.input.providers.applyViewProperties = () => null;
  assert.throws(pending, /material projection/); assert.deepEqual(serial(t.snapshot()), before);
});

test("native instruction publication cannot silently remove or reorder owned actors", () => {
  const t = setup(), before = serial(t.snapshot());
  assert.throws(() => prepareNativeFieldActorProjection(t.host, (s) => ({ ...s, actors: s.actors.slice(1) })), /actor identities/);
  assert.throws(() => prepareNativeFieldActorProjection(t.host, (s) => ({ ...s, actors: [...s.actors].reverse() })), /actor identities/);
  assert.deepEqual(serial(t.snapshot()), before);
});

test("framework SetPos retains riding identity and outer playback; strict source refuses active riding", () => {
  const t = setup(), snapshot = t.snapshot(), player = snapshot.actors.find((a) => a.id === "-1001")!;
  player.riding = true; player.riderAssetId = 1; player.rideOnEntity = "riding";
  const before = serial(snapshot), command = { ...t.command, animation: "WalkB" };
  assert.throws(() => projectNativeFieldPosition(snapshot, t.f.input.providers, player.id,
    command, t.f.map.mapRange, "source-absent"), /riding host/);
  const next = projectNativeFieldPosition(snapshot,
    { ...t.f.input.providers, transportationPresentation: "framework-development" }, player.id,
    command, t.f.map.mapRange, "source-absent");
  const after = next.actors.find((a) => a.id === player.id)!;
  assert.equal(after.riding, true); assert.equal(after.riderAssetId, 1); assert.equal(after.rideOnEntity, "riding");
  assert.equal(after.animation!.snapshot()!.key, "WalkB");
  assert.notDeepEqual(after.position, player.position); assert.deepEqual(serial(snapshot), before);
  player.riding = false; player.rideOnEntity = "idle";
  const cached = projectNativeFieldPosition(snapshot, t.f.input.providers, player.id,
    command, t.f.map.mapRange, "source-absent");
  assert.equal(cached.actors.find((a) => a.id === player.id)!.riderAssetId, 1);
});

test("native SetPos decoder retains the old absolute shape and rejects unknown mode and stray operands", () => {
  const raw = { type: 2, mnemonic: "SetPos", operands: {
    iValues: [13, 24, 2, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: ["wave", "", "", "", "", "", "", ""],
  } };
  assert.deepEqual(compileFieldNativePosition(raw), { x: 13, y: 24, layer: 2, animation: "wave" });
  for (const change of ["mode", "reference", "layer", "real", "string"] as const) {
    const value = structuredClone(raw);
    if (change === "mode") value.operands.iValues[3] = 2;
    if (change === "reference") value.operands.iValues[4] = 8;
    if (change === "layer") value.operands.iValues[2] = 4;
    if (change === "real") value.operands.rValues[0] = 1;
    if (change === "string") value.operands.sValues[1] = "unused";
    assert.throws(() => compileFieldNativePosition(value), /mode\/layer\/operand/);
  }
});

const relative = (x = 0, y = 0): FieldNativePosition => ({ mode: 1, referenceEntityId: -1001,
  x, y, layer: 0, animation: "" });
const referenceActor = (t: ReturnType<typeof setup>) => Object.values(t.owner)
  .find((actor) => actor.id !== "-1001" && actor.native.entity.character)!;

test("relative SetPos decoder preserves the exact signed selector and offsets without resolving instances", () => {
  for (const referenceEntityId of [-1001, 0, 601]) {
    const raw = { type: 2, mnemonic: "SetPos", operands: {
      iValues: [-2, 3, 0, 1, referenceEntityId, 0, 0, 0], rValues: Array(8).fill(0),
      sValues: ["WalkR_00", "", "", "", "", "", "", ""],
    } };
    assert.deepEqual(compileFieldNativePosition(raw), { mode: 1, referenceEntityId,
      x: -2, y: 3, layer: 0, animation: "WalkR_00" });
    for (const index of [5, 6, 7]) {
      const invalid = structuredClone(raw); invalid.operands.iValues[index] = 1;
      assert.throws(() => compileFieldNativePosition(invalid), /mode\/layer\/operand/);
    }
  }
});

test("relative SetPos floors the exact reference world cell, adds signed offsets and does not subtract map origin again", () => {
  const t = setup(), reference = referenceActor(t), map = { ...t.f.map.mapRange, x: 11, y: -7 };
  reference.native.entity.position = { x: -77, y: 30, z: 149 };
  reference.native.entity.layer = 11;
  const before = serial(t.snapshot()), next = projectNativeFieldPosition(t.snapshot(), t.f.input.providers,
    "-1001", relative(-2, 3), map, "source-absent", reference.id);
  assert.deepEqual(next.actors.find((actor) => actor.id === "-1001")!.position, { x: -104, y: -24, z: 349 });
  assert.deepEqual(next.actors.find((actor) => actor.id === reference.id)!.position, reference.native.entity.position);
  assert.deepEqual(serial(t.snapshot()), before);
});

test("relative SetPos supports a self reference and camera reference without changing their identities", () => {
  const t = setup(), before = serial(t.snapshot());
  const self = projectNativeFieldPosition(t.snapshot(), t.f.input.providers, "-1001", relative(1, -1),
    t.f.map.mapRange, "source-absent", "-1001");
  assert.deepEqual(self.actors.find((actor) => actor.id === "-1001")!.position, { x: -88, y: 72, z: 349 });
  const camera = t.snapshot().camera!;
  const fromCamera = projectNativeFieldPosition(t.snapshot(), t.f.input.providers, "-1001",
    { ...relative(), referenceEntityId: 0 }, t.f.map.mapRange, "source-absent", camera.id);
  assert.deepEqual(fromCamera.actors.find((actor) => actor.id === "-1001")!.position, { x: 8, y: 8, z: 349 });
  assert.deepEqual(fromCamera.camera, camera); assert.deepEqual(serial(t.snapshot()), before);
});

test("relative SetPos explicitly selects destination layer and prepares cue, view and visibility together", () => {
  const t = setup(), reference = referenceActor(t), actor = t.owner["-1001"]!;
  reference.native.entity.position = fieldCameraCellToWorld(t.f.map.mapRange, { x: 5, y: 6 }, 0);
  actor.native.entity.visible = false; actor.native.entity.fadeAlpha = 0;
  const before = serial(t.snapshot()), command = { ...relative(), layer: 3 as const, animation: "wave" };
  const publish = prepareNativeFieldActorProjection(t.host, (snapshot, providers) => projectNativeFieldPosition(
    snapshot, providers, actor.id, command, t.f.map.mapRange, "source-absent", reference.id));
  assert.deepEqual(serial(t.snapshot()), before); publish();
  assert.deepEqual(actor.native.entity.position, { x: -72, y: 24, z: 149 });
  assert.equal(actor.native.entity.layer, 11); assert.equal(actor.native.entity.viewBinding!.layer, 11);
  assert.equal(actor.animation!.snapshot()!.key, "wave"); assert.equal(actor.native.entity.visible, false);
  assert.equal(actor.direction, "up"); assert.equal(t.owner[reference.id], reference);
});

test("relative SetPos rejects absent reference, wrong instance, invalid selector and invalid offsets without any publication", () => {
  const t = setup(), before = serial(t.snapshot());
  for (const reference of [undefined, null, "", "unbound:instance"])
    assert.throws(() => projectNativeFieldPosition(t.snapshot(), t.f.input.providers, "-1001",
      relative(), t.f.map.mapRange, "source-absent", reference), /reference entity/);
  for (const command of [{ ...relative(), referenceEntityId: 0x80000000 },
    { ...relative(), x: 0x80000000 }, { ...relative(), y: Number.NaN }])
    assert.throws(() => projectNativeFieldPosition(t.snapshot(), t.f.input.providers, "-1001", command,
      t.f.map.mapRange, "source-absent", "-1001"), /checkpoint/);
  assert.throws(() => projectNativeFieldPosition(t.snapshot(), t.f.input.providers, "-1001", t.command,
    t.f.map.mapRange, "source-absent", "-1001"), /Absolute source/);
  assert.deepEqual(serial(t.snapshot()), before);
});

test("relative SetPos converts offsets to float32 before addition instead of wrapping them as Int32", () => {
  const t = setup(), reference = referenceActor(t);
  reference.native.entity.position = fieldCameraCellToWorld(t.f.map.mapRange, { x: 0, y: 0 }, 0);
  const before = serial(t.snapshot()), next = projectNativeFieldPosition(t.snapshot(), t.f.input.providers,
    "-1001", relative(0x7fffffff, -0x80000000), t.f.map.mapRange, "source-absent", reference.id);
  assert.equal(next.actors.find((actor) => actor.id === "-1001")!.position.x, 34359738368);
  assert.equal(next.actors.find((actor) => actor.id === "-1001")!.position.y, 34359738368);
  assert.deepEqual(serial(t.snapshot()), before);
});

test("relative SetPos publication rejects changed reference instances and positions, including the camera", () => {
  for (const change of ["position", "instance", "camera"] as const) {
    const t = setup(), reference = referenceActor(t), camera = t.snapshot().camera!;
    const command = change === "camera" ? { ...relative(), referenceEntityId: 0 } : relative();
    const referenceId = change === "camera" ? camera.id : reference.id;
    const publish = prepareNativeFieldActorProjection(t.host, (snapshot, providers) => projectNativeFieldPosition(
      snapshot, providers, "-1001", command, t.f.map.mapRange, "source-absent", referenceId));
    if (change === "position") reference.native.entity.position.x += 16;
    if (change === "instance") t.owner[reference.id] = { ...reference };
    if (change === "camera") t.host.readCamera()!.position.x += 16;
    const before = serial(t.snapshot());
    assert.throws(publish, /Stale native/); assert.deepEqual(serial(t.snapshot()), before);
  }
});

test("relative SetPos late media or actor-motion refusal leaves both actors and playback unchanged", () => {
  for (const failure of ["animation", "material", "motion"] as const) {
    const t = setup(), reference = referenceActor(t), actor = t.owner["-1001"]!;
    const command = { ...relative(), layer: 2 as const, animation: failure === "animation" ? "missing" : "wave" };
    if (failure === "material") t.f.input.providers.applyViewProperties = () => null;
    if (failure === "motion") actor.motion = { from: { x: 3, y: 4 }, to: { x: 4, y: 4 }, elapsed: 0, duration: 240, manual: false };
    const before = serial(t.snapshot());
    assert.throws(() => prepareNativeFieldActorProjection(t.host, (snapshot, providers) => projectNativeFieldPosition(
      snapshot, providers, actor.id, command, t.f.map.mapRange, "source-absent", reference.id)),
    /Missing actor animation|material projection|active movement/);
    assert.deepEqual(serial(t.snapshot()), before);
  }
});

test("the complete field decoder cannot fall back from an explicit source SetPos owner or malformed ABI", () => {
  const raw = { type: 2, mnemonic: "SetPos", operands: {
    iValues: [13, 24, 3, 0, 0, 0, 0, 0], rValues: Array(8).fill(0),
    sValues: ["Default", "", "", "", "", "", "", ""],
  } };
  const site = { script: "controlled-setpos-decoder", index: 0,
    source: { file: "tests/field-native-position.test.ts", assetPath: "controlled/setpos", objectId: "7" } };
  const admitted = decodeFieldOp(raw, site, {});
  assert.equal(admitted.kind, "position");
  if (admitted.kind !== "position") assert.fail("Expected source absolute position");
  assert.deepEqual(admitted.nativeCommand, { x: 13, y: 24, layer: 3, animation: "Default" });
  for (const type of [1, 0, 3]) assert.equal(decodeFieldOp({ ...raw, type }, site, {}).kind, "blocked");
  const reserved = structuredClone(raw); reserved.operands.iValues[5] = 1;
  assert.equal(decodeFieldOp(reserved, site, {}).kind, "blocked");
  for (const key of ["iValues", "rValues", "sValues"] as const) {
    const short = structuredClone(raw); short.operands[key].length = 7;
    assert.equal(decodeFieldOp(short, site, {}).kind, "blocked", key);
  }
  const { type: _, ...legacy } = raw;
  const compatible = decodeFieldOp(legacy, site, {});
  assert.equal(compatible.kind, "position");
  if (compatible.kind !== "position") assert.fail("Expected legacy authored position");
  assert.equal(compatible.nativeCommand, undefined);
  assert.deepEqual({ x: compatible.x, y: compatible.y, animation: compatible.animation },
    { x: 13, y: 24, animation: "Default" });
});
