import type { Evidence } from "../field/types.js";

export type ParticleColor = { r: number; g: number; b: number; a: number };
export type ParticleVector = { x: number; y: number; z: number };
export type ParticleKey = { time: number; value: number; inSlope: number; outSlope: number };
/** The serialized infinity codes are retained by the compiler. Their native
 * mapping is not guessed: evaluation outside the keys needs a future provider. */
export type ParticleCurve =
  | { mode: "constant"; value: number }
  | { mode: "two-constants"; min: number; max: number }
  | { mode: "curve"; multiplier: number; keys: ParticleKey[] }
  | { mode: "two-curves"; multiplier: number; min: ParticleKey[]; max: ParticleKey[] };
export type ParticleGradient = {
  mode: "blend" | "fixed";
  colors: { time: number; color: Pick<ParticleColor, "r" | "g" | "b"> }[];
  alpha: { time: number; value: number }[];
};
export type ParticleColorCurve =
  | { mode: "color"; color: ParticleColor }
  | { mode: "gradient" | "random-color"; gradient: ParticleGradient }
  | { mode: "two-colors"; min: ParticleColor; max: ParticleColor }
  | { mode: "two-gradients"; min: ParticleGradient; max: ParticleGradient };
export type FieldParticleModules = {
  kind: "field-particle-modules-v1"; source: Evidence;
  duration: number; looping: boolean; maxParticles: number;
  start: { lifetime: ParticleCurve; speed: ParticleCurve; size: ParticleCurve; rotation: ParticleCurve; color: ParticleColorCurve };
  size: ParticleCurve | null; color: ParticleColorCurve | null;
  velocity: { x: ParticleCurve; y: ParticleCurve; z: ParticleCurve } | null;
  rotation: { curve: ParticleCurve; bySpeed: { min: number; max: number } | null } | null;
  gravity: ParticleCurve;
  emission: { rate: ParticleCurve; bursts: { time: number; count: ParticleCurve; cycles: number; interval: number; probability: number }[] };
  /** These raw dependencies are required for an emitter, not optional visual flourishes. */
  requirements: { autoRandomSeed: boolean; seed: number; prewarm: boolean; shape: Record<string, unknown> | null; noise: Record<string, unknown> | null };
  blockers: string[];
};
export type FieldParticleRandom = {
  lifetime: number; speed: number; size: number; rotation: number; color: number;
  sizeOverLife: number; colorOverLife: number; velocityX: number; velocityY: number; velocityZ: number;
  rotationOverLife: number; gravity: number;
};
/** A birth describes source parameters only. No position, noise or PRNG owner
 * is invented here. Callers must retain the same random samples for its life. */
export type FieldParticleBirth = {
  lifetime: number; speed: number; size: number; rotation: number; color: ParticleColor;
  random: FieldParticleRandom;
};
const f = Math.fround;
function finite(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(f(n))) throw new Error("Invalid particle number");
  return f(n);
}
function unit(n: number): number {
  finite(n); if (n < 0 || n > 1) throw new Error("Particle sample outside [0,1]"); return f(n);
}
function mix(a: number, b: number, t: number): number { return f(f(a) + f(f(f(b) - f(a)) * unit(t))); }
function color(c: ParticleColor): ParticleColor {
  if (!c) throw new Error("Missing particle color");
  return { r: finite(c.r), g: finite(c.g), b: finite(c.b), a: finite(c.a) };
}
function mixColor(a: ParticleColor, b: ParticleColor, t: number): ParticleColor {
  color(a); color(b); return { r: mix(a.r, b.r, t), g: mix(a.g, b.g, t), b: mix(a.b, b.b, t), a: mix(a.a, b.a, t) };
}
/** Cubic Hermite from unweighted source key tangents. Nonzero serialized
 * weights with weightedMode=0 do not make a weighted Bezier curve. */
