import assert from "node:assert/strict";
import test from "node:test";
import { blendSourceFieldParticleTarget, projectSourceFieldParticleGeometry, renderSourceFieldParticleTarget,
  sourceFieldParticleSinCos, validateFieldParticleRendering, type FieldParticleRasterProjection,
  type FieldParticleRenderParticle, type ParticleTransform } from "../src/core/field-particle-geometry.js";
import type { FieldParticleTexture } from "../src/core/field-particles.js";
import { particleRendering } from "./fixtures/field-particle-geometry.js";

const root = (): ParticleTransform => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
const particle = (overrides: Partial<FieldParticleRenderParticle> = {}): FieldParticleRenderParticle => ({
  position: { x: 0, y: 0, z: 0 }, size: 2, rotation: 0, normalizedAge: 0, color32: 0x800000ff, ...overrides });
const project = (particles: FieldParticleRenderParticle[]) => projectSourceFieldParticleGeometry(particleRendering(), particles, root());
const texture = (rgba: number[]): FieldParticleTexture => ({ width: 1, height: 1, rgba: Uint8Array.from(rgba),
  filter: "point", wrapU: "clamp", wrapV: "clamp", rowOrder: "top-to-bottom", colorSpace: "gamma" });
const textures = () => new Map(["main", "mask", "noise"].map((key) => [key, texture([255, 255, 255, 255])]));
// Explicit controlled GPU matrix, including RT Y inversion and a valid D3D
// depth. This is not inferred as the unimplemented source GfxDevice host.
const projection = (): FieldParticleRasterProjection => ({ kind: "source-d3d11-particle-view-projection",
  matrix: [1 / 16, 0, 0, 0, 0, -1 / 16, 0, 0, 0, 0, 1 / 100, 0, 0, 0, 0.5, 1] });
const render = (particles: FieldParticleRenderParticle[]) => renderSourceFieldParticleTarget({ definition: particleRendering(),
  particles, parentTransform: root(), projection: projection(), textures: textures(), engineSeconds: 0, elapsedSeconds: 0 });
const pixel = (output: { width: number; data: Uint8ClampedArray }, x: number, y: number) =>
  Array.from(output.data.subarray((y * output.width + x) * 4, (y * output.width + x) * 4 + 4));

