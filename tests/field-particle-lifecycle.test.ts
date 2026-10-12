import test from "node:test";
import assert from "node:assert/strict";
import { prepareParticleBirthTiming, prepareParticlePrewarm, prepareStoppedParticlePlay, reserveParticleBirthBatch, scheduleParticleSimulation, selectParticleSimulationStep,
  type ParticleLifecycleDefinition, type ParticleLifecycleState } from "../src/core/field-particle-lifecycle.js";
import { createParticleEmissionState, seedParticleRandom } from "../src/core/field-particle-emitter.js";
import { assertParticleLifecycleEvidence, compileFieldParticleLifecycle, compileParticleTimeSettings,
  PARTICLE_LIFECYCLE_BODIES, PARTICLE_TIME_SOURCE } from "../src/compiler/field-particle-lifecycle.js";
import { UNITY_PARTICLE_ENGINE } from "../src/compiler/field-particle-emitter.js";
import { particleModuleExport } from "./fixtures/field-particles.js";

const clock = () => ({ fixedTimestep: Math.fround(.02), maximumParticleTimestep: Math.fround(.03), maximumTimestep: Math.fround(.1), timeScale: 1 });
const definition = (): ParticleLifecycleDefinition => ({ kind: "field-particle-lifecycle-v1", maximumLifetime: 3.5, simulationSpeed: 1, looping: true, prewarm: true, clock: clock(),
  emission: { kind: "unity-constant-particle-emission-v1", source: { file: "synthetic", assetPath: "controlled/particle" }, duration: 1, rate: 10,
    bursts: [{ time: 0, count: 1, cycles: 1, interval: .25, probability: 1 }] } });
const state = (): ParticleLifecycleState => ({ time: 0, loops: 0, accumulated: 0, emission: createParticleEmissionState(seedParticleRandom(42)) });
const clockExport = () => ({ formatVersion: 1, adapterVersion: "field-particle-clock-0.1.0", parentSourceSetHash: "8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed",
  sourceSetHash: "4580ec9c9753565b50ba9c682dcfa42ea7a2ddd64b331bfdb5ef8affca02cf63", sources: [{ file: String(PARTICLE_TIME_SOURCE.file), sha256: String(PARTICLE_TIME_SOURCE.sha256) }],
  timeManager: { type: "TimeManager", source: { ...PARTICLE_TIME_SOURCE, objectId: String(PARTICLE_TIME_SOURCE.objectId) }, values: clock() } });
const evidence = () => ({ kind: "unity-particle-native-inspection-v1", semanticsVerified: false,
  native: { sha256: UNITY_PARTICLE_ENGINE.nativeSha256, imageBase: "0x180000000", versions: [UNITY_PARTICLE_ENGINE.version] },
  pdb: { sha256: UNITY_PARTICLE_ENGINE.pdbSha256, guid: UNITY_PARTICLE_ENGINE.pdbGuid, age: UNITY_PARTICLE_ENGINE.pdbAge },
  methods: Object.entries(PARTICLE_LIFECYCLE_BODIES).map(([rva, sha256]) => ({ rva, sha256 })) });
const normal = (delta: number) => ({ delta, fixedTimeStep: false, allowCatchUpStepGrowth: true });