export function evaluateParticleKeys(keys: readonly ParticleKey[], time: number): number {
  finite(time);
  if (!keys.length) throw new Error("Empty active particle curve");
  keys.forEach((k, i) => {
    [k.time, k.value, k.inSlope, k.outSlope].forEach(finite);
    if (i > 0 && k.time <= keys[i - 1]!.time) throw new Error("Unordered particle keys");
  });
  const first = keys[0]!, last = keys.at(-1)!;
  if (time < first.time || time > last.time) throw new Error("Particle curve infinity provider is unavailable");
  const exact = keys.find((k) => k.time === time); if (exact) return f(exact.value);
  const right = keys.findIndex((k) => k.time > time); const a = keys[right - 1]!, b = keys[right]!;
  const dt = f(b.time - a.time), t = f(f(time - a.time) / dt), t2 = f(t * t), t3 = f(t2 * t);
  const h00 = f(f(2 * t3) - f(3 * t2) + 1), h10 = f(t3 - f(2 * t2) + t);
  const h01 = f(f(3 * t2) - f(2 * t3)), h11 = f(t3 - t2);
  return finite(f(f(f(h00 * a.value) + f(h10 * f(dt * a.outSlope))) + f(f(h01 * b.value) + f(h11 * f(dt * b.inSlope)))));
}
/** Unity 2019.4.20f1 MinMaxCurve mode arithmetic. Reversed min/max constants
 * are meaningful (the source rotation range uses them), so never sort them. */
export function evaluateParticleCurve(curve: ParticleCurve, time: number, sample: number): number {
  finite(time); unit(sample);
  switch (curve.mode) {
    case "constant": return finite(curve.value);
    case "two-constants": return mix(finite(curve.min), finite(curve.max), sample);
    case "curve": return finite(f(evaluateParticleKeys(curve.keys, time) * finite(curve.multiplier)));
    case "two-curves": return finite(f(mix(evaluateParticleKeys(curve.min, time), evaluateParticleKeys(curve.max, time), sample) * finite(curve.multiplier)));
    default: throw new Error("Unknown particle curve mode");
  }
}
export function evaluateParticleGradient(gradient: ParticleGradient, time: number): ParticleColor {
  time = unit(time);
  if (gradient.mode === "fixed") throw new Error("Fixed-gradient boundary semantics are not admitted");
  if (gradient.mode !== "blend" || !gradient.colors.length || !gradient.alpha.length)
    throw new Error("Invalid particle gradient");
  const lane = <T extends { time: number }>(keys: readonly T[], get: (key: T) => number): number => {
    keys.forEach((key, i) => { unit(key.time); finite(get(key)); if (i && key.time <= keys[i - 1]!.time) throw new Error("Unordered gradient keys"); });
    if (time <= keys[0]!.time) return finite(get(keys[0]!));
    if (time >= keys.at(-1)!.time) return finite(get(keys.at(-1)!));
    const j = keys.findIndex((key) => key.time >= time), b = keys[j]!, a = keys[j - 1]!;
    if (time === b.time) return finite(get(b));
    return mix(get(a), get(b), f(f(time - a.time) / f(b.time - a.time)));
  };
  return { r: lane(gradient.colors, (k) => k.color.r), g: lane(gradient.colors, (k) => k.color.g),
    b: lane(gradient.colors, (k) => k.color.b), a: lane(gradient.alpha, (k) => k.value) };
}
export function evaluateParticleColor(curve: ParticleColorCurve, time: number, sample: number): ParticleColor {
  unit(time); unit(sample);
  switch (curve.mode) {
    case "color": return color(curve.color);
    case "gradient": return evaluateParticleGradient(curve.gradient, time);
    case "random-color": return evaluateParticleGradient(curve.gradient, sample);
    case "two-colors": return mixColor(curve.min, curve.max, sample);
    case "two-gradients": return mixColor(evaluateParticleGradient(curve.min, time), evaluateParticleGradient(curve.max, time), sample);
    default: throw new Error("Unknown particle color mode");
  }
}
const randomKeys: (keyof FieldParticleRandom)[] = ["lifetime", "speed", "size", "rotation", "color", "sizeOverLife", "colorOverLife", "velocityX", "velocityY", "velocityZ", "rotationOverLife", "gravity"];
function validateRandom(random: FieldParticleRandom): void {
  if (!random || Object.keys(random).length !== randomKeys.length) throw new Error("Incomplete particle random inputs");
  randomKeys.forEach((key) => unit(random[key]));
}
export function createFieldParticleBirth(modules: FieldParticleModules, systemTime: number, random: FieldParticleRandom): FieldParticleBirth {
  if (modules.kind !== "field-particle-modules-v1") throw new Error("Unknown particle module plan");
  unit(systemTime); validateRandom(random);
  const value = (key: "lifetime" | "speed" | "size" | "rotation") => evaluateParticleCurve(modules.start[key], systemTime, random[key]);
  const birth = { lifetime: value("lifetime"), speed: value("speed"), size: value("size"), rotation: value("rotation"),
    color: evaluateParticleColor(modules.start.color, systemTime, random.color), random: structuredClone(random) };
  if (birth.lifetime <= 0 || birth.size < 0) throw new Error("Nonpositive lifetime/negative particle size is not admitted");
  return birth;
}
export function sampleFieldParticleAppearance(modules: FieldParticleModules, birth: FieldParticleBirth, age: number): { size: number; color: ParticleColor } {
  validateRandom(birth.random); const t = unit(age), startColor = color(birth.color);
  const mult = modules.color ? evaluateParticleColor(modules.color, t, birth.random.colorOverLife) : { r: 1, g: 1, b: 1, a: 1 };
  const size = f(finite(birth.size) * (modules.size ? evaluateParticleCurve(modules.size, t, birth.random.sizeOverLife) : 1));
  if (size < 0) throw new Error("Negative lifetime size is not admitted");
  return { size, color: { r: f(startColor.r * mult.r), g: f(startColor.g * mult.g), b: f(startColor.b * mult.b), a: f(startColor.a * mult.a) } };
}
/** Rates only: integrating motion, gravity, Noise and birth substeps is a
 * separate native dependency. This API cannot silently become an emitter. */
