import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";
import type { FieldCameraMapRange } from "./field-camera.js";
import type { Evidence, FieldEntity } from "../field/types.js";

/** PropertyMoveArea is controller data, not a sprite, trigger, or collision.
 * Keep its raw rectangle: its world-space MoveArea is not the Tiled cell rect. */
export type FieldMoveAreaDefinition = {
  kind: "field-move-area-v1";
  group: string;
  entityId: string;
  /** Preserved source identity only; this does not grant an actor selector. */
  sourceEntityId: number;
  objectId: number;
  geometry: { x: number; y: number; width: number; height: number; layer: number };
  source: Evidence;
};
export type FieldMoveAreaRect = { x: number; y: number; width: number; height: number };
export type FieldMoveArea = {
  definition: FieldMoveAreaDefinition;
  cellArea: FieldMoveAreaRect;
  moveArea: FieldMoveAreaRect;
};

const f = Math.fround;
function int32(value: number): number {
  checkpointInteger(value, -0x80000000, 0x7fffffff);
  return value;
}
function sourceIdentity(value: Evidence): void {
  if (!value || typeof value.file !== "string" || !value.file ||
      typeof value.assetPath !== "string" || !value.assetPath ||
      typeof value.pointer !== "string" || !/^\/layers\/(0|[1-9]\d*)\/objects\/(0|[1-9]\d*)$/.test(value.pointer) ||
      (value.objectId !== undefined && (typeof value.objectId !== "string" || !/^-?\d+$/.test(value.objectId))))
    throw new Error("Unbound field move area source identity");
}
export function validateFieldMoveArea(definition: FieldMoveAreaDefinition): void {
  if (!definition || definition.kind !== "field-move-area-v1" ||
      typeof definition.group !== "string" || !definition.group ||
      typeof definition.entityId !== "string" || !definition.entityId)
    throw new Error("Unbound field move area definition");
  checkpointKeys(definition, "kind,group,entityId,sourceEntityId,objectId,geometry,source");
  sourceIdentity(definition.source);
  int32(definition.sourceEntityId); int32(definition.objectId);
  const pointer = /^\/layers\/(\d+)\/objects\/(\d+)$/.exec(definition.source.pointer!)!;
  const expectedId = definition.sourceEntityId !== 0 ? String(definition.sourceEntityId)
    : `${definition.group}:${pointer[1]}:${pointer[2]}`;
  if (definition.entityId !== expectedId) throw new Error("Field move area identity disagrees with its source object");
  checkpointKeys(definition.geometry, "x,y,width,height,layer");
  int32(definition.geometry.x); int32(definition.geometry.y);
  checkpointInteger(definition.geometry.width, 1, 0x7fffffff);
  checkpointInteger(definition.geometry.height, 1, 0x7fffffff);
  checkpointInteger(definition.geometry.layer, 0, 4);
}

/** Validate every candidate before group publication. A region on a different
 * entity kind or a changed raw/source binding is never silently ignored. */
export function validateFieldMoveAreas(entities: readonly FieldEntity[]): void {
  if (!Array.isArray(entities)) throw new Error("Invalid field move area entity list");
  for (const entity of entities) {
    if (entity.kind !== 13) {
      if (entity.moveArea !== undefined) throw new Error("Field move area attached to a different entity kind");
      continue;
    }
    if (!entity.moveArea) throw new Error("Missing field move area definition");
    const definition = entity.moveArea;
    validateFieldMoveArea(definition);
    const raw = definition.geometry;
    if (entity.id !== definition.entityId || entity.objectId !== definition.objectId || entity.layer !== raw.layer ||
        entity.x !== raw.x / 16 || entity.y !== raw.y / 16 || entity.width !== raw.width / 16 || entity.height !== raw.height / 16 ||
        canonical(entity.source) !== canonical(definition.source))
      throw new Error("Field move area disagrees with its compiled entity binding");
    if (entity.asset !== null || entity.script !== null || entity.collision !== null || entity.destinationLayer !== null ||
        entity.nativeNpc !== undefined || entity.npc !== undefined || entity.effect !== undefined || entity.mapObject !== undefined ||
        entity.treasure !== undefined || entity.openTrigger !== undefined || entity.tileAnimation !== undefined ||
        entity.destination !== undefined || entity.minimap !== undefined)
      throw new Error("Field move area has unresolved additional entity behavior");
  }
}

/** Mathf.Round in PropertyAreaObject uses nearest-even at exactly half a cell. */
function roundCell(value: number): number {
  const floor = Math.floor(value), fraction = value - floor;
  const result = fraction === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value);
  return result === 0 && value < 0 ? -0 : result;
}
export function projectFieldMoveArea(definition: FieldMoveAreaDefinition, mapRange: FieldCameraMapRange): FieldMoveArea {
  validateFieldMoveArea(definition);
  checkpointKeys(mapRange, "x,y,width,height");
  int32(mapRange.x); int32(mapRange.y);
  checkpointInteger(mapRange.width, 1, 0x7ffffff);
  checkpointInteger(mapRange.height, 1, 0x7ffffff);
  const raw = definition.geometry;
  // ParseMapObjectGroupData performs integer map-origin subtraction before
  // float conversion, and integer half-width/height before world positioning.
  const x = f(int32(raw.x - int32(mapRange.x * 16))), y = f(int32(raw.y - int32(mapRange.y * 16)));
  const width = f(raw.width), height = f(raw.height);
  const px = f(f(x - f(int32(mapRange.width * 8))) + Math.trunc(raw.width / 2));
  const py = f(f(f(int32(mapRange.height * 8)) - y) + Math.trunc(raw.height / 2));
  return {
    definition: structuredClone(definition),
    cellArea: { x: roundCell(f(x * 0.0625)), y: roundCell(f(y * 0.0625)),
      width: roundCell(f(width * 0.0625)), height: roundCell(f(height * 0.0625)) },
    moveArea: { x: f(px - f(width * 0.5)), y: f(py - f(height * 0.5)), width, height },
  };
}

/** MapSetup clears the controller manager; each activated group appends its
 * areas. Derive that order from the existing cumulative entity owner, not the
 * default-plus-latest currentProperties used by the minimap. */
export function fieldMoveAreas(entities: readonly FieldEntity[], mapRange: FieldCameraMapRange): FieldMoveArea[] {
  validateFieldMoveAreas(entities);
  return entities.filter((entity) => entity.kind === 13).map((entity) => projectFieldMoveArea(entity.moveArea!, mapRange));
}
/** GetPropertyMapArea returns the first ObjectId match; missing stays null.
 * An unresolved autonomous controller must not interpret missing as a default. */
export function findFieldMoveArea(entities: readonly FieldEntity[], linkObjectId: number,
  mapRange: FieldCameraMapRange): FieldMoveArea | null {
  int32(linkObjectId);
  return fieldMoveAreas(entities, mapRange).find((area) => area.definition.objectId === linkObjectId) ?? null;
}
