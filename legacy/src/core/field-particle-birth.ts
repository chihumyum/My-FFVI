import type { Evidence } from "../field/types.js";
import {
  nextParticleRandomFloat, nextParticleRandomLanes, seedParticleRandom,
  type ParticleRandomLanes,
} from "./field-particle-emitter.js";

export type ParticleBirthVector = [number, number, number];
export type ParticleBirthColor = [number, number, number, number];
export type ParticleBirthRange = { mode: "constant"; value: number } | { mode: "two-constants"; min: number; max: number };
export type FieldParticleBirthDefinition = {
  kind: "unity-local-cone-particle-birth-v1";
  source: Evidence;
  engine: { nativeSha256: string; pdbGuid: string; pdbAge: number; version: string };
  initial: { lifetime: ParticleBirthRange; speed: ParticleBirthRange; size: ParticleBirthRange; rotation: ParticleBirthRange; color: ParticleBirthColor };
  cone: { angle: number; radius: number; rotation: ParticleBirthVector };
};
export type ParticleBirthRandom = { initial: ParticleRandomLanes; shape: ParticleRandomLanes };
/** Output after Initial.Start -> Shape.Start -> CalculateInitialValues(newborn).
 * UpdateModules and StartModules' subsequent age/position integration have NOT
 * run. Positions and velocities are in the ParticleSystem's local space. */
export type FieldParticleBirth = {
  index: number;
  seed: number;
  lifetime: number;
  inverseLifetime: number;
  normalizedAge: 0;
  position: ParticleBirthVector;
  velocity: ParticleBirthVector;
  size: ParticleBirthVector;
  rotation: ParticleBirthVector;
  color: ParticleBirthColor;
  packedColor: number;
  birthDelta: number;
  normalizedEmitterTime: number;
};
export type ParticleBirthBatchInput = {
  startIndex: number;
  count: number;
  /** Initial.Start sees the current emitter time; supported curves are time invariant. */
  normalizedEmitterTime: number;
  /** Supplied by StartModules scheduling, one per live newborn, never a fixed dt. */
  birthDeltas: readonly number[];
  /** StartModules interpolates the normalized emitter time per newborn before
   * CalculateInitialValues. Constant/two-constant curves do not read it, but
   * it is retained for the subsequent module pipeline rather than fabricated. */
  birthNormalizedTimes: readonly number[];
  /** Source Shape.Start also reads ParticleSystemState.lossyScale. This subset
   * requires an explicit unit scale; no renderer/world transform is applied. */
  simulationScale: ParticleBirthVector;
};
export type ParticlePaddedBirthBatchInput = ParticleBirthBatchInput & {
  /** Exact StartModules timing for every SIMD lane, including scratch padding.
   * The live prefix must equal birthDeltas/birthNormalizedTimes. */
  paddedBirthDeltas: readonly number[];
  paddedBirthNormalizedTimes: readonly number[];
};
const f = Math.fround;
const nativeSha = "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845";
const add = (a: number, b: number) => f(a + b), sub = (a: number, b: number) => f(a - b), mul = (a: number, b: number) => f(a * b);
function finite(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(f(n))) throw new Error("Invalid native particle birth float");
  return f(n);
}
function vector(v: readonly number[], length: number): void {
  if (!Array.isArray(v) || v.length !== length) throw new Error("Incomplete native particle birth vector");
  v.forEach(finite);
}
function range(v: ParticleBirthRange): void {
  if (v.mode === "constant") finite(v.value);
  else if (v.mode === "two-constants") { finite(v.min); finite(v.max); }
  else throw new Error("Unsupported particle birth curve mode");
}
export function validateFieldParticleBirth(definition: FieldParticleBirthDefinition): void {
  if (definition.kind !== "unity-local-cone-particle-birth-v1" || definition.engine.nativeSha256 !== nativeSha ||
    definition.engine.version !== "2019.4.20f1_6dd1c08eedfa" || definition.engine.pdbGuid !== "4420B376-89DD-4CFE-AEC8-2300F4A999D2" || definition.engine.pdbAge !== 1)
    throw new Error("Unbound native particle birth definition");
  for (const key of ["lifetime", "speed", "size", "rotation"] as const) range(definition.initial[key]);
  vector(definition.initial.color, 4); vector(definition.cone.rotation, 3);
  if (finite(definition.cone.radius) < 0 || finite(definition.cone.angle) < 0 || definition.cone.angle > 90 || definition.cone.rotation.some((v) => Math.abs(v) > 360))
    throw new Error("Unsupported source cone range");
}
function sample(r: ParticleBirthRange, random: number): number {
  return r.mode === "constant" ? f(r.value) : add(mul(sub(f(r.max), f(r.min)), random), f(r.min));
}
/** Source SIMD polynomial, evaluated with the original float32 operation order.
 * Input is radians / (2*pi), with a -0.25 phase for sine. No JS sin/cos. */
