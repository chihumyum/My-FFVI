// Real source graphs and independent DXBC evaluation; no native GPU or particle
// generator is executed. Source geometry admission must still fail.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const compiled = option("--compiled-dir", "dist"), mediaDir = option("--media-dir", "build/v33-field-effect-media"),
  depDir = option("--dependencies-dir", "build/v34-field-particle-dependencies"), geometryDir = option("--geometry-dir", "build/v35-field-particle-geometry");
const compiler = await import(pathToFileURL(resolve(root, compiled, "src/compiler/field-particle-geometry.js")));
const kernel = await import(pathToFileURL(resolve(root, compiled, "src/core/field-particle-geometry.js")));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
  : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (f) => { f(); checks++; };
for (const dir of [mediaDir, depDir, geometryDir]) {
  const receipt = await json(dir + "/snapshot.json");
  for (const file of receipt.files) {
    check(() => assert.ok(!file.file.includes("..") && !file.file.startsWith("/")));
    const bytes = await readFile(resolve(root, dir, file.file)); check(() => assert.equal(sha(bytes), file.sha256));
  }
}
const corpus = await json("build/corpus/corpus.json"), media = await json(mediaDir + "/media.json"),
  dep = await json(depDir + "/dependencies.json"), boardRaw = await json(geometryDir + "/geometry.json");
for (const value of [media, dep, boardRaw]) {
  check(() => assert.equal(value.parentSourceSetHash, corpus.sourceSetHash));
  check(() => assert.equal(sha(canonical(value.sources)), value.sourceSetHash));
}
for (const source of [...new Map([...media.sources, ...dep.sources, ...boardRaw.sources].map((s) => [s.file, s])).values()]) {
  check(() => assert.deepEqual(source, corpus.sources.find((s) => s.file === source.file)));
  const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
}
const mediaBytes = await readFile(resolve(root, mediaDir, "media.json"));
check(() => assert.equal(sha(mediaBytes), dep.effectMediaSha256));
const groups = ["ef_ff6_m_001", "ef_ff6_m_002", "ef_ff6_m_003", "ef_ff6_m_004", "ef_ff6_m_016"], geometries = [];
for (const [index, group] of groups.entries()) {
  const g = compiler.compileFieldParticleGeometry(group, media.groups[group], dep);
  check(() => assert.equal(g.target.width, [256, 128, 32, 32, 32][index]));
  check(() => assert.equal(g.target.height, g.target.width));
  check(() => assert.deepEqual(g.camera.transforms.at(-1).position, { x: 0, y: 0, z: -20 }));
  check(() => assert.ok(g.emitter.transforms.at(-1).rotation.z === (index === 0 ? -0.026176923885941505 : 0)));
  check(() => assert.deepEqual(g.target, { width: g.target.width, height: g.target.width, filterMode: 0, wrapMode: 1,
    requestedColorFormat: 0, requestedSRGB: true, depthBits: 0, msaaSamples: 1 }));
  check(() => assert.throws(() => kernel.assertFieldParticleGeometryExecutable(g), /billboard.*draw order.*color encoding/));
  const cleared = structuredClone(g); cleared.requirements = [];
  check(() => assert.throws(() => kernel.assertFieldParticleGeometryExecutable(cleared), /Unbound/));
  for (const change of [(d) => { d.objects.find((o) => o.type === "ParticleSystemRenderer" && d.hierarchyIds.includes(o.source.objectId)).data.m_RenderAlignment = 1; },
    (d) => { d.objects.find((o) => o.type === "Camera" && d.hierarchyIds.includes(o.source.objectId)).data.m_AllowMSAA = true; },
    (d) => { d.objects.find((o) => o.type === "ParticleSystem" && d.hierarchyIds.includes(o.source.objectId)).data.moveWithTransform = 1; }]) {
    const changed = structuredClone(media.groups[group]); change(changed);
    check(() => assert.throws(() => compiler.compileFieldParticleGeometry(group, changed, dep)));
  }
  geometries.push(g);
}
const material = compiler.compileFieldEffectBoardMaterial(boardRaw);
check(() => assert.deepEqual(material.sources, kernel.fieldEffectBoardSources()));
for (const change of [(d) => { d.particleEntity.data.originalEffectMaterial.m_PathID = "1"; },
  (d) => { d.shader.passes[1].state.zWrite.val = 1; }, (d) => { d.shader.passes[1].programs.progFragment.sha256 = "0".repeat(64); },
  (d) => { d.material.data.m_ShaderKeywords = "OTHER"; }]) {
  const changed = structuredClone(boardRaw); change(changed); check(() => assert.throws(() => compiler.compileFieldEffectBoardMaterial(changed)));
}

