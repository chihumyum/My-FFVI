import { particleModuleExport, sourceConstant } from "./field-particles.js";
import type { FieldParticleMotionDefinition, ParticleMotionSpace, ParticleMotionState, ParticleNoiseKernel } from "../../src/core/field-particle-motion.js";
import { PARTICLE_MOTION_BODIES, PARTICLE_GRAVITY_SOURCE } from "../../src/compiler/field-particle-motion.js";
import { UNITY_PARTICLE_ENGINE } from "../../src/compiler/field-particle-emitter.js";

/** Authored identity permutation/gradients; these are NOT Unity's tables. */
export const controlledNoiseKernel = (): ParticleNoiseKernel => ({ kind: "unity-particle-noise-kernel-v1", nativeSha256: UNITY_PARTICLE_ENGINE.nativeSha256,
  indexMask: 255, permutation: Array.from({ length: 512 }, (_, i) => i % 256),
  gradients: Array.from({ length: 16 }, (_, i) => ({ x: i % 2 ? 1 : -1, y: i % 4 < 2 ? 1 : -1, z: i % 8 < 4 ? 0 : 1 })) });
export const particleMotionDefinition = (): FieldParticleMotionDefinition => ({ kind: "unity-field-particle-motion-v1",
  source: { file: "synthetic", assetPath: "controlled/particle-motion", objectId: "3" }, kernel: controlledNoiseKernel(),
  noise: { frequency: Math.fround(.32), damping: true, inverseFrequency: 3.125, strength: 1, positionAmount: 1, scrollSpeed: Math.fround(.1) },
  gravityMultiplier: -.5, velocity: null, rotation: { min: 1, max: -1, bySpeed: false, randomizeDirection: 0 } });
export const particleMotionState = (): ParticleMotionState => ({ seed: 42, agePercent: 0, inverseLifetime: .5,
  position: { x: .25, y: -.5, z: 1 }, velocity: { x: 1, y: 2, z: 3 }, animatedVelocity: { x: 4, y: 5, z: 6 }, rotationZ: .2, angularVelocityZ: .5 });
export const particleMotionSpace = (): ParticleMotionSpace => ({ gravity: { x: 0, y: Math.fround(-9.81), z: 0 }, worldToLocal: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
export const controlledMotionEvidence = () => ({ kind: "unity-particle-native-inspection-v1", semanticsVerified: false,
  native: { sha256: UNITY_PARTICLE_ENGINE.nativeSha256, imageBase: "0x180000000", versions: [UNITY_PARTICLE_ENGINE.version] },
  pdb: { sha256: UNITY_PARTICLE_ENGINE.pdbSha256, guid: UNITY_PARTICLE_ENGINE.pdbGuid, age: UNITY_PARTICLE_ENGINE.pdbAge },
  methods: Object.entries(PARTICLE_MOTION_BODIES).map(([rva, sha256]) => ({ rva, sha256 })) });
export const particleGravityExport = () => ({ formatVersion: 1, adapterVersion: "field-particle-motion-0.1.0",
  parentSourceSetHash: "8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed", sourceSetHash: "4580ec9c9753565b50ba9c682dcfa42ea7a2ddd64b331bfdb5ef8affca02cf63",
  sources: [{ file: String(PARTICLE_GRAVITY_SOURCE.file), sha256: String(PARTICLE_GRAVITY_SOURCE.sha256) }],
  physicsManager: { type: "PhysicsManager", source: { ...PARTICLE_GRAVITY_SOURCE, objectId: String(PARTICLE_GRAVITY_SOURCE.objectId) }, gravity: { x: 0, y: Math.fround(-9.81), z: 0 } } });
export function particleMotionExport() {
  const raw = particleModuleExport(), p = raw.objects.find((o) => o.type === "ParticleSystem")!.data;
  p.NoiseModule = { enabled: true, quality: 2, octaves: 1, separateAxes: false, remapEnabled: false, frequency: Math.fround(.32), damping: true,
    strength: sourceConstant(1), strengthY: sourceConstant(1), strengthZ: sourceConstant(1), positionAmount: sourceConstant(1),
    rotationAmount: sourceConstant(0), sizeAmount: sourceConstant(0), scrollSpeed: sourceConstant(Math.fround(.1)) };
  p.RotationModule = { enabled: true, separateAxes: false, curve: { ...sourceConstant(-1), minMaxState: 3, minScalar: 1 } };
  return raw;
}
