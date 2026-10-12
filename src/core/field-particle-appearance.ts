import type { Evidence } from "../field/types.js";
import type { ParticleCurve } from "./field-particles.js";
import { evaluateParticleMotionCurve } from "./field-particle-motion.js";

export type ParticleAppearanceColor32 = [number, number, number, number];
export type ParticleAppearancePolynomial = [number, number, number, number, number, number, number, number, number];
/** Gradient.BuildCache stores merged float32 times, quantized Color32 samples
 * and its native reciprocal refinement. It is compiled data, never a list of
 * expected animation frames. Runtime evaluates every requested age. */
export type ParticleAppearanceGradientCache = { times: number[]; colors: number[]; inverseSpans: number[] };
export type ParticleAppearanceSize = { curve: Extract<ParticleCurve, { mode: "curve" }>; optimized: ParticleAppearancePolynomial | null };
export type FieldParticleAppearanceDefinition = {
  kind: "unity-field-particle-appearance-v1";
  source: Evidence;
  engine: "unity-2019.4.20f1";
  inputSha256: string;
  cacheSha256: string;
  size: ParticleAppearanceSize;
  color: ParticleAppearanceGradientCache;
  colorSpace: { active: 0; applyActiveColorSpace: true; source: { file: string; serializedFile: string; objectId: string; sha256: string } };
  phase: { size: "after-incremental-slices"; color: "nonincremental-render-preparation" };
};
export type ParticleAppearanceRecord = { seed: number; agePercent: number; startSize: number; startColor32: ParticleAppearanceColor32 };
export type ParticleAppearanceProjection = { finalSize: number; finalColor32: ParticleAppearanceColor32 };
const f = Math.fround;
const MAX_SOURCE_AGE = 100.00000762939453;
const HASH = /^[a-f0-9]{64}$/;
function finite(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(f(n))) throw new Error("Invalid particle appearance number");
  return f(n);
}
function integer(n: number, max: number): number {
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error("Invalid particle appearance integer");
  return n;
}
function time(input: { seed: number; agePercent: number }): number {
  integer(input.seed, 0xffffffff); finite(input.agePercent);
  if (input.agePercent < 0 || input.agePercent > MAX_SOURCE_AGE) throw new Error("Particle appearance age is outside the source lifetime buffer");
  return f(f(input.agePercent) * f(.01));
}
export function unpackParticleAppearanceColor32(packed: number): ParticleAppearanceColor32 {
  integer(packed, 0xffffffff); return [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, packed >>> 24];
}
export function packParticleAppearanceColor32(color: readonly number[]): number {
  validateColor(color); return (color[0]! | (color[1]! << 8) | (color[2]! << 16) | (color[3]! << 24)) >>> 0;
}
function validateColor(color: readonly number[]): void {
  if (!Array.isArray(color) || color.length !== 4) throw new Error("Missing source Color32 channels");
  color.forEach((n) => integer(n, 255));
}
export function validateParticleAppearanceGradientCache(cache: ParticleAppearanceGradientCache): void {
  if (!cache || !Array.isArray(cache.times) || cache.times.length < 2 || cache.times.length > 16 ||
      !Array.isArray(cache.colors) || !Array.isArray(cache.inverseSpans) || cache.colors.length !== cache.times.length || cache.inverseSpans.length !== cache.times.length)
    throw new Error("Invalid particle appearance gradient cache");
  cache.times.forEach((t, i) => {
    finite(t); integer(cache.colors[i]!, 0xffffffff); finite(cache.inverseSpans[i]!);
    if (t < 0 || t > 1 || (i && t < cache.times[i - 1]!) || cache.inverseSpans[i]! < 0 ||
        (i > 0 && cache.inverseSpans[i] === 0)) throw new Error("Invalid particle appearance gradient interval");
  });
  if (cache.times.at(-1) !== 1 || cache.inverseSpans[0] !== 0) throw new Error("Unbound particle gradient cache endpoints");
}
export function validateParticleAppearanceSize(size: ParticleAppearanceSize): void {
  if (!size || size.curve?.mode !== "curve") throw new Error("Unrecovered particle size curve mode");
  finite(size.curve.multiplier);
  if (!Array.isArray(size.curve.keys) || !size.curve.keys.length) throw new Error("Empty particle size curve");
  size.curve.keys.forEach((k, i) => {
    [k.time, k.value, k.inSlope, k.outSlope].forEach(finite);
    if (k.time < 0 || k.time > 1 || (i && k.time <= size.curve.keys[i - 1]!.time)) throw new Error("Invalid particle size curve keys");
  });
  if (size.optimized !== null) {
    if (!Array.isArray(size.optimized) || size.optimized.length !== 9) throw new Error("Invalid optimized particle size coefficients");
    size.optimized.forEach(finite);
    if (size.curve.keys.length > 3 || size.optimized[8] < 0 || size.optimized[8] > 1) throw new Error("Unrecovered optimized particle size split");
  }
}
export function validateFieldParticleAppearance(def: FieldParticleAppearanceDefinition): void {
  if (!def || def.kind !== "unity-field-particle-appearance-v1" || def.engine !== "unity-2019.4.20f1" || !HASH.test(def.inputSha256) || !HASH.test(def.cacheSha256) ||
      def.phase?.size !== "after-incremental-slices" || def.phase.color !== "nonincremental-render-preparation" || def.colorSpace?.active !== 0 || def.colorSpace.applyActiveColorSpace !== true)
    throw new Error("Unbound source particle appearance definition");
  validateParticleAppearanceSize(def.size); validateParticleAppearanceGradientCache(def.color);
}

