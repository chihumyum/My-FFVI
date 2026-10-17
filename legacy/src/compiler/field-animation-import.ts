import { canonical, hash, record } from "./content.js";
import type { Evidence } from "../field/types.js";

export const NATIVE_ANIMATION_JSON = "native-AnimAssetDatas-json-2019.4-v1" as const;
export type NativeAnimationJsonImport = {
  kind: typeof NATIVE_ANIMATION_JSON;
  source: Evidence & { objectId: string; serializedFile: string; sha256: string };
  rawHash: string;
  sources: readonly { file: string; sha256: string }[];
};
export type { FieldAnimationImportObservation } from "../field/world.js";
import type { FieldAnimationImportObservation } from "../field/world.js";
/** Native MapManager.GetSpriteAnimStructure(30c400) loads the source TextAsset
 * with JsonUtility.FromJson<AnimAssetDatas>. The exact 2019.4 API supplies
 * default(string)=null for a missing member; AnimAssetData.ctor(3820a0) also
 * does not set +0x30. SetupAnimCommon(b13390)/SwitchNext(b14010) both use
 * IsNullOrEmpty, so null and empty have the same no-successor consumer branch.
 * This import option is never inferred from a save, authored Character, or
 * unbound animation object. Original JSON and its raw hash remain untouched. */
export function importFieldAnimationNext(rawData: unknown, source: Evidence, index: number,
  binding?: NativeAnimationJsonImport): { next: string; observation?: FieldAnimationImportObservation } {
  const data = record(rawData), animation = data.animation;
  if (!Array.isArray(animation) || !Number.isInteger(index) || index < 0 || index >= animation.length)
    throw new Error("Invalid source animation import index");
  const row = record(animation[index]);
  if (typeof row.next_anim_name === "string") return { next: row.next_anim_name };
  if (row.next_anim_name !== undefined && row.next_anim_name !== null)
    throw new Error("Invalid source animation next_anim_name");
  const s = binding?.source;
  if (!binding || binding.kind !== NATIVE_ANIMATION_JSON || !s || canonical(s) !== canonical(source) ||
      !s.file.endsWith(".bundle") || !s.assetPath.endsWith("/anim_info.json") ||
      !/^-?\d+$/.test(s.objectId) || !s.serializedFile || !/^[a-f0-9]{64}$/.test(s.sha256) ||
      binding.rawHash !== hash(data) ||
      binding.sources.filter(row => row.file === s.file && row.sha256 === s.sha256).length !== 1 ||
      binding.sources.filter(row => row.file === "GameAssembly.dll" &&
        row.sha256 === "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc").length !== 1 ||
      ["nextAnimName", "next_animation_name", "next"].some(alias => Object.hasOwn(row, alias)))
    throw new Error("Missing next animation requires the bound native JSON import protocol");
  return { next: "", observation: { kind: NATIVE_ANIMATION_JSON, source: { ...source,
    pointer: `/animation/${index}/next_anim_name` }, rawHash: binding.rawHash,
    field: "next_anim_name", index, original: Object.hasOwn(row, "next_anim_name") ? "null" : "missing",
    nativeValue: null, runtimeValue: "", interpretation: "no-successor" } };
}
