import type { FieldContent } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import { EventState, UnknownEventValue, int32, type VariableRef } from "./event-state.js";
import {
  FieldGame,
  type MapTransitionStop,
  type FieldCheckpoint,
  type FieldGameOptions,
  type FieldNativeRestoreDependencies,
  type GameEventSaveRequest,
} from "./field.js";
import { missingFieldPoses } from "./character-media.js";
import { canonical } from "./canonical.js";
import { fieldCollisionRange, inCollisionRange } from "./collision.js";
import { requireMinimapMedia } from "./minimap.js";
import { StaticAudioState } from "./static-audio.js";
import { FieldSoundState } from "./field-sound.js";
import { checkpointKeys, checkpointInteger } from "./checkpoint-validation.js";
import { prepareMapPartyEntry, readMapPartySwitching, type MapPartyEntryPlan } from "./map-party-entry.js";
import { Transportations } from "./transportation.js";
import { transportationStayMaps } from "./transportation-state.js";
import { frameworkTransportationPresentation } from "./development-profile.js";
import type { FieldFadeState } from "./field-fade.js";
import type { SourceNativeState } from "./source-native-state.js";
import { prepareSourceNativeMap } from "./source-native-map.js";
import { prepareNativeFieldProviders } from "./field-native-providers.js";
import type { NativeGameEntryContent } from "./source-new-game.js";
import { assertSourceEntryProfiles, type SourceEntryProfileDependency } from "./source-catalog.js";
import { FieldEffects, type FieldEffectCandidate, type FieldEffectCandidatePrepared } from "./field-effects.js";
import { FieldEffectMap } from "./field-effect-map.js";
export type WorldStateOwner = {
  current: FieldGameOptions;
  prepare(): { ports: FieldGameOptions; commit(): boolean };
  nativeState?(): SourceNativeState | null;
};

/** Captured content identity for a source-origin session, not another state
 * owner or permission granted by the next map's own metadata. */
export type SourceWorldOrigin = Pick<SourceEntryProfileDependency, "developmentProfile"> & { catalogHash: string };

type Traveler = Pick<FieldContent["entry"]["player"], "asset" | "mount"> & {
  transportationId: number | null;
};
export type WorldCheckpoint = {
  kind: "idle-world-v10" | "event-world-v1";
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
    ...(target.walkEncounters ? { walkEncounters: structuredClone(target.walkEncounters) } : {}),
    ...(target.developmentProfile ? { developmentProfile: structuredClone(target.developmentProfile) } : {}),
    ...(target.developmentOmissions ? { developmentOmissions: structuredClone(target.developmentOmissions) } : {}),
    scriptLocals: target.scriptLocals,
    ...(target.scriptTransitionMetadata ? { scriptTransitionMetadata: target.scriptTransitionMetadata } : {}),
    ...(target.scriptSystemFlags ? { scriptSystemFlags: target.scriptSystemFlags } : {}),
    characters,
    // The package describes conditional normal-view capability. Geometry-only
    // previews cannot acquire a native camera lifecycle just by loading it.
    ...(sourceCamera && target.cameraHost ? { cameraHost: target.cameraHost } : {}),
    ...(sourceCamera && target.nativeNpcStandby ? { nativeNpcStandby: target.nativeNpcStandby } : {}),
    ...(sourceCamera && target.fieldEffects ? { fieldEffects: target.fieldEffects } : {}),
    ...(sourceCamera && target.scriptPuppetContexts ? { scriptPuppetContexts: target.scriptPuppetContexts } : {}),
    ...(catalog.playerFactory ? { playerFactory: structuredClone(catalog.playerFactory) } : {}),
    ...(catalog.minimap ? { minimap: catalog.minimap } : {}),
    ...(catalog.bgm ? { bgm: catalog.bgm } : {}),
    ...(catalog.environment ? { environment: catalog.environment } : {}),
    ...(catalog.se ? { se: catalog.se } : {}),
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
  se: string;
  actors: string;
  presentation: string;
  fade: string;
  camera: string;
  publishPresentation(): void;
  walkFieldState?: string;
  catalogHash: string;
  owned?: { commit(): boolean };
  effects?: { candidate: FieldEffectCandidate; publication: FieldEffectCandidatePrepared; map: FieldEffectMap; fieldState: string };
};
type MapCommit = { value: PreparedMap; cancelled: boolean; started: boolean };

