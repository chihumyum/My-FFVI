import test from "node:test";
import assert from "node:assert/strict";
import { FieldCameraHost, type FieldCameraPlayerRead, type FieldCameraViewport } from "../src/core/field-camera-host.js";
import { compileFieldCameraHostDefinition, assertFieldCameraEntitySet } from "../src/compiler/field-camera-host.js";
import type { FieldCameraLerp } from "../src/core/field-camera.js";

const sources = [
  { file: "GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" },
  { file: "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle",
    sha256: "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa" },
];
const object = (type: number) => ({ x: 160, y: 320, width: 960, height: 640,
  properties: [{ name: "object_type", type: "int", value: type }] });
const definition = (loopType = 0) => compileFieldCameraHostDefinition(sources,
  { width: 80, height: 80, tilewidth: 16, tileheight: 16 }, { layers: [{ objects: [object(27)] }] },
  { mapViewType: 0, loopType });
const viewport: FieldCameraViewport = { aspect: 2, orthographicSize: 100, isClamp: false, effectOffset: { x: 0, y: 0 } };
function host(loopType = 0) {
  const data: { player: FieldCameraPlayerRead; scroll: { x: number; y: number } } = {
    player: { cell: { x: 29, y: 25 }, logicalLayer: 1, direction: "down" }, scroll: { x: 16, y: -8 },
  };
  const ports = { readPlayer: () => data.player, readScrollOffset: () => data.scroll };
  return { camera: new FieldCameraHost(definition(loopType), ports), data, ports };
}

test("fresh source camera preserves null target; initializing dummy does not begin tracking", () => {
  const { camera } = host(), initial = camera.snapshot();
  assert.equal(camera.projection(viewport), null);
  const init = camera.prepareInitializeDummy();
  assert.equal(init.refresh, false); assert.equal(init.callbackDisposition, "not-invoked");
  assert.deepEqual(camera.snapshot(), initial);
  init.commit(); assert.equal(camera.snapshot().target, null);
  assert.deepEqual(camera.snapshot().dummy.position, { x: -168, y: 232, z: 249 });
  assert.deepEqual(camera.snapshot().dummy.entityOffset, { x: 0, y: 0 });
});

test("camera tracking reads current global player cells and scroll without saving a player copy", () => {
  const { camera, data } = host();
  camera.prepareSelect({ target: "player" }).commit();
  const saved = camera.snapshot(), first = camera.projection(viewport)!;
  assert.deepEqual(first.cameraCell, { x: 30, y: 25.5 });
  assert.deepEqual(first.renderCell, { x: 30, y: 25.875 });
  data.player.cell = { x: 30.25, y: 27.5 }; data.scroll = { x: 0, y: 0 };
  const next = camera.projection(viewport)!;
  assert.deepEqual(next.cameraCell, data.player.cell);
  assert.deepEqual(next.renderCell, { x: 30.25, y: 27.875 });
  assert.deepEqual(camera.snapshot(), saved);
  assert.deepEqual(Object.keys(saved).sort(), ["dummy", "kind", "target"]);
});

test("dummy target captures actual visual offset; reselecting dummy does not jump to player", () => {
  const { camera, data } = host();
  const candidate = camera.prepareSelect({ target: "dummy" });
  assert.equal(candidate.refresh, true); assert.equal(candidate.resetDummyMovement, true);
  assert.equal(candidate.callbackDisposition, "source-absent"); candidate.commit();
  assert.deepEqual(camera.snapshot().dummy.entityOffset, { x: 0, y: -6 });
  const before = camera.snapshot(); data.player.cell = { x: 50, y: 40 };
  camera.prepareSelect({ target: "dummy" }).commit();
  assert.deepEqual(camera.snapshot(), before);
  camera.prepareSelect({ target: "player" }).commit();
  assert.deepEqual(camera.snapshot().dummy, before.dummy);
  assert.deepEqual(camera.projection({ ...viewport, effectOffset: { x: -16, y: 8 } })!.cameraCell, data.player.cell);
});

test("camera SetPos applies global map range, preserves independent player and offset", () => {
  const { camera, data } = host(); camera.prepareSelect({ target: "dummy" }).commit();
  const player = structuredClone(data.player), candidate = camera.prepareSetPosition({ kind: "set-position", x: 39, y: 44, layer: 0 });
  assert.equal(candidate.refresh, false); assert.equal(candidate.callbackDisposition, "source-absent");
  assert.equal(camera.snapshot().dummy.position.y, 232); candidate.commit();
  const projection = camera.projection({ ...viewport, effectOffset: { x: -16, y: 8 } })!;
  assert.deepEqual(projection.cameraCell, { x: 39, y: 44 });
  assert.deepEqual(projection.renderCell, { x: 39, y: 44.375 });
  assert.deepEqual(data.player, player);
});

