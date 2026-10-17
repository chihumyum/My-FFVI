// Real source graphs/settings and independent native instruction observations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const compiled = process.argv.includes("--compiled-dir") ? process.argv[process.argv.indexOf("--compiled-dir") + 1] : "dist";
const module = (file) => import(pathToFileURL(resolve(root, compiled, "src", file + ".js")));
const k = await module("core/field-particle-lifecycle"), c = await module("compiler/field-particle-lifecycle");
const e = await module("core/field-particle-emitter"), ec = await module("compiler/field-particle-emitter");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((key) => JSON.stringify(key) + ":" + canonical(v[key])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (fn) => { fn(); checks++; };
const native = await json("build/reports/field-particle-lifecycle-native-check.json");
check(() => assert.equal(native.status, "pass")); check(() => assert.equal(native.semanticsVerified, false));
const probeBytes = await readFile(resolve(root, native.instructionProbes)); check(() => assert.equal(sha(probeBytes), native.instructionProbeSha256));
const probes = JSON.parse(probeBytes), inspections = [];
for (const batch of ["v36-unity-particle-lifecycle", "v36-unity-particle-lifecycle-context", "v35-unity-particle-seeds", "v36-unity-particle-birth-context"]) inspections.push(await json(`build/native/${batch}/inspection.json`));
c.assertParticleLifecycleEvidence(inspections);
const clockDir = "build/v36-field-particle-clock", mediaDir = "build/v33-field-effect-media";
for (const directory of [clockDir, mediaDir]) for (const item of (await json(directory + "/snapshot.json")).files) {
  check(() => assert.ok(!item.file.includes("..") && !item.file.startsWith("/")));
  const bytes = await readFile(resolve(root, directory, item.file)); check(() => assert.equal(sha(bytes), item.sha256));
}
const clockExport = await json(clockDir + "/clock.json"), clock = c.compileParticleTimeSettings(clockExport);
for (const source of clockExport.sources) { const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256)); }
check(() => assert.equal(sha(canonical(clockExport.sources)), clockExport.sourceSetHash));
const plan = { kind: "field-particle-lifecycle-v1", maximumLifetime: 5, simulationSpeed: 1, looping: true, prewarm: true, clock,
  emission: { kind: "unity-constant-particle-emission-v1", source: { file: "controlled-native-struct" }, duration: 1, rate: 10,
    bursts: [{ time: 0, count: 1, cycles: 1, interval: .25, probability: 1 }] } };
