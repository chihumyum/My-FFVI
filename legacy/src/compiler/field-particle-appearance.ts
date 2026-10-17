import { createHash } from "node:crypto";
import { record } from "./content.js";
import { compileFieldParticleModules, compileParticleCurve } from "./field-particles.js";
import { UNITY_PARTICLE_ENGINE } from "./field-particle-emitter.js";
import { validateFieldParticleAppearance, validateParticleAppearanceGradientCache, type FieldParticleAppearanceDefinition,
  type ParticleAppearanceGradientCache, type ParticleAppearancePolynomial } from "../core/field-particle-appearance.js";

export const PARTICLE_APPEARANCE_BODIES: Readonly<Record<string, string>> = {
  "0x19ba50": "9d294c5203cc0138c400fe26fcb36dc93177e22cf984e0e64a50de628340ac41",
  "0x1f1190": "5db98dae1d20a4971abec1f5de5da83a6a59ee68a2d15c7a9bab1ac3e5d9c6b1",
  "0x1e5e50": "efa14af88135536f7e18063b29c219299702fa6fbb95bdf7cd5e2db3066e9696",
  "0x1e64a0": "e9d80b1d8399fa79b8548027eefb6aa56b4b7d845a37503f9a697f8f0bce274c",
  "0x19a320": "0e9a82629b72b5967e4ad21f9e03f25aa94cf03c8c8390a974ab7648189e4a72",
  "0x1b0d80": "8f9d8a5dfca667f0be762e37c1449bb7eb98bb74861852c573cd2bf0e4aaf9be",
  "0x17e210": "4075e4c903200997e718443e1454227e33037f3bd52d78ea2f5495a259888cb4",
  "0x755d00": "1502e3cf6dd6a3cea157ccf2eee5426976dc3f8f25ca9e0e1b553c8d24d55373",
  "0x1a1af0": "42da25320b330672a3fad7febbb1ef720fdb0b47df4dbbd799a89b5e4ed5b68a",
  "0x1a1470": "0b6a73ab7db90f20d0a3523db4bdf2e5f0426d5f0705dcd478b7736a5f1fa078",
  "0x1a15a0": "74fe31f6a502def921f49f7e6580ddbeb09433470ca3eff96f26ff3c993f304b",
  "0x1ad670": "492972c6187192e1168ae31d2a65afedbfbcb12cf936bcb2fc9ad81ed7d1e190",
  "0x762db0": "1d0081a2c93987e8ba65548e70603fb93566e46f9bff5dc1f79d17a61ada0640",
  "0x75d030": "7d812d52602aa0ad40e6ba97710a9d50d3495ab8c534eb443e5685b896a0e492",
  "0x18cbd0": "4a6ef5dfb17d40803b3cb2fb34ad57fee3078438d195e33eb61b56846dfdfb71",
  "0x75e4a0": "bc4df692044ccdb469eee94566da49695a13a1d405d459839e809126e505e2a3",
  "0x185510": "4753f6d9a19b57d280c6cdbe6666f5c4b42118ea691a8c5ecfd9d93b724cea3d",
  "0x191370": "069aa5fdc89db639d408d80e3ca82d5fcf2e4d9c3d82434c845202ad388de505",
  "0x19a690": "1110afd86f027ab6d46a48274a3eb15cffb98ab1fc7aeb8c531505fe64c6bc13",
  "0x1972a0": "7dd11a55d83d4ec3db4154a65e5763b54064175c6696c033006c1380940349e3",
  "0x1957f0": "0e8aec77ebe332e81ac287149693daef0725f3ff4cce26730b8ac5ec3b581bec",
  "0x196260": "1628ebf42e514b02e911e88b4c5622baa3d58eb1e5ee89e69ac05301b508d6eb",
  "0xd88830": "d6ab7774cfb6421dceab25c2fa937ff26ddd3935b56cb583286cc028f42d0540",
  "0xd88f50": "d2162794266d8eb074326844a9efc6d5a7b5582b2decdc7c9c0f11ed6012be72",
};
export type ParticleAppearanceNativeBinding = { group: string; source: Record<string, unknown>; inputSha256: string; cacheSha256: string;
  coefficients: ParticleAppearancePolynomial; cache: ParticleAppearanceGradientCache };
