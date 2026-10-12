import assert from "node:assert/strict";
import test from "node:test";
import { assertFieldParticleGeometryExecutable, blendFieldEffectBoard, fieldEffectBoardFragment,
  transformFieldParticleVertex, validateFieldParticleGeometry, type FieldEffectCompositionBatch,
  type ParticleColor } from "../src/core/field-particle-geometry.js";
import { compileFieldEffectBoardMaterial } from "../src/compiler/field-particle-geometry.js";
import { composeFieldNativePixels, type FieldCompositionActorQuad, type FieldCompositionQuad } from "../src/core/field-native-composition.js";
import { effectBoardMaterial, effectBoardMaterialExport, particleGeometry } from "./fixtures/field-particle-geometry.js";

const white: ParticleColor = [1, 1, 1, 1], identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const image = (bytes: number[]) => ({ width: 1, height: 1, data: new Uint8ClampedArray(bytes) });
function batch(bytes: number[], overrides: Partial<FieldEffectCompositionBatch> = {}): FieldEffectCompositionBatch {
  return { id: "controlled-board", queue: 2458, blendType: 0, zTest: 4, stencilReference: 0, alpha: 1,
    quads: [{ image: image(bytes), destination: { x: 0, y: 0, width: 1, height: 4 }, uv: { left: 0, right: 1, top: 1, bottom: 0 }, depth: 5 }], ...overrides };
}
function tile(bytes: number[], depth: number): FieldCompositionQuad {
  return { image: image(bytes), source: { x: 0, y: 0, width: 1, height: 1 }, destination: { x: 0, y: 0, width: 1, height: 4 },
    flipX: false, flipY: false, diagonal: false, depth };
}
const actor = (depth: number): FieldCompositionActorQuad => ({ ...tile([255, 0, 0, 255], depth), alpha: 1, first: null, second: null });
const compose = (batches: FieldEffectCompositionBatch[], tiles: FieldCompositionQuad[] = [], actors: FieldCompositionActorQuad[] = []) =>
  composeFieldNativePixels({ width: 1, height: 4, tiles, actors, effects: { material: effectBoardMaterial(), batches } });
const pixel = (output: { data: Uint8ClampedArray }, row = 0) => [...output.data.slice(row * 4, row * 4 + 4)];

