// Controlled RGBA raster contract, with real shader/texture probes below.
// This does not execute a browser, Unity, or a particle emission scheduler.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareFieldParticleFrame } from "../apps/game/field-particle-renderer.js";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(!args.length || args.length === 2 && args[0] === "--compiled-dir");
const compiled = resolve(root, args[1] ?? "dist"), load = (p) => import(pathToFileURL(resolve(compiled, p)).href);
const [kernel, { particleMaterial, white }, { compileFieldParticleMaterial }] = await Promise.all([
  load("src/core/field-particles.js"), load("tests/fixtures/field-particles.js"), load("src/compiler/field-particles.js"),
]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tests = [], run = (name, fn) => { fn(); tests.push(name); };
const texture = (rgba) => ({ width: 1, height: 1, rgba: new Uint8Array(rgba), colorSpace: "gamma",
  filter: "point", wrapU: "repeat", wrapV: "repeat", rowOrder: "top-to-bottom" });
function fixture() {
  return { width: 2, height: 2, rgba: new Uint8Array(16), depth: new Float32Array(4).fill(1),
    engineSeconds: 0, elapsedSeconds: 0, material: particleMaterial(),
    textures: new Map([["main", texture([255, 255, 255, 255])], ["mask", texture([255, 0, 0, 255])], ["noise", texture([128, 128, 0, 255])]]),
    particles: [{ id: "controlled:1", x: 1, y: 1, z: 0.5, width: 2, height: 2, rotation: 0, color: { r: 1, g: 0, b: 0, a: 0.5 } }] };
}
run("a complete private frame preserves all shared inputs until explicitly presented", () => {
  const f = fixture(), before = structuredClone(f), frame = prepareFieldParticleFrame(f, kernel);
  assert.equal(frame.written, 4); assert.equal(frame.discarded, 0);
  for (let i = 0; i < 4; i++) assert.deepEqual([...frame.pixels().slice(i * 4, i * 4 + 4)], [128, 0, 0, 128]);
  assert.deepEqual(f, before);
  const copy = frame.pixels(); copy.fill(0); assert.equal(frame.pixels()[0], 128);
});
run("source premultiplied blend respects explicit incoming particle order", () => {
  const f = fixture(); f.particles.push({ ...f.particles[0], id: "controlled:2", color: { r: 0, g: 0, b: 1, a: 0.5 } });
  const first = prepareFieldParticleFrame(f, kernel); assert.deepEqual([...first.pixels().slice(0, 4)], [64, 0, 128, 192]);
  f.particles.reverse(); const second = prepareFieldParticleFrame(f, kernel);
  assert.deepEqual([...second.pixels().slice(0, 4)], [128, 0, 64, 192]);
});
run("LEqual accepts equal depth, rejects farther fragments, and never writes depth", () => {
  const f = fixture(); f.depth.set([0.5, 0.49, 1, 0]); const before = f.depth.slice();
  const frame = prepareFieldParticleFrame(f, kernel);
  assert.equal(frame.written, 2); assert.equal(frame.depthRejected, 2);
  assert.deepEqual([...frame.pixels().slice(4, 8)], [0, 0, 0, 0]); assert.deepEqual(f.depth, before);
});
run("cutoff discards leave the destination unchanged", () => {
  const f = fixture(); f.rgba.fill(17); f.particles[0].color.a = 0.01;
  const frame = prepareFieldParticleFrame(f, kernel); assert.equal(frame.discarded, 4); assert.equal(frame.written, 0);
  assert.deepEqual(frame.pixels(), new Uint8ClampedArray(16).fill(17));
});
run("missing media or invalid late geometry reject before any fragment executes", () => {
  for (const corrupt of [(f) => f.textures.delete("noise"), (f) => f.particles.push({ ...f.particles[0], id: "bad", width: NaN })]) {
    const f = fixture(), before = f.rgba.slice(); corrupt(f); let samples = 0;
    assert.throws(() => prepareFieldParticleFrame(f, { ...kernel, shadeFieldParticle() { samples++; throw new Error("must not shade"); } }));
    assert.equal(samples, 0); assert.deepEqual(f.rgba, before);
  }
});
run("a late shader failure discards the private candidate without mutating attachments", () => {
  const f = fixture(), before = structuredClone(f); let calls = 0;
  assert.throws(() => prepareFieldParticleFrame(f, { ...kernel, shadeFieldParticle(...args) {
    if (++calls === 2) throw new Error("controlled fragment failure"); return kernel.shadeFieldParticle(...args);
  } }), /controlled fragment failure/);
  assert.equal(calls, 2); assert.deepEqual(f, before);
});
run("unknown framebuffer state, duplicate identities, and invalid depth are rejected", () => {
  for (const corrupt of [(f) => { f.material.colorSpace = "linear"; }, (f) => { f.material.blend.depthWrite = true; },
    (f) => f.particles.push({ ...f.particles[0] }), (f) => { f.depth[0] = NaN; }, (f) => { f.rgba = new Uint8Array(4); }]) {
    const f = fixture(); corrupt(f); assert.throws(() => prepareFieldParticleFrame(f, kernel));
  }
});
run("unsupported HDR alpha cannot quietly use a guessed normalized blend rule", () => {
  const f = fixture(); f.material.alphaEmission = 4;
  assert.throws(() => prepareFieldParticleFrame(f, kernel), /normalized range/);
  assert.ok(f.rgba.every((x) => x === 0));
});
run("viewport clipping and zero-size billboards perform no hidden allocations or writes", () => {
  const f = fixture(); f.particles[0].x = -100;
  assert.equal(prepareFieldParticleFrame(f, kernel).samples, 0);
  f.particles[0].x = 1; f.particles[0].width = 0;
  assert.equal(prepareFieldParticleFrame(f, kernel).samples, 0);
});
run("controlled pixel-center UV rotates with the billboard and remains bottom-left based", () => {
  const f = fixture(), uv = [];
  const spy = { ...kernel, shadeFieldParticle(_material, input) { uv.push(input.uv); return { r: 0, g: 0, b: 0, a: 0 }; } };
  prepareFieldParticleFrame(f, spy); assert.deepEqual(uv, [[0.25, 0.75], [0.75, 0.75], [0.25, 0.25], [0.75, 0.25]]);
  uv.length = 0; f.particles[0].rotation = Math.PI / 2; prepareFieldParticleFrame(f, spy);
  const expected = [[0.25, 0.25], [0.25, 0.75], [0.75, 0.25], [0.75, 0.75]];
  uv.forEach((p, i) => p.forEach((v, c) => assert.ok(Math.abs(v - expected[i][c]) < 1e-12)));
});
run("Canvas publication converts premultiplication once and leaves the prepared buffer intact", () => {
  const f = fixture(), frame = prepareFieldParticleFrame(f, kernel), before = frame.pixels(); let puts = 0, published;
  frame.present({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(image, x, y) { puts++; assert.equal(x, 0); assert.equal(y, 0); published = image; } });
  assert.equal(puts, 1); assert.deepEqual([...published.data.slice(0, 4)], [255, 0, 0, 128]);
  assert.deepEqual(frame.pixels(), before); assert.ok(f.rgba.every((x) => x === 0));
});

// Real extracted materials/textures; positions, lifetime and draw ordering below
// are controlled test inputs. These are material swatches, never source smoke.
const depDir = resolve(root, "build/v34-field-particle-dependencies");
const depBytes = await readFile(resolve(depDir, "dependencies.json")), dep = JSON.parse(depBytes);
const textures = new Map(), probes = [];
for (const [key, t] of Object.entries(dep.textures)) {
  const bytes = await readFile(resolve(depDir, t.file)); assert.equal(sha(bytes), t.sha256);
  textures.set(key, { width: t.width, height: t.height, rgba: new Uint8Array(bytes), colorSpace: "gamma",
    filter: t.filterMode === 0 ? "point" : "linear", wrapU: t.wrap[0] === 0 ? "repeat" : "clamp", wrapV: t.wrap[1] === 0 ? "repeat" : "clamp", rowOrder: t.rowOrder });
}
await mkdir(resolve(root, "build/reports/field-particle-swatches"), { recursive: true });
for (const group of Object.keys(dep.materials)) {
  const material = compileFieldParticleMaterial(group, dep);
  const frame = prepareFieldParticleFrame({ width: 64, height: 64, rgba: new Uint8Array(64 * 64 * 4), depth: new Float32Array(64 * 64).fill(1),
    material, textures, engineSeconds: 0.25, elapsedSeconds: 0,
    particles: [{ id: "controlled-swatch:" + group, x: 32, y: 32, z: 0.5, width: 48, height: 48, rotation: 0, color: white() }] }, kernel);
  assert.ok(frame.written > 20 && frame.discarded > 20, "Real material must exercise both shading and cutoff");
  const bytes = frame.pixels(), file = `build/reports/field-particle-swatches/${group}.rgba`;
  await writeFile(resolve(root, file), bytes);
  probes.push({ group, materialSource: material.source, width: 64, height: 64, alpha: frame.alpha,
    samples: frame.samples, written: frame.written, discarded: frame.discarded, sha256: sha(bytes), file });
}
const report = { formatVersion: 1, lane: "controlled-particle-raster", semanticsVerified: false, browserExecuted: false,
  originalGameExecuted: false, emitterExecuted: false, tests, sourceProbes: probes, dependencySha256: sha(depBytes),
  limitations: ["Positions, particle order, depth and clock are explicit controlled inputs.",
    "Pixel-center billboard coverage is not D3D triangle raster equivalence.", "No source field-effect provider is granted."] };
await writeFile(resolve(root, "build/reports/field-particles-ui-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: "pass", checks: tests.length, sourceMaterialSwatches: probes.length, emitterExecuted: false }));