/** SizeModule writes startSize * max(0, curve(agePercent * .01)); it never
 * multiplies its previous result. The salt-seeded local RandN is constructed
 * but not sampled by the admitted single-curve branch. */
export function sampleParticleAppearanceSize(size: ParticleAppearanceSize, input: Pick<ParticleAppearanceRecord, "seed" | "agePercent" | "startSize">): number {
  validateParticleAppearanceSize(size); const t = time(input), base = finite(input.startSize);
  if (base < 0) throw new Error("Negative source start size");
  let scale: number;
  if (size.optimized === null) scale = evaluateParticleMotionCurve(size.curve, t, 0);
  else {
    const c = size.optimized, second = c[8] <= Math.min(t, f(.99999));
    // Native selector clamps only its comparison. Polynomial evaluation uses
    // the original t; clamping t itself changes the exact endpoint buffer.
    const at = second ? f(t - c[8]) : t, i = second ? 4 : 0;
    const cubic = f(f(at * c[i]!) + c[i + 1]!);
    const quadratic = f(f(cubic * at) + c[i + 2]!);
    scale = f(f(quadratic * at) + c[i + 3]!);
  }
  return finite(f(base * Math.max(0, scale)));
}
export function projectParticleSize(def: FieldParticleAppearanceDefinition, input: Pick<ParticleAppearanceRecord, "seed" | "agePercent" | "startSize">): number {
  validateFieldParticleAppearance(def); return sampleParticleAppearanceSize(def.size, input);
}
/** Native batch gradient evaluation quantizes its interpolation factor to
 * eight bits. Equal times proceed to the next cache interval. The appended
 * time=1 sample is therefore observable at the lifetime endpoint. */
export function sampleParticleAppearanceGradient(cache: ParticleAppearanceGradientCache, agePercent: number): ParticleAppearanceColor32 {
  validateParticleAppearanceGradientCache(cache); const t = time({ seed: 0, agePercent });
  let right = 1;
  while (right < cache.times.length - 1 && t >= cache.times[right]!) right++;
  const left = right - 1, delta = Math.max(0, Math.min(1, f(t - cache.times[left]!)));
  const factor = Math.trunc(f(255 * f(cache.inverseSpans[right]! * delta)));
  // Particle lifetime inputs stay in the last source sample. Reject a foreign
  // cache that would invoke byte packing outside its proved interval.
  if (factor < 0 || factor > 255) throw new Error("Particle gradient cache cannot resolve this source age");
  const a = unpackParticleAppearanceColor32(cache.colors[left]!), b = unpackParticleAppearanceColor32(cache.colors[right]!);
  return a.map((n, i) => (n + (((b[i]! - n) * factor + 128) >> 8)) & 255) as ParticleAppearanceColor32;
}
/** SIMD ColorModule uses rounded /255 byte products, unlike UpdateSingle's
 * different +1/256 path. Both inputs remain immutable. */
export function multiplyParticleAppearanceColor32(start: readonly number[], multiplier: readonly number[]): ParticleAppearanceColor32 {
  validateColor(start); validateColor(multiplier);
  return start.map((v, i) => { const product = v * multiplier[i]! + 128; return (product + (product >>> 8)) >>> 8; }) as ParticleAppearanceColor32;
}
export function projectParticleColor32(def: FieldParticleAppearanceDefinition, input: Pick<ParticleAppearanceRecord, "seed" | "agePercent" | "startColor32">): ParticleAppearanceColor32 {
  validateFieldParticleAppearance(def); time(input);
  return multiplyParticleAppearanceColor32(input.startColor32, sampleParticleAppearanceGradient(def.color, input.agePercent));
}
export function projectParticleAppearance(def: FieldParticleAppearanceDefinition, input: ParticleAppearanceRecord): ParticleAppearanceProjection {
  return { finalSize: projectParticleSize(def, input), finalColor32: projectParticleColor32(def, input) };
}
