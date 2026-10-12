import type { Evidence } from "../field/types.js";

/** Unity 2019.4.20f1 Win64 IL2CPP. These are engine state words, not JS RNG seeds. */
export type ParticleRandomState = [number, number, number, number];
export type ParticleRandomLanes = [ParticleRandomState, ParticleRandomState, ParticleRandomState, ParticleRandomState];
export type ParticleEmitterRandomState = {
  seed: number;
  initial: ParticleRandomLanes;
  shape: ParticleRandomLanes;
  emission: ParticleRandomState;
  noiseScroll: number;
};
export type ParticleEmissionPlan = {
  kind: "unity-constant-particle-emission-v1";
  source: Evidence;
  duration: number;
  rate: number;
  bursts: { time: number; count: number; cycles: number; interval: number; probability: number }[];
};
export type ParticleEmissionState = {
  random: ParticleRandomState;
  fractionalCount: number;
  spacing: number;
};
export type ParticleEmissionResult = {
  state: ParticleEmissionState;
  continuousCount: number;
  burstCount: number;
  totalCount: number;
};
export type FieldParticleEmitterDefinition = {
  kind: "field-particle-emitter-kernel-v1";
  source: Evidence;
  engine: { nativeSha256: string; pdbGuid: string; pdbAge: number; version: string };
  simulation: { space: "local"; scaling: "hierarchy"; speed: 1; useUnscaledTime: false };
  random: { seed: number; autoRandomSeed: boolean };
  emission: ParticleEmissionPlan;
  prewarm: boolean;
  blockers: string[];
};

const f = Math.fround;
// Source float32 bits 0x34000001 at UnityPlayer RVA 0x144f88c (also SIMD 0x14503c0).
const randomScale = f(1 / 0x7fffff);
const rateEpsilon = f(0.0001); // RVA 0x144850c.
function uint(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error("Invalid native particle uint32");
  return n;
}
function finite(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isFinite(f(n))) throw new Error("Invalid native particle float32");
  return f(n);
}
function checkedRandom(state: readonly number[]): ParticleRandomState {
  if (!Array.isArray(state) || state.length !== 4) throw new Error("Incomplete native particle random state");
  return state.map(uint) as ParticleRandomState;
}