function sourceTrig(phase: number): number {
  // cvtps2dq uses MXCSR round-to-nearest/even, unlike cvttps2dq. Ghidra's
  // ordinary integer cast loses this distinction; the original asm is bound.
  const lower = Math.floor(phase), fraction = phase - lower;
  const nearest = fraction < .5 ? lower : fraction > .5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1;
  const x = sub(.25, Math.abs(sub(phase, f(nearest)))), x2 = mul(x, x), x4 = mul(x2, x2);
  const first = mul(add(mul(f(-76.56861877441406), x2), f(81.60182189941406)), x4);
  const second = add(first, add(mul(f(-41.34165954589844), x2), f(6.283185005187988)));
  return mul(add(second, mul(mul(x4, x4), f(39.65703201293945))), x);
}
const radians = (degree: number) => mul(f(degree), f(0.01745329238474369));
const phase = (radian: number) => mul(radian, f(0.15915493667125702));
/** Portable float32 reciprocal (and sqrt-then-reciprocal below) supplies the
 * source estimate instructions, followed by their exact refinements. x86 only
 * specifies an error bound for these estimates. The path matches the isolated
 * instruction probes, not necessarily every physical CPU's estimate bits. */
function sourceReciprocal(x: number): number {
  const estimate = f(1 / x), first = mul(sub(f(2.000000476837158), mul(x, estimate)), estimate);
  return mul(first, sub(2, mul(x, first)));
}
function normalize(v: ParticleBirthVector): ParticleBirthVector {
  const length = add(mul(v[0], v[0]), add(mul(v[1], v[1]), mul(v[2], v[2])));
  if (!(length > f(1.0000000031710769e-30))) return [0, 0, 1];
  const estimate = Math.min(f(3.4028234663852886e38), mul(f(1 / f(Math.sqrt(length))), f(.9999998211860657)));
  const inverse = mul(sub(f(3.000000238418579), mul(mul(estimate, length), estimate)), mul(estimate, .5));
  return v.map((n) => mul(n, inverse)) as ParticleBirthVector;
}
/** Shape's own Euler rotation, with the source ZXY quaternion construction.
 * The emitter GameObject transform belongs to simulation/geometry, not here. */
function shapeMatrix(euler: ParticleBirthVector): [ParticleBirthVector, ParticleBirthVector, ParticleBirthVector] {
  const p = euler.map((v) => phase(mul(radians(v), .5)));
  const [cx, cy, cz] = p.map(sourceTrig) as ParticleBirthVector;
  const [sx, sy, sz] = p.map((v) => sourceTrig(sub(v, .25))) as ParticleBirthVector;
  const sxcz = mul(sx, cz), cxcz = mul(cx, cz), cxsz = mul(cx, sz), sxsz = mul(sx, sz);
  // Every product is kept separate to match mulps/addps, including the sign
  // vectors loaded by the exact kRotationOrderLUT dynamic initializer.
  const x = add(mul(mul(sy, 1), cxsz), mul(mul(cy, sxcz), 1));
  const y = add(mul(mul(sy, 1), cxcz), mul(mul(cy, sxsz), -1));
  const zz = add(mul(mul(sy, -1), sxcz), mul(mul(cy, cxsz), 1));
  const w = add(mul(mul(sy, 1), sxsz), mul(mul(cy, cxcz), 1));
  return [
    [add(1, add(mul(mul(-2, y), y), mul(mul(-2, zz), zz))), add(mul(mul(2, y), x), mul(mul(2, zz), w)), add(mul(mul(-2, y), w), mul(mul(2, zz), x))],
    [add(mul(mul(-2, zz), w), mul(mul(2, x), y)), add(1, add(mul(mul(-2, zz), zz), mul(mul(-2, x), x))), add(mul(mul(2, zz), y), mul(mul(2, x), w))],
    [add(mul(mul(2, x), zz), mul(mul(2, y), w)), add(mul(mul(-2, x), w), mul(mul(2, y), zz)), add(1, add(mul(mul(-2, x), x), mul(mul(-2, y), y)))],
  ];
}
function transform(columns: [ParticleBirthVector, ParticleBirthVector, ParticleBirthVector], v: ParticleBirthVector): ParticleBirthVector {
  return [0, 1, 2].map((i) => add(mul(columns[0][i]!, v[0]), add(mul(columns[1][i]!, v[1]), mul(columns[2][i]!, v[2])))) as ParticleBirthVector;
}

