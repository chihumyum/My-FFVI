import { record } from "./content.js";
import { tableId } from "./table-id.js";
import { FIELD_NATIVE_NPC_STANDBY_SOURCES, fieldNativeNpcStandbyPosition, validateFieldNativeNpc,
  type FieldNativeNpcDefinition, type FieldNativeNpcStandby } from "../core/field-native-npc.js";
import type { FieldEntity } from "../field/types.js";

export function compileFieldNativeNpcStandby(sources: readonly { file: string; sha256: string }[]): FieldNativeNpcStandby {
  for (const expected of FIELD_NATIVE_NPC_STANDBY_SOURCES)
    if (sources.filter((s) => s.file === expected.file && s.sha256 === expected.sha256).length !== 1 ||
        sources.filter((s) => s.file === expected.file).length !== 1)
      throw new Error("Unreviewed native NPC standby source: " + expected.file);
  const definition: FieldNativeNpcStandby = { kind: "native-map-npc-standby-v1", position: { x: 30000, y: 30000 },
    sources: FIELD_NATIVE_NPC_STANDBY_SOURCES.map((s) => ({ ...s })) };
  fieldNativeNpcStandbyPosition(definition);
  return definition;
}

/** Called beside compileNpc, not instead of it: dialogue, contact/collision and
 * interaction prerequisites continue to belong to their existing compilers. */
export function compileFieldNativeNpc(input: {
  group: string;
  object: Record<string, unknown>;
  entity: Pick<FieldEntity, "id" | "kind" | "layer" | "source">;
  properties: Record<string, unknown>;
  tables: Record<string, unknown>;
  /** Explicit Web caller option; strict source compilation never passes it. */
  flatProjection?: "web-source-npc-flat-projection-v1";
}): { definition: FieldNativeNpcDefinition | null; blockers: string[] } {
  const { group, object, entity, properties: p, tables } = input;
  if (entity.kind !== 6 && entity.kind !== 17) return { definition: null, blockers: [] };
  const blockers: string[] = [];
  try {
    const integer = (value: unknown, name: string): number => {
      const n = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
      if (typeof n !== "number" || !Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff)
        throw new Error("Invalid native NPC " + name);
      return n;
    };
    const bool = (name: string, absent = false): boolean => {
      const value = p[name] ?? absent;
      if (typeof value !== "boolean") throw new Error("Invalid native NPC " + name);
      return value;
    };
    if (integer(p.move_type ?? 0, "movement controller") !== 0) blockers.push("Native NPC autonomous movement controller is unresolved");
    if (bool("affected")) blockers.push("Native NPC screen-effect stencil is unresolved");
    if (input.flatProjection !== undefined && input.flatProjection !== "web-source-npc-flat-projection-v1") throw new Error("Unknown NPC flat projection policy");
    if ((bool("birdview_puppet") || bool("all_layers")) && input.flatProjection === undefined) blockers.push("Native NPC birdview/cross-layer provider is unresolved");
    if (bool("visible_minimap")) blockers.push("Native NPC minimap sprite provider is unresolved");
    if (integer(object.rotation ?? 0, "rotation") !== 0 || object.visible === false || object.polygon || object.polyline)
      blockers.push("Native NPC transformed object geometry is unresolved");
    const width = integer(object.width, "width"), height = integer(object.height, "height");
    if (width !== 16 || height !== 16) blockers.push("Native NPC non-cell collision geometry is unresolved");
    const sourceDirection = integer(p.direction ?? 0, "direction");
    if (![0, 1, 2, 4, 8].includes(sourceDirection)) blockers.push("Native NPC diagonal direction is unresolved");
    const sourceEntityId = integer(p.entity_id ?? 0, "entity selector");
    if (sourceEntityId < 0) blockers.push("Native NPC negative entity selector is unresolved");
    const id = integer(p.asset_id, "map-object asset id");
    if (!Array.isArray(tables["mapobject.csv"])) throw new Error("Missing native NPC mapobject master");
    const rows = tables["mapobject.csv"].map(record).filter((r) => tableId(r.id) === id);
    if (rows.length !== 1) throw new Error("Ambiguous native NPC mapobject master " + id);
    const row = rows[0]!, asset = row.asset_name;
    if (typeof asset !== "string" || !asset) throw new Error("Missing native NPC map-object asset name");
    const shadowType = integer(row.shadow_type, "shadow type");
    if (shadowType !== 0 && shadowType !== 1) blockers.push("Native NPC custom shadow media is unresolved");
    if (blockers.length) return { definition: null, blockers };
    const definition: FieldNativeNpcDefinition = {
      kind: "native-map-npc-v1", group, sourceEntityId, entityId: entity.id, objectType: entity.kind,
      source: { ...entity.source }, controller: "wait", turnAround: bool("turn_around"),
      updateAttribute: bool("move_while_display_message") ? 10 : 2,
      geometry: { x: integer(object.x, "x"), y: integer(object.y, "y"), width: 16, height: 16, layer: entity.layer },
      sourceDirection: sourceDirection as FieldNativeNpcDefinition["sourceDirection"],
      direction: ({ 0: "down", 1: "up", 2: "right", 4: "down", 8: "left" } as const)[sourceDirection as 0 | 1 | 2 | 4 | 8],
      asset: { id, asset, animationAsset: asset.toUpperCase(), shadowType: shadowType as 0 | 1, source: { ...entity.source } },
    };
    validateFieldNativeNpc(definition);
    return { definition, blockers: [] };
  } catch (error) {
    return { definition: null, blockers: [error instanceof Error ? error.message : String(error)] };
  }
}