/** Rand::SetSeed recurrence, also inlined by ParticleSystem::ResetSeeds. */
export function seedParticleRandom(seed: number): ParticleRandomState {
  const x = uint(seed), y = (Math.imul(x, 0x6c078965) + 1) >>> 0;
  const z = (Math.imul(y, 0x6c078965) + 1) >>> 0;
  return [x, y, z, (Math.imul(z, 0x6c078965) + 1) >>> 0];
}
/** RandN::SetSeed uses four independent lanes spaced by 0x16f, not four draws. */
export function seedParticleRandomLanes(seed: number): ParticleRandomLanes {
  uint(seed);
  return [0, 1, 2, 3].map((i) => seedParticleRandom((seed + i * 0x16f) >>> 0)) as ParticleRandomLanes;
}
export function nextParticleRandom(state: readonly number[]): { state: ParticleRandomState; value: number } {
  const [x, y, z, w] = checkedRandom(state), t = (x ^ (x << 11)) >>> 0;
  const value = (w ^ (w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
  return { state: [y, z, w, value], value };
}
export function nextParticleRandomFloat(state: readonly number[]): { state: ParticleRandomState; value: number } {
  const next = nextParticleRandom(state);
  return { state: next.state, value: f((next.value & 0x7fffff) * randomScale) };
}
export function nextParticleRandomLanes(state: readonly ParticleRandomState[], asFloat: boolean): { state: ParticleRandomLanes; values: [number, number, number, number] } {
  if (!Array.isArray(state) || state.length !== 4 || typeof asFloat !== "boolean") throw new Error("Incomplete native particle random lanes");
  const next = state.map((lane) => asFloat ? nextParticleRandomFloat(lane) : nextParticleRandom(lane));
  return { state: next.map((v) => v.state) as ParticleRandomLanes, values: next.map((v) => v.value) as [number, number, number, number] };
}

/** The caller owns the one shared ParticleSystemManager random stream. The
 * source manager obtains its initial 16 bytes from system entropy. Missing
 * automatic state is unknown, never replaced by the serialized randomSeed=0.
 * This covers the actual Initial/Shape/Emission/Noise reset subset; it is not
 * ParticleSystem.Play or prewarm and does not reset other enabled modules. */
export function resetParticleEmitterRandom(
  input: { seed: number; autoRandomSeed: boolean },
  manager: ParticleRandomState | null,
): { emitter: ParticleEmitterRandomState; manager: ParticleRandomState | null } {
  uint(input.seed);
  if (typeof input.autoRandomSeed !== "boolean") throw new Error("Unknown particle automatic seed mode");
  let seed = input.seed, nextManager = manager === null ? null : checkedRandom(manager);
  if (input.autoRandomSeed) {
    if (nextManager === null) throw new Error("Native particle manager entropy/random state is unavailable");
    const next = nextParticleRandom(nextManager); seed = next.value; nextManager = next.state;
  }
  return { emitter: { seed, initial: seedParticleRandomLanes(seed), shape: seedParticleRandomLanes(seed),
    emission: seedParticleRandom(seed), noiseScroll: 0 }, manager: nextManager };
}

export function createParticleEmissionState(random: ParticleRandomState): ParticleEmissionState {
  // ResetSeeds clears the two words before the emission RNG, including spacing.
  return { random: checkedRandom(random), fractionalCount: 0, spacing: 0 };
}
export function validateParticleEmissionPlan(plan: ParticleEmissionPlan): void {
  if (plan.kind !== "unity-constant-particle-emission-v1" || finite(plan.duration) <= 0 || !Array.isArray(plan.bursts)) throw new Error("Invalid native particle emission plan");
  finite(plan.rate);
  plan.bursts.forEach((b) => {
    if (finite(b.time) < 0 || b.time > plan.duration || finite(b.count) < 0 || finite(b.count) >= 0x80000000 || !Number.isInteger(b.cycles) || b.cycles < 1 || b.cycles > 0x7fffffff || finite(b.interval) <= 0 || finite(b.probability) < 0 || b.probability > 1)
      throw new Error("Unsupported native particle burst");
  });
}

/** Exact constant-rate/count path of EmissionModule::EmitOverTime. Inputs are
 * already source clock times, not a Web wall-clock delta. A wrap follows the
 * source two calls, preserving their RNG order. Capacity/particle births,
 * prewarm scheduling and motion are owned by later providers. */
export function emitParticleInterval(
  plan: ParticleEmissionPlan,
  prior: Readonly<ParticleEmissionState>,
  input: { previousTime: number; currentTime: number },
): ParticleEmissionResult {
  validateParticleEmissionPlan(plan);
  const duration = finite(plan.duration), previous = Math.max(0, finite(input.previousTime)), current = Math.max(0, finite(input.currentTime));
  // Update1Incremental nudges the old clock by 1e-6 for a duration-sized
  // catch-up step, so an exact loop still emits. This is a source interval,
  // not permission for an arbitrary out-of-range caller time.
  if (previous > f(duration + f(0.000001)) || current > duration) throw new Error("Particle emission times require a source clock interval");
  const fraction = finite(prior.fractionalCount);
  if (fraction < 0 || fraction >= 1 || finite(prior.spacing) < 0) throw new Error("Invalid native particle emission accumulation");
  // Source advances the continuous-rate sample unconditionally, even for a
  // constant/disabled-zero rate. Omitting it shifts every later burst draw.
  let random = nextParticleRandomFloat(checkedRandom(prior.random)).state;
  const rate = Math.max(0, finite(plan.rate));
  const amount = current < previous
    ? f(f(rate * current) + f(rate * f(duration - previous)))
    : f(rate * f(current - previous));
  let burstCount = 0;
  const accumulate = (from: number, to: number, allowCycles: boolean): void => {
    for (const burst of plan.bursts) {
      const time = f(burst.time), interval = f(burst.interval);
      let fires = time >= from && time < to;
      if (!fires && allowCycles && burst.cycles !== 1 && time < from) {
        const cycle = f(f(from - time) / interval), toCycle = f(f(to - time) / interval);
        if (cycle >= 0x80000000 || toCycle >= 0x80000000) throw new Error("Particle burst cycle conversion exceeds the admitted range");
        fires = cycle < f(burst.cycles - 1) && Math.trunc(cycle) < Math.trunc(toCycle);
      }
      const probability = f(burst.probability);
      if (!fires || probability === 0) continue;
      if (probability < 1) {
        const next = nextParticleRandomFloat(random); random = next.state;
        if (probability <= next.value) continue;
      }
      burstCount += Math.trunc(f(burst.count));
      if (burstCount > 0x7fffffff) throw new Error("Particle burst count overflow is not admitted");
    }
  };
  if (previous > current) {
    accumulate(0, current, true);
    accumulate(previous, f(duration + rateEpsilon), false);
  } else accumulate(previous, current, true);
  const accumulated = f(amount + fraction), continuousCount = Math.trunc(accumulated);
  if (!Number.isSafeInteger(continuousCount) || continuousCount > 0x7fffffff) throw new Error("Particle emission count exceeds the admitted range");
  return { state: { random, fractionalCount: f(accumulated - f(continuousCount)), spacing: amount >= rateEpsilon ? f(1 / amount) : 1 },
    continuousCount, burstCount, totalCount: continuousCount + burstCount };
}

/** ParticleSystemState::Tick; the timestep remains an explicit engine input.
 * Loop subtraction is intentionally float32 and iterative rather than `%`.
 * The finite loop budget rejects unrealistic host input before publication. */
export function tickParticleSystemClock(state: { time: number; loops: number }, delta: number, definition: { duration: number; looping: boolean }): { time: number; loops: number } {
  let time = finite(finite(state.time) + finite(delta)); const duration = finite(definition.duration);
  let loops = uint(state.loops);
  if (state.time < 0 || delta < 0 || duration <= 0 || typeof definition.looping !== "boolean") throw new Error("Invalid native particle clock input");
  if (!definition.looping) return { time: Math.min(time, duration), loops };
  let iterations = 0;
  while (time >= duration) {
    if (++iterations > 4096) throw new Error("Particle clock interval exceeds the admitted loop budget");
    const next = f(time - duration);
    if (next === time) throw new Error("Particle clock cannot advance at this precision");
    time = next; loops = (loops + 1) >>> 0;
  }
  return { time, loops };
}