test("Lerp registers stay in each task and prepared motion does not mutate the camera", () => {
  const { camera } = host(); camera.prepareSelect({ target: "dummy" }).commit();
  const command: FieldCameraLerp = { kind: "lerp", x: 29, y: 44, layer: 0, duration: 10, arcHeight: 0 };
  const initial = camera.snapshot(), first = camera.prepareLerp(command, null, 2);
  assert.equal(first.flow, "wait"); assert.equal(first.callbackDisposition, "not-invoked");
  assert.deepEqual(camera.snapshot(), initial); first.commit();
  const a = camera.prepareLerp(command, first.progress, 7);
  assert.equal(a.flow, "wait"); a.commit();
  const second = camera.prepareLerp({ ...command, x: 39 }, null, 7); second.commit();
  assert.notDeepEqual(second.progress.start, first.progress.start);
  assert.equal(second.progress.startedAt, 7);
  const done = camera.prepareLerp(command, first.progress, 12); done.commit();
  assert.equal(done.flow, "next");
  assert.equal(camera.snapshot().dummy.position.z, 249);
  assert.deepEqual(Object.keys(camera.snapshot()).sort(), ["dummy", "kind", "target"]);
});

test("failed or stale camera transactions preserve the current owner and detached candidates", () => {
  const { camera } = host(); camera.prepareSelect({ target: "dummy" }).commit();
  const a = camera.prepareSetPosition({ kind: "set-position", x: 39, y: 44, layer: 0 });
  const b = camera.prepareSetPosition({ kind: "set-position", x: 39, y: 45, layer: 0 });
  a.state.dummy.position.x = 999; a.commit();
  const state = camera.snapshot(); assert.notEqual(state.dummy.position.x, 999);
  assert.throws(() => b.commit(), /Stale/); assert.throws(() => a.commit(), /Stale/);
  assert.throws(() => camera.prepareSetPosition({ kind: "set-position", x: 1, y: 1, layer: 2 } as never));
  assert.deepEqual(camera.snapshot(), state);
});

test("camera visibility is a prepared native state change and survives motion and stable restore", () => {
  const { camera, ports } = host(); camera.prepareSelect({ target: "dummy" }).commit();
  const before = camera.snapshot(), show = camera.prepareVisibility(true), stale = camera.prepareVisibility(false);
  assert.deepEqual(camera.snapshot(), before);
  assert.deepEqual(before.dummy.visibility, { activeSelf: null, fadeAlpha: 0, currentFadeStatus: 0 });
  show.state.dummy.visibility.activeSelf = false;
  show.commit();
  assert.deepEqual(camera.snapshot().dummy.visibility, { activeSelf: true, fadeAlpha: 1, currentFadeStatus: 0 });
  assert.throws(() => stale.commit(), /Stale/);
  camera.prepareVisibility(false).commit();
  const hidden = camera.snapshot().dummy.visibility;
  camera.prepareSetPosition({ kind: "set-position", x: 39, y: 44, layer: 0 }).commit();
  camera.prepareLerp({ kind: "lerp", x: 40, y: 44, layer: 0, duration: 0, arcHeight: 0 }, null, 1).commit();
  camera.prepareSelect({ target: "dummy" }).commit();
  assert.deepEqual(camera.snapshot().dummy.visibility, hidden);
  const restored = new FieldCameraHost(definition(), ports, JSON.parse(JSON.stringify(camera.snapshot())));
  assert.deepEqual(restored.snapshot(), camera.snapshot());
  assert.deepEqual(restored.projection(viewport), camera.projection(viewport));
  assert.throws(() => camera.prepareVisibility(0 as never));
});

test("stable camera checkpoint round-trips with trusted content and destination read ports", () => {
  const { camera, ports } = host(); camera.prepareSelect({ target: "dummy" }).commit();
  camera.prepareSetPosition({ kind: "set-position", x: 39, y: 44, layer: 0 }).commit();
  const checkpoint = JSON.parse(JSON.stringify(camera.snapshot()));
  const restored = new FieldCameraHost(definition(), ports, checkpoint);
  assert.deepEqual(restored.projection(viewport), camera.projection(viewport));
  const changed = host(); changed.data.player.cell = { x: 42.5, y: 39.25 };
  const fork = camera.fork(definition(3), changed.ports);
  fork.prepareInitializeDummy().commit(); fork.prepareSelect({ target: "player" }).commit();
  assert.deepEqual(fork.projection({ ...viewport, effectOffset: { x: -16, y: 8 } })!.cameraCell, changed.data.player.cell);
  assert.deepEqual(camera.snapshot(), checkpoint);
  assert.throws(() => new FieldCameraHost(definition(), ports, { ...checkpoint, callbacks: "fresh-normal-field-v1" }));
  assert.throws(() => new FieldCameraHost({ ...definition(), callbacks: "unknown" } as never, ports, checkpoint));
  assert.throws(() => new FieldCameraHost({ ...definition(), playerVisualOffset: { x: 0, y: 0 } }, ports));
});

