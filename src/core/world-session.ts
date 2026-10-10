import type { FieldContent } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import { EventState, int32 } from "./event-state.js";
import { FieldGame, type MapTransitionStop } from "./field.js";
import { missingFieldPoses } from "./character-media.js";
import { canonical } from "./canonical.js";
import { fieldCollisionRange, inCollisionRange } from "./collision.js";
import { requireMinimapMedia } from "./minimap.js";

export type PreparedMap = {
  readonly field: FieldGame;
  readonly request: MapTransitionStop;
};
type Ownership = {
  from: FieldGame;
  stop: MapTransitionStop;
  state: string;
  catalogHash: string;
};

/** Owns field lifetime. Hosts fetch and verify packages/images before committing a prepared map. */
export class WorldSession {
  private current: FieldGame;
  private prepared = new WeakMap<PreparedMap, Ownership>();
  private catalogHash: string | null = null;
  readonly transitions: {
    from: number;
    to: number;
    entrance: number;
    origin: string;
    contentHash: string;
    request: MapTransitionStop["request"];
    site: MapTransitionStop["site"];
  }[] = [];
  constructor(content: FieldContent, state = new EventState()) {
    this.current = new FieldGame(content, state);
  }
  get field(): FieldGame {
    return this.current;
  }
  prepare(catalog: WorldCatalog, target: WorldMapContent): PreparedMap {
    const from = this.current,
      stop = from.stop;
    if (stop?.kind !== "map-transition")
      throw new Error("No pending map transition");
    const request = stop.request,
      identity = from.content.map.identity;
    if (!identity) throw new Error("Unknown previous map/area identity");
    const indexed = catalog.maps[String(request.mapId)];
    if (this.catalogHash !== null && this.catalogHash !== catalog.contentHash)
      throw new Error("World catalog changed during the session");
    if (
      catalog.formatVersion !== 1 ||
      catalog.kind !== "world-development" ||
      target.formatVersion !== 1 ||
      target.kind !== "world-map-development" ||
      catalog.parentSourceSetHash !== from.content.parentSourceSetHash ||
      target.parentSourceSetHash !== catalog.parentSourceSetHash ||
      target.sourceSetHash !== catalog.sourceSetHash ||
      target.mediaSourceSetHash !== catalog.mediaSourceSetHash ||
      !indexed ||
      indexed.contentHash !== target.contentHash ||
      indexed.areaId !== target.areaId ||
      target.mapId !== request.mapId ||
      target.map?.identity?.mapId !== target.mapId ||
      target.map.identity.areaId !== target.areaId
    )
      throw new Error("Map package/source identity mismatch");
    int32(request.mapId);
    int32(request.entrance);
    int32(target.areaId);
    if (request.birdview) throw new Error("俯视世界地图视角尚未迁移");
    if (target.blockers.length) throw new Error(target.blockers[0]!.reason);
    const map = target.map!,
      group = map.groups?.entity_default;
    if (!group) throw new Error("Missing default entity group");
    if (group.blockers.length) throw new Error(group.blockers[0]!.reason);
    if (group.entities.some((e) => e.kind === 18) || catalog.minimap)
      requireMinimapMedia(group.entities, catalog.minimap);
    if (group.entities.some((e) => e.id === "-1001"))
      throw new Error("Default entity conflicts with player identity");
    const candidates = group.entities.filter(
      (e) => e.kind === 0 && e.objectId === request.entrance,
    );
    if (candidates.length !== 1)
      throw new Error("Missing or ambiguous PointIn entrance");
    const entry = candidates[0]!;
    if (
      !Number.isInteger(entry.x) ||
      !Number.isInteger(entry.y) ||
      entry.x < 0 ||
      entry.y < 0 ||
      entry.x >= map.width ||
      entry.y >= map.height ||
      !inCollisionRange(
        entry,
        fieldCollisionRange(map.width, map.height, group.entities),
      ) ||
      !map.collisions[entry.layer]
    )
      throw new Error("Unsupported entrance geometry/layer");
    const characters: FieldContent["characters"] = {};
    for (const key of new Set([
      ...target.characterAssets,
      from.player.asset,
      ...(from.player.mount ? [from.player.mount] : []),
    ])) {
      const character = catalog.characters[key];
      if (character) characters[key] = character;
    }
    for (const [key, mounted] of [
      [from.player.asset, !!from.player.mount],
      ...(from.player.mount ? [[from.player.mount, false]] : []),
    ] as [string, boolean][]) {
      const missing = missingFieldPoses(characters[key], mounted);
      if (missing.length)
        throw new Error(`Missing traveler media ${key}/${missing.join(",")}`);
    }
    // Work on a copy: failed preparation cannot clear old local variables or alter flags.
    const snapshot = from.eventState.snapshot(),
      state = new EventState(snapshot);
    if (identity.areaId === target.areaId) state.clearMap(target.mapId);
    else if (identity.areaId > 0) state.clearArea(target.mapId);
    const content: FieldContent = {
      formatVersion: 1,
      kind: "field-development",
      sourceSetHash: target.sourceSetHash,
      parentSourceSetHash: target.parentSourceSetHash,
      contentHash: target.contentHash,
      map: {
        ...map,
        entities: group.entities,
        initialGroups: ["entity_default"],
      },
      scripts: target.scripts,
      scriptLocals: target.scriptLocals,
      characters,
      ...(catalog.minimap ? { minimap: catalog.minimap } : {}),
      entry: {
        player: {
          x: entry.x,
          y: entry.y,
          layer: entry.layer,
          direction: entry.direction,
          asset: from.player.asset,
          mount: from.player.mount ?? "",
        },
        evidence: [entry.source],
        description: "来源入口；开发运行保留当前队伍外观。",
      },
      limitations: [
        ...target.limitations,
        "开发运行保留当前队伍外观；地图淡出、BGM、随机遇敌和完整交通工具生命周期尚未接入。",
      ],
    };
    const field = new FieldGame(content, state);
    const script = request.continuation || target.initializer;
    if (script) field.startEvent(script);
    if (field.stop?.kind === "unsupported") throw new Error(field.stop.message);
    const prepared = { field, request: stop };
    this.prepared.set(prepared, {
      from,
      stop,
      state: canonical(snapshot),
      catalogHash: catalog.contentHash,
    });
    return prepared;
  }
  commit(value: PreparedMap): boolean {
    const ownership = this.prepared.get(value);
    this.prepared.delete(value);
    if (
      !ownership ||
      ownership.from !== this.current ||
      ownership.stop !== this.current.stop ||
      ownership.state !== canonical(this.current.eventState.snapshot())
    )
      return false;
    this.transitions.push({
      from: this.current.content.map.identity!.mapId,
      to: value.request.request.mapId,
      entrance: value.request.request.entrance,
      origin: value.request.request.origin,
      contentHash: value.field.content.contentHash,
      request: structuredClone(value.request.request),
      site: value.request.site,
    });
    this.current = value.field;
    this.catalogHash = ownership.catalogHash;
    return true;
  }
  fail(request: MapTransitionStop, message: string): void {
    if (this.current.stop !== request) return;
    this.current.stop = { kind: "unsupported", message, site: request.site };
  }
}
