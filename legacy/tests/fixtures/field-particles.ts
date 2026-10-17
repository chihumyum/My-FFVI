import type { FieldParticleMaterial, FieldParticleModules, FieldParticleRandom } from "../../src/core/field-particles.js";
import { effectMediaExport } from "./field-effects.js";

export const particleRandom = (): FieldParticleRandom => ({ lifetime: 0.5, speed: 0.5, size: 0.5, rotation: 0.5, color: 0.5,
  sizeOverLife: 0.5, colorOverLife: 0.5, velocityX: 0.5, velocityY: 0.5, velocityZ: 0.5, rotationOverLife: 0.5, gravity: 0.5 });
export const white = () => ({ r: 1, g: 1, b: 1, a: 1 });
export const constant = (value: number) => ({ mode: "constant" as const, value });
export function particleModules(): FieldParticleModules {
  return { kind: "field-particle-modules-v1", source: { file: "synthetic", assetPath: "controlled/EffectPrefab", objectId: "3" }, duration: 1, looping: true, maxParticles: 100,
    start: { lifetime: { mode: "two-constants", min: 2, max: 4 }, speed: constant(2), size: constant(8), rotation: constant(0), color: { mode: "color", color: white() } },
    size: { mode: "curve", multiplier: 1, keys: [{ time: 0, value: 0, inSlope: 0, outSlope: 1 }, { time: 1, value: 1, inSlope: 1, outSlope: 0 }] },
    color: { mode: "gradient", gradient: { mode: "blend", colors: [{ time: 0, color: white() }, { time: 1, color: white() }], alpha: [{ time: 0, value: 1 }, { time: 1, value: 0 }] } },
    velocity: null, rotation: { curve: { mode: "two-constants", min: 1, max: -1 }, bySpeed: null }, gravity: constant(-0.5),
    emission: { rate: constant(8), bursts: [{ time: 0, count: constant(1), cycles: 1, interval: 0.1, probability: 1 }] },
    requirements: { autoRandomSeed: true, seed: 0, prewarm: true, shape: null, noise: { enabled: true } },
    blockers: ["controlled unavailable Noise/RNG/prewarm"] };
}
export function particleMaterial(): FieldParticleMaterial {
  return { kind: "field-particle-material-v1", source: { file: "synthetic", assetPath: "controlled/Material", objectId: "6" }, fragmentSha256: "f".repeat(64), vertexSha256: "a".repeat(64),
    colorSpace: "gamma", textures: { main: "main", mask: "mask", noise: "noise" }, tile: [1, 1], baseOffset: [0, 0], maskTile: [1, 1], maskOffset: [0, 0],
    noiseTile: [1, 1], noiseOffset: 0, noiseScale: 0, noiseScroll: [0.2, 0.2], flipX: 0, builtInTime: 1, emission: 0, alphaEmission: 0, cutoff: 0.1,
    edge: { min: 0.1, max: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } }, gradient: { black: { r: 0, g: 0, b: 0, a: 1 }, white: white() },
    blend: { source: 1, destination: 10, depthWrite: false, depthTest: 4, colorMask: 15, cull: 0 } };
}
export const sourceConstant = (value: number) => ({ minMaxState: 0, scalar: value, minScalar: -999,
  maxCurve: { m_PreInfinity: 2, m_PostInfinity: 2, m_Curve: [] }, minCurve: { m_PreInfinity: 2, m_PostInfinity: 2, m_Curve: [] } });
export function particleModuleExport() {
  const e = effectMediaExport(), p = e.objects.find((o) => o.type === "ParticleSystem")!.data;
  Object.assign(p, { lengthInSec: 1, randomSeed: 0, moveWithTransform: 0, scalingMode: 0, simulationSpeed: 1, useUnscaledTime: false,
    ringBufferMode: 0, startDelay: sourceConstant(0), InitialModule: { enabled: true, size3D: false, rotation3D: false, randomizeRotationDirection: 0,
      startLifetime: sourceConstant(3), startSpeed: sourceConstant(0), startSize: sourceConstant(10), startRotation: sourceConstant(0),
      startColor: { minMaxState: 0, maxColor: white() }, gravityModifier: sourceConstant(0), maxNumParticles: 1000 },
    EmissionModule: { enabled: true, rateOverDistance: sourceConstant(0), rateOverTime: sourceConstant(10), m_BurstCount: 1,
      m_Bursts: [{ time: 0, countCurve: sourceConstant(1), cycleCount: 1, repeatInterval: 0.1, probability: 1 }] },
    SizeModule: { enabled: false }, ColorModule: { enabled: false }, VelocityModule: { enabled: false }, RotationModule: { enabled: false },
    RotationBySpeedModule: { enabled: false }, ShapeModule: { enabled: false } });
  return e;
}
