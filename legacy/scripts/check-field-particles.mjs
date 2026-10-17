import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const compiled = option("--compiled-dir", "dist"), mediaDir = option("--media-dir", "build/v33-field-effect-media"), depDir = option("--dependencies-dir", "build/v34-field-particle-dependencies");
const { compileFieldParticleModules, compileFieldParticleMaterial, FIELD_PARTICLE_SHADER } = await import(pathToFileURL(resolve(root, compiled, "src/compiler/field-particles.js")));
const kernel = await import(pathToFileURL(resolve(root, compiled, "src/core/field-particles.js")));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (fn) => { fn(); checks++; };
for (const dir of [mediaDir, depDir]) {
  const receipt = await json(dir + "/snapshot.json");
  for (const f of receipt.files) check(() => assert.ok(!f.file.includes("..") && !f.file.startsWith("/")));
  for (const f of receipt.files) { const bytes = await readFile(resolve(root, dir, f.file)); check(() => assert.equal(sha(bytes), f.sha256)); }
}
const corpus = await json("build/corpus/corpus.json"), media = await json(mediaDir + "/media.json"), dep = await json(depDir + "/dependencies.json");
const reference = await json("build/v34-unity-reference/snapshot.json");
check(() => assert.equal(reference.unityVersion, dep.unityVersion));
check(() => assert.equal(reference.commit, "a4fc5011a29781c15e3ee181f19d80dc7fbab19f"));
const referenceDigests = { "ParticleSystemStructs.cs": "4c06d5620eeb48cce65314975d61a0012d827cd3d7e91e0d78ebaf9e67197534",
  "ParticleSystemEnums.cs": "5526e19e82cbfe32acbf8a765f114a211d40baa9f4f9c1a1e5158d8730073062" };
check(() => assert.deepEqual(reference.files.map((f) => f.file).sort(), Object.keys(referenceDigests).sort()));
for (const f of reference.files) {
  check(() => assert.equal(f.sha256, referenceDigests[f.file]));
  check(() => assert.equal(f.url, `https://raw.githubusercontent.com/Unity-Technologies/UnityCsReference/${reference.commit}/Modules/ParticleSystem/Managed/${f.file}`));
  const bytes = await readFile(resolve(root, "build/v34-unity-reference", f.file)); check(() => assert.equal(sha(bytes), f.sha256));
}
check(() => assert.equal(sha(canonical(corpus.sources)), corpus.sourceSetHash));
check(() => assert.equal(dep.parentSourceSetHash, corpus.sourceSetHash));
check(() => assert.equal(media.parentSourceSetHash, dep.parentSourceSetHash));
check(() => assert.equal(sha(canonical(dep.sources)), dep.sourceSetHash));
const mediaBytes = await readFile(resolve(root, mediaDir, "media.json")); check(() => assert.equal(sha(mediaBytes), dep.effectMediaSha256));
for (const source of dep.sources) {
  check(() => assert.deepEqual(source, corpus.sources.find((s) => s.file === source.file)));
  const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
}
check(() => assert.equal(dep.unityVersion, "2019.4.20f1"));
check(() => assert.equal(dep.settings.activeColorSpace, 0));
const settingsBytes = await readFile(resolve(root, "build/runtime/game", dep.settings.source.file));
check(() => assert.equal(sha(settingsBytes), dep.settings.source.sha256));
const groups = ["ef_ff6_m_001", "ef_ff6_m_002", "ef_ff6_m_003", "ef_ff6_m_004", "ef_ff6_m_016"];
check(() => assert.deepEqual(Object.keys(dep.materials), groups));
check(() => assert.equal(Object.keys(dep.shaders).length, 1));
check(() => assert.equal(Object.keys(dep.textures).length, 3));
check(() => assert.deepEqual(dep.materials.ef_ff6_m_016.source, dep.materials.ef_ff6_m_004.source));
const textures = new Map();
for (const [key, t] of Object.entries(dep.textures)) {
  const bytes = await readFile(resolve(root, depDir, t.file)); check(() => assert.equal(sha(bytes), t.sha256));
  check(() => assert.equal(t.mipCount, 1)); check(() => assert.equal(bytes.length, t.width * t.height * 4));
  textures.set(key, { width: t.width, height: t.height, rgba: new Uint8Array(bytes), rowOrder: t.rowOrder, colorSpace: "gamma",
    filter: t.filterMode === 0 ? "point" : "linear", wrapU: t.wrap[0] === 0 ? "repeat" : "clamp", wrapV: t.wrap[1] === 0 ? "repeat" : "clamp" });
}