export type ParticleAppearanceKernel = { kind: "unity-particle-appearance-kernel-v1"; nativeSha256: string; bindings: ParticleAppearanceNativeBinding[] };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const list = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error("Missing particle appearance array"); return v; };
const text = (v: unknown): string => { if (typeof v !== "string" || !v) throw new Error("Missing particle appearance identity"); return v; };
const number = (v: unknown): number => { if (typeof v !== "number" || !Number.isFinite(v) || !Number.isFinite(Math.fround(v))) throw new Error("Invalid particle appearance number"); return v; };
const integer = (v: unknown, max: number): number => { const n = number(v); if (!Number.isInteger(n) || n < 0 || n > max) throw new Error("Invalid particle appearance integer"); return n; };
const digest = (v: unknown): string => { const s = text(v); if (!/^[a-f0-9]{64}$/.test(s)) throw new Error("Invalid particle appearance hash"); return s; };

/** Binary digest avoids JSON float spelling differences. It binds every
 * serialized Size key (including inactive weights), gradient key/time/count,
 * mode, scalar and infinity input consumed to produce native caches. */
export function particleAppearanceInputBytes(rawSize: unknown, rawGradient: unknown): Buffer {
  const size = record(rawSize), max = record(size.maxCurve), keys = list(max.m_Curve).map(record), gradient = record(rawGradient);
  const buffer = Buffer.alloc(18 + keys.length * 28 + 166); let at = 0;
  const u16 = (v: unknown) => { buffer.writeUInt16LE(integer(v, 65535), at); at += 2; };
  const u32 = (v: unknown) => { buffer.writeUInt32LE(integer(v, 0xffffffff), at); at += 4; };
  const f32 = (v: unknown) => { buffer.writeFloatLE(number(v), at); at += 4; };
  u16(size.minMaxState); f32(size.scalar); u32(keys.length); u32(max.m_PreInfinity); u32(max.m_PostInfinity);
  for (const k of keys) { [k.time, k.value, k.inSlope, k.outSlope].forEach(f32); u32(k.weightedMode); f32(k.inWeight); f32(k.outWeight); }
  for (let i = 0; i < 8; i++) { const k = record(gradient["key" + i]); [k.r, k.g, k.b, k.a].forEach(f32); }
  for (const prefix of ["ctime", "atime"]) for (let i = 0; i < 8; i++) u16(gradient[prefix + i]);
  buffer.writeUInt8(integer(gradient.m_NumColorKeys, 8), at++); buffer.writeUInt8(integer(gradient.m_NumAlphaKeys, 8), at++); u32(gradient.m_Mode);
  if (at !== buffer.length) throw new Error("Particle appearance source digest length mismatch"); return buffer;
}
export function particleAppearanceCacheBytes(coefficients: readonly number[], cache: ParticleAppearanceGradientCache): Buffer {
  validateParticleAppearanceGradientCache(cache);
  if (coefficients.length !== 9) throw new Error("Incomplete optimized appearance coefficients");
  const buffer = Buffer.alloc(41 + cache.times.length * 12); let at = 0;
  buffer.writeUInt8(1, at++);
  for (const v of coefficients) { buffer.writeFloatLE(number(v), at); at += 4; }
  buffer.writeUInt32LE(cache.times.length, at); at += 4;
  for (const v of cache.times) { buffer.writeFloatLE(number(v), at); at += 4; }
  for (const v of cache.colors) { buffer.writeUInt32LE(integer(v, 0xffffffff), at); at += 4; }
  for (const v of cache.inverseSpans) { buffer.writeFloatLE(number(v), at); at += 4; }
  return buffer;
}
export function assertParticleAppearanceEvidence(inspections: readonly unknown[]): void {
  const found = new Map<string, string>();
  for (const raw of inspections) {
    const i = record(raw), native = record(i.native), pdb = record(i.pdb);
    if (i.kind !== "unity-particle-native-inspection-v1" || i.semanticsVerified !== false || native.sha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 ||
        native.imageBase !== "0x180000000" || !list(native.versions).includes(UNITY_PARTICLE_ENGINE.version) ||
        pdb.sha256 !== UNITY_PARTICLE_ENGINE.pdbSha256 || pdb.guid !== UNITY_PARTICLE_ENGINE.pdbGuid || pdb.age !== UNITY_PARTICLE_ENGINE.pdbAge)
      throw new Error("Unbound particle appearance engine");
    for (const rawMethod of list(i.methods)) { const m = record(rawMethod), rva = text(m.rva), hash = digest(m.sha256);
      if (found.has(rva) && found.get(rva) !== hash) throw new Error("Conflicting particle appearance native method"); found.set(rva, hash); }
  }
  for (const [rva, hash] of Object.entries(PARTICLE_APPEARANCE_BODIES)) if (found.get(rva) !== hash) throw new Error("Missing particle appearance body " + rva);
}
/** The native cache adapter executes original cache builders from current
 * source configuration. No prerecorded frame colors/sizes enter this kernel.
 * Its checker re-reads DLL/PDB/body ranges and reconstructs the cache each run. */
