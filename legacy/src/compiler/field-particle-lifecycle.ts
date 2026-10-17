import { z } from "zod";
import { record } from "./content.js";
import { compileFieldParticleModules } from "./field-particles.js";
import { compileFieldParticleEmitter, UNITY_PARTICLE_ENGINE } from "./field-particle-emitter.js";
import { validateParticleTimeSettings, type ParticleLifecycleDefinition, type ParticleTimeSettings } from "../core/field-particle-lifecycle.js";
import type { FieldParticleEmitterDefinition } from "../core/field-particle-emitter.js";

export const PARTICLE_TIME_SOURCE = {
  file: "FINAL FANTASY VI_Data/globalgamemanagers", objectId: "8", serializedFile: "globalgamemanagers",
  sha256: "bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881",
} as const;
export const PARTICLE_LIFECYCLE_BODIES: Readonly<Record<string, string>> = {
  "0x189920": "93275da7d0872e336c5ee09ac5a762a848cb9a6379ba3a0ffad14d66f1ca9236",
  "0x194180": "f7ba3af4080062515e11e58cedb79e6b62afab55b630a78c3302bb9236ab65b9",
  "0x18ce20": "7234521d4d23c0b1ece26d1677917f2bdd65b8ae8407aea1810d15c0b19abcc9",
  "0x18e750": "6ccf11c230b8b3ccd0202de61914862b348855fdbc9f79315a086a99ffce0a86",
  "0x197e10": "50020fbc5db095adeeb8b4d67d27515d810c66c81da0d644652075d6543c6519",
  "0x1972a0": "7dd11a55d83d4ec3db4154a65e5763b54064175c6696c033006c1380940349e3",
  "0x197820": "9ba2e02fc15fdc886b47249d68491e5943be38144f7ad40d4bb88629b6a4dc17",
  "0x18faf0": "d53a4fcde694cf695e31b65cafe4ab1885d4994649e152e577512a0991b34d41",
  "0x551170": "6f866845e7e259247f6f184d33bef6ef18c0506293ac0c26e7402b3905efb57c",
  "0x5511f0": "83b1ff6573101d3944a0065505d5f88249aa18c21d7a637a0dea9f5320e9837b",
  "0x54d530": "516390ed8510c3e94404982f7773591767cc6d9c57acd46d55cd1c9f325bbf6c",
  "0x18acf0": "48aba54cc895475b84ecbac050049d2efe28100679fe2043cb9440fb11b5e360",
  "0x186c80": "96fd0485fb67faa14363db95c8bb3cae46d873ba6430c453fad0833297b6873d",
  "0x1892a0": "cf3bf7a212f96c61d0f8ae4aeb050a06fd634c198655a9c4cd5d6fbbf1cfd8f6",
  "0x191860": "048a4cceca0c52dec0a9e6176722c9098c5212ca40c060526484df2e4da06319",
  "0x1957f0": "0e8aec77ebe332e81ac287149693daef0725f3ff4cce26730b8ac5ec3b581bec",
};
const list = (v: unknown) => z.array(z.unknown()).parse(v);

/** File verification remains the source adapter/checker's responsibility. These
 * identities do not turn arbitrary host-supplied JSON into proof of execution. */
export function compileParticleTimeSettings(raw: unknown): ParticleTimeSettings {
  const input = record(raw), clock = record(input.timeManager), source = record(clock.source);
  if (input.formatVersion !== 1 || input.adapterVersion !== "field-particle-clock-0.1.0" || clock.type !== "TimeManager" ||
      input.parentSourceSetHash !== "8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed" ||
      input.sourceSetHash !== "4580ec9c9753565b50ba9c682dcfa42ea7a2ddd64b331bfdb5ef8affca02cf63" ||
      Object.entries(PARTICLE_TIME_SOURCE).some(([k, v]) => source[k] !== v)) throw new Error("Unknown source TimeManager identity");
  const sources = list(input.sources).map(record);
  if (sources.length !== 1 || sources[0]?.file !== source.file || sources[0]?.sha256 !== source.sha256) throw new Error("TimeManager source manifest mismatch");
  const values = z.object({ fixedTimestep: z.number(), maximumParticleTimestep: z.number(), maximumTimestep: z.number(), timeScale: z.number() }).strict().parse(clock.values);
  const expected = { fixedTimestep: Math.fround(0.02), maximumParticleTimestep: Math.fround(0.03), maximumTimestep: Math.fround(0.1), timeScale: 1 };
  if (Object.entries(expected).some(([key, value]) => values[key as keyof typeof values] !== value)) throw new Error("Source TimeManager values changed");
  validateParticleTimeSettings(values);
  return values;
}

export function assertParticleLifecycleEvidence(inspections: readonly unknown[]): void {
  const methods = new Map<string, string>();
  for (const raw of inspections) {
    const input = record(raw), native = record(input.native), pdb = record(input.pdb);
    if (input.kind !== "unity-particle-native-inspection-v1" || input.semanticsVerified !== false ||
        native.sha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 || native.imageBase !== "0x180000000" ||
        !list(native.versions).includes(UNITY_PARTICLE_ENGINE.version) || pdb.sha256 !== UNITY_PARTICLE_ENGINE.pdbSha256 ||
        pdb.guid !== UNITY_PARTICLE_ENGINE.pdbGuid || pdb.age !== UNITY_PARTICLE_ENGINE.pdbAge) throw new Error("Unbound particle lifecycle engine");
    for (const item of list(input.methods)) {
      const m = record(item), rva = z.string().parse(m.rva), sha = z.string().parse(m.sha256);
      if (methods.has(rva) && methods.get(rva) !== sha) throw new Error("Conflicting particle lifecycle method identity");
      methods.set(rva, sha);
    }
  }
  for (const [rva, sha] of Object.entries(PARTICLE_LIFECYCLE_BODIES)) if (methods.get(rva) !== sha) throw new Error("Missing particle lifecycle body " + rva);
}

export function compileFieldParticleLifecycle(assetGroup: string, raw: unknown, engine: FieldParticleEmitterDefinition["engine"],
  clockExport: unknown, inspections: readonly unknown[]): ParticleLifecycleDefinition {
  assertParticleLifecycleEvidence(inspections);
  const clock = compileParticleTimeSettings(clockExport), modules = compileFieldParticleModules(assetGroup, raw);
  const emitter = compileFieldParticleEmitter(assetGroup, raw, engine);
  if (!modules.looping || !modules.requirements.prewarm || !modules.requirements.noise) throw new Error("Only the source prewarmed incremental lifecycle is admitted");
  const lifetime = modules.start.lifetime;
  if (lifetime.mode !== "constant" && lifetime.mode !== "two-constants") throw new Error("Particle lifetime extrema provider is unavailable");
  const maximumLifetime = lifetime.mode === "constant" ? lifetime.value : Math.max(lifetime.min, lifetime.max);
  if (maximumLifetime <= 0) throw new Error("Nonpositive particle prewarm lifetime");
  return { kind: "field-particle-lifecycle-v1", emission: emitter.emission, maximumLifetime: Math.fround(maximumLifetime),
    simulationSpeed: 1, looping: true, prewarm: true, clock };
}
