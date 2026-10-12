import type { Evidence } from "../field/types.js";
import type { ParticleVector, ParticleCurve, ParticleKey } from "./field-particles.js";
import { seedParticleRandom, nextParticleRandomFloat } from "./field-particle-emitter.js";

/** Tables are source data extracted from the bound engine image, not a host RNG. */
export type ParticleNoiseKernel = {
  kind: "unity-particle-noise-kernel-v1";
  nativeSha256: string;
  permutation: number[];
  gradients: ParticleVector[];
  indexMask: 255;
};
export type FieldParticleMotionDefinition = {
  kind: "unity-field-particle-motion-v1";
  source: Evidence;
  kernel: ParticleNoiseKernel;
  noise: { frequency: number; damping: boolean; inverseFrequency: number; strength: 1; positionAmount: 1; scrollSpeed: number };
  velocity: { x: ParticleCurve; y: ParticleCurve; z: ParticleCurve } | null;
  rotation: { min: number; max: number; bySpeed: boolean; randomizeDirection: 0 };
  gravityMultiplier: number;
};
const f = Math.fround;
const add = (a: number, b: number) => f(a + b), sub = (a: number, b: number) => f(a - b), mul = (a: number, b: number) => f(a * b);
function finite(v: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isFinite(f(v))) throw new Error("Invalid native particle motion float");
  return f(v);
}
function vector(v: ParticleVector): ParticleVector {
  if (!v) throw new Error("Missing native particle motion vector");
  return { x: finite(v.x), y: finite(v.y), z: finite(v.z) };
}
function uint(v: number): number {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error("Invalid native particle motion seed");
  return v;
}
export function validateParticleNoiseKernel(k: ParticleNoiseKernel): void {
  if (!k || k.kind !== "unity-particle-noise-kernel-v1" || !/^[0-9a-f]{64}$/.test(k.nativeSha256) || k.indexMask !== 255 ||
      !Array.isArray(k.permutation) || k.permutation.length !== 512 || !Array.isArray(k.gradients) || k.gradients.length !== 16)
    throw new Error("Incomplete native Noise kernel");
  k.permutation.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0 || v > 255 || (i >= 256 && v !== k.permutation[i - 256])) throw new Error("Invalid native Noise permutation");
  });
  if (new Set(k.permutation.slice(0, 256)).size !== 256) throw new Error("Invalid native Noise permutation");
  k.gradients.forEach(vector);
}
/** Expanded source polynomial, with the SSE add/multiply sequence preserved.
 * Algebraically equivalent nested lerps can produce different float32 results. */
