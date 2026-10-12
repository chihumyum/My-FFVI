import { UNITY_PARTICLE_ENGINE } from "../../src/compiler/field-particle-emitter.js";
import { UNITY_PARTICLE_ARRAY_BODIES, compileFieldParticleArray, compileParticleArrayEngine } from "../../src/compiler/field-particle-array.js";
import { particleModuleExport } from "./field-particles.js";

export const controlledArrayEvidence = () => ({ kind: "unity-particle-native-inspection-v1", semanticsVerified: false,
  native: { sha256: UNITY_PARTICLE_ENGINE.nativeSha256, imageBase: "0x180000000", versions: [UNITY_PARTICLE_ENGINE.version] },
  pdb: { sha256: UNITY_PARTICLE_ENGINE.pdbSha256, guid: UNITY_PARTICLE_ENGINE.pdbGuid, age: UNITY_PARTICLE_ENGINE.pdbAge },
  methods: Object.entries(UNITY_PARTICLE_ARRAY_BODIES).map(([rva, sha256]) => ({ rva, sha256 })) });
export function particleArrayExport() {
  const raw = particleModuleExport(), p = raw.objects.find((o) => o.type === "ParticleSystem")!.data;
  for (const key of ["CollisionModule", "SubModule", "TrailModule", "TriggerModule", "ClampVelocityModule"]) p[key] = { enabled: false };
  return raw;
}
export const particleArrayDefinition = () => compileFieldParticleArray("controlled_effect", particleArrayExport(), compileParticleArrayEngine([controlledArrayEvidence()]));
export const arrayRecord = (id: number, agePercent = 0) => ({ id, agePercent, seed: id + 42, position: { x: id, y: -id, z: 0 },
  velocity: { x: .5, y: 1, z: 2 }, startSize: id + 1, startColor32: 0xffffff00 + id, finalSize: id + .5, finalColor32: 0xffffff00 + id,
  retained: { label: "record-" + id } });