export function sampleFieldParticleRates(modules: FieldParticleModules, birth: FieldParticleBirth, age: number, speed: number): {
  animatedVelocity: ParticleVector; angularVelocity: number; gravityMultiplier: number;
} {
  validateRandom(birth.random); age = unit(age); finite(speed); if (speed < 0) throw new Error("Negative particle speed");
  const v = modules.velocity, r = modules.rotation;
  let rt = age;
  if (r?.bySpeed) {
    const { min, max } = r.bySpeed; finite(min); finite(max); if (max <= min) throw new Error("Invalid particle speed range");
    rt = f(Math.max(0, Math.min(1, f(speed - min) / f(max - min))));
  }
  return { animatedVelocity: v ? { x: evaluateParticleCurve(v.x, age, birth.random.velocityX), y: evaluateParticleCurve(v.y, age, birth.random.velocityY), z: evaluateParticleCurve(v.z, age, birth.random.velocityZ) } : { x: 0, y: 0, z: 0 },
    angularVelocity: r ? evaluateParticleCurve(r.curve, rt, birth.random.rotationOverLife) : 0,
    gravityMultiplier: evaluateParticleCurve(modules.gravity, age, birth.random.gravity) };
}
export function assertFieldParticleEmitterExecutable(modules: FieldParticleModules): never {
  throw new Error("Native particle emitter unavailable: " + modules.blockers.join("; "));
}

