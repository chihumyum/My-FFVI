import { createHash } from "node:crypto";
import { z } from "zod";
import type { ParticleVector } from "../core/field-particles.js";
import { validateFieldParticleMotion, validateParticleNoiseKernel, type FieldParticleMotionDefinition, type ParticleNoiseKernel } from "../core/field-particle-motion.js";
import { record } from "./content.js";
import { compileFieldParticleModules, compileParticleCurve } from "./field-particles.js";
import { UNITY_PARTICLE_ENGINE } from "./field-particle-emitter.js";

export const PARTICLE_GRAVITY_SOURCE = {
  file: "FINAL FANTASY VI_Data/globalgamemanagers", objectId: "10", serializedFile: "globalgamemanagers",
  sha256: "bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881",
} as const;
export const PARTICLE_MOTION_TABLES = {
  permutation: { rva: "0x1455070", sha256: "0e2324949e99f3333c190a2d72dc1c4d3d195a1d6f548fa73962188ff3868b07" },
  gradients: { rva: "0x176bf90", sha256: "67c53b10552ee2b3b2ea8244c93eb496ea0f3949f787e99f101090fe7d709c63" },
  maskInitializer: { rva: "0x6cb30", sha256: "c4407994fd204e9237ef6e9432ef3b0685ac761bfac158026e634e27cf819251" },
} as const;
// Body hashes qualify the inspected implementation; the checker re-reads the
// original DLL/PDB and decompiler receipts independently on every run.
export const PARTICLE_MOTION_BODIES: Readonly<Record<string, string>> = {
  "0x20e2d0": "5d1150d722dd3dc8948f0d725076af4eef6507a2cee4a07ab36f74024b20d759",
  "0x1f4370": "0fff6520d4ee98a3f9dac270563dc9e14723aa0772617414b97790860b6b44b2",
  "0x1fe0b0": "83726537ba056df7fbe05a93173d972733369efee6c5d8faeb80636bd1084914",
  "0x209830": "0c22531eefff6d0c9d22d2fb93e5f9703ef547a7a91a44ec3ad4b853319c5e57",
  "0x208a60": "51c95c7855d7e0a6bae38865b780752ec48431775ad1dc4cdfdb4ccbc5b447c8",
  "0x6cb30": "c4407994fd204e9237ef6e9432ef3b0685ac761bfac158026e634e27cf819251",
  "0x185510": "4753f6d9a19b57d280c6cdbe6666f5c4b42118ea691a8c5ecfd9d93b724cea3d",
  "0x190050": "981a1efbbfb9808fbbd455aee9e8fe2323a505f20495e7e3a8808cf5d6e9791d",
  "0x1bbd70": "a013e5b6fc249f243cb4318b627a6b4dff02e950b12245a2b295a9dca6baa0bc",
  "0x19e430": "3ad425516ef0b1571f27b7aec9937ec3fcfc64dcd985289c789d41b757d98df5",
  "0x25ef90": "f622be09a96ba446d22b60d5d215d3d4feb2be01a55d611359674fcf5249beda",
  "0x259970": "a349d6e0ad41268c922cd5c1b30a1197219cc643ed933568440fed12424b9223",
  "0x17df10": "95de0f66f37d6de97c5720a7cfee3473459b2e25154eb0081036dbcf107fb0b3",
  "0x18cbd0": "4a6ef5dfb17d40803b3cb2fb34ad57fee3078438d195e33eb61b56846dfdfb71",
  "0x75e4a0": "bc4df692044ccdb469eee94566da49695a13a1d405d459839e809126e505e2a3",
  "0x75d030": "7d812d52602aa0ad40e6ba97710a9d50d3495ab8c534eb443e5685b896a0e492",
  "0x760570": "ca0c846f086fd8f3f6375b8b4d8ee174e954d52d5098e938bbf42be192442fd4",
  "0xd6b40": "6f11f4bcf88468ccdf1de3147eab1755c752775f53bbf1c8ff81e0a65cc2a735",
  "0x208550": "df90522e221950481124def65abe5accade4c9bfd3c368b13df33e022fed9d11",
  "0x20d920": "9fb021f40d69bd5d93d9bef9c95586ba854d0451fa7b4553cb31863fabf0154c",
  "0x19a860": "bcb9e8a291888ef633c32494897c4acc2318052926a3f7d8206fc9357f86a3e7",
  "0x19a690": "1110afd86f027ab6d46a48274a3eb15cffb98ab1fc7aeb8c531505fe64c6bc13",
  "0x1947d0": "fb1338e83a1a841dc6fe6c92b8d9a84dfb04ec01f2fd9fb794e4615a51ac0f4b",
  "0x1957f0": "0e8aec77ebe332e81ac287149693daef0725f3ff4cce26730b8ac5ec3b581bec",
  "0x19a270": "cb7eeda858b6278f6ad569352fe91e9eb0b0c2a1c0a1489259e335d0cfcb771c",
  "0x762db0": "1d0081a2c93987e8ba65548e70603fb93566e46f9bff5dc1f79d17a61ada0640",
  "0x188150": "d0539be51dda753bd6110ef184d48be687eaf92bb5e58fb5be3800ca3d4f1a0c",
};
const list = (v: unknown) => z.array(z.unknown()).parse(v);
const number = (v: unknown) => z.number().finite().refine((n) => Number.isFinite(Math.fround(n))).parse(v);
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");

