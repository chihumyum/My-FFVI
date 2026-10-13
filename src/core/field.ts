import type {
  Direction,
  FieldContent,
  FieldEntity,
  FieldMessage,
  FieldManualMessage,
  Op,
  Point,
  Site,
  MapRequest,
} from "../field/types.js";
import {
  EventState,
  UnknownEventValue,
  executeEventControl,
  type EventStateSnapshot,
  type ScriptLocalFrame,
} from "./event-state.js";
import {
  executeInventoryEvent,
  type FieldInventoryPort,
  type FieldInventoryTransaction,
} from "./inventory-event.js";
import { executePartyEvent, type FieldPartyPort, type PartyAppearanceCandidate } from "./party.js";
import { executeOwnedConditionEvent, type FieldOwnedConditionPort } from "./owned-condition.js";
import { executeFieldRecoveryEvent, type FieldRecoveryPort } from "./field-recovery.js";
import { fieldInstructionRequirements, assessFieldRequirements,
  type FieldAdmissionContext } from "./field-content-admission.js";
import { executeSourcePresentation, cloneSourcePresentationContext, sourcePresentationCheckpoint,
  type SourcePresentationContext, type SourcePresentationPort } from "./source-presentation.js";
import { canonical } from "./canonical.js";
import { MESSAGE_VALUE_PATTERN, parseFieldMessageTemplate, fieldMessageNameReferences,
  fieldMessageTemplateSource, resolveFieldMessageTemplate } from "./field-message-template.js";
import type { FieldMessageNamesPort } from "./owned-message-names.js";
import { prepareBattleEventSharedReturn, type BattleEventSharedReturn } from "./battle-event-shared.js";
import { captureFieldEventCheckpoint, restoreFieldEventCheckpoint,
  type FieldEventCheckpoint } from "./field-event-checkpoint.js";
import { frameworkTransportationPresentation, FRAMEWORK_TRANSPORTATION_LIMITATIONS } from "./development-profile.js";
import { Transportations } from "./transportation.js";
import type { FieldTransportationPort } from "./transportation-state.js";
import type { FieldTransportationCommand } from "./field-transportation-command.js";
import { projectFieldTransportActors, projectFieldPuppetTransportationEffects,
  type FieldTransportActorOperation } from "./field-transport-actors.js";
import { requireFieldTransportPose } from "./field-transport-pose.js";
import { partyActorCameraOffset } from "./party-actors.js";
import { SourceMessageState, sourceMessageUpdateMask, type SourceMessageEffect } from "./source-message.js";
import { createFieldChoiceRequest, resolveFieldChoiceAnswer, type FieldChoiceAnswer,
  type FieldChoiceRequest } from "./field-choice.js";
import { prepareEventContextBranch } from "./event-context-branch.js";
import { prepareEventScriptTransition } from "./event-script-transition.js";
import type { FieldPuppetRosterPort, FieldPuppetRosterRead } from "./field-puppet-roster.js";
import { createNativeFieldActorProjection, createNativeFieldActorProjections, createNativeFieldPuppetActorsPort, readNativeFieldActors,
  prepareNativeFieldActorProjection, prepareNativeFieldActorState, type NativeFieldActorData, type NativeFieldActor } from "./field-native-actors.js";
import { projectNativeFieldPosition } from "./field-native-position.js";
import { prepareFieldActorMotionTick, prepareFieldScriptMove, projectFieldScriptLerp,
  type FieldActorMotion, type FieldScriptLerpProgress } from "./field-script-motion.js";
import { FieldEffects, FIELD_EFFECT_PARTICLE_UPDATE_ATTRIBUTE, fieldEffectAnimationLoopLimit,
  projectFieldEffectPlacement, type FieldEffectRuntimeHost, type FieldEffectState,
  type FieldEffectPrepared, type FieldEffectOperation } from "./field-effects.js";
import { FieldEffectMap } from "./field-effect-map.js";
import { fieldPuppetContextFromActors, type FieldActorFactoryCandidate, type FieldActorFactoryBindings, type FieldActorFactoryCatalog } from "./field-actor-factory.js";
import { captureFieldNativeCheckpoint, restoreFieldNativeCheckpoint,
  type FieldNativeCheckpoint, type FieldNativeCheckpointContext } from "./field-native-checkpoint.js";
import { prepareFieldNativeNpcGroup, fieldNativeNpcRetirement, fieldNativeNpcStandbyPosition, fieldNativeNpcSelectorBinding } from "./field-native-npc.js";
import { projectFieldPuppetCollision, projectFieldPuppetActorEffects, type FieldPuppetCollisionState, type FieldPuppetHostProviders } from "./field-puppet-effects.js";
import type { FieldPuppetActorCatalog, FieldPuppetActorContext, FieldPuppetControlContext } from "./field-puppet-actors.js";
import type { PartyActorPlan } from "./party-actors.js";
import type { FieldTreasurePort } from "./treasure-port.js";
import { treasureFlagRef, validateTreasureInventory, type TreasureBoxRequest } from "./treasure-inventory.js";
import { createTreasureTask, advanceTreasureTask, type TreasureTaskState, type TreasureTaskInput } from "./treasure-task.js";
import type { PartyActorCatalog } from "./party-actors.js";
import { FieldPartyActors, type FieldPartyActorCheckpoint, type FieldPartyActorRenderer,
  type FieldPartyActorPublication, type FieldPartyActorRenderStep,
  type FieldPartyActorRendererPublication } from "./field-party-actors.js";
import { prepareNativeFieldActorAppearance, type FieldNativeAnimationKeys } from "./field-native-appearance.js";
import { missingFieldPoses } from "./character-media.js";
import { executeRosterLifecycleEvent, type FieldRosterPort } from "./roster.js";
import type { FieldConditionPort } from "./field-conditions.js";
import { parseFrameworkWalkEncounterPolicy, type FrameworkWalkEncounterPolicy,
  type WalkEncounterPrepared } from "./walk-encounters.js";
import { projectFieldEntryContext } from "./field-entry-context.js";
import { requireMinimapMedia } from "./minimap.js";
import { validateFieldMoveAreas, fieldMoveAreas, findFieldMoveArea, type FieldMoveArea } from "./field-move-area.js";
import { StaticAudioState, type AudioSnapshot } from "./static-audio.js";
import { FieldSoundState, type SoundSnapshot } from "./field-sound.js";
import type { FieldSoundPresentation } from "./field-sound-presentation.js";
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
export type Motion = FieldActorMotion;
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
type FieldCheckpointState = {
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
  se: SoundSnapshot;
  fade: FieldFadeSnapshot | null;
  camera: FieldCameraState | null;
  native: {
    actors: FieldNativeCheckpoint;
    collision: FieldPuppetCollisionState;
    updateMask: number;
    cameraOffset: Point;
    completedScript: { name: string; leaderId: number | null; assignments: boolean[] } | null;
  } | null;
};
export type FieldCheckpoint = FieldCheckpointState & (
  { kind: "idle-field-v10" } | { kind: "event-field-v1"; execution: FieldEventCheckpoint }
);
export type GameEventSaveRequest = Readonly<{ id: string; site: Site }>;
/** Trusted source packages reconstruct this capability. Nothing in a saved
 * actor payload can supply prefab, script-control, material or media authority. */
export type FieldNativeRestoreDependencies = {
  factory: FieldActorFactoryCatalog;
  catalog: FieldPuppetActorCatalog;
  animationKeys: FieldNativeAnimationKeys;
  controlContext: FieldPuppetControlContext;
  providers(field: FieldGame): () => FieldPuppetHostProviders;
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
  cameraLerp: { op: Site; command: FieldCameraLerp;
    progress: FieldCameraLerpProgress } | null;
  scriptMove: Extract<Op, { kind: "field-script-motion" }> | null;
  scriptLerp: { op: Extract<Op, { kind: "field-script-motion" }>; progress: FieldScriptLerpProgress } | null;
  remaining: number;
  move: Extract<Op, { kind: "move" }> | null;
  animationWait: boolean;
  audioWait: Extract<Op, { kind: "bgm-ready" | "bgm-sync" }> | null;
  soundWait: { op: Extract<Op, { kind: "field-sound" }>; handle: number | null } | null;
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
      /** Explicit ordinary walking return; never a fabricated event script. */
      returnTo?: { kind: "field-idle" };
    };
export type Dialogue = FieldMessage & { task: number;
  manual?: FieldManualMessage & { page: number; availableAt: number; site: Site } };
export type FieldEncounterReturnState = {
  puppetRoster: FieldPuppetRosterRead;
  partyAppearance: PartyAppearanceCandidate | null;
};
export type FieldEncounterReturnPublication = (() => void) & {
  validate(): void;
  /** Owned publication contains only its already prepared synchronous writes. */
  commitWith(commitOwned: () => void): void;
};
// Input identity is deliberately outside the semantic/checkpoint state. A new
// FieldGame (including restore) cannot accept a callback from an older owner.
let nextChoiceNamespace = 1;
export type FieldGameOptions = {
  /** Explicit particle/material host. Content parsing never grants one. */
  fieldEffects?: FieldEffectRuntimeHost;
  /** World-owned lease; a prepared map never allocates another live pool. */
  fieldEffectMap?: FieldEffectMap;
  /** The private source-session candidate installs native actors before any
   * script/input. Suppresses temporary legacy NPC creation in that candidate. */
  nativeActorPreparation?: true;
  sourceMessageEffects?: { prepare(effects: readonly SourceMessageEffect[]): () => void };
  puppetActors?: FieldPuppetActorsPort;
  puppetRoster?: FieldPuppetRosterPort;
  audioReadiness?: AudioReadinessPort;
  soundPresentation?: FieldSoundPresentation;
  /** Immutable host admission, never inferred from absent source fields or saved
   * visibility. Missing capability keeps native child propagation unresolved. */
  playerVisibility?: Readonly<{ childEntityObject: "absent" | "unresolved" }>;
  sourcePresentation?: SourcePresentationPort;
  /** Read-only admission before any shop greeting or interaction is published. */
  shop?: { validate(groupId: number): void };
  ownedConditions?: FieldOwnedConditionPort;
  recovery?: FieldRecoveryPort;
  inventory?: FieldInventoryPort;
  /** Resolves source name references from the session's live or private draft
   * owner; the field never creates a separate name register. */
  messageNames?: FieldMessageNamesPort;
  treasure?: FieldTreasurePort;
  party?: FieldPartyPort;
  roster?: FieldRosterPort;
  fieldSteps?: FieldConditionPort;
  /** One session-owned development scheduler; this field keeps only a pending
   * transaction for its currently moving player, never a second RNG/counter. */
  walkEncounters?: { prepareStep(mapId: number, policy: FrameworkWalkEncounterPolicy): WalkEncounterPrepared };
  partyAppearance?: { catalog: PartyActorCatalog; current(): PartyAppearanceCandidate };
  transportation?: FieldTransportationPort;
  transportationTimestamp?: () => string;
  /** Read the current owned-state draft; unsupported step effects must not disappear. */
  movementBlocker?: (transportationId: number | null, manual: boolean) => string | null;
};
const contains = (e: FieldEntity, p: Point) =>
  p.x >= e.x && p.x < e.x + e.width && p.y >= e.y && p.y < e.y + e.height;
