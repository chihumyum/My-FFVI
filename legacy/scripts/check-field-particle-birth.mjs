import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const compiled = option("--compiled-dir", "dist");
const k = await import(pathToFileURL(resolve(root, compiled, "src/core/field-particle-birth.js")));
const rng = await import(pathToFileURL(resolve(root, compiled, "src/core/field-particle-emitter.js")));
const c = await import(pathToFileURL(resolve(root, compiled, "src/compiler/field-particle-birth.js")));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((key) => JSON.stringify(key) + ":" + canonical(v[key])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (fn) => { fn(); checks++; };
const native = await json("build/reports/field-particle-birth-native-check.json");
check(() => assert.equal(native.semanticsVerified, false));
const probeBytes = await readFile(resolve(root, native.instructionProbes)); check(() => assert.equal(sha(probeBytes), native.instructionProbeSha256));
const probes = JSON.parse(probeBytes), mediaBytes = await readFile(resolve(root, probes.media)), media = JSON.parse(mediaBytes);
check(() => assert.equal(sha(mediaBytes), probes.mediaSha256));
const snapshot = await json("build/v33-field-effect-media/snapshot.json");
for (const file of snapshot.files) {
  check(() => assert.ok(!file.file.includes("..") && !file.file.startsWith("/")));
  const bytes = await readFile(resolve(root, "build/v33-field-effect-media", file.file)); check(() => assert.equal(sha(bytes), file.sha256));
}
const corpus = await json("build/corpus/corpus.json");
check(() => assert.equal(sha(canonical(corpus.sources)), corpus.sourceSetHash)); check(() => assert.equal(media.parentSourceSetHash, corpus.sourceSetHash));
for (const source of media.sources) {
  check(() => assert.deepEqual(source, corpus.sources.find((s) => s.file === source.file)));
  const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
}
const inspections = await Promise.all(["birth", "birth-dispatch", "birth-context", "birth-speed", "birth-rotation"].map((s) => json(`build/native/v36-unity-particle-${s}/inspection.json`)));
const engine = c.compileParticleBirthEngine(inspections), names = ["ef_ff6_m_001", "ef_ff6_m_002", "ef_ff6_m_003", "ef_ff6_m_004", "ef_ff6_m_016"];
check(() => assert.deepEqual(Object.keys(media.groups), names)); check(() => assert.equal(engine.nativeSha256, probes.nativeSha256));
const definitions = Object.fromEntries(names.map((name) => [name, c.compileFieldParticleBirth(name, media.groups[name], engine)]));
const stateWords = (state) => [0, 1, 2, 3].flatMap((word) => state.map((lane) => lane[word]));
let actualBatches = 0, actualParticles = 0, controlledBatches = 0, controlledParticles = 0, scalarComparisons = 0, paddedParticlesCompared = 0;
const traces = new Map(names.map((n) => [n, []]));
function compareCase(definition, probe, controlled) {
  let random = { initial: rng.seedParticleRandomLanes(probe.seed), shape: rng.seedParticleRandomLanes(probe.seed) };
  for (const step of probe.steps) {
    // These inputs are explicitly controlled and only retained by the birth
    // kernel. They are NOT proof of StartModules emission spacing/scheduling.
    const input = { startIndex: step.startIndex, count: step.count, normalizedEmitterTime: step.normalizedEmitterTime,
      birthDeltas: Array.from({ length: step.count }, (_, i) => Math.fround(.002 * (i + 1))),
      birthNormalizedTimes: Array.from({ length: step.count }, (_, i) => Math.max(0, Math.fround(step.normalizedEmitterTime - i * .001))),
      simulationScale: [1, 1, 1] };
    const previous = structuredClone(random), result = k.birthParticleBatch(definition, random, input);
    const paddedInput = { ...input,
      paddedBirthDeltas: Array.from({ length: step.paddedCount }, (_, i) => Math.fround(.002 * (i + 1))),
      paddedBirthNormalizedTimes: Array.from({ length: step.paddedCount }, (_, i) => Math.max(0, Math.fround(step.normalizedEmitterTime - i * .001))) };
    const padded = k.birthPaddedParticleBatch(definition, random, paddedInput);
    check(() => assert.deepEqual(padded.particles, result.particles)); check(() => assert.deepEqual(padded.random, result.random));
    check(() => assert.deepEqual(random, previous)); check(() => assert.equal(result.paddedCount, step.paddedCount));
    check(() => assert.equal(result.particles.length, step.count));
    for (const module of ["initial", "shape"]) check(() => assert.deepEqual(stateWords(result.random[module]), step.random[module]));
    for (let i = 0; i < step.paddedCount; i++) {
      const actual = padded.paddedParticles[i], expected = step.particles[i];
      for (const key of ["index", "seed", "inverseLifetime", "normalizedAge", "packedColor", "position", "velocity"]) {
        check(() => assert.deepEqual(actual[key], expected[key], `${probe.asset ?? probe.label}: ${step.startIndex}/${i}/${key}`));
        scalarComparisons += Array.isArray(actual[key]) ? actual[key].length : 1;
      }
      check(() => assert.deepEqual(actual.size, [expected.size, expected.size, expected.size]));
      check(() => assert.deepEqual(actual.rotation, [0, 0, expected.rotation]));
      check(() => assert.equal(actual.birthDelta, paddedInput.paddedBirthDeltas[i])); check(() => assert.equal(actual.normalizedEmitterTime, paddedInput.paddedBirthNormalizedTimes[i]));
      check(() => assert.deepEqual(actual.color.map((n) => Math.round(n * 255)), [0, 8, 16, 24].map((shift) => (expected.packedColor >>> shift) & 255)));
      scalarComparisons += 6; paddedParticlesCompared++;
    }
    random = result.random;
    if (controlled) { controlledBatches++; controlledParticles += step.count; }
    else { actualBatches++; actualParticles += step.count; traces.get(probe.asset).push(result); }
  }
}
for (const probe of probes.cases) {
  check(() => assert.deepEqual(definitions[probe.asset].source, probe.source));
  compareCase(definitions[probe.asset], probe, false);
}
for (const probe of probes.controlledCases) {
  const definition = structuredClone(definitions.ef_ff6_m_003);
  definition.source = { file: "controlled-original-instruction-input", assetPath: probe.label };
  const range = (v) => v.minMaxState === 0 ? { mode: "constant", value: v.scalar } : { mode: "two-constants", min: v.minScalar, max: v.scalar };
  for (const [key, source] of [["lifetime", "startLifetime"], ["speed", "startSpeed"], ["size", "startSize"], ["rotation", "startRotation"]]) definition.initial[key] = range(probe.initial[source]);
  definition.initial.color = ["r", "g", "b", "a"].map((v) => probe.initial.startColor.maxColor[v]);
  definition.cone = { angle: probe.shape.angle, radius: probe.shape.radius.value, rotation: ["x", "y", "z"].map((v) => probe.shape.m_Rotation[v]) };
  compareCase(definition, probe, true);
}
const assets = names.map((name, i) => {
  const definition = definitions[name];
  check(() => assert.equal(definition.cone.radius, i < 2 ? Math.fround(.0001) : 2));
  check(() => assert.deepEqual(definition.initial.color, [1, 1, 1, 1]));
  const bad = structuredClone(media.groups[name]), p = bad.objects.find((o) => o.type === "ParticleSystem" && o.source.objectId === definition.source.objectId).data;
  p.ShapeModule.arc.mode = 1; check(() => assert.throws(() => c.compileFieldParticleBirth(name, bad, engine), /sampling mode/));
  return { name, source: definition.source, initial: definition.initial, cone: definition.cone,
    batches: traces.get(name).length, traceSha256: sha(canonical(traces.get(name))), scope: "Initial/Shape/CalculateInitialValues birth kernel" };
});
const report = { lane: "source-bound-particle-birth-kernel-with-isolated-original-instruction-comparison", semanticsVerified: false,
  checks, nativeChecks: native.checks, engine, sourceSetHash: corpus.sourceSetHash, nativeInstructionReport: "build/reports/field-particle-birth-native-check.json",
  actualAssets: names.length, actualBatches, actualParticles, controlledBatches, controlledParticles, paddedParticlesCompared, scalarComparisons,
  instructionComparison: "Exact float32/uint outputs for all tested live and SIMD padding particles; no tolerance masks", assets,
  admittedFullEmitters: 0, controlledInputs: ["Fixed seeds and explicit aligned batches", "Birth delta/time arrays retained, not integrated", "Unit simulation scale/fresh inherited defaults"],
  remaining: ["Host automatic entropy/lifecycle scheduling and capacity commit", "Motion/Noise integration and render provider assembly", "Physical CPU reciprocal estimates may differ within the SSE estimate contract", "Original-game dynamic comparison"] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-birth-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, actualAssets: names.length, actualBatches, actualParticles, controlledBatches, controlledParticles, paddedParticlesCompared, scalarComparisons, admittedFullEmitters: 0, semanticsVerified: false }));
