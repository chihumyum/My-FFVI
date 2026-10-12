// Source graphs + actual DLL instruction probes. GPU projection, root transform
// and particles in the CPU target cases are explicitly controlled host inputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const compiled = option("--compiled-dir", "dist"), mediaDir = option("--media-dir", "build/v33-field-effect-media"),
  depDir = option("--dependencies-dir", "build/v34-field-particle-dependencies"), geometryDir = option("--geometry-dir", "build/v36-field-particle-geometry");
const compiler = await import(pathToFileURL(resolve(root, compiled, "src/compiler/field-particle-geometry.js")));
const core = await import(pathToFileURL(resolve(root, compiled, "src/core/field-particle-geometry.js")));
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8")), sha = (b) => createHash("sha256").update(b).digest("hex");
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
  : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (fn) => { fn(); checks++; };
for (const dir of [mediaDir, depDir, geometryDir]) for (const entry of (await json(dir + "/snapshot.json")).files) {
  check(() => assert.ok(!entry.file.includes("..") && !entry.file.startsWith("/")));
  const bytes = await readFile(resolve(root, dir, entry.file)); check(() => assert.equal(sha(bytes), entry.sha256));
}
const media = await json(mediaDir + "/media.json"), dependencies = await json(depDir + "/dependencies.json"),
  entity = await json(geometryDir + "/geometry.json"), corpus = await json("build/corpus/corpus.json");
for (const exported of [media, dependencies, entity]) {
  check(() => assert.equal(exported.parentSourceSetHash, corpus.sourceSetHash));
  check(() => assert.equal(sha(canonical(exported.sources)), exported.sourceSetHash));
  for (const source of exported.sources) {
    check(() => assert.deepEqual(source, corpus.sources.find((s) => s.file === source.file)));
    const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
  }
}
const mediaBytes = await readFile(resolve(root, mediaDir, "media.json"));
check(() => assert.equal(dependencies.effectMediaSha256, sha(mediaBytes)));
const textures = new Map();
for (const [key, t] of Object.entries(dependencies.textures)) {
  const rgba = await readFile(resolve(root, depDir, t.file)); check(() => assert.equal(sha(rgba), t.sha256));
  check(() => assert.equal(t.mipCount, 1)); check(() => assert.equal(t.mipLevel, 0)); check(() => assert.equal(t.colorSpace, 1));
  textures.set(key, { width: t.width, height: t.height, rgba: new Uint8Array(rgba), filter: t.filterMode === 0 ? "point" : "linear",
    wrapU: t.wrap[0] === 0 ? "repeat" : "clamp", wrapV: t.wrap[1] === 0 ? "repeat" : "clamp", rowOrder: t.rowOrder, colorSpace: "gamma" });
}
const definitions = Object.entries(media.groups).map(([key, value]) => compiler.compileFieldParticleRendering(key, value, dependencies, entity));
check(() => assert.equal(definitions.length, 5));
for (const d of definitions) {
  check(() => assert.equal(d.target.graphicsFormat, 8)); check(() => assert.equal(d.target.depthAttachment, null));
  check(() => assert.equal(d.entity.transform.objectId, "-8226728852999962409"));
  check(() => assert.deepEqual(d.colorSpace.source, dependencies.settings.source));
  check(() => assert.throws(() => core.projectSourceFieldParticleGeometry(d, [], undefined), /parent transform/));
  check(() => assert.throws(() => core.assertFieldParticleGeometryExecutable(d.geometry), /unavailable/));
}
for (const mutate of [(x) => { x.particleEntity.transform.data.m_Father.m_PathID = "1"; },
  (x) => { x.particleEntity.transform.data.m_LocalScale.x = 2; },
  (x) => { x.particleEntity.transform.data.m_GameObject.m_PathID = "0"; },
  (x) => { x.particleEntity.gameObject.data.m_Component.push(x.particleEntity.gameObject.data.m_Component[0]); }]) {
  const changed = structuredClone(entity); mutate(changed);
  check(() => assert.throws(() => compiler.compileFieldParticleRendering("ef_ff6_m_001", media.groups.ef_ff6_m_001, dependencies, changed)));
}
const changedSettings = structuredClone(dependencies); changedSettings.settings.activeColorSpace = 1;
check(() => assert.throws(() => compiler.compileFieldParticleRendering("ef_ff6_m_001", media.groups.ef_ff6_m_001, changedSettings, entity), /color space|gamma/i));

