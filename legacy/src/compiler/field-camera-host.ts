import { z } from "zod";
import type { FieldCameraHostDefinition } from "../core/field-camera-host.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";
import { compileFieldCameraMapRange } from "./field-camera.js";
import { compilePlayerVisibilityFactory } from "./player-visibility.js";

export type { FieldCameraHostDefinition } from "../core/field-camera-host.js";

/** Bind the source factory, normal field lifecycle, default object map and map
 * range together. These capabilities belong to content, never to a saved state.
 * Other active entity sets must also pass assertFieldCameraEntitySet before
 * installation; a later ChangeOffset trigger cannot silently retain admission. */
export function compileFieldCameraHostDefinition(
  sources: readonly { file: string; sha256: string }[], rawTilemap: unknown,
  rawDefaultEntities: unknown, context: { mapViewType: number; loopType: number },
): FieldCameraHostDefinition {
  const factory = compilePlayerVisibilityFactory(sources);
  if (int32(context.mapViewType) !== 0) throw new Error("Field camera Bird/FlatBird callback host is unresolved");
  const loopType = int32(context.loopType);
  if (loopType < 0 || loopType > 3) throw new Error("Unknown source field camera loop type");
  assertFieldCameraEntitySet(rawDefaultEntities);
  return { kind: "source-field-camera-host-v1",
    mapRange: compileFieldCameraMapRange(rawTilemap, rawDefaultEntities),
    loop: { horizontal: loopType === 1 || loopType === 3, vertical: loopType === 2 || loopType === 3 },
    playerVisualOffset: { x: 0, y: -6 }, callbacks: "fresh-normal-field-v1",
    sources: factory.sources.map((source) => ({ ...source })) };
}

export function assertFieldCameraEntitySet(rawEntities: unknown): void {
  for (const rawLayer of z.array(z.unknown()).parse(record(rawEntities).layers)) {
    for (const rawObject of z.array(z.unknown()).parse(record(rawLayer).objects)) {
      const properties = z.array(z.unknown()).parse(record(rawObject).properties).map(record);
      const type = properties.filter((property) => property.name === "object_type");
      if (type.length !== 1 || type[0]!.type !== "int") throw new Error("Unknown camera entity source type");
      if (int32(type[0]!.value) === 15) throw new Error("Field camera ChangeOffset trigger provider is unresolved");
    }
  }
}
