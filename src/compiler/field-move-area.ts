import { validateFieldMoveArea, type FieldMoveAreaDefinition } from "../core/field-move-area.js";
import type { Evidence } from "../field/types.js";

/** Ordinary source MoveArea rectangles. Unknown extra properties stay explicit
 * instead of granting a sprite, trigger, or autonomous movement controller. */
export function compileFieldMoveArea(input: {
  group: string;
  entityId: string;
  layer: number;
  object: Record<string, unknown>;
  properties: Record<string, unknown>;
  source: Evidence;
}): FieldMoveAreaDefinition {
  const { object, properties: p } = input;
  if (Object.keys(p).sort().join(",") !== "entity_id,object_id,object_type" || p.object_type !== 13)
    throw new Error("Unresolved field move area properties");
  if (object.gid !== undefined || object.ellipse || object.polygon || object.polyline || object.point ||
      object.visible === false || (object.rotation !== undefined && object.rotation !== 0))
    throw new Error("Unsupported field move area geometry or transform");
  const integer = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
      throw new Error("Invalid field move area source integer");
    return value;
  };
  const definition: FieldMoveAreaDefinition = {
    kind: "field-move-area-v1", group: input.group, entityId: input.entityId,
    sourceEntityId: integer(p.entity_id), objectId: integer(p.object_id),
    geometry: { x: integer(object.x), y: integer(object.y), width: integer(object.width), height: integer(object.height), layer: input.layer },
    source: structuredClone(input.source),
  };
  validateFieldMoveArea(definition);
  return definition;
}