function cross2(a: number, b: number, c: number, d: number): number { return add(sub(sub(d, c), b), a); }
function cross3(a: number, b: number, c: number, d: number, e: number, g: number, h: number, i: number): number {
  return sub(add(add(sub(add(sub(sub(i, h), g), e), d), c), b), a);
}
function interpolate(v: readonly number[], u: number, t: number, w: number): number {
  const [a, b, c, d, e, g, h, i] = v as [number, number, number, number, number, number, number, number];
  const xyz = cross3(a, b, c, d, e, g, h, i);
  const yz = cross2(a, c, e, h), xz = cross2(a, b, e, g), xy = cross2(a, b, c, d);
  const first = add(mul(add(mul(u, xyz), yz), t), add(mul(u, xz), sub(e, a)));
  const bottom = add(mul(add(mul(u, xy), sub(c, a)), t), add(mul(u, sub(b, a)), a));
  return add(mul(first, w), bottom);
}
function fade(x: number): number { return mul(mul(mul(x, x), x), add(mul(add(mul(x, 6), -15), x), 10)); }
/** Perlin3D returns derivatives with respect to x and y, not a noise amplitude. */
export function sampleParticlePerlinDerivative(kernel: ParticleNoiseKernel, input: ParticleVector, frequency: number): { x: number; y: number } {
  validateParticleNoiseKernel(kernel); const p = vector(input), freq = finite(frequency);
  const values = [mul(p.x, freq), mul(p.y, freq), mul(p.z, freq)];
  if (values.some((v) => v <= -0x80000000 || v >= 0x80000000)) throw new Error("Native Noise coordinate conversion overflow");
  const cells = values.map((v) => Math.floor(v)), [x, y, z] = values.map((v, i) => sub(v, cells[i]!)) as [number, number, number];
  const [ix, iy, iz] = cells.map((v) => v & kernel.indexMask) as [number, number, number];
  const perm = kernel.permutation, a = perm[ix]! + iy, b = perm[ix + 1]! + iy;
  const aa = perm[a]! + iz, ab = perm[a + 1]! + iz, ba = perm[b]! + iz, bb = perm[b + 1]! + iz;
  const indices = [aa, ba, ab, bb, aa + 1, ba + 1, ab + 1, bb + 1];
  const gradients = indices.map((n) => kernel.gradients[perm[n]! & 15]!);
  const dots = gradients.map((g, i) => add(add(mul(g.z, sub(z, i >> 2)), mul(g.y, sub(y, (i >> 1) & 1))), mul(g.x, sub(x, i & 1))));
  const [d0, d1, d2, d3, d4, d5, d6, d7] = dots as [number, number, number, number, number, number, number, number];
  const u = fade(x), v = fade(y), w = fade(z), xy = cross2(d0, d1, d2, d3), xyz = cross3(d0, d1, d2, d3, d4, d5, d6, d7);
  const tx = add(mul(w, add(mul(xyz, v), cross2(d0, d1, d4, d5))), add(mul(xy, v), sub(d1, d0)));
  const ty = add(mul(w, add(mul(u, xyz), cross2(d0, d2, d4, d6))), add(mul(u, xy), sub(d2, d0)));
  const dx = add(mul(tx, mul(mul(mul(x, 30), x), add(mul(x, sub(x, 2)), 1))), interpolate(gradients.map((g) => g.x), u, v, w));
  const dy = add(mul(ty, mul(mul(mul(y, 30), y), add(mul(y, sub(y, 2)), 1))), interpolate(gradients.map((g) => g.y), u, v, w));
  return { x: mul(freq, dx), y: mul(dy, freq) };
}
/** Noise wrapper hashes the system seed afresh. It does not advance Initial,
 * Shape or Emission RNG streams, nor obtain fresh per-frame random numbers. */
export function particleNoiseSeedOffset(seed: number): ParticleVector {
  let state = seedParticleRandom(uint(seed)); const values: number[] = [];
  for (let i = 0; i < 3; i++) { const next = nextParticleRandomFloat(state); state = next.state; values.push(mul(next.value, 100)); }
  return { x: values[0]!, y: values[1]!, z: values[2]! };
}
export function advanceParticleNoiseScroll(previous: number, speed: number, deltaSeconds: number, advance: boolean, particleCount: number): number {
  previous = finite(previous); speed = finite(speed); const dt = finite(deltaSeconds);
  if (dt < 0 || typeof advance !== "boolean" || !Number.isSafeInteger(particleCount) || particleCount < 0 || particleCount > 0x7fffffff) throw new Error("Invalid native Noise clock");
  // PreSimulation calls no per-particle module when startIndex == endIndex.
  return advance && particleCount > 0 ? finite(add(mul(speed, dt), previous)) : previous;
}
/** Single-octave, non-separated, no-remap source subset used by all five
 * selected emitters. The caller stores scroll once per module update. */
