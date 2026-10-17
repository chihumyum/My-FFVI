import test from "node:test";
import assert from "node:assert/strict";
import { advanceParticleNoiseScroll, evaluateParticleMotionKeys, integrateParticleBirthMotion, integrateParticleMotion, particleNoiseSeedOffset,
  prepareParticleMotionRates, sampleParticleAngularVelocity, sampleParticleNoise, sampleParticlePerlinDerivative, validateParticleNoiseKernel } from "../src/core/field-particle-motion.js";
import { assertParticleMotionEvidence, compileFieldParticleMotion, compileParticleGravity, compileParticleMotionKernel, PARTICLE_MOTION_TABLES } from "../src/compiler/field-particle-motion.js";
import { controlledMotionEvidence, controlledNoiseKernel, particleGravityExport, particleMotionDefinition, particleMotionExport, particleMotionSpace, particleMotionState } from "./fixtures/field-particle-motion.js";
import { sourceConstant } from "./fixtures/field-particles.js";
const f = Math.fround;

test("Noise uses deterministic seed-derived offsets and never advances an owner RNG", () => {
  assert.deepEqual(particleNoiseSeedOffset(42), particleNoiseSeedOffset(42));
  assert.notDeepEqual(particleNoiseSeedOffset(42), particleNoiseSeedOffset(43));
  assert.throws(() => particleNoiseSeedOffset(-1), /seed/);
  const kernel = controlledNoiseKernel(), prior = structuredClone(kernel), definition = particleMotionDefinition();
  const a = sampleParticleNoise(kernel, definition.noise, { position: { x: .2, y: -.3, z: 10 }, systemSeed: 42, scroll: .1 });
  assert.deepEqual(a, sampleParticleNoise(kernel, definition.noise, { position: { x: .2, y: -.3, z: 10 }, systemSeed: 42, scroll: .1 }));
  assert.deepEqual(kernel, prior);
});
test("negative Noise coordinates use floor cells and the duplicated permutation remains periodic", () => {
  const k = controlledNoiseKernel(), p = { x: -.25, y: -1.5, z: -7.75 };
  assert.deepEqual(sampleParticlePerlinDerivative(k, p, 1), sampleParticlePerlinDerivative(k, { x: 255.75, y: 254.5, z: 248.25 }, 1));
  assert.notDeepEqual(sampleParticlePerlinDerivative(k, p, 1), sampleParticlePerlinDerivative(k, { x: .25, y: 1.5, z: 7.75 }, 1));
  assert.throws(() => sampleParticlePerlinDerivative(k, { x: 2 ** 31, y: 0, z: 0 }, 1), /overflow/);
});
test("unbound or corrupted Noise lookup tables fail instead of substituting host noise", () => {
  const k = controlledNoiseKernel(); k.permutation[256] = 1;
  assert.throws(() => validateParticleNoiseKernel(k), /permutation/);
  const bad = controlledNoiseKernel(); bad.gradients.pop(); assert.throws(() => validateParticleNoiseKernel(bad), /kernel/);
  assert.throws(() => compileParticleMotionKernel([controlledMotionEvidence()], { kind: "unity-particle-motion-instruction-probes-v1", kernel: {} }), /Unbound/);
});
test("a table cannot self-attest the expected source hash with different bytes", () => {
  const k = controlledNoiseKernel();
  assert.throws(() => compileParticleMotionKernel([controlledMotionEvidence()], {
    kind: "unity-particle-motion-instruction-probes-v1", nativeSha256: k.nativeSha256, semanticsVerified: false,
    kernel: { permutation: { ...PARTICLE_MOTION_TABLES.permutation, values: k.permutation },
      gradients: { ...PARTICLE_MOTION_TABLES.gradients, values: k.gradients.flatMap((g) => [g.x, g.y, g.z]) },
      maskInitializer: { ...PARTICLE_MOTION_TABLES.maskInitializer, values: [0] }, mask: [255, 255, 255, 255] },
  }), /Changed source/);
});
test("scroll advances once at system update and is frozen during per-birth module calls", () => {
  let scroll = 0; for (let i = 0; i < 3; i++) scroll = advanceParticleNoiseScroll(scroll, .1, .02, true, 4);
  assert.equal(scroll, f(f(f(.1) * f(.02)) + f(f(f(.1) * f(.02)) + f(f(.1) * f(.02)))));
  assert.equal(advanceParticleNoiseScroll(scroll, .1, .9, false, 4), scroll);
  assert.equal(advanceParticleNoiseScroll(scroll, .1, .9, true, 0), scroll);
  assert.throws(() => advanceParticleNoiseScroll(scroll, .1, -.1, true, 4), /clock/);
});
test("rotation salts distinguish ordinary and by-speed modules without integrating twice", () => {
  const input = { seed: 42, min: 1, max: -1, bySpeed: false, randomizeDirection: 0, prior: 0 };
  const rate = sampleParticleAngularVelocity(input);
  assert.notEqual(rate, sampleParticleAngularVelocity({ ...input, bySpeed: true }));
  assert.equal(sampleParticleAngularVelocity({ ...input, prior: .25 }), f(rate + f(.25)));
  assert.equal(sampleParticleAngularVelocity({ ...input, randomizeDirection: 1 }), -rate);
});
test("source curve infinity code 2 clamps at its last key even when age continues", () => {
  const keys = [{ time: 0, value: 2, inSlope: 0, outSlope: -10 }, { time: .2, value: 0, inSlope: -10, outSlope: 0 }];
  assert.equal(evaluateParticleMotionKeys(keys, -1), 2); assert.equal(evaluateParticleMotionKeys(keys, .1), 1);
  assert.equal(evaluateParticleMotionKeys(keys, .2), 0); assert.equal(evaluateParticleMotionKeys(keys, .9), 0);
  assert.throws(() => evaluateParticleMotionKeys([...keys].reverse(), .1), /Unordered/);
});
test("rate preparation clears old animated velocity and transforms world gravity once", () => {
  const d = particleMotionDefinition(), before = particleMotionState(), original = structuredClone(before);
  const space = particleMotionSpace(); space.worldToLocal = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  const a = prepareParticleMotionRates(d, before, { deltaSeconds: .02, systemSeed: 42, noiseScroll: 0, space });
  const b = prepareParticleMotionRates(d, { ...before, animatedVelocity: { x: 999, y: 888, z: 777 }, angularVelocityZ: 333 }, { deltaSeconds: .02, systemSeed: 42, noiseScroll: 0, space });
  assert.deepEqual(a, b); assert.equal(a.velocity.y, before.velocity.y); assert.ok(a.velocity.z > before.velocity.z);
  assert.deepEqual(before, original); assert.equal(a.agePercent, 0); assert.deepEqual(a.position, { x: .25, y: -.5, z: 1 });
});
test("the supplied local gravity matrix is required; no implicit identity or world-Y shortcut", () => {
  const prior = particleMotionState(), original = structuredClone(prior), d = particleMotionDefinition();
  assert.throws(() => prepareParticleMotionRates(d, prior, { deltaSeconds: .02, systemSeed: 42, noiseScroll: 0, space: { gravity: { x: 0, y: -9.81, z: 0 } } as ReturnType<typeof particleMotionSpace> }), /transform/);
  d.noise.frequency = 1;
  assert.throws(() => prepareParticleMotionRates(d, prior, { deltaSeconds: .02, systemSeed: 42, noiseScroll: 0, space: particleMotionSpace() }), /Noise/);
  assert.deepEqual(prior, original);
});
test("ordinary lifespan retains exactly 100 and expires only above 100", () => {
  const p = particleMotionState(); p.agePercent = 99; p.inverseLifetime = 1;
  const atBoundary = integrateParticleMotion(p, .01); assert.equal(atBoundary.state.agePercent, 100); assert.equal(atBoundary.expired, false);
  const expired = integrateParticleMotion(atBoundary.state, .01);
  assert.equal(expired.state.agePercent, 100.00000762939453); assert.equal(expired.expired, true);
  assert.equal(expired.state.rotationZ, atBoundary.state.rotationZ); assert.notDeepEqual(expired.state.position, atBoundary.state.position);
});
test("existing integration consumes supplied rates and returns a new state without owner publication", () => {
  const p = particleMotionState(), before = structuredClone(p), next = integrateParticleMotion(p, .1);
  assert.equal(next.state.position.x, f(f(f(4 + 1) * f(.1)) + f(.25)));
  assert.equal(next.state.rotationZ, f(f(.2) + f(f(.1) * f(.5)))); assert.deepEqual(p, before);
  next.state.position.x = 999; assert.deepEqual(p, before);
});
test("newborns use their own delta and rotate before deletion, rejecting moving emitter guesses", () => {
  const p = particleMotionState(); p.inverseLifetime = 1000;
  const input = { birthDelta: .01, emitterMotion: { x: 0, y: 0, z: 0 } };
  const result = integrateParticleBirthMotion(p, input);
  assert.equal(result.expired, true); assert.equal(result.state.rotationZ, f(f(.2) + f(f(.01) * f(.5))));
  assert.throws(() => integrateParticleBirthMotion(p, { ...input, emitterMotion: { x: 1, y: 0, z: 0 } }), /Moving/);
  assert.throws(() => integrateParticleBirthMotion({ ...p, agePercent: 1 }, input), /newborn/);
});
test("small source birth deltas are retained without an invented zero threshold", () => {
  const p = particleMotionState(); p.position = { x: 0, y: 0, z: 0 }; p.rotationZ = 0;
  const delta = f(f(.03) * f(.000001));
  const result = integrateParticleBirthMotion(p, { birthDelta: delta, emitterMotion: { x: 0, y: 0, z: 0 } });
  assert.ok(result.state.agePercent > 0); assert.ok(result.state.position.x > 0); assert.ok(result.state.rotationZ > 0);
});
test("invalid or overflowing floats cannot enter the candidate particle state", () => {
  for (const delta of [-.01, NaN, Infinity]) assert.throws(() => integrateParticleMotion(particleMotionState(), delta));
  const p = particleMotionState(); p.velocity.x = 3e38;
  assert.throws(() => integrateParticleMotion(p, 2), /float/);
  assert.throws(() => integrateParticleMotion({ ...particleMotionState(), inverseLifetime: 0 }, .1), /state/);
});
test("motion compilation preserves explicit source features and rejects unrecovered Noise or velocity branches", () => {
  const raw = particleMotionExport(), d = compileFieldParticleMotion("controlled_effect", raw, controlledNoiseKernel());
  assert.equal(d.noise.frequency, f(.32)); assert.equal(d.rotation.max, -1);
  const p = raw.objects.find((o) => o.type === "ParticleSystem")!.data, noise = p.NoiseModule as Record<string, unknown>;
  for (const [key, value] of [["octaves", 2], ["quality", 1], ["separateAxes", true], ["remapEnabled", true]] as const) {
    const old = noise[key]; noise[key] = value; assert.throws(() => compileFieldParticleMotion("controlled_effect", raw, controlledNoiseKernel()), /Noise/); noise[key] = old;
  }
  p.ForceModule = { enabled: true }; assert.throws(() => compileFieldParticleMotion("controlled_effect", raw, controlledNoiseKernel()), /module/);
});
test("one long velocity curve selects the slow path for every axis; optimized-only inputs remain gated", () => {
  const raw = particleMotionExport(), p = raw.objects.find((o) => o.type === "ParticleSystem")!.data;
  const keys = (count: number) => ({ m_PreInfinity: 2, m_PostInfinity: 2, m_Curve: Array.from({ length: count }, (_, i) => ({
    time: i / (count - 1), value: i % 2, inSlope: 0, outSlope: 0, weightedMode: 0, inWeight: 0, outWeight: 0 })) });
  const curve = (count: number) => ({ minMaxState: 2, scalar: 2, minScalar: -99, minCurve: keys(count), maxCurve: keys(count) });
  const v = { enabled: true, inWorldSpace: false, x: curve(2), y: curve(2), z: curve(2),
    orbitalX: sourceConstant(0), orbitalY: sourceConstant(0), orbitalZ: sourceConstant(0), orbitalOffsetX: sourceConstant(0),
    orbitalOffsetY: sourceConstant(0), orbitalOffsetZ: sourceConstant(0), radial: sourceConstant(0), speedModifier: sourceConstant(1) };
  p.VelocityModule = v;
  assert.throws(() => compileFieldParticleMotion("controlled_effect", raw, controlledNoiseKernel()), /optimized velocity/);
  v.x = curve(4); assert.ok(compileFieldParticleMotion("controlled_effect", raw, controlledNoiseKernel()).velocity);
});
test("native motion qualification rejects a missing consumer or conflicting code receipt", () => {
  const e = controlledMotionEvidence(); assertParticleMotionEvidence([e]); e.methods.pop();
  assert.throws(() => assertParticleMotionEvidence([e]), /body/);
  const other = controlledMotionEvidence(); other.methods[0]!.sha256 = "0".repeat(64);
  assert.throws(() => assertParticleMotionEvidence([controlledMotionEvidence(), other]), /Conflicting/);
});
test("gravity comes from the exact 3D PhysicsManager, never Physics2D or a host default", () => {
  assert.deepEqual(compileParticleGravity(particleGravityExport()).gravity, particleMotionSpace().gravity);
  const raw = particleGravityExport(); raw.physicsManager.source.objectId = "15";
  assert.throws(() => compileParticleGravity(raw), /identity/);
  const altered = particleGravityExport(); altered.physicsManager.gravity.y = -10; assert.throws(() => compileParticleGravity(altered), /changed/);
});
