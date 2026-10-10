import { z } from "zod";
import { record } from "./content.js";
import { tableId } from "./table-id.js";
import { MINIMAP_ICON_TYPES } from "../core/minimap.js";
import type {
  Direction,
  EntityGroup,
  Evidence,
  FieldEntity,
} from "../field/types.js";

const rows = (v: unknown) => z.array(z.unknown()).parse(v);
const integer = (v: unknown) =>
  z.number().int().min(-2147483648).max(2147483647).parse(v);
const text = (v: unknown) => z.string().parse(v);
const finite = (v: unknown) => z.number().finite().parse(v);
export function entityProperties(raw: unknown): Record<string, unknown> {
  const out = new Map<string, unknown>();
  for (const item of rows(raw)) {
    const r = record(item),
      name = text(r.name);
    if (out.has(name)) throw new Error("Duplicate entity property " + name);
    out.set(name, r.value);
  }
  return Object.fromEntries(out);
}

/** Adapts the supported logical entity subset. Source objects with unknown behavior stay blockers. */
export function compileEntityGroup(
  name: string,
  asset: { data: unknown; source: Evidence },
  tables: Record<string, unknown>,
  tileSize = 16,
): EntityGroup {
  const entities: FieldEntity[] = [],
    blockers: EntityGroup["blockers"] = [];
  const data = record(asset.data);
  const row = (table: string, id: unknown) => {
    const found = rows(tables[table])
      .map(record)
      .filter((r) => tableId(r.id) === tableId(id));
    if (found.length !== 1)
      throw new Error(`Ambiguous or missing ${table}:${id}`);
    return found[0]!;
  };
  if (tileSize !== 16) throw new Error("Unreviewed entity grid");
  for (const [li, lraw] of rows(data.layers).entries()) {
    const layer = record(lraw),
      layerId = (
        {
          BottomObject: 0,
          GroundObject: 1,
          UpperObject: 2,
          CeilObject: 3,
          MinimapObject: 4,
        } as Record<string, number>
      )[text(layer.name)];
    if (layerId === undefined) {
      blockers.push({
        reason: `Unknown entity layer ${layer.name}`,
        source: { ...asset.source, pointer: `/layers/${li}` },
      });
      continue;
    }
    if (
      Number(layer.offsetx ?? 0) ||
      Number(layer.offsety ?? 0) ||
      Number(layer.x ?? 0) ||
      Number(layer.y ?? 0) ||
      layer.visible === false
    )
      blockers.push({
        reason: "Unsupported entity layer transform",
        source: { ...asset.source, pointer: `/layers/${li}` },
      });
    for (const [oi, raw] of rows(layer.objects).entries()) {
      const source = {
        ...asset.source,
        pointer: `/layers/${li}/objects/${oi}`,
      };
      try {
        const o = record(raw),
          p = entityProperties(o.properties),
          kind = integer(p.object_type);
        const issue = (reason: string) => blockers.push({ reason, source });
        if (![0, 2, 3, 4, 6, 18, 19, 27].includes(kind))
          issue(`Unsupported entity kind ${kind}`);
        if (
          kind === 18 &&
          !MINIMAP_ICON_TYPES.includes(
            integer(p.minimap_icon_type) as (typeof MINIMAP_ICON_TYPES)[number],
          )
        )
          issue("Unsupported minimap icon type");
        if ((o.visible === false && kind !== 27) || Number(o.rotation ?? 0))
          issue("Unsupported entity transform");
        if (kind === 27 && (name !== "entity_default" || o.gid))
          issue("Unsupported map range placement");
        if (o.ellipse || o.polygon || o.polyline || o.point)
          issue("Unsupported entity geometry");
        if (
          kind === 19 &&
          (p.through_condition_type !== 0 ||
            p.target_transportation_ids !== "" ||
            p.confirm_landing !== false)
        )
          issue("Unsupported dynamic collision condition");
        if (
          kind === 19 &&
          (!Number.isInteger(p.collision_type) ||
            Number(p.collision_type) < 0 ||
            Number(p.collision_type) > 7)
        )
          issue("Unsupported dynamic collision shape");
        if (
          kind === 2 &&
          (p.action_id !== 2 ||
            Number(p.gimmick ?? 0) !== 0 ||
            String(p.target_transportation_ids ?? "") !== "")
        )
          issue("Unsupported event activation condition");
        if (
          kind === 3 &&
          (p.action_id !== 3 ||
            Number(p.script_id ?? 0) !== 0 ||
            Number(p.link_object_id ?? 0) !== 0 ||
            Number(p.gimmick ?? 0) !== 0 ||
            String(p.target_transportation_ids ?? "") !== "")
        )
          issue("Unsupported map transition condition");
        if (
          kind === 6 &&
          (Number(p.move_type ?? 0) !== 0 ||
            p.all_layers === true ||
            p.birdview_puppet === true)
        )
          issue("Unsupported autonomous or cross-layer actor");
        if (kind === 6) {
          if (
            Number(p.action_id ?? 0) !== 0 ||
            Number(p.script_id ?? 0) !== 0 ||
            String(p.message_key ?? "") !== ""
          )
            issue("Unsupported actor interaction");
          if (p.pushed === true || p.affected === true || p.collision === false)
            issue("Unsupported actor movement response");
          if (Number(p.link_object_id ?? 0) !== 0)
            issue("Unsupported actor route binding");
          if (!p.asset_id) issue("Unresolved actor asset");
        }
        const scriptId = integer(p.script_id ?? 0),
          assetId = integer(p.asset_id ?? 0),
          entityId = integer(p.entity_id ?? 0);
        const script = scriptId
          ? text(row("script.csv", scriptId).script_name)
          : null;
        const image =
          kind === 6 && assetId
            ? text(row("mapobject.csv", assetId).asset_name)
            : null;
        const direction = (
          { 0: "down", 1: "up", 2: "right", 4: "down", 8: "left" } as Record<
            string,
            Direction
          >
        )[String(p.direction ?? 0)];
        if (!direction) issue("Unsupported entity direction");
        const width = finite(o.width) / tileSize,
          height = finite(o.height) / tileSize;
        if (width <= 0 || height <= 0) issue("Unsupported entity bounds");
        entities.push({
          id: entityId ? String(entityId) : `${name}:${li}:${oi}`,
          objectId: integer(p.object_id ?? 0),
          ...(kind === 18
            ? {
                minimap: {
                  icon: integer(p.minimap_icon_type),
                  x:
                    (integer(o.x) + Math.trunc(integer(o.width) / 2)) /
                    tileSize,
                  y:
                    (integer(o.y) - Math.trunc(integer(o.height) / 2)) /
                    tileSize,
                },
              }
            : {}),
          ...(kind === 3
            ? {
                destination: {
                  mapId: integer(p.map_id),
                  entrance: integer(p.point_id),
                },
              }
            : {}),
          kind,
          layer: layerId,
          x: finite(o.x) / tileSize,
          y: finite(o.y) / tileSize - (o.gid ? height : 0),
          width,
          height,
          direction: direction ?? "down",
          asset: image,
          script,
          collision: kind === 19 ? integer(p.collision_type) : null,
          destinationLayer: kind === 4 ? integer(p.layer) : null,
          source,
        });
      } catch (error) {
        blockers.push({
          reason: error instanceof Error ? error.message : String(error),
          source,
        });
      }
    }
  }
  const ids = new Set<string>();
  for (const e of entities) {
    if (ids.has(e.id))
      blockers.push({
        reason: "Duplicate entity identity " + e.id,
        source: e.source,
      });
    ids.add(e.id);
  }
  return { name, source: asset.source, entities, blockers };
}
