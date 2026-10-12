import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldNativePosition } from "../src/compiler/field-native-position.js";
import { createFieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { createNativeFieldActorProjections, prepareNativeFieldActorProjection, readNativeFieldActors } from "../src/core/field-native-actors.js";
import { projectNativeFieldPosition, type FieldNativePosition } from "../src/core/field-native-position.js";
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

test("native SetPos decoder retains layer and arbitrary source animation but rejects relative and stray operands", () => {
  const raw = { type: 2, mnemonic: "SetPos", operands: {
    iValues: [13, 24, 2, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: ["wave", "", "", "", "", "", "", ""],
  } };
  assert.deepEqual(compileFieldNativePosition(raw), { x: 13, y: 24, layer: 2, animation: "wave" });
  for (const change of ["mode", "reference", "layer", "real", "string"] as const) {
    const value = structuredClone(raw);
    if (change === "mode") value.operands.iValues[3] = 1;
    if (change === "reference") value.operands.iValues[4] = 8;
    if (change === "layer") value.operands.iValues[2] = 4;
    if (change === "real") value.operands.rValues[0] = 1;
    if (change === "string") value.operands.sValues[1] = "unused";
    assert.throws(() => compileFieldNativePosition(value), /mode\/layer\/operand/);
  }
});
