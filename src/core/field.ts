import type {
  Direction,
  FieldContent,
  FieldEntity,
  FieldMessage,
  Op,
  Point,
  Site,
  MapRequest,
} from "../field/types.js";
import {
  EventState,
  executeEventControl,
  type EventStateSnapshot,
} from "./event-state.js";
import {
  executeInventoryEvent,
  type FieldInventoryPort,
  type FieldInventoryTransaction,
} from "./inventory-event.js";
import { executePartyEvent, type FieldPartyPort, type PartyAppearanceCandidate } from "./party.js";
import { executeOwnedConditionEvent, type FieldOwnedConditionPort } from "./owned-condition.js";
import { executeSourcePresentation, cloneSourcePresentationContext, sourcePresentationCheckpoint,
  type SourcePresentationContext, type SourcePresentationPort } from "./source-presentation.js";
import { canonical } from "./canonical.js";
import { SourceMessageState, sourceMessageUpdateMask, type SourceMessageEffect } from "./source-message.js";
import type { FieldPuppetRosterPort } from "./field-puppet-roster.js";
import { createNativeFieldActorProjections, createNativeFieldPuppetActorsPort,
  type NativeFieldActorData } from "./field-native-actors.js";
import type { FieldActorFactoryCandidate } from "./field-actor-factory.js";
import { projectFieldPuppetCollision, type FieldPuppetCollisionState, type FieldPuppetHostProviders } from "./field-puppet-effects.js";
import type { FieldPuppetActorCatalog, FieldPuppetControlContext } from "./field-puppet-actors.js";
import type { PartyActorPlan } from "./party-actors.js";
import type { FieldTreasurePort } from "./treasure-port.js";
import { treasureFlagRef, validateTreasureInventory, type TreasureBoxRequest } from "./treasure-inventory.js";
import { createTreasureTask, advanceTreasureTask, type TreasureTaskState, type TreasureTaskInput } from "./treasure-task.js";
import type { PartyActorCatalog } from "./party-actors.js";
import { FieldPartyActors, type FieldPartyActorCheckpoint } from "./field-party-actors.js";
import { missingFieldPoses } from "./character-media.js";
import { executeRosterLifecycleEvent, type FieldRosterPort } from "./roster.js";
import type { FieldConditionPort } from "./field-conditions.js";
import { projectFieldEntryContext } from "./field-entry-context.js";
import { requireMinimapMedia } from "./minimap.js";
import { StaticAudioState, type AudioSnapshot } from "./static-audio.js";
import { audioReadinessTrack, pollAudioReadiness, type AudioReadinessPort } from "./audio-readiness.js";
import { projectPlayerVisibility } from "./player-visibility.js";
import { FieldFadeState, type FieldFadeSnapshot } from "./field-fade.js";
import { FieldCameraHost, type FieldCameraViewport } from "./field-camera-host.js";
import type { FieldCameraState, FieldCameraLerp, FieldCameraLerpProgress } from "./field-camera.js";
import { projectFieldPuppetInitialization, projectFieldPuppetActorEntry, resolveFieldPuppetActor,
  fieldPuppetAssignments, type FieldPuppetActorsPort, type FieldPuppetScriptContext } from "./field-puppet-actors.js";
import {
  prepareFieldCall, prepareFieldReturn, prepareFieldPuppetEntry,
  fieldPuppetControlStep, projectFieldPuppetReady,
  type FieldTaskRange, type FieldPuppetStatus,
} from "./field-task-control.js";
import { TileAnimationState, type TileCheckpoint } from "./tile-animation.js";
import {
  OpenTriggerState,
  type OpenTriggerCheckpoint,
} from "./open-trigger.js";
import {
  ActorAnimation,
  FIELD_POSE,
  type ActorPlayback,
} from "./actor-animation.js";
import {
  checkpointKeys,
  checkpointNumber,
  checkpointInteger,
  checkpointIds,
  checkpointSameIds,
} from "./checkpoint-validation.js";
import {
  buildCollisionMapping,
  collisionMask,
  diagonalBit,
  fieldCollisionRange,
  inCollisionRange,
  redirectAtSlope,
  type CollisionRange,
} from "./collision.js";
export const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const BIT: Record<Direction, number> = { up: 1, left: 2, right: 4, down: 8 };
const ACTION_SIDE: Record<Direction, number> = {
  up: 1,
  right: 2,
  down: 4,
  left: 8,
};
const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  left: "right",
  right: "left",
  down: "up",
};
export type Motion = {
  from: Point;
  to: Point;
  elapsed: number;
  duration: number;
  manual: boolean;
};
export type Actor = Point & {
  id: string;
  layer: number | null;
  direction: Direction | null;
  asset: string | null;
  mount: string | null;
  motion: Motion | null;
  steps: number;
  animation: ActorAnimation | null;
  native?: NativeFieldActorData;
};
type PlacedActor = Actor & { layer: number; direction: Direction; asset: string };
export type FieldCheckpoint = {
  kind: "idle-field-v8";
  contentHash: string;
  time: number;
  remainder: number;
  nextTask: number;
  transportationId: number | null;
  entrySynchronized: boolean | null;
  partyActors: FieldPartyActorCheckpoint | null;
  sourcePresentation: SourcePresentationContext | null;
  eventState: EventStateSnapshot;
  activeGroups: string[];
  hiddenEntities: string[];
  openedTreasures: string[];
  actors: (Omit<PlacedActor, "motion" | "animation" | "native"> & {
    animation: ActorPlayback | null;
  })[];
  tiles: TileCheckpoint;
  doors: OpenTriggerCheckpoint;
  bgm: AudioSnapshot;
  environment: AudioSnapshot;
  fade: FieldFadeSnapshot | null;
  camera: FieldCameraState | null;
};
type Task = {
  id: number;
  script: string;
  pc: number;
  stack: number[];
  actor: string;
  sourceEntityId: number | null;
  wait: number;
  /** null is the main core (or the external treasure coroutine). */
  slot: number | null;
  state: "awake" | "ready";
  range: FieldTaskRange;
  lastClock: number;
  puppetWait: Extract<Op, { kind: "exec-puppets" | "finish-puppets" }> | null;
  fadeWait: Extract<Op, { kind: "field-fade" }> | null;
  cameraLerp: { op: Extract<Op, { kind: "field-camera-motion" }>; command: FieldCameraLerp;
    progress: FieldCameraLerpProgress } | null;
  remaining: number;
  move: Extract<Op, { kind: "move" }> | null;
  animationWait: boolean;
  audioWait: Extract<Op, { kind: "bgm-ready" | "bgm-sync" }> | null;
  treasure: { state: TreasureTaskState; entity: FieldEntity; site: Site;
    closeMessage: boolean; messageAvailableAt: number } | null;
  treasureRoot: boolean;
  done: boolean;
};
export type MapTransitionStop = {
  kind: "map-transition";
  message: string;
  site: Site | null;
  request: MapRequest;
};
export type Stop =
  | MapTransitionStop
  | {
      kind: "unsupported" | "encounter";
      message: string;
      site: Site | null;
      party?: number;
      continuation?: string;
    };
export type Dialogue = FieldMessage & { task: number };
export type FieldGameOptions = {
  sourceMessageEffects?: { prepare(effects: readonly SourceMessageEffect[]): () => void };
  puppetActors?: FieldPuppetActorsPort;
  puppetRoster?: FieldPuppetRosterPort;
  audioReadiness?: AudioReadinessPort;
  /** Immutable host admission, never inferred from absent source fields or saved
   * visibility. Missing capability keeps native child propagation unresolved. */
  playerVisibility?: Readonly<{ childEntityObject: "absent" | "unresolved" }>;
  sourcePresentation?: SourcePresentationPort;
  /** Read-only admission before any shop greeting or interaction is published. */
  shop?: { validate(groupId: number): void };
  ownedConditions?: FieldOwnedConditionPort;
  inventory?: FieldInventoryPort;
  treasure?: FieldTreasurePort;
  party?: FieldPartyPort;
  roster?: FieldRosterPort;
  fieldSteps?: FieldConditionPort;
  partyAppearance?: { catalog: PartyActorCatalog; current(): PartyAppearanceCandidate };
  /** Read the current owned-state draft; unsupported step effects must not disappear. */
  movementBlocker?: (transportationId: number | null, manual: boolean) => string | null;
};
const contains = (e: FieldEntity, p: Point) =>
  p.x >= e.x && p.x < e.x + e.width && p.y >= e.y && p.y < e.y + e.height;
