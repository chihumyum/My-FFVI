import { Hash, SourceRef } from "../contracts.js";
import { fieldRelayCellLimits } from "../core/field-relay-interaction.js";
import { FIELD_RELAY_SOURCE_OBSERVER_REQUIREMENT } from "../core/field-relay-policy.js";
import type { Evidence, FieldRelayDefinition } from "../field/types.js";
import { z } from "zod";

const RelaySource = SourceRef.extend({
  objectId: z.string().regex(/^-?\d+$/),
  pointer: z.string().regex(/^\/layers\/\d+\/objects\/\d+$/),
  serializedFile: z.string().min(1),
  sha256: Hash,
}).strict();
const objectKeys = new Set(["id", "name", "type", "gid", "x", "y", "width", "height", "visible", "rotation", "properties"]);
const integer = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    throw new Error("Invalid field relay source integer");
  return value;
};

/** Readable source data never removes the original observer requirement. The
 * trusted Web policy may admit only its explicitly scoped development host. */
export function fieldRelayCompilationBlockers(): readonly string[] {
  return [FIELD_RELAY_SOURCE_OBSERVER_REQUIREMENT];
}

/** Decode the ordinary source rectangle without assigning world/local placement,
 * actor identity, visibility, action eligibility or an interaction target. */
export function compileFieldRelay(input: {
  group: string;
  entityId: string;
  layer: number;
  object: Record<string, unknown>;
  properties: Record<string, unknown>;
  source: Evidence;
}): FieldRelayDefinition {
  const { object, properties: p } = input;
  if (Object.keys(p).sort().join(",") !== "entity_id,object_id,object_type" || p.object_type !== 16)
    throw new Error("Unresolved field relay properties");
  if (Object.keys(object).some(key => !objectKeys.has(key)) || object.type !== "" ||
      object.visible === false || (object.rotation !== undefined && object.rotation !== 0))
    throw new Error("Unsupported field relay geometry or transform");
  const editorGid = integer(object.gid);
  // Tiled's upper four flags describe flips/rotation. They have not been
  // recovered for this source subset and must not become an untransformed relay.
  if (editorGid <= 0 || editorGid >= 0x10000000 || !Number.isInteger(input.layer) || input.layer < 0 || input.layer > 3)
    throw new Error("Unsupported field relay editor binding or layer");
  const editorObjectId = integer(object.id), sourceEntityId = integer(p.entity_id), objectId = integer(p.object_id);
  if (editorObjectId <= 0 || !input.group) throw new Error("Invalid field relay source identity");
  const source = RelaySource.parse(input.source);
  const indices = /^\/layers\/(\d+)\/objects\/(\d+)$/.exec(source.pointer)!;
  if (input.entityId !== (sourceEntityId ? String(sourceEntityId) : `${input.group}:${indices[1]}:${indices[2]}`))
    throw new Error("Field relay compiled identity mismatch");
  const rawGeometry = { x: integer(object.x), y: integer(object.y), width: integer(object.width), height: integer(object.height) };
  if (rawGeometry.width <= 0 || rawGeometry.height <= 0) throw new Error("Unsupported field relay bounds");
  return {
    kind: "source-field-relay-v1", group: input.group, entityId: input.entityId,
    sourceEntityId, objectId, editorObjectId, layer: input.layer, rawGeometry, editorGid,
    ...fieldRelayCellLimits(rawGeometry.width, rawGeometry.height), source,
  };
}
