import { record } from "./content.js";
import { validateFieldNativeFoot, type FieldNativeFootDefinition, type FieldNativeFootSource } from "../core/field-native-foot.js";

export type { FieldNativeFootDefinition, FieldNativeFootSource } from "../core/field-native-foot.js";

/** The raw visual foot query does not use monster_set_id. Bind the EXACT map
 * entry in its complete package before admitting the no-Attribute branch.
 * A nonempty reference is blocked even if another map has no Attribute. */
export function compileFieldNativeFoot(
  packageData: unknown, packageSource: FieldNativeFootSource, mapName: string,
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
  else if (typeof map.attribute === "string") throw new Error("Source native foot attribute grid is not implemented: " + map.attribute);
  else throw new Error("Unknown source native foot attribute reference");
  const definition: FieldNativeFootDefinition = {
    kind: "source-native-foot-v1", mapName, kindOfFoot: "uniform-zero", basis: "package-attribute-absent",
    attributeRepresentation, source: { ...structuredClone(packageSource), pointer: `/map/${index}/attribute` },
  };
  validateFieldNativeFoot(definition, mapName);
  return definition;
}
