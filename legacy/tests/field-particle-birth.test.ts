import test from "node:test";
import assert from "node:assert/strict";
import { birthParticleBatch, birthPaddedParticleBatch } from "../src/core/field-particle-birth.js";
import { compileFieldParticleBirth, compileParticleBirthEngine } from "../src/compiler/field-particle-birth.js";
import { nextParticleRandomLanes } from "../src/core/field-particle-emitter.js";
import { controlledBirthEvidence, particleBirthDefinition, particleBirthExport, particleBirthInput, particleBirthRandom } from "./fixtures/field-particle-birth.js";

test("Initial/Cone/speed native first lane preserves source float32 values and seed", () => {
  const result = birthParticleBatch(particleBirthDefinition(), particleBirthRandom(), particleBirthInput(1)), p = result.particles[0]!;
  assert.equal(p.seed, 4076870683); assert.equal(p.inverseLifetime, 2.262256383895874);
  assert.deepEqual(p.size, [12.705373764038086, 12.705373764038086, 12.705373764038086]);
  assert.deepEqual(p.rotation, [0, 0, 2.668475866317749]);
  assert.deepEqual(p.position, [1.526625633239746, .00630248012021184, .005288408137857914]);
  assert.deepEqual(p.velocity, [3.0463619232177734, -5.74929141998291, 6.877281188964844]);
  assert.equal(p.packedColor, 0xffffffff); assert.equal(p.normalizedAge, 0);
});
test("one live birth consumes all four SIMD lanes and does not return padding particles", () => {
  const d = particleBirthDefinition(), r = particleBirthRandom(), before = structuredClone(r);
  const one = birthParticleBatch(d, r, particleBirthInput(1)), four = birthParticleBatch(d, r, particleBirthInput(4));
  assert.equal(one.paddedCount, 4); assert.equal(one.particles.length, 1); assert.deepEqual(one.random, four.random);
  assert.deepEqual(one.particles[0], four.particles[0]); assert.deepEqual(r, before);
});
test("padded birth API exposes all source lanes only with explicit complete timing", () => {
  const d = particleBirthDefinition(), r = particleBirthRandom(), input = particleBirthInput(1);
  const padded = { ...input, paddedBirthDeltas: [.01, .02, .03, .04], paddedBirthNormalizedTimes: [.5, .49, .48, .47] };
  const result = birthPaddedParticleBatch(d, r, padded), live = birthParticleBatch(d, r, input);
  assert.deepEqual(result.particles, live.particles); assert.deepEqual(result.random, live.random);
  assert.equal(result.paddedParticles.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(result.paddedParticles[i]!.birthDelta, Math.fround(padded.paddedBirthDeltas[i]!));
    assert.equal(result.paddedParticles[i]!.normalizedEmitterTime, Math.fround(padded.paddedBirthNormalizedTimes[i]!));
  }
  result.paddedParticles[0]!.position[0] = 99;
  assert.notEqual(result.particles[0]!.position[0], 99);
});
test("missing padding timing or a mismatched live prefix cannot consume random state", () => {
  const d = particleBirthDefinition(), r = particleBirthRandom(), before = structuredClone(r), input = particleBirthInput(1);
  assert.throws(() => birthPaddedParticleBatch(d, r, { ...input, paddedBirthDeltas: [.01], paddedBirthNormalizedTimes: [.5] }), /Incomplete/);
  assert.throws(() => birthPaddedParticleBatch(d, r, { ...input, paddedBirthDeltas: [.02, 0, 0, 0], paddedBirthNormalizedTimes: [.5, .5, .5, .5] }), /mismatched/);
  assert.throws(() => birthPaddedParticleBatch(d, r, { ...input, paddedBirthDeltas: [.01, 0, 0, NaN], paddedBirthNormalizedTimes: [.5, .5, .5, .5] }), /Invalid/);
  assert.deepEqual(r, before);
});
test("each batch restarts lane indexing and preserves native padded draw sequence", () => {
  const d = particleBirthDefinition(), r = particleBirthRandom();
  const batch = birthParticleBatch(d, r, particleBirthInput(5));
  const first = birthParticleBatch(d, r, particleBirthInput(4));
  const second = birthParticleBatch(d, first.random, { ...particleBirthInput(1), startIndex: 4 });
  assert.equal(batch.paddedCount, 8); assert.equal(second.particles[0]!.seed, batch.particles[4]!.seed);
  assert.deepEqual(batch.random, second.random);
  // Replacing a native five-particle batch by five singleton emissions is a
  // different scheduling operation: it must consume five SIMD blocks.
  let singleton = r;
  for (let i = 0; i < 5; i++) singleton = birthParticleBatch(d, singleton, particleBirthInput(1)).random;
  assert.notDeepEqual(singleton, batch.random);
});
test("constant initial curves still consume lifetime/size/rotation/color draws", () => {
  const d = particleBirthDefinition();
  d.initial.lifetime = { mode: "constant", value: 2 }; d.initial.size = { mode: "constant", value: 5 };
  d.initial.rotation = { mode: "constant", value: 0 }; d.initial.speed = { mode: "constant", value: 0 };
  const r = particleBirthRandom(), result = birthParticleBatch(d, r, particleBirthInput(3));
  let initial = r.initial, shape = r.shape;
  for (let i = 0; i < 5; i++) initial = nextParticleRandomLanes(initial, i !== 0).state;
  for (let i = 0; i < 2; i++) shape = nextParticleRandomLanes(shape, true).state;
  assert.deepEqual(result.random, { initial, shape });
  for (const p of result.particles) { assert.equal(p.lifetime, 2); assert.deepEqual(p.velocity.map(Math.abs), [0, 0, 0]); }
});
test("birth timing is explicit and retained without premature motion integration", () => {
  const input = particleBirthInput(3), result = birthParticleBatch(particleBirthDefinition(), particleBirthRandom(), input);
  const zero = birthParticleBatch(particleBirthDefinition(), particleBirthRandom(), { ...input, birthDeltas: [0, 0, 0] });
  result.particles.forEach((p, i) => {
    assert.equal(p.birthDelta, Math.fround(input.birthDeltas[i]!)); assert.equal(p.normalizedEmitterTime, Math.fround(input.birthNormalizedTimes[i]!));
    assert.deepEqual(p.position, zero.particles[i]!.position); assert.equal(p.normalizedAge, 0);
  });
});
test("zero accepted births consume no random state and final capacity padding is explicit", () => {
  const d = particleBirthDefinition(), r = particleBirthRandom();
  const zero = birthParticleBatch(d, r, particleBirthInput(0)); assert.deepEqual(zero, { particles: [], paddedCount: 0, random: r });
  // old logical count 999 yields aligned start 1000, then compacts back to999.
  const last = birthParticleBatch(d, r, { ...particleBirthInput(1), startIndex: 1000 });
  assert.equal(last.particles[0]!.index, 1000); assert.equal(last.paddedCount, 4);
});
test("initial lifetime/size clamps and Color32 quantization have explicit semantics", () => {
  const d = particleBirthDefinition(); d.initial.lifetime = { mode: "constant", value: -2 }; d.initial.size = { mode: "constant", value: -1 };
  d.initial.color = [-1, .5, 1.5, .25];
  const p = birthParticleBatch(d, particleBirthRandom(), particleBirthInput(1)).particles[0]!;
  assert.equal(p.lifetime, Math.fround(.00001)); assert.deepEqual(p.size, [0, 0, 0]); assert.equal(p.packedColor, 0x40ff8000);
});
test("invalid timing/scale/index/random input fails without consuming caller state", () => {
  const d = particleBirthDefinition(), r = particleBirthRandom(), before = structuredClone(r), i = particleBirthInput(1);
  for (const input of [{ ...i, startIndex: 1 }, { ...i, count: 2 }, { ...i, birthDeltas: [-.1] }, { ...i, birthNormalizedTimes: [1.1] },
    { ...i, simulationScale: [2, 1, 1] as [number, number, number] }, { ...i, normalizedEmitterTime: NaN }])
    assert.throws(() => birthParticleBatch(d, r, input), /Invalid|not admitted/);
  assert.throws(() => birthParticleBatch(d, { ...r, shape: [] as never }, i), /Incomplete/); assert.deepEqual(r, before);
});
test("compiler rejects missing or different engine identities and native bodies", () => {
  const e = controlledBirthEvidence(); e.methods.pop(); assert.throws(() => compileParticleBirthEngine([e]), /body/);
  const bad = controlledBirthEvidence(); assert.throws(() => compileParticleBirthEngine([{ ...bad, pdb: { ...bad.pdb, age: 2 } }]), /source build/);
  assert.throws(() => compileParticleBirthEngine([bad, { ...bad, methods: [{ rva: bad.methods[0]!.rva, sha256: "0".repeat(64) }] }]), /Conflicting/);
});
test("compiler does not silently admit alternate shape, texture, randomization or 3D branches", () => {
  const engine = compileParticleBirthEngine([controlledBirthEvidence()]);
  const mutate = (fn: (p: Record<string, unknown>) => void) => {
    const raw = particleBirthExport(), p = raw.objects.find((o) => o.type === "ParticleSystem")!.data;
    fn(p); assert.throws(() => compileFieldParticleBirth("controlled_effect", raw, engine));
  };
  mutate((p) => { (p.ShapeModule as Record<string, unknown>).type = 8; });
  mutate((p) => { (p.ShapeModule as Record<string, unknown>).radiusThickness = .5; });
  mutate((p) => { (p.ShapeModule as Record<string, unknown>).randomDirectionAmount = .1; });
  mutate((p) => { ((p.ShapeModule as Record<string, unknown>).arc as Record<string, unknown>).mode = 1; });
  mutate((p) => { ((p.ShapeModule as Record<string, unknown>).m_Position as Record<string, unknown>).x = 1; });
  mutate((p) => { (p.ShapeModule as Record<string, unknown>).m_Texture = { m_FileID: 0, m_PathID: "99" }; });
  mutate((p) => { (p.InitialModule as Record<string, unknown>).size3D = true; });
  mutate((p) => { ((p.InitialModule as Record<string, unknown>).startColor as Record<string, unknown>).minMaxState = 2; });
});