test("qualified geometry preserves native vertex order, UV and final Color32", () => {
  const value = project([particle({ size: 4, color32: 0x12345678 })]);
  assert.deepEqual(value.quads[0]!.vertices.map((v) => v.position), [
    { x: -2, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 2, y: -2, z: 0 }, { x: -2, y: -2, z: 0 }]);
  assert.deepEqual(value.quads[0]!.vertices.map((v) => v.uv), [[0, 1], [1, 1], [1, 0], [0, 0]]);
  assert.deepEqual(value.quads[0]!.vertices[0]!.color, [0x78, 0x56, 0x34, 0x12].map((v) => Math.fround(v / 255)));
  assert.deepEqual(value.triangles, [0, 1, 2, 0, 2, 3]);
});
test("orthographic max size, zero/tiny sizes and age100 follow distinct source branches", () => {
  const values = project([particle({ size: 128 }), particle({ size: 0 }), particle({ size: 1e-8, normalizedAge: 1 }),
    particle({ size: 5, normalizedAge: 100 })]).quads;
  assert.equal(values[0]!.vertices[0]!.position.x, -8, "maximum width is half of this 32-wide camera");
  assert.ok(values[1]!.vertices.every((v) => v.position.x === 0 && v.position.y === 0));
  assert.equal(values[2]!.vertices[0]!.position.x, -Math.fround(Math.fround(1e-8) / 2));
  assert.ok(values[3]!.vertices.every((v) => v.position.x === 0 && v.position.y === 0));
});
test("emitter Z quaternion moves the center once, while view-aligned corners stay in camera axes", () => {
  const d = particleRendering(), parent = root(); parent.position = { x: 10, y: 200, z: 30 };
  d.geometry.emitter.transforms[0]!.rotation = { x: 0, y: 0, z: -0.026176923885941505, w: 0.9996573328971863 };
  const value = projectSourceFieldParticleGeometry(d, [particle({ position: { x: 12.5, y: -5, z: -1 }, size: 0 })], parent);
  // Independent expected values from the exact native 5825-byte template.
  assert.deepEqual(value.quads[0]!.vertices[0]!.position, { x: 22.221189498901367, y: 194.35264587402344, z: 29 });
  assert.deepEqual(value.cameraPosition, { x: 10, y: 200, z: 10 });
  const quad = projectSourceFieldParticleGeometry(d, [particle({ size: 4 })], parent).quads[0]!;
  assert.equal(quad.vertices[1].position.y, quad.vertices[0].position.y);
  assert.equal(quad.vertices[1].position.x - quad.vertices[0].position.x, 4);
});
test("SIMD approximation retains nearest-even semantics for negative and multi-turn rotations", () => {
  assert.deepEqual(sourceFieldParticleSinCos(0), { sin: 0, cos: 1 });
  const a = sourceFieldParticleSinCos(0.5), b = sourceFieldParticleSinCos(-0.5);
  assert.equal(a.cos, b.cos); assert.equal(a.sin, -b.sin);
  assert.notEqual(sourceFieldParticleSinCos(100).sin, Math.fround(Math.sin(100)));
  // The source cvtps2dq rounds; truncation produces visible multi-turn drift.
  assert.deepEqual(sourceFieldParticleSinCos(Math.fround(2 * Math.PI)), { sin: 0, cos: 1 });
  assert.throws(() => sourceFieldParticleSinCos(Infinity), /number/);
  assert.throws(() => sourceFieldParticleSinCos(1e20), /SIMD integer/);
});
test("missing root, arbitrary scales/ancestor transforms and foreign programs remain blocked", () => {
  const d = particleRendering(); validateFieldParticleRendering(d);
  assert.throws(() => projectSourceFieldParticleGeometry(d, [], undefined as unknown as ParticleTransform), /parent transform/);
  const scaled = root(); scaled.scale.x = 2;
  assert.throws(() => projectSourceFieldParticleGeometry(d, [], scaled), /scale\/rotation/);
  const rotated = root(); rotated.rotation.z = 1; rotated.rotation.w = 0;
  assert.throws(() => projectSourceFieldParticleGeometry(d, [], rotated), /scale\/rotation/);
  for (const mutate of [(x: typeof d) => { x.colorSpace.active = 1 as 0; },
    (x: typeof d) => { x.entity.transform.objectId = "1"; },
    (x: typeof d) => { x.target.depthAttachment = {} as unknown as null; },
    (x: typeof d) => { x.material.fragmentSha256 = "f".repeat(64); },
    (x: typeof d) => { const t = root(); t.position.x = 1; x.geometry.emitter.transforms.unshift(t); }]) {
    const changed = structuredClone(d); mutate(changed); assert.throws(() => validateFieldParticleRendering(changed));
  }
});
test("UNorm target preclamps shader outputs, uses premultiplied source and quantizes after each fragment", () => {
  assert.deepEqual(blendSourceFieldParticleTarget([2, -1, 0.25, 2], [0, 100, 255, 255]), [255, 0, 64, 255]);
  assert.deepEqual(blendSourceFieldParticleTarget([0.5, 0, 0, 0.5], [0, 0, 0, 0]), [128, 0, 0, 128]);
  // float32 0.5 + (128/255)*0.5 lies just below the 191.5 byte midpoint.
  assert.deepEqual(blendSourceFieldParticleTarget([0, 0, 0.5, 0.5], [128, 0, 0, 128]), [64, 0, 128, 191]);
});
test("top-left coverage draws the shared quad diagonal once and preserves source target dimensions", () => {
  const output = render([particle()]);
  assert.equal(output.width, 32); assert.equal(output.height, 32);
  assert.deepEqual(pixel(output, 15, 15), [128, 0, 0, 128]);
  assert.deepEqual(pixel(output, 16, 16), [128, 0, 0, 128]);
  assert.deepEqual(pixel(output, 15, 16), [128, 0, 0, 128]);
  assert.deepEqual(pixel(output, 16, 15), [128, 0, 0, 128]);
  assert.equal([...output.data].filter((_, i) => i % 4 === 3 && output.data[i] !== 0).length, 4);
});
test("depth0 target preserves live particle order instead of inventing a depth buffer or sort", () => {
  const red = particle({ position: { x: 0, y: 0, z: 10 } }), blue = particle({ color32: 0x80ff0000 });
  assert.deepEqual(pixel(render([red, blue]), 15, 15), [64, 0, 128, 192]);
  assert.deepEqual(pixel(render([blue, red]), 15, 15), [128, 0, 64, 192]);
  assert.equal("depths" in render([red, blue]), false);
});
test("sampled frame normalizes GPU rows to Unity V=1 at its first image row", () => {
  const inputTextures = textures(); inputTextures.set("main", { ...texture([]), width: 1, height: 2,
    rgba: Uint8Array.from([255, 255, 255, 255, 64, 64, 64, 255]) });
  const output = renderSourceFieldParticleTarget({ definition: particleRendering(), particles: [particle({ color32: 0xffffffff })],
    parentTransform: root(), projection: projection(), textures: inputTextures, engineSeconds: 0, elapsedSeconds: 0 });
  assert.deepEqual(pixel(output, 15, 15), [255, 255, 255, 255]);
  assert.deepEqual(pixel(output, 15, 16), [64, 64, 64, 255]);
});
test("D3D clip bounds discard out-of-depth quads and clip viewport crossings", () => {
  assert.ok(render([particle({ position: { x: 0, y: 0, z: 100 } })]).data.every((v) => v === 0));
  assert.ok(render([particle({ position: { x: 0, y: 0, z: -100 } })]).data.every((v) => v === 0));
  const output = render([particle({ position: { x: 16, y: 0, z: 0 }, size: 4 })]);
  assert.deepEqual(pixel(output, 31, 15), [128, 0, 0, 128]);
  assert.deepEqual(pixel(output, 28, 15), [0, 0, 0, 0]);
});
test("GPU matrix/texture absence fails before publishing and later calls use freshly cleared storage", () => {
  const input = { definition: particleRendering(), particles: [particle()], parentTransform: root(), projection: projection(),
    textures: textures(), engineSeconds: 0, elapsedSeconds: 0 };
  const before = structuredClone(input);
  assert.throws(() => renderSourceFieldParticleTarget({ ...input, projection: undefined as unknown as FieldParticleRasterProjection }), /GPU projection host/);
  assert.throws(() => renderSourceFieldParticleTarget({ ...input, textures: new Map() }), /Missing source particle texture/);
  assert.deepEqual(input, before);
  assert.ok(render([]).data.every((v) => v === 0));
});
