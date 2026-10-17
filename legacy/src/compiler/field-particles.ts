import { z } from "zod";
import { record } from "./content.js";
import { compileFieldEffectMedia } from "./field-effects.js";
import type { Evidence } from "../field/types.js";
import type { FieldParticleMaterial, FieldParticleModules, ParticleColor, ParticleColorCurve, ParticleCurve, ParticleGradient, ParticleKey } from "../core/field-particles.js";

const number = (v: unknown) => z.number().finite().refine((n) => Number.isFinite(Math.fround(n))).parse(v);
const integer = (v: unknown) => z.number().int().safe().parse(v);
const bool = (v: unknown) => z.boolean().parse(v);
const array = (v: unknown) => z.array(z.unknown()).parse(v);
const text = (v: unknown) => z.string().min(1).parse(v);
const id = (v: unknown) => z.string().regex(/^-?\d+$/).parse(v);
const sha = (v: unknown) => z.string().regex(/^[0-9a-f]{64}$/).parse(v);
const color = (v: unknown): ParticleColor => { const c = record(v); return { r: number(c.r), g: number(c.g), b: number(c.b), a: number(c.a) }; };
const evidence = (v: unknown): Evidence => {
  const r = record(v); text(r.file); sha(r.sha256); id(r.objectId); text(r.assetPath); text(r.serializedFile);
  return structuredClone(r) as Evidence;
};