test("source camera/renderer inputs do not qualify a fabricated billboard or RT provider", () => {
  const geometry = particleGeometry(); validateFieldParticleGeometry(geometry);
  assert.throws(() => assertFieldParticleGeometryExecutable(geometry), /billboard.*draw order.*color encoding/);
  const cleared = structuredClone(geometry); cleared.requirements = [];
  assert.throws(() => assertFieldParticleGeometryExecutable(cleared), /Unbound source particle geometry/);
  for (const change of [(g: typeof geometry) => { g.target.depthBits = 24 as 0; },
    (g: typeof geometry) => { g.target.requestedSRGB = false as true; },
    (g: typeof geometry) => { g.renderer.alignment = 1 as 0; },
    (g: typeof geometry) => { g.renderer.pivot.x = 1; },
    (g: typeof geometry) => { g.camera.viewport = [0, 0, 0.5 as 1, 1]; }]) {
    const invalid = structuredClone(geometry); change(invalid); assert.throws(() => validateFieldParticleGeometry(invalid));
  }
});
test("source vertex program applies supplied world and VP matrices once, preserving UV and color", () => {
  // First transform is Z rotation +90 degrees followed by (7, 11, 13),
  // then VP scales XYZ by (2, 3, 4). Expected world=(4,13,18,1).
  const world = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 7, 11, 13, 1];
  const vp = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1];
  const input = { position: { x: 2, y: 3, z: 5 }, objectToWorld: world, viewProjection: vp,
    uv: [0.25, 0.75] as const, color: [0.5, 0.25, 1, 0.75] as const };
  assert.deepEqual(transformFieldParticleVertex(input), { clip: [8, 39, 72, 1], uv: [0.25, 0.75], color: [0.5, 0.25, 1, 0.75] });
  assert.throws(() => transformFieldParticleVertex({ ...input, objectToWorld: [] }), /matrix/);
  assert.throws(() => transformFieldParticleVertex({ ...input, viewProjection: [...identity.slice(0, 15), Infinity] }), /number/);
});
test("board compiler follows exact source object pointers and locks both pass states", () => {
  const raw = effectBoardMaterialExport(); assert.deepEqual(compileFieldEffectBoardMaterial(raw), effectBoardMaterial());
  for (const change of [(d: typeof raw) => { d.particleEntity.data.originalEffectMaterial.m_PathID = "1"; },
    (d: typeof raw) => { d.shader.passes[1]!.state.zWrite.val = 1; },
    (d: typeof raw) => { d.shader.passes[0]!.state.rtBlend0.srcBlendAlpha.name = "_Other"; },
    (d: typeof raw) => { d.material.data.m_ShaderKeywords = "FADE"; },
    (d: typeof raw) => { d.material.data.m_SavedProperties.m_TexEnvs.push(d.material.data.m_SavedProperties.m_TexEnvs[0]!); }]) {
    const invalid = structuredClone(raw); change(invalid); assert.throws(() => compileFieldEffectBoardMaterial(invalid));
  }
});
test("two source board alpha/RGB tests overlap; color pass is not transparent-only", () => {
  for (const alpha of [0, 1, 127, 253, 254, 255]) {
    const sample: ParticleColor = [1, 0, 0, alpha / 255];
    assert.equal(fieldEffectBoardFragment(sample, white, 1, "opaque") !== null, alpha >= 254);
    assert.notEqual(fieldEffectBoardFragment(sample, white, 1, "color"), null, "color fragment does not test alpha");
  }
  assert.equal(fieldEffectBoardFragment([0, 0, 0, 1], white, 1, "color"), null);
  assert.deepEqual(fieldEffectBoardFragment([0, 0, 0, 1], white, 1, "opaque"), [0, 0, 0, 1]);
  assert.equal(fieldEffectBoardFragment([1 / 512, 0, 0, 0.5], white, 1, "color"), null);
  assert.notEqual(fieldEffectBoardFragment([1 / 255, 0, 0, 0.5], white, 1, "color"), null);
  assert.deepEqual(fieldEffectBoardFragment([1, 0.5, 0.25, 1], white, 0.5, "color"), [0.5, 0.25, 0.125, 0.5]);
});
test("source blend modes use One or destination color, and alpha follows the same factor", () => {
  const source: ParticleColor = [0.25, 0.5, 0.75, 0.5], destination: ParticleColor = [0.5, 0.25, 1, 0.5];
  assert.deepEqual(blendFieldEffectBoard(source, destination, 0), [0.5, 0.625, 1, 0.75]);
  assert.deepEqual(blendFieldEffectBoard(source, destination, 1), [0.75, 0.75, 1, 1]);
  assert.deepEqual(blendFieldEffectBoard(source, destination, 2), [0.125, 0.125, 0.75, 0.25]);
});
test("both opaque and color passes run over the same RGBA attachment", () => {
  const output = compose([batch([32, 16, 0, 255], { blendType: 1 })]);
  assert.deepEqual(pixel(output), [64, 32, 0, 255], "two additive passes; a single overlay would only produce 32/16");
  assert.equal(output.depths[0], 5); assert.equal(output.stencil[0], 0);
  const lowAlpha = compose([batch([32, 16, 0, 128], { blendType: 1 })]);
  assert.deepEqual(pixel(lowAlpha), [32, 16, 0, 128]); assert.equal(lowAlpha.depths[0], Infinity);
});
test("board opaque pass writes common depth, while partial-alpha color does not", () => {
  const behind = actor(10);
  const opaque = compose([batch([0, 255, 0, 255], { queue: 2453 })], [], [behind]);
  assert.deepEqual(pixel(opaque), [0, 255, 0, 255]); assert.equal(opaque.depths[0], 5);
  const partial = compose([batch([0, 64, 0, 128], { queue: 2453 })], [], [behind]);
  assert.deepEqual(pixel(partial), [255, 0, 0, 255]); assert.equal(partial.depths[0], 10);
  assert.equal(partial.stencil[0], 2, "the later surviving actor uses source Replace 2");
});
test("front board LEqual still respects tile/actor depth; Always does not disable depth writes", () => {
  const occluder = tile([255, 0, 0, 255], 2);
  assert.deepEqual(pixel(compose([batch([0, 64, 0, 128])], [occluder])), [255, 0, 0, 255]);
  const always = compose([batch([0, 255, 0, 255], { zTest: 8, stencilReference: 2 })], [occluder]);
  assert.deepEqual(pixel(always), [0, 255, 0, 255]); assert.equal(always.depths[0], 5); assert.equal(always.stencil[0], 2);
});
test("standard queues bracket actor body/head and front unaffected comes after front affected", () => {
  const queue2453 = batch([0, 64, 0, 128], { queue: 2453 }), queue2458 = batch([0, 64, 0, 128], { queue: 2458 });
  assert.deepEqual(pixel(compose([queue2453], [], [actor(10)])), [255, 0, 0, 255]);
  const after = compose([queue2458], [], [actor(10)]);
  assert.deepEqual(pixel(after), [127, 64, 0, 255]); assert.deepEqual(pixel(after, 3), [127, 64, 0, 255]);
  // Input intentionally reversed; numeric source queues still run 2458 then 2460.
  const ordered = compose([batch([0, 0, 64, 128], { id: "late", queue: 2460 }), queue2458]);
  assert.deepEqual(pixel(ordered), [0, 32, 64, 192]);
});
test("each renderer completes its first pass before its second pass over overlapping strips", () => {
  const red = batch([32, 0, 0, 255], { blendType: 1 }), green = batch([0, 64, 0, 255]);
  red.quads[0]!.depth = 10;
  const output = compose([{ ...red, quads: [...red.quads, ...green.quads] }]);
  // The nearer green first pass prevents the farther red second pass.
  assert.deepEqual(pixel(output), [32, 128, 0, 255]); assert.equal(output.depths[0], 5);
});
test("source UV orientation, zero strips, clipping and preparation failures keep inputs unchanged", () => {
  const prepared = batch([0, 0, 0, 0]); prepared.quads[0]!.image = { width: 1, height: 2,
    data: new Uint8ClampedArray([32, 0, 0, 128, 0, 64, 0, 128]) };
  const output = compose([prepared]); assert.deepEqual(pixel(output), [32, 0, 0, 128]); assert.deepEqual(pixel(output, 3), [0, 64, 0, 128]);
  const zero = structuredClone(prepared); zero.quads[0]!.destination.height = 0;
  assert.deepEqual([...compose([zero]).data], Array(16).fill(0));
  const clipped = structuredClone(prepared); clipped.quads[0]!.depth = -50;
  assert.deepEqual([...compose([clipped]).data], Array(16).fill(0));
  const before = structuredClone(prepared), invalid = structuredClone(prepared); invalid.id = "invalid"; invalid.quads[0]!.uv.right = 2;
  assert.throws(() => compose([prepared, invalid]), /UV geometry/); assert.deepEqual(prepared, before);
});
