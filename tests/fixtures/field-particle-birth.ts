import { particleModuleExport, sourceConstant } from "./field-particles.js";
import { UNITY_PARTICLE_ENGINE } from "../../src/compiler/field-particle-emitter.js";
import { UNITY_PARTICLE_BIRTH_BODIES, compileParticleBirthEngine, compileFieldParticleBirth } from "../../src/compiler/field-particle-birth.js";
import { seedParticleRandomLanes } from "../../src/core/field-particle-emitter.js";
import type { ParticleBirthBatchInput } from "../../src/core/field-particle-birth.js";

export const controlledBirthEvidence = () => ({ kind: "unity-particle-native-inspection-v1", semanticsVerified: false,
  native: { sha256: UNITY_PARTICLE_ENGINE.nativeSha256, imageBase: "0x180000000", versions: [UNITY_PARTICLE_ENGINE.version] },
  pdb: { sha256: UNITY_PARTICLE_ENGINE.pdbSha256, guid: UNITY_PARTICLE_ENGINE.pdbGuid, age: UNITY_PARTICLE_ENGINE.pdbAge },
  methods: Object.entries(UNITY_PARTICLE_BIRTH_BODIES).map(([rva, sha256]) => ({ rva, sha256 })) });
export function particleBirthExport() {
  const raw = particleModuleExport(), p = raw.objects.find((o) => o.type === "ParticleSystem")!.data;
  const initial = p.InitialModule as Record<string, unknown>;
  const between = (min: number, max: number) => ({ ...sourceConstant(max), minMaxState: 3, minScalar: min });
  initial.startLifetime = between(Math.fround(.3), Math.fround(.64)); initial.startSpeed = between(8, 12);
  initial.startSize = between(10, 14); initial.startRotation = between(0, Math.fround(6.283185));
  const nullPointer = () => ({ m_FileID: 0, m_PathID: "0" });
  p.ShapeModule = { enabled: true, type: 4, placementMode: 0, angle: 24, radiusThickness: 1,
    arc: { value: 360, mode: 0, spread: 0 }, radius: { value: 2, mode: 0, spread: 0 },
    m_Position: { x: 0, y: 0, z: 0 }, m_Rotation: { x: 40, y: 0, z: 0 }, m_Scale: { x: 1, y: 1, z: 1 },
    randomDirectionAmount: 0, sphericalDirectionAmount: 0, randomPositionAmount: 0, alignToDirection: false,
    m_Texture: nullPointer(), m_Mesh: nullPointer(), m_MeshRenderer: nullPointer(), m_SkinnedMeshRenderer: nullPointer(), m_Sprite: nullPointer(), m_SpriteRenderer: nullPointer() };
  return raw;
}
export const particleBirthDefinition = () => compileFieldParticleBirth("controlled_effect", particleBirthExport(), compileParticleBirthEngine([controlledBirthEvidence()]));
export const particleBirthRandom = (seed = 42) => ({ initial: seedParticleRandomLanes(seed), shape: seedParticleRandomLanes(seed) });
export const particleBirthInput = (count = 4): ParticleBirthBatchInput => ({ startIndex: 0, count, normalizedEmitterTime: .5,
  birthDeltas: Array.from({ length: count }, (_, i) => .01 * (i + 1)), birthNormalizedTimes: Array.from({ length: count }, (_, i) => .5 - .01 * i), simulationScale: [1, 1, 1] });