test("playing particle frames divide long delta equally while fixed simulation uses the source fixed step", () => {
  assert.equal(selectParticleSimulationStep(.1, false, clock()), Math.fround(.025));
  assert.equal(selectParticleSimulationStep(.03, false, clock()), Math.fround(.03));
  assert.equal(selectParticleSimulationStep(.030001, false, clock()), Math.fround(Math.fround(.030001) / 2));
  assert.equal(selectParticleSimulationStep(.1, true, clock()), Math.fround(.02));
});
test("prewarm spans maximum lifetime and starts at its wrapped negative time", () => {
  const a = prepareParticlePrewarm({ ...definition(), maximumLifetime: 5 });
  const b = prepareParticlePrewarm(definition());
  const c = prepareParticlePrewarm({ ...definition(), maximumLifetime: Math.fround(.64) });
  assert.equal(a.simulateSeconds, 5); assert.equal(a.initialTime, 0); assert.equal(a.scratchIntervals.length, 250);
  assert.equal(b.simulateSeconds, 3.5); assert.equal(b.initialTime, .5); assert.equal(b.scratchIntervals.length, 175);
  assert.equal(c.simulateSeconds, Math.fround(.64)); assert.equal(c.initialTime, Math.fround(1 - Math.fround(.64))); assert.equal(c.scratchIntervals.length, 32);
});
test("seeking retains float32 fixed-step remainder and independent scratch visitation", () => {
  const p = prepareParticlePrewarm({ ...definition(), maximumLifetime: 5 }, 1.25);
  assert.equal(p.simulateSeconds, 5.010000228881836); assert.equal(p.initialTime, .24000000953674316);
  assert.equal(p.scratchIntervals.length, 188);
  assert.notEqual(p.scratchIntervals.at(-1)!.currentTime, .25);
});
test("fixed simulation keeps a short accumulated remainder instead of inventing a partial step", () => {
  const prior = state();
  const a = scheduleParticleSimulation(definition(), prior, { ...normal(.01), fixedTimeStep: true });
  assert.equal(a.slices.length, 0); assert.equal(a.state.time, 0); assert.deepEqual(a.state.emission, prior.emission);
  const b = scheduleParticleSimulation(definition(), a.state, { ...normal(.01), fixedTimeStep: true });
  assert.equal(b.slices.length, 1); assert.equal(b.state.time, Math.fround(.02)); assert.equal(b.slices[0]!.emission.totalCount, 1);
});
test("zero and sub-threshold ordinary frames do not acquire time or random draws", () => {
  const prior = { ...state(), accumulated: .005 }, before = structuredClone(prior);
  for (const delta of [0, .000001]) assert.deepEqual(scheduleParticleSimulation(definition(), prior, normal(delta)).state,
    { ...prior, accumulated: Math.fround(prior.accumulated) });
  assert.deepEqual(prior, before);
});
test("source slices expose existing-before-birth intervals and preserve per-frame interpolation offsets", () => {
  const next = scheduleParticleSimulation(definition(), state(), normal(.1));
  assert.equal(next.slices.length, 4);
  assert.equal(next.slices[0]!.frameOffset, 3); assert.equal(next.slices[0]!.previousTime, 0);
  assert.deepEqual(next.slices.map((s) => s.emission.totalCount), [1, 0, 0, 1]);
  assert.equal(next.slices.at(-1)!.frameOffset, 1.1920928955078125e-7);
  assert.equal(next.state.accumulated, 3.725290298461914e-9);
});
test("clock wrap and source epsilon preserve duration-sized catch-up emission", () => {
  const p = definition(); p.emission.bursts = [];
  const next = scheduleParticleSimulation(p, state(), { delta: 10.1, fixedTimeStep: true, allowCatchUpStepGrowth: true });
  assert.equal(next.slices[0]!.delta, 1); assert.equal(next.slices[0]!.time, 0);
  assert.equal(next.slices[0]!.emission.continuousCount, 9); assert.equal(next.state.loops, 10);
  const noGrowth = scheduleParticleSimulation(p, state(), { delta: 10.1, fixedTimeStep: true, allowCatchUpStepGrowth: false });
  assert.equal(noGrowth.slices[0]!.delta, Math.fround(.02)); assert.ok(noGrowth.slices.length > next.slices.length);
});
test("planning and later results never mutate or alias supplied random state", () => {
  const prior = state(), before = structuredClone(prior), next = scheduleParticleSimulation(definition(), prior, normal(.1));
  next.state.emission.random[0] = 999;
  assert.deepEqual(prior, before); assert.notEqual(next.slices[0]!.emission.state.random[0], 999);
});
test("invalid inputs and unsupported lifecycle branches fail without partial publication", () => {
  const prior = state(), before = structuredClone(prior);
  for (const delta of [-1, Infinity, NaN]) assert.throws(() => scheduleParticleSimulation(definition(), prior, normal(delta)));
  assert.throws(() => scheduleParticleSimulation(definition(), { ...prior, time: 1 }, normal(.01)), /state/);
  assert.throws(() => scheduleParticleSimulation(definition(), { ...prior, emission: { ...prior.emission, fractionalCount: 1 } }, normal(0)), /accumulation/);
  assert.throws(() => prepareParticlePrewarm({ ...definition(), maximumLifetime: 1e30 }), /overflow/);
  assert.throws(() => prepareParticlePrewarm({ ...definition(), looping: false as true }), /branch/);
  assert.deepEqual(prior, before);
});
test("clock compiler refuses forged object identity, source manifest and changed settings", () => {
  assert.deepEqual(compileParticleTimeSettings(clockExport()), clock());
  const wrongId = clockExport(); wrongId.timeManager.source.objectId = "9";
  assert.throws(() => compileParticleTimeSettings(wrongId), /identity/);
  const wrongSource = clockExport(); wrongSource.sources[0]!.sha256 = "0".repeat(64);
  assert.throws(() => compileParticleTimeSettings(wrongSource), /manifest/);
  const wrongClock = clockExport(); wrongClock.timeManager.values.maximumParticleTimestep = .02;
  assert.throws(() => compileParticleTimeSettings(wrongClock), /values/);
});
test("native lifecycle qualification requires every exact body and rejects conflicting evidence", () => {
  const e = evidence(); assertParticleLifecycleEvidence([e]);
  e.methods.pop(); assert.throws(() => assertParticleLifecycleEvidence([e]), /body/);
  const conflict = evidence(); conflict.methods[0]!.sha256 = "0".repeat(64);
  assert.throws(() => assertParticleLifecycleEvidence([evidence(), conflict]), /Conflicting/);
});
test("compiled scheduling cannot silently select an unproven procedural/no-prewarm path", () => {
  const raw = particleModuleExport(), plan = compileFieldParticleLifecycle("controlled_effect", raw, UNITY_PARTICLE_ENGINE, clockExport(), [evidence()]);
  assert.equal(plan.maximumLifetime, 3); assert.equal(plan.emission.rate, 10);
  const p = raw.objects.find((o) => o.type === "ParticleSystem")!.data; p.prewarm = false;
  assert.throws(() => compileFieldParticleLifecycle("controlled_effect", raw, UNITY_PARTICLE_ENGINE, clockExport(), [evidence()]), /prewarm/);
});

