import test from "node:test";
import assert from "node:assert/strict";
import { createParticleEmissionState, emitParticleInterval, nextParticleRandom, nextParticleRandomFloat, nextParticleRandomLanes,
  resetParticleEmitterRandom, seedParticleRandom, seedParticleRandomLanes, tickParticleSystemClock,
  type ParticleEmissionPlan } from "../src/core/field-particle-emitter.js";
import { compileFieldParticleEmitter, compileParticleEmitterEngine, UNITY_PARTICLE_ENGINE, UNITY_PARTICLE_KERNEL_BODIES } from "../src/compiler/field-particle-emitter.js";
import { particleModuleExport, sourceConstant } from "./fixtures/field-particles.js";

const plan = (overrides: Partial<ParticleEmissionPlan> = {}): ParticleEmissionPlan => ({ kind: "unity-constant-particle-emission-v1",
  source: { file: "synthetic", assetPath: "controlled/particle", objectId: "1" }, duration: 1, rate: 10,
  bursts: [{ time: 0, count: 1, cycles: 1, interval: .25, probability: 1 }], ...overrides });
const controlledEngineEvidence = () => ({ kind: "unity-particle-native-inspection-v1", semanticsVerified: false,
  native: { sha256: UNITY_PARTICLE_ENGINE.nativeSha256, imageBase: "0x180000000", versions: [UNITY_PARTICLE_ENGINE.version] },
  pdb: { sha256: UNITY_PARTICLE_ENGINE.pdbSha256, guid: UNITY_PARTICLE_ENGINE.pdbGuid, age: UNITY_PARTICLE_ENGINE.pdbAge },
  methods: Object.entries(UNITY_PARTICLE_KERNEL_BODIES).map(([rva, sha256]) => ({ rva, sha256 })) });

