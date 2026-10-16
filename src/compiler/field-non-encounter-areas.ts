import type { Evidence } from "../field/types.js";
import { validateSourceNonEncounterArea, type SourceNonEncounterArea } from "../core/field-non-encounter-areas.js";

/** Property-only factory23: editor visibility/layer are not encounter masks.
 * Unknown extra properties and geometry remain explicit blockers. */
export function compileSourceNonEncounterArea(input: {
  group: string; object: Record<string, unknown>; properties: Record<string, unknown>; source: Evidence;
}): SourceNonEncounterArea {
  const { object: o, properties: p } = input, keys = Object.keys(p).sort().join(",");
  if (p.object_type !== 23 || !["object_type", "entity_id,object_type"].includes(keys))
    throw new Error("Unresolved source non-encounter area properties");
  if (o.gid !== undefined || o.ellipse || o.polygon || o.polyline || o.point || Number(o.rotation ?? 0) !== 0 ||
      typeof o.visible !== "boolean")
    throw new Error("Unresolved source non-encounter area geometry");
  const definition: SourceNonEncounterArea = {
    kind: "source-non-encounter-area-v1", group: input.group,
    sourceTiledId: o.id as number, sourceEntityId: p.entity_id === undefined ? null : p.entity_id as number,
    pixelBounds: { x: o.x as number, y: o.y as number, width: o.width as number, height: o.height as number },
    source: structuredClone(input.source),
  };
  validateSourceNonEncounterArea(definition); return definition;
}