test("birth allocation preserves a four-lane scratch tail and compacts to the logical count", () => {
  assert.deepEqual(reserveParticleBirthBatch({ activeCount: 3, maximumParticles: 10, requested: 9 }),
    { startIndex: 4, accepted: 7, temporaryCount: 12, reserveCapacity: 32, finalCount: 10 });
  assert.deepEqual(reserveParticleBirthBatch({ activeCount: 31, maximumParticles: 100, requested: 2 }),
    { startIndex: 32, accepted: 2, temporaryCount: 36, reserveCapacity: 64, finalCount: 33 });
});
test("full or reduced capacity rejects births without reallocating or truncating existing particles", () => {
  assert.deepEqual(reserveParticleBirthBatch({ activeCount: 11, maximumParticles: 10, requested: 20 }),
    { startIndex: 12, accepted: 0, temporaryCount: 11, reserveCapacity: null, finalCount: 11 });
  assert.throws(() => reserveParticleBirthBatch({ activeCount: .5, maximumParticles: 10, requested: 1 }), /allocation/);
});

test("stopped prewarm Play consumes all three source automatic resets before the first birth", () => {
  const manager = seedParticleRandom(42), before = structuredClone(manager);
  const result = prepareStoppedParticlePlay(definition(), { seed: 0, autoRandomSeed: true }, manager);
  assert.equal(result.initialRandom.seed, 1700172395);
  assert.deepEqual(result.manager, [4076950273, 4076870683, 2922739962, 1700172395]);
  assert.deepEqual(manager, before); assert.equal(result.initialState.time, .5);
  assert.deepEqual(result.initialState.emission.random, seedParticleRandom(1700172395));
  assert.equal(result.initialState.emission.fractionalCount, 0);
  assert.ok(result.simulation.slices.length > 0);
  assert.notDeepEqual(result.simulation.state.emission.random, result.initialState.emission.random);
});
test("explicit seed Play preserves the manager; missing automatic entropy fails before publication", () => {
  const manager = seedParticleRandom(42), before = structuredClone(manager);
  const result = prepareStoppedParticlePlay(definition(), { seed: 123, autoRandomSeed: false }, manager);
  assert.equal(result.initialRandom.seed, 123); assert.deepEqual(result.manager, before);
  assert.throws(() => prepareStoppedParticlePlay(definition(), { seed: 0, autoRandomSeed: true }, null), /entropy/);
  assert.deepEqual(manager, before);
});

test("continuous birth age follows spacing and carry while bursts retain the source minimum fraction", () => {
  const emission = { continuousCount: 3, burstCount: 2, totalCount: 5,
    state: { ...state().emission, spacing: .5, fractionalCount: Math.fround(.3) } };
  const result = prepareParticleBirthTiming({ duration: 1, currentTime: .01, delta: .03, acceptedCount: 5, emission });
  assert.deepEqual(result.birthDeltas, [0.004500000271946192, 0.019499998539686203, 0.029999999329447746, 2.999999892949745e-8, 2.999999892949745e-8]);
  assert.equal(result.normalizedEmitterTime, Math.fround(.01));
  assert.equal(result.birthNormalizedTimes[1], 0); assert.equal(result.birthNormalizedTimes[2], 0);
  assert.equal(result.birthNormalizedTimes[3], 0.009999969974160194);
  const limited = prepareParticleBirthTiming({ duration: 1, currentTime: .01, delta: .03, acceptedCount: 2, emission });
  assert.deepEqual(limited.birthDeltas, result.birthDeltas.slice(0, 2));
});
test("birth timing rejects excess capacity claims and unsupported normalization", () => {
  const slice = scheduleParticleSimulation(definition(), state(), normal(.02)).slices[0]!;
  assert.throws(() => prepareParticleBirthTiming({ duration: 1, currentTime: slice.time, delta: slice.delta, acceptedCount: 2, emission: slice.emission }), /admission/);
  assert.throws(() => prepareParticleBirthTiming({ duration: 2, currentTime: slice.time, delta: slice.delta, acceptedCount: 1, emission: slice.emission }), /normalization/);
});
