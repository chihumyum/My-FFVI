import { createParticleEmissionState, emitParticleInterval, resetParticleEmitterRandom, tickParticleSystemClock,
  type ParticleEmissionPlan, type ParticleEmissionResult, type ParticleEmissionState, type ParticleRandomState } from "./field-particle-emitter.js";

export type ParticleTimeSettings = {
  fixedTimestep: number; maximumParticleTimestep: number; maximumTimestep: number; timeScale: number;
};
export type ParticleLifecycleDefinition = {
  kind: "field-particle-lifecycle-v1";
  emission: ParticleEmissionPlan;
  maximumLifetime: number;
  simulationSpeed: 1;
  looping: true;
  prewarm: true;
  clock: ParticleTimeSettings;
};
export type ParticleLifecycleState = {
  time: number; loops: number; accumulated: number; emission: ParticleEmissionState;
};
/** The owner must simulate existing particles before admitting each slice's
 * births. This schedule owns no particles, capacity, renderer or random lanes
 * other than the supplied emission stream. */
export type ParticleSimulationSlice = {
  delta: number; previousTime: number; time: number; frameOffset: number;
  emission: ParticleEmissionResult;
};

/** AddNewParticles in the ordinary ringBuffer=0 branch. SIMD writes start at
 * an aligned scratch tail and are compacted back to activeCount afterward;
 * padded lanes are never additional live particles. */
export function reserveParticleBirthBatch(input: { activeCount: number; maximumParticles: number; requested: number }): {
  startIndex: number; accepted: number; temporaryCount: number; reserveCapacity: number | null; finalCount: number;
} {
  const { activeCount, maximumParticles, requested } = input;
  for (const n of [activeCount, maximumParticles, requested]) if (!Number.isSafeInteger(n) || n < 0 || n > 0x7fffffff)
    throw new Error("Invalid native particle allocation count");
  const startIndex = Math.ceil(activeCount / 4) * 4;
  if (activeCount >= maximumParticles) return { startIndex, accepted: 0, temporaryCount: activeCount, reserveCapacity: null, finalCount: activeCount };
  const accepted = Math.min(requested, maximumParticles - activeCount), temporaryCount = Math.ceil((startIndex + accepted) / 4) * 4;
  return { startIndex, accepted, temporaryCount, reserveCapacity: Math.ceil(temporaryCount / 32) * 32, finalCount: activeCount + accepted };
}

/** StartModules' per-newborn timing after emission and capacity admission.
 * Source assets all have duration 1; other reciprocal-duration paths remain
 * unavailable. Continuous particles are aged within the slice, while burst
 * particles use the source minimum fraction 1e-6 (not zero). SIMD padding is
 * the birth provider's responsibility and is not returned as live timing. */
export function prepareParticleBirthTiming(input: { duration: number; currentTime: number; delta: number;
  emission: ParticleEmissionResult; acceptedCount: number }): {
    normalizedEmitterTime: number; birthDeltas: number[]; birthNormalizedTimes: number[];
  } {
  const { emission: e, acceptedCount: count } = input;
  if (input.duration !== 1) throw new Error("Unrecovered particle birth duration normalization");
  for (const n of [e.continuousCount, e.burstCount, e.totalCount, count]) if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("Invalid particle birth timing count");
  if (e.continuousCount + e.burstCount !== e.totalCount || count > e.totalCount || count > 1000)
    throw new Error("Invalid particle birth timing admission");
  const current = finite(input.currentTime), delta = finite(input.delta), spacing = finite(e.state.spacing), remainder = finite(e.state.fractionalCount);
  if (current < 0 || current > 1 || delta < 0 || spacing < 0 || remainder < 0 || remainder >= 1)
    throw new Error("Invalid particle birth timing interval");
  const previous = f(current - delta), birthDeltas: number[] = [], birthNormalizedTimes: number[] = [];
  for (let i = 0; i < count; i++) {
    const fraction = Math.max(epsilon, Math.min(1, i < e.continuousCount ? f(f(f(i) + remainder) * spacing) : 0));
    birthDeltas.push(f(fraction * delta));
    birthNormalizedTimes.push(Math.max(0, Math.min(1, f(f(f(previous - current) * fraction) + current))));
  }
  return { normalizedEmitterTime: current, birthDeltas, birthNormalizedTimes };
}
const f = Math.fround;
const epsilon = f(0.000001), emissionEpsilon = f(0.0001);
function finite(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error("Invalid particle lifecycle number");
  return f(value);
}
function positive(value: number): number {
  value = finite(value); if (value <= 0) throw new Error("Nonpositive particle lifecycle interval"); return value;
}
export function validateParticleTimeSettings(settings: ParticleTimeSettings): void {
  if (!settings || positive(settings.fixedTimestep) > positive(settings.maximumParticleTimestep) ||
      settings.fixedTimestep > positive(settings.maximumTimestep) || finite(settings.timeScale) !== 1)
    throw new Error("Unsupported source particle TimeManager settings");
}
function validateDefinition(definition: ParticleLifecycleDefinition): void {
  if (definition.kind !== "field-particle-lifecycle-v1" || definition.simulationSpeed !== 1 || definition.looping !== true || definition.prewarm !== true)
    throw new Error("Unsupported particle lifecycle branch");
  positive(definition.maximumLifetime); positive(definition.emission.duration);
  validateParticleTimeSettings(definition.clock);
}