// Token-level DXBC oracle, derived from Microsoft's operand layout. It reads
// actual shader instructions, not the translated TypeScript expression.
const bits = new DataView(new ArrayBuffer(4));
const fromFloat = (x) => { bits.setFloat32(0, x, true); return bits.getUint32(0, true); };
const asFloat = (x) => { bits.setUint32(0, x, true); return bits.getFloat32(0, true); };
function bytecode(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "DXBC"); assert.equal(bytes.readUInt32LE(24), bytes.length);
  const chunks = new Map();
  for (let n = 0; n < bytes.readUInt32LE(28); n++) { const o = bytes.readUInt32LE(32 + n * 4);
    chunks.set(bytes.toString("ascii", o, o + 4), bytes.subarray(o + 8, o + 8 + bytes.readUInt32LE(o + 4))); }
  const code = chunks.get("SHDR") ?? chunks.get("SHEX"); assert.ok(code);
  const words = Array.from({ length: code.length / 4 }, (_, i) => code.readUInt32LE(i * 4)); assert.equal(words[1], words.length);
  function operand(start) {
    let i = start, token = words[i++], extension = token >>> 31, modifier = 0;
    while (extension) { const e = words[i++]; extension = e >>> 31; assert.equal(e & 63, 1); modifier = (e >>> 6) & 255; }
    const dimensions = (token >>> 20) & 3, indices = [];
    for (let d = 0; d < dimensions; d++) { assert.equal((token >>> (22 + d * 3)) & 7, 0); indices.push(words[i++]); }
    const type = (token >>> 12) & 255, components = token & 3, selection = (token >>> 2) & 3;
    let literal = null;
    if (type === 4) { const n = [0, 1, 4][components]; assert.notEqual(n, undefined); literal = words.slice(i, i + n); i += n; }
    const mask = components === 2 && selection === 0 ? [0, 1, 2, 3].filter((c) => token & (1 << (4 + c))) : [0];
    const swizzle = components === 1 ? [0, 0, 0, 0] : selection === 1 ? [0, 1, 2, 3].map((c) => (token >>> (4 + 2 * c)) & 3)
      : selection === 2 ? Array(4).fill((token >>> 4) & 3) : [0, 1, 2, 3];
    return { next: i, type, indices, modifier, literal, mask, swizzle };
  }
  const instructions = [];
  for (let i = 2; i < words.length;) {
    const token = words[i], length = (token >>> 24) & 127, op = token & 2047; assert.ok(length > 0);
    const end = i + length, operands = [];
    if (!(op >= 88 && op <= 106)) {
      let j = i + 1, ext = token >>> 31; while (ext) ext = words[j++] >>> 31;
      while (j < end) { const o = operand(j); operands.push(o); j = o.next; } assert.equal(j, end);
    }
    instructions.push({ op, operands, saturate: !!(token & (1 << 13)), nonzero: !!(token & (1 << 18)) }); i = end;
  }
  return instructions;
}
function execute(instructions, constants, inputs, sample = () => { throw new Error("Unbound shader sampler"); }) {
  const registers = { 0: new Map(), 1: new Map(Object.entries(inputs).map(([key, value]) => [Number(key), value.map(fromFloat)])), 2: new Map() };
  const raw = (o) => {
    let value = o.literal ?? (o.type === 8 ? constants[o.indices[0]][o.indices[1]] : registers[o.type]?.get(o.indices[0]));
    if (!value) throw new Error("Unbound DXBC register " + JSON.stringify(o));
    if (value.length === 1) value = Array(4).fill(value[0]); return o.swizzle.map((c) => value[c]);
  };
  const read = (o) => raw(o).map((n) => { let v = asFloat(n);
    if (o.modifier === 2 || o.modifier === 3) v = Math.abs(v); if (o.modifier === 1 || o.modifier === 3) v = -v; return v; });
  const write = (o, values, rawValues = false, sat = false) => {
    if (![0, 2].includes(o.type)) throw new Error("Unknown shader destination");
    const dest = registers[o.type].get(o.indices[0]) ?? [0, 0, 0, 0];
    for (const c of o.mask) dest[c] = rawValues ? values[c] >>> 0 : fromFloat(sat ? Math.max(0, Math.min(1, values[c])) : values[c]);
    registers[o.type].set(o.indices[0], dest);
  };
  for (const ins of instructions) {
    const { op, operands: a } = ins; if (op >= 88 && op <= 106) continue;
    if (op === 62) break;
    if (op === 13) { if ((raw(a[0])[0] !== 0) === ins.nonzero) return null; continue; }
    if (op === 54) { write(a[0], raw(a[1]), true); continue; }
    if (op === 69) { const uv = read(a[1]); write(a[0], sample(a[2].indices[0], uv[0], uv[1])); continue; }
    const x = read(a[1]), y = a[2] ? read(a[2]) : null, z = a[3] ? read(a[3]) : null;
    const values = x.map((v, c) => {
      switch (op) { case 0: return v + y[c]; case 49: return v < y[c] ? 0xffffffff : 0;
        case 50: return v * y[c] + z[c]; case 56: return v * y[c]; default: throw new Error("Unknown DXBC opcode " + op); }
    }); write(a[0], values, op === 49, ins.saturate);
  }
  return new Map([...registers[2]].map(([key, values]) => [key, values.map(asFloat)]));
}
const particleShader = Object.values(dep.shaders)[0], vertexBytes = await readFile(resolve(root, depDir, particleShader.programs.progVertex.file));
check(() => assert.equal(sha(vertexBytes), kernel.FIELD_PARTICLE_VERTEX));
const vertex = bytecode(vertexBytes), boardPrograms = [];
for (const pass of boardRaw.shader.passes) {
  const pair = [];
  for (const key of ["progVertex", "progFragment"]) {
    const bytes = await readFile(resolve(root, geometryDir, pass.programs[key].file));
    check(() => assert.equal(sha(bytes), pass.programs[key].sha256)); pair.push(bytecode(bytes));
  }
  boardPrograms.push(pair);
}
let vertexProbes = 0, fragmentProbes = 0, discarded = 0;
for (let index = 0; index < 25; index++) {
  const world = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 7 + index / 7, 11, 13, 1].map(Math.fround);
  const vp = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, index / 3, 0, 0, 1].map(Math.fround);
  const position = { x: index / 5, y: index - 5.3, z: 5 }, uv = [0.25, 0.75], color = [0.25, 0.5, 1, index / 24].map(Math.fround);
  const columns = (m) => Array.from({ length: 4 }, (_, i) => m.slice(i * 4, i * 4 + 4).map(fromFloat));
  const constants = [columns(world), [...Array.from({ length: 17 }, () => [0, 0, 0, 0]), ...columns(vp)]];
  const inputs = { 0: [position.x, position.y, position.z, 1], 1: [...uv, 0, 0], 2: color };
  const expected = execute(vertex, constants, inputs), actual = kernel.transformFieldParticleVertex({ position, uv, color, objectToWorld: world, viewProjection: vp });
  check(() => assert.deepEqual(actual.clip, expected.get(0))); check(() => assert.deepEqual(actual.uv, expected.get(1).slice(0, 2)));
  check(() => assert.deepEqual(actual.color, expected.get(2)));
  const boardConstants = [Array.from({ length: 3 }, (_, i) => i === 2 ? [1, 1, 0, 0].map(fromFloat) : [0, 0, 0, 0]), ...constants];
  const boardExpected = execute(boardPrograms[0][0], boardConstants, inputs);
  check(() => assert.deepEqual(actual.clip, boardExpected.get(1))); check(() => assert.deepEqual(actual.uv, boardExpected.get(0).slice(0, 2)));
  check(() => assert.deepEqual(actual.color, boardExpected.get(2))); vertexProbes++;
}
for (const sample of [[0, 0, 0, 1], [1 / 255, 0, 0, 1], [0.125, 0.7, 0.33, 1], [1, 1, 1, 1]])
  for (const alphaByte of [0, 1, 127, 253, 254, 255]) for (const materialAlpha of [0, 0.5, 1])
    for (const color of [[1, 1, 1, 1], [0.3, 0.7, 1, 0.8]]) for (const [n, pass] of ["opaque", "color"].entries()) {
      const rgba = [...sample]; rgba[3] = alphaByte / 255;
      const constants = [Array.from({ length: 5 }, (_, i) => i === 4 ? [1, 1, 1, materialAlpha].map(fromFloat) : [0, 0, 0, 0])];
      const oracle = execute(boardPrograms[n][1], constants, { 0: [0.5, 0.5, 0, 0], 2: color }, () => rgba);
      const actual = kernel.fieldEffectBoardFragment(rgba, color, materialAlpha, pass);
      if (oracle === null) { check(() => assert.equal(actual, null)); discarded++; }
      else check(() => assert.deepEqual(actual, oracle.get(0)));
      fragmentProbes++;
    }
const report = { formatVersion: 1, lane: "source-particle-geometry-and-board-material", status: "pass", checks,
  sourceSetHash: boardRaw.sourceSetHash, geometries, material, vertexProbes, fragmentProbes, discarded,
  admittedParticleGenerators: 0, nativeGPUExecuted: false, originalGameExecuted: false, browserExecuted: false,
  limitations: ["Vertex inputs/matrices are controlled; actual Unity billboard expansion and draw-order closure remain unavailable.",
    "Real particle RT is requested sRGB with depthBits=0; no qualified color-encoding/raster provider is installed.",
    "The source board fragment/vertex programs are independently interpreted, not native GPU parity measurements."] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-geometry-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: "pass", checks, actualGraphs: geometries.length, vertexProbes, fragmentProbes, discarded, admittedParticleGenerators: 0 }));
