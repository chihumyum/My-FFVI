import { hash, record } from "./content.js";
import { int32 } from "../core/script-integer.js";

/** Native JSON import protocol, not a world-state initializer. The exact
 * Integrator.Execute metadata argument selects JsonUtility.FromJson<Format>;
 * SystemFlag is a nested class with four int32 fields at +10/+14/+18/+1c.
 * Unity 2019.4's documented FromJson contract assigns default(T) to omitted
 * members without running constructors. Missing/null SystemFlag itself is
 * rejected by native Execute and is never synthesized here.
 * Evidence: scripts/check-source-system-flags.mjs + docs/source-system-flags.md.
 * No original executable was run. */
export const SOURCE_FORMAT_FLAG_IMPORT = Object.freeze({
  kind: "source-format-system-flags-import-v1" as const,
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  unityVersion: "2019.4.20f1", loaderRva: "0x5f2530", genericMethodMetadataRva: "0x1fc0690",
  api: "https://docs.unity3d.com/2019.4/Documentation/ScriptReference/JsonUtility.FromJson.html",
});
export const SOURCE_SYSTEM_FLAG_KEYS = ["SkipInitialize", "KeepPlayerPuppet", "KeepBadStatusVisual", "RidingVehicle"] as const;
type Flag = typeof SOURCE_SYSTEM_FLAG_KEYS[number];
type Source = { file: string; assetPath: string; objectId: string; sha256: string; serializedFile: string };
export type SourceFormatFlagImportBinding = { kind: typeof SOURCE_FORMAT_FLAG_IMPORT.kind;
  sourceSetHash: string; parentSourceSetHash: string; source: Source; rawScriptHash: string;
  nativeSha256: string; symbolsSha256: string; headerSha256: string; bindingHash: string };
const digest = /^[a-f0-9]{64}$/;
function ownRecord(value: unknown): Record<string, unknown> {
  const result = record(value), proto = Object.getPrototypeOf(result);
  if (proto !== Object.prototype && proto !== null) throw new Error("Source Format requires a plain own-data object");
  for (const key of Reflect.ownKeys(result)) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
      throw new Error("Source Format requires own enumerable data fields");
  }
  return result;
}
/** Called only after the existing same-source snapshot loader validated all
 * original bytes. A save/development profile is not this compiler input. */
export function bindSourceFormatFlags(manifest: { sourceSetHash: string; parentSourceSetHash: string; sources: unknown },
  asset: { source: unknown; data: unknown }): SourceFormatFlagImportBinding {
  if (!digest.test(manifest.sourceSetHash) || !digest.test(manifest.parentSourceSetHash) ||
      !Array.isArray(manifest.sources) || hash(manifest.sources) !== manifest.sourceSetHash)
    throw new Error("Unverified source Format snapshot fingerprint");
  const source = ownRecord(asset.source), rows = manifest.sources.map(ownRecord);
  if (typeof source.objectId !== "string" || !/^-?\d+$/.test(source.objectId) ||
      ![source.file, source.assetPath, source.serializedFile].every(value => typeof value === "string" && value.length > 0) ||
      typeof source.sha256 !== "string" || !digest.test(source.sha256))
    throw new Error("Invalid physical source Format identity");
  if (rows.filter(row => row.file === source.file && row.sha256 === source.sha256).length !== 1 ||
      rows.filter(row => row.file === "GameAssembly.dll" && row.sha256 === SOURCE_FORMAT_FLAG_IMPORT.nativeSha256).length !== 1)
    throw new Error("Source Format import loader belongs to another native build");
  const script = ownRecord(asset.data);
  if (script.SystemFlag !== null && typeof script.SystemFlag === "object") ownRecord(script.SystemFlag);
  const binding = { kind: SOURCE_FORMAT_FLAG_IMPORT.kind, sourceSetHash: manifest.sourceSetHash,
    parentSourceSetHash: manifest.parentSourceSetHash, source: structuredClone(source) as Source, rawScriptHash: hash(asset.data),
    nativeSha256: SOURCE_FORMAT_FLAG_IMPORT.nativeSha256, symbolsSha256: SOURCE_FORMAT_FLAG_IMPORT.symbolsSha256,
    headerSha256: SOURCE_FORMAT_FLAG_IMPORT.headerSha256 };
  return { ...binding, bindingHash: hash(binding) };
}
export function decodeSourceSystemFlags(rawScript: unknown, binding: SourceFormatFlagImportBinding) {
  const script = ownRecord(rawScript);
  if (!Object.hasOwn(script, "SystemFlag")) throw new Error("Source Format SystemFlag object is missing");
  const raw = ownRecord(script.SystemFlag), values = {} as Record<Flag, number>, defaulted: Flag[] = [];
  const { bindingHash, ...bound } = binding;
  if (binding.kind !== SOURCE_FORMAT_FLAG_IMPORT.kind || !digest.test(binding.sourceSetHash) || !digest.test(binding.parentSourceSetHash) ||
      binding.nativeSha256 !== SOURCE_FORMAT_FLAG_IMPORT.nativeSha256 || binding.symbolsSha256 !== SOURCE_FORMAT_FLAG_IMPORT.symbolsSha256 ||
      binding.headerSha256 !== SOURCE_FORMAT_FLAG_IMPORT.headerSha256 || binding.rawScriptHash !== hash(rawScript) || bindingHash !== hash(bound))
    throw new Error("Source Format import binding changed");
  if (Object.keys(raw).some(key => !(SOURCE_SYSTEM_FLAG_KEYS as readonly string[]).includes(key)))
    throw new Error("Unknown source SystemFlag member or alias");
  for (const key of SOURCE_SYSTEM_FLAG_KEYS) {
    if (Object.hasOwn(raw, key)) values[key] = int32(raw[key]);
    else { values[key] = 0; defaulted.push(key); }
  }
  return { kind: SOURCE_FORMAT_FLAG_IMPORT.kind, values, defaulted, rawScriptHash: binding.rawScriptHash,
    sourceSetHash: binding.sourceSetHash, parentSourceSetHash: binding.parentSourceSetHash, source: structuredClone(binding.source) };
}
