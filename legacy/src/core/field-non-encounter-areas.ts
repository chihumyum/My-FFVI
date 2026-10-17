import {sourcePropertyAreaCellRect} from "./field-move-area.js";
import type {FieldCameraMapRange} from "./field-camera.js";
import type { Evidence, FieldEntity, FieldContent, Point } from "../field/types.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";

/** Exact source property/boolean query capability. This is not a native random
 * step/RNG implementation, an Actor factory or a visual omission policy. */
export const SOURCE_NON_ENCOUNTER_AREAS = "source-non-encounter-areas-v1" as const;
export type SourceNonEncounterAreas = typeof SOURCE_NON_ENCOUNTER_AREAS;
export type SourceNonEncounterArea = {
  kind: "source-non-encounter-area-v1";
  group: string;
  sourceTiledId: number;
  sourceEntityId: number | null;
  pixelBounds: { x: number; y: number; width: number; height: number };
  source: Evidence;
};
export type SourceNonEncounterAreaDeclaration = { kind: SourceNonEncounterAreas };

export function validateSourceNonEncounterAreasRuntime(value: unknown): asserts value is SourceNonEncounterAreas | undefined {
  if (value !== undefined && value !== SOURCE_NON_ENCOUNTER_AREAS)
    throw new Error("Unknown source non-encounter area runtime");
}
export function validateSourceNonEncounterArea(value: SourceNonEncounterArea): void {
  checkpointKeys(value, "kind,group,sourceTiledId,sourceEntityId,pixelBounds,source");
  if (value.kind !== "source-non-encounter-area-v1" || typeof value.group !== "string" ||
      !value.group || value.group.trim() !== value.group)
    throw new Error("Invalid source non-encounter area identity");
  checkpointInteger(value.sourceTiledId, 1, 0x7fffffff);
  if (value.sourceEntityId !== null) checkpointInteger(value.sourceEntityId, -0x80000000, 0x7fffffff);
  checkpointKeys(value.pixelBounds, "x,y,width,height");
  checkpointInteger(value.pixelBounds.x, -0x80000000, 0x7fffffff);
  checkpointInteger(value.pixelBounds.y, -0x80000000, 0x7fffffff);
  checkpointInteger(value.pixelBounds.width, 1, 0x7fffffff);
  checkpointInteger(value.pixelBounds.height, 1, 0x7fffffff);
  const s = value.source as Evidence & {sha256?:unknown;serializedFile?:unknown};
  if (!s || typeof s.file !== "string" || !s.file || typeof s.assetPath !== "string" || !s.assetPath ||
      typeof s.objectId !== "string" || !/^-?\d+$/.test(s.objectId) ||
      typeof s.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.sha256) ||
      typeof s.serializedFile !== "string" || !s.serializedFile || !/^\/layers\/\d+\/objects\/\d+$/.test(s.pointer ?? ""))
    throw new Error("Unbound source non-encounter area evidence");
}

function validateCarrier(content:FieldContent, entity:FieldEntity, area:SourceNonEncounterArea):void {
  validateSourceNonEncounterArea(area);
  const b = area.pixelBounds;
  if (canonical(area.source) !== canonical(entity.source) || entity.x !== b.x / 16 || entity.y !== b.y / 16 ||
    entity.width !== b.width / 16 || entity.height !== b.height / 16 ||
    entity.asset !== null || entity.script !== null || entity.collision !== null || entity.objectId !== 0 || entity.destinationLayer !== null ||
    entity.nativeNpc !== undefined || entity.npc !== undefined || entity.effect !== undefined || entity.mapObject !== undefined ||
    entity.treasure !== undefined || entity.openTrigger !== undefined || entity.tileAnimation !== undefined || entity.destination !== undefined ||
    entity.minimap !== undefined || entity.moveArea !== undefined || entity.relay !== undefined || entity.vehicleAction !== undefined ||
    entity.mapAnimation !== undefined || entity.eventActivation !== undefined ||
    !Number.isInteger(entity.layer) || entity.layer < 0 || entity.layer > 4)
    throw new Error("Source non-encounter area carrier disagrees with its immutable source property");
  const pointer = /^\/layers\/(\d+)\/objects\/(\d+)$/.exec(area.source.pointer!)!;
  const expectedId = area.sourceEntityId !== null && area.sourceEntityId !== 0 ? String(area.sourceEntityId)
    : `${area.group}:${pointer[1]}:${pointer[2]}`;
  if (entity.id !== expectedId) throw new Error("Source non-encounter property identity mismatch");
  const group = content.map.groups?.[area.group];
  if (!group || !group.entities.some(e => e === entity || canonical(e) === canonical(entity)))
    throw new Error("Source non-encounter area is not bound to its current map group");
 }

/** MapModel current properties are default + latest selected group. Its
 * EncounterLot then AddRanges that selection. Only boolean OR membership is
 * exposed; duplicate/order-oblivious queries follow the complete source loop. */
export function prepareSourceNonEncounterAreas(content: FieldContent,
  runtime: SourceNonEncounterAreas | undefined, properties: readonly FieldEntity[],
  prior: readonly SourceNonEncounterArea[]): readonly SourceNonEncounterArea[] {
  validateSourceNonEncounterAreasRuntime(runtime);
  const declaration = content.map.sourceNonEncounterAreas;
  if (declaration !== undefined) {
    checkpointKeys(declaration, "kind");
    if (declaration.kind !== SOURCE_NON_ENCOUNTER_AREAS)
      throw new Error("Unknown source non-encounter area content");
  }
  const areas = properties.filter(e => e.kind === 23 || e.nonEncounterArea !== undefined);
  if (!areas.length && !prior.length) return prior;
  if (runtime !== SOURCE_NON_ENCOUNTER_AREAS || declaration?.kind !== SOURCE_NON_ENCOUNTER_AREAS)
    throw new Error("Source non-encounter areas require current content and runtime authority");
  for (const area of prior) {
    validateSourceNonEncounterArea(area);
    const current=content.map.groups?.[area.group]?.entities.filter(e => e.kind === 23 && canonical(e.nonEncounterArea) === canonical(area)) ?? [];
    if(current.length!==1) throw new Error("Source non-encounter region lost its unique current content binding");
    validateCarrier(content,current[0]!,area);
  }
  const next: SourceNonEncounterArea[] = [];
  for (const entity of areas) {
    const area = entity.nonEncounterArea;
    if (entity.kind !== 23 || !area) throw new Error("Missing source non-encounter area property");
    validateCarrier(content,entity,area);
    // Copy source data. No mutable current transform, visual or actor identity
    // is manufactured for anonymous property-only objects.
    next.push(structuredClone(area));
  }
  return [...prior, ...next];
}

export function sourceStandingInNonEncounterArea(areas: readonly SourceNonEncounterArea[], mapRange: FieldCameraMapRange, cell: Point): boolean {
  if (![cell.x, cell.y].every(v => Number.isFinite(v) && Math.fround(v) === v))
    throw new Error("Invalid source non-encounter query cell");
  for (const area of areas) {
    validateSourceNonEncounterArea(area);
    const {x,y,width,height} = sourcePropertyAreaCellRect(area.pixelBounds, mapRange);
    // The shared AreaObject conversion retains source Float32 nearest-even
    // rounding after map-origin subtraction; the query includes all edges.
    if (cell.x >= x && cell.x <= Math.fround(x + width) && cell.y >= y && cell.y <= Math.fround(y + height)) return true;
  }
  return false;
}
