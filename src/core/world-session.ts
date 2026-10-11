import type { FieldContent } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import { EventState, int32 } from "./event-state.js";
import {
  FieldGame,
  type MapTransitionStop,
  type FieldCheckpoint,
  type FieldGameOptions,
} from "./field.js";
import { missingFieldPoses } from "./character-media.js";
import { canonical } from "./canonical.js";
import { fieldCollisionRange, inCollisionRange } from "./collision.js";
import { requireMinimapMedia } from "./minimap.js";
import { StaticAudioState } from "./static-audio.js";
import { checkpointKeys, checkpointInteger } from "./checkpoint-validation.js";
export type WorldStateOwner = {
  current: FieldGameOptions;
  prepare(): { ports: FieldGameOptions; commit(): boolean };
};

type Traveler = Pick<FieldContent["entry"]["player"], "asset" | "mount">;
export type WorldCheckpoint = {
  kind: "idle-world-v1";
  initialHash: string;
  location: {
    catalogHash: string;
    mapId: number;
    entrance: number;
    traveler: Traveler;
  } | null;
  field: FieldCheckpoint;
};

/** Shared package resolution for map entry and saved-state restoration. Does not execute scripts. */
function worldFieldContent(
  catalog: WorldCatalog,
  target: WorldMapContent,
  request: { mapId: number; entrance: number; birdview: boolean },
  traveler: Traveler,
  parentSourceSetHash: string,
): FieldContent {
  const indexed = catalog.maps[String(request.mapId)];
  if (
    catalog.formatVersion !== 1 ||
    catalog.kind !== "world-development" ||
    target.formatVersion !== 1 ||
    target.kind !== "world-map-development" ||
    catalog.parentSourceSetHash !== parentSourceSetHash ||
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
    traveler.asset,
    ...(traveler.mount ? [traveler.mount] : []),
  ])) {
    const character = catalog.characters[key];
    if (character) characters[key] = character;
  }
  for (const [key, mounted] of [
    [traveler.asset, !!traveler.mount],
    ...(traveler.mount ? [[traveler.mount, false]] : []),
  ] as [string, boolean][]) {
    const missing = missingFieldPoses(characters[key], mounted);
    if (missing.length)
      throw new Error(`Missing traveler media ${key}/${missing.join(",")}`);
  }
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
    ...(catalog.bgm ? { bgm: catalog.bgm } : {}),
    ...(catalog.environment ? { environment: catalog.environment } : {}),
    entry: {
      player: {
        x: entry.x,
        y: entry.y,
        layer: entry.layer,
        direction: entry.direction,
        asset: traveler.asset,
        mount: traveler.mount ?? "",
      },
      evidence: [entry.source],
      description: "来源入口；开发运行保留当前队伍外观。",
    },
    limitations: [
      ...target.limitations,
      "开发运行保留当前队伍外观；地图淡出、自动选曲、随机遇敌和完整交通工具生命周期尚未接入。脚本背景音乐和环境音播放/停止已接入。",
      "环境音暂停/变调、SEAD 类别混音、起止宏、空间处理与混响尚未复现。",
    ],
  };
  return content;
}

export type PreparedMap = {
  readonly field: FieldGame;
  readonly request: MapTransitionStop;
};
type Ownership = {
  from: FieldGame;
  stop: MapTransitionStop;
  state: string;
  bgm: string;
  environment: string;
  catalogHash: string;
  owned?: { commit(): boolean };
};

