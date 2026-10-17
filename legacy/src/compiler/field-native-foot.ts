import { record } from "./content.js";
import { posix } from "node:path";
import { validateFieldNativeFoot, type FieldNativeFootDefinition, type FieldNativeFootSource } from "../core/field-native-foot.js";
import type { WorldTerrainDefinition } from "../core/world-terrain.js";

export type { FieldNativeFootDefinition, FieldNativeFootSource } from "../core/field-native-foot.js";

/** The raw visual foot query does not use monster_set_id. Bind the EXACT map
 * entry in its complete package before admitting the no-Attribute branch.
 * A nonempty reference needs that exact map's admitted source terrain grid. */
export function compileFieldNativeFoot(
  packageData: unknown, packageSource: FieldNativeFootSource, mapName: string,
  terrain?: WorldTerrainDefinition,
): FieldNativeFootDefinition {
  if (typeof mapName !== "string" || !mapName || mapName.trim() !== mapName)
    throw new Error("Missing source native foot map name");
  const pkg = record(packageData);
  if (!Array.isArray(pkg.map)) throw new Error("Missing source native foot package maps");
  const matches = pkg.map.map((raw, index) => ({ map: record(raw), index }))
    .filter(({ map }) => map.name === mapName);
  if (matches.length !== 1) throw new Error("Missing or ambiguous source native foot map entry");
  const { map, index } = matches[0]!;
  let attributeRepresentation: FieldNativeFootDefinition["attributeRepresentation"];
  if (!Object.hasOwn(map, "attribute")) attributeRepresentation = "missing";
  else if (map.attribute === null) attributeRepresentation = "null";
  else if (map.attribute === "") attributeRepresentation = "empty";
  else if (typeof map.attribute === "string") {
    if (!terrain) throw new Error("Source native foot attribute grid is not implemented: " + map.attribute);
    if (!map.attribute || map.attribute.trim() !== map.attribute || map.attribute.startsWith("/") || map.attribute.includes("\\") ||
        map.attribute.split("/").some(part => !part || part === "." || part === "..") ||
        terrain.sources.attribute.assetPath !== posix.join(posix.dirname(packageSource.assetPath), map.attribute + ".json"))
      throw new Error("Unbound source native foot attribute reference");
    const definition: FieldNativeFootDefinition = { kind: "source-native-foot-v1", mapName,
      kindOfFoot: "attribute-grid", basis: "package-attribute-grid", attributeRepresentation: "grid", terrainHash: terrain.contentHash,
      source: { ...structuredClone(packageSource), pointer: `/map/${index}/attribute` } };
    validateFieldNativeFoot(definition, mapName, terrain);
    return definition;
  }
  else throw new Error("Unknown source native foot attribute reference");
  const definition: FieldNativeFootDefinition = {
    kind: "source-native-foot-v1", mapName, kindOfFoot: "uniform-zero", basis: "package-attribute-absent",
    attributeRepresentation, source: { ...structuredClone(packageSource), pointer: `/map/${index}/attribute` },
  };
  validateFieldNativeFoot(definition, mapName);
  return definition;
}
