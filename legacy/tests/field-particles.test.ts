import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldParticleModules, compileParticleColor, compileParticleCurve } from "../src/compiler/field-particles.js";
import { assertFieldParticleEmitterExecutable, createFieldParticleBirth, evaluateParticleColor, evaluateParticleCurve, evaluateParticleGradient,
  evaluateParticleKeys, sampleFieldParticleAppearance, sampleFieldParticleRates, sampleFieldParticleTexture, shadeFieldParticle,
  type ParticleCurve, type ParticleGradient, type FieldParticleTexture } from "../src/core/field-particles.js";
import { particleMaterial, particleModules, particleModuleExport, particleRandom, sourceConstant, white } from "./fixtures/field-particles.js";

test("curve constants use scalar, and reversed random bounds keep their direction", () => {
  assert.equal(evaluateParticleCurve(compileParticleCurve(sourceConstant(7)), 0.4, 0.5), 7);
  const r = compileParticleCurve({ ...sourceConstant(-2), minMaxState: 3, minScalar: 2 });
  assert.equal(evaluateParticleCurve(r, 0, 0), 2); assert.equal(evaluateParticleCurve(r, 0, 0.75), -1);
  assert.throws(() => evaluateParticleCurve(r, 0, -0.1), /sample/);
});
test("unweighted Hermite honors slopes and preserves endpoint values", () => {
  const k = [{ time: 0, value: 0, inSlope: 0, outSlope: 2 }, { time: 1, value: 1, inSlope: 0, outSlope: 0 }];
  assert.equal(evaluateParticleKeys(k, 0), 0); assert.equal(evaluateParticleKeys(k, 1), 1);
  assert.equal(evaluateParticleKeys(k, 0.5), 0.75);
  assert.throws(() => evaluateParticleKeys(k, 1.01), /infinity/);
  assert.throws(() => evaluateParticleKeys([k[1]!, k[0]!], 0.5), /Unordered/);
});
test("TwoCurves uses one shared curve multiplier, not minScalar as a second multiplier", () => {
  const k = (v: number) => ({ m_PreInfinity: 2, m_PostInfinity: 2, m_Curve: [0, 1].map((time) => ({ time, value: v,
    inSlope: 0, outSlope: 0, weightedMode: 0, inWeight: 0.8, outWeight: 0.2 })) });
  const c = compileParticleCurve({ minMaxState: 2, scalar: 10, minScalar: 999, minCurve: k(0.2), maxCurve: k(0.8) });
  assert.equal(evaluateParticleCurve(c, 0.5, 0.5), 5);
  const bad = k(1); bad.m_Curve[0]!.weightedMode = 1;
  assert.throws(() => compileParticleCurve({ minMaxState: 1, scalar: 1, minScalar: 0, maxCurve: bad }), /Weighted/);
});
test("gradient color/alpha keys are independent and quantized source times survive compilation", () => {
  const g: Record<string, unknown> = { m_Mode: 0, m_NumColorKeys: 2, m_NumAlphaKeys: 3,
    key0: white(), key1: { r: 0, g: 0, b: 1, a: 1 }, key2: { r: 0, g: 0, b: 0, a: 0 },
    ctime0: 6554, ctime1: 65535, atime0: 0, atime1: 39321, atime2: 65535 };
  const c = compileParticleColor({ minMaxState: 1, maxGradient: g });
  assert.deepEqual(evaluateParticleColor(c, 0, 0), white());
  assert.equal(evaluateParticleColor(c, Math.fround(39321 / 65535), 0).a, 1);
  assert.equal(evaluateParticleColor(c, 1, 0).a, 0);
  assert.ok(Math.abs(evaluateParticleColor(c, 0.8, 0).a - 0.5) < 0.000001);
});
test("random-color uses the supplied random channel rather than particle age", () => {
  const g: ParticleGradient = { mode: "blend", colors: [{ time: 0, color: { r: 0, g: 0, b: 0 } }, { time: 1, color: white() }],
    alpha: [{ time: 0, value: 1 }, { time: 1, value: 1 }] };
  assert.equal(evaluateParticleColor({ mode: "random-color", gradient: g }, 0.99, 0.25).r, 0.25);
  assert.deepEqual(evaluateParticleGradient(g, 0.5), { r: 0.5, g: 0.5, b: 0.5, a: 1 });
  assert.throws(() => evaluateParticleGradient({ ...g, mode: "fixed" }, 0.5), /Fixed-gradient/);
});
test("birth/lifetime modules execute without acquiring or consuming an invented RNG", () => {
  const m = particleModules(), draws = particleRandom(), original = structuredClone(draws), b = createFieldParticleBirth(m, 0.2, draws);
  assert.equal(b.lifetime, 3); assert.equal(b.size, 8);
  const a = sampleFieldParticleAppearance(m, b, 0.25);
  assert.equal(a.size, 2); assert.equal(a.color.a, 0.75); assert.deepEqual(draws, original);
  draws.sizeOverLife = 0; assert.equal(b.random.sizeOverLife, 0.5);
  assert.throws(() => createFieldParticleBirth(m, 0.2, { ...original, color: NaN }), /number/);
  assert.throws(() => assertFieldParticleEmitterExecutable(m), /Noise\/RNG\/prewarm/);
});
test("lifetime color multiplies initial RGBA; disabled modules preserve the initial value", () => {
  const m = particleModules(), b = createFieldParticleBirth(m, 0, particleRandom()); b.color = { r: 0.5, g: 0.25, b: 1, a: 0.5 };
  assert.deepEqual(sampleFieldParticleAppearance(m, b, 0.5).color, { r: 0.5, g: 0.25, b: 1, a: 0.25 });
  m.color = null; m.size = null; assert.deepEqual(sampleFieldParticleAppearance(m, b, 0.5), { color: b.color, size: 8 });
});
test("rate projection reads actual speed for RotationBySpeed and never integrates unknown Noise", () => {
  const m = particleModules(), b = createFieldParticleBirth(m, 0, particleRandom());
  const curve: ParticleCurve = { mode: "curve", multiplier: 4, keys: [{ time: 0, value: 0, inSlope: 0, outSlope: 1 }, { time: 1, value: 1, inSlope: 1, outSlope: 0 }] };
  m.rotation = { curve, bySpeed: { min: 2, max: 4 } };
  assert.equal(sampleFieldParticleRates(m, b, 0.1, 3).angularVelocity, 2);
  assert.equal(sampleFieldParticleRates(m, b, 0.9, 10).angularVelocity, 4);
  assert.equal(sampleFieldParticleRates(m, b, 0.3, 0).gravityMultiplier, -0.5);
  assert.throws(() => sampleFieldParticleRates(m, b, 0.3, -1), /Negative/);
});
test("typed source module compiler retains every unavoidable emitter dependency", () => {
  const e = particleModuleExport(), p = compileFieldParticleModules("controlled_effect", e);
  assert.equal(evaluateParticleCurve(p.emission.rate, 0.5, 0), 10);
  assert.equal(evaluateParticleCurve(p.emission.bursts[0]!.count, 0, 0), 1);
  assert.ok(p.blockers.some((x) => x.includes("Noise"))); assert.ok(p.blockers.some((x) => x.includes("prewarm")));
  const b = createFieldParticleBirth(p, 0, particleRandom()); assert.equal(b.lifetime, 3);
  const data = e.objects.find((o) => o.type === "ParticleSystem")!.data;
  data.CollisionModule = { enabled: true }; assert.throws(() => compileFieldParticleModules("controlled_effect", e), /CollisionModule/);
});
test("source module compiler rejects unknown modes instead of dropping nonzero behavior", () => {
  const e = particleModuleExport(), p = e.objects.find((o) => o.type === "ParticleSystem")!.data;
  p.moveWithTransform = 1; assert.throws(() => compileFieldParticleModules("controlled_effect", e), /clock\/space/);
  p.moveWithTransform = 0; (p.EmissionModule as Record<string, unknown>).m_BurstCount = 0;
  assert.throws(() => compileFieldParticleModules("controlled_effect", e), /burst count/);
  assert.throws(() => compileParticleCurve({ ...sourceConstant(1), minMaxState: 9 }), /mode 9/);
});
test("point/linear texture samples preserve bottom-left UV against top-down source pixels", () => {
  const t: FieldParticleTexture = { width: 2, height: 2, rowOrder: "top-to-bottom", colorSpace: "gamma", filter: "point", wrapU: "repeat", wrapV: "clamp",
    rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) };
  assert.deepEqual(sampleFieldParticleTexture(t, 0.1, 0.1), { r: 0, g: 0, b: 1, a: 1 });
  assert.deepEqual(sampleFieldParticleTexture(t, -0.1, 2), { r: 0, g: 1, b: 0, a: 1 });
  t.filter = "linear"; assert.deepEqual(sampleFieldParticleTexture(t, 0.5, 0.5), { r: 0.5, g: 0.5, b: 0.5, a: 1 });
  assert.throws(() => sampleFieldParticleTexture({ ...t, rgba: new Uint8Array(1) }, 0, 0), /texture/);
});
test("source shader uses mask red and main alpha, cutoff before premultiplication", () => {
  const m = particleMaterial(), i = { uv: [0.5, 0.5] as [number, number], color: white(), engineSeconds: 0, elapsedSeconds: 0 };
  const sample = (key: string) => key === "noise" ? { r: 0.5, g: 0.5, b: 0, a: 0 } : key === "mask" ? { r: 0.5, g: 0, b: 0, a: 0 } : white();
  assert.deepEqual(shadeFieldParticle(m, i, sample), { r: 0.5, g: 0.5, b: 0.5, a: 0.5 });
  i.color.a = 0.1; assert.equal(shadeFieldParticle(m, i, sample), null);
  i.color.a = 0.2; assert.notEqual(shadeFieldParticle(m, i, sample), null); // strict lt, equality survives.
});
test("source alpha-edge smoothstep and emission use vertex color, not unused material Color", () => {
  const m = particleMaterial(); m.edge = { min: 0, max: 1, color: { r: 0, g: 0, b: 0, a: 0 } }; m.emission = 1;
  const out = shadeFieldParticle(m, { uv: [0, 0], color: { r: 0.5, g: 1, b: 1, a: 0.5 }, engineSeconds: 0, elapsedSeconds: 0 }, () => white());
  assert.deepEqual(out, { r: 0.25, g: 0.5, b: 0.5, a: 0.5 });
});
test("shader binds global versus owned elapsed time and actual duplicated NOffsetX behavior", () => {
  const m = particleMaterial(); m.noiseOffset = 0.1; m.noiseScale = 0.2; m.flipX = 1;
  const calls: { key: string; u: number; v: number }[] = [];
  const sample = (key: string, u: number, v: number) => { calls.push({ key, u, v }); return key === "noise" ? { r: 0.5, g: 0.5, b: 0, a: 1 } : white(); };
  const input = { uv: [0.25, 0.2] as [number, number], color: white(), engineSeconds: 2, elapsedSeconds: 0 };
  shadeFieldParticle(m, input, sample);
  assert.ok(Math.abs(calls[0]!.u - 1.25) < 1e-6); assert.ok(Math.abs(calls[0]!.v - 0.7) < 1e-6);
  m.builtInTime = 0; calls.length = 0; shadeFieldParticle(m, input, sample);
  assert.ok(Math.abs(calls[0]!.u - 0.85) < 1e-6); assert.ok(Math.abs(calls[0]!.v - 0.3) < 1e-6);
});
