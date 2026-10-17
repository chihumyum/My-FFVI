import test from "node:test";
import assert from "node:assert/strict";
import { createFieldCameraState, fieldCameraRestoresPlayerAtScriptEnd, initializeFieldCameraDummy,
  projectFieldCamera, projectFieldCameraTarget, projectFieldCameraVisibility, validateFieldCameraState,
  type FieldCameraActor, type FieldCameraState } from "../src/core/field-camera.js";
import { compileFieldCameraInstruction, fieldCameraSelectors } from "../src/compiler/field-camera.js";

const player = (): FieldCameraActor => ({ position: { x: 40, y: -80, z: -14 },
  entityPosition: { x: 43, y: -84 }, layer: 9, layerZ: -200, direction: "left" });
const layers = { "9": -200 };
const dummy = () => projectFieldCameraTarget(createFieldCameraState(), { target: "dummy" }, player(), layers).state;

test("source camera dummy factory is separate, offscreen and initially untargeted", () => {
  const state = createFieldCameraState();
  assert.deepEqual(state, { kind: "field-camera-v2", target: null,
    dummy: { position: { x: 30000, y: 1000, z: -1000 }, entityOffset: { x: 0, y: 0 }, layer: 0, direction: null,
      visibility: { activeSelf: null, fadeAlpha: 0, currentFadeStatus: 0 } } });
  assert.equal(projectFieldCamera(state, player(), { x: 0, y: 0 }), null);
  assert.equal("actors" in state, false);
});

test("InitCameraDummy copies actual player root/layer but preserves target, offset and direction", () => {
  const state = dummy(), before = structuredClone(state);
  const p = player(); p.position = { x: 100, y: -150, z: 10 }; p.direction = "up";
  const initialized = initializeFieldCameraDummy(state, p);
  assert.deepEqual(initialized.dummy.position, p.position);
  assert.equal(initialized.dummy.layer, p.layer);
  assert.equal(initialized.dummy.direction, "left");
  assert.deepEqual(initialized.dummy.entityOffset, { x: 3, y: -4 });
  assert.equal(initialized.target, "dummy");
  assert.deepEqual(state, before);
});

test("switch to dummy captures previous player root, visual offset, source layer Z and direction", () => {
  const state = createFieldCameraState(), before = structuredClone(state);
  const plan = projectFieldCameraTarget(state, { target: "dummy" }, player(), layers);
  assert.deepEqual(plan.state.dummy, { position: { x: 40, y: -80, z: -200 },
    entityOffset: { x: 3, y: -4 }, layer: 9, direction: "left", visibility: state.dummy.visibility });
  assert.equal(plan.resetDummyMovement, true);
  assert.equal(plan.notifyMove, "dummy");
  assert.equal(plan.refresh, true);
  assert.deepEqual(state, before);
});

test("reselecting dummy reinitializes from the previous dummy, not a moved player", () => {
  const state = dummy(); state.dummy.position = { x: 120, y: -96, z: -200 };
  state.dummy.direction = "right";
  const p = player(); p.position.x = 900;
  const plan = projectFieldCameraTarget(state, { target: "dummy" }, p, layers);
  assert.deepEqual(plan.state.dummy, state.dummy);
  assert.equal(plan.resetDummyMovement, true);
  assert.deepEqual(projectFieldCamera(plan.state, p, { x: 8, y: 2 }), {
    cameraPosition: { x: 128, y: -94 }, renderPosition: { x: 131, y: -98 },
  });
});

test("switch back to player retains camera dummy, follows current root and requires no dummy layer lookup", () => {
  const state = dummy(), p = player(); p.position.x = 320; p.entityPosition.x = 323;
  const plan = projectFieldCameraTarget(state, { target: "player" }, p, {});
  assert.deepEqual(plan.state.dummy, state.dummy);
  assert.equal(plan.resetDummyMovement, false);
  assert.equal(plan.notifyMove, "player");
  assert.deepEqual(projectFieldCamera(plan.state, p, { x: 5, y: 0 }), {
    cameraPosition: { x: 325, y: -80 }, renderPosition: { x: 328, y: -84 },
  });
});

test("camera and render positions preserve native float32 addition/subtraction order", () => {
  const p = player(); p.position.x = 16777216; p.entityPosition.x = 16777218;
  const plan = projectFieldCameraTarget(createFieldCameraState(), { target: "dummy" }, p, layers);
  assert.equal(plan.state.dummy.entityOffset.x, 2);
  assert.deepEqual(projectFieldCamera(plan.state, p, { x: 1, y: 0 }), {
    cameraPosition: { x: 16777216, y: -80 }, renderPosition: { x: 16777220, y: -84 },
  });
});