// A deliberately small independent DXBC register interpreter. The exact source
// digest fixes the instruction closure; unknown opcodes/index modes throw.
// Token layouts: Microsoft's d3d12TokenizedProgramFormat.hpp. This evaluates
// bytecode, not a second handwritten copy of the translated shader formula.
const bits = new DataView(new ArrayBuffer(4));
const fromFloat = (x) => { bits.setFloat32(0, x, true); return bits.getUint32(0, true); };
const asFloat = (x) => { bits.setUint32(0, x, true); return bits.getFloat32(0, true); };
function bytecode(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "DXBC"); assert.equal(bytes.readUInt32LE(24), bytes.length);
  const chunks = new Map();
  for (let n = 0; n < bytes.readUInt32LE(28); n++) { const o = bytes.readUInt32LE(32 + n * 4); chunks.set(bytes.toString("ascii", o, o + 4), bytes.subarray(o + 8, o + 8 + bytes.readUInt32LE(o + 4))); }
  const code = chunks.get("SHDR") ?? chunks.get("SHEX"); assert.ok(code);
  const words = Array.from({ length: code.length / 4 }, (_, i) => code.readUInt32LE(i * 4)); assert.equal(words[1], words.length);
  const instructions = [];
  function operand(start) {
    let i = start, token = words[i++], extension = token >>> 31, modifier = 0;
    while (extension) { const e = words[i++]; extension = e >>> 31; assert.equal(e & 63, 1); modifier = (e >>> 6) & 255; }
    const dimensions = (token >>> 20) & 3, indices = [];
    for (let d = 0; d < dimensions; d++) { assert.equal((token >>> (22 + d * 3)) & 7, 0); indices.push(words[i++]); }
    const type = (token >>> 12) & 255, components = token & 3, selection = (token >>> 2) & 3;
    let literal = null; if (type === 4) { const n = [0, 1, 4][components]; assert.notEqual(n, undefined); literal = words.slice(i, i + n); i += n; }
    const mask = components === 2 && selection === 0 ? [0, 1, 2, 3].filter((c) => token & (1 << (4 + c))) : [0];
    const swizzle = components === 1 ? [0, 0, 0, 0] : selection === 1 ? [0, 1, 2, 3].map((c) => (token >>> (4 + 2 * c)) & 3) : selection === 2 ? Array(4).fill((token >>> 4) & 3) : [0, 1, 2, 3];
    return { next: i, type, indices, modifier, literal, mask, swizzle };
  }
  for (let i = 2; i < words.length;) {
    const token = words[i], length = (token >>> 24) & 127, op = token & 2047; assert.ok(length > 0);
    const end = i + length; const operands = [];
    if (!(op >= 88 && op <= 106)) {
      let j = i + 1, ext = token >>> 31; while (ext) ext = words[j++] >>> 31;
      while (j < end) { const o = operand(j); operands.push(o); j = o.next; } assert.equal(j, end);
    }
    instructions.push({ op, operands, saturate: !!(token & (1 << 13)), nonzero: !!(token & (1 << 18)) }); i = end;
  }
  return instructions;
}
function execute(instructions, constants, uv, vertex, sample) {
  const registers = { 0: new Map(), 1: new Map([[1, [uv[0], uv[1], 0, 0].map(fromFloat)], [2, [vertex.r, vertex.g, vertex.b, vertex.a].map(fromFloat)]]), 2: new Map() };
  const raw = (o) => {
    let value = o.literal ?? (o.type === 8 ? constants[o.indices[0]][o.indices[1]] : registers[o.type]?.get(o.indices[0]));
    if (!value) throw new Error("Unbound DXBC register " + JSON.stringify(o));
    if (value.length === 1) value = Array(4).fill(value[0]); return o.swizzle.map((c) => value[c]);
  };
  const read = (o, integer = false) => raw(o).map((value) => { let v = integer ? value | 0 : asFloat(value); if (o.modifier === 2 || o.modifier === 3) v = Math.abs(v); if (o.modifier === 1 || o.modifier === 3) v = -v; return v; });
  const write = (o, values, rawValues = false, sat = false) => {
    if (![0, 2].includes(o.type)) throw new Error("Unexpected DXBC destination");
    const dest = registers[o.type].get(o.indices[0]) ?? [0, 0, 0, 0];
    for (const c of o.mask) dest[c] = rawValues ? values[c] >>> 0 : fromFloat(sat ? Math.max(0, Math.min(1, values[c])) : values[c]);
    registers[o.type].set(o.indices[0], dest);
  };
  for (const ins of instructions) {
    const { op, operands: a } = ins; if (op >= 88 && op <= 106) continue;
    if (op === 62) break;
    if (op === 13) { if ((raw(a[0])[0] !== 0) === ins.nonzero) return null; continue; }
    if (op === 54) { write(a[0], raw(a[1]), true); continue; }
    if (op === 69) { const [u, v] = read(a[1]), t = sample(a[2].indices[0], u, v); write(a[0], [t.r, t.g, t.b, t.a]); continue; }
    const x = read(a[1], op === 43 || op === 30), y = a[2] ? read(a[2], op === 30) : null, z = a[3] ? read(a[3]) : null;
    const values = x.map((v, c) => {
      switch (op) { case 0: case 30: return v + y[c]; case 14: return v / y[c]; case 26: return v - Math.floor(v);
        case 43: return v; case 49: return v < y[c] ? 0xffffffff : 0; case 50: return v * y[c] + z[c]; case 56: return v * y[c];
        default: throw new Error("Unknown DXBC opcode " + op); }
    }); write(a[0], values, op === 30 || op === 49, ins.saturate);
  }
  const out = registers[2].get(0).map(asFloat); return { r: out[0], g: out[1], b: out[2], a: out[3] };
}
const shader = Object.values(dep.shaders)[0], fragment = await readFile(resolve(root, depDir, shader.programs.progFragment.file));
check(() => assert.equal(sha(fragment), FIELD_PARTICLE_SHADER.fragment));
const instructions = bytecode(fragment); check(() => assert.equal(instructions.length, 59));
const vertexBytes = await readFile(resolve(root, depDir, shader.programs.progVertex.file)); check(() => assert.equal(sha(vertexBytes), FIELD_PARTICLE_SHADER.vertex));
const names = new Map(shader.names.map(([k, v]) => [v, k]));
const sub = shader.programs.progFragment.parameters;
const randomNames = ["lifetime", "speed", "size", "rotation", "color", "sizeOverLife", "colorOverLife", "velocityX", "velocityY", "velocityZ", "rotationOverLife", "gravity"];
const materials = [], moduleProbes = []; let shaderProbes = 0, shadedProbes = 0, maxShaderError = 0;
for (const [index, group] of groups.entries()) {
  const modules = compileFieldParticleModules(group, media.groups[group]), material = compileFieldParticleMaterial(group, dep), original = dep.materials[group];
  check(() => assert.equal(kernel.evaluateParticleCurve(modules.emission.rate, 0, 0), [10, 14, 8, 8, 8][index]));
  check(() => assert.equal(kernel.evaluateParticleCurve(modules.emission.bursts[0].count, 0, 0), 1));
  check(() => assert.throws(() => kernel.assertFieldParticleEmitterExecutable(modules), /Native particle emitter unavailable/));
  check(() => assert.equal(modules.requirements.noise.frequency, Math.fround(0.32)));
  check(() => assert.equal(modules.requirements.shape.type, 4));
  for (const r of [0, 0.5, 1]) {
    const draws = Object.fromEntries(randomNames.map((name) => [name, r])), birth = kernel.createFieldParticleBirth(modules, 0, draws);
    for (const age of [0, 0.25, 0.5, 0.75, 1]) {
      const appearance = kernel.sampleFieldParticleAppearance(modules, birth, age);
      check(() => assert.ok([appearance.size, ...Object.values(appearance.color)].every(Number.isFinite)));
      if (age === 1) check(() => assert.equal(appearance.color.a, 0));
      moduleProbes.push({ group, random: r, age, lifetime: birth.lifetime, ...appearance });
    }
    const rates = kernel.sampleFieldParticleRates(modules, birth, 0.1, 1);
    check(() => assert.ok([rates.gravityMultiplier, rates.angularVelocity, ...Object.values(rates.animatedVelocity)].every(Number.isFinite)));
  }
  const properties = new Map([...original.properties.m_Floats, ...original.properties.m_Colors]);
  const constants = (seconds, elapsed) => {
    const result = [];
    for (const binding of sub.m_ConstantBufferBindings) {
      const b = sub.m_ConstantBuffers.find((b) => b.m_NameIndex === binding.m_NameIndex), values = Array.from({ length: Math.ceil(b.m_Size / 16) }, () => [0, 0, 0, 0]);
      for (const p of b.m_VectorParams) {
        const name = names.get(p.m_NameIndex), source = name === "_Time" ? [seconds / 20, seconds, seconds * 2, seconds * 3] : name === "_ElapsedSec" ? [elapsed] : p.m_Dim === 4 ? ["r", "g", "b", "a"].map((c) => properties.get(name)[c]) : [properties.get(name)];
        source.forEach((v, i) => { assert.ok(Number.isFinite(v), name); const offset = p.m_Index / 4 + i; values[Math.floor(offset / 4)][offset % 4] = name === "_BuiltInTime" ? v : fromFloat(v); });
      } result[binding.m_Index] = values;
    } return result;
  };
  const textureSlots = new Map(sub.m_TextureParams.map((p) => [p.m_Index, original.textures[names.get(p.m_NameIndex)].key]));
  const sample = (key, u, v) => kernel.sampleFieldParticleTexture(textures.get(key), u, v);
  for (const seconds of [0, 0.25, 4.5]) for (const uv of [[0, 0], [0.25, 0.75], [0.5, 0.5], [0.9, 0.1], [-0.1, 1.2]]) for (const alpha of [0, 0.3, 1]) {
    const vertex = { r: 0.65, g: 0.8, b: 1, a: alpha }, elapsed = 1.25;
    const expected = execute(instructions, constants(seconds, elapsed), uv, vertex, (slot, u, v) => sample(textureSlots.get(slot), u, v));
    const actual = kernel.shadeFieldParticle(material, { uv, color: vertex, engineSeconds: seconds, elapsedSeconds: elapsed }, sample);
    if (expected === null) assert.equal(actual, null);
    else {
      shadedProbes++;
      assert.notEqual(actual, null);
      for (const c of ["r", "g", "b", "a"]) { const error = Math.abs(actual[c] - expected[c]); maxShaderError = Math.max(maxShaderError, error); assert.ok(error < 0.00002, `${group} ${c}: ${error}`); }
    } shaderProbes++;
  }
  materials.push({ group, source: material.source, shader: { vertex: material.vertexSha256, fragment: material.fragmentSha256 }, blockers: modules.blockers });
}
const bad = structuredClone(dep); Object.values(bad.shaders)[0].programs.progFragment.sha256 = "0".repeat(64);
check(() => assert.throws(() => compileFieldParticleMaterial(groups[0], bad), /variant/));
const unknownSpace = structuredClone(dep); unknownSpace.settings.activeColorSpace = 1;
check(() => assert.throws(() => compileFieldParticleMaterial(groups[0], unknownSpace), /gamma/));
const missingSpace = structuredClone(dep); delete missingSpace.settings;
check(() => assert.throws(() => compileFieldParticleMaterial(groups[0], missingSpace)));
const missingTexture = structuredClone(dep); delete missingTexture.textures[Object.keys(missingTexture.textures)[0]];
check(() => assert.throws(() => compileFieldParticleMaterial(groups[0], missingTexture)));
const stencil = structuredClone(dep); Object.values(stencil.shaders)[0].state.stencilOp.pass.val = 2;
check(() => assert.throws(() => compileFieldParticleMaterial(groups[0], stencil), /stencil/));
const mipmapped = structuredClone(dep); Object.values(mipmapped.textures)[0].mipCount = 2;
check(() => assert.throws(() => compileFieldParticleMaterial(groups[0], mipmapped), /sampling/));
check(() => assert.ok(shadedProbes > 10, "The source shader oracle must exercise visible fragments, not only discard"));
const report = { formatVersion: 1, lane: "source-particle-module-and-shader-kernels", semanticsVerified: false, originalGameExecuted: false, browserExecuted: false,
  sourceSetHash: dep.sourceSetHash, reference, checks, actualEmitters: 5, admittedEmitters: 0, textures: 3, shaderInstructions: instructions.length, shaderProbes, shadedProbes, maxShaderError,
  materials, moduleProbes, limitations: ["Independent DXBC CPU evaluation is not native GPU execution.",
    "Module samples use explicit random inputs; no native RNG, Noise, shape, prewarm or emission scheduler is substituted.",
    "Serialized curve infinity outside the actual key interval remains blocked.", "No field provider, playability or visual parity is granted."] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particles-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: "pass", checks, actualEmitters: 5, admittedEmitters: 0, shaderProbes, shadedProbes, maxShaderError, reportSha256: sha(JSON.stringify(report)) }));