export class FieldGame {
  /** Actual provider composition for one instruction. This does not run its
   * transaction, resolve target owners, or certify an unexecuted script. */
  assessInstructionAdmission(op: Op, actorId = "-1001", refreshRequired?: boolean) {
    const requirements = fieldInstructionRequirements(op);
    if (!requirements.length)
      return assessFieldRequirements(requirements, { providers: {}, actorKind: "unknown" });
    const presence = (available: boolean) => available ? "available" as const : "missing" as const;
    const actor = this.actors[actorId];
    const actorKind = actorId === this.cameraActorId ? "camera" as const : this.effectBoard(actorId)
      ? "effect" as const : actor ? "actor" as const : "none" as const;
    const cameraMotion = !!this.camera && (op.kind !== "field-script-motion" ||
      op.command.kind === "lerp" && op.command.layer === 0 && op.command.animation === "");
    const legacyMove = op.kind === "field-script-motion" && op.command.kind === "move" && !!actor &&
      !actor.native && !this.options.nativeActorPreparation && !this.options.puppetActors &&
      !this.content.scriptPuppetContexts && op.command.animation === "" && op.command.speedId !== null;
    const actorMotion = legacyMove || !!(actor?.native && this.nativeActorProviders && this.camera &&
      this.content.cameraHost?.callbacks === "fresh-normal-field-v1");
    const context: FieldAdmissionContext = { actorKind, providers: {
      inventory: presence(typeof this.options.inventory?.prepare === "function"),
      messageNames: presence(typeof this.options.messageNames?.prepare === "function"),
      recovery: presence(typeof this.options.recovery?.prepare === "function"),
      ownedConditions: presence(typeof this.options.ownedConditions?.prepare === "function"),
      party: presence(typeof this.options.party?.prepare === "function"),
      roster: presence(typeof this.options.roster?.prepare === "function"),
      treasure: presence(!!this.options.treasure),
      transportation: presence(!!this.options.transportation),
      puppetRoster: presence(typeof this.options.puppetRoster?.current === "function"),
      partyActors: presence(!!this.partyActors),
      audioReadiness: presence(typeof this.options.audioReadiness?.isReady === "function"),
      soundPresentation: presence(typeof this.options.soundPresentation?.isPresented === "function"),
      actorMotion: presence(actorMotion), cameraMotion: presence(cameraMotion), effectMotion: "missing",
      eventSaveCompletion: "unknown", battleHandoff: "unknown",
    }, ...(refreshRequired === undefined ? {} : { refreshRequired }) };
    // A helper's source flag cannot stand in for the active event root.
    const visual = this.eventRootScript === null ? undefined : this.content.scriptSystemFlags?.[this.eventRootScript];
    if (visual?.keepBadStatusVisual !== undefined) context.keepBadStatusVisual = visual.keepBadStatusVisual;
    if (op.kind === "field-sound" && (op.command.kind === "sync" || op.command.kind === "stop")) {
      try { context.soundVoiceActive = this.se.isPlaying(this.eventState.read({
        category: "ScriptLocalVariable", index: op.command.handleSlot })); }
      catch { /* An unknown local bank remains a runtime validation boundary. */ }
    }
    return assessFieldRequirements(requirements, context);
  }
  private requireInstructionProviders(op: Op, actorId: string, refreshRequired?: boolean): void {
    // Already rejected source operations retain their original diagnostic.
    // No provider assessment can turn them into an admitted instruction.
    if (op.kind === "blocked") return;
    const admission = this.assessInstructionAdmission(op, actorId, refreshRequired);
    const blocked = admission.diagnostics.find(diagnostic => diagnostic.status === "blocked");
    if (blocked) throw new Error(blocked.reason);
  }
  /** A host preparation dependency, not a new voice or a load command. */
  get pendingBgmTracks() {
    const ids = new Set(this.tasks.filter((task) => !task.done && task.audioWait?.kind === "bgm-ready")
      .map((task) => (task.audioWait as Extract<Op, { kind: "bgm-ready" }>).track));
    return [...ids].map((id) => audioReadinessTrack(id, this.content.bgm));
  }
  get pendingAudioTracks() {
    const ids = new Set(this.tasks.flatMap(task => !task.done && task.soundWait?.op.command.kind === "ready"
      ? [task.soundWait.op.command.soundId] : []));
    return [...this.pendingBgmTracks, ...[...ids].map(id => this.soundTrack(id))];
  }
  private soundTrack(id: number) {
    const track = this.content.se?.tracks[id];
    if (!track) throw new Error("Missing SE media " + id);
    return structuredClone(track);
  }
  private soundResourceReady(id: number): boolean {
    const track = this.soundTrack(id), host = this.options.audioReadiness;
    if (!host || typeof host.isReady !== "function") throw new Error("Missing SE resource readiness provider");
    const ready = host.isReady(track);
    if (typeof ready !== "boolean") throw new Error("Invalid SE resource readiness observation");
    return ready;
  }
  /** Host loading freezes logical time before even a very short sound can
   * expire. A decode callback never writes an event or finishes a task. */
  get soundReady(): boolean {
    return this.se.voices.every(voice => {
      if (!this.soundResourceReady(voice.track)) return false;
      const host = this.options.soundPresentation;
      if (!host || typeof host.isPresented !== "function") throw new Error("Missing SE presentation provider");
      const presented = host.isPresented(voice, this.soundTrack(voice.track));
      if (typeof presented !== "boolean") throw new Error("Invalid SE presentation observation");
      return presented;
    });
  }
  readonly soundExecutions: { site: Site; command: Extract<Op, { kind: "field-sound" }>["command"];
    handle: number | null }[] = [];
  private currentTransportationId: number | null;
  get transportationId(): number | null { return this.currentTransportationId; }
  get transportationPresentation() { return frameworkTransportationPresentation(this.content.developmentProfile); }
  /** Observable development departures, separate from source state and saves. */
  readonly transportationExecutions: { site: Site; command: FieldTransportationCommand; currentId: number | null;
    omissions: readonly string[] }[] = [];
  private transportationExecuting = false;
  private mapScrollOffset: Readonly<Point>;
  get cameraOffset(): Readonly<Point> { return this.mapScrollOffset; }
  private readonly camera: FieldCameraHost | null;
  private readonly effects: FieldEffects | FieldEffectMap | null;
  /** Read-only logical projection; not a particle/RNG checkpoint codec. */
  get fieldEffectsSnapshot(): FieldEffectState | null { return this.effects?.snapshot() ?? null; }
  get effectMapHandoffBlocker(): string | null {
    if (this.options.fieldEffectMap?.active) return null;
    return this.effects ? "Field effect map retirement/particle checkpoint host is unresolved" : null;
  }
  private effectBoard(id: string) { return this.effects?.snapshot().boards.find((board) => board.id === id); }
  private effectPlaying(id: string): boolean {
    const state = this.effects?.snapshot(), board = state?.boards.find((board) => board.id === id);
    if (!state || !board) throw new Error("Unknown effect animation target " + id);
    return state.players.find((player) => player.cameraId === board.cameraId)!.playing;
  }
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
  private nativeActorBindings: FieldActorFactoryBindings | null = null;
  private nativeActorProviders: (() => FieldPuppetHostProviders) | null = null;
  private nativeRuntime: { catalog: FieldPuppetActorCatalog; animationKeys: FieldNativeAnimationKeys | null;
    controlContext: FieldPuppetControlContext; mapLifecycle: {
      factory: FieldActorFactoryCatalog;
    } | null } | null = null;
  get nativeActorRuntime() { return this.nativeRuntime && structuredClone(this.nativeRuntime); }
  /** A detached transition candidate, assembled from the current actor owner.
   * No second mutable actor collection is retained between map transactions. */
  get nativeActorCandidate(): FieldActorFactoryCandidate | null {
    if (!this.nativeActorBindings || !this.camera) return null;
    const camera = this.camera.snapshot();
    const retired = new Set(fieldNativeNpcRetirement(Object.values(this.actors).flatMap((a) => a.native ? [a.native] : [])));
    const snapshot = readNativeFieldActors(this.actors, { id: this.cameraActorId,
      position: camera.dummy.position, layer: camera.dummy.layer });
    return {
      snapshot: { ...snapshot, actors: snapshot.actors.filter((actor) => !retired.has(actor.id)) },
      bindings: structuredClone(this.nativeActorBindings),
      assets: Object.values(this.actors).filter((a) => a.native && !retired.has(a.id)).map((a) => ({
        id: a.id, fieldAssetId: a.native!.fieldAssetId, charaZOffset: a.native!.charaZOffset,
      })),
    };
  }
  /** Map handoff stale checks must include map-local actors even though those
   * instances are intentionally excluded from the destination factory. */
  get nativeActorStateFingerprint(): string | null {
    if (!this.nativeActorBindings || !this.camera) return null;
    const camera = this.camera.snapshot(), snapshot = readNativeFieldActors(this.actors,
      { id: this.cameraActorId, position: camera.dummy.position, layer: camera.dummy.layer });
    return canonical({ snapshot: { ...snapshot, actors: snapshot.actors.map((actor) =>
      ({ ...actor, animation: actor.animation?.snapshot() ?? null })) },
      metadata: Object.values(this.actors).filter((actor) => actor.native).map((actor) => ({
        id: actor.id, motion: actor.motion, steps: actor.steps, fieldAssetId: actor.native!.fieldAssetId,
        charaZOffset: actor.native!.charaZOffset, mapObjectAsset: actor.native!.mapObjectAsset ?? null,
        scope: actor.native!.scope ?? null, updateAttribute: actor.native!.updateAttribute ?? null,
      })) });
  }
  private collisionSwitches: FieldPuppetCollisionState = projectFieldPuppetCollision(true);
  private entityUpdateMask = 3;
  get updateAttributeMask(): number { return this.entityUpdateMask; }
  get collisionState(): Readonly<FieldPuppetCollisionState> { return { ...this.collisionSwitches }; }
  isEntityVisible(id: string): boolean {
    const board = this.effectBoard(id);
    if (board) return board.activeSelf && board.fadeAlpha > 0;
    const native = this.actors[id]?.native;
    return native ? native.entity.visible : !this.hiddenEntities.has(id);
  }
  /** Install the prepared factory directly into the existing actor collection.
   * A script alias is never an actor identity, and the camera stays separate. */
  installNativeActors(candidate: FieldActorFactoryCandidate, catalog: FieldPuppetActorCatalog,
    providers: () => FieldPuppetHostProviders, controlContext: FieldPuppetControlContext,
    animationKeys?: FieldNativeAnimationKeys,
    mapLifecycle?: NonNullable<FieldGame["nativeRuntime"]>["mapLifecycle"]): void {
    if (this.tasks.length || this.nativeActorBindings || this.options.puppetActors || !this.camera || !this.partyActors ||
        !this.options.partyAppearance || !this.options.puppetRoster ||
        Object.keys(this.actors).some((id) => id !== this.player.id))
      throw new Error("Native actor installation requires a fresh bound field without legacy NPC actors");
    if (candidate.bindings.player !== this.player.id || candidate.snapshot.camera?.id !== this.cameraActorId)
      throw new Error("Native factory does not match the existing player/camera identities");
    const projected = createNativeFieldActorProjections(candidate, this.content.cameraHost!.mapRange,
      this.options.partyAppearance.catalog, this.transportationPresentation);
    const player = projected.find((a) => a.id === this.player.id);
    if (!player || player.x !== this.player.x || player.y !== this.player.y ||
        player.layer !== this.player.layer || player.direction !== this.player.direction || player.asset !== this.player.asset)
      throw new Error("Native factory player disagrees with prepared PointIn");
    const lifecycle = mapLifecycle ? structuredClone(mapLifecycle) : null;
    const groups = new Set(this.entityList.filter((entity) => [6, 17].includes(entity.kind)).map((entity) => entity.nativeNpc?.group));
    for (const group of groups) {
      const entities = this.entityList.filter((entity) => [6, 17].includes(entity.kind) && entity.nativeNpc?.group === group);
      projected.push(...this.prepareNativeNpcActors(entities, group, projected.map((actor) => actor.id), lifecycle, providers()));
    }
    this.publishNativeActors(projected, candidate.bindings, catalog, providers, controlContext, animationKeys, lifecycle);
  }
  /** Publication common to first creation and validated Web restore. Restore
   * supplies reconstructed actors directly and never runs NPC/factory Init. */
  private publishNativeActors(projected: NativeFieldActor[], sourceBindings: FieldActorFactoryBindings,
    catalog: FieldPuppetActorCatalog, providers: () => FieldPuppetHostProviders,
    controlContext: FieldPuppetControlContext, animationKeys: FieldNativeAnimationKeys | undefined,
    lifecycle: NonNullable<FieldGame["nativeRuntime"]>["mapLifecycle"]): void {
    const bindings = structuredClone(sourceBindings), puppetCatalog = structuredClone(catalog);
    const detachedActors = Object.fromEntries(projected.map((actor) => [actor.id, actor]));
    let published = false;
    const port = createNativeFieldPuppetActorsPort({
      readActors: () => published ? this.actors : detachedActors,
      readCamera: () => { const s = this.camera!.snapshot();
        return { id: this.cameraActorId, position: s.dummy.position, layer: s.dummy.layer }; },
      readProviders: providers,
      readContext: () => ({ catalog: puppetCatalog, checkpoint: this.partyActors!.checkpoint(), bindings,
        ...this.options.puppetRoster!.current(), entities: this.entityList.filter((e) => (published ? this.actors : detachedActors)[e.id])
          .flatMap((e) => {
            if (!e.nativeNpc) throw new Error("Native map selector requires its source NPC identity");
            const binding = fieldNativeNpcSelectorBinding(e.nativeNpc);
            return binding ? [binding] : [];
          }), restorePartyInstruction: "absent" }),
      controlContext: () => structuredClone(controlContext),
      ...(this.transportationPresentation && animationKeys ? { transportation: {
        read: () => ({ catalog: this.options.partyAppearance!.catalog, characters: this.content.characters,
          animationKeys, presentation: this.transportationPresentation! }),
        prepare: (operations: readonly FieldTransportActorOperation[]) => this.partyActors!.prepareTransportation({ operations }),
      } } : {}),
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
    this.nativeActorBindings = bindings;
    this.nativeActorProviders = providers;
    this.nativeRuntime = { catalog: puppetCatalog, controlContext: structuredClone(controlContext),
      animationKeys: animationKeys ? structuredClone(animationKeys) : null, mapLifecycle: lifecycle };
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
  /** Controllers read regions from the cumulative map entity owner. Queries
   * return detached projections; neither the renderer nor a controller can
   * mutate the trusted definition or keep a second region registry. */
  get moveAreas(): readonly FieldMoveArea[] {
    if (!this.entityList.some((entity) => entity.kind === 13)) return [];
    if (!this.content.cameraHost) throw new Error("Field move area map range is unavailable");
    return fieldMoveAreas(this.entityList, this.content.cameraHost.mapRange);
  }
  getMoveArea(linkObjectId: number): FieldMoveArea | null {
    checkpointInteger(linkObjectId, -0x80000000, 0x7fffffff);
    if (!this.entityList.some((entity) => entity.kind === 13)) return null;
    if (!this.content.cameraHost) throw new Error("Field move area map range is unavailable");
    return findFieldMoveArea(this.entityList, linkObjectId, this.content.cameraHost.mapRange);
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
  private readonly choiceNamespace = nextChoiceNamespace++;
  private nextChoice = 1;
  private pendingChoice: { request: FieldChoiceRequest; task: Task;
    op: Extract<Op, { kind: "choice" }>; answer: number | null } | null = null;
  get choice(): FieldChoiceRequest | null {
    return this.pendingChoice?.answer === null ? this.pendingChoice.request : null;
  }
  get choicePending(): boolean { return this.pendingChoice !== null; }
  private treasureSceneState: "player" | "message" = "player";
  /** A close=false source message keeps its window during the post-input yield. */
  get messageWindow(): Dialogue | null { return this.dialogue ?? this.retainedMessage; }
  stop: Stop | null = null;
  time = 0;
  private tasks: Task[] = [];
  private nextEventSave = 1;
  private pendingEventSave: { request: GameEventSaveRequest; task: Task;
    barrier: { script: string; pc: number } } | null = null;
  get eventSaveRequest(): GameEventSaveRequest | null { return this.pendingEventSave?.request ?? null; }
  /** Execute owns SystemFlags for the whole event. ChangeScript replaces only
   * processing/name/custom animations and must not adopt the target flags. */
  private eventRootScript: string | null = null;
  private scriptHook: { script: string; pc: number; range: FieldTaskRange;
    locals: ScriptLocalFrame } | null = null;
  private puppetLifecycle: { name: string; script: FieldPuppetScriptContext; leaderId: number | null;
    assignments: boolean[]; finished: boolean } | null = null;
  private remainder = 0;
  private nextTask = 1;
  private synchronizedEntry: boolean | null = null;
  private entryTaskStarted = false;
  private pendingPlayerStep: ReturnType<FieldConditionPort["prepareStep"]> | null = null;
  private pendingWalkEncounter: WalkEncounterPrepared | null = null;
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
      try {
        const presentation = this.prepareMessagePresentation(shop.close);
        presentation.validate();
        shop.stage = "farewell";
        this.dialogue = { ...presentation.message, task: shop.id };
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
        return false;
      }
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
    restoringNative = false,
    readonly se: FieldSoundState = new FieldSoundState(),
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
    this.currentTransportationId = content.entry.transportationId ?? null;
    const offset = content.entry.cameraOffset ?? { x: 0, y: 0 };
    checkpointKeys(offset, "x,y");
    if (!Number.isFinite(Math.fround(offset.x)) || !Number.isFinite(Math.fround(offset.y)))
      throw new Error("Invalid field entry camera offset");
    this.mapScrollOffset = Object.freeze({ x: Math.fround(offset.x), y: Math.fround(offset.y) });
    if (this.transportationId !== null)
      checkpointInteger(this.transportationId, 1, 0x7fffffff);
    this.tileAnimations = new TileAnimationState(content.map);
    this.openTriggers = new OpenTriggerState(this.tileAnimations);
    this.entityList = [...content.map.entities];
    validateFieldMoveAreas(this.entityList);
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
      animation: restoringNative ? null : this.initialAnimation(p.asset, p.direction, p.mount),
    };
    if (content.entry.playerVisible !== undefined && typeof content.entry.playerVisible !== "boolean")
      throw new Error("Unknown field entry player visibility");
    if (content.entry.playerVisible === false) this.hiddenEntities.add("-1001");
    if (!options.nativeActorPreparation) Object.assign(this.actors, this.createActors(this.entityList));
    this.partyActors = content.entry.partyActors && options.partyAppearance
      ? new FieldPartyActors(options.partyAppearance.catalog, content.entry.partyActors, this.transportationId,
        this.transportationPresentation) : null;
    if (this.partyActors) {
      const media = this.partyActors.playerMedia();
      if (media.asset !== this.player.asset || media.mount !== (this.player.mount || null))
        throw new Error("Field entry does not match source player appearance");
    }
    if (cameraState && !content.cameraHost) throw new Error("Saved camera cannot grant an unbound camera host");
    if (content.cameraHost && this.entityList.some((entity) => entity.kind === 15))
      throw new Error("Camera ChangeOffset trigger provider is unresolved");
    this.camera = content.cameraHost ? new FieldCameraHost(content.cameraHost, this.cameraPorts(), cameraState) : null;
    const treasures = restoringNative ? [] : this.prepareTreasureInitialization(this.entityList);
    this.tileAnimations.register(this.entityList);
    this.initializeTreasures(treasures);
    this.openTriggers.initialize(this.entityList, this.player);
    // All local dependencies are prepared before an external effect host can
    // publish. Native CreateMapEntity creates default first; ordering among
    // event groups is not yet bound, so no event-group FX can be lazily added.
    const eventEffects = Object.entries(groups ?? {}).some(([name, group]) =>
      name !== "entity_default" && group.entities.some((entity) => entity.kind === 11));
    if (eventEffects) throw new Error("Event-group field effect creation order/lifecycle is unresolved");
    const sourceEffects = this.defaultProperties.filter((entity) => entity.kind === 11);
    if (this.entityList.filter((entity) => entity.kind === 11).some((entity) => !sourceEffects.includes(entity)))
      throw new Error("Field effect pool is not bound to the source default group");
    this.effects = null;
    if (sourceEffects.length) {
      if (options.nativeActorPreparation && !options.fieldEffectMap)
        throw new Error("Source field effect allocation requires a transactional native map lifecycle provider");
      if (!content.fieldEffects) throw new Error("Field effect particle/material catalog is unavailable");
      if (!content.cameraHost) throw new Error("Field effect source map range is unavailable");
      if (!options.fieldEffectMap && typeof options.fieldEffects?.observe !== "function")
        throw new Error("Field effect playback observation host is unavailable");
      options.fieldEffectMap?.assertCatalog(content.fieldEffects);
      const ids = new Set<string>();
      const operations: FieldEffectOperation[] = sourceEffects.map((entity) => {
        if (!entity.effect || ids.has(entity.id) || this.actors[entity.id] || entity.id === this.cameraActorId ||
            canonical(entity.effect.source) !== canonical(entity.source))
          throw new Error("Unbound or duplicate source field effect identity");
        ids.add(entity.id);
        const placement = projectFieldEffectPlacement(entity.effect, { range: content.cameraHost!.mapRange,
          tileMapPresent: true, standbyAnchor: content.nativeNpcStandby ? fieldNativeNpcStandbyPosition(content.nativeNpcStandby) : null }, entity.layer);
        return { kind: "create", id: entity.id, definition: entity.effect, position: placement.position };
      });
      operations.push({ kind: "setup", registeredBoards: sourceEffects.map((entity) => entity.id), groupUpdate: false });
      const effects = options.fieldEffectMap ?? new FieldEffects(content.fieldEffects, options.fieldEffects);
      effects.prepare(operations).commit();
      this.effects = effects;
    }
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
  private prepareNativeNpcActors(entities: readonly FieldEntity[], group: string | undefined,
    existingActorIds: readonly string[], lifecycle: NonNullable<FieldGame["nativeRuntime"]>["mapLifecycle"],
    providers: FieldPuppetHostProviders): NativeFieldActor[] {
    const npcs = entities.filter((entity) => [6, 17].includes(entity.kind));
    if (!npcs.length) return [];
    if (!lifecycle || !this.content.cameraHost || !this.options.partyAppearance)
      throw new Error("Native map-local actor factory is unresolved");
    const definitions = npcs.map((entity) => {
      if (entity.nativeNpcBlockers?.length) throw new Error(entity.nativeNpcBlockers[0]!);
      const definition = entity.nativeNpc;
      if (!definition || definition.entityId !== entity.id || definition.group !== group ||
          definition.objectType !== entity.kind || definition.asset.asset !== entity.asset ||
          definition.geometry.layer !== entity.layer || canonical(definition.source) !== canonical(entity.source))
        throw new Error("Native NPC is not bound to its source entity group");
      return definition;
    });
    return prepareFieldNativeNpcGroup({ definitions, factory: lifecycle.factory, characters: this.content.characters,
      mapRange: this.content.cameraHost.mapRange, providers, existingActorIds,
      ...(this.content.nativeNpcStandby ? { standbyAnchorPosition: fieldNativeNpcStandbyPosition(this.content.nativeNpcStandby) } : {}),
    }).actors.map((actor) => createNativeFieldActorProjection(actor, this.content.cameraHost!.mapRange,
      this.options.partyAppearance!.catalog, this.transportationPresentation));
  }
  /** Source SetEventEntityGroup appends entities; it does not replace existing groups. */
  private activateGroup(name: string): void {
    const group = this.content.map.groups?.[name];
    if (!group) throw new Error(`缺少实体组 ${name}`);
    if (this.activeGroups.has(name))
      throw new Error(`重复实体组激活尚未恢复：${name}`);
    if (group.blockers.length)
      throw new Error(`${name}：${group.blockers[0]!.reason}`);
    validateFieldMoveAreas([...this.entityList, ...group.entities]);
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
    if (this.options.nativeActorPreparation && !this.nativeActorBindings)
      throw new Error("Source field actors have not been installed");
    const actors = this.nativeActorBindings
      ? Object.fromEntries(this.prepareNativeNpcActors(group.entities, name, Object.keys(this.actors),
        this.nativeRuntime!.mapLifecycle, this.nativeActorProviders!()).map((actor) => [actor.id, actor]))
      : this.createActors(group.entities);
    const treasures = this.prepareTreasureInitialization(group.entities);
    const effectSetup = this.effects?.prepare([{ kind: "setup", registeredBoards:
      this.defaultProperties.filter((entity) => entity.kind === 11).map((entity) => entity.id), groupUpdate: true }]);
    const properties = [...this.defaultProperties, ...group.entities];
    const publish = () => {
      // register validates a private cells/regions draft before its two pointer
      // swaps. No FX host validation may run after those bindings become live.
      this.tileAnimations.register(group.entities);
      this.entityList.push(...group.entities);
      this.initializeTreasures(treasures);
      Object.assign(this.actors, actors);
      this.activeGroups.add(name);
      this.currentProperties = properties;
      return true;
    };
    if (effectSetup) effectSetup.commitWith(publish);
    else publish();
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
    const messageViews = new Map<string, ReturnType<FieldGame["prepareMessagePresentation"]>>();
    for (const effect of [...next.effects, ...next.state.remaining]) {
      if (effect.kind === "message") {
        messageViews.set(effect.key, this.prepareMessagePresentation(resolveMessage(effect.key)));
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
    for (const view of messageViews.values()) view.validate();
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
          this.eventRootScript = effect.name;
          this.scriptHook = null;
          this.tasks.push(this.task(effect.name, 0, "-1001"));
          break;
        // The compiler resolves the source parameter into the bound message;
        // there is no mutable global substitution register in the Web renderer.
        case "grant": case "set-message-value": break;
        case "scene-state": this.treasureSceneState = effect.state; break;
        case "message":
          this.dialogue = { ...messageViews.get(effect.key)!.message, task: t.id };
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
  private preparePartyAppearance(appearance: PartyAppearanceCandidate | undefined, setDummy = true): FieldPartyActorPublication {
    if (!this.partyActors || !appearance) throw new Error("Party actor refresh is unavailable");
    return this.partyActors.prepare(appearance, this.partyRenderer(), setDummy);
  }
  get partyMenuBlocker(): string | null {
    if (!this.menuReady) return "请在地图空闲时调整编队。";
    return !this.partyActors || !this.options.partyAppearance ? "当前地图的编队外观刷新尚未接入。" : null;
  }
  /** A thin menu entry into the same actor owner used by party events. No
   * fallback actor, media or camera capability is granted by opening a menu. */
  prepareMenuPartyAppearance(appearance: PartyAppearanceCandidate): FieldPartyActorPublication {
    const blocker = this.partyMenuBlocker;
    if (blocker) throw new Error(blocker);
    return this.preparePartyAppearance(appearance, true);
  }
  private partyRenderer(): FieldPartyActorRenderer {
    return this.player.native
      ? { prepareBatch: (steps) => this.prepareNativePartyRenderer(steps) }
      : (media, plan) => this.preparePartyRenderer(media, plan);
  }
  private prepareNativePartyRenderer(steps: readonly FieldPartyActorRenderStep[]) {
    if (!this.nativeActorProviders || !this.nativeRuntime?.animationKeys || !this.options.partyAppearance || !this.camera)
      throw new Error("Native party appearance source providers are unavailable");
    const before = this.mapScrollOffset;
    let offset = before;
    for (const step of steps) {
      if (step.plan.cameraOffset !== null) {
        const next = step.plan.cameraOffset;
        checkpointKeys(next, "x,y");
        if (!Number.isFinite(Math.fround(next.x)) || !Number.isFinite(Math.fround(next.y)))
          throw new Error("Invalid native appearance camera offset");
        offset = Object.freeze({ x: Math.fround(next.x), y: Math.fround(next.y) });
      }
    }
    const appearance = prepareNativeFieldActorAppearance({
      readActors: () => this.actors, readCatalog: () => this.options.partyAppearance!.catalog,
      readCharacters: () => this.content.characters, readProviders: this.nativeActorProviders,
      readAnimationKeys: () => this.nativeRuntime!.animationKeys!,
      ...(this.transportationPresentation ? { transportationPresentation: this.transportationPresentation } : {}),
    }, steps);
    return {
      validate: () => {
        if (this.mapScrollOffset !== before) throw new Error("Stale native appearance camera offset");
        appearance.validate();
      },
      commit: () => { appearance.commit(); this.mapScrollOffset = offset; },
    };
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
  private get fieldActivityBusy(): boolean {
    return (
      this.tasks.some((t) => !t.done) ||
      this.sourceMessage.active ||
      !!this.dialogue ||
      !!this.pendingChoice ||
      !!this.shopTask ||
      this.treasureSceneState === "message" ||
      this.openTriggers.busy ||
      (this.interaction?.waitUntil ?? 0) > this.time
    );
  }
  get busy(): boolean { return this.fieldActivityBusy || !!this.stop; }
  /** Stable interaction does not require a particle/RNG save codec. Keep the
   * actor, script and presentation gates even when FX prohibit checkpointing. */
  private get idleFieldReady(): boolean {
    return (
      (!this.options.puppetActors || !!(this.nativeActorBindings && this.nativeRuntime?.mapLifecycle &&
        this.nativeRuntime.animationKeys && this.nativeActorProviders && this.partyActors && this.camera)) &&
      !this.cameraEventActive && (!this.puppetLifecycle || this.puppetLifecycle.finished) &&
      (!this.options.fieldEffectMap || this.options.fieldEffectMap.active) &&
      this.sourcePresentationContext?.advertisementOpeningFader !== "present" &&
      this.synchronizedEntry !== false &&
      !this.fieldActivityBusy &&
      !this.fader.active &&
      !this.interaction &&
      Object.values(this.actors).every((a) => a.motion === null)
    );
  }
  get menuReady(): boolean { return !this.stop && this.idleFieldReady; }
  get checkpointReady(): boolean {
    return this.menuReady && !this.effects && !this.options.fieldEffectMap?.hasHistory;
  }
  get sourcePresentationContext(): SourcePresentationContext | null {
    return cloneSourcePresentationContext(this.options.sourcePresentation?.context() ?? null);
  }
  private nativeCheckpointContext(bindings: FieldActorFactoryBindings, factory: FieldActorFactoryCatalog,
    providers: FieldPuppetHostProviders): FieldNativeCheckpointContext {
    if (!this.partyActors || !this.options.partyAppearance || !this.content.cameraHost)
      throw new Error("Native checkpoint requires bound party, media and camera owners");
    const npcs = this.entityList.filter((entity) => [6, 17].includes(entity.kind)).map((entity) => {
      const npc = entity.nativeNpc;
      if (entity.nativeNpcBlockers?.length || !npc || npc.entityId !== entity.id ||
          npc.objectType !== entity.kind || npc.asset.asset !== entity.asset || npc.geometry.layer !== entity.layer ||
          canonical(npc.source) !== canonical(entity.source) || !this.activeGroups.has(npc.group))
        throw new Error("Native checkpoint NPC is not bound to an active source group");
      return npc;
    });
    return { mapRange: this.content.cameraHost.mapRange, bindings, factory,
      partyCatalog: this.options.partyAppearance.catalog, partyCheckpoint: this.partyActors.checkpoint(),
      characters: this.content.characters, npcs, providers,
      ...(this.transportationPresentation ? { transportationPresentation: this.transportationPresentation } : {}) };
  }
  private nativeCheckpoint(continuation = false): FieldCheckpoint["native"] {
    if (!this.nativeActorBindings) return null;
    if (!this.nativeRuntime?.mapLifecycle || !this.nativeActorProviders || !this.nativeRuntime.animationKeys)
      throw new Error("Native actor checkpoint source capabilities are incomplete");
    const lifecycle = this.puppetLifecycle;
    if (lifecycle && ((!continuation && !lifecycle.finished) ||
        canonical(lifecycle.script) !== canonical(this.content.scriptPuppetContexts?.[lifecycle.name])))
      throw new Error("Native script lifecycle is not stably bound to its source");
    return { actors: captureFieldNativeCheckpoint(this.actors, this.nativeCheckpointContext(
      this.nativeActorBindings, this.nativeRuntime.mapLifecycle.factory, this.nativeActorProviders())),
      collision: { ...this.collisionSwitches }, updateMask: this.entityUpdateMask,
      cameraOffset: { ...this.cameraOffset }, completedScript: lifecycle?.finished ? {
        name: lifecycle.name, leaderId: lifecycle.leaderId, assignments: [...lifecycle.assignments] } : null };
  }
  checkpoint(): FieldCheckpoint {
    if (!this.checkpointReady)
      throw new Error("Cannot save during field movement or an event");
    return this.captureCheckpoint();
  }
  private captureCheckpoint(execution?: FieldEventCheckpoint): FieldCheckpoint {
    return {
      ...(execution ? { kind: "event-field-v1" as const, execution } : { kind: "idle-field-v10" as const }),
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
      actors: this.nativeActorBindings ? [] : Object.values(this.actors).map(({ motion: _, animation, native, ...actor }) => {
        if (native || actor.layer === null || actor.direction === null || actor.asset === null)
          throw new Error("Native actors require their own stable field codec");
        return { ...actor, layer: actor.layer, direction: actor.direction, asset: actor.asset,
          animation: animation?.snapshot() ?? null };
      }),
      tiles: this.tileAnimations.checkpoint(),
      doors: this.openTriggers.checkpoint(),
      bgm: this.bgm.snapshot(),
      environment: this.environment.snapshot(),
      se: this.se.snapshot(),
      fade: this.fader.snapshot(),
      camera: this.cameraSnapshot,
      native: this.nativeCheckpoint(execution !== undefined),
    };
  }
  /** A barrier owns one quiescent main core. Other live coroutine registers
   * need their own codecs before a content package may save through them. */
  private requireEventSaveBoundary(task: Task): void {
    if (this.stop || this.effects || this.options.fieldEffectMap?.hasHistory ||
        this.options.fieldEffectMap && !this.options.fieldEffectMap.active ||
        this.sourcePresentationContext?.advertisementOpeningFader === "present" ||
        this.fader.active || this.sourceMessage.active || this.messageWindow ||
        this.pendingChoice || this.shopTask || this.treasureSceneState !== "player" ||
        this.openTriggers.busy || this.interaction || this.pendingPlayerStep ||
        Object.values(this.actors).some((actor) => actor.motion !== null) ||
        this.tasks.some((other) => other !== task && !other.done) ||
        task.done || task.slot !== null || task.treasureRoot || task.state !== "ready" ||
        task.wait !== 0 || task.puppetWait || task.fadeWait || task.cameraLerp ||
        task.scriptMove || task.scriptLerp || task.remaining !== 0 || task.move ||
        task.animationWait || task.audioWait || task.soundWait || task.treasure ||
        this.options.puppetActors && !this.nativeActorBindings)
      throw new Error("Event save requires a quiescent main task with supported field owners");
  }
  private eventContinuation(task: Task, barrier: { script: string; pc: number }): FieldEventCheckpoint {
    this.requireEventSaveBoundary(task);
    if (!this.eventRootScript) throw new Error("Event save has no root script");
    const lifecycle = this.puppetLifecycle;
    if (lifecycle?.finished) throw new Error("Event save cannot resume a completed puppet lifecycle");
    return captureFieldEventCheckpoint({ barrier, main: { id: task.id, script: task.script, pc: task.pc,
      stack: [...task.stack], actor: task.actor, sourceEntityId: task.sourceEntityId, range: { ...task.range } },
      eventRootScript: this.eventRootScript,
      scriptHook: this.scriptHook && { script: this.scriptHook.script, pc: this.scriptHook.pc,
        range: { ...this.scriptHook.range }, locals: this.eventState.exportScriptLocalFrame(this.scriptHook.locals) },
      puppetLifecycle: lifecycle && { name: lifecycle.name, leaderId: lifecycle.leaderId,
        assignments: [...lifecycle.assignments], finished: false },
      cameraEventActive: this.cameraEventActive, entryTaskStarted: this.entryTaskStarted,
    }, { content: this.content, eventState: this.eventState.snapshot(), actorIds: Object.keys(this.actors),
      nextTask: this.nextTask, time: this.time, entrySynchronized: this.synchronizedEntry });
  }
  private requestEventSave(task: Task, op: Extract<Op, { kind: "event-save" }>): void {
    if (this.pendingEventSave) throw new Error("An event save is already pending");
    const barrier = { script: task.script, pc: task.pc - 1 };
    // Fully validate before exposing an asynchronous host request.
    this.captureCheckpoint(this.eventContinuation(task, barrier));
    const site = Object.freeze({ script: op.script, index: op.index, source: Object.freeze({ ...op.source }) });
    const request = Object.freeze({ id: `event-save:${this.choiceNamespace}:${this.nextEventSave++}`, site });
    this.pendingEventSave = { task, barrier, request };
  }
  eventCheckpoint(request: GameEventSaveRequest): FieldCheckpoint {
    const pending = this.pendingEventSave;
    if (!pending || pending.request !== request) throw new Error("Stale event save request");
    return this.captureCheckpoint(this.eventContinuation(pending.task, pending.barrier));
  }
  /** ACK alone never clocks the VM, emits rewards, or runs a completion callback. */
  acknowledgeEventSave(request: GameEventSaveRequest): void {
    if (!this.pendingEventSave || this.pendingEventSave.request !== request)
      throw new Error("Stale event save acknowledgement");
    this.pendingEventSave = null;
  }
  /** Rebuild dependencies from trusted content without replaying initialization or triggers. */
  static restore(
    content: FieldContent,
    raw: FieldCheckpoint,
    options: FieldGameOptions = {},
    native?: FieldNativeRestoreDependencies,
  ): FieldGame {
    if (options.puppetActors)
      throw new Error("Source puppet host checkpoints require a bound actor/camera/collision codec");
    if (options.fieldEffectMap?.hasHistory || content.map.entities.some((entity) => entity.kind === 11) ||
        Object.values(content.map.groups ?? {}).some((group) => group.entities.some((entity) => entity.kind === 11)))
      throw new Error("Field effect particle/RNG checkpoint codec is unresolved");
    const s = structuredClone(raw);
    checkpointKeys(
      s,
      "kind,contentHash,time,remainder,nextTask,transportationId,entrySynchronized,partyActors,sourcePresentation,eventState,activeGroups,hiddenEntities,openedTreasures,actors,tiles,doors,bgm,environment,se,fade,camera,native" +
        (s.kind === "event-field-v1" ? ",execution" : ""),
    );
    if (!["idle-field-v10", "event-field-v1"].includes(s.kind) || s.contentHash !== content.contentHash)
      throw new Error("Field checkpoint source/version mismatch");
    const transportationProfile = frameworkTransportationPresentation(content.developmentProfile);
    if (transportationProfile && native && options.transportation) {
      if (s.transportationId === null || !s.partyActors)
        throw new Error("Saved transportation requires its native party owner");
      const transports = new Transportations(options.transportation.catalog), identity = transports.identity(s.transportationId);
      if (identity.type !== 1 && !(identity.id === 6 && identity.type === 12 && identity.assetId === 38) ||
          canonical(s.partyActors.context.currentTransport) !== canonical({ id: identity.id,
            typeId: identity.type, fieldAssetId: identity.assetId }) ||
          !options.transportation.read().some((record) => record.id === identity.id) ||
          new EventState(s.eventState).read(transports.releaseFlagRef(identity.id)) !== 1)
        throw new Error("Saved transportation identity, party or availability mismatch");
    } else if (s.transportationId !== (content.entry.transportationId ?? null))
      throw new Error("Field checkpoint source/version mismatch");
    const presentation = sourcePresentationCheckpoint(options.sourcePresentation?.context() ?? null);
    if (canonical(sourcePresentationCheckpoint(s.sourcePresentation)) !== canonical(presentation))
      throw new Error("Field checkpoint source presentation context mismatch");
    // Only an explicit continuation can preserve an unfinished entry script.
    if (content.entry.synchronization ?
        s.entrySynchronized !== true && !(s.kind === "event-field-v1" && s.entrySynchronized === false) :
        s.entrySynchronized !== null)
      throw new Error("Field checkpoint entry synchronization mismatch");
    checkpointNumber(s.time);
    checkpointNumber(s.remainder, 0, 10);
    checkpointInteger(s.nextTask, 1);
    if (s.remainder >= 10) throw new Error("Invalid field remainder");
    if ((s.fade !== null) !== (content.entry.fade !== undefined))
      throw new Error("Field checkpoint cannot grant a missing fade host");
    if ((s.camera !== null) !== (content.cameraHost !== undefined))
      throw new Error("Field checkpoint cannot grant or discard a camera host");
    if ((s.native !== null) !== (native !== undefined) || options.nativeActorPreparation && !native)
      throw new Error("Field checkpoint native source dependencies are unavailable or changed");
    const next = new FieldGame(
      content,
      new EventState(s.eventState),
      StaticAudioState.restore(s.bgm, content.bgm),
      StaticAudioState.restore(s.environment, content.environment),
      { ...options, ...(native ? { nativeActorPreparation: true } : {}) },
      FieldFadeState.restore(s.fade),
      s.camera ?? undefined,
      native !== undefined,
      FieldSoundState.restore(s.se, content.se),
    );
    checkpointIds(s.activeGroups);
    const initial = [...next.activeGroups];
    if (initial.some((id, n) => s.activeGroups[n] !== id))
      throw new Error("Initial field groups changed in checkpoint");
    for (const id of s.activeGroups.slice(initial.length)) {
      if (native) next.restoreNativeGroup(id);
      else next.activateGroup(id);
    }
    if (next.partyActors) {
      if (!s.partyActors) throw new Error("Missing saved party appearances");
      next.partyActors.restore(s.partyActors);
      if (s.partyActors.context.currentTransport?.id !== s.transportationId)
        throw new Error("Saved party and field transportation identities disagree");
      next.currentTransportationId = s.transportationId;
      const media = next.partyActors.playerMedia();
      next.requirePlayerMedia(media.asset, media.mount);
      Object.assign(next.player, media);
    } else if (s.partyActors !== null) throw new Error("Unbound saved party appearances");
    if (native) next.restoreNativeOwner(s.native!, native);
    checkpointIds(s.hiddenEntities);
    if (s.hiddenEntities.some((id) => !next.hasEntity(id) || (next.camera && id === next.cameraActorId) || next.actors[id]?.native))
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
    if (native && s.actors.length) throw new Error("Duplicate native actor ownership in checkpoint");
    if (!native) checkpointSameIds(
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
    next.entryTaskStarted = s.entrySynchronized === true;
    if (s.kind === "event-field-v1") {
      const execution = restoreFieldEventCheckpoint(s.execution, { content, eventState: next.eventState.snapshot(),
        actorIds: Object.keys(next.actors), nextTask: s.nextTask, time: s.time, entrySynchronized: s.entrySynchronized });
      if (s.native?.completedScript) throw new Error("Event continuation cannot also own a completed script");
      const main = execution.main, task = next.task(main.script, main.pc, main.actor, main.id);
      Object.assign(task, { stack: [...main.stack], range: { ...main.range },
        sourceEntityId: main.sourceEntityId, lastClock: s.time });
      next.tasks = [task];
      next.eventRootScript = execution.eventRootScript;
      next.scriptHook = execution.scriptHook && { ...execution.scriptHook,
        locals: next.eventState.importScriptLocalFrame(execution.scriptHook.locals) };
      next.puppetLifecycle = execution.puppetLifecycle && { ...execution.puppetLifecycle,
        script: structuredClone(content.scriptPuppetContexts![execution.puppetLifecycle.name]!) };
      next.cameraEventActive = execution.cameraEventActive;
      next.entryTaskStarted = execution.entryTaskStarted;
      next.requireEventSaveBoundary(task);
    }
    return next;
  }
  /** Re-register immutable group definitions for their saved ordering only.
   * NPC playback/positions, treasure state and tile state come from codecs;
   * ActivateGroup/Init/Look and source event callbacks must not run here. */
  private restoreNativeGroup(name: string): void {
    const group = this.content.map.groups?.[name];
    if (!group || this.activeGroups.has(name) || group.blockers.length)
      throw new Error("Unknown or blocked saved native entity group");
    validateFieldMoveAreas([...this.entityList, ...group.entities]);
    if (group.entities.some((entity) => entity.kind === 11 || entity.kind === 15))
      throw new Error("Saved native group has unresolved effect/camera lifecycle");
    if (group.entities.some((entity) => entity.kind === 18)) requireMinimapMedia(group.entities, this.content.minimap);
    const ids = new Set([this.player.id, ...this.entityList.map((entity) => entity.id)]);
    for (const entity of group.entities) {
      if (ids.has(entity.id)) throw new Error("Saved native entity identity collision");
      ids.add(entity.id);
    }
    this.tileAnimations.register(group.entities);
    this.entityList.push(...group.entities);
    this.activeGroups.add(name);
    this.currentProperties = [...this.defaultProperties, ...group.entities];
  }
  private restoreNativeOwner(saved: NonNullable<FieldCheckpoint["native"]>, source: FieldNativeRestoreDependencies): void {
    checkpointKeys(saved, "actors,collision,updateMask,cameraOffset,completedScript");
    checkpointKeys(saved.collision, "mapColliders,entityCollision,interactiveObservation");
    if (canonical(saved.collision) !== canonical(projectFieldPuppetCollision(saved.collision.mapColliders)))
      throw new Error("Saved native collision switches disagree");
    if (saved.updateMask !== 3 && saved.updateMask !== 9) throw new Error("Unknown saved entity update mask");
    checkpointKeys(saved.cameraOffset, "x,y");
    for (const value of Object.values(saved.cameraOffset))
      if (!Number.isFinite(value) || Math.fround(value) !== value) throw new Error("Invalid saved native camera offset");
    const origin = this.content.entry.partyActors?.context;
    if (!origin || !this.camera || !this.partyActors || !Array.isArray(origin.conditionResidents))
      throw new Error("Missing native checkpoint immutable source identities");
    const bindings: FieldActorFactoryBindings = { player: origin.player.id,
      partyPuppets: origin.puppets.map((p) => p!.id), otherParties: origin.multiParty.map((p) => p.actor!.id),
      residents: origin.conditionResidents.map((r) => ({ assetId: r.characterId, actor: `native:resident:${r.characterId}` })) };
    let lifecycle: FieldGame["puppetLifecycle"] = null;
    if (saved.completedScript !== null) {
      const s = saved.completedScript;
      checkpointKeys(s, "name,leaderId,assignments");
      const script = this.content.scriptPuppetContexts?.[s.name];
      if (typeof s.name !== "string" || !script || !this.content.scripts[s.name] ||
          !Array.isArray(s.assignments) || s.assignments.length !== 5 || s.assignments.some((v) => typeof v !== "boolean"))
        throw new Error("Unbound saved completed puppet lifecycle");
      if (s.leaderId !== null) checkpointInteger(s.leaderId, -1004, -1001);
      if (script.skipInitialize !== (s.leaderId === null))
        throw new Error("Saved puppet leader does not match its source lifecycle");
      lifecycle = { name: s.name, script: structuredClone(script), leaderId: s.leaderId,
        assignments: [...s.assignments], finished: true };
    }
    const providers = source.providers(this);
    const actors = restoreFieldNativeCheckpoint(saved.actors,
      this.nativeCheckpointContext(bindings, source.factory, providers()));
    this.publishNativeActors(actors, bindings, source.catalog, providers, source.controlContext,
      source.animationKeys, { factory: structuredClone(source.factory) });
    this.collisionSwitches = { ...saved.collision };
    this.entityUpdateMask = saved.updateMask;
    this.mapScrollOffset = Object.freeze({ ...saved.cameraOffset });
    this.puppetLifecycle = lifecycle;
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
    let encounter: WalkEncounterPrepared | null;
    let movementAnimation: ActorAnimation | null;
    try {
      step = this.preparePlayerStep();
      movementAnimation = p.animation?.clone() ?? null;
      movementAnimation?.move(direction, 0.24);
      encounter = this.prepareWalkEncounterStep();
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error));
      return false;
    }
    this.pendingPlayerStep = step;
    this.pendingWalkEncounter = encounter;
    p.animation = movementAnimation;
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
  private prepareWalkEncounterStep(): WalkEncounterPrepared | null {
    if (!this.content.walkEncounters || !this.menuReady || this.scriptHook ||
        this.hasUnfinishedNativeEncounterActivity()) return null;
    const policy = parseFrameworkWalkEncounterPolicy(this.content.walkEncounters);
    if (this.transportationId === null)
      throw new Error("Walking encounters require a known transportation identity");
    if (!policy.transportationIds.includes(this.transportationId)) return null;
    const mapId = this.content.map.identity?.mapId;
    if (mapId === undefined || !this.options.walkEncounters)
      throw new Error("Walking encounters require a bound map and scheduler owner");
    return this.options.walkEncounters.prepareStep(mapId, policy);
  }
  private prepareActorScriptLerp(actor: Actor, op: Extract<Op, { kind: "field-script-motion" }>,
    progress: FieldScriptLerpProgress | null): { flow: "next" | "wait"; progress: FieldScriptLerpProgress } {
    if (op.command.kind !== "lerp" || !actor.native || !this.nativeActorProviders || !this.camera ||
        this.content.cameraHost?.callbacks !== "fresh-normal-field-v1")
      throw new Error("Source actor Lerp requires the bound native actor and map providers");
    if (this.content.cameraHost.loop.horizontal || this.content.cameraHost.loop.vertical)
      throw new Error("Source actor Lerp loop-map provider is unavailable");
    const command = structuredClone(op.command), map = this.content.cameraHost.mapRange;
    let result: ReturnType<typeof projectFieldScriptLerp> | null = null;
    const publish = prepareNativeFieldActorProjection({
      readActors: () => this.actors, readProviders: this.nativeActorProviders,
      readCamera: () => { const state = this.camera!.snapshot();
        return { id: this.cameraActorId, position: state.dummy.position, layer: state.dummy.layer }; },
    }, (snapshot, providers) => {
      result = projectFieldScriptLerp(snapshot, providers, actor.id, command, map, progress, this.time / 1000);
      return result.snapshot;
    });
    // The projection runs during prepare and validation, before any publication.
    const prepared = result as ReturnType<typeof projectFieldScriptLerp> | null;
    if (!prepared) throw new Error("Missing prepared source actor Lerp");
    publish();
    return { flow: prepared.flow, progress: prepared.progress };
  }
  private startScriptMove(actor: Actor, op: Extract<Op, { kind: "field-script-motion" }>): void {
    if (op.command.kind !== "move" || !actor.native || !this.nativeRuntime ||
        !this.nativeActorProviders || !this.camera || this.content.cameraHost?.callbacks !== "fresh-normal-field-v1")
      throw new Error("Source Move requires an ordinary bound native actor");
    const entity = actor.native.entity;
    requireFieldTransportPose(entity, this.transportationPresentation);
    if (actor.motion)
      throw new Error("Source Move riding or concurrent movement provider is unavailable");
    if (actor.id === this.player.id)
      throw new Error("Actual-player source Move requires its movement-state magnification provider");
    if (this.collisionSwitches.mapColliders || this.collisionSwitches.entityCollision)
      throw new Error("Source Move with active collision requires the native raycast provider");
    if (actor.layer === null || actor.layer > 2 || !actor.animation)
      throw new Error("Source Move actor position or animation media is unavailable");
    const command = op.command;
    // Ordinary FieldEntity ctor has magnification 1. The actual player has a
    // separate MoveTo override and was explicitly excluded above.
    const plan = prepareFieldScriptMove(command, actor, { loop: this.content.cameraHost.loop, magnification: 1 });
    // Empty SearchSimple route leaves the entity untouched, but the caller
    // still observes Move's mandatory first-clock Wait.
    if (plan.points.length === 0) return;
    const animation = actor.animation.clone();
    animation.move(command.direction, plan.animationSecondsPerCell, command.animation || undefined);
    animation.frame();
    const motion: Motion = { from: { x: actor.x, y: actor.y }, to: { ...plan.points[0]! },
      duration: plan.secondsPerCell * 1000, elapsed: 0, manual: false,
      route: { points: plan.points, index: 0, pendingSegment: false, direction: command.direction,
        animation: command.animation, animationSecondsPerCell: plan.animationSecondsPerCell } };
    // A supplied animation name deliberately preserves directionVector.
    if (command.animation === "") actor.direction = command.direction;
    actor.animation = animation;
    actor.motion = motion;
  }
  confirm(): void {
    // Confirm is not a choice response. Even an answered request waits for its
    // own interpreter clock before another input can dismiss the next message.
    if (this.stop || this.pendingChoice) return;
    if (this.dialogue) {
      if (this.dialogue.manual) {
        const current = this.dialogue, manual = current.manual!,
          task = this.tasks.find(t => t.id === current.task && !t.done);
        if (this.time < manual.availableAt) return;
        try {
          if (!task || task.state !== "ready") throw new Error("Ordinary source Msg lost its task owner");
          if (manual.page + 1 < manual.pages.length) {
            const page = manual.page + 1;
            this.dialogue = { ...current, text: manual.pages[page]!,
              manual: { ...manual, page, availableAt: this.time + 10 } };
            return;
          }
          const publish = manual.after === "close" ? this.prepareDialogueMask(12) : () => {};
          if (this.dialogue !== current) throw new Error("Stale ordinary source Msg completion");
          publish();
          this.retainedMessage = manual.after === "close" ? null : current;
          this.dialogue = null;
          task.lastClock = -1;
        } catch (error) {
          this.block(error instanceof Error ? error.message : String(error), manual.site);
          return;
        }
        this.pump();
        return;
      }
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
      } else this.retainedMessage = task && this.content.scripts[task.script]?.[task.pc]?.kind === "choice"
        ? this.dialogue : null;
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
    let openingMessage: ReturnType<FieldGame["prepareMessagePresentation"]> | null = null;
    try {
      if (action.kind === "talk") openingMessage = this.prepareMessagePresentation(action.message);
      else if (action.kind === "shop") {
        if (action.start) openingMessage = this.prepareMessagePresentation(action.start);
        // Farewell is a required continuation of this interaction. Admit its
        // dependencies before allowing transactions; closeShop prepares a new
        // view from the current owner instead of retaining these entry names.
        if (action.close) this.prepareMessagePresentation(action.close).validate();
      }
      openingMessage?.validate();
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error), site);
      return;
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
      if (openingMessage) this.dialogue = { ...openingMessage.message, task: id };
    } else this.dialogue = { ...openingMessage!.message, task: 0 };
  }
  /** Source selection callbacks write the shared zero-based result. Only the
   * issuing task may consume completion, on its next ordinary logical clock;
   * input never clocks unrelated puppet tasks or an immediately following quiz. */
  choose(requestId: string, answer: FieldChoiceAnswer): boolean {
    const pending = this.pendingChoice;
    if (this.stop || !pending || pending.answer !== null || pending.request.id !== requestId ||
        pending.task.done || pending.task.state !== "ready" || !this.tasks.includes(pending.task)) return false;
    const index = resolveFieldChoiceAnswer(pending.request, answer);
    if (index === null) return false;
    this.eventState.write({ category: "MessageSelection", index: 0 }, index);
    pending.answer = index;
    return true;
  }
  private prepareDialogueMask(group: 8 | 12): () => void {
    if (!this.options.sourceMessageEffects && (this.options.puppetActors || this.nativeActorBindings))
      throw new Error("Ordinary source Msg entity-update host is unavailable");
    const before = this.entityUpdateMask,
      effects: SourceMessageEffect[] = [{ kind: "entity-update-group", group, invokeCallback: false }],
      publish = this.options.sourceMessageEffects
        ? this.options.sourceMessageEffects.prepare(effects)
        : () => {
          if (this.entityUpdateMask !== before) throw new Error("Stale ordinary message update group");
          this.entityUpdateMask = sourceMessageUpdateMask(group);
        };
    if (typeof publish !== "function") throw new Error("Invalid ordinary message host transaction");
    return publish;
  }
  /** Source text and its typed references are one content record. Prepare a
   * detached name view, then validate it together with the window publication;
   * neither the renderer nor a cached field value resolves character names. */
  private prepareMessagePresentation(message: FieldMessage, pages: readonly string[] = [message.text]) {
    if (typeof message.key !== "string" || !message.key || typeof message.speaker !== "string" ||
        !Array.isArray(pages) || pages.some(page => typeof page !== "string") ||
        message.text !== pages[0] || (message.alignment !== undefined && message.alignment !== "center"))
      throw new Error("Invalid field message presentation");
    const identity = canonical({ message, pages }), beforeWindow = this.messageWindow, beforeTime = this.time;
    const validateContent = () => {
      if (canonical({ message, pages }) !== identity || this.messageWindow !== beforeWindow || this.time !== beforeTime)
        throw new Error("Stale field message content preparation");
    };
    const raw = message.template, plain: FieldMessage = { key: message.key, text: message.text, speaker: message.speaker,
      ...(message.alignment === undefined ? {} : { alignment: message.alignment }) };
    if (raw === undefined) {
      if ([...pages, message.speaker].some(value => [...value.matchAll(MESSAGE_VALUE_PATTERN)].length))
        throw new Error("Source message value requires a compiled template");
      return { message: structuredClone(plain), pages: [...pages], validate: validateContent };
    }
    const template = parseFieldMessageTemplate(raw), source = fieldMessageTemplateSource(template);
    if (canonical(source.pages) !== canonical(pages) || source.speaker !== message.speaker)
      throw new Error("Source message template/text binding mismatch");
    if (!this.options.messageNames) throw new Error("Source message character name owner is unavailable");
    const names = this.options.messageNames.prepare(fieldMessageNameReferences(template));
    const resolved = resolveFieldMessageTemplate(template, names.names);
    return { message: { ...structuredClone(plain), text: resolved.pages[0]!, speaker: resolved.speaker },
      pages: resolved.pages, validate: () => { validateContent(); names.validate(); } };
  }
  private beginManualDialogue(op: Extract<Op, { kind: "message" }>, task: Task): void {
    const manual = op.manual;
    if (!manual || !Array.isArray(manual.pages) || manual.pages.length === 0 ||
        manual.pages.some(page => typeof page !== "string" || page.length === 0 || /<|\\/.test(page)) ||
        op.text !== manual.pages[0] || !["frame", "none"].includes(manual.window) ||
        !["top", "middle", "bottom"].includes(manual.anchor) || !["close", "message", "choice"].includes(manual.after))
      throw new Error("Invalid ordinary source Msg document");
    if (this.sourceMessage.active || this.shopTask || this.treasureSceneState === "message")
      throw new Error("Ordinary source Msg conflicts with an occupied message manager");
    const before = this.messageWindow, presentation = this.prepareMessagePresentation(op, manual.pages),
      prepared: Dialogue = { ...presentation.message, task: task.id,
      manual: { ...structuredClone(manual), pages: presentation.pages, page: 0, availableAt: this.time + 10,
        site: { script: op.script, index: op.index, source: structuredClone(op.source) } } },
      publish = this.prepareDialogueMask(8);
    if (this.messageWindow !== before) throw new Error("Stale ordinary source Msg preparation");
    presentation.validate();
    publish();
    this.retainedMessage = null;
    this.dialogue = prepared;
  }
  private finishChoice(t: Task): void {
    const pending = this.pendingChoice;
    if (!pending || pending.task !== t || pending.answer === null)
      throw new Error("Field choice completion lost its task owner");
    if (!pending.op.retainMessage) {
      const effects: SourceMessageEffect[] = [{ kind: "entity-update-group", group: 12, invokeCallback: false }];
      // Source native instances need their bound entity-update transaction.
      // Legacy field actors already belong to this FieldGame's mask owner.
      if (!this.options.sourceMessageEffects && (this.options.puppetActors || this.nativeActorBindings))
        throw new Error("Source choice message entity-update host is unavailable");
      const publish = this.options.sourceMessageEffects
        ? this.options.sourceMessageEffects.prepare(effects)
        : () => { this.entityUpdateMask = sourceMessageUpdateMask(12); };
      if (typeof publish !== "function") throw new Error("Invalid choice message host transaction");
      publish();
      this.retainedMessage = null;
    } else if (this.retainedMessage?.manual) {
      // Select's own source successor now owns the handoff decision. The
      // preceding Msg may have retained this same window for the choice.
      this.retainedMessage = { ...this.retainedMessage,
        manual: { ...this.retainedMessage.manual, after: "message" } };
    }
    this.pendingChoice = null;
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
    if (this.pendingEventSave) return;
    this.remainder += milliseconds;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.stop || this.pendingEventSave) continue;
      try { if (!this.soundReady) continue; }
      catch (error) { this.block(error instanceof Error ? error.message : String(error)); return; }
      let effects: FieldEffectPrepared | undefined;
      try {
        if (this.effects && (this.entityUpdateMask & FIELD_EFFECT_PARTICLE_UPDATE_ATTRIBUTE) !== 0) {
          effects = this.effects.prepareTick(0.01);
          effects.validate();
        }
      } catch (error) { this.block(error instanceof Error ? error.message : String(error)); return; }
      effects?.commit();
      this.bgm.advance(10, this.content.bgm);
      this.environment.advance(10, this.content.environment);
      this.se.advance(10, this.content.se);
      this.tileAnimations.advance(10);
      this.openTriggers.advance();
      this.time += 10;
      this.fader.advance(0.01);
      this.sourceMessage.advance(0.01);
      let entered = false;
      let walkParty: number | null = null;
      for (const a of Object.values(this.actors)) {
        // Source fresh player, party puppets and residents have attribute 2.
        // Map NPC SetProperty can choose 10 and needs a distinct factory host.
        // Message group 8 has mask 9; event group 12 has mask 3. Camera (10),
        // tile animation (42), VM and the global fader continue separately.
        if (a.native && (this.entityUpdateMask & (a.native.updateAttribute ?? 2)) === 0) continue;
        try {
          const m = a.motion;
          if (!m) {
            if (a.animation?.playing) {
              const animation = a.animation.clone();
              animation.advance(10);
              a.animation = animation;
            }
            continue;
          }
          // Every potentially failing animation/coordinate calculation happens
          // on a private candidate. In particular a stale owned step must not
          // publish the native endpoint (or even advance its movement timer).
          const next = prepareFieldActorMotionTick(m, a.animation, 10);
          const step = next.completedSegment && a.id === this.player.id ? this.pendingPlayerStep : null;
          const encounter = next.completedSegment && a.id === this.player.id && m.manual
            ? this.pendingWalkEncounter : null;
          if (encounter?.partyId !== null && encounter?.partyId !== undefined)
            checkpointInteger(encounter.partyId, 1, 0x7fffffff);
          const omission = step?.result.soundId !== null && step?.result.soundId !== undefined
            ? { site: { script: "field-condition-step", index: a.steps, source: this.content.map.source },
              kind: "sound" as const, soundId: step.result.soundId } : null;
          const publish = () => {
            step?.commit();
            // Native properties below are prevalidated accessors onto this same
            // entity. Legacy actors publish their cell only at a completed step.
            if (a.native || next.completedSegment) { a.x = next.point.x; a.y = next.point.y; }
            a.animation = next.animation;
            a.motion = next.motion;
            if (next.completedSegment) {
              if (a.id === this.player.id) {
                this.pendingPlayerStep = null;
                this.pendingWalkEncounter = null;
              }
              if (omission) this.presentationOmissions.push(omission);
              a.steps++;
              if (m.manual) entered = true;
            }
          };
          if (encounter) {
            encounter.commitWith(publish);
            walkParty = encounter.partyId;
          } else publish();
        } catch (error) {
          this.block(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      for (const t of this.tasks) t.wait = Math.max(0, t.wait - 10);
      const cellEvent = entered ? this.enter() : false;
      this.pump(0.01);
      // This explicit development rule gives destination events priority. A
      // selected roll is consumed even when that event finishes synchronously;
      // it must not become a delayed surprise battle after the event returns.
      if (walkParty !== null && !cellEvent && this.menuReady && !this.scriptHook &&
          !this.hasUnfinishedNativeEncounterActivity())
        this.stop = { kind: "encounter", party: walkParty, returnTo: { kind: "field-idle" },
          site: null, message: "普通步行遭遇" };
    }
  }
  /** True also covers a synchronously completed destination event. */
  private enter(): boolean {
    if (!this.collisionSwitches.interactiveObservation) return false;
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
      return false;
    }
    if (transitions[0]) {
      const next = transitions[0].destinationLayer;
      if (next === null || !this.content.map.collisions[next]) {
        this.block("未支持的地图层");
        return false;
      }
      p.layer = next;
    }
    const events = hits.filter((e) => e.kind === 2 || e.kind === 3);
    if (events.length > 1) {
      this.block("同格触发器顺序尚未验证");
      return true;
    }
    const e = events[0];
    if (!e) return false;
    if (e.kind === 3) {
      const site = {
        script: e.script ?? "map-transition",
        index: 0,
        source: e.source,
      };
      if (!e.destination) {
        this.block("缺少跨地图目标", site);
        return true;
      }
      if (this.effectMapHandoffBlocker) { this.block(this.effectMapHandoffBlocker, site); return true; }
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
      return true;
    }
    if (!e.script || !this.content.scripts[e.script]) {
      this.block("缺少事件脚本");
      return true;
    }
    this.beginRoot(e.script);
    return true;
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
    if (this.effectMapHandoffBlocker) throw new Error(this.effectMapHandoffBlocker);
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
      if (this.hasUnfinishedInterpolation())
        throw new Error("Starting a script cannot discard unfinished source interpolation registers");
      if (this.options.nativeActorPreparation && !this.nativeActorBindings)
        throw new Error("Source field actors have not been installed");
      const locals = this.content.scriptLocals?.[script] ?? null;
      new EventState(this.eventState.snapshot()).beginScript(locals);
      const publish = this.preparePuppetStart(script);
      this.eventState.beginScript(locals);
      publish();
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error), this.content.scripts[script]?.[0] ?? null);
      return;
    }
    this.eventRootScript = script;
    this.scriptHook = null;
    this.tasks = [this.task(script, 0, "-1001")];
    this.pump();
  }
  /** The same native MainCore remains the owner of windows and execution.
   * Prepare all admission/local-bank work before ResetAll publishes any reset. */
  private transitionScript(t: Task, op: Extract<Op, { kind: "script-transition" }>): void {
    if (this.hasUnfinishedInterpolation())
      throw new Error("ChangeScript cannot discard unfinished source interpolation registers");
    const main = t.slot === null && !t.treasureRoot &&
      this.tasks.find((other) => other.slot === null && !other.treasureRoot) === t;
    const target = Object.hasOwn(this.content.scripts, op.targetScript)
      ? this.content.scripts[op.targetScript] : undefined;
    if (!target) throw new Error("Missing bound ChangeScript target " + op.targetScript);
    const plan = prepareEventScriptTransition(op, { main, hooked: this.scriptHook !== null,
      currentMetadata: this.content.scriptTransitionMetadata?.[t.script],
      targetMetadata: this.content.scriptTransitionMetadata?.[op.targetScript], targetLength: target.length });
    const localsByScript = this.content.scriptLocals;
    if (!localsByScript || !Object.hasOwn(localsByScript, t.script) || !Object.hasOwn(localsByScript, op.targetScript))
      throw new Error("ChangeScript source local declarations are unavailable");
    if (this.pendingChoice) throw new Error("ChangeScript conflicts with an unfinished choice task");
    if (this.messageWindow && this.messageWindow.task !== t.id)
      throw new Error("ChangeScript cannot detach another task's message window");
    if (this.treasureHandoffBlocked()) throw new Error("ChangeScript conflicts with an unfinished treasure task");
    // The source name setter changes isMapScript. The current actor host only
    // exposes its conjunction with CheckCurrentWorldMap, not that separate
    // predicate; do not infer a false world-map value from the conjunction.
    if (this.options.puppetActors &&
        t.script.toLowerCase().startsWith("sc_map_") !== op.targetScript.toLowerCase().startsWith("sc_map_"))
      throw new Error("ChangeScript map-script classification requires the current world-map provider");
    const locals = structuredClone(localsByScript[op.targetScript]!);
    new EventState(this.eventState.snapshot()).beginScript(locals);
    const hook = op.returnToCaller
      ? { script: t.script, pc: t.pc, range: { ...t.range }, locals: this.eventState.captureScriptLocals() }
      : this.scriptHook;
    this.eventState.beginScript(locals);
    this.scriptHook = hook;
    // ResetAll reaches all native cores, including Awake slots. External
    // treasure coroutines are not cores and keep their existing owner.
    this.tasks = this.tasks.filter((other) => other === t || other.treasureRoot);
    Object.assign(t, plan, { stack: [], wait: 0, state: "ready", lastClock: this.time,
      puppetWait: null, fadeWait: null, cameraLerp: null, scriptMove: null, scriptLerp: null, remaining: 0, move: null,
      animationWait: false, audioWait: null, soundWait: null, treasure: null, done: false });
  }
  private restoreHookedScript(main: Task): void {
    const hook = this.scriptHook!;
    if (this.messageWindow && this.messageWindow.task !== main.id)
      throw new Error("Hooked script cannot detach another task's message window");
    // Exit/Entry do not clear the callee's stack. The old caller stack was
    // already cleared by ResetAll; a cross-script leftover stack is not yet
    // admitted as an ordinary same-script Return.
    if (main.stack.length) throw new Error("Hooked script returned with a nonempty callee Call stack");
    if (!this.content.scripts[hook.script]?.[hook.pc] || hook.pc < hook.range.min || hook.pc > hook.range.max)
      throw new Error("Hooked script return address is outside its source range");
    this.eventState.restoreScriptLocals(hook.locals);
    main.script = hook.script;
    main.pc = hook.pc;
    main.range = { ...hook.range };
    main.done = false;
    main.state = "ready";
    main.lastClock = this.time;
    main.wait = 0;
    for (const task of this.tasks) if (task.slot !== null) task.done = true;
    this.scriptHook = null;
    // Integrator.Update returns after restoring. The caller resumes on the
    // following logical clock, without a finish/start actor lifecycle.
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
    const next = { name, script: structuredClone(script), leaderId: plan.leaderId,
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
  private task(script: string, pc: number, actor: string, id = this.nextTask++): Task {
    return {
      id,
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
      scriptMove: null,
      scriptLerp: null,
      remaining: 0,
      move: null,
      animationWait: false,
      audioWait: null,
      soundWait: null,
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
  private hasUnfinishedInterpolation(): boolean {
    return this.tasks.some((task) => !task.done && !!(task.scriptLerp || task.cameraLerp));
  }
  private hasUnfinishedNativeEncounterActivity(): boolean {
    return !!(this.pendingChoice || this.messageWindow || this.sourceMessage.active || this.shopTask ||
      this.treasureHandoffBlocked() || Object.values(this.actors).some((actor) => actor.motion !== null));
  }
  /** Validate the handoff before consuming rewards. The commit only schedules
   * the continuation; normal simulation, not reward publication, runs its code. */
  prepareEncounterReturn(party: number, candidateOwned?: () => FieldEncounterReturnState,
    eventShared?: BattleEventSharedReturn | null): FieldEncounterReturnPublication {
    if (this.stop?.kind === "encounter" && this.stop.returnTo !== undefined) {
      checkpointKeys(this.stop.returnTo, "kind");
      if (this.stop.returnTo.kind !== "field-idle" || this.stop.continuation !== undefined)
        throw new Error("Invalid ordinary encounter return target");
      return this.prepareIdleEncounterReturn(party, candidateOwned, eventShared);
    }
    if (this.hasUnfinishedInterpolation())
      throw new Error("Battle return cannot discard unfinished source interpolation registers");
    if (this.scriptHook)
      throw new Error("Hooked script battle return requires a suspended-caller handoff provider");
    if (
      this.stop?.kind !== "encounter" ||
      this.stop.party !== party ||
      !this.stop.continuation
    )
      throw new Error("No matching field encounter to resume");
    const continuation = this.stop.continuation;
    if (!this.content.scripts[continuation])
      throw new Error("Missing battle continuation");
    const stop = this.stop, taskId = this.nextTask, tasks = this.tasks;
    const locals = structuredClone(
      this.content.scriptLocals?.[continuation] ?? null,
    );
    new EventState(this.eventState.snapshot()).beginScript(locals);
    const shared = eventShared ? prepareBattleEventSharedReturn(this.eventState, eventShared) : null;
    const fingerprint = () => canonical({ stop: this.stop, event: this.eventState.snapshot(), lifecycle: this.puppetLifecycle,
      camera: this.cameraSnapshot, collision: this.collisionSwitches, updateMask: this.entityUpdateMask,
      offset: this.mapScrollOffset, time: this.time, remainder: this.remainder,
      script: this.content.scripts[continuation], locals: this.content.scriptLocals?.[continuation] ?? null });
    const before = fingerprint();
    const nextTask = this.task(continuation, 0, "-1001", taskId);
    const native = this.options.puppetActors || this.content.scriptPuppetContexts
      ? this.prepareNativeEncounterReturn(continuation, candidateOwned) : null;
    let consumed = false;
    const validateField = () => {
      if (consumed || this.stop !== stop || this.tasks !== tasks || this.nextTask !== taskId ||
          fingerprint() !== before)
        throw new Error("Stale battle continuation");
    };
    const validate = () => {
      validateField();
      shared?.validate();
      native?.validate();
      validateField();
      shared?.validate();
    };
    const publish = () => {
      this.eventState.beginScript(locals);
      this.eventRootScript = continuation;
      this.scriptHook = null;
      this.tasks = [nextTask];
      this.nextTask = taskId + 1;
      this.stop = null;
      this.remainder = 0;
    };
    const commitWith = (commitOwned: () => void) => {
      validate(); consumed = true;
      const publishAll = () => {
        if (shared) shared.commitWith(commitOwned); else commitOwned();
        publish();
      };
      if (native) native.commitWith(publishAll);
      else publishAll();
    };
    return Object.assign(() => commitWith(() => {}), { validate, commitWith });
  }
  /** A free-walking battle resumes this exact idle field, without executing a
   * script or rebinding local banks. Only post-battle appearance is prepared. */
  private prepareIdleEncounterReturn(party: number, candidateOwned?: () => FieldEncounterReturnState,
    eventShared?: BattleEventSharedReturn | null): FieldEncounterReturnPublication {
    const stop = this.stop;
    if (stop?.kind !== "encounter" || stop.party !== party || stop.returnTo?.kind !== "field-idle")
      throw new Error("No matching ordinary field encounter to resume");
    const requireIdle = () => {
      if (!this.idleFieldReady || this.scriptHook || this.pendingPlayerStep || this.pendingWalkEncounter ||
          this.hasUnfinishedInterpolation() || this.hasUnfinishedNativeEncounterActivity())
        throw new Error("Ordinary battle return requires the suspended idle field");
    };
    requireIdle();
    const shared = eventShared ? prepareBattleEventSharedReturn(this.eventState, eventShared) : null;
    const owner = this.actors, tasks = this.tasks;
    const actors = Object.values(owner).map(actor => ({ actor, native: actor.native, entity: actor.native?.entity }));
    const fingerprint = () => canonical({ event: this.eventState.snapshot(), lifecycle: this.puppetLifecycle,
      camera: this.cameraSnapshot, collision: this.collisionSwitches, updateMask: this.entityUpdateMask,
      offset: this.mapScrollOffset, time: this.time, remainder: this.remainder, nextTask: this.nextTask,
      eventRootScript: this.eventRootScript, tasks: this.tasks, stop: this.stop,
      native: this.nativeActorStateFingerprint,
      actors: Object.values(this.actors).map(actor => ({ id: actor.id, x: actor.x, y: actor.y,
        layer: actor.layer, direction: actor.direction, asset: actor.asset, mount: actor.mount,
        steps: actor.steps, motion: actor.motion, animation: actor.animation?.snapshot() ?? null })) });
    const before = fingerprint();
    let appearance: FieldPartyActorRendererPublication | null = null;
    if (this.player.native || this.partyActors) {
      if (!candidateOwned || !this.partyActors || !this.options.partyAppearance)
        throw new Error("Ordinary battle return requires candidate owned-state appearance");
      if (this.player.native && (!this.nativeActorBindings || !this.nativeRuntime?.mapLifecycle ||
          !this.nativeRuntime.animationKeys || !this.nativeActorProviders || !this.camera))
        throw new Error("Ordinary native battle return requires its complete actor host");
      const candidate = structuredClone(candidateOwned());
      if (!candidate.partyAppearance)
        throw new Error("Ordinary battle return candidate party appearance is unavailable");
      const party = this.partyActors, host = this.options.partyAppearance;
      const draft = new FieldPartyActors(host.catalog, party.checkpoint(), this.transportationId,
        this.transportationPresentation);
      const renderer = this.partyRenderer(), publications: FieldPartyActorRendererPublication[] = [];
      // Run the bookkeeping transaction on a private draft. Capture the live
      // renderer's already-prepared writes without publishing them here: the
      // ordinary callable validates again and must not run after owned commit.
      const stagingRenderer: FieldPartyActorRenderer = typeof renderer === "function"
        ? (media, plan) => {
          const commit = renderer(media, plan);
          const mediaFingerprint = () => canonical([this.content.characters[media.asset],
            media.mount === null ? null : this.content.characters[media.mount]]);
          const beforeMedia = mediaFingerprint();
          publications.push({ validate: () => {
            if (mediaFingerprint() !== beforeMedia) throw new Error("Stale ordinary battle return media");
          }, commit });
          return () => {};
        }
        : { prepareBatch: (steps) => {
          const publication = renderer.prepareBatch(steps);
          publications.push(publication);
          return { validate: () => publication.validate(), commit() {} };
        } };
      draft.prepare(candidate.partyAppearance, stagingRenderer, true)();
      const bookkeeping = party.prepareState(draft.checkpoint());
      appearance = {
        validate: () => {
          if (this.partyActors !== party || this.options.partyAppearance !== host)
            throw new Error("Stale ordinary battle return appearance owner");
          for (const publication of publications) publication.validate();
          bookkeeping.validate();
        },
        commit: () => {
          for (const publication of publications) publication.commit();
          bookkeeping.commit();
        },
      };
    }
    let consumed = false;
    const validateField = () => {
      if (consumed || this.stop !== stop || this.actors !== owner || this.tasks !== tasks ||
          Object.keys(owner).length !== actors.length || actors.some(({ actor, native, entity }) =>
            owner[actor.id] !== actor || actor.native !== native || actor.native?.entity !== entity) ||
          fingerprint() !== before)
        throw new Error("Stale ordinary battle return");
      requireIdle();
    };
    const validate = () => {
      validateField(); shared?.validate(); appearance?.validate(); validateField(); shared?.validate();
    };
    const commitWith = (commitOwned: () => void) => {
      validate(); consumed = true;
      if (shared) shared.commitWith(commitOwned); else commitOwned();
      // Only prevalidated plain writes remain after owned publication. In
      // particular, do not call FieldPartyActors' validating callable here.
      appearance?.commit();
      this.stop = null;
      this.remainder = 0;
    };
    return Object.assign(() => commitWith(() => {}), { validate, commitWith });
  }
  /** Battle stops before the Web host runs the Integrator's final cleanup.
   * Stage that old-context finish, source asset refresh, and the next Execute
   * against one private actor draft. Only final publication touches live actors. */
  private prepareNativeEncounterReturn(continuation: string, candidateOwned?: () => FieldEncounterReturnState) {
    const port = this.options.puppetActors, appearanceHost = this.options.partyAppearance;
    const runtime = this.nativeRuntime, bindings = this.nativeActorBindings;
    const providers = this.nativeActorProviders, partyActors = this.partyActors, camera = this.camera;
    if (!candidateOwned || !port || !appearanceHost || !runtime?.animationKeys || !bindings ||
        !providers || !partyActors || !camera || !this.content.cameraHost || !this.puppetLifecycle)
      throw new Error("Source puppet battle return requires a candidate owned-state actor host");
    if (this.hasUnfinishedNativeEncounterActivity())
      throw new Error("Source battle return has unfinished field activity");
    const script = this.content.scriptPuppetContexts?.[continuation];
    if (!script) throw new Error("Missing battle continuation puppet source context");
    const owned = structuredClone(candidateOwned());
    if (!owned.partyAppearance) throw new Error("Battle return candidate party appearance is unavailable");
    const old = port.read(), oldContext = canonical(old), control = canonical(port.controlContext());
    // Ordinary battle results update resources and conditions, not the roster,
    // party slots or enabled identities. Those transitions need their own host.
    const identities = (roster: Pick<FieldPuppetActorContext, "party" | "owned">) => ({ party: roster.party,
      owned: roster.owned.map(({ conditionTypes: _, ...member }) => member) });
    if (canonical(identities(owned.puppetRoster)) !== canonical(identities(old.context)))
      throw new Error("Battle return roster/party transition is unavailable");
    const currentParty = partyActors.checkpoint(), currentOffset = this.mapScrollOffset;
    const oldLifecycle = structuredClone(this.puppetLifecycle);
    const sourceScripts = canonical({ old: this.content.scriptPuppetContexts?.[oldLifecycle.name], next: script });
    if (canonical(oldLifecycle.script) !== canonical(this.content.scriptPuppetContexts?.[oldLifecycle.name]))
      throw new Error("Unbound suspended puppet lifecycle");
    const project = () => {
      const actors = Object.fromEntries(Object.values(this.actors).map((actor) => {
        if (!actor.native) throw new Error("Battle return cannot mix native and legacy actors");
        const copy = createNativeFieldActorProjection(actor.native, this.content.cameraHost!.mapRange, appearanceHost.catalog,
          this.transportationPresentation);
        return [copy.id, copy];
      }));
      const player = actors[bindings.player]!;
      let offset: Readonly<Point> = currentOffset;
      const draftCamera = camera.fork(this.content.cameraHost!, {
        readPlayer: () => {
          if (player.layer === null || player.direction === null) throw new Error("Unplaced battle-return player");
          return { cell: { x: player.x, y: player.y }, logicalLayer: player.layer, direction: player.direction };
        }, readScrollOffset: () => ({ ...offset }),
      });
      const draftParty = new FieldPartyActors(appearanceHost.catalog, currentParty, this.transportationId,
        this.transportationPresentation);
      const readCamera = () => { const state = draftCamera.snapshot();
        return { id: this.cameraActorId, position: state.dummy.position, layer: state.dummy.layer }; };
      const initialize = (phase: "start" | "finish", context: FieldPuppetScriptContext,
        roster: Pick<FieldPuppetActorContext, "party" | "owned">) => {
        const plan = projectFieldPuppetInitialization({ phase, script: context, catalog: old.catalog,
          context: fieldPuppetContextFromActors({ catalog: old.catalog, checkpoint: draftParty.checkpoint(),
            bindings, snapshot: readNativeFieldActors(actors, readCamera()), ...roster,
            entities: old.context.entities, restorePartyInstruction: old.context.restorePartyInstruction }) });
        if (this.separateCameraInitialization(plan)) draftCamera.prepareInitializeDummy().commit();
        const snapshot = readNativeFieldActors(actors, readCamera());
        const transportation = this.transportationPresentation ? projectFieldPuppetTransportationEffects({
          snapshot, assets: snapshot.actors.map(({ id }) => ({ id, fieldAssetId: actors[id]!.native.fieldAssetId,
            charaZOffset: actors[id]!.native.charaZOffset })), catalog: appearanceHost.catalog,
          characters: this.content.characters, animationKeys: runtime.animationKeys!, effects: plan.effects,
          providers: providers(), presentation: this.transportationPresentation,
        }) : null;
        const state = transportation?.snapshot ?? projectFieldPuppetActorEffects(plan.effects, snapshot, providers());
        if (transportation) {
          const bookkeeping = draftParty.prepareTransportation({ operations: transportation.operations });
          bookkeeping.validate(); bookkeeping.commit();
          for (const { id, fieldAssetId } of transportation.assets) actors[id]!.native.fieldAssetId = fieldAssetId;
        }
        for (const entity of state.actors) {
          const { moving: _, ...values } = entity;
          Object.assign(actors[entity.id]!.native.entity, values);
        }
        if (phase === "start") draftCamera.prepareSelect({ target: "dummy" }).commit();
        return plan;
      };
      if (!oldLifecycle.finished) initialize("finish", oldLifecycle.script, old.context);
      draftParty.prepare(owned.partyAppearance!, { prepareBatch: (steps) => {
        let nextOffset = offset;
        for (const step of steps) if (step.plan.cameraOffset !== null) {
          const value = step.plan.cameraOffset;
          checkpointKeys(value, "x,y");
          if (!Number.isFinite(Math.fround(value.x)) || !Number.isFinite(Math.fround(value.y)))
            throw new Error("Invalid battle return camera offset");
          nextOffset = Object.freeze({ x: Math.fround(value.x), y: Math.fround(value.y) });
        }
        const appearance = prepareNativeFieldActorAppearance({ readActors: () => actors,
          readCatalog: () => appearanceHost.catalog, readCharacters: () => this.content.characters,
          readProviders: providers, readAnimationKeys: () => runtime.animationKeys!,
          ...(this.transportationPresentation ? { transportationPresentation: this.transportationPresentation } : {}) }, steps);
        return { validate: appearance.validate, commit: () => { appearance.commit(); offset = nextOffset; } };
      } }, true)();
      const plan = initialize("start", script, owned.puppetRoster);
      const lifecycle = { name: continuation, script: structuredClone(script), leaderId: plan.leaderId,
        assignments: plan.assignments ?? fieldPuppetAssignments(), finished: false };
      return { actors, party: draftParty.checkpoint(), camera: draftCamera.snapshot(), offset, lifecycle,
        fingerprint: canonical({ party: draftParty.checkpoint(), camera: draftCamera.snapshot(), offset, lifecycle,
          actors: Object.values(actors).map((actor) => ({ ...actor.native,
            entity: { ...actor.native.entity, animation: actor.animation && {
              state: actor.animation.snapshot(), character: actor.animation.character } } })) }) };
    };
    const draft = project();
    const actorState = prepareNativeFieldActorState({ readActors: () => this.actors,
      readCamera: () => null, readProviders: providers }, draft.actors);
    const appearanceState = partyActors.prepareState(draft.party), cameraState = camera.prepareState(draft.camera);
    const validate = () => {
      if (this.options.puppetActors !== port || this.options.partyAppearance !== appearanceHost ||
          this.nativeRuntime !== runtime || this.nativeActorBindings !== bindings || this.nativeActorProviders !== providers ||
          this.mapScrollOffset !== currentOffset || canonical(port.read()) !== oldContext ||
          canonical(port.controlContext()) !== control ||
          canonical({ old: this.content.scriptPuppetContexts?.[oldLifecycle.name],
            next: this.content.scriptPuppetContexts?.[continuation] }) !== sourceScripts)
        throw new Error("Stale battle return source context");
      actorState.validate(); appearanceState.validate(); cameraState.validate();
      if (project().fingerprint !== draft.fingerprint) throw new Error("Stale battle return media/providers");
      // Read-only source providers may not alter any owner during validation.
      actorState.validate(); appearanceState.validate(); cameraState.validate();
    };
    return { validate, commitWith: (commitOwned: () => void) => {
      // Outer validate ran every fallible media/roster operation. The camera
      // locks its revision BEFORE the owned commit; the remaining writes never
      // read the now-replaced owned roster or call a provider again.
      cameraState.commitWith(() => {
        commitOwned(); actorState.commit(); appearanceState.commit();
        this.mapScrollOffset = draft.offset; this.puppetLifecycle = draft.lifecycle;
        this.cameraEventActive = true;
        return true;
      });
    } };
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
  /** One transaction across the existing owned, event, actor and controller
   * owners. This explicit framework variant is never an exact-source host. */
  private executeTransportation(command: FieldTransportationCommand, site: Site): void {
    if (this.transportationExecuting) throw new Error("Transportation publication cannot be reentered");
    if (!this.transportationPresentation)
      throw new Error("Source transportation lifecycle requires an explicit framework transportation profile");
    const port = this.options.transportation, party = this.partyActors, appearance = this.options.partyAppearance;
    const bindings = this.nativeActorBindings, providers = this.nativeActorProviders, keys = this.nativeRuntime?.animationKeys;
    if (!port || !party || !appearance || !bindings || !providers || !keys || !this.camera || !this.content.cameraHost)
      throw new Error("Transportation requires the shared owned, native actor and camera providers");
    const transports = new Transportations(port.catalog), identity = transports.identity(command.transportationId);
    const fingerprint = () => canonical({ current: this.transportationId, events: this.eventState.snapshot(),
      actors: this.nativeActorStateFingerprint, party: party.checkpoint(), offset: this.mapScrollOffset,
      collision: this.collisionSwitches });
    const before = fingerprint();
    this.transportationExecuting = true;
    try {
      if (command.kind === "place") {
        if (!this.options.transportationTimestamp) throw new Error("Transportation timestamp observation is unavailable");
        const layer = command.layer.kind === "player" ? this.player.native?.entity.layer : command.layer.value;
        if (layer === undefined) throw new Error("SetVehicle player Unity layer is unavailable");
        const ref = transports.releaseFlagRef(identity.id);
        // Validate the flag write without replacing the live EventState or its
        // active local frames. The timestamp is sampled exactly once by host.
        new EventState(this.eventState.snapshot()).write(ref, 1);
        const owned = port.prepare({ id: identity.id, enable: true, mapId: command.stayMapId,
          position: command.position, layer, direction: command.direction,
          timeStampTicks: this.options.transportationTimestamp() });
        owned.validate();
        if (fingerprint() !== before) throw new Error("Stale transportation placement");
        owned.commitWith(() => this.eventState.write(ref, 1));
      } else {
        const checkpoint = party.checkpoint();
        let currentId = this.transportationId, offset = this.mapScrollOffset;
        let currentTransport: typeof checkpoint.context.currentTransport | undefined;
        let operations: FieldTransportActorOperation[];
        if (command.kind === "change") {
          if (currentId === null || command.viewType !== 0)
            throw new Error("Transportation view/control provider is unavailable");
          const selected = transports.projectChange(currentId, identity.id, transports.availability((ref) => {
            try { return this.eventState.read(ref); }
            catch (error) { if (error instanceof UnknownEventValue) return null; throw error; }
          }));
          if (selected.currentId === null) throw new Error("Transportation has no effective current identity");
          const effective = transports.identity(selected.currentId);
          if (effective.type !== 1 && !(effective.id === 6 && effective.type === 12 && effective.assetId === 38))
            throw new Error("Framework supports walking and Magitek transportation only");
          currentId = effective.id;
          currentTransport = { id: effective.id, typeId: effective.type, fieldAssetId: effective.assetId };
          const asset = effective.type === 1 ? checkpoint.playerAssetCacheId : effective.assetId;
          if (asset === null) throw new Error("Player transportation asset cache is unavailable");
          operations = effective.type === 1
            ? [{ kind: "replace", actorId: bindings.player, fieldAssetId: asset },
               { kind: "ride-out", actorId: bindings.player, restoreRiderAsset: false }]
            : [{ kind: "ride-on", actorId: bindings.player, frontAssetId: asset, skipIfSameOuter: false }];
          offset = Object.freeze(partyActorCameraOffset(appearance.catalog, asset, checkpoint.context.camera));
        } else {
          if (identity.type !== 1 && !(identity.id === 6 && identity.type === 12 && identity.assetId === 38))
            throw new Error("Framework supports walking and Magitek NPC riding only");
          const host = this.options.puppetActors;
          if (!host) throw new Error("NPC transportation source selector is unavailable");
          const { catalog, context } = host.read(), resolved = resolveFieldPuppetActor(catalog, context, command.actorSelector);
          if (resolved.actor === null) throw new Error("NPC transportation selector has no actor");
          operations = identity.id === 1
            ? [{ kind: "ride-out", actorId: resolved.actor, restoreRiderAsset: true }]
            : [{ kind: "ride-on", actorId: resolved.actor, frontAssetId: identity.assetId, skipIfSameOuter: true }];
        }
        const readCamera = () => { const state = this.camera!.snapshot();
          return { id: this.cameraActorId, position: state.dummy.position, layer: state.dummy.layer }; };
        const snapshot = readNativeFieldActors(this.actors, readCamera());
        const projected = projectFieldTransportActors({ snapshot,
          assets: snapshot.actors.map(({ id }) => { const native = this.actors[id]!.native!;
            return { id, fieldAssetId: native.fieldAssetId, charaZOffset: native.charaZOffset }; }),
          catalog: appearance.catalog, characters: this.content.characters, animationKeys: keys,
          operations, presentation: this.transportationPresentation });
        const candidate = Object.fromEntries(projected.snapshot.actors.map((entity) => {
          const row = projected.assets.find((value) => value.id === entity.id)!;
          const actor = createNativeFieldActorProjection({ ...this.actors[entity.id]!.native!, entity,
            fieldAssetId: row.fieldAssetId }, this.content.cameraHost!.mapRange, appearance.catalog,
          this.transportationPresentation);
          return [entity.id, actor];
        }));
        const actorPublication = prepareNativeFieldActorState({ readActors: () => this.actors,
          readProviders: providers, readCamera }, candidate);
        const partyPublication = party.prepareTransportation({ operations,
          ...(currentTransport !== undefined ? { currentTransport } : {}) });
        const collision = command.kind === "change" ? projectFieldPuppetCollision(command.changeCollisionEnable) : this.collisionSwitches;
        actorPublication.validate(); partyPublication.validate();
        if (fingerprint() !== before) throw new Error("Stale transportation actor/controller transaction");
        // Only prevalidated plain writes remain; actor identities are retained.
        actorPublication.commit(); partyPublication.commit();
        this.currentTransportationId = currentId; this.mapScrollOffset = offset; this.collisionSwitches = collision;
      }
      this.transportationExecutions.push({ site, command: structuredClone(command), currentId: this.transportationId,
        omissions: FRAMEWORK_TRANSPORTATION_LIMITATIONS });
    } finally { this.transportationExecuting = false; }
  }
  private soundWaitComplete(wait: NonNullable<Task["soundWait"]>): boolean {
    const command = wait.op.command;
    if (command.kind === "ready") return this.soundResourceReady(command.soundId);
    const handle = command.kind === "sync"
      ? this.eventState.read({ category: "ScriptLocalVariable", index: command.handleSlot }) : wait.handle;
    if (handle === null) throw new Error("Missing synchronous SE play handle");
    return !this.se.isPlaying(handle);
  }
  private executeSound(op: Extract<Op, { kind: "field-sound" }>): Task["soundWait"] {
    const command = op.command;
    let handle: number | null = null, wait: Task["soundWait"] = null;
    if (command.kind === "play") {
      if (!this.options.audioReadiness || typeof this.options.audioReadiness.isReady !== "function")
        throw new Error("Missing SE resource readiness provider");
      if (!this.options.soundPresentation || typeof this.options.soundPresentation.isPresented !== "function")
        throw new Error("Missing SE presentation provider");
      const ref = command.asynchronous && command.handleSlot !== null
        ? { category: "ScriptLocalVariable" as const, index: command.handleSlot } : null;
      // Validate the actual bank without replacing it or detaching hooked
      // script frames. The subsequent live write is a prevalidated plain write.
      if (ref) new EventState(this.eventState.snapshot()).write(ref, 1);
      const played = this.se.play(command, this.content.se);
      handle = played;
      if (ref) this.eventState.write(ref, played);
      if (!command.asynchronous) wait = { op, handle }; // Source first clock always repeats.
    } else if (command.kind === "stop") {
      handle = this.eventState.read({ category: "ScriptLocalVariable", index: command.handleSlot });
      this.se.stop(handle, command.fadeSeconds);
    } else {
      const pending = { op, handle: null };
      if (!this.soundWaitComplete(pending)) wait = pending;
    }
    this.soundExecutions.push({ site: op, command: structuredClone(command), handle });
    return wait;
  }
  private pump(frameDeltaSeconds = 0): void {
    if (this.stop || this.shopTask || this.pendingEventSave) return;
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
    if (this.stop || this.pendingEventSave) return;
    for (let slot = 0; slot < 32; slot++) {
      const task = this.tasks.find((t) => !t.done && t.slot === slot);
      if (task) this.clockTask(task, frameDeltaSeconds);
      if (this.stop) return;
    }
    if (main?.done) {
      if (this.hasUnfinishedInterpolation()) {
        this.block("Main script ended with an unfinished source interpolation task");
        return;
      }
      if (this.pendingChoice) {
        this.block("Main script ended with an unfinished choice task", this.pendingChoice.op);
        return;
      }
      if (this.messageWindow?.manual) {
        this.block("Main script ended with an unfinished ordinary message", this.messageWindow.manual.site);
        return;
      }
      if (this.treasureHandoffBlocked()) {
        this.block("Main script ended with an unfinished treasure task");
        return;
      }
      if (this.scriptHook) {
        try { this.restoreHookedScript(main); }
        catch (error) { this.block(error instanceof Error ? error.message : String(error)); }
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
        t.wait > 0 || this.dialogue?.task === t.id ||
        (this.pendingChoice?.task === t && this.pendingChoice.answer === null)) return;
    t.lastClock = this.time;
    if (this.pendingChoice?.task === t) {
      try { this.finishChoice(t); }
      catch (error) {
        this.block(error instanceof Error ? error.message : String(error), this.pendingChoice?.op);
        return;
      }
    }
    for (let budget = 0; budget < 4096; budget++) {
        if (t.done || t.wait > 0 || this.dialogue?.task === t.id) return;
        const actor = this.actors[t.actor];
        if (!actor && !this.hasEntity(t.actor)) {
          this.block(`缺少角色 ${t.actor}`);
          return;
        }
        // A movement suspends its own instruction, not every core currently
        // bound to that actor (in particular, the main core's dialogue/flags).
        if (actor?.motion && (t.move || t.scriptMove)) return;
        if (t.scriptMove) t.scriptMove = null;
        if (t.scriptLerp) {
          const pending = t.scriptLerp;
          try {
            if (!actor) throw new Error("Source actor Lerp lost its entity binding");
            const next = this.prepareActorScriptLerp(actor, pending.op, pending.progress);
            if (next.flow === "wait") { pending.progress = next.progress; return; }
            t.scriptLerp = null;
          } catch (error) { this.block(error instanceof Error ? error.message : String(error), pending.op); return; }
        }
        if (t.animationWait) {
          if (
            actor
              ? actor.animation?.playing
              : this.effectBoard(t.actor) ? this.effectPlaying(t.actor) : this.tileAnimations.isPlaying(t.actor)
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
        if (t.soundWait) {
          const pending = t.soundWait;
          try {
            if (!this.soundWaitComplete(pending)) return;
            t.soundWait = null;
          } catch (error) {
            this.block(error instanceof Error ? error.message : String(error), pending.op); return;
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
          let animation: ActorAnimation | null;
          try {
            if (actor.id === this.player.id) step = this.preparePlayerStep();
            animation = actor.animation?.clone() ?? null;
            animation?.move(t.move.direction, t.move.secondsPerCell);
          } catch (error) {
            this.block(
              error instanceof Error ? error.message : String(error),
              t.move,
            );
            return;
          }
          if (actor.id === this.player.id) this.pendingPlayerStep = step;
          actor.animation = animation;
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
        if ((actor?.motion || this.tasks.some((other) => !other.done && other.actor === t.actor && other.scriptLerp)) &&
            ["move", "field-script-motion", "field-camera-motion", "position", "look", "animation-play", "animation-cue"].includes(op.kind)) {
          this.block("Concurrent source actor movement arbitration is not implemented", op);
          return;
        }
        if (op.kind === "message" && this.messageWindow && this.messageWindow.task !== t.id) {
          this.block("Concurrent source message windows are not implemented", op);
          return;
        }
        if (this.dialogue?.manual && ["change-map", "encounter"].includes(op.kind)) {
          this.block("Field transition conflicts with an unfinished ordinary message", op);
          return;
        }
        if (this.pendingChoice && ["message", "source-message", "choice", "change-map", "encounter", "treasure-box"].includes(op.kind)) {
          this.block("Concurrent field interaction conflicts with an unfinished choice task", op);
          return;
        }
        if (t.pc < t.range.min || t.pc > t.range.max) {
          this.block("Field control flow leaves the source task range", op);
          return;
        }
        t.pc++;
        try { this.requireInstructionProviders(op, t.actor); }
        catch (error) {
          if (op.kind === "field-sound") t.pc--;
          this.block(error instanceof Error ? error.message : String(error), op);
          return;
        }
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
          case "event-save":
            try { this.requestEventSave(t, op); }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); }
            return;
          case "script-transition":
            try { this.transitionScript(t, op); }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "branch-character":
          case "branch-player-direction":
            try {
              const next = prepareEventContextBranch(op, { nextPc: t.pc, range: t.range,
                ...(op.kind === "branch-character"
                  ? (this.options.puppetRoster ? { roster: this.options.puppetRoster.current() } : {})
                  : { playerDirection: this.player.direction }) });
              t.pc = next.pc;
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
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
                  this.content.scriptSystemFlags?.[this.eventRootScript ?? t.script]?.keepBadStatusVisual !== false)
                throw new Error("Roster recovery condition-visual context is unavailable");
              executeRosterLifecycleEvent(op, this.options.roster,
                (_members, appearance, setDummy) => {
                  this.requireInstructionProviders(op, t.actor, true);
                  return this.preparePartyAppearance(appearance, setDummy);
                });
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
                (_members, appearance, setDummy) => {
                  this.requireInstructionProviders(op, t.actor, true);
                  return this.preparePartyAppearance(appearance, setDummy);
                });
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
          case "field-recovery":
            try {
              const prepare: Parameters<typeof executeOwnedConditionEvent>[2] = (steps) => {
                if (!steps.length) return () => {};
                this.requireInstructionProviders(op, t.actor, true);
                const visual = this.content.scriptSystemFlags?.[this.eventRootScript ?? t.script];
                if (visual?.keepBadStatusVisual !== false)
                  throw new Error("Unknown or unsupported owned condition-visual context");
                if (!this.partyActors) throw new Error("Party actor refresh is unavailable");
                return this.partyActors.prepareSequence(steps, this.partyRenderer());
              };
              if (op.kind === "owned-condition") executeOwnedConditionEvent(op, this.options.ownedConditions, prepare);
              else executeFieldRecoveryEvent(op, this.options.recovery, prepare);
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "animation-cue":
          case "animation-play":
            try {
              if (this.effectBoard(t.actor)) {
                // Puppet.PlayAnim maps accepted i1 0/1 to mode 0, and -1 to
                // mode 1. The board override ignores key/speed/flip. Its Cue
                // override is source-proven empty; the particle owns playback.
                if (op.kind === "animation-play") {
                  this.effects!.prepare([{ kind: "play", id: t.actor,
                    loopLimit: fieldEffectAnimationLoopLimit(op.loop ? 1 : 0) }]).commit();
                  t.animationWait = !op.loop;
                }
              } else if (actor) {
                if (actor.mount && (!actor.native || !this.transportationPresentation))
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
            if (this.hasUnfinishedInterpolation()) {
              this.block("Map handoff requires completion of source interpolation tasks", op); return;
            }
            if (this.scriptHook) {
              this.block("Hooked script map handoff requires a suspended-caller provider", op); return;
            }
            if (this.sourceMessage.active) {
              this.block("Source message must close before map handoff", op); return;
            }
            if (this.treasureHandoffBlocked()) {
              this.block("宝箱任务尚未完成，尚不支持并发切图", op);
              return;
            }
            if (this.effectMapHandoffBlocker) { this.block(this.effectMapHandoffBlocker, op); return; }
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
              const effect = this.effectBoard(op.actor);
              const nextKind = this.content.scripts[t.script]?.[op.target + 1]?.kind;
              const plan = host && lifecycle && !effect ? projectFieldPuppetActorEntry({ ...host.read(), script: lifecycle.script,
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
              const effectShows: FieldEffectOperation[] = [...new Set(ready.filter((r) => r.plan.showActor && this.effectBoard(r.actor))
                .map((r) => r.actor))].map((id) => ({ kind: "visibility", id, visible: true, duration: 0 }));
              const effectShow = effectShows.length ? this.effects!.prepare(effectShows) : null;
              const publish = host && this.puppetLifecycle ? host.prepare({ leaderId: null,
                assignments: result.clearAssignments ? fieldPuppetAssignments() : null,
                effects: ready.filter((r) => r.plan.showActor && !(this.camera && r.actor === this.cameraActorId) && !this.effectBoard(r.actor))
                  .map((r) => ({ kind: "show", actor: r.actor })) }) : () => {};
              if (typeof publish !== "function") throw new Error("Invalid source puppet Ready transaction");
              const publishCollision = this.preparePuppetCollision(result.collisionEnabled);
              const assignments = result.clearAssignments ? fieldPuppetAssignments() : null;
              const legacyShown = ready.filter(({ actor, plan }) => plan.showActor &&
                !(this.camera && actor === this.cameraActorId) && !this.effectBoard(actor) && !this.actors[actor]?.native)
                .map(({ actor }) => actor);
              const publishReady = () => {
                // Source actor/collision ports promise a prepared no-fail
                // publication. An opaque violation stops the field; it cannot
                // be represented as rollback of a third-party write.
                publish();
                publishCollision();
                if (assignments && this.puppetLifecycle) this.puppetLifecycle.assignments = assignments;
                for (const { child, actor, plan } of ready) {
                  child.done = plan.status === "sleep";
                  child.state = "ready";
                  child.actor = actor;
                }
                for (const actor of legacyShown) this.hiddenEntities.delete(actor);
                return true;
              };
              // Lock the camera before publishing actors/tasks, and finish all
              // FX host checks before either owner changes. Reversing commit
              // order alone would only move the partial-write failure.
              const publishCamera = () => cameraShow ? cameraShow.commitWith(publishReady) : publishReady();
              if (effectShow) effectShow.commitWith(publishCamera);
              else publishCamera();
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
              (!actor.asset || !this.content.characters[actor.mount ?? actor.asset]?.animations[op.animation])
            ) {
              this.block("尚未支持角色动画 " + op.animation, op);
              return;
            }
            if (actor.native) {
              try {
                if (!op.nativeCommand || !this.nativeActorProviders || !this.camera ||
                    this.content.cameraHost?.callbacks !== "fresh-normal-field-v1" ||
                    op.x !== op.nativeCommand.x || op.y !== op.nativeCommand.y || op.animation !== op.nativeCommand.animation)
                  throw new Error("Source actor SetPos operands or callback host are unavailable");
                const command = structuredClone(op.nativeCommand);
                prepareNativeFieldActorProjection({
                  readActors: () => this.actors, readProviders: this.nativeActorProviders,
                  readCamera: () => { const state = this.camera!.snapshot();
                    return { id: this.cameraActorId, position: state.dummy.position, layer: state.dummy.layer }; },
                }, (snapshot, providers) => projectNativeFieldPosition(snapshot, providers, actor.id, command,
                  this.content.cameraHost!.mapRange, "source-absent"))();
              } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
              break;
            }
            if (op.nativeCommand && (!([0, 3].includes(op.nativeCommand.layer)) ||
                !["", "Default", "WalkL"].includes(op.animation))) {
              this.block("Source SetPos requires the native actor host", op); return;
            }
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
          case "field-script-motion":
            try {
              if (t.actor === this.cameraActorId) {
                if (!this.camera || op.command.kind !== "lerp" || op.command.layer !== 0 || op.command.animation !== "")
                  throw new Error("Camera source Move, animation or layer transition requires a separate provider");
                const command: FieldCameraLerp = { kind: "lerp", x: op.command.x, y: op.command.y,
                  layer: 0, duration: op.command.duration, arcHeight: op.command.arcHeight };
                if (command.duration < 0) throw new Error("Negative source Lerp duration is not admitted");
                const next = this.camera.prepareLerp(command, null, this.time / 1000);
                next.commit();
                if (next.flow === "wait") { t.cameraLerp = { op, command, progress: next.progress }; return; }
              } else {
                if (!actor) throw new Error("Source script motion requires a bound actor");
                if (op.command.kind === "move") {
                  if (!actor.native && !this.options.nativeActorPreparation && !this.options.puppetActors &&
                      !this.content.scriptPuppetContexts && op.command.animation === "" && op.command.speedId !== null) {
                    // Preserve the earlier explicit development host's bounded
                    // empty-animation Move subset. This is not native factory,
                    // wrap, raycast, custom-animation or nullable-speed admission.
                    const plan = prepareFieldScriptMove(op.command, actor, {
                      loop: { horizontal: false, vertical: false }, magnification: 1,
                    });
                    t.move = { script: op.script, index: op.index, source: op.source,
                      kind: "move", direction: op.command.direction, steps: op.command.steps,
                      secondsPerCell: plan.secondsPerCell };
                    t.remaining = op.command.steps;
                    if (op.command.steps === 0) return;
                    break;
                  }
                  this.startScriptMove(actor, op);
                  t.scriptMove = op;
                  return; // Move always returns Wait on its first clock.
                }
                const next = this.prepareActorScriptLerp(actor, op, null);
                if (next.flow === "wait") { t.scriptLerp = { op, progress: next.progress }; return; }
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
            if (this.effectBoard(t.actor)) {
              try { this.effects!.prepare([{ kind: "visibility", id: t.actor, visible: false, duration: 0 }]).commit(); }
              catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
              break;
            }
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
          case "field-transportation":
            try { this.executeTransportation(op.command, op); }
            catch (error) { t.pc--; this.block(error instanceof Error ? error.message : String(error), op); return; }
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
          case "field-sound":
            try {
              t.soundWait = this.executeSound(op);
              if (t.soundWait) return;
            } catch (error) {
              t.pc--; this.block(error instanceof Error ? error.message : String(error), op); return;
            }
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
              const retained = this.retainedMessage,
                handoff = !this.dialogue && retained?.manual?.after === "message" && retained.task === t.id;
              if ((this.messageWindow && !handoff) || this.shopTask || this.treasureSceneState === "message")
                throw new Error("Source message conflicts with an occupied message window");
              if (!this.options.sourceMessageEffects) throw new Error("Source message entity-update host is unavailable");
              const next = this.sourceMessage.prepare(op), publish = this.options.sourceMessageEffects.prepare(next.effects);
              if (typeof publish !== "function") throw new Error("Invalid source message host transaction");
              if (this.retainedMessage !== retained) throw new Error("Stale source message handoff");
              publish(); next.commit();
              if (handoff) this.retainedMessage = null;
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "choice":
            try {
              if (this.sourceMessage.active || this.shopTask || this.treasureSceneState === "message")
                throw new Error("Field choice conflicts with an occupied message manager");
              if (this.messageWindow && this.messageWindow.task !== t.id)
                throw new Error("Field choice message belongs to another task");
              if (op.presentation === "yes-no" && !this.messageWindow)
                throw new Error("Yes/no field choice requires its ordinary message window");
              if (!op.retainMessage && !this.options.sourceMessageEffects && (this.options.puppetActors || this.nativeActorBindings))
                throw new Error("Source choice message entity-update host is unavailable");
              const request = createFieldChoiceRequest(op, `${this.choiceNamespace}:${this.nextChoice}`, t.id);
              this.pendingChoice = { request, task: t, op: structuredClone(op), answer: null };
              this.nextChoice++;
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); }
            return;
          case "message":
            if (op.manual) {
              try { this.beginManualDialogue(op, t); }
              catch (error) { t.pc--; this.block(error instanceof Error ? error.message : String(error), op); }
              return;
            }
            if (this.sourceMessage.active) { this.block("Source message window is already occupied", op); return; }
            try {
              const presentation = this.prepareMessagePresentation(op);
              presentation.validate();
              this.dialogue = { ...presentation.message, task: t.id };
            } catch (error) { t.pc--; this.block(error instanceof Error ? error.message : String(error), op); }
            return;
          case "encounter":
            if (this.hasUnfinishedInterpolation()) {
              this.block("Battle handoff requires completion of source interpolation tasks", op); return;
            }
            // Battle freezes this field. Activities the native return host
            // cannot preserve must be rejected before any battle lease opens.
            if ((this.options.puppetActors || this.content.scriptPuppetContexts) &&
                this.hasUnfinishedNativeEncounterActivity()) {
              this.block("Source battle handoff requires completion of field activity", op); return;
            }
            if (this.scriptHook) {
              this.block("Hooked script battle handoff requires a suspended-caller provider", op); return;
            }
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