test("bad camera dependencies reject without changing state or actual player", () => {
  const state = dummy(), p = player(), before = structuredClone({ state, p });
  assert.throws(() => projectFieldCameraTarget(state, { target: "dummy" }, p, {}), /layer\/direction/);
  assert.throws(() => projectFieldCamera(state, { ...p, position: { ...p.position, x: NaN } }, { x: 0, y: 0 }), /number/);
  assert.throws(() => projectFieldCameraTarget(state, { target: "npc" } as never, p, layers), /target/);
  assert.deepEqual({ state, p }, before);
});

test("camera checkpoint is strict and keeps dummy visibility in its sole owner", () => {
  const state = dummy(); validateFieldCameraState(JSON.parse(JSON.stringify(state)));
  for (const injected of [{ ...state, hiddenEntities: [] }, { ...state, actors: {} },
    { ...state, dummy: { ...state.dummy, collision: true } }, { ...state, target: "0" },
    { ...state, kind: "field-camera-v1" }])
    assert.throws(() => validateFieldCameraState(injected as FieldCameraState));
});

test("source zero-duration camera Show/Hide keep alpha, fade status and active state without moving its transform", () => {
  const fresh = dummy(), before = structuredClone(fresh);
  const shown = projectFieldCameraVisibility(fresh, true), hidden = projectFieldCameraVisibility(shown, false);
  assert.deepEqual(shown.dummy.visibility, { activeSelf: true, fadeAlpha: 1, currentFadeStatus: 0 });
  assert.deepEqual(hidden.dummy.visibility, { activeSelf: false, fadeAlpha: 0, currentFadeStatus: 0 });
  assert.deepEqual(fresh, before);
  assert.deepEqual(hidden.dummy.position, before.dummy.position);
  assert.deepEqual(projectFieldCamera(hidden, player(), { x: 0, y: 0 }), projectFieldCamera(shown, player(), { x: 0, y: 0 }));
  assert.deepEqual(projectFieldCameraTarget(hidden, { target: "dummy" }, player(), layers).state.dummy.visibility, hidden.dummy.visibility);
  assert.deepEqual(initializeFieldCameraDummy(hidden, player()).dummy.visibility, hidden.dummy.visibility);
  assert.throws(() => projectFieldCameraVisibility(fresh, null as never));
  for (const visibility of [{ activeSelf: true, fadeAlpha: 0, currentFadeStatus: 0 },
    { activeSelf: null, fadeAlpha: 1, currentFadeStatus: 0 }, { activeSelf: false, fadeAlpha: 0, currentFadeStatus: 2 },
    { activeSelf: false, fadeAlpha: 0.5, currentFadeStatus: 0 }])
    assert.throws(() => validateFieldCameraState({ ...hidden, dummy: { ...hidden.dummy, visibility } } as FieldCameraState));
});

test("EventActionScript.End restores player only for its source branches", () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => fieldCameraRestoresPlayerAtScriptEnd(i)),
    [true, false, true, true, true, false, true, false]);
  assert.throws(() => fieldCameraRestoresPlayerAtScriptEnd(0.5));
});

const instruction = (selector: string) => ({ type: 1, mnemonic: "SysCall",
  operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: [selector, ...Array(7).fill("")] } });
test("camera selector compiler preserves actual player versus source dummy identity", () => {
  assert.deepEqual(compileFieldCameraInstruction(instruction(fieldCameraSelectors[0])),
    { kind: "field-camera", command: { target: "player" } });
  assert.deepEqual(compileFieldCameraInstruction(instruction(fieldCameraSelectors[1])),
    { kind: "field-camera", command: { target: "dummy" } });
});
test("camera decoder refuses extra targets, durations, shapes and unknown selectors", () => {
  const raw = instruction(fieldCameraSelectors[0]);
  for (const mutate of [(v: typeof raw) => { v.type = 0; },
    (v: typeof raw) => { v.operands.iValues[0] = -1001; },
    (v: typeof raw) => { v.operands.rValues[0] = 0.5; },
    (v: typeof raw) => { v.operands.sValues[1] = "extra"; },
    (v: typeof raw) => { v.operands.sValues[0] = "unknown"; },
    (v: typeof raw) => { v.operands.iValues.pop(); }]) {
    const changed = structuredClone(raw); mutate(changed);
    assert.throws(() => compileFieldCameraInstruction(changed));
  }
});