function keys(raw: unknown): ParticleKey[] {
  const c = record(raw);
  // Keep infinity outside the admitted query domain; code 2 is not blindly
  // converted to a public WrapMode enum, whose numeric values differ.
  if (integer(c.m_PreInfinity) !== 2 || integer(c.m_PostInfinity) !== 2) throw new Error("Unknown serialized curve infinity mode");
  const result = array(c.m_Curve).map((rawKey) => {
    const k = record(rawKey);
    if (integer(k.weightedMode) !== 0) throw new Error("Weighted particle curves are unavailable");
    number(k.inWeight); number(k.outWeight);
    return { time: number(k.time), value: number(k.value), inSlope: number(k.inSlope), outSlope: number(k.outSlope) };
  });
  if (!result.length || result.some((k, i) => k.time < 0 || k.time > 1 || (i > 0 && k.time <= result[i - 1]!.time))) throw new Error("Invalid active particle curve keys");
  return result;
}
export function compileParticleCurve(raw: unknown): ParticleCurve {
  const c = record(raw), mode = integer(c.minMaxState), max = number(c.scalar), min = number(c.minScalar);
  switch (mode) {
    case 0: return { mode: "constant", value: max };
    case 1: return { mode: "curve", multiplier: max, keys: keys(c.maxCurve) };
    case 2: return { mode: "two-curves", multiplier: max, min: keys(c.minCurve), max: keys(c.maxCurve) };
    case 3: return { mode: "two-constants", min, max };
    default: throw new Error("Unknown serialized particle curve mode " + mode);
  }
}
function gradient(raw: unknown): ParticleGradient {
  const g = record(raw), mode = integer(g.m_Mode), colors = integer(g.m_NumColorKeys), alpha = integer(g.m_NumAlphaKeys);
  if (mode === 1) throw new Error("Fixed-gradient boundary semantics are not admitted");
  if (![0, 1].includes(mode) || colors < 1 || colors > 8 || alpha < 1 || alpha > 8) throw new Error("Invalid source particle gradient");
  const time = (key: string) => { const t = integer(g[key]); if (t < 0 || t > 65535) throw new Error("Invalid gradient quantized time"); return Math.fround(t / 65535); };
  const result: ParticleGradient = {
    mode: "blend",
    colors: Array.from({ length: colors }, (_, i) => { const c = color(g["key" + i]); return { time: time("ctime" + i), color: { r: c.r, g: c.g, b: c.b } }; }),
    alpha: Array.from({ length: alpha }, (_, i) => ({ time: time("atime" + i), value: color(g["key" + i]).a })),
  };
  for (const lane of [result.colors, result.alpha]) if (lane.some((key, i) => i > 0 && key.time <= lane[i - 1]!.time)) throw new Error("Unordered source gradient");
  return result;
}
export function compileParticleColor(raw: unknown): ParticleColorCurve {
  const c = record(raw), mode = integer(c.minMaxState);
  switch (mode) {
    case 0: return { mode: "color", color: color(c.maxColor) };
    case 1: return { mode: "gradient", gradient: gradient(c.maxGradient) };
    case 2: return { mode: "two-colors", min: color(c.minColor), max: color(c.maxColor) };
    case 3: return { mode: "two-gradients", min: gradient(c.minGradient), max: gradient(c.maxGradient) };
    case 4: return { mode: "random-color", gradient: gradient(c.maxGradient) };
    default: throw new Error("Unknown particle gradient mode");
  }
}
function constant(value: unknown, expected: number): void {
  const c = compileParticleCurve(value); if (c.mode !== "constant" || c.value !== expected) throw new Error("Unimplemented particle module dependency");
}
export function compileFieldParticleModules(assetGroup: string, raw: unknown): FieldParticleModules {
  compileFieldEffectMedia(assetGroup, raw); // Validate exact graph, PPtrs and source identities first.
  const input = record(raw), hierarchy = new Set(array(input.hierarchyIds).map(id));
  const particles = array(input.objects).map(record).filter((o) => o.type === "ParticleSystem" && hierarchy.has(id(record(o.source).objectId)));
  if (particles.length !== 1) throw new Error("Multi-emitter particle modules are not admitted");
  const particle = particles[0]!, p = record(particle.data), initial = record(p.InitialModule), emission = record(p.EmissionModule);
  const known = new Set(["InitialModule", "EmissionModule", "ColorModule", "SizeModule", "RotationModule", "RotationBySpeedModule", "VelocityModule", "ShapeModule", "NoiseModule"]);
  for (const [key, value] of Object.entries(p)) if (key.endsWith("Module") && record(value).enabled === true && !known.has(key)) throw new Error("Unimplemented enabled particle module " + key);
  if (!bool(initial.enabled) || !bool(emission.enabled) || bool(initial.size3D) || bool(initial.rotation3D) || number(initial.randomizeRotationDirection) !== 0) throw new Error("Unimplemented initial particle mode");
  if (integer(p.moveWithTransform) !== 0 || integer(p.scalingMode) !== 0 || number(p.simulationSpeed) !== 1 || bool(p.useUnscaledTime) || integer(p.ringBufferMode) !== 0) throw new Error("Unimplemented particle clock/space mode");
  constant(p.startDelay, 0); constant(emission.rateOverDistance, 0);
  const enabled = (name: string) => { const m = record(p[name]); return bool(m.enabled) ? m : null; };
  const size = enabled("SizeModule"), c = enabled("ColorModule"), v = enabled("VelocityModule");
  if (size && bool(size.separateAxes)) throw new Error("Separate particle size axes are unavailable");
  if (v) {
    if (bool(v.inWorldSpace)) throw new Error("World particle animated velocity is unavailable");
    for (const key of ["orbitalX", "orbitalY", "orbitalZ", "orbitalOffsetX", "orbitalOffsetY", "orbitalOffsetZ", "radial"]) constant(v[key], 0);
    constant(v.speedModifier, 1);
  }
  const rotation = enabled("RotationModule"), bySpeed = enabled("RotationBySpeedModule");
  if (rotation && bySpeed) throw new Error("Combined particle rotation modules need source ordering");
  const r = rotation ?? bySpeed;
  if (r && bool(r.separateAxes)) throw new Error("Separate particle rotation axes are unavailable");
  const range = bySpeed ? record(bySpeed.range) : null;
  if (range && number(range.y) <= number(range.x)) throw new Error("Invalid source rotation speed range");
  const bursts = array(emission.m_Bursts).map((b) => {
    const burst = record(b), result = { time: number(burst.time), count: compileParticleCurve(burst.countCurve),
      cycles: integer(burst.cycleCount), interval: number(burst.repeatInterval), probability: number(burst.probability) };
    if (result.time < 0 || result.cycles < 1 || result.interval <= 0 || result.probability < 0 || result.probability > 1) throw new Error("Invalid source burst");
    return result;
  });
  if (integer(emission.m_BurstCount) !== bursts.length) throw new Error("Particle burst count mismatch");
  const duration = number(p.lengthInSec), maxParticles = integer(initial.maxNumParticles), seed = integer(p.randomSeed);
  if (duration <= 0 || maxParticles < 1 || seed < 0 || seed > 0xffffffff) throw new Error("Invalid source particle duration/capacity/seed");
  const autoRandomSeed = bool(p.autoRandomSeed), prewarm = bool(p.prewarm), shape = enabled("ShapeModule"), noise = enabled("NoiseModule");
  const blockers = ["Native emission substep/burst ordering and capacity policy", "Native motion/gravity integration and initial color quantization", "Particle renderer billboard/transform and raster sampling lifecycle"];
  if (autoRandomSeed) blockers.push("Native autoRandomSeed acquisition and per-module random stream");
  else blockers.push("Native fixed-seed per-module random stream");
  if (prewarm) blockers.push("Native prewarm timestep and initial simulation state");
  if (shape) blockers.push("Native shape sampling and transform order (type " + integer(shape.type) + ")");
  if (noise) blockers.push("Native Curl/Perlin Noise permutation, seeds, derivatives and integration");
  if (v) blockers.push("Serialized AnimationCurve infinity mapping outside keys");
  return { kind: "field-particle-modules-v1", source: evidence(particle.source), duration, looping: bool(p.looping), maxParticles,
    start: { lifetime: compileParticleCurve(initial.startLifetime), speed: compileParticleCurve(initial.startSpeed), size: compileParticleCurve(initial.startSize), rotation: compileParticleCurve(initial.startRotation), color: compileParticleColor(initial.startColor) },
    size: size ? compileParticleCurve(size.curve) : null, color: c ? compileParticleColor(c.gradient) : null,
    velocity: v ? { x: compileParticleCurve(v.x), y: compileParticleCurve(v.y), z: compileParticleCurve(v.z) } : null,
    rotation: r ? { curve: compileParticleCurve(r.curve), bySpeed: range ? { min: number(range.x), max: number(range.y) } : null } : null,
    gravity: compileParticleCurve(initial.gravityModifier), emission: { rate: compileParticleCurve(emission.rateOverTime), bursts },
    requirements: { autoRandomSeed, seed, prewarm, shape: shape ? structuredClone(shape) : null, noise: noise ? structuredClone(noise) : null }, blockers };
}

