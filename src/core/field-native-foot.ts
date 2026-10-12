import { checkpointKeys } from "./checkpoint-validation.js";
import type { Evidence } from "../field/types.js";

export type FieldNativeFootSource = Evidence & {
  objectId: string;
  sha256: string;
  serializedFile?: string;
};
/** Content capability for the raw attribute queried by SwitchTransparentBody.
 * It is independent of MapAttribute.defaultFootInfo and BeastFieldEncount.
 * This definition belongs to a specific package map, not to a save or actor. */
export type FieldNativeFootDefinition = {
  kind: "source-native-foot-v1";
  mapName: string;
  kindOfFoot: "uniform-zero";
  basis: "package-attribute-absent";
  attributeRepresentation: "missing" | "null" | "empty";
  source: FieldNativeFootSource;
};

export function validateFieldNativeFoot(
  definition: FieldNativeFootDefinition, expectedMapName?: string,
): void {
  if (!definition) throw new Error("Source native foot provider is unavailable");
  checkpointKeys(definition, "kind,mapName,kindOfFoot,basis,attributeRepresentation,source");
  if (definition.kind !== "source-native-foot-v1" || definition.kindOfFoot !== "uniform-zero" ||
      definition.basis !== "package-attribute-absent" ||
      !["missing", "null", "empty"].includes(definition.attributeRepresentation) ||
      typeof definition.mapName !== "string" || !definition.mapName || definition.mapName.trim() !== definition.mapName)
    throw new Error("Unresolved source native foot behavior");
  if (expectedMapName !== undefined && definition.mapName !== expectedMapName)
    throw new Error("Native foot provider belongs to another source map");
  const source = definition.source;
  if (!source || typeof source.file !== "string" || !source.file ||
      typeof source.assetPath !== "string" || !source.assetPath.endsWith("/package.json") ||
      typeof source.objectId !== "string" || !/^-?\d+$/.test(source.objectId) ||
      typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) ||
      typeof source.pointer !== "string" || !/^\/map\/(0|[1-9]\d*)\/attribute$/.test(source.pointer) ||
      (source.serializedFile !== undefined && (typeof source.serializedFile !== "string" || !source.serializedFile)))
    throw new Error("Unbound source native foot identity");
  if (Object.keys(source).some((key) => !["file", "assetPath", "objectId", "sha256", "serializedFile", "pointer"].includes(key)))
    throw new Error("Unknown source native foot provenance field");
}

/** MapAttribute.GetCellAttribute 0x301680 returns zero when the fresh model's
 * EncountData is null. No coordinate conversion/grid lookup is needed for this
 * admitted branch; a loaded Attribute grid is a different, unresolved branch. */
export function readFieldNativeFoot(
  definition: FieldNativeFootDefinition, position: Readonly<{ x: number; y: number; z: number }>,
): number {
  validateFieldNativeFoot(definition);
  if (!position) throw new Error("Missing native foot actor position");
  checkpointKeys(position, "x,y,z");
  if (![position.x, position.y, position.z].every((value) => typeof value === "number" && Number.isFinite(Math.fround(value))))
    throw new Error("Invalid native foot actor position");
  return 0;
}
