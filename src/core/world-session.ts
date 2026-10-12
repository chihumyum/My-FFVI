import type { FieldContent } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import { EventState, UnknownEventValue, int32, type VariableRef } from "./event-state.js";
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
import { prepareMapPartyEntry, readMapPartySwitching, type MapPartyEntryPlan } from "./map-party-entry.js";
import { Transportations } from "./transportation.js";
import type { FieldFadeState } from "./field-fade.js";
export type WorldStateOwner = {
  current: FieldGameOptions;
  prepare(): { ports: FieldGameOptions; commit(): boolean };
};

type Traveler = Pick<FieldContent["entry"]["player"], "asset" | "mount"> & {
  transportationId: number | null;
};
export type WorldCheckpoint = {
  kind: "idle-world-v8";
  initialHash: string;
  location: {
    catalogHash: string;
    mapId: number;
    entrance: number;
    /** Native actor media is already owned by field.partyActors. The geometry
     * harness retains its explicit traveler without claiming an actor host. */
    traveler: Traveler | null;
  } | null;
  field: FieldCheckpoint;
};

/** Shared package resolution for map entry and saved-state restoration. Does not execute scripts. */
export function worldFieldContent(
  catalog: WorldCatalog,
  target: WorldMapContent,
  request: { mapId: number; entrance: number; birdview: boolean },
  traveler: Traveler,
  parentSourceSetHash: string,
  actorEntry?: { plan: MapPartyEntryPlan; assets: string[] },
  fade?: FieldContent["entry"]["fade"],
  sourceCamera = false,
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
  if (map.backgrounds?.length && !sourceCamera)
    throw new Error("Source background requires a bound camera host");
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
  if (actorEntry && (!target.partyEntry || target.partyEntry.mapId !== target.mapId ||
      target.partyEntry.width !== map.width || target.partyEntry.height !== map.height || target.partyEntryBlockers?.length))
    throw new Error("Map actor definition is not bound to the destination map");
  if (actorEntry && (actorEntry.plan.player.x !== entry.x || actorEntry.plan.player.y !== entry.y ||
      actorEntry.plan.player.layer !== entry.layer || actorEntry.plan.player.direction !== entry.direction))
    throw new Error("Map actor PointIn is not bound to the destination entity");
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
    // Source MapSetup places the player at PointIn independently of collision
    // mesh creation. Cinematic maps can legitimately have no collider grid.
    // Do not invent an all-walkable grid: any later walk still requires the
    // real collision provider in FieldGame.
    (!map.collisions[entry.layer] && !(sourceCamera && actorEntry))
  )
    throw new Error("Unsupported entrance geometry/layer");
  const characters: FieldContent["characters"] = {};
  for (const key of new Set([
    ...target.characterAssets,
    traveler.asset,
    ...(traveler.mount ? [traveler.mount] : []),
    ...(actorEntry?.assets ?? []),
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
      ...(actorEntry ? { partyActorCamera: actorEntry.plan.checkpoint.context.camera } : {}),
    },
    scripts: target.scripts,
    scriptLocals: target.scriptLocals,
    ...(target.scriptSystemFlags ? { scriptSystemFlags: target.scriptSystemFlags } : {}),
    characters,
    // The package describes conditional normal-view capability. Geometry-only
    // previews cannot acquire a native camera lifecycle just by loading it.
    ...(sourceCamera && target.cameraHost ? { cameraHost: target.cameraHost } : {}),
    ...(sourceCamera && target.scriptPuppetContexts ? { scriptPuppetContexts: target.scriptPuppetContexts } : {}),
    ...(catalog.playerFactory ? { playerFactory: structuredClone(catalog.playerFactory) } : {}),
    ...(catalog.minimap ? { minimap: catalog.minimap } : {}),
    ...(catalog.bgm ? { bgm: catalog.bgm } : {}),
    ...(catalog.environment ? { environment: catalog.environment } : {}),
    ...(catalog.treasureInventoryLimits ? { treasureInventoryLimits: catalog.treasureInventoryLimits } : {}),
    entry: {
      ...(fade ? { fade: structuredClone(fade) } : {}),
      synchronization: { kind: "map-entry" },
      ...(actorEntry ? { partyActors: actorEntry.plan.checkpoint,
        playerVisible: actorEntry.plan.player.visible, cameraOffset: actorEntry.plan.cameraOffset } : {}),
      ...(traveler.transportationId !== null ? { transportationId: traveler.transportationId } : {}),
      player: {
        x: entry.x,
        y: entry.y,
        layer: entry.layer,
        direction: entry.direction,
        asset: traveler.asset,
        mount: traveler.mount ?? "",
      },
      evidence: [entry.source],
      description: actorEntry ? "来源 MapSetup/PointIn 队伍入口。" : "来源入口；独立地图机制检查。",
    },
    limitations: [
      ...target.limitations,
      "普通 PointIn 的队伍入口支持单队伍、已知交通及平面非循环地图；伙伴、多队伍定位和原生负入口恢复仍明确阻塞。",
      "地图淡出、自动选曲、随机遇敌和完整交通工具生命周期尚未接入。脚本背景音乐和环境音播放/停止已接入。",
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
  request: string;
  state: string;
  bgm: string;
  environment: string;
  actors: string;
  presentation: string;
  fade: string;
  camera: string;
  publishPresentation(): void;
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
    initialFade?: FieldFadeState,
  ) {
    this.current = new FieldGame(
      initial,
      state,
      undefined,
      undefined,
      { ...(owned?.current ?? {}), ...(initial.playerFactory ? { playerVisibility: initial.playerFactory.capability } : {}) },
      initialFade,
    );
  }
  get field(): FieldGame {
    return this.current;
  }
  checkpoint(): WorldCheckpoint {
    return {
      kind: "idle-world-v8",
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
      snapshot.kind !== "idle-world-v8" ||
      snapshot.initialHash !== this.initial.contentHash
    )
      throw new Error("World checkpoint source/version mismatch");
    let content = this.initial;
    const loc = snapshot.location;
    if (loc !== null) {
      checkpointKeys(loc, "catalogHash,mapId,entrance,traveler");
      checkpointInteger(loc.mapId, 1, 0x7fffffff);
      checkpointInteger(loc.entrance, 0, 0x7fffffff);
      if (
        !catalog ||
        !target ||
        loc.catalogHash !== catalog.contentHash
      )
        throw new Error("Saved world dependencies are unavailable or changed");
      const appearance = this.owned?.current.partyAppearance;
      const initialActors = this.initial.entry.partyActors;
      let actorEntry: { plan: MapPartyEntryPlan; assets: string[] } | undefined;
      let traveler: Traveler;
      if (initialActors && appearance) {
        if (loc.traveler !== null) throw new Error("Duplicate saved native traveler ownership");
        const transportationId = this.initial.entry.transportationId;
        if (transportationId === undefined || snapshot.field.transportationId !== transportationId)
          throw new Error("Saved transportation identity changed without a supported transition");
        if (!catalog.transportation || !target.partyEntry)
          throw new Error("Saved map actor source dependencies are unavailable");
        // This is a Web checkpoint reconstruction, not native negative-Point
        // restoration and not a replay of MapSetup. All admitted v5 entries
        // used the ordinary single-party branch. Source initial actor inventory
        // supplies immutable identities/riding structure; destination metadata
        // supplies new providers. Saved actors never validate their own origin.
        const plan = prepareMapPartyEntry(appearance.catalog, {
          definition: target.partyEntry, entrance: loc.entrance, mapViewType: 0,
          prior: initialActors, playerVisible: true, party: appearance.current(),
          transportation: new Transportations(catalog.transportation).identity(transportationId),
          canPartySwitching: false,
        });
        this.requireActorPresentation(plan);
        actorEntry = { plan, assets: Object.values(appearance.catalog.assets).map((a) => a.asset) };
        traveler = { asset: plan.player.asset, mount: plan.player.mount, transportationId };
      } else {
        if (loc.traveler === null) throw new Error("Unbound saved native map actors");
        checkpointKeys(loc.traveler, "asset,mount,transportationId");
        if (loc.traveler.transportationId !== null)
          checkpointInteger(loc.traveler.transportationId, 1, 0x7fffffff);
        if (loc.traveler.transportationId !== (this.initial.entry.transportationId ?? null))
          throw new Error("Saved transportation identity changed without a supported transition");
        if (typeof loc.traveler.asset !== "string" || typeof loc.traveler.mount !== "string")
          throw new Error("Invalid saved traveler media");
        traveler = loc.traveler;
      }
      content = worldFieldContent(
        catalog,
        target,
        { mapId: loc.mapId, entrance: loc.entrance, birdview: false },
        traveler,
        this.initial.parentSourceSetHash,
        actorEntry,
        this.initial.entry.fade,
        this.initial.cameraHost !== undefined,
      );
    }
    const next = FieldGame.restore(
      content,
      snapshot.field,
      { ...(this.owned?.current ?? {}), ...(content.playerFactory ? { playerVisibility: content.playerFactory.capability } : {}) },
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
    if (from.player.native) throw new Error("Native actor map handoff requires a destination actor factory and codec");
    const request = stop.request,
      identity = from.content.map.identity;
    if (!identity) throw new Error("Unknown previous map/area identity");
    if (this.catalogHash !== null && this.catalogHash !== catalog.contentHash)
      throw new Error("World catalog changed during the session");
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
    const presentation = from.sourcePresentationContext;
    const presentationHost = this.owned?.current.sourcePresentation;
    if (canonical(presentation) !== canonical(presentationHost?.context() ?? null) ||
        (presentationHost && presentation === null) || (!presentationHost && owned?.ports.sourcePresentation))
      throw new Error("Unbound candidate map presentation context");
    let presentationPublished = false;
    // Candidate entry scripts may query the detached context. External title
    // effects cannot escape a map preparation that could still be discarded.
    const sourcePresentation = presentationHost ? {
      context: () => presentationPublished ? presentationHost.context() : structuredClone(presentation!),
      prepare: (effects: Parameters<NonNullable<typeof presentationHost.prepare>>[0]) => {
        if (!presentationPublished) throw new Error("Title effects during candidate map entry are not implemented");
        if (!presentationHost.prepare) throw new Error("Source title/fade/input effect host is unavailable");
        return presentationHost.prepare(effects);
      },
    } : undefined;
    const prior = from.partyActorCheckpoint;
    let actorEntry: { plan: MapPartyEntryPlan; assets: string[] } | undefined;
    if (prior) {
      const appearance = owned?.ports.partyAppearance;
      if (!appearance) throw new Error("Missing candidate map party owner");
      if (!catalog.transportation || !target.partyEntry)
        throw new Error(target.partyEntryBlockers?.[0]?.reason ?? "Missing source map actor entry");
      if (from.transportationId === null) throw new Error("Unknown map transportation identity");
      const transportation = new Transportations(catalog.transportation);
      const read = (ref: VariableRef) => {
        try { return state.read(ref); }
        catch (error) { if (error instanceof UnknownEventValue) return null; throw error; }
      };
      const transport = transportation.projectMapEntry({
        currentId: from.transportationId, loadId: transportation.pointInIdentity().id,
        mapId: request.mapId, stayMapIds: {}, availability: transportation.availability(read),
      });
      if (transport.currentId === null) throw new Error("Map transportation selection has no current identity");
      if (!transport.selected) throw new Error("Disabled current map transportation lifecycle is not implemented");
      // The two supported identities are retained by MapViewSetup. A newly
      // selected transport requires its independent collision/boarding host.
      if (transport.currentId !== from.transportationId)
        throw new Error("Map transportation switching is not implemented");
      const plan = prepareMapPartyEntry(appearance.catalog, {
        definition: target.partyEntry, entrance: request.entrance,
        mapViewType: request.birdview ? 1 : 0, prior,
        playerVisible: !from.hiddenEntities.has(from.player.id), party: appearance.current(),
        transportation: transportation.identity(transport.currentId),
        canPartySwitching: readMapPartySwitching(read),
      });
      this.requireActorPresentation(plan);
      actorEntry = { plan, assets: Object.values(appearance.catalog.assets).map((a) => a.asset) };
    }
    const content = worldFieldContent(catalog, target, request,
      { asset: actorEntry?.plan.player.asset ?? from.player.asset,
        mount: actorEntry?.plan.player.mount ?? from.player.mount ?? "",
        transportationId: actorEntry?.plan.checkpoint.context.currentTransport?.id ?? from.transportationId },
      from.content.parentSourceSetHash, actorEntry, this.initial.entry.fade, from.cameraSnapshot !== null);
    if (from.cameraSnapshot && !content.cameraHost)
      throw new Error(target.cameraHostBlockers?.[0]?.reason ?? "Destination native camera host is unavailable");
    const field = new FieldGame(
      content,
      state,
      new StaticAudioState(bgm),
      new StaticAudioState(environment),
      { ...(owned?.ports ?? {}), ...(sourcePresentation ? { sourcePresentation } : {}),
        ...(content.playerFactory ? { playerVisibility: content.playerFactory.capability } : {}),
        ...(this.owned?.current.audioReadiness ? { audioReadiness: this.owned.current.audioReadiness } : {}) },
      from.fader.fork(),
      from.cameraSnapshot ?? undefined,
    );
    field.initializeMapCamera();
    const script = request.continuation || target.initializer;
    field.startMapEntry(script || null);
    if (field.stop?.kind === "unsupported") throw new Error(field.stop.message);
    const prepared = { field, request: stop };
    this.prepared.set(prepared, {
      from,
      stop,
      request: canonical(stop.request),
      state: canonical(snapshot),
      bgm: canonical(bgm),
      environment: canonical(environment),
      actors: this.actorState(from),
      presentation: canonical(presentation),
      fade: canonical(from.fader.snapshot()),
      camera: canonical(from.cameraSnapshot),
      publishPresentation: () => { presentationPublished = true; },
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
      ownership.request !== canonical(this.current.stop.request) ||
      ownership.state !== canonical(this.current.eventState.snapshot()) ||
      ownership.bgm !== canonical(this.current.bgm.snapshot()) ||
      ownership.environment !== canonical(this.current.environment.snapshot()) ||
      ownership.actors !== this.actorState(this.current) ||
      ownership.presentation !== canonical(this.current.sourcePresentationContext) ||
      ownership.fade !== canonical(this.current.fader.snapshot()) ||
      ownership.camera !== canonical(this.current.cameraSnapshot)
    )
      return false;
    if (ownership.owned && !ownership.owned.commit()) return false;
    ownership.publishPresentation();
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
      traveler: value.field.partyActorCheckpoint ? null : {
        asset: value.field.content.entry.player.asset,
        mount: value.field.content.entry.player.mount,
        transportationId: value.field.content.entry.transportationId ?? null,
      },
    };
    return true;
  }
  private requireActorPresentation(plan: MapPartyEntryPlan): void {
    if (plan.colliderChanges.length)
      throw new Error("Conditional map party collision is not supported by this field host");
    if (plan.ownedConditionChanges.length)
      throw new Error("Map condition removal requires the shared owned transaction");
  }
  private actorState(field: FieldGame): string {
    const p = field.player;
    return canonical({ prior: field.partyActorCheckpoint,
      player: { x: p.x, y: p.y, layer: p.layer, direction: p.direction,
        asset: p.asset, mount: p.mount, motion: p.motion }, hidden: [...field.hiddenEntities] });
  }
  fail(request: MapTransitionStop, message: string): void {
    if (this.current.stop !== request) return;
    this.current.stop = { kind: "unsupported", message, site: request.site };
  }
}