export const FIELD_PARTICLE_SHADER = {
  vertex: "cc1c31f410babbf1d6f7cc837871cc885019379db245a8273bfb8f69c64fbdad",
  fragment: "75c814aca4b802512f88f5c9c6ea4cef7d925c3cb4c5d39fd59e55e8490754ff",
};
const keywords = ["ALPHA_EDGE_ON", "CUTOFF_ON", "GRDIENT_ON", "MASK_ON", "NOISE_ON", "PREMULTIPLYALPHA_ON"];
function properties(raw: unknown): Map<string, unknown> {
  const result = new Map<string, unknown>(); for (const item of array(raw)) {
    const pair = array(item); if (pair.length !== 2 || result.has(text(pair[0]))) throw new Error("Invalid duplicate material property");
    result.set(text(pair[0]), pair[1]);
  } return result;
}
/** Compile the actual selected shader variant, rather than infer the material
 * from its friendly name. Dependencies must be hash-verified by the caller. */
export function compileFieldParticleMaterial(assetGroup: string, rawDependencies: unknown): FieldParticleMaterial {
  const dep = record(rawDependencies); if (dep.formatVersion !== 1 || dep.unityVersion !== "2019.4.20f1") throw new Error("Unknown particle dependency package");
  const settings = record(dep.settings), settingsSource = record(settings.source);
  text(settingsSource.file); sha(settingsSource.sha256); id(settingsSource.objectId); text(settingsSource.serializedFile);
  if (settings.type !== "PlayerSettings") throw new Error("Unbound particle color-space settings");
  if (settings.activeColorSpace !== 0) throw new Error("Particle material requires explicit source gamma-space settings");
  const m = record(record(dep.materials)[assetGroup]), shader = record(record(dep.shaders)[text(m.shader)]), programs = record(shader.programs);
  if (shader.name !== "Last/LastEffectMaster" || sha(record(programs.progVertex).sha256) !== FIELD_PARTICLE_SHADER.vertex ||
      sha(record(programs.progFragment).sha256) !== FIELD_PARTICLE_SHADER.fragment || JSON.stringify(m.keywords) !== JSON.stringify(keywords))
    throw new Error("Particle shader variant has not been recovered");
  const saved = record(m.properties), floats = properties(saved.m_Floats), colors = properties(saved.m_Colors);
  const n = (key: string) => number(floats.get(key)), c = (key: string) => color(colors.get(key));
  if (n("_Src") !== 1 || n("_Dst") !== 10 || n("_ZWrite") !== 0 || n("_Cull") !== 0 || n("_AlphaMask") !== 15 || ![0, 1].includes(n("_BuiltInTime"))) throw new Error("Unimplemented particle render state");
  const state = record(shader.state);
  for (const [key, expected] of [["zTest", 4], ["zClip", 1], ["alphaToMask", 0]] as const) if (number(record(state[key]).val) !== expected) throw new Error("Unimplemented source particle shader state");
  if (record(state.culling).name !== "_Cull" || record(state.zWrite).name !== "_ZWrite" || state.lighting !== false)
    throw new Error("Unimplemented particle raster state binding");
  for (const key of ["offsetFactor", "offsetUnits"]) if (number(record(state[key]).val) !== 0) throw new Error("Particle depth bias is unavailable");
  for (const key of ["stencilOp", "stencilOpFront", "stencilOpBack"]) {
    const stencil = record(state[key]);
    for (const [operation, expected] of [["comp", 8], ["pass", 0], ["fail", 0], ["zFail", 0]] as const)
      if (number(record(stencil[operation]).val) !== expected) throw new Error("Particle stencil operation is unavailable");
  }
  const b = record(state.rtBlend0);
  for (const [key, expected] of [["srcBlend", "_Src"], ["destBlend", "_Dst"], ["srcBlendAlpha", "_Src"], ["destBlendAlpha", "_Dst"], ["colMask", "_AlphaMask"]] as const)
    if (record(b[key]).name !== expected) throw new Error("Particle shader blend binding changed");
  if (number(record(b.blendOp).val) !== 0 || number(record(b.blendOpAlpha).val) !== 0 || state.rtSeparateBlend !== false) throw new Error("Unimplemented particle blend operation");
  const texture = (key: string) => {
    const binding = record(record(m.textures)[key]), name = text(binding.key), t = record(record(dep.textures)[name]); evidence(t.source); sha(t.sha256);
    if (record(binding.scale).x !== 1 || record(binding.scale).y !== 1 || record(binding.offset).x !== 0 || record(binding.offset).y !== 0) throw new Error("Unimplemented particle texture transform binding");
    if (integer(t.width) < 1 || integer(t.height) < 1 || t.rowOrder !== "top-to-bottom" || t.mipLevel !== 0 || t.mipCount !== 1 || t.colorSpace !== 1 || ![0, 1].includes(integer(t.filterMode))) throw new Error("Unknown particle texture sampling metadata");
    const wrap = array(t.wrap).map(integer); if (wrap.length !== 2 || wrap.some((x) => x !== 0 && x !== 1)) throw new Error("Unknown particle texture wrap mode");
    return name;
  };
  const result: FieldParticleMaterial = { kind: "field-particle-material-v1", source: evidence(m.source), colorSpace: "gamma",
    fragmentSha256: FIELD_PARTICLE_SHADER.fragment, vertexSha256: FIELD_PARTICLE_SHADER.vertex,
    textures: { main: texture("_MainTex"), mask: texture("_MaskTex"), noise: texture("_NoiseTex") },
    tile: [n("_TileX"), n("_TileY")], baseOffset: [n("_BaseOffsetX"), n("_BaseOffsetY")], maskTile: [n("_MTileX"), n("_MTileY")], maskOffset: [n("_MOffsetX"), n("_MOffsetY")],
    noiseTile: [n("_NTileX"), n("_NTileY")], noiseOffset: n("_NOffsetX"), noiseScale: n("_NoiseScale"), noiseScroll: [n("_NoiseScrollX"), n("_NoiseScrollY")],
    flipX: n("_FlipX"), builtInTime: n("_BuiltInTime") as 0 | 1, emission: n("_Emission"), alphaEmission: n("_AEmission"), cutoff: n("_CutOffThreshold"),
    edge: { min: n("_AlphaEdgeMin"), max: n("_AlphaEdgeMax"), color: c("_AlphaEdgeColor") },
    gradient: { black: c("_GradientBlackColor"), white: c("_GradientWhiteColor") },
    blend: { source: 1, destination: 10, depthWrite: false, depthTest: 4, colorMask: 15, cull: 0 } };
  if (result.edge.max <= result.edge.min) throw new Error("Unimplemented source particle alpha edge interval");
  return result;
}
