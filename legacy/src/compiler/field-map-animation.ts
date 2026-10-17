import { record } from "./content.js";
import { tableId } from "./table-id.js";
import { validateFieldMapAnimation, type FieldMapAnimationDefinition } from "../core/field-map-animation.js";
import type { FieldEntity } from "../field/types.js";

export function compileFieldMapAnimation(input: { group: string; object: Record<string, unknown>;
  entity: Pick<FieldEntity, "id" | "kind" | "layer" | "source">; properties: Record<string, unknown>;
  tables: Record<string, unknown> }): { definition: FieldMapAnimationDefinition | null; blockers: string[] } {
  if (input.entity.kind !== 10) return { definition: null, blockers: [] };
  try {
    const { object: o, properties: p, entity: e } = input;
    const int = (value: unknown, name: string) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
        throw new Error("Invalid animated map entity " + name);
      return value;
    };
    const bool = (key: string, absent: boolean) => {
      const value = p[key] === undefined || p[key] === null && ["front", "split", "collision"].includes(key) ? absent : p[key];
      if (typeof value !== "boolean") throw new Error("Invalid animated map entity " + key);
      return value;
    };
    if (bool("birdview_puppet", false) || bool("visible_minimap", false) ||
        int(p.interactive_icon_type ?? 0, "icon") !== 0 || p.link_object_id !== 0 ||
        int(p.object_id ?? 0, "object selector") !== 0 || int(p.blend_type ?? 0, "blend") !== 0 ||
        int(o.rotation ?? 0, "rotation") !== 0 || o.visible === false ||
        p.flight_altitude_ratio !== 1)
      throw new Error("Animated map entity auxiliary host is unresolved");
    const id = int(p.asset_id, "asset id"), rows = input.tables["mapobject.csv"];
    if (!Array.isArray(rows)) throw new Error("Missing animated mapobject master");
    const found = rows.map(record).filter(row => tableId(row.id) === id);
    if (found.length !== 1 || typeof found[0]!.asset_name !== "string" || !found[0]!.asset_name)
      throw new Error("Ambiguous animated mapobject master");
    const asset = found[0]!.asset_name as string, front = bool("front", true), building = bool("building", false);
    const sourceZ = int(p.zoffset ?? 0, "zoffset"), split = building ? false : bool("split", false);
    const definition: FieldMapAnimationDefinition = { kind: "source-field-animated-map-entity-v1",
      group: input.group, entityId: e.id, sourceEntityId: int(p.entity_id ?? 0, "entity selector"), source: { ...e.source },
      sourceDirection: int(p.direction ?? 0, "opaque direction"),
      geometry: { x: int(o.x, "x"), y: int(o.y, "y"), width: int(o.width, "width"), height: int(o.height, "height"), layer: e.layer },
      asset: { id, asset, animationAsset: asset.toUpperCase(), source: { ...e.source } },
      playOnAwake: bool("play_on_awake", false), collision: bool("collision", false), front, split, building,
      affected: bool("affected", false), zOffset: front && sourceZ < 0 ? 2 : sourceZ };
    validateFieldMapAnimation(definition);
    return { definition, blockers: [] };
  } catch (error) { return { definition: null, blockers: [error instanceof Error ? error.message : String(error)] }; }
}