export type FieldParticleMaterial = {
  kind: "field-particle-material-v1"; source: Evidence; fragmentSha256: string; vertexSha256: string;
  colorSpace: "gamma";
  textures: { main: string; mask: string; noise: string };
  tile: [number, number]; baseOffset: [number, number]; maskTile: [number, number]; maskOffset: [number, number];
  noiseTile: [number, number]; noiseOffset: number; noiseScale: number; noiseScroll: [number, number];
  flipX: number; builtInTime: 0 | 1; emission: number; alphaEmission: number; cutoff: number;
  edge: { min: number; max: number; color: ParticleColor }; gradient: { black: ParticleColor; white: ParticleColor };
  blend: { source: 1; destination: 10; depthWrite: false; depthTest: 4; colorMask: 15; cull: 0 };
};
export type FieldParticleTexture = {
  width: number; height: number; rgba: Uint8Array; filter: "point" | "linear";
  wrapU: "repeat" | "clamp"; wrapV: "repeat" | "clamp"; rowOrder: "top-to-bottom";
  colorSpace: "gamma";
};
/** Mip-zero sample; does not claim D3D derivative/LOD or full GPU equivalence. */
export function sampleFieldParticleTexture(texture: FieldParticleTexture, u: number, v: number): ParticleColor {
  finite(u); finite(v);
  const { width, height } = texture;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      texture.rgba.length !== width * height * 4 || texture.rowOrder !== "top-to-bottom" || texture.colorSpace !== "gamma" ||
      !["point", "linear"].includes(texture.filter) || !["repeat", "clamp"].includes(texture.wrapU) || !["repeat", "clamp"].includes(texture.wrapV))
    throw new Error("Invalid source particle texture");
  const wrap = (i: number, n: number, mode: string) => mode === "repeat" ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
  const texel = (x: number, y: number): ParticleColor => {
    x = wrap(x, width, texture.wrapU); y = height - 1 - wrap(y, height, texture.wrapV);
    const i = (y * width + x) * 4, bytes = texture.rgba;
    return { r: f(bytes[i]! / 255), g: f(bytes[i + 1]! / 255), b: f(bytes[i + 2]! / 255), a: f(bytes[i + 3]! / 255) };
  };
  if (texture.filter === "point") return texel(Math.floor(u * width), Math.floor(v * height));
  const x = f(f(u * width) - 0.5), y = f(f(v * height) - 0.5), ix = Math.floor(x), iy = Math.floor(y);
  return mixColor(mixColor(texel(ix, iy), texel(ix + 1, iy), f(x - ix)),
    mixColor(texel(ix, iy + 1), texel(ix + 1, iy + 1), f(x - ix)), f(y - iy));
}
/** Exact selected LastEffectMaster DXBC instruction algebra, in gamma-space
 * mip-zero sampling. Noise here is a texture lookup, distinct from the emitter
 * NoiseModule. Returns premultiplied RGBA or null for source alpha discard. */
export function shadeFieldParticle(material: FieldParticleMaterial, input: {
  uv: [number, number]; color: ParticleColor; engineSeconds: number; elapsedSeconds: number;
}, sample: (key: string, u: number, v: number) => ParticleColor): ParticleColor | null {
  if (material.kind !== "field-particle-material-v1" || material.colorSpace !== "gamma" || ![0, 1].includes(material.builtInTime)) throw new Error("Unknown particle material");
  const vertex = color(input.color); finite(input.engineSeconds); finite(input.elapsedSeconds);
  let [u, v] = input.uv; finite(u); finite(v);
  u = f(f(f(1 - u) * material.flipX) + f(f(1 - material.flipX) * u));
  const time = material.builtInTime ? input.engineSeconds : input.elapsedSeconds;
  const fract = (x: number) => f(x - Math.floor(x));
  const noise = color(sample(material.textures.noise,
    f(f(f(u + material.noiseOffset) * material.noiseTile[0]) + fract(f(time * material.noiseScroll[0]))),
    f(f(f(v + material.noiseOffset) * material.noiseTile[1]) + fract(f(time * material.noiseScroll[1])))));
  u = f(f(f(noise.r - 0.5) * material.noiseScale) + u); v = f(f(f(noise.g - 0.5) * material.noiseScale) + v);
  const main = color(sample(material.textures.main, f(f(u + material.baseOffset[0]) * material.tile[0]), f(f(v + material.baseOffset[1]) * material.tile[1])));
  const mask = color(sample(material.textures.mask, f(f(u + material.maskOffset[0]) * material.maskTile[0]), f(f(v + material.maskOffset[1]) * material.maskTile[1])));
  const alpha = f(f(f(mask.r * main.a) * f(1 + material.alphaEmission)) * vertex.a);
  if (alpha < material.cutoff) return null;
  const delta = f(material.edge.max - material.edge.min);
  if (!(delta > 0)) throw new Error("Unimplemented particle alpha edge interval");
  const x = f(Math.max(0, Math.min(1, f(f(alpha - material.edge.min) / delta))));
  const edge = f(f(x * x) * f(3 - f(2 * x)));
  const channel = (key: "r" | "g" | "b") => {
    const gradient = f(f(main.r * f(material.gradient.white[key] - material.gradient.black[key])) + material.gradient.black[key]);
    const rgb = f(f(edge * f(gradient - material.edge.color[key])) + material.edge.color[key]);
    return f(f(rgb * f(f(1 + material.emission) * vertex[key])) * alpha);
  };
  return { r: channel("r"), g: channel("g"), b: channel("b"), a: alpha };
}