/** Owns field lifetime. Hosts fetch and verify packages/images before committing a prepared map. */
export class WorldSession {
  private current: FieldGame;
  private location: WorldCheckpoint["location"] = null;
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
  constructor(
    private readonly initial: FieldContent,
    state = new EventState(),
    private readonly owned?: WorldStateOwner,
  ) {
    this.current = new FieldGame(
      initial,
      state,
      undefined,
      undefined,
      owned?.current ?? {},
    );
  }
  get field(): FieldGame {
    return this.current;
  }
  checkpoint(): WorldCheckpoint {
    return {
      kind: "idle-world-v1",
      initialHash: this.initial.contentHash,
      location: structuredClone(this.location),
      field: this.current.checkpoint(),
    };
  }
  /** Used on an unpublished candidate session; current host state is replaced only after media preparation. */
  restore(
    snapshot: WorldCheckpoint,
    catalog?: WorldCatalog,
    target?: WorldMapContent,
  ): void {
    checkpointKeys(snapshot, "kind,initialHash,location,field");
    if (
      snapshot.kind !== "idle-world-v1" ||
      snapshot.initialHash !== this.initial.contentHash
    )
      throw new Error("World checkpoint source/version mismatch");
    let content = this.initial;
    const loc = snapshot.location;
    if (loc !== null) {
      checkpointKeys(loc, "catalogHash,mapId,entrance,traveler");
      checkpointKeys(loc.traveler, "asset,mount");
      checkpointInteger(loc.mapId, 1, 0x7fffffff);
      checkpointInteger(loc.entrance, 0, 0x7fffffff);
      if (
        !catalog ||
        !target ||
        loc.catalogHash !== catalog.contentHash ||
        typeof loc.traveler.asset !== "string" ||
        typeof loc.traveler.mount !== "string"
      )
        throw new Error("Saved world dependencies are unavailable or changed");
      content = worldFieldContent(
        catalog,
        target,
        { mapId: loc.mapId, entrance: loc.entrance, birdview: false },
        loc.traveler,
        this.initial.parentSourceSetHash,
      );
    }
    const next = FieldGame.restore(
      content,
      snapshot.field,
      this.owned?.current ?? {},
    );
    this.current = next;
    this.location = structuredClone(loc);
    this.catalogHash = loc?.catalogHash ?? null;
    this.prepared = new WeakMap();
    this.transitions.length = 0;
  }
  prepare(catalog: WorldCatalog, target: WorldMapContent): PreparedMap {
    const from = this.current,
      stop = from.stop;
    if (stop?.kind !== "map-transition")
      throw new Error("No pending map transition");
    const request = stop.request,
      identity = from.content.map.identity;
    if (!identity) throw new Error("Unknown previous map/area identity");
    if (this.catalogHash !== null && this.catalogHash !== catalog.contentHash)
      throw new Error("World catalog changed during the session");
    const content = worldFieldContent(
      catalog,
      target,
      request,
      { asset: from.player.asset, mount: from.player.mount ?? "" },
      from.content.parentSourceSetHash,
    );
    // Work on a copy: failed preparation cannot clear old local variables or alter flags.
    const snapshot = from.eventState.snapshot(),
      state = new EventState(snapshot);
    if (identity.areaId === target.areaId) state.clearMap(target.mapId);
    else if (identity.areaId > 0) state.clearArea(target.mapId);
    if (
      from.bgm.voices.length &&
      catalog.bgm?.sourceSetHash !== from.content.bgm?.sourceSetHash
    )
      throw new Error("BGM media changed during map transition");
    const bgm = from.bgm.snapshot();
    if (
      from.environment.voices.length &&
      catalog.environment?.sourceSetHash !==
        from.content.environment?.sourceSetHash
    )
      throw new Error("Environment media changed during map transition");
    const environment = from.environment.snapshot();
    const owned = this.owned?.prepare();
    const field = new FieldGame(
      content,
      state,
      new StaticAudioState(bgm),
      new StaticAudioState(environment),
      owned?.ports ?? {},
    );
    const script = request.continuation || target.initializer;
    if (script) field.startEvent(script);
    if (field.stop?.kind === "unsupported") throw new Error(field.stop.message);
    const prepared = { field, request: stop };
    this.prepared.set(prepared, {
      from,
      stop,
      state: canonical(snapshot),
      bgm: canonical(bgm),
      environment: canonical(environment),
      catalogHash: catalog.contentHash,
      ...(owned ? { owned } : {}),
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
      ownership.state !== canonical(this.current.eventState.snapshot()) ||
      ownership.bgm !== canonical(this.current.bgm.snapshot()) ||
      ownership.environment !== canonical(this.current.environment.snapshot())
    )
      return false;
    if (ownership.owned && !ownership.owned.commit()) return false;
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
    this.location = {
      catalogHash: ownership.catalogHash,
      mapId: value.request.request.mapId,
      entrance: value.request.request.entrance,
      traveler: {
        asset: value.field.content.entry.player.asset,
        mount: value.field.content.entry.player.mount,
      },
    };
    return true;
  }
  fail(request: MapTransitionStop, message: string): void {
    if (this.current.stop !== request) return;
    this.current.stop = { kind: "unsupported", message, site: request.site };
  }
}
