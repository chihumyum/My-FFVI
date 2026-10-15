import { z } from "zod";
import { record } from "./content.js";
import { tableId } from "./table-id.js";
import { MINIMAP_ICON_TYPES } from "../core/minimap.js";
import { compileFieldMapAnimation } from "./field-map-animation.js";
import { NATIVE_MAP_ANIMATION_HOST } from "../core/field-map-animation.js";
import { compileNpc } from "./npc.js";
import { compileFieldEffectBoard, fieldEffectCompilationBlockers } from "./field-effects.js";
import { compileFieldNativeNpc } from "./field-native-npc.js";
import { compileFieldMoveArea } from "./field-move-area.js";
import { compileFieldRelay } from "./field-relay.js";
import { compileInteraction, compileInteractionEligibility } from "./interaction.js";
import { compileTreasureInventoryDefinition, compileTreasureInteraction, compileTreasureTaskMessages } from "./treasure-inventory.js";
import type {
  Direction,
  EntityGroup,
  Evidence,
  FieldEntity,
  FieldInteraction,
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
  messages: Record<string, unknown> = {},
  tileSize = 16,
  importProfile?: "source-map-animation-legacy-audit-v1",
): EntityGroup {
  const legacyAnimation = importProfile === "source-map-animation-legacy-audit-v1";
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
        if (![0, 1, 2, 3, 4, 5, 6, 7, 8, ...(legacyAnimation ? [] : [10]), 11, 13, 17, 18, 19, 27].includes(kind))
          issue(`Unsupported entity kind ${kind}`);
        // Kind 11 has a distinct shared-particle/board owner. Recovering the
        // board does not admit its Unity particle and material providers.
        const effect = kind === 11 ? compileFieldEffectBoard(p,
          { x: o.x, y: o.y, width: o.width, height: o.height }, tables["mapobject.csv"], source) : undefined;
        if (effect) fieldEffectCompilationBlockers(effect).forEach(issue);
        if (kind === 1) issue("Unbound tile animation geometry");
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
        // TileMapObjectData declares integer pixel coordinates/dimensions. Fractional
        // JSON conversion has not been recovered; do not silently round these bounds.
        if (
          kind === 1 &&
          ![o.x, o.y, o.width, o.height].every(Number.isInteger)
        )
          issue("Unsupported fractional tile animation bounds");
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
        if (kind === 6 || kind === 17) {
          if (!p.asset_id) issue("Unresolved actor asset");
        }
        if (kind === 5 || kind === 7) {
          if (integer(p.asset_id ?? 0) !== 0)
            issue("Unsupported map object sprite asset");
          if (z.boolean().parse(p.birdview_puppet ?? false))
            issue("Unsupported birdview map object");
          // Init() sizes the collider from the source rectangle minus two pixels.
          // Only the aligned single-cell subset fits the current grid controller.
          if (
            !o.gid ||
            o.width !== 16 ||
            o.height !== 16 ||
            ![o.x, o.y].every(
              (v) => Number.isInteger(v) && Number(v) % 16 === 0,
            )
          )
            issue("Unsupported map object geometry");
        }
        if (kind === 8) {
          if (
            text(row("action.csv", p.action_id).action_name) !==
              "OpenTrigger" ||
            integer(p.script_id ?? 0) !== 0 ||
            Boolean(p.gimmick ?? false) ||
            String(p.target_transportation_ids ?? "") !== "" ||
            Boolean(p.birdview_puppet ?? false)
          )
            issue("Unsupported open trigger action/condition");
          // The observed source subset uses single-cell contact rectangles. Larger
          // or fractional placements need their contact geometry recovered first.
          if (
            !o.gid ||
            o.width !== 16 ||
            o.height !== 16 ||
            ![o.x, o.y].every(
              (v) => Number.isInteger(v) && Number(v) % 16 === 0,
            )
          )
            issue("Unsupported open trigger geometry");
        }
        const scriptId = integer(p.script_id ?? 0),
          assetId = integer(p.asset_id ?? 0),
          entityId = integer(p.entity_id ?? 0);
        const script = scriptId
          ? text(row("script.csv", scriptId).script_name)
          : null;
        const image =
          (kind === 6 || kind === 17 || kind === 10 && !legacyAnimation) && assetId
            ? text(row("mapobject.csv", assetId).asset_name)
            : null;
        // MapManager.CreateEntity cases 6 and 17 share PropertyNpc and
        // FieldNonPlayer.Init; ShopNPC has the same movement/media gates.
        const npc =
          kind === 6 || kind === 17
            ? compileNpc(p, script, tables, messages)
            : null;
        npc?.blockers.forEach(issue);
        const mapObject =
          kind === 5 || kind === 10 && !legacyAnimation ? compileInteraction(p, script, tables, messages) : null;
        mapObject?.blockers.forEach(issue);
        // Message failures stop the action, not the whole entity group. An
        // explicit message=false instruction can still use this reward binding.
        const treasure = kind === 7 ? compileTreasureInventoryDefinition(p, tables) : null;
        let treasureMessages: FieldEntity["treasureMessages"];
        let treasureAction: FieldInteraction = { kind: "none" };
        if (treasure) {
          try {
            treasureMessages = compileTreasureTaskMessages(treasure, messages,
              record(messages.system_zhc ?? {}), compileTreasureInteraction(treasure));
            treasureAction = { kind: "treasure", request: compileTreasureInteraction(treasure) };
          } catch (error) {
            treasureAction = { kind: "blocked", reason: error instanceof Error ? error.message : String(error) };
          }
        }
        const treasureInteraction = kind === 7 ? {
          ...compileInteractionEligibility(p, tables),
          collision: z.boolean().parse(p.collision),
          interaction: treasureAction,
          soundId: integer(p.se_id),
        } : null;
        const direction = (
          { 0: "down", 1: "up", 2: "right", 4: "down", 8: "left" } as Record<
            string,
            Direction
          >
        )[String(kind === 8 || kind === 5 || kind === 7 ? 0 : (p.direction ?? 0))];
        if ((kind !== 10 || legacyAnimation) && !direction) issue("Unsupported entity direction");
        const width = finite(o.width) / tileSize,
          height = finite(o.height) / tileSize;
        if (width <= 0 || height <= 0) issue("Unsupported entity bounds");
        const id = entityId ? String(entityId) : `${name}:${li}:${oi}`;
        const moveArea = kind === 13 ? compileFieldMoveArea({ group: name, entityId: id, layer: layerId,
          object: o, properties: p, source }) : undefined;
        let relay: FieldEntity["relay"];
        if (kind === 16) {
          try { relay = compileFieldRelay({ group: name, entityId: id, layer: layerId, object: o, properties: p, source }); }
          catch (error) { issue(error instanceof Error ? error.message : String(error)); }
        }
        const mapAnimation = legacyAnimation ? { definition: null, blockers: [] } : compileFieldMapAnimation({ group: name, object: o,
          entity: { id, kind, layer: layerId, source }, properties: p, tables });
        if (kind === 10 && !legacyAnimation) { issue(NATIVE_MAP_ANIMATION_HOST); mapAnimation.blockers.forEach(issue); }
        const nativeNpc = compileFieldNativeNpc({ group: name, object: o,
          entity: { id, kind, layer: layerId, source }, properties: p, tables });
        entities.push({
          id,
          ...(moveArea ? { moveArea } : {}),
          ...(relay ? { relay } : {}),
          ...(mapAnimation.definition ? { mapAnimation: mapAnimation.definition } : {}),
          ...(mapAnimation.blockers.length ? { mapAnimationBlockers: mapAnimation.blockers } : {}),
          ...(nativeNpc.definition ? { nativeNpc: nativeNpc.definition } : {}),
          ...(nativeNpc.blockers.length ? { nativeNpcBlockers: nativeNpc.blockers } : {}),
          objectId: integer(p.object_id ?? 0),
          ...(effect ? { effect } : {}),
          ...(npc ? { npc: npc.npc } : {}),
          ...(mapObject
            ? {
                mapObject: {
                  ...mapObject.properties,
                  // PropertyDefaultEntity differs from PropertyNonPlayer: nullable collision defaults false.
                  collision: z.boolean().parse(p.collision ?? false),
                },
              }
            : {}),
          ...(treasure ? { treasure, mapObject: treasureInteraction! } : {}),
          ...(treasureMessages ? { treasureMessages } : {}),
          ...(kind === 8
            ? {
                openTrigger: {
                  direction: z
                    .number()
                    .int()
                    .min(0)
                    .max(15)
                    .parse(p.direction ?? 15),
                  linkObject: integer(p.link_object_id ?? 0),
                  soundId: integer(p.se_id ?? 0),
                },
              }
            : {}),
          ...(kind === 1
            ? {
                tileAnimation: {
                  allLayers: z.boolean().parse(p.all_layers ?? true),
                  loop: z.boolean().parse(p.is_loop ?? false),
                  reverse: z.boolean().parse(p.reverse ?? false),
                },
              }
            : {}),
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
          y: finite(o.y) / tileSize - (o.gid && kind !== 1 ? height : 0),
          width,
          height,
          direction: kind === 10 && !legacyAnimation ? null : direction ?? "down",
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