for (const test of probes.timesteps) check(() => assert.equal(k.selectParticleSimulationStep(test.delta, test.fixedTimeStep, clock), test.step));
for (const test of probes.prewarm) check(() => assert.deepEqual(k.prepareParticlePrewarm({ ...plan, maximumLifetime: test.input.maximumLifetime }, test.input.requestedTime), test.output));
for (const test of probes.schedules) {
  const result = k.scheduleParticleSimulation(plan, { time: test.input.time, loops: 0, accumulated: test.input.accumulated,
    emission: e.createParticleEmissionState(e.seedParticleRandom(42)) }, test.input);
  check(() => assert.equal(result.step, test.step)); check(() => assert.deepEqual(result.state, test.output));
  const trace = result.slices.flatMap((s) => [{ operation: "simulate-existing", delta: s.delta },
    { operation: "birth", time: s.time, delta: s.delta, continuousCount: s.emission.continuousCount, totalCount: s.emission.totalCount, frameOffset: s.frameOffset }]);
  trace.push({ operation: "update-size" }); // This controlled native struct has no alternate size-update consumer.
  check(() => assert.deepEqual(trace, test.trace));
}
for (const test of probes.allocations) check(() => assert.deepEqual(k.reserveParticleBirthBatch(test.input), test.output));
for (const test of probes.birthTimings) {
  const i = test.input, totalCount = Math.max(i.count, i.continuous);
  const actual = k.prepareParticleBirthTiming({ duration: 1, currentTime: i.time, delta: i.delta, acceptedCount: i.count,
    emission: { totalCount, continuousCount: i.continuous, burstCount: totalCount - i.continuous,
      state: { random: e.seedParticleRandom(42), spacing: i.spacing, fractionalCount: i.fractional } } });
  check(() => assert.equal(actual.normalizedEmitterTime, i.time));
  check(() => assert.deepEqual({ birthNormalizedTimes: actual.birthNormalizedTimes, birthDeltas: actual.birthDeltas,
    paddedBirthNormalizedTimes: actual.paddedBirthNormalizedTimes, paddedBirthDeltas: actual.paddedBirthDeltas }, test.output));
}
for (const test of probes.playSequences) {
  const resetCount = test.input.stopped ? test.input.prewarm ? 3 : 1 : 0;
  let manager = e.seedParticleRandom(test.input.managerSeed), seed = test.input.seed, emitter;
  for (let i = 0; i < resetCount; i++) {
    const result = e.resetParticleEmitterRandom({ seed, autoRandomSeed: test.input.automatic }, manager);
    manager = result.manager; emitter = result.emitter; seed = emitter.seed;
  }
  check(() => assert.equal(test.trace.filter((v) => v.operation === "reset-seeds").length, resetCount));
  check(() => assert.equal(seed, test.seed)); check(() => assert.deepEqual(manager, test.manager));
  check(() => assert.deepEqual(e.seedParticleRandom(seed), test.emission)); check(() => assert.equal(test.playing, 1));
  if (test.input.stopped && test.input.prewarm) {
    const candidate = k.prepareStoppedParticlePlay(plan, { seed: test.input.seed, autoRandomSeed: test.input.automatic }, e.seedParticleRandom(test.input.managerSeed));
    check(() => assert.equal(candidate.initialRandom.seed, test.seed)); check(() => assert.deepEqual(candidate.manager, test.manager));
    check(() => assert.deepEqual(candidate.initialState.emission.random, test.emission));
    check(() => assert.equal(candidate.initialState.time, test.initialTime));
    check(() => assert.deepEqual(test.trace, [
      { operation: "play", prewarm: true }, { operation: "reserve", count: 1024 }, { operation: "reset-seeds" },
      { operation: "simulate", time: 0, flags: 3 }, { operation: "reset-seeds" }, { operation: "clear" },
      { operation: "play", prewarm: false }, { operation: "reserve", count: 1024 }, { operation: "reset-seeds" },
      { operation: "update", delta: candidate.prewarm.simulateSeconds, flags: 1, initialTime: candidate.prewarm.initialTime },
    ]));
  }
}
const engine = ec.compileParticleEmitterEngine(await Promise.all(["v35-unity-particle-seeds", "v35-unity-particle-emission"].map((b) => json(`build/native/${b}/inspection.json`))));
const corpus = await json("build/corpus/corpus.json"), media = await json(mediaDir + "/media.json");
check(() => assert.equal(sha(canonical(corpus.sources)), corpus.sourceSetHash));
check(() => assert.equal(media.parentSourceSetHash, corpus.sourceSetHash));
check(() => assert.equal(clockExport.parentSourceSetHash, corpus.sourceSetHash));
for (const source of media.sources) {
  check(() => assert.deepEqual(source, corpus.sources.find((s) => s.file === source.file)));
  const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
}
const assets = [];
for (const [group, graph] of Object.entries(media.groups)) {
  const definition = c.compileFieldParticleLifecycle(group, graph, engine, clockExport, inspections), prewarm = k.prepareParticlePrewarm(definition);
  const prior = { time: prewarm.initialTime, loops: 0, accumulated: 0, emission: e.createParticleEmissionState(e.seedParticleRandom(42)) };
  const result = k.scheduleParticleSimulation(definition, prior, { delta: prewarm.simulateSeconds, fixedTimeStep: true, allowCatchUpStepGrowth: true });
  check(() => assert.ok(result.slices.length > 0)); check(() => assert.equal(prior.emission.fractionalCount, 0));
  assets.push({ group, maximumLifetime: definition.maximumLifetime, initialTime: prewarm.initialTime, simulateSeconds: prewarm.simulateSeconds,
    scratchIntervals: prewarm.scratchIntervals.length, simulationSteps: result.slices.length, finalClock: { time: result.state.time, loops: result.state.loops, accumulated: result.state.accumulated },
    scheduledBirthsBeforeCapacity: result.slices.reduce((n, s) => n + s.emission.totalCount, 0), traceSha256: sha(canonical(result)) });
}
const report = { formatVersion: 1, status: "pass", lane: "source-particle-lifecycle-kernels-with-independent-instruction-probes", checks, semanticsVerified: false,
  sourceSetHash: corpus.sourceSetHash, clockSource: clockExport.timeManager.source, nativeChecks: native.checks,
  instructionCases: { timesteps: probes.timesteps.length, prewarm: probes.prewarm.length, schedules: probes.schedules.length,
    allocations: probes.allocations.length, playSequences: probes.playSequences.length, birthTimings: probes.birthTimings.length },
  assets, admittedFullEmitters: 0, originalGameExecuted: false,
  limitations: ["Source callbacks for motion/birth/size are observed at the scheduler boundary, not executed by this check.",
    "Play reset sequencing executes against controlled scene providers; seed 42 does not establish runtime entropy or scene hierarchy.",
    "Prewarm and normal schedules require the complete birth/motion/geometry host before original game admission."] };
await writeFile(resolve(root, "build/reports/field-particle-lifecycle-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, instructionCases: report.instructionCases, actualAssets: assets.length, admittedFullEmitters: 0 }));