/** GetTimeStep at 0x18e750, in the actual playing/scaled-time branch. The
 * incoming delta is already the engine's scaled delta, not wall-clock time. */
export function selectParticleSimulationStep(delta: number, fixedTimeStep: boolean, clock: ParticleTimeSettings): number {
  validateParticleTimeSettings(clock);
  delta = finite(delta);
  if (delta < 0 || typeof fixedTimeStep !== "boolean") throw new Error("Invalid particle timestep request");
  if (fixedTimeStep) return f(clock.fixedTimestep);
  const maximum = f(clock.maximumParticleTimestep);
  return delta > maximum ? f(delta / f(Math.ceil(f(delta / maximum)))) : delta;
}

/** ComputePrewarmStartParameters, looping/no-subemitters/source-prewarm path.
 * Its scratch emission visits are exposed as evidence of the discarded dry
 * run; they are not published to the live emission stream or particle array. */
export function prepareParticlePrewarm(definition: ParticleLifecycleDefinition, requestedTime = 0): {
  simulateSeconds: number; initialTime: number; scratchIntervals: { previousTime: number; currentTime: number }[];
} {
  validateDefinition(definition);
  requestedTime = finite(requestedTime);
  if (requestedTime < 0) throw new Error("Negative particle prewarm request");
  const lifetime = f(definition.maximumLifetime), timestep = f(definition.clock.fixedTimestep), duration = f(definition.emission.duration);
  const remainder = f(requestedTime % timestep);
  const simulateSeconds = f(f(lifetime + remainder) / Math.max(f(0.001), definition.simulationSpeed));
  const rawStart = f(f(requestedTime - lifetime) - remainder);
  let start = rawStart;
  if (start < 0) {
    const cycles = Math.ceil(f(-f(start / duration)));
    if (!Number.isSafeInteger(cycles) || cycles >= 0x80000000) throw new Error("Particle prewarm cycle conversion overflow");
    start = f(f(f(cycles) * duration) + start);
  }
  const end = f(Math.abs(rawStart) + start);
  if (f(start + timestep) <= start || f(end + timestep) <= end) throw new Error("Particle prewarm cannot advance at source precision");
  const initialTime = f(start % duration), scratchIntervals = [];
  let previous = start;
  while (f(start + emissionEpsilon) < end) {
    if (scratchIntervals.length >= 65536) throw new Error("Particle prewarm exceeds the admitted work budget");
    start = f(start + timestep);
    scratchIntervals.push({ previousTime: f(previous % duration), currentTime: f(start % duration) });
    previous = start;
  }
  return { simulateSeconds, initialTime, scratchIntervals };
}

