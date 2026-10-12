import { z } from "zod";
import { record } from "./content.js";
import { compileFieldParticleModules } from "./field-particles.js";
import { validateParticleEmissionPlan, type FieldParticleEmitterDefinition, type ParticleEmissionPlan } from "../core/field-particle-emitter.js";

export const UNITY_PARTICLE_ENGINE = {
  nativeSha256: "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845",
  pdbSha256: "c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85",
  pdbGuid: "4420B376-89DD-4CFE-AEC8-2300F4A999D2", pdbAge: 1,
  version: "2019.4.20f1_6dd1c08eedfa",
} as const;

/** Full source bodies, including chained .pdata fragments. No RVA is accepted
 * merely because another Unity build has the same exported/mangled name. */
export const UNITY_PARTICLE_KERNEL_BODIES: Readonly<Record<string, string>> = {
  "0x191860": "048a4cceca0c52dec0a9e6176722c9098c5212ca40c060526484df2e4da06319",
  "0x18d790": "e0a8f12d6b2001b4fad33a7899b0ee4071fba6608df315f3f82b967044494d9e",
  "0x18e050": "d82e513a020329739b4320a16c931b2261cb401c2258c3255b3cdfb1493b29f8",
  "0x764ce0": "f506db1a8e1beffdc2b35f6bbffa3af5b959c287f6c1fa128e9f71b34ff8bda7",
  "0x20abb0": "c765a03e738a0ce5698ac94659104ee19b4299725b9be04a0e998a29347932f6",
  "0xda98f0": "361a1c722d32a8902317d195af5cda8342f2fc75b7a353489c2e4c82acb5b4c2",
  "0x1ae630": "4f09966643efe11c7013681aa9348981f1f02e20aaf536c4b05bb9868d43de63",
  "0x1af7e0": "34610ce5f86068ff6e021632c05126d1c34d4398fef5fa17ec714eb074b2e380",
  "0x1b0d30": "ef67449ec8e3646d7f5d2a0d03723ba25b392f218515f541c5674916902ccd1a",
  "0x184760": "a78e6e38cbe09454b21d4a6a1cd060ae934b1e1268b94d30aa59d7392401e863",
  "0x814370": "34fac960d01c7410660c0dc53814a8f81bdc1a5a9c946f5098f24fc24d435759",
  "0x206ce0": "929b1a49385c9e3712a925bb3edec78c54cae9bfe2447e50d070e098c4c80063",
  "0x1ae9a0": "159bf48b5dc2dcb0725405d7413f297b633d2b673341b255c184050094eeda8d",
  "0x1aeab0": "ce3abae90ec70f0a4cad96a919ca4fde9af0de53b93db8dd36fc2d087f81abf9",
};
const array = (value: unknown) => z.array(z.unknown()).parse(value);

/** Inspector inputs must already have their files verified by the source
 * adapter/checker. This binds the compiler to the reviewed version and body
 * digests; it never treats an arbitrary host-provided version string as proof. */
export function compileParticleEmitterEngine(inspections: readonly unknown[]): FieldParticleEmitterDefinition["engine"] {
  if (!Array.isArray(inspections) || !inspections.length) throw new Error("Missing native particle engine evidence");
  const methods = new Map<string, string>();
  for (const raw of inspections) {
    const input = record(raw), native = record(input.native), pdb = record(input.pdb);
    if (input.kind !== "unity-particle-native-inspection-v1" || input.semanticsVerified !== false ||
      native.sha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 || native.imageBase !== "0x180000000" ||
      !array(native.versions).includes(UNITY_PARTICLE_ENGINE.version) || pdb.sha256 !== UNITY_PARTICLE_ENGINE.pdbSha256 ||
      pdb.guid !== UNITY_PARTICLE_ENGINE.pdbGuid || pdb.age !== UNITY_PARTICLE_ENGINE.pdbAge)
      throw new Error("Particle engine evidence does not match the inspected source build");
    for (const item of array(input.methods)) {
      const method = record(item), rva = z.string().regex(/^0x[0-9a-f]+$/).parse(method.rva), hash = z.string().regex(/^[0-9a-f]{64}$/).parse(method.sha256);
      if (methods.has(rva) && methods.get(rva) !== hash) throw new Error("Conflicting native particle body evidence");
      methods.set(rva, hash);
    }
  }
  for (const [rva, hash] of Object.entries(UNITY_PARTICLE_KERNEL_BODIES)) if (methods.get(rva) !== hash)
    throw new Error("Missing or changed native particle kernel body " + rva);
  const { nativeSha256, pdbGuid, pdbAge, version } = UNITY_PARTICLE_ENGINE;
  return { nativeSha256, pdbGuid, pdbAge, version };
}

export function compileFieldParticleEmitter(assetGroup: string, raw: unknown, engine: FieldParticleEmitterDefinition["engine"]): FieldParticleEmitterDefinition {
  if (engine.nativeSha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 || engine.pdbGuid !== UNITY_PARTICLE_ENGINE.pdbGuid || engine.pdbAge !== 1 || engine.version !== UNITY_PARTICLE_ENGINE.version)
    throw new Error("Unsupported native particle emitter engine");
  const modules = compileFieldParticleModules(assetGroup, raw);
  if (modules.emission.rate.mode !== "constant") throw new Error("Native varying emission-rate evaluation is not admitted");
  const emission: ParticleEmissionPlan = { kind: "unity-constant-particle-emission-v1", source: structuredClone(modules.source),
    duration: Math.fround(modules.duration), rate: Math.fround(modules.emission.rate.value),
    bursts: modules.emission.bursts.map((burst) => {
      if (burst.count.mode !== "constant") throw new Error("Native varying burst-count evaluation is not admitted");
      return { time: Math.fround(burst.time), count: Math.fround(burst.count.value), cycles: burst.cycles,
        interval: Math.fround(burst.interval), probability: Math.fround(burst.probability) };
    }) };
  validateParticleEmissionPlan(emission);
  const blockers = ["Engine emission substep scheduling, capacity and birth dispatch", "Native motion/gravity integration and initial color quantization", "Particle renderer geometry/raster lifecycle"];
  if (modules.requirements.autoRandomSeed) blockers.push("Initial shared ParticleSystemManager system-entropy state");
  if (modules.requirements.prewarm) blockers.push("Prewarm TimeManager timestep and simulation update sequence");
  if (modules.requirements.shape) blockers.push("Native Cone sample consumption and shape transform order");
  if (modules.requirements.noise) blockers.push("Native Noise permutation/derivatives and position integration");
  if (modules.velocity) blockers.push("Serialized AnimationCurve infinity mapping outside keys");
  return { kind: "field-particle-emitter-kernel-v1", source: structuredClone(modules.source), engine: structuredClone(engine),
    simulation: { space: "local", scaling: "hierarchy", speed: 1, useUnscaledTime: false },
    random: { seed: modules.requirements.seed, autoRandomSeed: modules.requirements.autoRandomSeed }, emission,
    prewarm: modules.requirements.prewarm, blockers };
}