// Reexecute the exact binary for every run. Source expectations do not call
// the TypeScript generator or duplicate its mathematical expressions.
const probePath = "build/reports/v36-particle-geometry-probes.json";
execFileSync(resolve(root, ".venv/bin/python"), ["tools/native/probe_unity_particle_geometry.py", "--dll", "build/runtime/game/UnityPlayer.dll",
  "--out", probePath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
const probes = await json(probePath);
check(() => assert.equal(probes.nativeSha256, "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845"));
const transform = () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
const inputParticle = (p) => ({ position: { x: p.position[0], y: p.position[1], z: p.position[2] }, size: p.size,
  rotation: p.rotation, color32: p.color32, normalizedAge: p.age });
let templateVertices = 0, leafVertices = 0;
for (const p of probes.templates) {
  const d = structuredClone(definitions[2]); d.geometry.camera.orthographicSize = p.maxSize;
  d.geometry.target.width = d.geometry.target.height = p.maxSize * 2;
  d.geometry.emitter.transforms = [transform()]; d.geometry.camera.transforms = [transform()];
  const parent = transform();
  if (p.parent) {
    [parent.position.x, parent.position.y, parent.position.z] = p.parent;
    [d.geometry.emitter.transforms[0].rotation.x, d.geometry.emitter.transforms[0].rotation.y,
      d.geometry.emitter.transforms[0].rotation.z, d.geometry.emitter.transforms[0].rotation.w] = p.emitterRotation;
    d.geometry.camera.transforms[0].position.z = -20;
  }
  const actual = core.projectSourceFieldParticleGeometry(d, p.particles.map(inputParticle), parent);
  check(() => assert.equal(actual.quads.length, p.output.vertices.length));
  for (const [n, quad] of actual.quads.entries()) for (const [v, vertex] of quad.vertices.entries()) {
    const expected = p.output.vertices[n][v];
    check(() => assert.deepEqual(Object.values(vertex.position), expected.position));
    check(() => assert.deepEqual(vertex.uv, expected.uv));
    check(() => assert.deepEqual(vertex.color, [0, 8, 16, 24].map((shift) => Math.fround(((expected.color32 >>> shift) & 255) / 255))));
    templateVertices++;
  }
}
for (const p of probes.billboards) {
  const d = structuredClone(definitions[0]); d.geometry.emitter.transforms = [transform()];
  const actual = core.projectSourceFieldParticleGeometry(d, p.rotations.map((rotation, i) => inputParticle({
    position: p.centers[i], size: p.sizes[i], age: 0, color32: 0xffffffff, rotation })), transform());
  for (const [n, quad] of actual.quads.entries()) for (const [v, vertex] of quad.vertices.entries()) {
    check(() => assert.deepEqual(Object.values(vertex.position), p.vertices[n][v])); leafVertices++;
  }
}
for (const p of probes.indices) check(() => assert.deepEqual(p.values,
  Array.from({ length: p.count }, (_, n) => [0, 1, 2, 0, 2, 3].map((i) => i + n * 4)).flat()));
check(() => assert.deepEqual(probes.formats.map((p) => [p.activeColorSpace, p.requestedSRGB, p.graphicsFormat, p.isSRGBFormat]),
  [[0, false, 8, false], [0, true, 8, false], [1, false, 8, false], [1, true, 4, true]]));

const frames = [];
for (const d of definitions) {
  const parent = transform(); parent.position = { x: 10, y: 400, z: 30 };
  const g = d.geometry, size = g.camera.orthographicSize, near = g.camera.near, depth = Math.fround(1 / (g.camera.far - near));
  // Controlled GPU projection, intentionally distinct from the unavailable
  // live camera/GfxDevice matrix provider. Root translation is explicit too.
  const projection = { kind: "source-d3d11-particle-view-projection", matrix: [1 / size, 0, 0, 0, 0, -1 / size, 0, 0,
    0, 0, depth, 0, -parent.position.x / size, parent.position.y / size, Math.fround((20 - parent.position.z - near) * depth), 1] };
  const particles = [inputParticle({ position: [0, 0, 0], size: size * 0.75, rotation: 0.4, color32: 0xffffffff, age: 0.5 }),
    inputParticle({ position: [2, -1, 1], size: size * 0.5, rotation: -0.2, color32: 0x80ffffff, age: 0.1 })];
  const args = { definition: d, particles, parentTransform: parent, projection, textures, engineSeconds: 1.25, elapsedSeconds: 0.5 };
  const before = structuredClone(args), frame = core.renderSourceFieldParticleTarget(args);
  check(() => assert.deepEqual(args, before));
  check(() => assert.equal(frame.data.length, g.target.width * g.target.height * 4));
  check(() => assert.ok(frame.data.some((n) => n !== 0), "Real shader/texture output must not be a fake clear frame"));
  check(() => assert.throws(() => core.renderSourceFieldParticleTarget({ ...args, projection: undefined }), /projection host/));
  check(() => assert.throws(() => core.renderSourceFieldParticleTarget({ ...args, textures: new Map() }), /Missing source particle texture/));
  check(() => assert.deepEqual(args, before));
  frames.push({ assetGroup: g.assetGroup, width: frame.width, height: frame.height, sha256: sha(frame.data),
    nonzeroAlpha: [...frame.data].filter((value, n) => n % 4 === 3 && value !== 0).length,
    controlledParticles: true, controlledProjection: true, controlledRootTransform: true });
}
const report = { formatVersion: 1, lane: "source-particle-geometry-instructions-and-controlled-CPU-target", status: "pass", checks,
  sourceSetHash: entity.sourceSetHash, parentSourceSetHash: entity.parentSourceSetHash,
  definitions: definitions.map((d) => ({ assetGroup: d.geometry.assetGroup, entity: d.entity, colorSpace: d.colorSpace, target: d.target })),
  nativeProbe: probePath, templateVertices, leafVertices, nativeTemplates: probes.templates.length,
  indexCases: probes.indices.length, targetFormatCases: probes.formats.length, frames,
  qualifiedGeometryDefinitions: definitions.length, admittedLiveEmitters: 0, nativeGPUExecuted: false, originalGameExecuted: false,
  limitations: ["Live effectRoot world transform and camera/GfxDevice GPU projection remain mandatory host inputs.",
    "Birth, Noise, final appearance and lifecycle state must be supplied by their single source owner; these controlled particles prove none of them.",
    "CPU raster/interpolation/filter/blend arithmetic implements documented D3D rules; exact hardware precision and original-process pixels are unverified."] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-geometry-rendering-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: "pass", checks, actualGraphs: definitions.length, templateVertices, leafVertices,
  controlledFrames: frames.length, admittedLiveEmitters: 0 }));