test("native lane seed spacing is independent, overflows uint32 and preserves inputs", () => {
  const lanes = seedParticleRandomLanes(0xffffffff);
  assert.deepEqual(lanes.map((s) => s[0]), [0xffffffff, 366, 733, 1100]);
  const before = structuredClone(lanes), next = nextParticleRandomLanes(lanes, false);
  assert.deepEqual(lanes, before); assert.notDeepEqual(next.state, before);
  assert.deepEqual(seedParticleRandom(0), [0, 1, 1812433254, 1900727103]);
});
test("automatic seeds consume the one supplied manager stream in order", () => {
  const original = seedParticleRandom(3), before = structuredClone(original);
  const first = resetParticleEmitterRandom({ seed: 0, autoRandomSeed: true }, original);
  const second = resetParticleEmitterRandom({ seed: 0, autoRandomSeed: true }, first.manager);
  assert.equal(first.emitter.seed, nextParticleRandom(original).value);
  assert.notEqual(first.emitter.seed, second.emitter.seed);
  assert.deepEqual(original, before); assert.deepEqual(first.emitter.initial, first.emitter.shape);
  first.emitter.initial[0][0] = 9; assert.notDeepEqual(first.emitter.initial, first.emitter.shape);
  assert.equal(first.emitter.noiseScroll, 0);
});
test("fixed seeds do not consume shared manager and missing automatic state is rejected", () => {
  const manager = seedParticleRandom(5);
  assert.deepEqual(resetParticleEmitterRandom({ seed: 0, autoRandomSeed: false }, manager).manager, manager);
  assert.equal(resetParticleEmitterRandom({ seed: 0, autoRandomSeed: false }, null).emitter.seed, 0);
  assert.throws(() => resetParticleEmitterRandom({ seed: 0, autoRandomSeed: true }, null), /entropy/);
  assert.throws(() => seedParticleRandom(-1), /uint32/);
  assert.throws(() => nextParticleRandom([1, 2, 3]), /Incomplete/);
});
test("native random float uses low 23 bits with the inclusive endpoint constant", () => {
  // x=0, y=z=0, w chosen so w^(w>>19) has low23 bits all set.
  const n = nextParticleRandomFloat([0, 0, 0, 0x7ffff0]);
  assert.equal(n.value, 1);
  assert.equal(nextParticleRandomFloat([0, 0, 0, 0]).value, 0);
});
test("a zero time/rate query still advances emission RNG but emits nothing", () => {
  const state = createParticleEmissionState(seedParticleRandom(42)), before = structuredClone(state);
  const result = emitParticleInterval(plan({ rate: 0 }), state, { previousTime: 0, currentTime: 0 });
  assert.equal(result.totalCount, 0); assert.equal(result.state.spacing, 1);
  assert.deepEqual(result.state.random, nextParticleRandom(state.random).state); assert.deepEqual(state, before);
});
test("burst time uses a half-open interval and continuous fractions persist", () => {
  let state = createParticleEmissionState(seedParticleRandom(42));
  const p = plan({ bursts: [{ time: .25, count: 2, cycles: 1, interval: .1, probability: 1 }] });
  const first = emitParticleInterval(p, state, { previousTime: 0, currentTime: .25 });
  assert.equal(first.continuousCount, 2); assert.equal(first.burstCount, 0); assert.equal(first.state.fractionalCount, .5);
  state = first.state;
  const next = emitParticleInterval(p, state, { previousTime: .25, currentTime: .3 });
  assert.equal(next.burstCount, 2); assert.equal(next.continuousCount, 1);
});
test("loop wrap visits beginning bursts before end bursts and keeps one rate draw", () => {
  const state = createParticleEmissionState(seedParticleRandom(0));
  const p = plan({ rate: 0, bursts: [{ time: 0, count: 1, cycles: 1, interval: .1, probability: .5 },
    { time: .95, count: 2, cycles: 1, interval: .1, probability: .5 }] });
  const result = emitParticleInterval(p, state, { previousTime: .9, currentTime: .05 });
  const rate = nextParticleRandomFloat(state.random), start = nextParticleRandomFloat(rate.state), end = nextParticleRandomFloat(start.state);
  assert.deepEqual(result.state.random, end.state);
  assert.equal(result.burstCount, (start.value < .5 ? 1 : 0) + (end.value < .5 ? 2 : 0));
});
test("disabled/full-probability bursts do not consume a probability draw", () => {
  for (const probability of [0, 1]) {
    const state = createParticleEmissionState(seedParticleRandom(1));
    const p = plan({ bursts: [{ time: 0, count: 1, cycles: 1, interval: .1, probability }] });
    const result = emitParticleInterval(p, state, { previousTime: 0, currentTime: .1 });
    assert.deepEqual(result.state.random, nextParticleRandom(state.random).state);
    assert.equal(result.burstCount, probability);
  }
});
test("source cycle crossing emits once per burst record rather than once per missed cycle", () => {
  const p = plan({ rate: 0, bursts: [{ time: 0, count: 2, cycles: 4, interval: .2, probability: 1 }] });
  const result = emitParticleInterval(p, createParticleEmissionState(seedParticleRandom(1)), { previousTime: .1, currentTime: .7 });
  assert.equal(result.totalCount, 2);
});
test("invalid interval/count/state fails before mutating any caller state", () => {
  const state = createParticleEmissionState(seedParticleRandom(42)), before = structuredClone(state);
  assert.throws(() => emitParticleInterval(plan(), state, { previousTime: 0, currentTime: 2 }), /source clock/);
  assert.throws(() => emitParticleInterval(plan(), { ...state, fractionalCount: 1 }, { previousTime: 0, currentTime: .1 }), /accumulation/);
  assert.throws(() => emitParticleInterval(plan({ rate: 1e30 }), state, { previousTime: 0, currentTime: .1 }), /count/);
  assert.throws(() => emitParticleInterval(plan({ bursts: [{ time: 0, count: 1, cycles: 3, interval: 1e-30, probability: 1 }] }), state,
    { previousTime: .1, currentTime: .2 }), /cycle conversion/);
  assert.throws(() => emitParticleInterval(plan({ bursts: [{ time: 0, count: 0x7fffffff, cycles: 1, interval: 1, probability: 1 }] }), state,
    { previousTime: 0, currentTime: .2 }), /burst/);
  assert.deepEqual(state, before);
});
test("clock loops use float32 subtraction and wrap the source uint counter", () => {
  assert.deepEqual(tickParticleSystemClock({ time: .75, loops: 0xffffffff }, .25, { duration: 1, looping: true }), { time: 0, loops: 0 });
  assert.deepEqual(tickParticleSystemClock({ time: .75, loops: 2 }, .5, { duration: 1, looping: false }), { time: 1, loops: 2 });
  assert.throws(() => tickParticleSystemClock({ time: 0, loops: 0 }, 1, { duration: 0, looping: true }), /clock/);
});
test("compiler requires exact engine bodies; parsed modules do not admit full emitters", () => {
  const evidence = controlledEngineEvidence(), engine = compileParticleEmitterEngine([evidence]);
  const definition = compileFieldParticleEmitter("controlled_effect", particleModuleExport(), engine);
  assert.equal(definition.emission.rate, 10); assert.equal(definition.emission.bursts[0]!.count, 1);
  assert.equal(definition.simulation.space, "local"); assert.ok(definition.blockers.some((s) => s.includes("Noise")));
  assert.ok(definition.blockers.some((s) => s.includes("Prewarm")));
  evidence.methods.pop(); assert.throws(() => compileParticleEmitterEngine([evidence]), /kernel body/);
  const bad = controlledEngineEvidence(); assert.throws(() => compileParticleEmitterEngine([{ ...bad, pdb: { ...bad.pdb, age: 2 } }]), /source build/);
});
test("varying rates and counts and wrong simulation-space remain explicit blockers", () => {
  const engine = compileParticleEmitterEngine([controlledEngineEvidence()]);
  for (const key of ["rate", "count", "space"]) {
    const raw = particleModuleExport(), p = raw.objects.find((o) => o.type === "ParticleSystem")!.data;
    const emission = p.EmissionModule as Record<string, unknown>;
    if (key === "rate") emission.rateOverTime = { ...sourceConstant(10), minMaxState: 3, minScalar: 1 };
    if (key === "count") (emission.m_Bursts as Record<string, unknown>[])[0]!.countCurve = { ...sourceConstant(2), minMaxState: 3, minScalar: 1 };
    if (key === "space") p.moveWithTransform = 1;
    assert.throws(() => compileFieldParticleEmitter("controlled_effect", raw, engine), /not admitted|clock\/space/);
  }
});