export function sampleParticleNoise(kernel: ParticleNoiseKernel, config: FieldParticleMotionDefinition["noise"], input: {
  position: ParticleVector; systemSeed: number; scroll: number;
}): ParticleVector {
  if (f(config.frequency) !== f(.32) || f(config.inverseFrequency) !== 3.125 || config.strength !== 1 || config.positionAmount !== 1 || typeof config.damping !== "boolean")
    throw new Error("Unadmitted native Noise frequency/strength path");
  const offset = particleNoiseSeedOffset(input.systemSeed), p = vector(input.position), scroll = finite(input.scroll);
  let x = add(p.x, offset.x); const y = add(offset.y, p.y), z = add(offset.z, p.z);
  const a = sampleParticlePerlinDerivative(kernel, { x: z, y, z: add(scroll, x) }, config.frequency);
  x = add(x, 100);
  const b = sampleParticlePerlinDerivative(kernel, { x, y: z, z: add(y, scroll) }, config.frequency);
  const c = sampleParticlePerlinDerivative(kernel, { x: y, y: x, z: add(z, scroll) }, config.frequency);
  const scale = config.damping ? config.inverseFrequency : 1;
  return { x: mul(sub(c.x, b.y), scale), y: mul(sub(a.x, c.y), scale), z: mul(scale, sub(b.x, a.y)) };
}
/** Source RotationModule and RotationBySpeed two-constant leaves generate
 * angular velocity. The direction sample is independent and seed-derived. */
export function sampleParticleAngularVelocity(input: {
  seed: number; min: number; max: number; bySpeed: boolean; randomizeDirection: number; prior: number;
}): number {
  const seed = uint(input.seed), min = finite(input.min), max = finite(input.max), threshold = finite(input.randomizeDirection), prior = finite(input.prior);
  if (threshold < 0 || threshold > 1 || typeof input.bySpeed !== "boolean") throw new Error("Unsupported native rotation direction");
  const sample = nextParticleRandomFloat(seedParticleRandom((seed + (input.bySpeed ? 3737431713 : 1793934638)) >>> 0)).value;
  const direction = nextParticleRandomFloat(seedParticleRandom((seed + 4281053604) >>> 0)).value;
  return add(mul(threshold < direction ? 1 : -1, add(mul(sub(max, min), sample), min)), prior);
}

/** The source slow AnimationCurve cache uses coefficients in seconds rather
 * than a normalized Hermite basis. Infinity code 2 clamps to the endpoint. */