function generateBirthBatch(definition: FieldParticleBirthDefinition, prior: Readonly<ParticleBirthRandom>, input: ParticleBirthBatchInput,
  paddedTiming?: Pick<ParticlePaddedBirthBatchInput, "paddedBirthDeltas" | "paddedBirthNormalizedTimes">): {
  particles: FieldParticleBirth[]; paddedParticles: FieldParticleBirth[]; paddedCount: number; random: ParticleBirthRandom;
} {
  validateFieldParticleBirth(definition);
  if (!Number.isSafeInteger(input.startIndex) || input.startIndex < 0 || input.startIndex % 4 !== 0 || !Number.isSafeInteger(input.count) || input.count < 0 || input.count > 1000 || input.startIndex + input.count > 1003 ||
    input.birthDeltas.length !== input.count || input.birthNormalizedTimes.length !== input.count) throw new Error("Invalid native particle birth batch/count");
  const time = finite(input.normalizedEmitterTime);
  if (time < 0 || time > 1) throw new Error("Invalid native particle birth time");
  vector(input.simulationScale, 3);
  if (input.simulationScale.some((n) => n !== 1)) throw new Error("Non-unit native particle simulation scale is not admitted");
  const deltas = input.birthDeltas.map(finite);
  if (deltas.some((n) => n < 0)) throw new Error("Invalid native particle birth delta");
  const times = input.birthNormalizedTimes.map(finite);
  if (times.some((n) => n < 0 || n > 1)) throw new Error("Invalid native particle birth normalized time");
  const paddedCount = Math.ceil(input.count / 4) * 4;
  let allDeltas = deltas, allTimes = times;
  if (paddedTiming) {
    if (paddedTiming.paddedBirthDeltas.length !== paddedCount || paddedTiming.paddedBirthNormalizedTimes.length !== paddedCount)
      throw new Error("Incomplete native particle padded birth timing");
    allDeltas = paddedTiming.paddedBirthDeltas.map(finite); allTimes = paddedTiming.paddedBirthNormalizedTimes.map(finite);
    if (allDeltas.some((n, i) => n < 0 || (i < deltas.length && n !== deltas[i])) ||
        allTimes.some((n, i) => n < 0 || n > 1 || (i < times.length && n !== times[i])))
      throw new Error("Invalid or mismatched native particle padded birth timing");
  }
  // Validate without advancing either input. nextParticleRandomLanes is pure.
  nextParticleRandomLanes(prior.initial, false); nextParticleRandomLanes(prior.shape, false);
  const random: ParticleBirthRandom = structuredClone(prior), particles: FieldParticleBirth[] = [];
  const color = definition.initial.color.map((n) => Math.trunc(add(mul(Math.max(0, Math.min(1, f(n))), 255), .5))) as ParticleBirthColor;
  const packedColor = ((color[0]) | color[1] << 8 | color[2] << 16 | color[3] << 24) >>> 0;
  for (let block = 0; block < paddedCount; block += 4) {
    const draws = [];
    for (let draw = 0; draw < 5; draw++) {
      const next = nextParticleRandomLanes(random.initial, draw !== 0); random.initial = next.state; draws.push(next.values);
    }
    for (let lane = 0; lane < 4; lane++) {
      const seed = draws[0]![lane]!, lifetime = Math.max(f(.00001), sample(definition.initial.lifetime, draws[1]![lane]!));
      const size = Math.max(0, sample(definition.initial.size, draws[2]![lane]!));
      const flipDraw = nextParticleRandomFloat(seedParticleRandom((seed + 0xff2bb1a4) >>> 0)).value;
      const rotation = mul(sample(definition.initial.rotation, draws[3]![lane]!), 0 < flipDraw ? 1 : -1);
      particles.push({ index: input.startIndex + block + lane, seed, lifetime, inverseLifetime: sourceReciprocal(lifetime), normalizedAge: 0,
        position: [0, 0, 0], velocity: [0, 0, 1], size: [size, size, size], rotation: [0, 0, rotation],
        color: color.map((n) => f(n / 255)) as ParticleBirthColor, packedColor,
        birthDelta: allDeltas[block + lane] ?? 0, normalizedEmitterTime: allTimes[block + lane] ?? time });
    }
  }
  const matrix = shapeMatrix(definition.cone.rotation), a = phase(radians(definition.cone.angle));
  const coneSin = sourceTrig(sub(a, .25)), coneCos = sourceTrig(a), arc = radians(360);
  for (let block = 0; block < paddedCount; block += 4) {
    const angles = nextParticleRandomLanes(random.shape, true); random.shape = angles.state;
    const radii = nextParticleRandomLanes(random.shape, true); random.shape = radii.state;
    for (let lane = 0; lane < 4; lane++) {
      const particle = particles[block + lane]!, theta = phase(mul(angles.values[lane]!, arc));
      // Thickness=1 still clamps its inner squared radius to .001 in this build.
      const radius = f(Math.sqrt(add(mul(radii.values[lane]!, f(.001)), sub(1, radii.values[lane]!))));
      const x = mul(sourceTrig(theta), radius), y = mul(radius, sourceTrig(sub(theta, .25)));
      particle.position = transform(matrix, [mul(x, f(definition.cone.radius)), mul(y, f(definition.cone.radius)), 0]).map((v) => add(0, v)) as ParticleBirthVector;
      const direction = transform([[1, 0, 0], [0, 1, 0], [0, 0, 1]], normalize(transform(matrix, normalize([mul(coneSin, x), mul(coneSin, y), coneCos]))));
      particle.velocity = direction;
    }
  }
  for (const particle of particles) {
    const speedRandom = nextParticleRandomFloat(seedParticleRandom((particle.seed + 0x96aa4de3) >>> 0)).value;
    const speed = sample(definition.initial.speed, speedRandom);
    particle.velocity = particle.velocity.map((v) => mul(v, speed)) as ParticleBirthVector;
  }
  return { particles: structuredClone(particles.slice(0, input.count)), paddedParticles: particles, paddedCount, random };
}

/** One native Start batch. The historical live-only API consumes padding RNG
 * but does not expose scratch records with unspecified padding timing. */
export function birthParticleBatch(definition: FieldParticleBirthDefinition, prior: Readonly<ParticleBirthRandom>, input: ParticleBirthBatchInput): {
  particles: FieldParticleBirth[]; paddedCount: number; random: ParticleBirthRandom;
} {
  const { particles, paddedCount, random } = generateBirthBatch(definition, prior, input);
  return { particles, paddedCount, random };
}

/** Full source scratch batch for subsequent StartModules motion and deletion.
 * Padding is physical scratch, not extra live births. No zero/current-time
 * fallback is permitted for a returned padding record. */
export function birthPaddedParticleBatch(definition: FieldParticleBirthDefinition, prior: Readonly<ParticleBirthRandom>, input: ParticlePaddedBirthBatchInput): {
  particles: FieldParticleBirth[]; paddedParticles: FieldParticleBirth[]; paddedCount: number; random: ParticleBirthRandom;
} {
  return generateBirthBatch(definition, prior, input, input);
}