/** Source Play(true) on a stopped, active, looping and prewarmed system resets
 * seeds three times: Play, Simulate(restart), then its nested Play(false).
 * All three consume the same manager stream. The host must apply birth/motion
 * to the returned schedule before publishing any of these candidate values.
 * This does not model resume, disabled objects or arbitrary Simulate seeks. */
export function prepareStoppedParticlePlay(definition: ParticleLifecycleDefinition,
  input: { seed: number; autoRandomSeed: boolean }, manager: ParticleRandomState | null) {
  validateDefinition(definition);
  let reset = resetParticleEmitterRandom(input, manager);
  for (let i = 1; i < 3; i++) reset = resetParticleEmitterRandom({ ...input, seed: reset.emitter.seed }, reset.manager);
  const prewarm = prepareParticlePrewarm(definition);
  const initialState: ParticleLifecycleState = { time: prewarm.initialTime, loops: 0, accumulated: 0,
    emission: createParticleEmissionState(reset.emitter.emission) };
  const simulation = scheduleParticleSimulation(definition, initialState,
    { delta: prewarm.simulateSeconds, fixedTimeStep: true, allowCatchUpStepGrowth: true });
  return { initialRandom: reset.emitter, manager: reset.manager, prewarm, initialState, simulation };
}

/** Update1b's scaled-time admission followed by Update1Incremental's exact
 * accumulator loop. Module and particle providers execute the returned slices
 * in order into the same private owner candidate; this alone cannot admit a
 * complete emitter. Start-delay, procedural and nonlooping paths stay closed. */
export function scheduleParticleSimulation(definition: ParticleLifecycleDefinition, prior: ParticleLifecycleState,
  input: { delta: number; fixedTimeStep: boolean; allowCatchUpStepGrowth: boolean }): {
    state: ParticleLifecycleState; step: number; slices: ParticleSimulationSlice[];
  } {
  validateDefinition(definition);
  let accumulated = finite(prior.accumulated), time = finite(prior.time), loops = prior.loops;
  if (accumulated < 0 || time < 0 || time >= definition.emission.duration || !Number.isInteger(loops) || loops < 0 || loops > 0xffffffff ||
      typeof input.allowCatchUpStepGrowth !== "boolean") throw new Error("Invalid particle lifecycle state or update flags");
  let emission = structuredClone(prior.emission);
  // Validate the copied emission state even when a zero/short update would do
  // no work, without consuming the resulting trial draw.
  emitParticleInterval(definition.emission, emission, { previousTime: time, currentTime: time });
  const delta = finite(input.delta), step = selectParticleSimulationStep(delta, input.fixedTimeStep, definition.clock);
  const slices: ParticleSimulationSlice[] = [];
  if (step < f(0.00001)) return { state: { time, loops, accumulated, emission }, step, slices };
  accumulated = finite(f(accumulated + delta));
  const threshold = input.fixedTimeStep ? step : epsilon, duration = f(definition.emission.duration);
  let priorSlice = step;
  while (threshold <= accumulated) {
    if (slices.length >= 65536) throw new Error("Particle update exceeds the admitted work budget");
    let slice = Math.min(step, accumulated);
    if (input.allowCatchUpStepGrowth) {
      if (accumulated > 10) slice = priorSlice <= 1 ? Math.min(duration, 1) : priorSlice;
      else if (accumulated > 5) slice = priorSlice <= f(0.2) ? Math.min(duration, f(0.2)) : priorSlice;
    }
    const previousTime = slice >= duration ? f(time + epsilon) : time;
    const clock = tickParticleSystemClock({ time, loops }, slice, { duration, looping: true });
    time = clock.time; loops = clock.loops;
    const frameOffset = Math.max(0, f(f(accumulated / slice) - 1));
    const result = emitParticleInterval(definition.emission, emission, { previousTime, currentTime: time });
    emission = result.state;
    slices.push({ delta: slice, previousTime, time, frameOffset, emission: result });
    const next = f(accumulated - slice);
    if (next === accumulated) throw new Error("Particle update cannot advance at source precision");
    accumulated = next; priorSlice = slice;
  }
  return { state: { time, loops, accumulated, emission }, step, slices };
}
