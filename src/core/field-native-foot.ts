import { checkpointKeys } from "./checkpoint-validation.js";
import type { Evidence } from "../field/types.js";
import { fieldCameraWorldToCell, type FieldCameraMapRange } from "./field-camera.js";
import { readWorldTerrainFoot, validateWorldTerrain, type WorldTerrainDefinition } from "./world-terrain.js";

export type FieldNativeFootSource = Evidence & {
  objectId: string;
  sha256: string;
  serializedFile?: string;
};
/** Content capability for the raw attribute queried by SwitchTransparentBody.
 * It is independent of MapAttribute.defaultFootInfo and BeastFieldEncount.
 * This definition belongs to a specific package map, not to a save or actor. */
type FieldNativeFootBase = {
  kind: "source-native-foot-v1";
  mapName: string;
  source: FieldNativeFootSource;
};
export type FieldNativeFootDefinition = FieldNativeFootBase & ({
  kindOfFoot: "uniform-zero";
  basis: "package-attribute-absent";
  attributeRepresentation: "missing" | "null" | "empty";
} | {
  kindOfFoot: "attribute-grid";
  basis: "package-attribute-grid";
  attributeRepresentation: "grid";
  /** Reference to the same immutable source grid used for movement. */
  terrainHash: string;
});
export type FieldNativeFootGridContext = { terrain: WorldTerrainDefinition; mapRange: FieldCameraMapRange };

export function validateFieldNativeFoot(
  definition: FieldNativeFootDefinition, expectedMapName?: string, terrain?: WorldTerrainDefinition,
): void {
  if (!definition) throw new Error("Source native foot provider is unavailable");
  checkpointKeys(definition, definition.kindOfFoot === "attribute-grid"
    ? "kind,mapName,kindOfFoot,basis,attributeRepresentation,source,terrainHash"
    : "kind,mapName,kindOfFoot,basis,attributeRepresentation,source");
  const zero = definition.kindOfFoot === "uniform-zero" && definition.basis === "package-attribute-absent" &&
    ["missing", "null", "empty"].includes(definition.attributeRepresentation);
  const grid = definition.kindOfFoot === "attribute-grid" && definition.basis === "package-attribute-grid" &&
    definition.attributeRepresentation === "grid" && typeof definition.terrainHash === "string" && /^[a-f0-9]{64}$/.test(definition.terrainHash);
  if (definition.kind !== "source-native-foot-v1" || !zero && !grid ||
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
  if (terrain && definition.kindOfFoot === "attribute-grid") {
    validateWorldTerrain(terrain);
    assertFootTerrainBinding(definition, terrain);
  }
}

function assertFootTerrainBinding(definition: FieldNativeFootDefinition & { kindOfFoot: "attribute-grid" }, terrain: WorldTerrainDefinition): void {
  if (terrain.kind !== "source-world-terrain-v1" || terrain.mapName !== definition.mapName ||
      terrain.contentHash !== definition.terrainHash ||
      ["file", "assetPath", "objectId", "sha256", "serializedFile"].some(key =>
        terrain.sources.package[key as keyof FieldNativeFootSource] !== definition.source[key as keyof FieldNativeFootSource]))
    throw new Error("Native foot provider belongs to another source terrain");
}

/** MapAttribute.GetCellAttribute 0x301680 returns zero when the fresh model's
 * EncountData is null. No coordinate conversion/grid lookup is needed for this
 * admitted branch. The grid branch binds CreateAttributeData 0x365870 and
 * GetCellAttribute 0x9d3ff0: raw FootIds are sampled without a GID decrement. */
export function readFieldNativeFoot(
  definition: FieldNativeFootDefinition, position: Readonly<{ x: number; y: number; z: number }>,
  context?: FieldNativeFootGridContext,
): number {
  validateFieldNativeFoot(definition);
  if (!position) throw new Error("Missing native foot actor position");
  checkpointKeys(position, "x,y,z");
  if (![position.x, position.y, position.z].every((value) => typeof value === "number" && Number.isFinite(Math.fround(value))))
    throw new Error("Invalid native foot actor position");
  if (definition.kindOfFoot === "uniform-zero") return 0;
  if (!context) throw new Error("Native foot attribute grid context is unavailable");
  const { terrain, mapRange } = context;
  assertFootTerrainBinding(definition, terrain);
  if (mapRange.x !== 0 || mapRange.y !== 0 || mapRange.width !== terrain.width || mapRange.height !== terrain.height)
    throw new Error("Native foot attribute grid map range mismatch");
  return readWorldTerrainFoot(terrain, fieldCameraWorldToCell(mapRange, { x: position.x, y: position.y }));
}