export class FieldGame {
  /** A host preparation dependency, not a new voice or a load command. */
  get pendingBgmTracks() {
    const ids = new Set(this.tasks.filter((task) => !task.done && task.audioWait?.kind === "bgm-ready")
      .map((task) => (task.audioWait as Extract<Op, { kind: "bgm-ready" }>).track));
    return [...ids].map((id) => audioReadinessTrack(id, this.content.bgm));
  }
  readonly transportationId: number | null;
  readonly cameraOffset: Readonly<Point>;
  private readonly camera: FieldCameraHost | null;
  private cameraEventActive = false;
  readonly cameraActorId = "native:camera";
  get cameraSnapshot(): FieldCameraState | null { return this.camera?.snapshot() ?? null; }
  cameraProjection(viewport: FieldCameraViewport) { return this.camera?.projection(viewport) ?? null; }
  /** MapSetup selects the actual player after PointIn and party placement.
   * The constructor and checkpoint restoration do not replay that lifecycle. */
  initializeMapCamera(): void {
    if (!this.camera) return;
    if (this.tasks.some((task) => !task.done)) throw new Error("Cannot initialize map camera during an event");
    this.camera.prepareSelect({ target: "player" }).commit();
  }
  private cameraPorts() {
    return {
      readPlayer: () => {
        const p = this.player, m = p.motion;
        const ratio = m ? Math.min(1, m.elapsed / m.duration) : 0;
        return { cell: m ? { x: m.from.x + (m.to.x - m.from.x) * ratio,
          y: m.from.y + (m.to.y - m.from.y) * ratio } : { x: p.x, y: p.y },
          logicalLayer: p.layer, direction: p.direction };
      },
      readScrollOffset: () => ({ ...this.cameraOffset }),
    };
  }
  private readonly partyActors: FieldPartyActors | null;
  private readonly playerVisibilityChild: "absent" | "unresolved";
  readonly tileAnimations: TileAnimationState;
  readonly openTriggers: OpenTriggerState;
  readonly collisionRange: CollisionRange;
  private readonly collisionMappings = new Map<number, number[]>();
  readonly actors: Record<string, Actor> = {};
  private collisionSwitches: FieldPuppetCollisionState = projectFieldPuppetCollision(true);
  private entityUpdateMask = 3;
  get updateAttributeMask(): number { return this.entityUpdateMask; }
  get collisionState(): Readonly<FieldPuppetCollisionState> { return { ...this.collisionSwitches }; }
  isEntityVisible(id: string): boolean {
    const native = this.actors[id]?.native;
    return native ? native.entity.visible : !this.hiddenEntities.has(id);
  }
  /** Install the prepared factory directly into the existing actor collection.
   * A script alias is never an actor identity, and the camera stays separate. */
  installNativeActors(candidate: FieldActorFactoryCandidate, catalog: FieldPuppetActorCatalog,
    providers: () => FieldPuppetHostProviders, controlContext: FieldPuppetControlContext): void {
    if (this.tasks.length || this.options.puppetActors || !this.camera || !this.partyActors ||
        !this.options.partyAppearance || !this.options.puppetRoster ||
        Object.keys(this.actors).some((id) => id !== this.player.id))
      throw new Error("Native actor installation requires a fresh bound field without legacy NPC actors");
    if (candidate.bindings.player !== this.player.id || candidate.snapshot.camera?.id !== this.cameraActorId)
      throw new Error("Native factory does not match the existing player/camera identities");
    const projected = createNativeFieldActorProjections(candidate, this.content.cameraHost!.mapRange,
      this.options.partyAppearance.catalog);
    const player = projected.find((a) => a.id === this.player.id);
    if (!player || player.x !== this.player.x || player.y !== this.player.y ||
        player.layer !== this.player.layer || player.direction !== this.player.direction || player.asset !== this.player.asset)
      throw new Error("Native factory player disagrees with prepared PointIn");
    const bindings = structuredClone(candidate.bindings), puppetCatalog = structuredClone(catalog);
    const detachedActors = Object.fromEntries(projected.map((actor) => [actor.id, actor]));
    let published = false;
    const port = createNativeFieldPuppetActorsPort({
      readActors: () => published ? this.actors : detachedActors,
      readCamera: () => { const s = this.camera!.snapshot();
        return { id: this.cameraActorId, position: s.dummy.position, layer: s.dummy.layer }; },
      readProviders: providers,
      readContext: () => ({ catalog: puppetCatalog, checkpoint: this.partyActors!.checkpoint(), bindings,
        ...this.options.puppetRoster!.current(), entities: this.entityList.filter((e) => this.actors[e.id])
          .map((e) => ({ entityId: Number(e.id), actor: e.id })), restorePartyInstruction: "absent" }),
      controlContext: () => structuredClone(controlContext),
      prepareCollision: (enabled) => {
        const before = this.collisionSwitches, next = projectFieldPuppetCollision(enabled);
        return () => { if (this.collisionSwitches !== before) throw new Error("Stale collision switch transaction");
          this.collisionSwitches = next; };
      },
    });
    // Reject missing/ambiguous alias and resident bindings while every new
    // object is still private. A failed installation cannot replace the player.
    port.read();
    for (const actor of projected) { this.actors[actor.id] = actor; this.hiddenEntities.delete(actor.id); }
    published = true;
    this.options.puppetActors = port;
    this.options.sourceMessageEffects = { prepare: (effects) => {
      if (effects.length !== 1 || effects[0]!.kind !== "entity-update-group" ||
          effects[0]!.invokeCallback !== false || ![8, 12].includes(effects[0]!.group))
        throw new Error("Unbound source message update group");
      const before = this.entityUpdateMask, mask = sourceMessageUpdateMask(effects[0]!.group);
      return () => {
        if (this.entityUpdateMask !== before) throw new Error("Stale source message update group");
        this.entityUpdateMask = mask;
      };
    } };
  }
  readonly hiddenEntities = new Set<string>();
  private readonly openedTreasures = new Set<string>();
  readonly activeGroups = new Set<string>();
  private readonly entityList: FieldEntity[];
  private readonly defaultProperties: readonly FieldEntity[];
  private currentProperties: readonly FieldEntity[];
  get entities(): readonly FieldEntity[] {
    return this.entityList;
  }
  /** Source minimap queries current properties (default + latest event group), not all spawned bodies. */
  get minimapEntities(): readonly FieldEntity[] {
    return this.currentProperties;
  }
  get flags(): Record<string, Record<string, boolean>> {
    return this.eventState.flagView();
  }
  readonly presentationOmissions: {
    site: Site;
    kind: "sound" | "sound-sync";
    soundId: number | null;
  }[] = [];
  get fade() { return this.fader.projection; }
  dialogue: Dialogue | null = null;
  readonly sourceMessage = new SourceMessageState();
  private retainedMessage: Dialogue | null = null;
  private treasureSceneState: "player" | "message" = "player";
  /** A close=false source message keeps its window during the post-input yield. */
  get messageWindow(): Dialogue | null { return this.dialogue ?? this.retainedMessage; }
  stop: Stop | null = null;
  time = 0;
  private tasks: Task[] = [];
  private puppetLifecycle: { script: FieldPuppetScriptContext; leaderId: number | null;
    assignments: boolean[]; finished: boolean } | null = null;
  private remainder = 0;
  private nextTask = 1;
  private synchronizedEntry: boolean | null = null;
  private entryTaskStarted = false;
  private pendingPlayerStep: ReturnType<FieldConditionPort["prepareStep"]> | null = null;
  private interaction: {
    entityId: string;
    restoreDirection: Direction | null;
    waitUntil: number;
  } | null = null;
  private shopTask: {
    id: number;
    groupId: number;
    entityId: string;
    stage: "greeting" | "open" | "farewell";
    close: FieldMessage | null;
  } | null = null;
  /** Only the open window authorizes a transaction. Greeting/farewell remain
   * busy field states but cannot buy, sell, or be closed a second time. */
  get currentShop(): { id: number; groupId: number; entityId: string } | null {
    const shop = this.shopTask;
    return !this.stop && shop?.stage === "open"
      ? { id: shop.id, groupId: shop.groupId, entityId: shop.entityId }
      : null;
  }
  closeShop(): boolean {
    const shop = this.shopTask;
    if (!shop || shop.stage !== "open" || this.stop) return false;
    if (shop.close) {
      shop.stage = "farewell";
      this.dialogue = { ...shop.close, task: shop.id };
    } else {
      this.shopTask = null;
      this.pump();
    }
    return true;
  }
  constructor(
    readonly content: FieldContent,
    readonly eventState: EventState = new EventState(),
    readonly bgm: StaticAudioState = new StaticAudioState(),
    readonly environment: StaticAudioState = new StaticAudioState(),
    readonly options: FieldGameOptions = {},
    readonly fader: FieldFadeState = new FieldFadeState(content.entry.fade ?? null),
    cameraState?: FieldCameraState,
  ) {
    cloneSourcePresentationContext(options.sourcePresentation?.context() ?? null);
    if (options.playerVisibility !== undefined) {
      checkpointKeys(options.playerVisibility, "childEntityObject");
      if (options.playerVisibility.childEntityObject !== "absent" &&
          options.playerVisibility.childEntityObject !== "unresolved")
        throw new Error("Unknown player visibility host capability");
    }
    this.playerVisibilityChild = options.playerVisibility?.childEntityObject ?? "unresolved";
    if (content.entry.synchronization !== undefined) {
      checkpointKeys(content.entry.synchronization, "kind");
      if (content.entry.synchronization.kind !== "map-entry")
        throw new Error("Unknown field entry synchronization source");
      this.synchronizedEntry = false;
    }
    this.transportationId = content.entry.transportationId ?? null;
    const offset = content.entry.cameraOffset ?? { x: 0, y: 0 };
    checkpointKeys(offset, "x,y");
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
      throw new Error("Invalid field entry camera offset");
    this.cameraOffset = Object.freeze({ ...offset });
    if (this.transportationId !== null)
      checkpointInteger(this.transportationId, 1, 0x7fffffff);
    this.tileAnimations = new TileAnimationState(content.map);
    this.openTriggers = new OpenTriggerState(this.tileAnimations);
    this.entityList = [...content.map.entities];
    const groups = content.map.groups,
      initial = content.map.initialGroups;
    this.defaultProperties =
      groups && initial
        ? initial.includes("entity_default")
          ? groups.entity_default!.entities
          : []
        : [...this.entityList];
    const latest = initial?.filter((name) => name !== "entity_default").at(-1);
    this.currentProperties =
      groups && latest
        ? [...this.defaultProperties, ...groups[latest]!.entities]
        : this.defaultProperties;
    if (this.entityList.some((e) => e.kind === 18))
      requireMinimapMedia(this.entityList, content.minimap);
    this.collisionRange = fieldCollisionRange(
      content.map.width,
      content.map.height,
      this.entityList,
    );
    for (const name of content.map.initialGroups ?? [])
      this.activeGroups.add(name);
    const p = content.entry.player;
    this.actors["-1001"] = {
      ...p,
      id: "-1001",
      motion: null,
      steps: 0,
      animation: this.initialAnimation(p.asset, p.direction, p.mount),
    };
    if (content.entry.playerVisible !== undefined && typeof content.entry.playerVisible !== "boolean")
      throw new Error("Unknown field entry player visibility");
    if (content.entry.playerVisible === false) this.hiddenEntities.add("-1001");
    Object.assign(this.actors, this.createActors(this.entityList));
    this.partyActors = content.entry.partyActors && options.partyAppearance
      ? new FieldPartyActors(options.partyAppearance.catalog, content.entry.partyActors, this.transportationId) : null;
    if (this.partyActors) {
      const media = this.partyActors.playerMedia();
      if (media.asset !== this.player.asset || media.mount !== (this.player.mount || null))
        throw new Error("Field entry does not match source player appearance");
    }
    if (cameraState && !content.cameraHost) throw new Error("Saved camera cannot grant an unbound camera host");
    if (content.cameraHost && this.entityList.some((entity) => entity.kind === 15))
      throw new Error("Camera ChangeOffset trigger provider is unresolved");
    this.camera = content.cameraHost ? new FieldCameraHost(content.cameraHost, this.cameraPorts(), cameraState) : null;
    const treasures = this.prepareTreasureInitialization(this.entityList);
    this.tileAnimations.register(this.entityList);
    this.initializeTreasures(treasures);
    this.openTriggers.initialize(this.entityList, this.player);
  }
  private initialAnimation(
    asset: string,
    direction: Direction,
    mount: string | null,
  ): ActorAnimation | null {
    const character = this.content.characters[asset];
    // Mounted composition still uses the explicit opening presentation profile.
    // Logic-only fixtures can omit media; explicit animation commands always require it.
    if (mount || !character) return null;
    const animation = new ActorAnimation(character);
    animation.cue(FIELD_POSE[direction], -1);
    return animation;
  }
  private createActors(
    entities: readonly FieldEntity[],
  ): Record<string, Actor> {
    const actors: Record<string, Actor> = {};
    for (const e of entities)
      if ((e.kind === 6 || e.kind === 17) && e.asset)
        actors[e.id] = {
          id: e.id,
          x: e.x,
          y: e.y,
          layer: e.layer,
          direction: e.direction,
          asset: e.asset,
          mount: null,
          motion: null,
          steps: 0,
          animation: this.initialAnimation(e.asset, e.direction, null),
        };
    return actors;
  }
  /** Source SetEventEntityGroup appends entities; it does not replace existing groups. */
  private activateGroup(name: string): void {
    const group = this.content.map.groups?.[name];
    if (!group) throw new Error(`缺少实体组 ${name}`);
    if (this.activeGroups.has(name))
      throw new Error(`重复实体组激活尚未恢复：${name}`);
    if (group.blockers.length)
      throw new Error(`${name}：${group.blockers[0]!.reason}`);
    if (this.camera && group.entities.some((entity) => entity.kind === 15))
      throw new Error("Camera ChangeOffset trigger provider is unresolved");
    if (group.entities.some((e) => e.kind === 18))
      requireMinimapMedia(group.entities, this.content.minimap);
    const ids = new Set(this.entityList.map((e) => e.id));
    ids.add("-1001");
    for (const e of group.entities) {
      if (ids.has(e.id)) throw new Error(`实体身份冲突 ${e.id}`);
      ids.add(e.id);
    }
    // Validate the entire group before any actor, collision, or trigger becomes visible.
    const actors = this.createActors(group.entities);
    const treasures = this.prepareTreasureInitialization(group.entities);
    this.tileAnimations.register(group.entities);
    this.entityList.push(...group.entities);
    this.initializeTreasures(treasures);
    Object.assign(this.actors, actors);
    this.activeGroups.add(name);
    this.currentProperties = [...this.defaultProperties, ...group.entities];
  }
  get player(): PlacedActor {
    const player = this.actors["-1001"]!;
    if (player.layer === null || player.direction === null || player.asset === null)
      throw new Error("Actual player is missing its prepared pose/media");
    return player as PlacedActor;
  }
  private prepareTreasureInitialization(entities: readonly FieldEntity[]): FieldEntity[] {
    return entities.filter((e) => e.kind === 7).filter((e) => {
      if (!e.treasure) throw new Error("Missing treasure source binding");
      validateTreasureInventory(e.treasure);
      const value = this.eventState.read(treasureFlagRef(e.treasure.flagId));
      if (value !== 0 && value !== 1) throw new Error("Unknown treasure entry flag");
      return value === 1;
    });
  }
  private linkedTreasureTiles(entity: FieldEntity): FieldEntity | undefined {
    // Source SearchTileAnimRegionEnitity returns only the first registered match.
    return this.entityList.find((e) => e.kind === 1 && e.objectId === entity.treasure!.presentation.linkObjectId);
  }
  private openTreasure(entity: FieldEntity): void {
    this.openedTreasures.add(entity.id);
    if (entity.treasure!.presentation.pickUp) this.hiddenEntities.add(entity.id);
  }
  private initializeTreasures(entities: readonly FieldEntity[]): void {
    for (const entity of entities) {
      this.openTreasure(entity);
      const link = this.linkedTreasureTiles(entity);
      if (link) this.tileAnimations.forceLastFrame(link.id);
    }
  }
  private prepareTreasureTask(request: TreasureBoxRequest, site: Site, selected?: FieldEntity): NonNullable<Task["treasure"]> {
    const port = this.options.treasure, limits = this.content.treasureInventoryLimits;
    if (!port || !limits || limits.item !== port.limits.item || limits.gil !== port.limits.gil)
      throw new Error("Missing or mismatched treasure inventory owner");
    if (!selected && (!request.after || request.actionSoundId !== 0))
      throw new Error("Invalid explicit treasure caller");
    const matches = selected ? this.entityList.filter((e) => e === selected && e.treasure?.entityId === request.entityId) :
      this.entityList.filter((e) => e.treasure?.entityId === request.entityId);
    if (matches.length !== 1) throw new Error("Missing or ambiguous treasure entity");
    const entity = matches[0]!, definition = entity.treasure!;
    if (selected && (request.after || !request.message || request.actionSoundId !== definition.presentation.soundId))
      throw new Error("Invalid ordinary treasure caller");
    // Exhausted stacks use a canonical zero record in our shared owner. Native
    // removes them; amounts above MAX_ITEM would distinguish these histories.
    if (definition.reward.kind !== "grant-gil" && definition.contentNum > limits.item)
      throw new Error("Treasure overflow requires native inventory record presence");
    const state = createTreasureTask(definition, request);
    if (request.message) {
      const messages = entity.treasureMessages;
      if (!messages || (messages.reward && messages.reward.key !== definition.presentation.messageKey) ||
          messages.empty.key !== definition.messages.emptyKey ||
          (messages.countOver && messages.countOver.key !== definition.messages.countOverKey))
        throw new Error("Missing or mismatched treasure message binding");
      for (const message of [messages.reward, messages.empty, messages.countOver])
        if (message && (typeof message.text !== "string" || typeof message.speaker !== "string" ||
            (message.alignment !== undefined && message.alignment !== "center")))
          throw new Error("Invalid treasure message presentation");
    }
    const link = this.linkedTreasureTiles(entity);
    if (link && !this.tileAnimations.has(link.id)) throw new Error("Missing treasure tile binding");
    new EventState(this.eventState.snapshot()).write(treasureFlagRef(definition.flagId), 1);
    return { state, entity, site, closeMessage: true, messageAvailableAt: 0 };
  }
  private advanceTreasure(t: Task, acknowledgement?: TreasureTaskInput): void {
    const pending = t.treasure!, port = this.options.treasure!;
    let input = acknowledgement;
    if (!input) {
      if (pending.state.wait === "message") return;
      if (pending.state.wait === "complete") {
        t.treasure = null;
        if (t.treasureRoot) t.done = true;
        return;
      }
      if (pending.state.wait === "frame") input = { kind: "frame" };
      else {
        const value = this.eventState.read(treasureFlagRef(pending.state.definition.flagId));
        if (value !== 0 && value !== 1) throw new Error("Unknown treasure opened flag");
        input = { kind: pending.state.wait === "start" ? "start" : "sound-complete",
          flag: value === 1, owned: port.read(), limits: port.limits };
      }
    }
    const next = advanceTreasureTask(pending.state, input);
    const draft = new EventState(this.eventState.snapshot());
    const link = this.linkedTreasureTiles(pending.entity);
    if (link && !this.tileAnimations.has(link.id)) throw new Error("Missing treasure tile binding");
    const resolveMessage = (key: string): FieldMessage => {
      const messages = pending.entity.treasureMessages;
      const found = messages && [messages.reward, messages.empty, messages.countOver].find((m) => m?.key === key);
      if (!found) throw new Error("Missing treasure message " + key);
      return found;
    };
    // Validate the entire selected branch before its first grant/open, including
    // messages beyond the next suspension. Unused script-chest reward templates
    // may be absent; they never authorize a message-producing explicit caller.
    for (const effect of [...next.effects, ...next.state.remaining]) {
      if (effect.kind === "message") {
        resolveMessage(effect.key);
        if (this.messageWindow && this.messageWindow.task !== t.id)
          throw new Error("Concurrent source message windows are not implemented");
      }
      else if (effect.kind === "set-message-value") {
        const value = pending.entity.treasureMessages?.parameter;
        if (!value || value.token !== effect.token || (effect.token === "NUM" ?
            value.value !== String(effect.number) : value.sourceKey !== effect.messageKey))
          throw new Error("Missing or mismatched treasure message parameter");
      } else if (effect.kind === "flag") draft.write(effect.ref, effect.value);
      else if (effect.kind === "run-script") {
        if (!this.content.scripts[effect.name]) throw new Error("Missing treasure event script");
        if (this.tasks.some((task) => !task.done && !task.treasureRoot && task.slot === null))
          throw new Error("Treasure script cannot replace an active main core");
        draft.beginScript(this.content.scriptLocals?.[effect.name] ?? null);
      }
    }
    const scripts = next.effects.filter((effect) => effect.kind === "run-script");
    if (scripts.length > 1) throw new Error("Multiple treasure event registrations");
    const publishScript = scripts[0] ? this.preparePuppetStart(scripts[0].name) : null;
    let transaction: FieldInventoryTransaction | null = null;
    for (const effect of next.effects) {
      if (effect.kind === "grant") {
        if (transaction) throw new Error("Multiple treasure reward transactions");
        transaction = port.prepare(effect.command);
        if (transaction.result !== null) throw new Error("Unexpected treasure reward result");
      }
    }
    // Commit the owner before publishing task progress, presentation or flags.
    // No asynchronous dependency is evaluated inside this publication boundary.
    transaction?.commit();
    for (const effect of next.effects) {
      switch (effect.kind) {
        // This build's FieldController.DeactivateAction (0x2c8ef0) is a shared
        // return stub. Task ownership, not this call, prevents repeated input.
        case "deactivate-action": break;
        case "sound":
          this.presentationOmissions.push({ site: pending.site, kind: "sound", soundId: effect.id });
          break;
        case "open": this.openTreasure(pending.entity); break;
        case "tile-animation": if (link) this.tileAnimations.playDefault(link.id); break;
        case "run-script":
          this.eventState.beginScript(this.content.scriptLocals?.[effect.name] ?? null);
          publishScript!();
          this.tasks.push(this.task(effect.name, 0, "-1001"));
          break;
        // The compiler resolves the source parameter into the bound message;
        // there is no mutable global substitution register in the Web renderer.
        case "grant": case "set-message-value": break;
        case "scene-state": this.treasureSceneState = effect.state; break;
        case "message":
          this.dialogue = { ...resolveMessage(effect.key), task: t.id };
          this.retainedMessage = null;
          pending.closeMessage = effect.close;
          pending.messageAvailableAt = this.time + 10;
          break;
        case "flag": this.eventState.write(effect.ref, effect.value); break;
        case "yield": t.wait = 10; break;
      }
    }
    pending.state = next.state;
  }
  private treasureHandoffBlocked(): boolean {
    return this.tasks.some((task) => {
      if (task.done || !task.treasure) return false;
      const state = task.treasure.state;
      // The ordinary script wrapper explicitly does not own/wait for the
      // registered event. Its final frame has no reward, message or flag left.
      return !(task.treasureRoot && state.definition.scriptId > 0 &&
        state.wait === "frame" && state.remaining.length === 0 &&
        !state.request.after && !this.dialogue && this.treasureSceneState === "player");
    });
  }
  get partyActorCheckpoint(): FieldPartyActorCheckpoint | null {
    return this.partyActors?.checkpoint() ?? null;
  }
  private requirePlayerMedia(asset: string, mount: string | null): void {
    for (const [id, riding] of [[asset, !!mount], ...(mount ? [[mount, false]] : [])] as [string, boolean][]) {
      const missing = missingFieldPoses(this.content.characters[id], riding);
      if (missing.length) throw new Error(`Missing party appearance media ${id}/${missing.join(",")}`);
    }
  }
  private preparePartyAppearance(appearance: PartyAppearanceCandidate | undefined, setDummy = true): () => void {
    if (!this.partyActors || !appearance) throw new Error("Party actor refresh is unavailable");
    return this.partyActors.prepare(appearance, (media, plan) => this.preparePartyRenderer(media, plan), setDummy);
  }
  private preparePartyRenderer({ asset, mount }: { asset: string; mount: string | null }, plan: PartyActorPlan): () => void {
    const actor = this.player;
    if (actor.native) throw new Error("Native actor asset-refresh publication is not yet admitted");
    if (plan.cameraOffset && (plan.cameraOffset.x !== this.cameraOffset.x || plan.cameraOffset.y !== this.cameraOffset.y))
      throw new Error("Changing the field camera offset during party refresh is not implemented");
    if (actor.motion) throw new Error("Party appearance refresh during player movement is not supported");
    this.requirePlayerMedia(asset, mount);
    const animation = this.initialAnimation(asset, actor.direction, mount);
    return () => { Object.assign(actor, { asset, mount, animation }); };
  }
  get busy(): boolean {
    return (
      this.tasks.some((t) => !t.done) ||
      this.sourceMessage.active ||
      !!this.dialogue ||
      !!this.shopTask ||
      this.treasureSceneState === "message" ||
      !!this.stop ||
      this.openTriggers.busy ||
      (this.interaction?.waitUntil ?? 0) > this.time
    );
  }
  get checkpointReady(): boolean {
    return (
      // The source actor host also owns native camera/collision/hidden puppet
      // state. Stable saves remain blocked until that owner has a bound codec.
      !this.options.puppetActors &&
      this.sourcePresentationContext?.advertisementOpeningFader !== "present" &&
      this.synchronizedEntry !== false &&
      !this.busy &&
      !this.fader.active &&
      !this.interaction &&
      Object.values(this.actors).every((a) => a.motion === null)
    );
  }
  get sourcePresentationContext(): SourcePresentationContext | null {
    return cloneSourcePresentationContext(this.options.sourcePresentation?.context() ?? null);
  }
  checkpoint(): FieldCheckpoint {
    if (!this.checkpointReady)
      throw new Error("Cannot save during field movement or an event");
    return {
      kind: "idle-field-v8",
      contentHash: this.content.contentHash,
      time: this.time,
      remainder: this.remainder,
      nextTask: this.nextTask,
      transportationId: this.transportationId,
      entrySynchronized: this.synchronizedEntry,
      partyActors: this.partyActorCheckpoint,
      sourcePresentation: sourcePresentationCheckpoint(this.sourcePresentationContext),
      eventState: this.eventState.snapshot(),
      activeGroups: [...this.activeGroups],
      hiddenEntities: [...this.hiddenEntities],
      openedTreasures: [...this.openedTreasures],
      actors: Object.values(this.actors).map(({ motion: _, animation, native, ...actor }) => {
        if (native || actor.layer === null || actor.direction === null || actor.asset === null)
          throw new Error("Native actors require their own stable field codec");
        return { ...actor, layer: actor.layer, direction: actor.direction, asset: actor.asset,
          animation: animation?.snapshot() ?? null };
      }),
      tiles: this.tileAnimations.checkpoint(),
      doors: this.openTriggers.checkpoint(),
      bgm: this.bgm.snapshot(),
      environment: this.environment.snapshot(),
      fade: this.fader.snapshot(),
      camera: this.cameraSnapshot,
    };
  }
  /** Rebuild dependencies from trusted content without replaying initialization or triggers. */
  static restore(
    content: FieldContent,
    raw: FieldCheckpoint,
    options: FieldGameOptions = {},
  ): FieldGame {
    if (options.puppetActors)
      throw new Error("Source puppet host checkpoints require a bound actor/camera/collision codec");
    const s = structuredClone(raw);
    checkpointKeys(
      s,
      "kind,contentHash,time,remainder,nextTask,transportationId,entrySynchronized,partyActors,sourcePresentation,eventState,activeGroups,hiddenEntities,openedTreasures,actors,tiles,doors,bgm,environment,fade,camera",
    );
    if (s.kind !== "idle-field-v8" || s.contentHash !== content.contentHash ||
      s.transportationId !== (content.entry.transportationId ?? null))
      throw new Error("Field checkpoint source/version mismatch");
    const presentation = sourcePresentationCheckpoint(options.sourcePresentation?.context() ?? null);
    if (canonical(sourcePresentationCheckpoint(s.sourcePresentation)) !== canonical(presentation))
      throw new Error("Field checkpoint source presentation context mismatch");
    // Pending entry scripts cannot be saved. Unknown bootstrap context cannot
    // acquire a source synchronization proof merely by editing a checkpoint.
    if (s.entrySynchronized !== (content.entry.synchronization ? true : null))
      throw new Error("Field checkpoint entry synchronization mismatch");
    checkpointNumber(s.time);
    checkpointNumber(s.remainder, 0, 10);
    checkpointInteger(s.nextTask, 1);
    if (s.remainder >= 10) throw new Error("Invalid field remainder");
    if ((s.fade !== null) !== (content.entry.fade !== undefined))
      throw new Error("Field checkpoint cannot grant a missing fade host");
    if ((s.camera !== null) !== (content.cameraHost !== undefined))
      throw new Error("Field checkpoint cannot grant or discard a camera host");
    const next = new FieldGame(
      content,
      new EventState(s.eventState),
      StaticAudioState.restore(s.bgm, content.bgm),
      StaticAudioState.restore(s.environment, content.environment),
      options,
      FieldFadeState.restore(s.fade),
      s.camera ?? undefined,
    );
    checkpointIds(s.activeGroups);
    const initial = [...next.activeGroups];
    if (initial.some((id, n) => s.activeGroups[n] !== id))
      throw new Error("Initial field groups changed in checkpoint");
    for (const id of s.activeGroups.slice(initial.length))
      next.activateGroup(id);
    if (next.partyActors) {
      if (!s.partyActors) throw new Error("Missing saved party appearances");
      next.partyActors.restore(s.partyActors);
      const media = next.partyActors.playerMedia();
      next.requirePlayerMedia(media.asset, media.mount);
      Object.assign(next.player, media);
    } else if (s.partyActors !== null) throw new Error("Unbound saved party appearances");
    checkpointIds(s.hiddenEntities);
    if (s.hiddenEntities.some((id) => !next.hasEntity(id) || (next.camera && id === next.cameraActorId)))
      throw new Error("Unknown hidden saved entity");
    checkpointIds(s.openedTreasures);
    if (s.openedTreasures.some((id) => !next.entities.some((e) => e.id === id && e.treasure)))
      throw new Error("Unknown opened treasure identity");
    for (const id of s.openedTreasures) {
      const entity = next.entities.find((e) => e.id === id)!;
      if (entity.treasure!.presentation.pickUp && !s.hiddenEntities.includes(id))
        throw new Error("Opened pickup treasure is still visible");
    }
    if (!Array.isArray(s.actors)) throw new Error("Missing saved actors");
    checkpointSameIds(
      s.actors.map((a) => a.id),
      Object.keys(next.actors),
    );
    for (const a of s.actors) {
      checkpointKeys(a, "id,x,y,layer,direction,asset,mount,steps,animation");
      const actor = next.actors[a.id]!;
      checkpointInteger(a.steps);
      checkpointInteger(a.x, -0x80000000, 0x7fffffff);
      checkpointInteger(a.y, -0x80000000, 0x7fffffff);
      checkpointInteger(a.layer, -0x80000000, 0x7fffffff);
      if (
        typeof a.direction !== "string" ||
        !Object.hasOwn(DELTA, a.direction) ||
        a.asset !== actor.asset ||
        (a.mount !== actor.mount && a.mount !== content.entry.player.mount) ||
        (a.id === "-1001"
          ? !content.map.collisions[a.layer]
          : a.layer !== actor.layer)
      )
        throw new Error("Invalid saved actor identity, layer or pose");
      const animation = next.initialAnimation(a.asset, a.direction, a.mount);
      if (!!animation !== (a.animation !== null))
        throw new Error("Saved actor animation dependency changed");
      if (animation) animation.restore(a.animation);
      Object.assign(actor, a, { animation, motion: null });
    }
    next.hiddenEntities.clear();
    s.hiddenEntities.forEach((id) => next.hiddenEntities.add(id));
    next.openedTreasures.clear();
    s.openedTreasures.forEach((id) => next.openedTreasures.add(id));
    next.tileAnimations.restoreCheckpoint(s.tiles);
    next.openTriggers.restoreCheckpoint(s.doors, next.entities);
    next.time = s.time;
    next.remainder = s.remainder;
    next.nextTask = s.nextTask;
    next.synchronizedEntry = s.entrySynchronized;
    return next;
  }
  private block(message: string, site: Site | null = null) {
    this.stop = { kind: "unsupported", message, site };
  }
  private dynamicCollision(p: Point, layer: number): number | null {
    if (!this.collisionSwitches.entityCollision) return 15;
    let mask = 15;
    for (const e of this.entityList)
      if (
        this.isEntityVisible(e.id) &&
        e.kind === 19 &&
        e.layer === layer &&
        contains(e, p)
      ) {
        if (
          e.collision === null ||
          !Number.isInteger(e.collision) ||
          e.collision < 0 ||
          e.collision > 7
        ) {
          this.block("尚未支持的动态碰撞", {
            script: "collision",
            index: 0,
            source: e.source,
          });
          return null;
        }
        mask &= collisionMask(e.collision);
      }
    return mask;
  }
  private collision(p: Point, layer: number): number | null {
    if (!this.collisionSwitches.mapColliders) return this.dynamicCollision(p, layer);
    if (!inCollisionRange(p, this.collisionRange)) return 0;
    const cell =
      this.content.map.collisions[layer]?.[p.y * this.content.map.width + p.x];
    try {
      const mask = collisionMask(cell as number),
        dynamic = this.dynamicCollision(p, layer);
      return dynamic === null ? null : mask & dynamic;
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
  private occupied(points: Point[], layer: number): boolean {
    if (!this.collisionSwitches.entityCollision) return false;
    return (
      this.entityList.some(
        (e) =>
          ((e.kind === 8 && this.openTriggers.blocks(e.id)) ||
            ((e.kind === 5 || e.kind === 7) && e.mapObject?.collision)) &&
          e.layer === layer &&
          this.isEntityVisible(e.id) &&
          points.some((p) => contains(e, p)),
      ) ||
      Object.values(this.actors).some(
        (a) =>
          a.id !== this.player.id &&
          this.isEntityVisible(a.id) &&
          this.entityList.find((e) => e.id === a.id)?.npc?.collision !==
            false &&
          a.layer === layer &&
          points.some((p) => a.x === p.x && a.y === p.y),
      )
    );
  }
  private slopeDestination(
    direction: Direction,
    straight: Point,
  ): Point | null {
    const p = this.player,
      map = this.content.map,
      grid = map.collisions[p.layer];
    if (!grid || !inCollisionRange(straight, this.collisionRange)) return null;
    const delta = redirectAtSlope(
      grid[straight.y * map.width + straight.x]!,
      direction,
    );
    if (!delta) return null;
    const to = { x: p.x + delta.x, y: p.y + delta.y };
    if (!inCollisionRange(to, this.collisionRange)) return null;
    let mapping = this.collisionMappings.get(p.layer);
    if (!mapping) {
      mapping = buildCollisionMapping(
        grid,
        map.width,
        map.height,
        this.collisionRange,
      );
      this.collisionMappings.set(p.layer, mapping);
    }
    if (
      !(mapping[p.y * map.width + p.x]! & diagonalBit(delta.x, delta.y)) ||
      !(mapping[to.y * map.width + to.x]! & diagonalBit(-delta.x, -delta.y))
    )
      return null;
    const horizontal = { x: to.x, y: p.y },
      vertical = { x: p.x, y: to.y };
    // The native path graph is static. Dynamic colliders and actors must still block its swept corners.
    const cells = [p, horizontal, vertical, to];
    for (const cell of cells) {
      const mask = this.dynamicCollision(cell, p.layer);
      if (mask === null) return null;
      const xBit = cell.x === p.x ? (delta.x > 0 ? 4 : 2) : delta.x > 0 ? 2 : 4;
      const yBit = cell.y === p.y ? (delta.y > 0 ? 8 : 1) : delta.y > 0 ? 1 : 8;
      if (!(mask & xBit) || !(mask & yBit)) return null;
    }
    return this.occupied([horizontal, vertical, to], p.layer) ? null : to;
  }
  move(direction: Direction): boolean {
    const p = this.player;
    if (this.busy || p.motion || this.movementBlocker) return false;
    p.direction = direction;
    const faceBlockedStep = (): false => {
      try {
        p.animation?.look(direction);
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
      }
      return false;
    };
    const d = DELTA[direction];
    let to = { x: p.x + d.x, y: p.y + d.y };
    const doors = this.entityList.filter(
      (e) =>
        this.collisionSwitches.entityCollision && e.kind === 8 &&
        e.layer === p.layer &&
        this.isEntityVisible(e.id) &&
        this.openTriggers.blocks(e.id) &&
        contains(e, to),
    );
    if (doors.length) {
      const e = doors[0]!,
        site: Site = { script: "open-trigger", index: 0, source: e.source };
      if (doors.length > 1)
        this.block("同格开门触发器的接触顺序尚未恢复", site);
      else
        try {
          if (
            this.openTriggers.start(e, this.entityList, direction) &&
            e.openTrigger!.soundId > 0
          )
            this.presentationOmissions.push({
              site,
              kind: "sound",
              soundId: e.openTrigger!.soundId,
            });
        } catch (error) {
          this.block(
            error instanceof Error ? error.message : String(error),
            site,
          );
        }
      return faceBlockedStep();
    }
    const fromMask = this.collision(p, p.layer),
      toMask = this.collision(to, p.layer);
    if (fromMask === null || toMask === null || !(fromMask & BIT[direction]))
      return faceBlockedStep();
    if (!(toMask & BIT[OPPOSITE[direction]])) {
      try {
        const redirected = this.slopeDestination(direction, to);
        if (!redirected) return faceBlockedStep();
        to = redirected;
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
        return false;
      }
    }
    if (this.occupied([to], p.layer)) return faceBlockedStep();
    let step: ReturnType<FieldConditionPort["prepareStep"]> | null;
    try {
      step = this.preparePlayerStep();
      p.animation?.move(direction, 0.24);
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error));
      return false;
    }
    this.pendingPlayerStep = step;
    p.motion = {
      from: { x: p.x, y: p.y },
      to,
      elapsed: 0,
      duration: 240,
      manual: true,
    };
    return true;
  }
  get movementBlocker(): string | null {
    return this.options.movementBlocker?.(this.transportationId, true) ?? null;
  }
  private preparePlayerStep() {
    // Native SetupCharacterData captures the moving corps at move start.
    // The owner rejects changes to that snapshot before completion; it must
    // never silently recalculate against a different party at the destination.
    return this.transportationId !== null && this.options.fieldSteps
      ? this.options.fieldSteps.prepareStep(this.transportationId)
      : null;
  }
  confirm(): void {
    if (this.stop) return;
    if (this.dialogue) {
      if (this.shopTask) {
        if (
          this.dialogue.task !== this.shopTask.id ||
          this.shopTask.stage === "open"
        ) {
          this.block("商店对话状态不一致");
          return;
        }
        if (this.shopTask.stage === "greeting") this.shopTask.stage = "open";
        else this.shopTask = null;
        this.dialogue = null;
        this.retainedMessage = null;
        this.pump();
        return;
      }
      const task = this.tasks.find((t) => t.id === this.dialogue!.task);
      if (task?.treasure) {
        if (this.time < task.treasure.messageAvailableAt) return;
        const message = this.dialogue, close = task.treasure.closeMessage;
        try { this.advanceTreasure(task, { kind: "message-complete" }); }
        catch (error) {
          this.block(error instanceof Error ? error.message : String(error), task.treasure.site);
          return;
        }
        this.retainedMessage = close ? null : message;
      } else this.retainedMessage = null;
      this.dialogue = null;
      if (task) task.lastClock = -1; // explicit input is a new host clock
      this.pump();
      return;
    }
    if (this.busy || this.player.motion || !this.collisionSwitches.interactiveObservation) return;
    const p = this.player,
      d = DELTA[p.direction],
      target = { x: p.x + d.x, y: p.y + d.y };
    const hits = this.entityList.filter((e) => {
      const properties = e.npc ?? e.mapObject;
      return (
        (e.kind === 6 || e.kind === 17 || e.kind === 5 || e.kind === 7) &&
        !(
          e.kind === 7 &&
          e.mapObject?.collision === false &&
          this.openedTreasures.has(e.id)
        ) &&
        this.isEntityVisible(e.id) &&
        (this.actors[e.id]?.layer ?? e.layer) === p.layer &&
        (properties ? properties.interaction.kind !== "none" : !!e.script) &&
        (e.kind === 6 || e.kind === 17
          ? this.actors[e.id]?.x === target.x &&
            this.actors[e.id]?.y === target.y
          : contains(e, target)) &&
        (!properties ||
          (!!(
            properties.acceptDirection & ACTION_SIDE[OPPOSITE[p.direction]]
          ) &&
            (properties.interaction.kind === "blocked" ||
              properties.talkMounts.includes(p.mount ?? ""))))
      );
    });
    if (hits.length > 1) {
      this.block("同格交互目标不明确");
      return;
    }
    const e = hits[0];
    if (!e) return;
    const site = {
        script: e.script ?? "field-interaction",
        index: 0,
        source: e.source,
      },
      npc = e.npc,
      properties = npc ?? e.mapObject,
      actor = this.actors[e.id];
    if (!properties || ((e.kind === 6 || e.kind === 17) && (!npc || !actor))) {
      this.block("此交互尚未迁移", site);
      return;
    }
    const action = properties.interaction;
    if (action.kind === "blocked") {
      this.block(action.reason, site);
      return;
    }
    if (npc && (npc.moveType !== 0 || actor?.motion)) {
      this.block("此 NPC 的移动控制器尚未迁移", site);
      return;
    }
    if (
      action.kind === "script" &&
      action.script !== null &&
      !this.content.scripts[action.script]
    ) {
      this.block("缺少交互事件脚本 " + action.script, site);
      return;
    }
    if (action.kind === "none") return;
    if (action.kind === "shop") {
      try {
        if (
          !Number.isInteger(action.groupId) ||
          action.groupId <= 0 ||
          !this.options.shop
        )
          throw new Error("Missing ordinary shop state provider");
        for (const message of [action.start, action.close])
          if (
            message !== null &&
            (!message ||
              typeof message.key !== "string" ||
              !message.key ||
              typeof message.text !== "string" ||
              typeof message.speaker !== "string" ||
              (message.alignment !== undefined &&
                message.alignment !== "center"))
          )
            throw new Error("Invalid ordinary shop message");
        this.options.shop.validate(action.groupId);
      } catch (error) {
        this.block(
          error instanceof Error ? error.message : String(error),
          site,
        );
        return;
      }
    }
    let treasureTask: Task["treasure"] = null;
    if (action.kind === "treasure") {
      try { treasureTask = this.prepareTreasureTask(action.request, site, e); }
      catch (error) {
        this.block(error instanceof Error ? error.message : String(error), site);
        return;
      }
    }
    this.interaction = {
      entityId: e.id,
      restoreDirection:
        npc?.eyeContact && npc.turnAround && actor ? actor.direction : null,
      // Empty source actions yield before returning control. One logical tick is the Web adaptation.
      waitUntil:
        this.time +
        (action.kind === "script" && action.script === null ? 10 : 0),
    };
    if (npc?.eyeContact && actor) {
      actor.direction = OPPOSITE[p.direction];
      try {
        actor.animation?.look(actor.direction);
      } catch (error) {
        this.block(
          error instanceof Error ? error.message : String(error),
          site,
        );
        return;
      }
    }
    if (properties.soundId > 0 && action.kind !== "treasure")
      this.presentationOmissions.push({
        site,
        kind: "sound",
        soundId: properties.soundId,
      });
    if (action.kind === "script") {
      if (action.script !== null) this.beginRoot(action.script);
    } else if (action.kind === "treasure") {
      const task = this.task(site.script, 0, "-1001");
      task.treasureRoot = true;
      task.treasure = treasureTask;
      this.tasks = [task];
      this.pump();
    } else if (action.kind === "shop") {
      const id = this.nextTask++;
      this.shopTask = {
        id,
        groupId: action.groupId,
        entityId: e.id,
        stage: action.start ? "greeting" : "open",
        close: action.close ? { ...action.close } : null,
      };
      if (action.start) this.dialogue = { ...action.start, task: id };
    } else this.dialogue = { ...action.message, task: 0 };
  }
  private finishInteraction(): void {
    if (!this.interaction || this.busy) return;
    const { entityId, restoreDirection } = this.interaction;
    if (restoreDirection && this.actors[entityId]) {
      this.actors[entityId]!.direction = restoreDirection;
      try {
        this.actors[entityId]!.animation?.look(restoreDirection);
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
      }
    }
    this.interaction = null;
  }
  /** Integer 10 ms simulation steps make render-frame partitioning irrelevant. */
  advance(milliseconds: number): void {
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 60000
    )
      throw new Error("Invalid elapsed time");
    this.remainder += milliseconds;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.stop) continue;
      this.bgm.advance(10, this.content.bgm);
      this.environment.advance(10, this.content.environment);
      this.tileAnimations.advance(10);
      this.openTriggers.advance();
      this.time += 10;
      this.fader.advance(0.01);
      this.sourceMessage.advance(0.01);
      let entered = false;
      for (const a of Object.values(this.actors)) {
        // Source fresh player, party puppets and residents have attribute 2.
        // Map NPC SetProperty can choose 10 and needs a distinct factory host.
        // Message group 8 has mask 9; event group 12 has mask 3. Camera (10),
        // tile animation (42), VM and the global fader continue separately.
        if (a.native && (this.entityUpdateMask & 2) === 0) continue;
        try {
          a.animation?.advance(10);
        } catch (error) {
          this.block(error instanceof Error ? error.message : String(error));
          return;
        }
        const m = a.motion;
        if (!m) continue;
        m.elapsed += 10;
        if (a.native) {
          const ratio = Math.min(1, m.elapsed / m.duration);
          a.x = m.from.x + (m.to.x - m.from.x) * ratio;
          a.y = m.from.y + (m.to.y - m.from.y) * ratio;
        }
        try {
          a.animation?.linkToMovement(Math.min(1, m.elapsed / m.duration));
        } catch (error) {
          this.block(error instanceof Error ? error.message : String(error));
          return;
        }
        if (m.elapsed >= m.duration) {
          // Resolve all owned effects before publishing coordinates or starting
          // destination events. A failed/stale provider leaves this move pending.
          if (a.id === this.player.id && this.pendingPlayerStep) {
            try {
              const step = this.pendingPlayerStep;
              step.commit();
              this.pendingPlayerStep = null;
              if (step.result.soundId !== null)
                this.presentationOmissions.push({
                  site: { script: "field-condition-step", index: a.steps, source: this.content.map.source },
                  kind: "sound",
                  soundId: step.result.soundId,
                });
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error));
              return;
            }
          }
          a.animation?.stop();
          a.x = m.to.x;
          a.y = m.to.y;
          a.motion = null;
          a.steps++;
          if (m.manual) entered = true;
        }
      }
      for (const t of this.tasks) t.wait = Math.max(0, t.wait - 10);
      if (entered) this.enter();
      this.pump(0.01);
    }
  }
  private enter(): void {
    if (!this.collisionSwitches.interactiveObservation) return;
    const p = this.player,
      hits = this.entityList.filter(
        (e) =>
          this.isEntityVisible(e.id) &&
          e.layer === p.layer &&
          contains(e, p),
      );
    const transitions = hits.filter((e) => e.kind === 4);
    if (transitions.length > 1) {
      this.block("层切换目标不明确");
      return;
    }
    if (transitions[0]) {
      const next = transitions[0].destinationLayer;
      if (next === null || !this.content.map.collisions[next]) {
        this.block("未支持的地图层");
        return;
      }
      p.layer = next;
    }
    const events = hits.filter((e) => e.kind === 2 || e.kind === 3);
    if (events.length > 1) {
      this.block("同格触发器顺序尚未验证");
      return;
    }
    const e = events[0];
    if (!e) return;
    if (e.kind === 3) {
      const site = {
        script: e.script ?? "map-transition",
        index: 0,
        source: e.source,
      };
      if (!e.destination) {
        this.block("缺少跨地图目标", site);
        return;
      }
      this.stop = {
        kind: "map-transition",
        message: "正在载入地图…",
        site,
        request: {
          ...e.destination,
          continuation: null,
          birdview: false,
          skipFade: false,
          skipBgm: false,
          origin: "trigger",
        },
      };
      return;
    }
    if (!e.script || !this.content.scripts[e.script]) {
      this.block("缺少事件脚本");
      return;
    }
    this.beginRoot(e.script);
  }
  /** Runs a package-provided event through the same VM as map triggers. */
  startEvent(script: string): boolean {
    if (this.busy || this.player.motion) return false;
    if (!this.content.scripts[script])
      throw new Error("Missing event script: " + script);
    this.beginRoot(script);
    return true;
  }
  /** Called exactly once by the source map-entry host. A normal event cannot
   * stand in for LastSettings -> SetupEncountData. No-script entries still
   * execute the source post-setup boundary. */
  startMapEntry(script: string | null): void {
    if (this.content.entry.synchronization?.kind !== "map-entry" ||
        this.synchronizedEntry !== false || this.entryTaskStarted)
      throw new Error("No pending source map entry");
    if (this.busy || this.player.motion)
      throw new Error("Cannot begin map entry during field activity");
    if (script !== null && !this.content.scripts[script])
      throw new Error("Missing map entry script: " + script);
    this.entryTaskStarted = true;
    if (script !== null) this.beginRoot(script);
    else this.finishMapEntry();
  }
  get entrySynchronized(): boolean | null { return this.synchronizedEntry; }
  get battleEntryContext(): ReturnType<typeof projectFieldEntryContext> {
    return projectFieldEntryContext(this.content.map.entryContext, {
      mapId: this.content.map.identity?.mapId ?? null,
      transportationId: this.transportationId,
      activeGroups: [...this.activeGroups],
      player: this.player,
      entrySynchronized: this.synchronizedEntry,
    });
  }
  private finishMapEntry(): void {
    if (this.synchronizedEntry === false && this.entryTaskStarted &&
        !this.busy && !this.fader.active && !this.interaction &&
        Object.values(this.actors).every((actor) => actor.motion === null))
      this.synchronizedEntry = true;
  }
  /** Explicit diagnostic entry, never counted as a story transition or a new-game state. */
  previewMap(mapId: number, entrance: number): void {
    if (this.busy || this.player.motion)
      throw new Error("Cannot preview a map during an event");
    this.stop = {
      kind: "map-transition",
      message: "正在载入地图预览…",
      site: null,
      request: {
        mapId,
        entrance,
        continuation: null,
        birdview: false,
        skipFade: true,
        skipBgm: true,
        origin: "development",
      },
    };
  }
  private beginRoot(script: string): void {
    try {
      const locals = this.content.scriptLocals?.[script] ?? null;
      new EventState(this.eventState.snapshot()).beginScript(locals);
      const publish = this.preparePuppetStart(script);
      this.eventState.beginScript(locals);
      publish();
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error), this.content.scripts[script]?.[0] ?? null);
      return;
    }
    this.tasks = [this.task(script, 0, "-1001")];
    this.pump();
  }
  /** Source host effects and all native bindings are prepared before locals or
   * tasks change. The port publishes back into this field's actor owners. */
  private preparePuppetStart(name: string): () => void {
    if (!this.content.scriptPuppetContexts && !this.options.puppetActors) {
      const camera = this.prepareCameraEvent("start", false);
      return () => { camera(); this.puppetLifecycle = null; };
    }
    const script = this.content.scriptPuppetContexts?.[name], port = this.options.puppetActors;
    if (!script || !port) throw new Error("Source puppet lifecycle host or script context is unavailable");
    const plan = projectFieldPuppetInitialization({ phase: "start", script, ...port.read() });
    const camera = this.prepareCameraEvent("start", this.separateCameraInitialization(plan));
    const publish = port.prepare(plan);
    if (typeof publish !== "function") throw new Error("Invalid source puppet actor transaction");
    const next = { script: structuredClone(script), leaderId: plan.leaderId,
      assignments: plan.assignments ?? fieldPuppetAssignments(), finished: false };
    return () => { publish(); camera(); this.puppetLifecycle = next; };
  }
  /** InitCameraDummy belongs to the single camera owner. The ordinary actor
   * transaction must not publish a second copy of the dummy. */
  private separateCameraInitialization(plan: { effects: import("./field-puppet-actors.js").FieldPuppetActorEffect[] }): boolean {
    if (!this.camera) return false;
    const initializers = plan.effects.filter((effect) => effect.kind === "init-camera-dummy");
    if (initializers.length > 1 || initializers.some((effect) =>
        effect.actor !== this.cameraActorId || effect.player !== this.player.id))
      throw new Error("Source actor lifecycle is not bound to the field camera owner");
    plan.effects = plan.effects.filter((effect) => effect.kind !== "init-camera-dummy");
    return initializers.length === 1;
  }
  private prepareCameraEvent(phase: "start" | "finish", initialize: boolean): () => void {
    if (!this.camera) return () => {};
    const draft = this.camera.fork(this.content.cameraHost!, this.cameraPorts());
    if (initialize) draft.prepareInitializeDummy().commit();
    draft.prepareSelect({ target: phase === "start" ? "dummy" : "player" }).commit();
    const transaction = this.camera.prepareState(draft.snapshot());
    return () => { transaction.commit(); this.cameraEventActive = phase === "start"; };
  }
  private task(script: string, pc: number, actor: string): Task {
    return {
      id: this.nextTask++,
      script,
      pc,
      actor,
      sourceEntityId: null,
      stack: [],
      wait: 0,
      slot: null,
      state: "ready",
      range: { min: 0, max: (this.content.scripts[script]?.length ?? 0) - 1 },
      lastClock: -1,
      puppetWait: null,
      fadeWait: null,
      cameraLerp: null,
      remaining: 0,
      move: null,
      animationWait: false,
      audioWait: null,
      treasure: null,
      treasureRoot: false,
      done: false,
    };
  }
  private hasEntity(id: string): boolean {
    return (
      !!this.actors[id] ||
      (!!this.camera && id === this.cameraActorId) ||
      this.entityList.some((e) => e.id === id) ||
      !!this.content.entry.absentHideTargets?.includes(id)
    );
  }
  /** Validate the handoff before consuming rewards. The commit only schedules
   * the continuation; normal simulation, not reward publication, runs its code. */
  prepareEncounterReturn(party: number): () => void {
    if (
      this.stop?.kind !== "encounter" ||
      this.stop.party !== party ||
      !this.stop.continuation
    )
      throw new Error("No matching field encounter to resume");
    if (this.options.puppetActors || this.content.scriptPuppetContexts)
      throw new Error("Source puppet battle return requires a candidate owned-state actor host");
    const continuation = this.stop.continuation;
    if (!this.content.scripts[continuation])
      throw new Error("Missing battle continuation");
    const stop = this.stop;
    const locals = structuredClone(
      this.content.scriptLocals?.[continuation] ?? null,
    );
    new EventState(this.eventState.snapshot()).beginScript(locals);
    return () => {
      if (this.stop !== stop) throw new Error("Stale battle continuation");
      this.eventState.beginScript(locals);
      this.tasks = [this.task(continuation, 0, "-1001")];
      this.stop = null;
      this.remainder = 0;
    };
  }
  /** Isolated field hosts can resume immediately; GameSession uses the prepared
   * continuation so shared-state publication precedes subsequent event code. */
  finishEncounter(party: number): void {
    this.prepareEncounterReturn(party)();
    this.pump();
  }
  private puppetStatuses(): FieldPuppetStatus[] {
    const result = Array<FieldPuppetStatus>(32).fill("sleep");
    for (const task of this.tasks)
      if (!task.done && task.slot !== null) result[task.slot] = task.state;
    return result;
  }
  private puppetControlContext() {
    // Legacy development fixtures have no source world-map/callback host.
    // Source lifecycle admission instead requires an explicit trusted port;
    // missing data there never inherits these development-only assumptions.
    if (this.options.puppetActors) {
      const context = this.options.puppetActors.controlContext();
      if (!context) throw new Error("Source puppet control context is unavailable");
      return context;
    }
    return { worldMapScript: false, callback: "absent" as const };
  }
  private preparePuppetCollision(enabled: boolean | null): () => void {
    if (enabled === null || !this.options.puppetActors) return () => {};
    const publish = this.options.puppetActors.prepareCollision(enabled);
    if (typeof publish !== "function") throw new Error("Invalid source puppet collision transaction");
    return publish;
  }
  private pump(frameDeltaSeconds = 0): void {
    if (this.stop || this.shopTask) return;
    // Native Integrator clocks main, then the 32 global tracks. Core.Clock
    // drains Next results before the following core gets its first instruction.
    // External treasure coroutines do not occupy the native main core.
    for (const task of this.tasks.filter((t) => t.treasureRoot)) {
      this.clockTask(task, frameDeltaSeconds);
      if (this.stop) return;
    }
    // A treasure coroutine can register the main script during this same host
    // frame. Discover it after that registration, without re-clocking a core.
    const main = this.tasks.find((t) => t.slot === null && !t.treasureRoot);
    if (main) this.clockTask(main, frameDeltaSeconds);
    if (this.stop) return;
    for (let slot = 0; slot < 32; slot++) {
      const task = this.tasks.find((t) => !t.done && t.slot === slot);
      if (task) this.clockTask(task, frameDeltaSeconds);
      if (this.stop) return;
    }
    if (main?.done) {
      if (this.treasureHandoffBlocked()) {
        this.block("Main script ended with an unfinished treasure task");
        return;
      }
      if (this.puppetLifecycle && !this.puppetLifecycle.finished) {
        try {
          const port = this.options.puppetActors!;
          const plan = projectFieldPuppetInitialization({ phase: "finish", script: this.puppetLifecycle.script, ...port.read() });
          const camera = this.prepareCameraEvent("finish", this.separateCameraInitialization(plan));
          const publish = port.prepare(plan);
          if (typeof publish !== "function") throw new Error("Invalid source puppet actor transaction");
          publish();
          camera();
          this.puppetLifecycle.finished = true;
        } catch (error) {
          this.block(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      if (this.cameraEventActive) {
        // Ordinary source Exit leaves Integrator.endCondition=0; other exit
        // mechanisms (map/battle) stop separately and retain their target.
        try { this.prepareCameraEvent("finish", false)(); }
        catch (error) { this.block(error instanceof Error ? error.message : String(error)); return; }
      }
      // Ready cores get this frame before main termination cancels their next
      // clock. Awake entries never start merely because main has ended.
      for (const task of this.tasks) if (task.slot !== null) task.done = true;
    }
    this.finishInteraction();
    this.finishMapEntry();
  }
  private clockTask(t: Task, frameDeltaSeconds: number): void {
    if (t.done || t.state !== "ready" || t.lastClock === this.time ||
        t.wait > 0 || this.dialogue?.task === t.id) return;
    t.lastClock = this.time;
    for (let budget = 0; budget < 4096; budget++) {
        if (t.done || t.wait > 0 || this.dialogue?.task === t.id) return;
        const actor = this.actors[t.actor];
        if (!actor && !this.hasEntity(t.actor)) {
          this.block(`缺少角色 ${t.actor}`);
          return;
        }
        // A movement suspends its own instruction, not every core currently
        // bound to that actor (in particular, the main core's dialogue/flags).
        if (actor?.motion && t.move) return;
        if (t.animationWait) {
          if (
            actor
              ? actor.animation?.playing
              : this.tileAnimations.isPlaying(t.actor)
          )
            return;
          t.animationWait = false;
        }
        if (t.puppetWait) {
          try {
            const result = fieldPuppetControlStep({ kind: t.puppetWait.kind === "finish-puppets" ? "finish" : "exec",
              firstClock: false, asynchronous: false, ...this.puppetControlContext(), slots: this.puppetStatuses() });
            this.preparePuppetCollision(result.collisionEnabled)();
            if (result.flow === "wait") return;
            t.puppetWait = null;
          } catch (error) {
            this.block(error instanceof Error ? error.message : String(error), t.puppetWait);
            return;
          }
        }
        if (t.fadeWait) {
          try {
            if (this.fader.poll(t.fadeWait.direction) === "wait") return;
            t.fadeWait = null;
          } catch (error) {
            this.block(error instanceof Error ? error.message : String(error), t.fadeWait);
            return;
          }
        }
        if (t.cameraLerp) {
          const motion = t.cameraLerp;
          try {
            if (!this.camera || t.actor !== this.cameraActorId) throw new Error("Camera motion lost its source actor binding");
            const next = this.camera.prepareLerp(motion.command, motion.progress, this.time / 1000);
            next.commit(); motion.progress = next.progress;
            if (next.flow === "wait") return;
            t.cameraLerp = null;
          } catch (error) {
            this.block(error instanceof Error ? error.message : String(error), motion.op); return;
          }
        }
        if (t.audioWait) {
          try {
            if (pollAudioReadiness(t.audioWait, this.bgm, this.content.bgm, this.options.audioReadiness) === "wait")
              return;
            t.audioWait = null;
          } catch (error) {
            this.block(error instanceof Error ? error.message : String(error), t.audioWait);
            return;
          }
        }
        if (t.treasure) {
          const site = t.treasure.site;
          try { this.advanceTreasure(t); }
          catch (error) {
            this.block(error instanceof Error ? error.message : String(error), site);
            return;
          }
          if (this.dialogue) return;
          continue;
        }
        if (t.move && t.remaining > 0) {
          if (!actor) {
            this.block("非角色实体不能移动");
            return;
          }
          const moveBlocker = actor.id === this.player.id
            ? this.options.movementBlocker?.(this.transportationId, false) ?? null
            : null;
          if (moveBlocker) {
            this.block(moveBlocker, t.move);
            return;
          }
          const d = DELTA[t.move.direction];
          let step: ReturnType<FieldConditionPort["prepareStep"]> | null = null;
          try {
            if (actor.id === this.player.id) step = this.preparePlayerStep();
            actor.animation?.move(t.move.direction, t.move.secondsPerCell);
          } catch (error) {
            this.block(
              error instanceof Error ? error.message : String(error),
              t.move,
            );
            return;
          }
          if (actor.id === this.player.id) this.pendingPlayerStep = step;
          actor.direction = t.move.direction;
          actor.motion = {
            from: { x: actor.x, y: actor.y },
            to: { x: actor.x + d.x, y: actor.y + d.y },
            duration: Math.round(t.move.secondsPerCell * 1000),
            elapsed: 0,
            manual: false,
          };
          t.remaining--;
          continue;
        }
        t.move = null;
        const op = this.content.scripts[t.script]?.[t.pc];
        if (!op) {
          this.block(`无效脚本位置 ${t.script}:${t.pc}`);
          return;
        }
        if (actor?.motion && ["move", "position", "look", "animation-play", "animation-cue"].includes(op.kind)) {
          this.block("Concurrent source actor movement arbitration is not implemented", op);
          return;
        }
        if (op.kind === "message" && this.messageWindow && this.messageWindow.task !== t.id) {
          this.block("Concurrent source message windows are not implemented", op);
          return;
        }
        if (t.pc < t.range.min || t.pc > t.range.max) {
          this.block("Field control flow leaves the source task range", op);
          return;
        }
        t.pc++;
        try {
          if (
            executeEventControl(
              op,
              this.eventState,
              t,
              this.content.scripts[t.script]!.length,
            )
          )
            continue;
        } catch (error) {
          this.block(
            error instanceof Error ? error.message : String(error),
            op,
          );
          return;
        }
        switch (op.kind) {
          case "source-presentation":
            try {
              if (executeSourcePresentation(op, this.eventState, this.options.sourcePresentation) === "end")
                t.done = true;
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "treasure-box":
            try {
              t.treasure = this.prepareTreasureTask(op, op);
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "roster":
            try {
              // AffectLeaderWithCondition returns immediately only when this
              // source Format explicitly disables KeepBadStatusVisual. Its
              // other branch needs an additional native entity handoff.
              if (op.command.kind === "join" && op.command.recovery &&
                  this.content.scriptSystemFlags?.[t.script]?.keepBadStatusVisual !== false)
                throw new Error("Roster recovery condition-visual context is unavailable");
              executeRosterLifecycleEvent(op, this.options.roster,
                (_members, appearance, setDummy) => this.preparePartyAppearance(appearance, setDummy));
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "party":
            try {
              executePartyEvent(op, this.options.party,
                (_members, appearance, setDummy) => this.preparePartyAppearance(appearance, setDummy));
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "inventory":
            try {
              executeInventoryEvent(
                op,
                this.eventState,
                this.options.inventory,
              );
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "owned-condition":
            try {
              executeOwnedConditionEvent(op, this.options.ownedConditions, (steps) => {
                if (!steps.length) return () => {};
                const visual = this.content.scriptSystemFlags?.[t.script];
                if (visual?.keepBadStatusVisual !== false)
                  throw new Error("Unknown or unsupported owned condition-visual context");
                if (!this.partyActors) throw new Error("Party actor refresh is unavailable");
                return this.partyActors.prepareSequence(steps,
                  (media, plan) => this.preparePartyRenderer(media, plan));
              });
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "animation-cue":
          case "animation-play":
            try {
              if (actor) {
                if (actor.mount)
                  throw new Error(
                    "Mounted actor animation dispatch is not implemented",
                  );
                if (!actor.animation)
                  throw new Error(
                    "Missing actor animation media " + actor.asset,
                  );
                const animation = actor.animation.clone();
                if (op.kind === "animation-cue")
                  animation.cue(op.animation, op.frame);
                else animation.play(op.animation, op.loop, op.speed);
                actor.animation = animation;
                t.animationWait = op.kind === "animation-play" && !op.loop;
              } else if (op.kind === "animation-cue")
                this.tileAnimations.cue(t.actor, op.frame);
              else {
                this.tileAnimations.play(t.actor, op.loop, op.speed);
                t.animationWait = !op.loop;
              }
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "bgm-ready":
          case "bgm-sync":
            try {
              if (pollAudioReadiness(op, this.bgm, this.content.bgm, this.options.audioReadiness) === "wait")
                t.audioWait = op;
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "bgm-play":
          case "bgm-stop":
          case "environment-play":
          case "environment-stop":
            try {
              const bus = op.kind.startsWith("environment-")
                ? this.environment
                : this.bgm;
              const media = op.kind.startsWith("environment-")
                ? this.content.environment
                : this.content.bgm;
              if (op.kind === "bgm-play" || op.kind === "environment-play")
                bus.play(op.track, op.channel, op.fade, op.seek, media);
              else bus.stop(op.channel, op.fade);
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "change-map":
            if (this.sourceMessage.active) {
              this.block("Source message must close before map handoff", op); return;
            }
            if (this.treasureHandoffBlocked()) {
              this.block("宝箱任务尚未完成，尚不支持并发切图", op);
              return;
            }
            this.stop = {
              kind: "map-transition",
              message: "正在载入地图…",
              site: op,
              request: op.request,
            };
            return;
          case "entities":
            try {
              this.activateGroup(op.group);
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "nop":
            break;
          case "exit":
            t.done = true;
            break;
          case "return":
          case "call":
            try {
              Object.assign(t, op.kind === "call"
                ? prepareFieldCall({ nextPc: t.pc, target: op.target, stack: t.stack, range: t.range })
                : prepareFieldReturn({ stack: t.stack, range: t.range }));
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "wait":
            t.wait = Math.ceil(op.seconds * 100);
            t.wait *= 10;
            break;
          case "puppet":
            try {
              const host = this.options.puppetActors, lifecycle = this.puppetLifecycle;
              const nextKind = this.content.scripts[t.script]?.[op.target + 1]?.kind;
              const plan = host && lifecycle ? projectFieldPuppetActorEntry({ ...host.read(), script: lifecycle.script,
                entityId: Number(op.actor), nextMnemonic: nextKind === "hide" ? "Hide" : nextKind ?? "unknown",
                leaderId: lifecycle.leaderId, assignments: lifecycle.assignments }) : null;
              if (plan?.skipEntry) {
                const publish = host!.prepare(plan);
                if (typeof publish !== "function") throw new Error("Invalid source puppet actor transaction");
                publish();
                if (plan.assignments) lifecycle!.assignments = plan.assignments;
                break;
              }
              const entry = prepareFieldPuppetEntry({ ...op, slots: this.puppetStatuses(),
                instructions: this.content.scripts[t.script]! });
              const publish = plan ? host!.prepare(plan) : () => {};
              if (typeof publish !== "function") throw new Error("Invalid source puppet actor transaction");
              const child = this.task(t.script, entry.pc, plan?.actor ??
                (this.camera && entry.actor === "0" ? this.cameraActorId : entry.actor));
              child.sourceEntityId = plan?.entityId ?? null;
              child.range = entry.range;
              child.slot = entry.slot;
              child.state = "awake";
              publish();
              if (plan?.assignments) lifecycle!.assignments = plan.assignments;
              this.tasks.push(child);
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "join": // Old authored fixtures; source compilation uses exec-puppets.
          case "exec-puppets":
          case "finish-puppets":
            try {
              const command = op.kind === "finish-puppets"
                ? { ...op, kind: "finish-puppets" as const }
                : { ...op, kind: "exec-puppets" as const,
                    asynchronous: op.kind === "exec-puppets" && op.asynchronous };
              const result = fieldPuppetControlStep({ kind: command.kind === "finish-puppets" ? "finish" : "exec",
                firstClock: true, asynchronous: command.kind === "exec-puppets" && command.asynchronous,
                ...this.puppetControlContext(), slots: this.puppetStatuses() });
              // Resolve and validate the whole starting batch before publishing
              // any Ready state or visibility change. No partial Exec on error.
              const ready = result.startSlots.map((slot) => {
                const child = this.tasks.find((other) => !other.done && other.slot === slot)!;
                let actor = child.actor;
                let binding: "present" | "absent" | "unknown";
                if (child.sourceEntityId !== null && this.options.puppetActors) {
                  const { catalog, context } = this.options.puppetActors.read();
                  const resolved = resolveFieldPuppetActor(catalog, context, child.sourceEntityId);
                  binding = resolved.actor === null ? "absent" : "present";
                  actor = resolved.actor ?? actor;
                } else binding = this.hasEntity(actor) ? "present" : "unknown";
                if (this.tileAnimations.has(actor) && this.hiddenEntities.has(actor))
                  throw new Error("Tile puppet Show lifecycle is not implemented");
                return { child, actor, plan: projectFieldPuppetReady(binding) };
              });
              const host = this.options.puppetActors;
              // Ready's Show(0) also writes the sprite-less dummy's active and
              // fade state. Prepare it with the single camera owner, before
              // publishing any actor, collision or task changes.
              const cameraShow = this.camera && ready.some((r) => r.plan.showActor && r.actor === this.cameraActorId)
                ? this.camera.prepareVisibility(true) : null;
              const publish = host && this.puppetLifecycle ? host.prepare({ leaderId: null,
                assignments: result.clearAssignments ? fieldPuppetAssignments() : null,
                effects: ready.filter((r) => r.plan.showActor && !(this.camera && r.actor === this.cameraActorId))
                  .map((r) => ({ kind: "show", actor: r.actor })) }) : () => {};
              if (typeof publish !== "function") throw new Error("Invalid source puppet Ready transaction");
              const publishCollision = this.preparePuppetCollision(result.collisionEnabled);
              publish();
              cameraShow?.commit();
              publishCollision();
              if (result.clearAssignments && this.puppetLifecycle) this.puppetLifecycle.assignments = fieldPuppetAssignments();
              for (const { child, actor, plan } of ready) {
                child.done = plan.status === "sleep";
                child.state = "ready";
                child.actor = actor;
                if (plan.showActor && !(this.camera && actor === this.cameraActorId) && !this.actors[actor]?.native) this.hiddenEntities.delete(actor);
              }
              if (result.flow === "wait") {
                t.puppetWait = command;
                return;
              }
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "position":
            if (this.camera && t.actor === this.cameraActorId) {
              try {
                if (!op.cameraCommand) throw new Error("Source camera SetPos operand shape is not admitted");
                this.camera.prepareSetPosition(op.cameraCommand).commit();
              } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
              break;
            }
            if (!actor) {
              this.block("非角色实体不能定位", op);
              return;
            }
            if (
              op.animation !== "" &&
              op.animation !== "Default" &&
              (!actor.asset || !this.content.characters[actor.asset]?.animations[op.animation])
            ) {
              this.block("尚未支持角色动画 " + op.animation, op);
              return;
            }
            if (actor.native) { this.block("Source actor SetPos body/provider chain is not yet admitted", op); return; }
            if (op.animation && actor.animation) {
              try {
                actor.animation.cue(op.animation, -1);
              } catch (error) {
                this.block(
                  error instanceof Error ? error.message : String(error),
                  op,
                );
                return;
              }
            }
            actor.x = op.x;
            actor.y = op.y;
            this.hiddenEntities.delete(actor.id);
            // The mounted development renderer still derives its pose from facing.
            if (!actor.animation && op.animation === "WalkL")
              actor.direction = "left";
            break;
          case "field-camera":
            try {
              if (!this.camera) throw new Error("Source field camera host is unavailable");
              this.camera.prepareSelect(op.command).commit();
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "field-camera-motion":
            try {
              if (!this.camera || t.actor !== this.cameraActorId)
                throw new Error("Source motion is only admitted for camera dummy 0");
              if (op.command.kind === "set-position") this.camera.prepareSetPosition(op.command).commit();
              else {
                const next = this.camera.prepareLerp(op.command, null, this.time / 1000);
                next.commit();
                if (next.flow === "wait") {
                  t.cameraLerp = { op, command: op.command, progress: next.progress }; return;
                }
              }
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "move":
            t.move = op;
            t.remaining = op.steps;
            break;
          case "look":
            if (!actor) {
              this.block("非角色实体不能转向", op);
              return;
            }
            try {
              const animation = actor.animation?.clone() ?? null;
              animation?.look(op.direction);
              actor.direction = op.direction;
              actor.animation = animation;
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "player-visibility":
            try {
              if (this.player.native) {
                this.options.puppetActors!.prepare({ leaderId: null, assignments: null,
                  effects: [{ kind: op.command.kind === "hide-player" ? "hide" : "show", actor: this.player.id }] })();
                break;
              }
              const plan = projectPlayerVisibility(op.command, {
                playerId: this.player.id,
                partyPlayerId: this.partyActors?.checkpoint().context.player.id ?? null,
                childEntityObject: this.playerVisibilityChild,
              }, this.hiddenEntities);
              // Keep the existing owner and publish only after all bindings and
              // child propagation dependencies have passed preparation.
              this.hiddenEntities.clear();
              for (const id of plan.hiddenEntities) this.hiddenEntities.add(id);
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "hide":
            if (this.camera && t.actor === this.cameraActorId) {
              try { this.camera.prepareVisibility(false).commit(); }
              catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
              break;
            }
            if (this.tileAnimations.has(t.actor)) {
              this.block(
                "Tile animation visibility lifecycle is not implemented",
                op,
              );
              return;
            }
            if (actor?.native) {
              try { this.options.puppetActors!.prepare({ leaderId: null, assignments: null,
                effects: [{ kind: "hide", actor: actor.id }] })(); }
              catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            } else this.hiddenEntities.add(t.actor);
            break;
          case "ride": {
            const rider = this.actors[op.actor];
            if (
              !rider ||
              op.vehicle !== 6 ||
              !this.content.entry.player.mount
            ) {
              this.block("未知骑乘对象", op);
              return;
            }
            rider.mount = this.content.entry.player.mount;
            rider.animation = null;
            break;
          }
          case "sound":
          case "sound-sync":
            // Explicit muted-development presentation lane, retained for later audio migration.
            this.presentationOmissions.push({
              site: op,
              kind: op.kind,
              soundId: op.kind === "sound" ? op.soundId : null,
            });
            break;
          case "field-fade":
            try {
              if (this.fader.start(op, frameDeltaSeconds) === "wait") {
                t.fadeWait = op;
                return;
              }
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "source-message":
            try {
              if (this.messageWindow || this.shopTask || this.treasureSceneState === "message")
                throw new Error("Source message conflicts with an occupied message window");
              if (!this.options.sourceMessageEffects) throw new Error("Source message entity-update host is unavailable");
              const next = this.sourceMessage.prepare(op), publish = this.options.sourceMessageEffects.prepare(next.effects);
              if (typeof publish !== "function") throw new Error("Invalid source message host transaction");
              publish(); next.commit();
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "message":
            if (this.sourceMessage.active) { this.block("Source message window is already occupied", op); return; }
            this.dialogue = {
              speaker: op.speaker,
              text: op.text,
              key: op.key,
              task: t.id,
            };
            return;
          case "encounter":
            if (this.treasureHandoffBlocked()) {
              this.block("宝箱任务尚未完成，尚不支持并发入战", op);
              return;
            }
            this.stop = {
              kind: "encounter",
              message: "此战斗尚未接入当前可玩片段。",
              site: op,
              party: op.party,
              continuation: op.continuation,
            };
            return;
          case "blocked":
            this.block(`${op.mnemonic}：${op.reason}`, op);
            return;
          default:
            this.block(`未知编译指令 ${op.kind}，需要重新编译内容`, op);
            return;
        }
        // Even a zero-duration source wait yields its core once. The next
        // opcode is reached on a later logical frame, never another scan pass.
        if (op.kind === "wait" || t.audioWait || t.animationWait) return;
    }
    this.block("脚本在一个逻辑步中未让出执行权");
  }
}