export function evaluateParticleMotionKeys(keys: readonly ParticleKey[], time: number): number {
  time = finite(time);
  if (!Array.isArray(keys) || !keys.length) throw new Error("Missing native motion curve keys");
  keys.forEach((key, i) => {
    [key.time, key.value, key.inSlope, key.outSlope].forEach(finite);
    if (i && f(key.time) <= f(keys[i - 1]!.time)) throw new Error("Unordered native motion curve");
  });
  const first = keys[0]!, last = keys.at(-1)!;
  if (time < f(first.time)) return f(first.value);
  if (time >= f(last.time)) return f(last.value);
  const next = keys.findIndex((key) => f(key.time) > time), a = keys[next - 1]!, b = keys[next]!;
  const dt = Math.max(f(.0001), sub(b.time, a.time)), dv = sub(b.value, a.value), out = mul(dt, a.outSlope), incoming = mul(dt, b.inSlope);
  const inverseSquare = f(1 / mul(dt, dt));
  const cubic = f(mul(sub(sub(add(incoming, out), dv), dv), inverseSquare) / dt);
  const quadratic = mul(sub(sub(sub(add(add(dv, dv), dv), out), out), incoming), inverseSquare);
  const t = sub(time, a.time);
  return add(mul(add(mul(add(mul(t, cubic), quadratic), t), a.outSlope), t), a.value);
}
/** MinMaxCurve::EvaluateSlow scales each curve before mixing them. */
export function evaluateParticleMotionCurve(curve: ParticleCurve, time: number, sample: number): number {
  finite(time); sample = finite(sample);
  if (sample < 0 || sample > 1) throw new Error("Native motion curve sample outside [0,1]");
  switch (curve.mode) {
    case "constant": return finite(curve.value);
    case "two-constants": return add(mul(sub(finite(curve.max), finite(curve.min)), sample), curve.min);
    case "curve": return mul(evaluateParticleMotionKeys(curve.keys, time), finite(curve.multiplier));
    case "two-curves": {
      const min = mul(evaluateParticleMotionKeys(curve.min, time), finite(curve.multiplier));
      const max = mul(evaluateParticleMotionKeys(curve.max, time), curve.multiplier);
      return add(mul(sub(max, min), sample), min);
    }
    default: throw new Error("Unknown native motion curve");
  }
}
export function sampleParticleAnimatedVelocity(definition: NonNullable<FieldParticleMotionDefinition["velocity"]>, seed: number, agePercent: number): ParticleVector {
  let random = seedParticleRandom((uint(seed) + 3774601268) >>> 0); const t = mul(finite(agePercent), f(.01));
  const values = [definition.x, definition.y, definition.z].map((curve) => {
    const sample = nextParticleRandomFloat(random); random = sample.state;
    return evaluateParticleMotionCurve(curve, t, sample.value);
  });
  return { x: values[0]!, y: values[1]!, z: values[2]! };
}
export type ParticleMotionState = {
  seed: number;
  /** Source percentage, with death strictly after 100 for ordinary ring mode. */
  agePercent: number;
  inverseLifetime: number;
  position: ParticleVector;
  velocity: ParticleVector;
  animatedVelocity: ParticleVector;
  rotationZ: number;
  angularVelocityZ: number;
};
export type ParticleMotionSpace = {
  gravity: ParticleVector;
  /** Source inverse emitter transform linear columns; translation is excluded. */
  worldToLocal: [number, number, number, number, number, number, number, number, number];
};
function state(input: Readonly<ParticleMotionState>): ParticleMotionState {
  if (!input || finite(input.agePercent) < 0 || finite(input.agePercent) > f(100.00000762939453) || finite(input.inverseLifetime) <= 0)
    throw new Error("Invalid native particle motion state");
  return { seed: uint(input.seed), agePercent: finite(input.agePercent), inverseLifetime: finite(input.inverseLifetime),
    position: vector(input.position), velocity: vector(input.velocity), animatedVelocity: vector(input.animatedVelocity),
    rotationZ: finite(input.rotationZ), angularVelocityZ: finite(input.angularVelocityZ) };
}
function matrix(input: readonly number[]): readonly number[] {
  if (!Array.isArray(input) || input.length !== 9) throw new Error("Missing native particle motion transform");
  return input.map(finite);
}
export function validateFieldParticleMotion(definition: FieldParticleMotionDefinition): void {
  if (!definition || definition.kind !== "unity-field-particle-motion-v1") throw new Error("Unknown native particle motion definition");
  validateParticleNoiseKernel(definition.kernel);
  const n = definition.noise;
  if (!n || finite(n.frequency) !== f(.32) || n.inverseFrequency !== 3.125 || n.strength !== 1 || n.positionAmount !== 1 || typeof n.damping !== "boolean")
    throw new Error("Unadmitted native Noise frequency/strength path");
  finite(n.scrollSpeed); finite(definition.gravityMultiplier);
  if (!definition.rotation || typeof definition.rotation.bySpeed !== "boolean" || definition.rotation.randomizeDirection !== 0)
    throw new Error("Unadmitted native particle rotation path");
  finite(definition.rotation.min); finite(definition.rotation.max);
  if (definition.velocity !== null) for (const curve of [definition.velocity.x, definition.velocity.y, definition.velocity.z]) {
    if (!curve || curve.mode !== "two-curves") throw new Error("Unadmitted native particle velocity path");
    finite(curve.multiplier); evaluateParticleMotionKeys(curve.min, 0); evaluateParticleMotionKeys(curve.max, 0);
  }
}
/** Reusable by StartModules and the existing-particle updater. This advances
 * neither age nor position. Noise scroll remains a system-owned input. */
