import type { BattleAISource } from "./battle-ai.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { int32 } from "./script-integer.js";

export const SOURCE_FORMAT_FLAG_IMPORT = Object.freeze({
  kind: "source-format-system-flags-import-v1" as const,
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  unityVersion: "2019.4.20f1", loaderRva: "0x5f2530", genericMethodMetadataRva: "0x1fc0690",
  api: "https://docs.unity3d.com/2019.4/Documentation/ScriptReference/JsonUtility.FromJson.html",
});
export const SOURCE_SYSTEM_FLAG_KEYS = ["SkipInitialize", "KeepPlayerPuppet", "KeepBadStatusVisual", "RidingVehicle"] as const;
export type SourceFormatPhysicalSource = { file: string; assetPath: string; objectId: string; sha256: string; serializedFile: string };
export type SourceFormatFlagImportBinding = { kind: typeof SOURCE_FORMAT_FLAG_IMPORT.kind;
  sourceSetHash: string; parentSourceSetHash: string; source: SourceFormatPhysicalSource; rawScriptHash: string;
  nativeSha256: string; symbolsSha256: string; headerSha256: string; bindingHash: string };

export type SourceBattleFormatImport = {
  kind: "source-battle-format-flags-v1";
  binding: SourceFormatFlagImportBinding;
  values: Record<typeof SOURCE_SYSTEM_FLAG_KEYS[number], number>;
  defaulted: typeof SOURCE_SYSTEM_FLAG_KEYS[number][];
};
const digest = /^[a-f0-9]{64}$/;
function ownRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
    throw new Error("Invalid source Format import record");
  for (const key of Reflect.ownKeys(raw)) {
    const d = Object.getOwnPropertyDescriptor(raw, key)!;
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value"))
      throw new Error("Source Format import requires own data");
  }
  return raw as Record<string, unknown>;
}
/** This is a projection consistency check inside already verified content, not
 * a signature or a loader. Only the compiler's trusted source snapshot loader
 * establishes the native/physical/raw SHA provenance. Saves contain neither
 * programs nor these bindings and cannot select this import protocol. */
export function parseSourceBattleFormatImport(raw: unknown, script: unknown, source: BattleAISource | null): SourceBattleFormatImport {
  const v=ownRecord(raw); checkpointKeys(v,"kind,binding,values,defaulted");
  if(v.kind!=="source-battle-format-flags-v1" || !source) throw new Error("Source Format import requires source battle content");
  const b=ownRecord(v.binding); checkpointKeys(b,"kind,sourceSetHash,parentSourceSetHash,source,rawScriptHash,nativeSha256,symbolsSha256,headerSha256,bindingHash");
  const physical=ownRecord(b.source); checkpointKeys(physical,"file,assetPath,objectId,sha256,serializedFile");
  if(b.kind!==SOURCE_FORMAT_FLAG_IMPORT.kind ||
      ["sourceSetHash","parentSourceSetHash","rawScriptHash","bindingHash"].some(k=>typeof b[k]!=="string" || !digest.test(b[k] as string)) ||
      ["nativeSha256","symbolsSha256","headerSha256"].some(k=>b[k]!==SOURCE_FORMAT_FLAG_IMPORT[k as "nativeSha256"]) ||
      b.parentSourceSetHash!==source.sourceSetHash ||
      typeof physical.file!=="string" || !(physical.file===source.file || physical.file.endsWith("/"+source.file)) ||
      ["assetPath","objectId","sha256","serializedFile"].some(k=>physical[k]!==source[k as keyof BattleAISource]))
    throw new Error("Source Format native/physical identity changed");
  const body=ownRecord(script);
  if(!Object.hasOwn(body,"SystemFlag")) throw new Error("Source Format SystemFlag object is missing");
  const flags=ownRecord(body.SystemFlag), values=ownRecord(v.values);
  checkpointKeys(values,SOURCE_SYSTEM_FLAG_KEYS.join(","));
  if(Object.keys(flags).some(k=>!(SOURCE_SYSTEM_FLAG_KEYS as readonly string[]).includes(k)))
    throw new Error("Unknown source SystemFlag member or alias");
  const defaulted=SOURCE_SYSTEM_FLAG_KEYS.filter(k=>!Object.hasOwn(flags,k));
  if(!Array.isArray(v.defaulted) || v.defaulted.length!==defaulted.length || Array.from(v.defaulted).some((k,i)=>k!==defaulted[i]))
    throw new Error("Source Format defaulted members changed");
  for(const key of SOURCE_SYSTEM_FLAG_KEYS) {
    const expected=Object.hasOwn(flags,key)?int32(flags[key]):0;
    if(int32(values[key])!==expected) throw new Error("Source Format raw/normalized flags conflict");
  }
  return structuredClone(raw) as SourceBattleFormatImport;
}