export function assertParticleMotionEvidence(inspections: readonly unknown[]): void {
  const methods = new Map<string, string>();
  for (const raw of inspections) {
    const input = record(raw), native = record(input.native), pdb = record(input.pdb);
    if (input.kind !== "unity-particle-native-inspection-v1" || input.semanticsVerified !== false ||
        native.sha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 || native.imageBase !== "0x180000000" ||
        !list(native.versions).includes(UNITY_PARTICLE_ENGINE.version) || pdb.sha256 !== UNITY_PARTICLE_ENGINE.pdbSha256 ||
        pdb.guid !== UNITY_PARTICLE_ENGINE.pdbGuid || pdb.age !== UNITY_PARTICLE_ENGINE.pdbAge) throw new Error("Unbound particle motion engine");
    for (const item of list(input.methods)) {
      const m = record(item), rva = z.string().parse(m.rva), sha = z.string().parse(m.sha256);
      if (methods.has(rva) && methods.get(rva) !== sha) throw new Error("Conflicting particle motion method identity");
      methods.set(rva, sha);
    }
  }
  for (const [rva, sha] of Object.entries(PARTICLE_MOTION_BODIES)) if (methods.get(rva) !== sha) throw new Error("Missing particle motion body " + rva);
}

/** The source lookup tables remain extracted data in the ignored content
 * package. No permutation/gradient arrays are baked into tracked fixtures. */
export function compileParticleMotionKernel(inspections: readonly unknown[], rawProbe: unknown): ParticleNoiseKernel {
  assertParticleMotionEvidence(inspections);
  const input = record(rawProbe), raw = record(input.kernel);
  if (input.kind !== "unity-particle-motion-instruction-probes-v1" || input.nativeSha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 || input.semanticsVerified !== false)
    throw new Error("Unbound particle motion lookup tables");
  const values: Record<string, number[]> = {};
  for (const [name, expected] of Object.entries(PARTICLE_MOTION_TABLES)) {
    const t = record(raw[name]), numbers = list(t.values).map(number), bytes = Buffer.alloc(numbers.length * (name === "maskInitializer" ? 1 : 4));
    for (const [i, n] of numbers.entries()) {
      if (name === "gradients") bytes.writeFloatLE(n, i * 4);
      else if (name === "permutation") { if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error("Invalid source permutation integer"); bytes.writeUInt32LE(n, i * 4); }
      else { if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error("Invalid source mask initializer byte"); bytes.writeUInt8(n, i); }
    }
    if (t.rva !== expected.rva || t.sha256 !== expected.sha256 || hash(bytes) !== expected.sha256) throw new Error("Changed source particle motion table " + name);
    values[name] = numbers;
  }
  if (JSON.stringify(raw.mask) !== "[255,255,255,255]") throw new Error("Uninitialized source Noise mask");
  const gradients = values.gradients!, permutation = values.permutation!;
  const kernel: ParticleNoiseKernel = { kind: "unity-particle-noise-kernel-v1", nativeSha256: UNITY_PARTICLE_ENGINE.nativeSha256,
    indexMask: 255, permutation, gradients: Array.from({ length: gradients.length / 3 }, (_, i) => ({ x: gradients[i * 3]!, y: gradients[i * 3 + 1]!, z: gradients[i * 3 + 2]! })) };
  validateParticleNoiseKernel(kernel); return kernel;
}