/** Owns field lifetime. Hosts fetch and verify packages/images before committing a prepared map. */
export class WorldSession {
  private current: FieldGame;
  private location: WorldCheckpoint["location"] = null;
  private prepared = new Map<PreparedMap, Ownership>();
  private commitInProgress: MapCommit | null = null;
  private catalogHash: string | null = null;
  private readonly sourceOrigin: SourceWorldOrigin | null;
  private readonly effectOwner: FieldEffects | null;
  private effectMap: FieldEffectMap | null;
  private nextEffectScope = 1;
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
    restoringNative = false,
    sourceOrigin?: SourceWorldOrigin,
  ) {
    this.sourceOrigin = sourceOrigin === undefined ? null : structuredClone(sourceOrigin);
    if (this.sourceOrigin) {
      checkpointKeys(this.sourceOrigin, Object.hasOwn(this.sourceOrigin, "developmentProfile")
        ? "catalogHash,developmentProfile" : "catalogHash");
      if (typeof this.sourceOrigin.catalogHash !== "string" || !/^[a-f0-9]{64}$/.test(this.sourceOrigin.catalogHash))
        throw new Error("Invalid source world catalog hash");
      assertSourceEntryProfiles(this.sourceOrigin, this.sourceOrigin, initial);
      this.catalogHash = this.sourceOrigin.catalogHash;
    }
    // The explicit candidate capability admits the ordinary clear/load branch.
    // Standalone hosts keep their prior map/save gates. A manager survives empty
    // maps too: allocation IDs and off-map positions do not restart per map.
    const effectHost = owned?.current.fieldEffects;
    const hasEffects = initial.map.entities.some((entity) => entity.kind === 11);
    if (hasEffects && owned?.current.nativeActorPreparation)
      throw new Error("Initial native field effects require whole-session transactional publication");
    if (effectHost?.beginCandidate && typeof effectHost.observe !== "function")
      throw new Error("Field effect playback observation host is unavailable");
    this.effectOwner = typeof effectHost?.beginCandidate === "function"
      ? new FieldEffects(initial.fieldEffects ?? { media: {} }, effectHost) : null;
    const candidate = hasEffects ? this.effectOwner?.fork() : undefined;
    this.effectMap = this.effectOwner ? new FieldEffectMap("0", candidate ?? this.effectOwner,
      initial.map.entities.filter((entity) => entity.kind === 11).map((entity) => entity.id)) : null;
    try {
      this.current = new FieldGame(
        initial,
        state,
        undefined,
        undefined,
        { ...(owned?.current ?? {}), ...(this.effectMap ? { fieldEffectMap: this.effectMap } : {}),
          ...(initial.playerFactory ? { playerVisibility: initial.playerFactory.capability } : {}) },
        initialFade,
        undefined,
        restoringNative,
      );
      if (candidate) { candidate.seal().commit(); this.effectMap!.publish(this.effectOwner!); }
    } catch (error) { candidate?.discard(); throw error; }
  }
  get field(): FieldGame {
    return this.current;
  }
  checkpoint(): WorldCheckpoint {
    return {
      kind: "idle-world-v10",
      initialHash: this.initial.contentHash,
      location: structuredClone(this.location),
      field: this.current.checkpoint(),
    };
  }
  eventCheckpoint(request: GameEventSaveRequest): WorldCheckpoint {
    if (this.commitInProgress) throw new Error("Cannot save during map publication");
    return { kind: "event-world-v1", initialHash: this.initial.contentHash,
      location: structuredClone(this.location), field: this.current.eventCheckpoint(request) };
  }
  /** Used on an unpublished candidate session; current host state is replaced only after media preparation. */
  restore(
    snapshot: WorldCheckpoint,
    catalog?: WorldCatalog,
    target?: WorldMapContent,
    native?: { content: NativeGameEntryContent; initialMap: WorldMapContent },
  ): void {
    if (this.commitInProgress) throw new Error("Cannot restore during map publication");
    if (this.sourceOrigin) {
      if (!catalog || catalog.contentHash !== this.sourceOrigin.catalogHash)
        throw new Error("Source world catalog changed during the session");
      assertSourceEntryProfiles(this.sourceOrigin, catalog, native?.initialMap ?? this.sourceOrigin, target);
    }
    checkpointKeys(snapshot, "kind,initialHash,location,field");
    if (
      !["idle-world-v10", "event-world-v1"].includes(snapshot.kind) ||
      snapshot.initialHash !== this.initial.contentHash
    )
      throw new Error("World checkpoint source/version mismatch");
    if ((snapshot.kind === "event-world-v1") !== (snapshot.field.kind === "event-field-v1"))
      throw new Error("World and field continuation formats disagree");
    let content = this.initial;
    const loc = snapshot.location;
    if (native && (!catalog || native.content.contentHash !== this.initial.contentHash ||
        native.content.worldCatalogHash !== catalog.contentHash || native.content.mapContentHash !== native.initialMap.contentHash ||
        native.initialMap.mapId !== native.content.entry.mapId ||
        catalog.maps[String(native.initialMap.mapId)]?.contentHash !== native.initialMap.contentHash))
      throw new Error("Saved native initial world dependencies are unavailable or changed");
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
        const transportationId = frameworkTransportationPresentation(target.developmentProfile)
          ? snapshot.field.transportationId : this.initial.entry.transportationId;
        if (transportationId === undefined || transportationId === null || snapshot.field.transportationId !== transportationId)
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
    let nativeDependencies: FieldNativeRestoreDependencies | undefined;
    if (native) {
      const map = loc === null ? native.initialMap : target;
      if (!map?.actorView || map.actorViewBlockers?.length || map.nativeFootBlockers?.length ||
          !catalog?.nativeAnimationKeys || canonical(catalog.nativeAnimationKeys) !== canonical(native.content.animationKeys))
        throw new Error("Saved native map view/foot/animation source dependencies are unavailable");
      nativeDependencies = { factory: native.content.factory, catalog: native.content.puppetCatalog,
        animationKeys: native.content.animationKeys, controlContext: { worldMapScript: false, callback: "absent" },
        providers: (field) => prepareNativeFieldProviders(field, map.actorView!, map.nativeFoot) };
    }
    if (this.effectMap?.hasHistory) throw new Error("Field effect manager history cannot be restored without its particle/RNG codec");
    const effectMap = this.effectOwner ? new FieldEffectMap(String(this.nextEffectScope), this.effectOwner, []) : null;
    const next = FieldGame.restore(
      content,
      snapshot.field,
      { ...(this.owned?.current ?? {}), ...(effectMap ? { fieldEffectMap: effectMap } : {}),
        ...(content.playerFactory ? { playerVisibility: content.playerFactory.capability } : {}) },
      nativeDependencies,
    );
    for (const pending of this.prepared.keys()) this.discard(pending);
    if (this.effectMap) this.effectMap.retire(this.effectMap.snapshot());
    this.effectMap = effectMap;
    this.nextEffectScope++;
    this.current = next;
    this.location = structuredClone(loc);
    this.catalogHash = loc?.catalogHash ?? this.sourceOrigin?.catalogHash ?? null;
    this.transitions.length = 0;
  }
  prepare(catalog: WorldCatalog, target: WorldMapContent): PreparedMap {
    if (this.commitInProgress) throw new Error("Cannot prepare another map during publication");
    const from = this.current,
      stop = from.stop;
    if (stop?.kind !== "map-transition")
      throw new Error("No pending map transition");
    if (this.sourceOrigin) {
      if (catalog.contentHash !== this.sourceOrigin.catalogHash)
        throw new Error("Source world catalog changed during the session");
      assertSourceEntryProfiles(this.sourceOrigin, catalog, this.sourceOrigin, target);
    }
    const fromActors = this.actorState(from), fromFade = canonical(from.fader.snapshot()),
      fromCamera = canonical(from.cameraSnapshot), fromPresentation = from.sourcePresentationContext;
    const effectBlocker = from.effectMapHandoffBlocker;
    if (effectBlocker) throw new Error(effectBlocker);
    if (!this.effectOwner && Object.values(target.map?.groups ?? {}).some((group) => group.entities.some((entity) => entity.kind === 11)))
      throw new Error("Destination field-effect particle allocation requires a transactional map lifecycle provider");
    const nativeActors = from.nativeActorCandidate, nativeRuntime = from.nativeActorRuntime;
    const nativeState = this.owned?.nativeState?.();
    if (from.player.native && (!nativeActors || !nativeRuntime || !nativeState))
      throw new Error("Native actor map handoff requires its actor and source state owners");
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
    if (from.se.voices.length && catalog.se?.sourceSetHash !== from.content.se?.sourceSetHash)
      throw new Error("SE media changed during map transition");
    const se = from.se.snapshot();
    const owned = this.owned?.prepare();
    const presentation = fromPresentation;
    const presentationHost = this.owned?.current.sourcePresentation;
    if (canonical(presentation) !== canonical(presentationHost?.context() ?? null) ||
        (presentationHost && presentation === null) || (!presentationHost && owned?.ports.sourcePresentation))
      throw new Error("Unbound candidate map presentation context");
    let presentationPublished = false;
    let destinationField: FieldGame | null = null;
    const walkOwner = this.owned?.current.walkEncounters;
    const requirePublishedWalkOwner = () => {
      if (!presentationPublished || this.current !== destinationField)
        throw new Error("Walking encounters require the published current map");
    };
    const walkEncounters: FieldGameOptions["walkEncounters"] = walkOwner ? {
      prepareStep: (mapId, policy) => {
        requirePublishedWalkOwner();
        const candidate = walkOwner.prepareStep(mapId, policy);
        return Object.freeze({ partyId: candidate.partyId,
          validate: () => { requirePublishedWalkOwner(); candidate.validate(); },
          commitWith: (publish) => {
            requirePublishedWalkOwner();
            candidate.commitWith(() => { requirePublishedWalkOwner(); publish(); });
          } });
      },
    } : undefined;
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
        mapId: request.mapId, stayMapIds: nativeState ? transportationStayMaps(nativeState.ownedTransportations) : {},
        availability: transportation.availability(read),
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
        playerVisible: from.isEntityVisible(from.player.id), party: appearance.current(),
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
    const effectCandidate = this.effectOwner?.fork(content.fieldEffects);
    try {
      if (effectCandidate) this.effectMap!.prepareRetirement(effectCandidate);
      const effectMap = effectCandidate ? new FieldEffectMap(String(this.nextEffectScope), effectCandidate,
        content.map.entities.filter((entity) => entity.kind === 11).map((entity) => entity.id)) : null;
      const field = new FieldGame(
        content,
        state,
        new StaticAudioState(bgm),
        new StaticAudioState(environment),
        { ...(owned?.ports ?? {}), ...(nativeActors ? { nativeActorPreparation: true } : {}),
          ...(walkEncounters ? { walkEncounters } : {}),
          ...(effectMap ? { fieldEffectMap: effectMap } : {}),
          ...(sourcePresentation ? { sourcePresentation } : {}),
          ...(content.playerFactory ? { playerVisibility: content.playerFactory.capability } : {}),
          ...(this.owned?.current.transportationTimestamp ? { transportationTimestamp: this.owned.current.transportationTimestamp } : {}),
          ...(this.owned?.current.soundPresentation ? { soundPresentation: this.owned.current.soundPresentation } : {}),
          ...(this.owned?.current.audioReadiness ? { audioReadiness: this.owned.current.audioReadiness } : {}) },
        from.fader.fork(),
        from.cameraSnapshot ?? undefined,
        false,
        FieldSoundState.restore(se, content.se),
      );
      destinationField = field;
      if (nativeActors) {
        if (!prior || !actorEntry || !target.partyEntry || !target.actorView || target.actorViewBlockers?.length ||
            !owned?.ports.partyAppearance || !nativeRuntime || !catalog.nativeAnimationKeys ||
            canonical(nativeRuntime.animationKeys) !== canonical(catalog.nativeAnimationKeys))
          throw new Error(target.actorViewBlockers?.[0]?.reason ?? "Native map actor source dependencies are unavailable");
        if (target.nativeFootBlockers?.length) throw new Error(target.nativeFootBlockers[0]!.reason);
        const providers = prepareNativeFieldProviders(field, target.actorView, target.nativeFoot);
        const candidate = prepareSourceNativeMap({ prior: nativeActors, priorCheckpoint: prior,
          ...(from.content.map.nativeComposition ? { priorComposition: from.content.map.nativeComposition } : {}),
          entry: actorEntry.plan, definition: target.partyEntry, catalog: owned.ports.partyAppearance.catalog,
          party: owned.ports.partyAppearance.current(),
          characters: field.content.characters, animationKeys: catalog.nativeAnimationKeys,
          ...(field.transportationPresentation ? { transportationPresentation: field.transportationPresentation } : {}),
          view: target.actorView, providers: providers() });
        field.installNativeActors(candidate, nativeRuntime.catalog, providers, nativeRuntime.controlContext,
          catalog.nativeAnimationKeys, nativeRuntime.mapLifecycle);
      }
      field.initializeMapCamera();
      const script = request.continuation || target.initializer;
      field.startMapEntry(script || null);
      if (field.stop?.kind === "unsupported") throw new Error(field.stop.message);
      const effectPublication = effectCandidate?.seal();
      const prepared = Object.freeze({ field, request: stop });
      this.prepared.set(prepared, {
        from,
        stop,
        request: canonical(stop.request),
        state: canonical(snapshot),
        bgm: canonical(bgm),
        environment: canonical(environment),
        se: canonical(se),
        actors: fromActors,
        presentation: canonical(presentation),
        fade: fromFade,
        camera: fromCamera,
        publishPresentation: () => { presentationPublished = true; },
        ...(content.walkEncounters ? { walkFieldState: this.effectFieldState(field) } : {}),
        catalogHash: catalog.contentHash,
        ...(owned ? { owned } : {}),
        ...(effectPublication ? { effects: { candidate: effectCandidate!, publication: effectPublication,
          map: effectMap!, fieldState: this.effectFieldState(field) } } : {}),
      });
      return prepared;
    } catch (error) { effectCandidate?.discard(); throw error; }
  }
  commit(value: PreparedMap): boolean {
    if (this.commitInProgress) return false;
    const ownership = this.prepared.get(value);
    if (!ownership) return false;
    this.prepared.delete(value);
    // Keep cancellation visible while fallible host validation is running.
    // Cleanup itself waits until the callback has returned to avoid reentering
    // a busy candidate. Publication becomes irrevocable at the owned commit.
    const active: MapCommit = { value, cancelled: false, started: false };
    this.commitInProgress = active;
    try { return this.commitPrepared(value, ownership, active); }
    catch (error) { if (!active.started) ownership.effects?.candidate.discard(); throw error; }
    finally { this.commitInProgress = null; }
  }
  private commitPrepared(value: PreparedMap, ownership: Ownership, active: MapCommit): boolean {
    if (!this.isCurrent(ownership, value) || active.cancelled) {
      ownership.effects?.candidate.discard();
      return false;
    }
    // Release losing private preparations before any visible state changes.
    // A faulty cleanup callback must not turn a committed map into a reported
    // failure while the browser still holds its previous renderer.
    try { for (const pending of this.prepared.keys()) this.discard(pending); }
    catch (error) { ownership.effects?.candidate.discard(); throw error; }
    const previousEffects = this.effectMap?.snapshot();
    if (ownership.effects) {
      // All fallible effect validation runs before the owned-state callback.
      // The manager is locked throughout the two no-fail publications.
      let committed: boolean, ownedStarted = false;
      try { committed = ownership.effects.publication.commitWith(() => {
        if (!this.isCurrent(ownership, value) || active.cancelled) return false;
        active.started = ownedStarted = true;
        return ownership.owned?.commit() ?? true;
      }); }
      catch (error) {
        ownership.effects.candidate.discard();
        // A host commit that violates its no-fail contract is fatal; its manager
        // is poisoned rather than replayed. Pre-publication failures are stale.
        if (ownedStarted) {
          this.current.stop = { kind: "unsupported", message: "Field effect publication failed: " + String(error),
            site: ownership.stop.site };
          for (const pending of this.prepared.keys()) this.discard(pending);
          throw error;
        }
        return false;
      }
      if (!committed) return false;
      this.effectMap!.retire(previousEffects!);
      ownership.effects.map.publish(this.effectOwner!);
      this.effectMap = ownership.effects.map;
      this.nextEffectScope++;
    } else {
      if (!this.isCurrent(ownership, value) || active.cancelled) return false;
      active.started = true;
      if (ownership.owned && !ownership.owned.commit()) return false;
    }
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
  /** Browser fetch/media failure or replaced session abandons private resources. */
  discard(value: PreparedMap): void {
    if (this.commitInProgress?.value === value) {
      if (this.commitInProgress.started) throw new Error("Cannot cancel a map after publication has started");
      this.commitInProgress.cancelled = true;
      return;
    }
    const ownership = this.prepared.get(value);
    this.prepared.delete(value);
    ownership?.effects?.candidate.discard();
  }
  private isCurrent(ownership: Ownership, value: PreparedMap): boolean {
    return ownership.from === this.current && ownership.stop === this.current.stop && value.request === ownership.stop &&
      ownership.request === canonical(this.current.stop.request) &&
      ownership.state === canonical(this.current.eventState.snapshot()) &&
      ownership.bgm === canonical(this.current.bgm.snapshot()) &&
      ownership.environment === canonical(this.current.environment.snapshot()) &&
      ownership.se === canonical(this.current.se.snapshot()) &&
      ownership.actors === this.actorState(this.current) &&
      ownership.presentation === canonical(this.current.sourcePresentationContext) &&
      ownership.fade === canonical(this.current.fader.snapshot()) &&
      ownership.camera === canonical(this.current.cameraSnapshot) &&
      (ownership.walkFieldState === undefined || ownership.walkFieldState === this.effectFieldState(value.field)) &&
      (!ownership.effects || ownership.effects.fieldState === this.effectFieldState(value.field));
  }
  private effectFieldState(field: FieldGame): string {
    return canonical({ time: field.time, busy: field.busy, stop: field.stop,
      state: field.eventState.snapshot(), actors: this.actorState(field), effects: field.fieldEffectsSnapshot,
      fade: field.fader.snapshot(), camera: field.cameraSnapshot, bgm: field.bgm.snapshot(), environment: field.environment.snapshot(), se: field.se.snapshot() });
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
      native: field.nativeActorStateFingerprint,
      nativeRuntime: field.nativeActorRuntime, cameraOffset: field.cameraOffset,
      collision: field.collisionState, updateMask: field.updateAttributeMask,
      player: { x: p.x, y: p.y, layer: p.layer, direction: p.direction,
        asset: p.asset, mount: p.mount, motion: p.motion }, hidden: [...field.hiddenEntities] });
  }
  fail(request: MapTransitionStop, message: string): void {
    if (this.current.stop !== request) return;
    this.current.stop = { kind: "unsupported", message, site: request.site };
    for (const [pending, ownership] of this.prepared) if (ownership.stop === request) this.discard(pending);
  }
}
