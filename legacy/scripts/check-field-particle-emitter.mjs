// Exact-source constant-emission kernels, with independent native instruction probes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const compiled = option("--compiled-dir", "dist");
const k = await import(pathToFileURL(resolve(root, compiled, "src/core/field-particle-emitter.js")));
const c = await import(pathToFileURL(resolve(root, compiled, "src/compiler/field-particle-emitter.js")));
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((key) => JSON.stringify(key) + ":" + canonical(v[key])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (fn) => { fn(); checks++; };
const native = await json("build/reports/field-particle-emitter-native-check.json");
check(() => assert.equal(native.semanticsVerified, false));
const bytes = await readFile(resolve(root, native.instructionProbes)); check(() => assert.equal(sha(bytes), native.instructionProbeSha256));
const probes = JSON.parse(bytes), inspections = [];
for (const batch of ["v35-unity-particle-seeds", "v35-unity-particle-emission"]) inspections.push(await json(`build/native/${batch}/inspection.json`));
const engine = c.compileParticleEmitterEngine(inspections);
check(() => assert.equal(engine.nativeSha256, probes.nativeSha256));
const matrix = (state) => [0, 1, 2, 3].flatMap((word) => state.map((lane) => lane[word]));
let rngSteps = 0, clockCases = 0, emissionIntervals = 0;
for (const test of probes.rng) {
  let state = k.seedParticleRandomLanes(test.seed); check(() => assert.deepEqual(matrix(state), test.state));
  for (const step of test.steps) {
    const next = k.nextParticleRandomLanes(state, step.asFloat);
    check(() => assert.deepEqual(next.values, step.values)); check(() => assert.deepEqual(matrix(next.state), step.state));
    state = next.state; rngSteps++;
  }
}
for (const test of probes.clock) {
  check(() => assert.deepEqual(k.tickParticleSystemClock(test.input, test.input.delta, test.input), test.output)); clockCases++;
}
for (const test of probes.emissions) {
  const plan = { kind: "unity-constant-particle-emission-v1", source: { file: "controlled-native-probe" }, duration: 1, rate: test.rate,
    bursts: [{ time: 0, count: 1, cycles: test.cycles, interval: test.interval, probability: test.probability }] };
  let state = k.createParticleEmissionState(k.seedParticleRandom(test.seed));
  for (const expected of test.results) {
    const next = k.emitParticleInterval(plan, state, expected);
    check(() => assert.deepEqual({ ...next.state, continuousCount: next.continuousCount, totalCount: next.totalCount }, {
      random: expected.random, fractionalCount: expected.fractionalCount, spacing: expected.spacing,
      continuousCount: expected.continuousCount, totalCount: expected.totalCount }));
    state = next.state; emissionIntervals++;
  }
}
const mediaDir = "build/v33-field-effect-media", snapshot = await json(mediaDir + "/snapshot.json");
for (const file of snapshot.files) {
  check(() => assert.ok(!file.file.includes("..") && !file.file.startsWith("/")));
  const bytes = await readFile(resolve(root, mediaDir, file.file)); check(() => assert.equal(sha(bytes), file.sha256));
}
const corpus = await json("build/corpus/corpus.json"), media = await json(mediaDir + "/media.json");
check(() => assert.equal(sha(canonical(corpus.sources)), corpus.sourceSetHash));
check(() => assert.equal(media.parentSourceSetHash, corpus.sourceSetHash));
for (const source of media.sources) {
  check(() => assert.deepEqual(source, corpus.sources.find((s) => s.file === source.file)));
  const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
}
const names = ["ef_ff6_m_001", "ef_ff6_m_002", "ef_ff6_m_003", "ef_ff6_m_004", "ef_ff6_m_016"];
check(() => assert.deepEqual(Object.keys(media.groups), names));
let manager = k.seedParticleRandom(0x12345678); // Explicit controlled entropy input, never a source default.
const assets = [];
for (const [index, group] of names.entries()) {
  const definition = c.compileFieldParticleEmitter(group, media.groups[group], engine);
  check(() => assert.equal(definition.emission.rate, [10, 14, 8, 8, 8][index]));
  check(() => assert.equal(definition.random.autoRandomSeed, true)); check(() => assert.equal(definition.prewarm, true));
  check(() => assert.deepEqual(definition.emission.bursts.map((b) => b.count), [1]));
  check(() => assert.ok(definition.blockers.some((s) => s.includes("Noise"))));
  check(() => assert.ok(definition.blockers.some((s) => s.includes("Cone"))));
  check(() => assert.throws(() => k.resetParticleEmitterRandom(definition.random, null), /entropy/));
  const reset = k.resetParticleEmitterRandom(definition.random, manager); manager = reset.manager;
  let state = k.createParticleEmissionState(reset.emitter.emission), clock = { time: 0, loops: 0 }, emitted = 0;
  const trace = [];
  for (let i = 0; i < 120; i++) {
    const nextClock = k.tickParticleSystemClock(clock, .01, { duration: definition.emission.duration, looping: true });
    const next = k.emitParticleInterval(definition.emission, state, { previousTime: clock.time, currentTime: nextClock.time });
    emitted += next.totalCount; state = next.state; clock = nextClock;
    trace.push({ clock, state, count: next.totalCount });
  }
  check(() => assert.ok(emitted > 0));
  assets.push({ group, source: definition.source, rate: definition.emission.rate, seed: reset.emitter.seed,
    controlledIntervals: trace.length, emitted, traceSha256: sha(canonical(trace)), simulation: definition.simulation, blockers: definition.blockers });
}
const report = { lane: "source-particle-emission-kernel-with-controlled-inputs", semanticsVerified: false, checks,
  engine, sourceSetHash: corpus.sourceSetHash, nativeChecks: native.checks, rngSteps, clockCases, emissionIntervals,
  actualAssets: assets.length, admittedFullEmitters: 0, assets,
  controlledInputs: { managerSeed: "0x12345678", intervalSeconds: .01, intervalsPerAsset: 120,
    note: "Controlled kernel input; neither source entropy nor engine/prewarm timestep is claimed" },
  doesNotEstablish: ["Original game execution", "Browser particle animation", "Complete emitter/Cone/Noise execution", "Prewarm scheduling", "Full-game parity"] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-emitter-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, rngSteps, clockCases, emissionIntervals, actualAssets: assets.length, admittedFullEmitters: 0, semanticsVerified: false }));