/** Compile only the recovered local-space motion stage. Birth, source Color /
 * Size modules, deletion/compaction and rendering keep their own admission. */
export function compileFieldParticleMotion(assetGroup: string, raw: unknown, kernel: ParticleNoiseKernel): FieldParticleMotionDefinition {
  validateParticleNoiseKernel(kernel);
  if (kernel.nativeSha256 !== UNITY_PARTICLE_ENGINE.nativeSha256) throw new Error("Motion kernel belongs to another engine");
  const modules = compileFieldParticleModules(assetGroup, raw), noise = record(modules.requirements.noise);
  if (noise.enabled !== true || noise.quality !== 2 || noise.octaves !== 1 || noise.separateAxes !== false || noise.remapEnabled !== false ||
      number(noise.frequency) !== Math.fround(.32) || noise.damping !== true) throw new Error("Unrecovered native Noise module branch");
  const constant = (value: unknown, expected?: number): number => {
    const c = compileParticleCurve(value);
    if (c.mode !== "constant" || (expected !== undefined && c.value !== expected)) throw new Error("Unrecovered native Noise curve");
    return c.value;
  };
  constant(noise.strength, 1); constant(noise.strengthY, 1); constant(noise.strengthZ, 1);
  constant(noise.positionAmount, 1); constant(noise.rotationAmount, 0); constant(noise.sizeAmount, 0);
  if (modules.gravity.mode !== "constant" || !modules.rotation || modules.rotation.curve.mode !== "two-constants") throw new Error("Unrecovered native gravity/rotation curve");
  if (modules.velocity) {
    const curves = [modules.velocity.x, modules.velocity.y, modules.velocity.z];
    if (curves.some((curve) => curve.mode !== "two-curves")) throw new Error("Mixed native velocity curve modes are unavailable");
    // BuildOptimizedCurve rejects more than three keys. One unoptimized axis
    // selects the slow template for ALL axes in VelocityModule.Update.
    if (!curves.some((curve) => curve.mode === "two-curves" && (curve.min.length > 3 || curve.max.length > 3)))
      throw new Error("Native optimized velocity curve branch is unavailable");
  }
  const definition: FieldParticleMotionDefinition = { kind: "unity-field-particle-motion-v1", source: structuredClone(modules.source), kernel: structuredClone(kernel),
    noise: { frequency: number(noise.frequency), damping: true, inverseFrequency: 3.125, strength: 1, positionAmount: 1, scrollSpeed: constant(noise.scrollSpeed) },
    gravityMultiplier: modules.gravity.value, velocity: structuredClone(modules.velocity),
    rotation: { min: modules.rotation.curve.min, max: modules.rotation.curve.max, bySpeed: modules.rotation.bySpeed !== null, randomizeDirection: 0 } };
  validateFieldParticleMotion(definition); return definition;
}

export function compileParticleGravity(raw: unknown): { source: typeof PARTICLE_GRAVITY_SOURCE; gravity: ParticleVector } {
  const input = record(raw), manager = record(input.physicsManager), source = record(manager.source), gravity = record(manager.gravity);
  if (input.formatVersion !== 1 || input.adapterVersion !== "field-particle-motion-0.1.0" || manager.type !== "PhysicsManager" ||
      input.parentSourceSetHash !== "8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed" ||
      input.sourceSetHash !== "4580ec9c9753565b50ba9c682dcfa42ea7a2ddd64b331bfdb5ef8affca02cf63" ||
      Object.entries(PARTICLE_GRAVITY_SOURCE).some(([key, value]) => source[key] !== value)) throw new Error("Unknown source PhysicsManager identity");
  const sources = list(input.sources).map(record);
  if (sources.length !== 1 || sources[0]?.file !== source.file || sources[0]?.sha256 !== source.sha256) throw new Error("PhysicsManager source manifest mismatch");
  if (gravity.x !== 0 || gravity.y !== Math.fround(-9.81) || gravity.z !== 0) throw new Error("Source PhysicsManager gravity changed");
  return { source: structuredClone(PARTICLE_GRAVITY_SOURCE), gravity: { x: 0, y: Math.fround(-9.81), z: 0 } };
}