export function prepareParticleMotionRates(definition: FieldParticleMotionDefinition, previous: Readonly<ParticleMotionState>, input: {
  deltaSeconds: number; systemSeed: number; noiseScroll: number; space: ParticleMotionSpace;
}): ParticleMotionState {
  validateFieldParticleMotion(definition);
  const next = state(previous), dt = finite(input.deltaSeconds), gravity = vector(input.space?.gravity);
  if (dt < 0) throw new Error("Negative native particle motion interval");
  const w = matrix(input.space.worldToLocal);
  const amount = mul(dt, finite(definition.gravityMultiplier));
  const g = { x: mul(amount, gravity.x), y: mul(amount, gravity.y), z: mul(amount, gravity.z) };
  const length = add(add(mul(gravity.x, gravity.x), mul(gravity.y, gravity.y)), mul(gravity.z, gravity.z));
  if (length > f(9.99999905104687e-9)) {
    const transformGravity = (i: number) => add(add(mul(g.y, w[i + 3]!), mul(g.z, w[i + 6]!)), mul(w[i]!, g.x));
    next.velocity = { x: add(transformGravity(0), next.velocity.x), y: add(next.velocity.y, transformGravity(1)), z: add(next.velocity.z, transformGravity(2)) };
  }
  const velocity = definition.velocity ? sampleParticleAnimatedVelocity(definition.velocity, next.seed, next.agePercent) : { x: 0, y: 0, z: 0 };
  // GetModuleSpaceTransform local/local is the identity, not the emitter
  // matrix. Keep the native dot-product rounding and signed-zero behavior.
  const transformVelocity = (i: number) => add(add(mul(velocity.x, i === 0 ? 1 : 0), mul(velocity.y, i === 1 ? 1 : 0)), mul(i === 2 ? 1 : 0, velocity.z));
  const noise = sampleParticleNoise(definition.kernel, definition.noise, { position: next.position, systemSeed: input.systemSeed, scroll: input.noiseScroll });
  next.animatedVelocity = { x: add(noise.x, transformVelocity(0)), y: add(transformVelocity(1), noise.y), z: add(transformVelocity(2), noise.z) };
  next.angularVelocityZ = sampleParticleAngularVelocity({ ...definition.rotation, seed: next.seed, prior: 0 });
  return state(next);
}
/** Ordinary non-ring, non-collision SimulateParticles arithmetic. The owner
 * removes expired entries in the source array order; this function never edits
 * an external particle array or consumes an RNG draw. */
export function integrateParticleMotion(previous: Readonly<ParticleMotionState>, deltaSeconds: number): { state: ParticleMotionState; expired: boolean } {
  const next = state(previous), dt = finite(deltaSeconds);
  if (dt < 0) throw new Error("Negative native particle integration interval");
  next.agePercent = Math.min(f(100.00000762939453), add(mul(mul(dt, 100), next.inverseLifetime), next.agePercent));
  for (const axis of ["x", "y", "z"] as const)
    next.position[axis] = add(mul(add(next.animatedVelocity[axis], next.velocity[axis]), dt), next.position[axis]);
  const expired = next.agePercent > 100;
  if (!expired) next.rotationZ = add(next.rotationZ, mul(dt, next.angularVelocityZ));
  return { state: state(next), expired };
}

/** StartModules integrates each newborn's own birthDelta, then performs its
 * death scan after rotation. This admitted stationary-emitter path requires a
 * supplied zero emitter motion; moving-emitter interpolation is not guessed.
 * Noise scroll is NOT advanced again for this per-newborn phase. */
export function integrateParticleBirthMotion(previous: Readonly<ParticleMotionState>, input: {
  birthDelta: number; emitterMotion: ParticleVector;
}): { state: ParticleMotionState; expired: boolean } {
  const movement = vector(input.emitterMotion);
  if (movement.x !== 0 || movement.y !== 0 || movement.z !== 0) throw new Error("Moving emitter birth compensation provider is unavailable");
  const before = state(previous);
  if (before.agePercent !== 0) throw new Error("Particle birth requires the unintegrated newborn state");
  const result = integrateParticleMotion(before, input.birthDelta);
  // Existing-particle integration skips rotation for entries already killed;
  // StartModules rotates newborns before its later deletion pass.
  if (result.expired) result.state.rotationZ = add(before.rotationZ, mul(finite(input.birthDelta), before.angularVelocityZ));
  return { state: state(result.state), expired: result.expired };
}