export function compileParticleAppearanceKernel(inspections: readonly unknown[], rawProbe: unknown): ParticleAppearanceKernel {
  assertParticleAppearanceEvidence(inspections); const p = record(rawProbe);
  if (p.kind !== "unity-particle-appearance-instruction-probes-v1" || p.nativeSha256 !== UNITY_PARTICLE_ENGINE.nativeSha256 ||
      p.semanticsVerified !== false || p.lane !== "isolated-x64-instruction-emulation") throw new Error("Unbound particle appearance cache adapter");
  const seen = new Set<string>(), bindings = list(p.bindings).map((raw): ParticleAppearanceNativeBinding => {
    const b = record(raw), group = text(b.group), source = record(b.source), rawCache = record(b.cache);
    if (seen.has(group) || b.optimized !== true) throw new Error("Duplicate/unoptimized source particle appearance binding"); seen.add(group);
    const coefficients = list(b.coefficients).map(number) as ParticleAppearancePolynomial;
    const cache = { times: list(rawCache.times).map(number), colors: list(rawCache.colors).map((v) => integer(v, 0xffffffff)), inverseSpans: list(rawCache.inverseSpans).map(number) };
    const inputSha256 = digest(b.inputSha256), cacheSha256 = digest(b.cacheSha256);
    if (sha(particleAppearanceInputBytes(b.size, b.gradient)) !== inputSha256 || sha(particleAppearanceCacheBytes(coefficients, cache)) !== cacheSha256)
      throw new Error("Changed native particle appearance cache inputs/output");
    return { group, source: structuredClone(source), inputSha256, cacheSha256, coefficients: structuredClone(coefficients), cache: structuredClone(cache) };
  });
  if (!bindings.length) throw new Error("Empty particle appearance cache kernel");
  return { kind: "unity-particle-appearance-kernel-v1", nativeSha256: UNITY_PARTICLE_ENGINE.nativeSha256, bindings };
}
function sourceSame(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return ["file", "assetPath", "serializedFile", "objectId", "sha256"].every((key) => a[key] === b[key]);
}
export function compileFieldParticleAppearance(assetGroup: string, rawGraph: unknown, dependencies: unknown, kernel: ParticleAppearanceKernel): FieldParticleAppearanceDefinition {
  if (kernel.kind !== "unity-particle-appearance-kernel-v1" || kernel.nativeSha256 !== UNITY_PARTICLE_ENGINE.nativeSha256) throw new Error("Unknown particle appearance kernel");
  const modules = compileFieldParticleModules(assetGroup, rawGraph), graph = record(rawGraph), hierarchy = new Set(list(graph.hierarchyIds).map(text));
  const objects = list(graph.objects).map(record), find = (type: string) => {
    const found = objects.filter((o) => o.type === type && hierarchy.has(text(record(o.source).objectId)));
    if (found.length !== 1) throw new Error("Ambiguous source particle appearance " + type); return found[0]!;
  };
  const particle = find("ParticleSystem"), source = record(particle.source), data = record(particle.data), renderer = record(find("ParticleSystemRenderer").data);
  const initial = record(data.InitialModule), size = record(data.SizeModule), color = record(data.ColorModule), gradient = record(color.gradient);
  if (initial.size3D !== false || size.enabled !== true || size.separateAxes !== false || color.enabled !== true || gradient.minMaxState !== 1 || record(gradient.maxGradient).m_Mode !== 0)
    throw new Error("Unrecovered source particle appearance branch");
  // These modules require different timing or additional final size/color
  // operators. They remain independent, explicit admission dependencies.
  for (const name of ["SizeBySpeedModule", "ColorBySpeedModule", "CollisionModule", "TriggerModule", "LightsModule", "TrailModule"]) {
    if (record(data[name]).enabled !== false) throw new Error("Unrecovered source particle appearance phase: " + name);
  }
  if (record(data.NoiseModule).enabled !== true || record(data.NoiseModule).separateAxes !== false) throw new Error("Unrecovered particle noise appearance branch");
  const noise = record(data.NoiseModule);
  for (const key of ["sizeAmount", "rotationAmount"]) { const c = compileParticleCurve(noise[key]);
    if (c.mode !== "constant" || c.value !== 0) throw new Error("Unrecovered particle Noise " + key); }
  if (!modules.size || modules.size.mode !== "curve" || !modules.color || modules.color.mode !== "gradient") throw new Error("Unrecovered source lifetime appearance");
  const settings = record(record(dependencies).settings), settingsSource = record(settings.source);
  if (settings.type !== "PlayerSettings" || settings.activeColorSpace !== 0 || renderer.m_ApplyActiveColorSpace !== true ||
      settingsSource.file !== "FINAL FANTASY VI_Data/globalgamemanagers" || settingsSource.serializedFile !== "globalgamemanagers" || settingsSource.objectId !== "1" ||
      settingsSource.sha256 !== "bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881") throw new Error("Unbound source Gamma appearance settings");
  const matches = kernel.bindings.filter((b) => b.group === assetGroup && sourceSame(b.source, source));
  if (matches.length !== 1) throw new Error("Missing exact source appearance cache"); const binding = matches[0]!;
  if (sha(particleAppearanceInputBytes(size.curve, gradient.maxGradient)) !== binding.inputSha256 ||
      sha(particleAppearanceCacheBytes(binding.coefficients, binding.cache)) !== binding.cacheSha256) throw new Error("Particle appearance cache differs from current source configuration");
  const result: FieldParticleAppearanceDefinition = { kind: "unity-field-particle-appearance-v1", source: structuredClone(modules.source), engine: "unity-2019.4.20f1",
    inputSha256: binding.inputSha256, cacheSha256: binding.cacheSha256,
    size: { curve: structuredClone(modules.size), optimized: structuredClone(binding.coefficients) }, color: structuredClone(binding.cache),
    colorSpace: { active: 0, applyActiveColorSpace: true, source: { file: String(settingsSource.file), serializedFile: String(settingsSource.serializedFile), sha256: String(settingsSource.sha256), objectId: "1" } },
    phase: { size: "after-incremental-slices", color: "nonincremental-render-preparation" } };
  validateFieldParticleAppearance(result); return result;
}