test("source camera clamp is distinct from raw renderer callbacks and visual target", () => {
  const { camera, data } = host(); data.player.cell = { x: 10, y: 20 }; data.scroll = { x: 0, y: 0 };
  camera.prepareSelect({ target: "player" }).commit();
  const p = camera.projection({ ...viewport, isClamp: true, effectOffset: { x: 3, y: -2 } })!;
  assert.deepEqual(p.position, { x: -280, y: 220 });
  assert.deepEqual(p.cameraPosition, { x: -277, y: 218 });
  assert.deepEqual(p.moveCamera, { followingEntityPosition: { x: -472, y: 312 }, offsetPosition: { x: 3, y: -2 }, isScreenshot: false });
  assert.deepEqual(p.renderPosition, { x: -469, y: 304 });
  assert.deepEqual(p.moveMapRender, p.renderPosition);
  assert.deepEqual(p.frontRenderArea, { x: -469, margin: 32 });
  assert.equal(p.clampTileSubY, 12);
});

test("source loops disable only their own clamp axis; screenshot disables both", () => {
  const samples = [0, 1, 2, 3].map((loop) => {
    const { camera, data } = host(loop); data.player.cell = { x: 10, y: 20 }; data.scroll = { x: 0, y: 0 };
    camera.prepareSelect({ target: "player" }).commit();
    return camera.projection({ ...viewport, isClamp: true })!;
  });
  assert.deepEqual(samples.map((p) => p.position), [
    { x: -280, y: 220 }, { x: -472, y: 220 }, { x: -280, y: 312 }, { x: -472, y: 312 }]);
  assert.deepEqual(samples.map((p) => p.clampTileSubY), [12, 12, 0, 0]);
  const { camera } = host(); camera.prepareSelect({ target: "player" }).commit();
  assert.equal(camera.projection(viewport)!.moveCamera.isScreenshot, true);
  assert.throws(() => camera.projection({ ...viewport, aspect: 0 }));
});

test("source wide-aspect cap and maps smaller than viewport retain native clamp behavior", () => {
  const { camera, data } = host(); data.player.cell = { x: 0, y: 0 }; data.scroll = { x: 0, y: 0 };
  camera.prepareSelect({ target: "player" }).commit();
  const capped = camera.projection({ ...viewport, aspect: 10, isClamp: true })!;
  const exact = camera.projection({ ...viewport, aspect: Math.fround(2.3703704), isClamp: true })!;
  assert.deepEqual(capped, exact);
  const large = camera.projection({ ...viewport, aspect: 10, orthographicSize: 1000, isClamp: true })!;
  assert.deepEqual(large.position, { x: -0, y: 0 });
  const before = camera.snapshot();
  assert.throws(() => camera.projection({ ...viewport, orthographicSize: 3e38 }), /camera host number/);
  assert.throws(() => camera.projection({ ...viewport, aspect: 2, orthographicSize: 1e38, isClamp: true }), /camera host number/);
  assert.deepEqual(camera.snapshot(), before);
});

test("forked Init then target selection publish once into the original camera owner", () => {
  const { camera, ports } = host(), before = camera.snapshot();
  const fork = camera.fork(definition(), ports);
  fork.prepareInitializeDummy().commit(); fork.prepareSelect({ target: "dummy" }).commit();
  const snapshot = fork.snapshot(), commit = camera.prepareState(snapshot);
  assert.deepEqual(camera.snapshot(), before);
  snapshot.dummy.position.x = 999; commit.state.dummy.position.x = 888;
  commit.commit();
  assert.deepEqual(camera.snapshot(), fork.snapshot());
  const changed = camera.snapshot(); changed.dummy.position.y += 16;
  camera.prepareState(changed).commit();
  assert.deepEqual(camera.snapshot(), changed);
  assert.throws(() => camera.prepareState({ ...changed, ports: {} } as never));
});

test("factory compiler rejects unrelated binaries, bird views and visual-offset trigger sets", () => {
  const tilemap = { width: 80, height: 80, tilewidth: 16, tileheight: 16 }, entities = { layers: [] };
  const compile = (source = sources, view = 0, loop = 0, objects = entities) =>
    compileFieldCameraHostDefinition(source, tilemap, objects, { mapViewType: view, loopType: loop });
  assert.throws(() => compile([]));
  assert.throws(() => compile([{ ...sources[0]!, sha256: "0".repeat(64) }, sources[1]!]));
  assert.throws(() => compile(sources, 1), /Bird/); assert.throws(() => compile(sources, 2), /Bird/);
  assert.throws(() => compile(sources, 0, 4), /loop/);
  assert.throws(() => assertFieldCameraEntitySet({ layers: [{ objects: [object(15)] }] }), /ChangeOffset/);
  assert.throws(() => assertFieldCameraEntitySet({ layers: [{ objects: [{ properties: [] }] }] }), /source type/);
  assertFieldCameraEntitySet({ layers: [{ objects: [object(27), object(7)] }] });
  const compiled = compile(); compiled.sources[0]!.sha256 = "0".repeat(64);
  assert.equal(compile().sources[0]!.sha256, sources[0]!.sha256);
});
