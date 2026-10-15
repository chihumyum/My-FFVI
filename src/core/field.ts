import { parseSourceScriptAnimationCatalog, sourceScriptAnimationAsset, parseSourceFieldScriptAnimationState, type SourceScriptAnimationCatalog, type SourceFieldScriptAnimationState } from "./source-script-animations.js";
import {FieldSkyboxState,fieldSkyboxBinding,skyboxScrollSample,type WebFlatSkybox,type FieldSkyboxSnapshot}from"./field-skybox.js";
import { reservedScriptBinding, type FieldReservedScriptPort } from "./field-reserved-script.js";
import {FieldScreenPresentationState,fieldScreenPresentationBinding,validateScreenPresentationPolicy,type WebFieldScreenPresentation}from"./field-screen-presentation.js";
import {WEB_FLAT_WORLD_AUTO_MOVE,validateWorldAutoMovePolicy,worldAutoMoveBinding,prepareFlatWorldAutoSegment,type WebFlatWorldAutoMove} from './field-world-auto-move.js';
import { WEB_FLAT_BIRD_VIEW_ACTORS, validateBirdViewActorsPolicy, fieldBirdViewActorBinding, prepareFieldBirdViewMove, projectFieldBirdViewMove,
  createFieldBirdViewActorPose, parseFieldBirdViewActorPose, parseFieldBirdViewActorCheckpoint,
  type FieldBirdViewActorPose, type FieldBirdViewActorCheckpoint, type WebFlatBirdViewActors } from "./field-bird-view-actors.js";
import { WEB_FLAT_FIELD_VIEW_CHANGE, WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE, validateFieldViewChangePolicy, fieldViewBinding, parseFieldViewChangeCommand, type WebFlatFieldViewChange, type FieldViewChangeCommand } from './field-view-change.js';
import { WEB_FLAT_WORLD_AUTO_TASKS, validateWorldAutoTaskPolicy, worldAutoBinding, parseFieldWorldAutoCommand,
  createWorldAutoQueue, addWorldAutoCommand, advanceWorldAutoQueue, type WebFlatWorldAutoTasks, type WorldAutoPose } from './field-world-auto-tasks.js';
import { assertRetainedGroundViewTransportation } from './world-transportation-entry.js';
import { WEB_SOURCE_PARTY_SELECTION, projectSourcePartySelection, type WebSourcePartySelection, type FieldSourcePartySelectionPort, type SourcePartySelectionModel, type SourcePartySelectionOutcome } from './source-party-selection.js';
import type { SourceMessageFeeCatalog, SourceMessageFeeSnapshot } from "./source-message-fees.js";
import { executeFieldScriptRandom, type FieldScriptRandomPort } from "./field-script-random.js";
import { FieldContentInvalidations, type FieldContentInvalidationCatalog, type FieldContentInvalidationsCheckpoint } from "./field-content-invalidations.js";
import { projectBattleFieldState, type BattleFieldState } from "./field-battle-entry.js";
import type { BattleEntryCatalog } from "./battle-entry.js";
import { captureFieldEventActivation, restoreFieldEventActivation, type FieldEventActivationCheckpoint } from "./field-event-activation.js";
import { bindFieldNpcFlatProjections, flatNpcGroupBlockers, flatNpcInteractionLayer } from "./field-npc-flat-projection.js";
import { captureAssignedRoutes, restoreAssignedRoutes, type AssignedRoutesCheckpoint, type RestoredAssignedRoute } from './field-assigned-route-checkpoint.js';
import { WEB_ASSIGNED_ROUTE_POLICY, compileAssignedRouteProgram, createAssignedRouteCursor, settleAssignedRouteCursor, searchAssignedRouteGrid, assignedRouteLineClear, type WebAssignedRoutePolicy, type AssignedRouteProgram, type AssignedRouteCursor } from './field-assigned-route.js';
import { parseFieldNpcRouteCatalog } from './field-npc-route.js';
import { WEB_SOURCE_BOSS_ENTRY, parseSourceBossEncounterCommand, type WebSourceBossEntry, type SourceBossEncounterRequest } from './source-boss-encounter.js';
import { WEB_COMMITTED_BATTLE_RESULT, executeCommittedBattleResult, type FieldBattleResultPort } from './source-battle-result.js';
import { parseSourceEncounterCommand, selectSourceEncounterSlot } from "./source-encounter.js";
import { captureSourceEncounterFootBackground } from "./source-encounter-foot.js";
import { WEB_SOURCE_ENCOUNTER_POLICY, type FieldSourceEncounterPort,
  type SourceEncounterRequest } from "./source-encounter-entry.js";
import { actorFadeActive, sourceVisibilityDelayDue } from "./field-actor-visibility.js";
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
import { executeOwnedConditionEvent, type FieldOwnedConditionPort,
  type OwnedConditionAppearanceStep } from "./owned-condition.js";
import { fieldUsesCoreRegisters, initialFieldCoreRegisters, parseFieldCoreRegisters,
  projectFieldCoreI0, projectFieldCoreSlots, type FieldCoreRegisters } from "./field-core-registers.js";
import { executeFieldRecoveryEvent, type FieldRecoveryPort } from "./field-recovery.js";
import { prepareFieldConditionActors } from "./field-condition-actors.js";
import type { FieldConditionActivityPort } from "./field-condition-activity.js";
import { fieldInstructionRequirements, assessFieldRequirements,
  type FieldAdmissionContext } from "./field-content-admission.js";
import { executeSourcePresentation, cloneSourcePresentationContext, sourcePresentationCheckpoint,
  type SourcePresentationContext, type SourcePresentationPort } from "./source-presentation.js";
import { canonical } from "./canonical.js";
import { MESSAGE_VALUE_PATTERN, parseFieldMessageTemplate, fieldMessageNameReferences, fieldMessageUsesFee,
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
import { sourceMessageSequenceTextRuns, createSourceMessageTaskCursor, pollSourceMessageTask,
  type SourceMessageSequenceContext, type SourceMessageTaskCursor } from "./source-message-sequence.js";
import { createFieldChoiceRequest, resolveFieldChoiceAnswer, type FieldChoiceAnswer,
  type FieldChoiceRequest } from "./field-choice.js";
import { prepareEventContextBranch } from "./event-context-branch.js";
import { prepareFieldPartyQuery } from "./field-party-queries.js";
import { prepareEventScriptTransition } from "./event-script-transition.js";
import type { FieldPuppetRosterPort, FieldPuppetRosterRead } from "./field-puppet-roster.js";
import { createNativeFieldActorProjection, createNativeFieldActorProjections, createNativeFieldPuppetActorsPort, readNativeFieldActors,
  prepareNativeFieldActorProjection, prepareNativeFieldActorState, prepareNativeFieldActorRead, createNativeFieldActorDraft,
  type NativeFieldActorData, type NativeFieldActor } from "./field-native-actors.js";
import { projectNativeFieldPosition } from "./field-native-position.js";
import { prepareFieldActorMotionTick, prepareFieldScriptMove, projectFieldScriptLerp, resolveFieldScriptMoveToTarget,
  type FieldActorMotion, type FieldScriptLerpProgress } from "./field-script-motion.js";
import { prepareFieldPuppetRoute, fieldRouteDirection, WEB_PUPPET_ROUTE_POLICY, type WebPuppetRoutePolicy } from "./field-puppet-route.js";
import { FieldEffects, FIELD_EFFECT_PARTICLE_UPDATE_ATTRIBUTE, fieldEffectAnimationLoopLimit,
  projectFieldEffectPlacement, fieldEffectBoardBlockers, type FieldEffectRuntimeHost, type FieldEffectState,
  type FieldEffectPrepared, type FieldEffectOperation } from "./field-effects.js";
import { FieldEffectMap } from "./field-effect-map.js";
import { fieldPuppetContextFromActors, type FieldActorFactoryCandidate, type FieldActorFactoryBindings, type FieldActorFactoryCatalog } from "./field-actor-factory.js";
import { captureFieldNativeCheckpoint, restoreFieldNativeCheckpoint,
  type FieldNativeCheckpoint, type FieldNativeCheckpointContext } from "./field-native-checkpoint.js";
import { mapAnimationGroupBlockers, mapAnimationSelector, prepareFieldMapAnimations, WEB_FIELD_MAP_ANIMATION, type FieldMapAnimationDefinition } from "./field-map-animation.js";
import { prepareFieldNativeNpcGroup, fieldNativeNpcRetirement, fieldNativeNpcStandbyPosition, fieldNativeNpcSelectorBinding,
  type FieldNativeNpcDefinition } from "./field-native-npc.js";
import { bindFieldNpcActivities, fieldNpcGroupBlockers } from "./field-npc-activity-host.js";
import type { FrameworkNpcActivityBinding } from "./field-npc-activity-source.js";
import { createNpcActivity, prepareNpcActivity, settleNpcActivity, completeNpcActivity,
  acquireNpcActivity, releaseNpcActivity, sourceNpcSecondsPerCell,
  type FieldNpcActivityState, type FieldNpcActivityTicket, type FieldNpcActivityLease,
  type FieldNpcActivityInput } from "./field-npc-activity.js";
import { captureFieldNpcActivities, restoreFieldNpcActivities,
  type FieldNpcActivitiesCheckpoint, type RestoredFieldNpcActivities } from "./field-npc-activity-checkpoint.js";
import { parsePuppetReplacementState, projectPuppetReplacement,
  type FieldPuppetReplacementCommand, type FieldPuppetReplacementState } from "./field-puppet-replacement.js";
import { projectFieldPuppetCollision, projectFieldPuppetActorEffects, type FieldPuppetCollisionState, type FieldPuppetHostProviders } from "./field-puppet-effects.js";
import type { FieldPuppetActorCatalog, FieldPuppetActorContext, FieldPuppetControlContext } from "./field-puppet-actors.js";
import { partyActorMapArea, type PartyActorPlan } from "./party-actors.js";
import { bindFieldRelays, fieldRelayGroupBlockers } from "./field-relay-policy.js";
import { bindPassiveEffects, passiveEffectsGroupBlockers } from "./field-passive-effects-host.js";
import { bindFieldEffectFlatProjection, validateFieldEffectFlatContext, fieldEffectRuntimeBoardBlockers } from "./field-effect-flat-projection.js";
import { WEB_LOGICAL_FIELD_EFFECTS, logicalEffectsGroupBlockers, validateLogicalEffectMedia, logicalEffectDisplayBlockers } from "./field-logical-effects.js";
import { projectFieldRelaySearchRanges, canFieldRelayInteractToEntityPosition } from "./field-relay-interaction.js";
import { fieldNativeMapObjectPosition } from "./field-native-npc.js";
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
import { projectFieldEntryContext, validateFieldEntryTerrainBinding } from "./field-entry-context.js";
import { requireMinimapMedia } from "./minimap.js";
import { validateFieldMoveAreas, fieldMoveAreas, findFieldMoveArea, type FieldMoveArea } from "./field-move-area.js";
import { StaticAudioState, type AudioSnapshot } from "./static-audio.js";
import { FieldSoundState, type SoundSnapshot } from "./field-sound.js";
import type { FieldSoundPresentation } from "./field-sound-presentation.js";
import type { StaticAudioReplay } from "./static-audio.js";
import { createFieldTimer, cloneFieldTimer, advanceFieldTimer, prepareFieldTimerCommand,
  pendingFieldTimerCallback, acknowledgeFieldTimerCallback, fieldTimerProjection, WEB_FIELD_TIMER_POLICY,
  type FieldTimerSnapshot, type FieldTimerScene, type FieldTimerCallbackRequest } from "./field-timer.js";
import { FieldColorFilterState, WEB_CLEAR_COLOR_FILTER, startFieldFlash, pollFieldFlash,
  type FieldFlashTask } from "./field-screen-effects.js";
import { WEB_FIELD_STORY_RUNTIME, hasFieldStoryRuntime, fieldScreenEffectsBinding,
  bindFieldStoryTimer, fieldTimerOriginContent, restoreFieldStoryRuntime,
  bindFieldStoryShake, restoreFieldStoryShake,
  type FieldStoryRuntimeSnapshot, type FieldTimerOriginContent } from "./field-story-runtime.js";
import { FieldCameraShakeState, type FieldCameraShakePolicy } from "./field-camera-shake.js";
import type { FieldCameraPathProgress } from "./field-camera-path.js";
import { assertFieldEventSaveAdmission } from "./field-auto-save.js";
import { audioReadinessTrack, pollAudioReadiness, type AudioReadinessPort } from "./audio-readiness.js";
import { projectPlayerVisibility } from "./player-visibility.js";
import { FieldFadeState, type FieldFadeSnapshot } from "./field-fade.js";
import { FieldCameraHost, type FieldCameraViewport } from "./field-camera-host.js";
import type { FieldCameraState, FieldCameraLerp, FieldCameraLerpProgress } from "./field-camera.js";
import { fieldCameraView, fieldCameraWorldToCell, fieldCameraCellToWorld,fieldCameraWorldToContinuousCell } from "./field-camera.js";
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
import { canonicalCell, projectFieldMapStep, validateFieldMapTopology,
  type FieldMapTopology, type FieldMapStep } from "./field-map-topology.js";
import { parseMapEntryViewPlan, type MapEntryViewPlan } from "./map-view.js";
import { frameworkWorldMapPresentation } from "./development-profile.js";
import { validateWorldTerrain, worldTerrainCollisionMask } from "./world-terrain.js";
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
import { FieldMobControls, fieldMobColorBinding, validateMobPolicy, tickMobColor, cloneMobColor, parseMobControlCommand, type FieldMobCheckpoint, type FieldMobColor, type FieldMobControlOp, type WebFlatMobColorFilter } from "./field-mob-controls.js";
export type Motion = FieldActorMotion;
export type FieldDirectionInputResult = { kind: "movement" } |
  { kind: "door"; entityId: string; regionId: string } |
  { kind: "facing" } | { kind: "rejected" };
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
  /** Component owned by this actual Actor instance, never its ground transform. */
  birdView?: FieldBirdViewActorPose;
  mobColor?: FieldMobColor;
};
type PlacedActor = Actor & { layer: number; direction: Direction; asset: string };
type NpcActivityRuntime = {
  actor: Actor; binding: FrameworkNpcActivityBinding; state: FieldNpcActivityState;
  motion: Motion | null; ticket: FieldNpcActivityTicket | null;
};
function freezeNpcMotion(motion: Motion | null): Motion | null {
  if (motion) { Object.freeze(motion.from); Object.freeze(motion.to); Object.freeze(motion); }
  return motion;
}
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
    skyboxPresentation?: FieldSkyboxSnapshot;
    birdViewActors?: FieldBirdViewActorCheckpoint;
    mobControls?: FieldMobCheckpoint;
    puppetReplacement?: FieldPuppetReplacementState;
    collision: FieldPuppetCollisionState;
    updateMask: number;
    cameraOffset: Point;
    completedScript: { name: string; leaderId: number | null; assignments: boolean[] } | null;
  } | null;
};
export type FieldCheckpoint = FieldCheckpointState & (
  { kind: "idle-field-v17"; scriptAnimations: SourceFieldScriptAnimationState; sourceMessageValues?: SourceMessageFeeSnapshot; contentInvalidations?: FieldContentInvalidationsCheckpoint; assignedNpcRoutes?: AssignedRoutesCheckpoint; storyRuntime?: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint }
  | { kind: "event-field-v8"; scriptAnimations: SourceFieldScriptAnimationState; sourceMessageValues?: SourceMessageFeeSnapshot; contentInvalidations?: FieldContentInvalidationsCheckpoint; assignedNpcRoutes?: AssignedRoutesCheckpoint; storyRuntime?: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint; execution: FieldEventCheckpoint }
  |   { kind: "idle-field-v15"; contentInvalidations: FieldContentInvalidationsCheckpoint; assignedNpcRoutes?: AssignedRoutesCheckpoint; storyRuntime?: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint }
  | { kind: "event-field-v6"; contentInvalidations: FieldContentInvalidationsCheckpoint; assignedNpcRoutes?: AssignedRoutesCheckpoint; storyRuntime?: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint; execution: FieldEventCheckpoint }
  |
  { kind: "idle-field-v16"; sourceMessageValues: SourceMessageFeeSnapshot; contentInvalidations?: FieldContentInvalidationsCheckpoint; assignedNpcRoutes?: AssignedRoutesCheckpoint; storyRuntime?: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint } |
  { kind: "event-field-v7"; sourceMessageValues: SourceMessageFeeSnapshot; contentInvalidations?: FieldContentInvalidationsCheckpoint; assignedNpcRoutes?: AssignedRoutesCheckpoint; storyRuntime?: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint; execution: FieldEventCheckpoint } |
  { kind: "idle-field-v10" } | { kind: "event-field-v1"; execution: FieldEventCheckpoint }
  | { kind: "idle-field-v11"; viewPlan: MapEntryViewPlan }
  | { kind: "event-field-v2"; viewPlan: MapEntryViewPlan; execution: FieldEventCheckpoint }
  | { kind: "idle-field-v12"; viewPlan?: MapEntryViewPlan; npcActivities: FieldNpcActivitiesCheckpoint }
  | { kind: "event-field-v3"; viewPlan?: MapEntryViewPlan; npcActivities: FieldNpcActivitiesCheckpoint; execution: FieldEventCheckpoint }
  | { kind: "idle-field-v14"; assignedNpcRoutes: AssignedRoutesCheckpoint; storyRuntime?: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint }
  | { kind: "event-field-v5"; assignedNpcRoutes: AssignedRoutesCheckpoint; storyRuntime?: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint; execution: FieldEventCheckpoint }
  | { kind: "idle-field-v13"; storyRuntime: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint }
  | { kind: "event-field-v4"; storyRuntime: FieldStoryRuntimeSnapshot; viewPlan?: MapEntryViewPlan; npcActivities?: FieldNpcActivitiesCheckpoint; execution: FieldEventCheckpoint }
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
  /** One bank on the existing Core/Task; no EventState or session register owner. */
  generalRegisters: FieldCoreRegisters;
  id: number;
  script: string;
  pc: number;
  stack: number[];
  actor: string;
  sourceEntityId: number | null;
  wait: number;
  skyboxWait: { op:Extract<Op,{kind:"field-skybox-scroll"}>;program:Op[];webPC:number;fingerprint:string;registers:FieldCoreRegisters;owner:FieldSkyboxState } | null;
  standaloneWait: { op: Extract<Op, { kind: "standalone-wait" }>; program: Op[];
    webPC: number; fingerprint: string; registers: FieldCoreRegisters } | null;
  /** null is the main core (or the external treasure coroutine). */
  slot: number | null;
  state: "awake" | "ready";
  range: FieldTaskRange;
  lastClock: number;
  puppetWait: Extract<Op, { kind: "exec-puppets" | "finish-puppets" }> | null;
  scriptShop: { id: number; pc: number; op: Extract<Op, { kind: "field-script-shop" }>;
    identity: string; closed: boolean } | null;
  fadeWait: Extract<Op, { kind: "field-fade" }> | null;
  screenBackdropWait:Extract<Op,{kind:"field-screen-presentation"}>|null;
  colorFadeWait: Extract<Op, { kind: "field-color-fade" }> | null;
  flashWait: { op: Extract<Op, { kind: "field-flash" }>; cursor: FieldFlashTask } | null;
  cameraPath: { op: Extract<Op, { kind: "field-script-motion" | "field-puppet-route" }>; progress: FieldCameraPathProgress } | null;
  cameraLerp: { op: Site; command: FieldCameraLerp;
    progress: FieldCameraLerpProgress } | null;
  scriptMove: Extract<Op, { kind: "field-script-motion" | "field-puppet-route" }> | null;
  birdViewMove: { op: Extract<Op, { kind: "field-bird-view-move" }>; registers: FieldCoreRegisters;
    actor: Actor; native: NativeFieldActorData; entity: NativeFieldActorData["entity"] } | null;
  scriptLerp: { op: Extract<Op, { kind: "field-script-motion" }>; progress: FieldScriptLerpProgress } | null;
  remaining: number;
  move: Extract<Op, { kind: "move" }> | null;
  animationWait: boolean;
  animationRepeat: { op: Extract<Op, { kind: "animation-play" }>; fingerprint: string;
    script: string; program: Op[]; webPC: number; actorId: string; actor: Actor | undefined;
    nativeEntity: NonNullable<Actor["native"]>["entity"] | null; sourceEntity: FieldEntity | undefined;
    registers: FieldCoreRegisters } | null;
  audioWait: Extract<Op, { kind: "bgm-ready" | "bgm-sync" }> | null;
  bgmReplay: { op: Extract<Op, { kind: "bgm-replay" }>; handle: StaticAudioReplay } | null;
  /** Source first-clock yield; no pending save or independent save owner. */
  autoSaveWait: Extract<Op, { kind: "event-save" }> | null;
  sourceMessageWait: { op: Extract<Op, { kind: "source-message" }>; cursor: SourceMessageTaskCursor | null } | null;
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
      /** Source Encount snapshot; it carries no mutable actor or RNG owner. */
      sourceEncounter?: SourceEncounterRequest;
      sourceBoss?: SourceBossEncounterRequest;
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
export type PreparedFieldSourceEncounter = {
  readonly request: SourceEncounterRequest;
  readonly battleEntryContext: ReturnType<typeof projectFieldEntryContext>;
  validate(): void;
  commitWith(publishBattle: () => void): void;
};
export type FieldGameOptions = {
  /** Immutable catalog context supplied by the existing GameSession owner. */
  contentInvalidations?: FieldContentInvalidationCatalog;
  /** Explicit Web controller, never native search/raycast admission. */
  retainedWorldTransportation?: import("./world-transportation-entry.js").WebRetainedWorldTransportation;
  assignedNpcRoutes?: WebAssignedRoutePolicy;
  /** Explicit Web path search on the existing puppet Actor.motion owner. */
  puppetRoutes?: WebPuppetRoutePolicy;
  /** Trusted explicit Web selection policy; absent remains native-unknown. */
  sourceEncounter?: FieldSourceEncounterPort;
  sourcePartySelection?: WebSourcePartySelection;
  sourcePartySelectionPort?: FieldSourcePartySelectionPort;
  sourceBossEntry?: WebSourceBossEntry;
  sourceBattleResult?: FieldBattleResultPort;
  /** Internal unpublished restore shell; it must never allocate/replay FX. */
  deferLogicalEffectRestore?: true;
  skyboxPresentation?: WebFlatSkybox;
  screenPresentation?: WebFieldScreenPresentation;
  storyRuntimeSeed?: FieldStoryRuntimeSnapshot;
  /** Explicit Web presentation stream. Saved state and source code cannot grant it. */
  cameraShake?: FieldCameraShakePolicy;
  viewChange?: WebFlatFieldViewChange;
  worldAutoMove?:WebFlatWorldAutoMove;
  worldAutoTasks?: WebFlatWorldAutoTasks;
  birdViewActors?: WebFlatBirdViewActors;
  mobColorFilter?: WebFlatMobColorFilter;
  storyTimerOrigin?: FieldTimerOriginContent;
  /** Explicit particle/material host. Content parsing never grants one. */
  fieldEffects?: FieldEffectRuntimeHost;
  /** World-owned lease; a prepared map never allocates another live pool. */
  fieldEffectMap?: FieldEffectMap;
  /** The private source-session candidate installs native actors before any
   * script/input. Suppresses temporary legacy NPC creation in that candidate. */
  nativeActorPreparation?: true;
  /** Exact World field identity; private/discarded/retired maps cannot clock
   * autonomous actors even when a stale caller retains the Field instance. */
  npcActivityClock?: () => boolean;
  sourceMessageEffects?: { prepare(effects: readonly SourceMessageEffect[]): () => void };
  messageFees?: SourceMessageFeeCatalog;
  messageFeeSeed?: SourceMessageFeeSnapshot;
  reservedScripts?: FieldReservedScriptPort;
  sourceMessageSequence?: { prepare(): { context: SourceMessageSequenceContext; validate(): void } };
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
  /** The host must additionally know Behaviour.enabled and ancestor activity.
   * Saved visibility cannot grant this native condition-leader capability. */
  conditionLeaderActivity?: FieldConditionActivityPort;
  ownedConditions?: FieldOwnedConditionPort;
  recovery?: FieldRecoveryPort;
  scriptRandom?: FieldScriptRandomPort;
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
  walkEncounters?: {
    /** Map admission requires this read-only query. Standalone movement-only
     * adapters keep their existing prepareStep contract. */
    assertPolicy?(mapId: number, policy: FrameworkWalkEncounterPolicy | null): void;
    prepareStep(mapId: number, policy: FrameworkWalkEncounterPolicy): WalkEncounterPrepared;
  };
  partyAppearance?: { catalog: PartyActorCatalog; current(): PartyAppearanceCandidate };
  transportation?: FieldTransportationPort;
  transportationTimestamp?: () => string;
  /** Read the current owned-state draft; unsupported step effects must not disappear. */
  movementBlocker?: (transportationId: number | null, manual: boolean) => string | null;
};
const contains = (e: FieldEntity, p: Point) =>
  p.x >= e.x && p.x < e.x + e.width && p.y >= e.y && p.y < e.y + e.height;
export class FieldGame {
  readonly puppetRoutePolicy: WebPuppetRoutePolicy | undefined;
  private puppetRouteJournal: { phase: "started" | "same-cell" | "task-completed"; site: Site; actorId: string; atMilliseconds: number }[] = [];
  /** Execution evidence only; not a saved cursor, path, or authority owner. */
  get puppetRouteExecutions() { return structuredClone(this.puppetRouteJournal); }
  private readonly contentInvalidations: FieldContentInvalidations;
  get contentInvalidationsSnapshot(): FieldContentInvalidationsCheckpoint | null { return this.contentInvalidations.snapshot(); }
  /** All current menu/battle queries use the same Field register. Source entry
   * may supply its captured pre-sync context without losing script mutations. */
  projectBattleInvalidContents(catalog: BattleEntryCatalog, transportations: readonly { id: number; type: number }[],
    state: BattleFieldState = this.battleEntryContext.state) {
    return projectBattleFieldState(catalog, state, transportations, this.contentInvalidations.invalidTypes(catalog));
  }
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
    const cameraMotion = !!this.camera && (op.kind === "position"
      ? !!op.cameraCommand && this.content.cameraHost?.callbacks === "fresh-normal-field-v1" &&
        (op.cameraCommand.mode !== 1 || !!(this.options.puppetActors && this.nativeActorProviders && this.nativeActorBindings && this.nativeRuntime?.mapLifecycle))
      : op.kind !== "field-script-motion" ||
        op.command.animation === "" && (op.command.kind === "lerp" ? op.command.layer === 0 :
          this.content.cameraHost?.callbacks === "fresh-normal-field-v1"));
    const legacyMove = op.kind === "field-script-motion" && op.command.kind === "move" && !!actor &&
      !actor.native && !this.options.nativeActorPreparation && !this.options.puppetActors &&
      !this.content.scriptPuppetContexts && op.command.animation === "" && op.command.speedId !== null;
    const actorMotion = legacyMove || !!(actor?.native && this.nativeActorProviders && this.camera &&
      this.content.cameraHost?.callbacks === "fresh-normal-field-v1");
    const actorControl = op.kind === "actor-visibility"
      ? actorKind === "camera" ? !!this.camera : actorKind === "effect" ? !!this.effects
        : actor?.native ? !!this.options.puppetActors
          : !!actor && !this.options.nativeActorPreparation && !this.options.puppetActors && !this.content.scriptPuppetContexts
      : !!(actor?.native && this.nativeActorProviders && this.camera && this.options.puppetActors &&
        this.content.cameraHost?.callbacks === "fresh-normal-field-v1");
    const context: FieldAdmissionContext = { actorKind, providers: {
      contentInvalidations: presence(!!this.options.contentInvalidations),
      inventory: presence(typeof this.options.inventory?.prepare === "function"),
      messageNames: presence(typeof this.options.messageNames?.prepare === "function"),
      sourceMessageSequence: presence(typeof this.options.sourceMessageSequence?.prepare === "function"),
      messageValues: presence(this.options.messageFees !== undefined),
      recovery: presence(typeof this.options.recovery?.prepare === "function"),
      scriptRandom: presence(typeof this.options.scriptRandom?.prepare === "function"),
      ownedConditions: presence(typeof this.options.ownedConditions?.prepare === "function"),
      party: presence(typeof this.options.party?.prepare === "function"),
      roster: presence(typeof this.options.roster?.prepare === "function"),
      treasure: presence(!!this.options.treasure),
      transportation: presence(!!this.options.transportation),
      puppetRoster: presence(typeof this.options.puppetRoster?.current === "function"),
      sourceLeader: presence(typeof this.options.puppetActors?.read === "function"),
      scriptShop: presence(typeof this.options.shop?.validate === "function"),
      sourcePartySelection: presence(this.options.sourcePartySelection===WEB_SOURCE_PARTY_SELECTION && !!this.options.sourcePartySelectionPort && !!this.partyActors &&
        (!!this.player.native||this.content.developmentProfile?.kind==='framework-development-v1')),
      partyActors: presence(!!this.partyActors),
      audioReadiness: presence(typeof this.options.audioReadiness?.isReady === "function"),
      soundPresentation: presence(typeof this.options.soundPresentation?.isPresented === "function"),
      actorControl: presence(actorControl),
      mobColorFilter: presence(this.mobControlsEnabled && !!this.nativeActorBindings && !!this.nativeRuntime?.mapLifecycle && !!this.options.puppetActors),
      birdViewActors: presence(!!actor && this.birdViewActorsEnabled && !!actor.native && actor.native.entity.character &&
        !actor.native.entity.riding && !!this.nativeActorBindings && !!this.nativeRuntime?.mapLifecycle && !!this.nativeActorProviders && !!this.camera),
      actorMotion: presence(actorMotion), cameraMotion: presence(cameraMotion), effectMotion: "missing",
      storyTimer: presence(this.timerState !== null),
      skyboxPresentation:presence(!!this.skyboxOwner&&!this.skyboxOwner.readiness&&!this.skyboxOwner.isRetired),
      screenPresentation:presence(!!this.screenPresentationState && !!fieldScreenPresentationBinding(this.content,this.options.screenPresentation)),
      screenEffects: presence(this.ordinaryScreenEffectsAvailable),
      cameraShake: presence(this.cameraShakeAvailable),
      viewChange: presence(this.options.viewChange !== undefined && !!this.camera && !!this.partyActors && !!this.nativeActorBindings && !!this.nativeRuntime?.mapLifecycle && !!this.nativeActorProviders && !!this.player.native && !!fieldViewBinding(this.content,this.options.viewChange)),
      worldAutoMove:presence(this.#worldAutoMovePolicy===WEB_FLAT_WORLD_AUTO_MOVE&&this.content.developmentProfile?.worldAutoMove===this.#worldAutoMovePolicy),
      worldAutoTasks: presence(this.#worldAutoPolicy===WEB_FLAT_WORLD_AUTO_TASKS && this.worldAutoPose!==null && !this.#worldAutoRetired),
      eventSaveCompletion: "unknown", battleHandoff: "unknown",
      assignedNpcRoutes: presence(this.options.assignedNpcRoutes === WEB_ASSIGNED_ROUTE_POLICY),
      sourceBossEntry: presence(this.options.sourceBossEntry===WEB_SOURCE_BOSS_ENTRY && !!this.nativeActorBindings && !!this.nativeRuntime?.mapLifecycle && !!this.player.native),
      sourceBattleResult: presence(this.options.sourceBattleResult?.policy===WEB_COMMITTED_BATTLE_RESULT && typeof this.options.sourceBattleResult.prepare==='function'),
      puppetRoutes: presence(this.puppetRoutePolicy === WEB_PUPPET_ROUTE_POLICY && (actorKind === "actor" && actorMotion || actorKind === "camera" && cameraMotion)),
      sourceEncounter: presence(this.options.sourceEncounter?.policy === WEB_SOURCE_ENCOUNTER_POLICY &&
        !!this.nativeActorBindings && !!this.nativeRuntime?.mapLifecycle && !!this.camera &&
        typeof this.options.sourceEncounter.prepare === "function"),
    }, ...(refreshRequired === undefined ? {} : { refreshRequired }) };
    // A helper's source flag cannot stand in for the active event root.
    const visual = this.eventRootScript === null ? undefined : this.content.scriptSystemFlags?.[this.eventRootScript];
    if (visual?.keepBadStatusVisual !== undefined) context.keepBadStatusVisual = visual.keepBadStatusVisual;
    context.conditionLeaderAvailable = !!(this.player.native && this.partyActors && this.options.partyAppearance &&
      this.options.puppetActors && this.nativeActorBindings && this.nativeRuntime?.animationKeys &&
      this.nativeActorProviders && this.camera && this.content.cameraHost && this.nativeRuntime.mapLifecycle &&
      typeof this.options.conditionLeaderActivity?.prepare === "function");
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
  private readonly feeJournal: { site: Site; value: SourceMessageFeeSnapshot; atMilliseconds: number }[] = [];
  get sourceMessageFeeExecutions() { return structuredClone(this.feeJournal); }
  private readonly scriptRandomJournal: { site: Site; value: number; atMilliseconds: number }[] = [];
  get scriptRandomExecutions() { return structuredClone(this.scriptRandomJournal); }
  readonly transportationExecutions: { site: Site; command: FieldTransportationCommand; currentId: number | null;
    omissions: readonly string[] }[] = [];
  private transportationExecuting = false;
  private mapScrollOffset: Readonly<Point>;
  get cameraOffset(): Readonly<Point> { return this.mapScrollOffset; }
  private readonly camera: FieldCameraHost | null;
  private readonly effects: FieldEffects | FieldEffectMap | null;
  /** Read-only logical projection; not a particle/RNG checkpoint codec. */
  get fieldEffectsSnapshot(): FieldEffectState | null { return this.effects?.snapshot() ?? null; }
  private get logicalEffectsPersistent(): boolean {
    return this.content.developmentProfile?.logicalFieldEffects === WEB_LOGICAL_FIELD_EFFECTS &&
      this.options.fieldEffectMap?.logicalPolicy === WEB_LOGICAL_FIELD_EFFECTS &&
      this.content.fieldEffects?.webPolicy?.kind === WEB_LOGICAL_FIELD_EFFECTS;
  }
  get fieldEffectsDisplayPolicy(): typeof WEB_LOGICAL_FIELD_EFFECTS | null {
    return this.content.developmentProfile?.logicalFieldEffects === WEB_LOGICAL_FIELD_EFFECTS &&
      this.content.fieldEffects?.webPolicy?.kind === WEB_LOGICAL_FIELD_EFFECTS &&
      (this.options.fieldEffectMap?.logicalPolicy === WEB_LOGICAL_FIELD_EFFECTS ||
        this.effects instanceof FieldEffects && this.effects.logicalPolicy === WEB_LOGICAL_FIELD_EFFECTS)
      ? WEB_LOGICAL_FIELD_EFFECTS : null;
  }
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
  readonly #worldAutoPolicy:WebFlatWorldAutoTasks|undefined;
  readonly #worldAutoMovePolicy:WebFlatWorldAutoMove|undefined;
  #worldAutoActorMotion:{actor:Actor;entity:NonNullable<Actor["native"]>["entity"];motion:Motion;expected:string}|null=null;
  #worldAutoDummyMotion:Motion|null=null;
  #worldAutoDummyExpected:string|null=null;
  #worldAutoQueue=createWorldAutoQueue();
  #worldAutoPrepared=false;
  #worldAutoRetired=false;
  readonly worldAutoTaskJournal:{action:'add'|'start'|'complete'|'retire';tickets:number[];atMilliseconds:number;site?:Site}[]=[];
  get worldAutoPose():WorldAutoPose|null {
    const state=this.camera?.snapshot();return state?.kind==='field-camera-v4'?state.worldAuto:null;
  }
  get worldAutoTaskSnapshot(){return this.worldAutoPose?{...structuredClone(this.#worldAutoQueue),prepared:this.#worldAutoPrepared,retired:this.#worldAutoRetired,...(this.#worldAutoActorMotion?{actorMovement:{actor:this.#worldAutoActorMotion.actor.id,motion:structuredClone(this.#worldAutoActorMotion.motion),expected:this.#worldAutoActorMotion.expected}}:{}),...(this.#worldAutoDummyMotion?{dummyMovement:structuredClone(this.#worldAutoDummyMotion),dummyExpected:this.#worldAutoDummyExpected}:{})}:null;}
  private get worldAutoTasksBusy(){return this.#worldAutoQueue.tasks.length>0||this.#worldAutoActorMotion!==null||this.#worldAutoDummyMotion!==null;}
  private get worldAutoMovementBusy(){return this.#worldAutoQueue.tasks.some(t=>t.channel==='movement')||this.#worldAutoActorMotion!==null||this.#worldAutoDummyMotion!==null;}
  /** World preparation may execute source Add/Start but cannot tick a private
   * candidate before its existing map publication. */
  holdWorldAutoTasks():void {if(this.#worldAutoQueue.tasks.length||this.#worldAutoRetired)throw new Error('Cannot prepare an active world auto-task owner');this.#worldAutoPrepared=true;}
  publishWorldAutoTasks():void {this.#worldAutoPrepared=false;}
  retireWorldAutoTasks():void {
    if(this.#worldAutoRetired)return;
    const tickets=this.#worldAutoQueue.tasks.map(t=>t.ticket);this.#worldAutoQueue={...this.#worldAutoQueue,revision:this.#worldAutoQueue.revision+1,tasks:[]};
    if(this.#worldAutoActorMotion?.actor.motion===this.#worldAutoActorMotion?.motion&&this.#worldAutoActorMotion){this.#worldAutoActorMotion.actor.motion=null;this.#worldAutoActorMotion.actor.animation?.stop();}
    this.#worldAutoActorMotion=null;this.#worldAutoDummyMotion=null;this.#worldAutoDummyExpected=null;
    this.#worldAutoRetired=true;this.worldAutoTaskJournal.push({action:'retire',tickets,atMilliseconds:this.time});
  }
  private applyWorldAutoTask(op:Extract<Op,{kind:'field-world-auto-task'}>):void {
    const pose=this.worldAutoPose,binding=worldAutoBinding(this.content,this.#worldAutoPolicy);
    if(this.#worldAutoRetired||this.#worldAutoPolicy!==WEB_FLAT_WORLD_AUTO_TASKS||this.options.worldAutoTasks!==this.#worldAutoPolicy||!pose||!binding||canonical(pose.binding)!==canonical(binding))
      throw new Error('World auto tasks require the current runtime policy, trusted flat content and camera owner');
    const command=parseFieldWorldAutoCommand(op.command);if(command.kind==='add-movement')this.assertWorldAutoMovement();
    const next=addWorldAutoCommand(this.#worldAutoQueue,pose,command,{script:op.script,index:op.index,source:op.source});
    this.#worldAutoQueue=next;this.worldAutoTaskJournal.push({action:command.kind==='start'?'start':'add',tickets:command.kind==='start'?next.tasks.map(t=>t.ticket):[next.nextTicket-1],
      atMilliseconds:this.time,site:structuredClone({script:op.script,index:op.index,source:op.source})});
  }
  private assertWorldAutoMovement():void {
    worldAutoMoveBinding(this.content,this.#worldAutoMovePolicy);
    if(this.options.worldAutoMove!==this.#worldAutoMovePolicy)throw Error('World auto-movement runtime changed');
    if(this.#worldAutoActorMotion){const held=this.#worldAutoActorMotion;
      if(this.actors[held.actor.id]!==held.actor||held.actor.native?.entity!==held.entity||held.actor.motion!==held.motion||canonical(held.entity.position)!==held.expected)
        throw Error('World auto-movement actor owner changed');}
    if(this.#worldAutoDummyMotion&&canonical({position:this.camera?.snapshot().dummy.position,layer:this.camera?.snapshot().dummy.layer})!==this.#worldAutoDummyExpected)
      throw Error('World auto-movement dummy owner changed');
  }
  private advanceWorldAutoTasks():void {
    if(!this.worldAutoTasksBusy||this.#worldAutoPrepared||this.#worldAutoRetired||this.options.npcActivityClock&&!this.options.npcActivityClock())return;
    const pose=this.worldAutoPose,binding=worldAutoBinding(this.content,this.#worldAutoPolicy);
    if(!pose||!this.camera||this.options.worldAutoTasks!==this.#worldAutoPolicy||!binding||canonical(pose.binding)!==canonical(binding))throw new Error('World auto-task camera/content/clock owner changed');
    if(this.worldAutoMovementBusy)this.assertWorldAutoMovement();
    const before=this.#worldAutoQueue,next=advanceWorldAutoQueue(before,pose),state=this.camera.snapshot();
    if(state.kind!=='field-camera-v4')throw Error('World auto movement lost its camera');state.worldAuto=next.pose;
    let dummy=this.#worldAutoDummyMotion,actorPlan:{actor:Actor;motion:Motion;animation:ActorAnimation;direction:Direction}|null=null;
    for(const request of next.movements){
      this.assertWorldAutoMovement();
      // The source's absent following entity branch performs no MoveTo. The
      // task clock still progresses and retires; no actor is manufactured.
      if(state.target===null)continue;
      if(this.collisionSwitches.mapColliders||this.collisionSwitches.entityCollision)
        throw Error('World auto movement with active native collision/raycast remains unadmitted');
      const definition=this.content.cameraHost!;
      if(state.target==='dummy'){
        if(dummy)continue;
        if(this.tasks.some(t=>!t.done&&(t.cameraLerp||t.cameraPath)))throw Error('World auto movement conflicts with a scripted dummy path');
        const from=fieldCameraWorldToContinuousCell(definition.mapRange,{x:state.dummy.position.x,y:state.dummy.position.y});
        const plan=prepareFlatWorldAutoSegment(request.command,request.rotation,{x:from.x+definition.mapRange.x,y:from.y+definition.mapRange.y},definition.mapRange,definition.loop);
        dummy=plan?.motion??null;continue;
      }
      const actor=this.player;
      if(!actor.native||!this.nativeRuntime||!this.nativeActorProviders||!actor.animation||actor.layer===null||actor.layer>2)
        throw Error('World auto movement requires its actual following player/native/media owner');
      requireFieldTransportPose(actor.native.entity,this.transportationPresentation);
      if(actor.motion||actorPlan)continue;
      const plan=prepareFlatWorldAutoSegment(request.command,request.rotation,{x:actor.x,y:actor.y},definition.mapRange,definition.loop);
      if(!plan)continue;
      const animation=actor.animation.clone();animation.move(plan.direction,plan.motion.duration/1000);animation.frame();
      actorPlan={actor,motion:plan.motion,animation,direction:plan.direction};
    }
    // Dummy progress uses the same motion integrator and the existing Camera
    // state. No second dummy transform or new save authority is introduced.
    if(dummy){const tick=prepareFieldActorMotionTick(dummy,null,10),range=this.content.cameraHost!.mapRange,
      point=this.mapTopology?canonicalCell(this.mapTopology,tick.point):tick.point,
      world=fieldCameraCellToWorld(range,{x:point.x-range.x,y:point.y-range.y},0);
      state.dummy.position={...world,z:state.dummy.position.z};dummy=tick.motion;}
    if(next.queue.revision===before.revision&&!dummy&&!this.#worldAutoDummyMotion&&!actorPlan)return;
    const camera=this.camera.prepareState(state);
    if(!camera.commitWith(()=>{if(this.#worldAutoQueue!==before||this.#worldAutoRetired||this.#worldAutoPrepared)return false;
      this.#worldAutoQueue=next.queue;this.#worldAutoDummyMotion=dummy;this.#worldAutoDummyExpected=dummy?canonical({position:state.dummy.position,layer:state.dummy.layer}):null;
      if(actorPlan){const {actor,motion,animation,direction}=actorPlan;actor.direction=direction;actor.animation=animation;actor.motion=motion;
        this.#worldAutoActorMotion={actor,entity:actor.native!.entity,motion,expected:canonical(actor.native!.entity.position)};}
      return true;}))throw Error('Stale world auto-task tick');
    if(next.completed.length)this.worldAutoTaskJournal.push({action:'complete',tickets:next.completed,atMilliseconds:this.time});
  }
  private get currentPartyViewType():0|1|2 {
    const state=this.camera?.snapshot();return (state?fieldCameraView(state)?.mapViewType:undefined) ?? (this.content.entry.partyActors?.context.camera.mapViewType ?? 0) as 0|1|2;
  }
  /** Detached presentation of the one camera view; no parallel latest-command owner. */
  get currentView() {
    const state=this.camera?.snapshot();return state?structuredClone(fieldCameraView(state)):null;
  }
  readonly viewChangeJournal:{requestedViewType:0|1;mapViewType:0|1|2;branchReturn:boolean;wait:boolean;timeScale:number;atMilliseconds:number}[]=[];
  /** Validate a view's controller applicability without changing transport,
   * release flags, parking, actors, rider caches or native renderer bindings. */
  private viewTransportation(policy:WebFlatFieldViewChange):1|12 {
    const context=this.partyActors?.checkpoint().context,entity=this.player.native?.entity;
    if(!context||!entity)throw new Error("View transportation has no current native actor owner");
    const transport=context.currentTransport;
    if((transport===null||transport.typeId===1&&transport.id===this.transportationId)&&
      !context.player.riding&&!entity.riding&&["absent","idle"].includes(entity.rideOnEntity))return 1;
    if(policy!==WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE||!transport||transport.id!==this.transportationId||!this.options.partyAppearance||!this.player.native)
      throw new Error("ChangeView transport/riding applicability is unresolved");
    assertRetainedGroundViewTransportation({policy:this.options.retainedWorldTransportation,viewPlan:this.content.entry.viewPlan,
      presentation:this.transportationPresentation,worldPresentation:frameworkWorldMapPresentation(this.content.developmentProfile),
      catalog:this.options.partyAppearance.catalog,context,
      actual:{id:this.player.id,fieldAssetId:this.player.native.fieldAssetId,riderAssetId:entity.riderAssetId,riding:entity.riding,rideOnEntity:entity.rideOnEntity}});
    const port=this.options.transportation;
    if(!port)throw new Error("Flat riding view has no current owned transportation source");
    const transports=new Transportations(port.catalog),identity=transports.identity(transport.id);
    if(canonical(identity)!==canonical({id:transport.id,type:transport.typeId,assetId:transport.fieldAssetId})||
      this.eventState.read(transports.releaseFlagRef(identity.id))!==1||!port.read().some(record=>record.id===identity.id))
      throw new Error("Flat riding view current transportation is unavailable or changed");
    const catalog=this.options.partyAppearance.catalog;
    for(const id of [context.player.fieldAssetId,context.player.riderFieldAssetId]){
      const row=id===null?null:catalog.assets[id],character=row&&this.content.characters[row.asset],keys=row&&this.nativeRuntime?.animationKeys?.assets[row.asset];
      if(!row||!character||!keys||canonical(keys.source)!==canonical(character.source)||
        id===context.player.fieldAssetId&&canonical(entity.animation?.character)!==canonical(character))
        throw new Error("Flat riding view inner/outer media or animation source is unavailable");
    }
    return 12;
  }
  /** Prepare all fallible material/identity reads before camera, party and
   * collision writes. Web flat walking never manufactures an airship entity. */
  prepareViewChange(raw:FieldViewChangeCommand) {
    const command=parseFieldViewChangeCommand(raw), camera=this.camera, party=this.partyActors;
    const viewPolicy=this.options.viewChange;validateFieldViewChangePolicy(viewPolicy);
    if(viewPolicy===undefined||!camera||!party||!this.nativeActorBindings||
      !this.nativeRuntime?.mapLifecycle||!this.nativeActorProviders||!this.player.native||this.stop)
      throw new Error("Bound field view/camera/party/native host is unavailable");
    const binding=fieldViewBinding(this.content,this.options.viewChange);
    if(!binding)throw new Error("Source world predicate for ChangeView is unavailable");
    const nativeBindings=this.nativeActorBindings,nativeRuntime=this.nativeRuntime,providerPort=this.nativeActorProviders,appearanceHost=this.options.partyAppearance;
    const factory=nativeRuntime.mapLifecycle!.factory,catalogOwner=appearanceHost?.catalog;
    const sourcesBefore=canonical({bindings:nativeBindings,runtime:nativeRuntime,catalog:catalogOwner??null});
    const retainedPolicy=this.options.retainedWorldTransportation,transportPort=this.options.transportation;
    let ownedTransportationBefore:string|null=null;
    const sourceCurrent=()=>this.options.viewChange===viewPolicy&&this.options.retainedWorldTransportation===retainedPolicy&&this.nativeActorBindings===nativeBindings&&
      this.nativeRuntime===nativeRuntime&&nativeRuntime.mapLifecycle?.factory===factory&&
      this.nativeActorProviders===providerPort&&this.options.partyAppearance===appearanceHost&&appearanceHost?.catalog===catalogOwner&&
      (ownedTransportationBefore===null||this.options.transportation===transportPort&&!!transportPort&&canonical({catalog:transportPort.catalog,records:transportPort.read()})===ownedTransportationBefore)&&
      canonical({bindings:nativeBindings,runtime:nativeRuntime,catalog:catalogOwner??null})===sourcesBefore;
    const before=this.captureMapPublication(), next=camera.prepareView(command);
    // The native non-world Bird branch returns before transport/material reads.
    if(next.branchReturn){let used=false;return {branchReturn:true,validate:()=>{if(used||!sourceCurrent()||!before())throw new Error("Stale field view branch");next.validate();},commit:()=>{
      if(used||!sourceCurrent()||!before())throw new Error("Stale field view branch");next.validate();used=true;
      this.viewChangeJournal.push({...command,mapViewType:this.currentPartyViewType,branchReturn:true,atMilliseconds:this.time});
    }};}
    const context=party.checkpoint().context, transport=context.currentTransport;
    const viewTransport=this.viewTransportation(viewPolicy);
    if(viewTransport===12)ownedTransportationBefore=canonical({catalog:transportPort!.catalog,records:transportPort!.read()});
    if(context.companion!==null||
      Object.values(this.actors).some(actor=>actor.motion!==null)||this.hasUnfinishedInterpolation()||this.actorVisibilityBusy)
      throw new Error("ChangeView transport/riding/companion or active actor lifecycle is unresolved");
    const providers=this.nativeActorProviders(), contextId=providers.mapRenderContext;
    const providerProjection=(value:FieldPuppetHostProviders)=>{const {footAttribute:_,applyViewProperties:__,...data}=value;return canonical({data,
      properties:Object.values(this.actors).filter(actor=>actor.native).map(actor=>value.applyViewProperties?.(actor.native!.entity.layer)??null)});};
    const providerBefore=providerProjection(providers);
    if(providers.transportationType!==viewTransport&&!(viewTransport===1&&providers.transportationType===null)||
      viewTransport===12&&providers.transportationPresentation!=="framework-development"||!contextId||!providers.applyViewProperties)
      throw new Error("ChangeView requires the trusted flat ground/material host");
    for(const actor of Object.values(this.actors))if(actor.native){
      const entity=actor.native.entity;
      // Existing renderer registrations and per-actor material bindings remain
      // exact in this Web host. Native Bird RT/airship registrations are not
      // called or represented as an empty callback.
      if(entity.viewBinding===null && canonical(entity.position)===canonical(this.nativeRuntime.mapLifecycle.factory.offMapPosition) &&
        entity.layer===0 && entity.direction===null && !entity.moving)continue;
      if(entity.viewBinding===null||entity.viewBinding.map!==contextId||entity.viewBinding.layer!==entity.layer||
        canonical(entity.viewBinding.properties)!==canonical(providers.applyViewProperties(entity.layer)))
        throw new Error("ChangeView material/renderer registration is unresolved");
    }
    const mapViewType=fieldCameraView(next.state)?.mapViewType ?? 0;
    const partyWrite=party.prepareView(mapViewType), catalog=this.options.partyAppearance!.catalog;
    const asset=transport?.typeId===1||transport===null?context.player.fieldAssetId:transport.fieldAssetId;
    if(asset===null)throw new Error("ChangeView actual player asset is unavailable");
    const offset=Object.freeze(partyActorCameraOffset(catalog,asset,{...context.camera,mapViewType}));
    const collision=!binding.isWorld ? {...this.collisionSwitches,mapColliders:true,entityCollision:true} : this.collisionSwitches;
    let used=false;
    const validate=()=>{if(used||!sourceCurrent()||!before()||this.camera!==camera||this.partyActors!==party)throw new Error("Stale field view transaction");
      if(providerProjection(this.nativeActorProviders!())!==providerBefore)throw new Error("Stale field view material provider");
      partyWrite.validate();next.validate();if(!before())throw new Error("Stale field view preparation");};
    return {branchReturn:false,validate,commit:()=>{validate();used=true;
      // Final prepared commits only; camera's commitWith locks its revision.
      next.commitWith(()=>{partyWrite.commit();this.mapScrollOffset=offset;this.collisionSwitches=collision;return true;});
      this.viewChangeJournal.push({...command,mapViewType,branchReturn:false,atMilliseconds:this.time});
    }};
  }
  cameraProjection(viewport: FieldCameraViewport) {
    const shake = this.cameraShakeOffset;
    return this.camera?.projection({ ...viewport, effectOffset: {
      x: viewport.effectOffset.x + shake.x, y: viewport.effectOffset.y + shake.y } }) ?? null;
  }
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
  readonly mapTopology: FieldMapTopology | null;
  private readonly collisionMappings = new Map<number, number[]>();
  readonly actors: Record<string, Actor> = {};
  private nextVisibilityTimer = 1;
  private readonly visibilityTimers: {
    ticket: number; op: Extract<Op, { kind: "actor-visibility" }>; actor: Actor;
    entity: NonNullable<Actor["native"]>["entity"]; recordedSeconds: number; delaySeconds: number;
    programName: string; program: Op[]; webPc: number; instruction: Extract<Op, { kind: "actor-visibility" }>;
  }[] = [];
  private readonly visibilityJournal: { ticket: number | null; phase: "queued" | "applied";
    site: Site; actorId: string; atMilliseconds: number; visible: boolean; durationSeconds: number; delaySeconds: number }[] = [];
  get actorVisibilityExecutions() { return structuredClone(this.visibilityJournal); }
  private readonly finiteAnimationJournal: { phase: "started" | "replayed" | "completed";
    site: Site; actorId: string; repeatCount: number; remaining: number; atMilliseconds: number }[] = [];
  get finiteAnimationExecutions() { return structuredClone(this.finiteAnimationJournal); }
  get actorVisibilityBusy(): boolean {
    return this.visibilityTimers.length > 0 || Object.values(this.actors).some(actor => actor.native && actorFadeActive(actor.native.entity));
  }
  private readonly flatNpcBindings: ReturnType<typeof bindFieldNpcFlatProjections>;
  private readonly npcBindings: Map<string, FrameworkNpcActivityBinding>;
  private readonly npcActivities = new Map<string, NpcActivityRuntime>();
  private nextNpcEvent = 1;
  private readonly assignedRoutes = new Map<string, { actor: Actor; entity: NonNullable<Actor['native']>['entity'];
    definition: FieldNativeNpcDefinition; catalog: NonNullable<FieldContent['npcRoutes']>; fingerprint: string;
    program: AssignedRouteProgram; site: Extract<Op,{kind:'assign-npc-route'}>; programName: string; webPc: number; assignmentFingerprint: string; cursor: AssignedRouteCursor;
    motion: Motion|null; lerp: FieldScriptLerpProgress|null }>();
  private readonly assignedRouteJournal: { phase: 'assigned'|'replaced'|'execute'|'completed'|'restored'; actorId:string; routeId:number; instructionIndex:number; site:Site; atMilliseconds:number }[]=[];
  get assignedRouteExecutions(){return structuredClone(this.assignedRouteJournal);}
  get assignedRouteSnapshot() { return structuredClone([...this.assignedRoutes].map(([id,r])=>({id,
    routeId:r.program.routeId, site:r.site, cursor:r.cursor}))); }
  private get assignedCheckpoint(): AssignedRoutesCheckpoint|null {
    if(this.options.assignedNpcRoutes!==WEB_ASSIGNED_ROUTE_POLICY||!this.content.npcRoutes)return null;
    const rows=[...this.assignedRoutes.values()].map(r=>{this.assertAssignedRoute(r);return {actorId:r.actor.id,
      group:r.definition.group,routeId:r.program.routeId,script:r.programName,index:r.webPc,assignment:r.site,
      cursor:r.cursor,lerp:r.lerp,moving:r.actor.motion!==null};});
    const saved=captureAssignedRoutes(this.content.npcRoutes,rows);
    const checked=restoreAssignedRoutes(saved,this.content,this.entityList,this.time,this.options.assignedNpcRoutes);
    this.validateAssignedLerps(checked.rows,this.time);
    return saved;
  }
  private validateAssignedLerps(rows:RestoredAssignedRoute[],time:number):void {
    if(!rows.some(r=>r.row.lerp))return;
    if(!this.nativeActorProviders||!this.camera||!this.content.cameraHost)throw new Error('Missing assigned Lerp restore host');
    const c=this.camera.snapshot(),snapshot=readNativeFieldActors(this.actors,{id:this.cameraActorId,position:c.dummy.position,layer:c.dummy.layer});
    for(const r of rows){if(!r.row.lerp)continue;const action=r.program.instructions[r.row.cursor.index]!.action!;
      if(action.kind!=='move-lerp')throw new Error('Invalid assigned Lerp source');
      const result=projectFieldScriptLerp(snapshot,this.nativeActorProviders(),r.row.actorId,{kind:'lerp',x:action.x,y:action.y,
        layer:(action.layer+1) as 1|2|3,duration:action.duration,arcHeight:0,animation:action.animation},this.content.cameraHost.mapRange,r.row.lerp,time/1000);
      const prior=snapshot.actors.find(a=>a.id===r.row.actorId)!,next=result.snapshot.actors.find(a=>a.id===r.row.actorId)!;
      if(canonical(prior.position)!==canonical(next.position)||prior.layer!==next.layer)
        throw new Error('Saved assigned Lerp pose disagrees with its source cursor/clock');
    }
  }
  private installAssignedRoutes(rows:RestoredAssignedRoute[],time:number):void {
    if(!this.content.npcRoutes)throw new Error('Missing assigned route restore catalog');
    this.validateAssignedLerps(rows,time);
    for(const r of rows){const actor=this.actors[r.row.actorId];
      if(!actor?.native||actor.native.scope?.kind!=='map-npc'||actor.native.scope.group!==r.row.group||
         canonical(actor.native.scope.source)!==canonical(r.definition.source)||!this.activeGroups.has(r.row.group)||
         (actor.motion!==null)!==r.row.moving||this.npcActivities.has(actor.id))throw new Error('Restored assigned route lost its existing native actor');
      this.assignedRouteJournal.push({phase:'restored',actorId:actor.id,routeId:r.program.routeId,instructionIndex:r.row.cursor.index,site:r.site,atMilliseconds:time});
      this.assignedRoutes.set(actor.id,{actor,entity:actor.native.entity,definition:r.definition,catalog:this.content.npcRoutes,
        fingerprint:canonical(this.content.npcRoutes),program:r.program,site:r.site,programName:r.row.script,webPc:r.row.index,assignmentFingerprint:canonical(r.site),cursor:r.row.cursor,motion:actor.motion,lerp:r.row.lerp});
    }
  }
  private assertAssignedRoute(record: (typeof this.assignedRoutes extends Map<string,infer R> ? R : never)): void {
    const a=record.actor;
    if(this.options.assignedNpcRoutes!==WEB_ASSIGNED_ROUTE_POLICY || this.assignedRoutes.get(a.id)!==record ||
       this.actors[a.id]!==a || a.native?.entity!==record.entity || a.motion!==record.motion ||
       this.content.npcRoutes!==record.catalog || canonical(record.catalog)!==record.fingerprint ||
       this.content.scripts[record.programName]?.[record.webPc]!==record.site || canonical(record.site)!==record.assignmentFingerprint ||
       !this.activeGroups.has(record.definition.group)) throw new Error('Stale assigned NPC route authority');
  }
  private assignNpcRoute(op: Extract<Op,{kind:'assign-npc-route'}>, programName:string, webPc:number): void {
    if(!Number.isSafeInteger(webPc)||webPc<0||this.content.scripts[programName]?.[webPc]!==op)
      throw new Error('Assigned route lost its actual Web program/opcode binding');
    if(this.options.assignedNpcRoutes!==WEB_ASSIGNED_ROUTE_POLICY || !this.content.npcRoutes ||
       !this.content.cameraHost || !this.nativeActorProviders || !this.camera || !this.nativeRuntime)
      throw new Error('Assigned NPC route requires its explicit Web host and source catalog');
    const catalog=parseFieldNpcRouteCatalog(this.content.npcRoutes), range=this.content.cameraHost.mapRange;
    if(catalog.mapId!==this.content.map.identity?.mapId || catalog.sourceSetHash!==this.content.sourceSetHash ||
       catalog.parentSourceSetHash!==this.content.parentSourceSetHash) throw new Error('Assigned NPC route catalog/source mismatch');
    if(this.content.cameraHost.loop.horizontal || this.content.cameraHost.loop.vertical)
      throw new Error('Assigned NPC route wrap-grid provider is unavailable');
    const entities=this.entityList.filter(e=>this.npcDefinition(e)?.sourceEntityId===op.entityId);
    if(entities.length!==1)throw new Error('Assigned NPC route target is absent or ambiguous in active source groups');
    const source=entities[0]!, definition=this.npcDefinition(source)!, actor=this.actors[source.id];
    if(definition.controller!=='wait'||!actor?.native||!actor.animation||actor.layer===null||
       actor.native.scope?.kind!=='map-npc'||actor.native.scope.group!==definition.group||
       canonical(actor.native.scope.source)!==canonical(definition.source)||!this.activeGroups.has(definition.group)||
       this.npcActivities.has(actor.id)||actor.mount||actor.native.entity.riding||actor.native.entity.childEntityObject!=='absent')
      throw new Error('Assigned NPC route requires the exact active ordinary source Wait NPC');
    const previous=this.assignedRoutes.get(actor.id);
    if(previous)this.assertAssignedRoute(previous);
    if(actor.motion && !previous)throw new Error('Assigned NPC route cannot cancel another movement owner');
    if(this.interaction?.entityId===actor.id)throw new Error('Assigned NPC route cannot replace an event-held controller');
    const route=catalog.routes[String(op.routeId)];if(!route)throw new Error('Missing package-local assigned NPC route');
    const program=compileAssignedRouteProgram(route),cursor=createAssignedRouteCursor(program);
    // Complete preflight precedes the native Init/Show pose publication.
    for(const instruction of program.instructions){const action=instruction.action!,animation=actor.animation.clone();
      if(action.kind==='cue-animation')animation.cue(action.animation,action.frame);
      if(action.kind==='play-animation')animation.play(action.animation,action.loops<=0,action.speed);
      if(action.kind==='move-to'||action.kind==='move-lerp'){
        if(!Number.isInteger(action.x)||!Number.isInteger(action.y)||action.x<range.x||action.y<range.y||
           action.x>=range.x+range.width||action.y>=range.y+range.height)throw new Error('Assigned NPC route target outside supported map range');
        if(action.animation)animation.playEntity(action.animation,true);
      }
      if(action.kind==='set-variable')new EventState(this.eventState.snapshot()).write(action.ref,action.value);
      if(action.kind==='compare-variable')this.eventState.read(action.ref);
      if(action.kind==='play-se'){
        if(!this.options.audioReadiness||!this.options.soundPresentation)throw new Error('Assigned route sound requires audio readiness/presentation providers');
        FieldSoundState.restore(this.se.snapshot(),this.content.se).play({kind:'play',soundId:action.soundId,
          asynchronous:true,handleSlot:null,fadeSeconds:action.fade,seekSeconds:action.seek,pan:action.pan},this.content.se);
      }
    }
    const publish=prepareNativeFieldActorProjection({readActors:()=>this.actors,readProviders:this.nativeActorProviders,
      readCamera:()=>{const state=this.camera!.snapshot();return {id:this.cameraActorId,position:state.dummy.position,layer:state.dummy.layer};}},
      (snapshot,providers)=>{
        let next=projectFieldPuppetActorEffects([{kind:'show',actor:actor.id}],snapshot,providers);
        const target=next.actors.find(a=>a.id===actor.id)!;
        target.position=fieldNativeMapObjectPosition({...definition.geometry,width:16,height:16},range,
          this.content.nativeNpcStandby?fieldNativeNpcStandbyPosition(this.content.nativeNpcStandby):undefined);
        target.layer=definition.geometry.layer+9;target.direction=definition.direction;
        target.animation!.look(definition.direction);
        return projectFieldPuppetActorEffects([{kind:'apply-view-properties',actor:actor.id},{kind:'attach-transparent',actor:actor.id}],next,providers);
      },()=>{if(this.assignedRoutes.get(actor.id)!==previous)throw new Error('Stale assigned route replacement');});
    publish(); actor.motion=null;
    this.assignedRouteJournal.push({phase:previous?'replaced':'assigned',actorId:actor.id,routeId:program.routeId,instructionIndex:0,site:op,atMilliseconds:this.time});
    this.assignedRoutes.set(actor.id,{actor,entity:actor.native.entity,definition,catalog:this.content.npcRoutes,
      fingerprint:canonical(this.content.npcRoutes),program,site:op,programName,webPc,assignmentFingerprint:canonical(op),cursor,motion:null,lerp:null});
  }
  private advanceAssignedRoute(record: (typeof this.assignedRoutes extends Map<string,infer R> ? R : never)): void {
    this.assertAssignedRoute(record);
    const {actor,program,site}=record, instruction=program.instructions[record.cursor.index]!,action=instruction.action!;
    if(this.interaction?.entityId===actor.id)return;
    const cursor={...record.cursor};let complete=false;
    const delayed=(seconds:number)=>{if(seconds>0&&cursor.elapsed<seconds){cursor.elapsed=Math.fround(cursor.elapsed+Math.fround(.01));return true;}return false;};
    const canStep=(a:Point,b:Point,layer:number)=>{
      const direction:Direction=b.x>a.x?'right':b.x<a.x?'left':b.y>a.y?'down':'up';
      const start=this.collision(a,layer),end=this.collision(b,layer);
      if(start===null||end===null)throw new Error('Assigned route collision provider is unresolved');
      return !!((start&BIT[direction])&&(end&BIT[OPPOSITE[direction]]))&&!this.occupied([b],layer,actor.id);
    };
    const move=()=>{
      if(action.kind!=='move-to')throw new Error('Expected assigned MoveTo');
      if(actor.layer!==action.layer)throw new Error('Assigned MoveTo cross-layer path provider is unavailable');
      if(actor.motion)return false;
      const range=this.content.cameraHost!.mapRange, from={x:actor.x,y:actor.y},to={x:action.x,y:action.y};
      const path=searchAssignedRouteGrid(from,to,range,(a,b)=>canStep(a,b,action.layer));
      if(path===null)return false;if(!path.length)return true;
      const toCell=path[0]!,direction:Direction=toCell.x>from.x?'right':toCell.x<from.x?'left':toCell.y>from.y?'down':'up';
      const plan=prepareFieldScriptMove({kind:'move',direction,steps:1,speedId:action.speedId,animation:action.animation},from,
        {loop:this.content.cameraHost!.loop,magnification:1});
      const playback=actor.animation!.clone();playback.move(direction,plan.animationSecondsPerCell,action.animation||undefined);playback.frame();
      actor.motion={from,to:toCell,elapsed:0,duration:plan.secondsPerCell*1000,manual:false};
      if(!action.animation)actor.direction=direction;actor.animation=playback;
      record.motion=actor.motion;return false;
    };
    if(cursor.phase==='execute')switch(action.kind){
      case 'delay':complete=!delayed(action.seconds);break;
      case 'move-to':{const wasMoving=actor.motion!==null;const reached=move();complete=reached||!wasMoving&&actor.motion!==null;break;}
      case 'move-lerp':{
        if(!assignedRouteLineClear({x:actor.x,y:actor.y},{x:action.x,y:action.y},(a,b)=>canStep(a,b,action.layer)))break;
        const op:Extract<Op,{kind:'field-script-motion'}>={...site,kind:'field-script-motion',command:{kind:'lerp',x:action.x,y:action.y,
          layer:(action.layer+1) as 1|2|3,duration:action.duration,arcHeight:0,animation:action.animation}};
        const next=this.prepareActorScriptLerp(actor,op,null);record.lerp=next.progress;complete=true;break;
      }
      case 'play-animation':if(!delayed(action.delay)){const animation=actor.animation!.clone();animation.play(action.animation,action.loops<=0,action.speed);animation.frame();actor.animation=animation;complete=true;}break;
      case 'cue-animation':{const animation=actor.animation!.clone();animation.cue(action.animation,action.frame);animation.frame();actor.animation=animation;complete=true;break;}
      case 'show':case 'hide':if(!delayed(action.delay)){
        if(action.kind==='show'&&this.occupied([{x:actor.x,y:actor.y}],actor.layer!,actor.id))break;
        this.prepareActorControl(actor.id,{...site,kind:'actor-visibility',visible:action.kind==='show',
          timing:{durationSeconds:action.duration,delaySeconds:0}})();complete=true;
      }break;
      case 'play-se':
        // Flat Web policy declares this registered NPC component/ancestor active;
        // source activeSelf remains the same live entity visibility owner.
        if(!actor.native!.entity.visible)throw new Error('Inactive assigned route sound actor');
        if(!this.soundResourceReady(action.soundId))break;
        this.executeSound({...site,kind:'field-sound',command:{kind:'play',soundId:action.soundId,asynchronous:true,handleSlot:null,
          fadeSeconds:action.fade,seekSeconds:action.seek,pan:action.pan}});complete=true;break;
      case 'set-variable':this.eventState.write(action.ref,action.value);complete=true;break;
      case 'compare-variable':complete=true;break;
    }else switch(action.kind){
      case 'move-to':complete=move();break;
      case 'move-lerp':{
        if(!record.lerp)throw new Error('Missing assigned route Lerp cursor');
        const start=fieldCameraWorldToCell(this.content.cameraHost!.mapRange,record.lerp.start);
        const from={x:start.x+this.content.cameraHost!.mapRange.x,y:start.y+this.content.cameraHost!.mapRange.y};
        if(!assignedRouteLineClear(from,{x:action.x,y:action.y},(a,b)=>canStep(a,b,action.layer)))throw new Error('Assigned Lerp collision context changed during interpolation');
        const op:Extract<Op,{kind:'field-script-motion'}>={...site,kind:'field-script-motion',command:{kind:'lerp',x:action.x,y:action.y,
          layer:(action.layer+1) as 1|2|3,duration:action.duration,arcHeight:0,animation:action.animation}};
        const next=this.prepareActorScriptLerp(actor,op,record.lerp);record.lerp=next.progress;complete=next.flow==='next';break;
      }
      case 'play-animation':
        complete=action.loops<=0;
        if(!complete&&!actor.animation!.playing){cursor.loops++;complete=cursor.loops>=action.loops;
          if(!complete){const animation=actor.animation!.clone();animation.play(action.animation,false,action.speed);animation.frame();actor.animation=animation;}}
        break;
      case 'show':complete=actor.native!.entity.fadeAlpha>=1;break;
      case 'hide':complete=actor.native!.entity.fadeAlpha<=0;break;
      case 'compare-variable':complete=this.eventState.read(action.ref)===action.value;break;
      default:complete=true;
    }
    if(cursor.phase==='execute'&&complete)this.assignedRouteJournal.push({phase:'execute',actorId:actor.id,routeId:program.routeId,instructionIndex:cursor.index,site,atMilliseconds:this.time});
    const oldIndex=record.cursor.index;
    record.cursor=settleAssignedRouteCursor(program,cursor,complete,site.loop);
    if(record.cursor.index!==oldIndex||record.cursor.phase==='execute')record.lerp=null;
    if(record.cursor.completed){this.assignedRouteJournal.push({phase:'completed',actorId:actor.id,routeId:program.routeId,instructionIndex:cursor.index,site,atMilliseconds:this.time});record.lerp=null;this.assignedRoutes.delete(actor.id);}
  }

  get npcActivitySnapshot(): Record<string, FieldNpcActivityState> {
    return structuredClone(Object.fromEntries([...this.npcActivities].map(([id, value]) => [id, value.state])));
  }
  private sourceBossPending: { request: Extract<Stop,{kind:'unsupported'|'encounter'}>; validate():void }|null=null;
  private sourceEncounterPending: { request: Extract<Stop, { kind: "unsupported" | "encounter" }>;
    source: SourceEncounterRequest; validate(): void } | null = null;
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
  /** Private map-entry draft of the one controller-owned motion retirement.
   * The ordinary native candidate remains a truthful moving snapshot. Only
   * successful World publication calls retireWorldAutoTasks on the live owner. */
  get nativeMapDepartureCandidate():FieldActorFactoryCandidate|null {
    const owned=this.#worldAutoActorMotion;
    if(!owned||this.stop?.kind!=='map-transition')return this.nativeActorCandidate;
    this.assertWorldAutoMovement();const candidate=this.nativeActorCandidate;this.assertWorldAutoMovement();
    if(!candidate)throw Error('World auto movement departure lost native actors');
    const current=candidate.snapshot.actors.find(row=>row.id===owned.actor.id);
    if(!current||!current.moving||canonical(current.position)!==owned.expected||owned.actor.motion!==owned.motion||owned.motion.manual)
      throw Error('World auto movement departure is not the exact current instance/motion');
    return {...candidate,snapshot:{...candidate.snapshot,actors:candidate.snapshot.actors.map(row=>row===current?{...row,moving:false}:row)}};
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
        mobColor: actor.mobColor ?? null, birdView: actor.birdView ?? null, charaZOffset: actor.native!.charaZOffset, mapAnimation: actor.native!.mapAnimation ?? null, mapObjectAsset: actor.native!.mapObjectAsset ?? null,
        scope: actor.native!.scope ?? null, updateAttribute: actor.native!.updateAttribute ?? null,
      })), puppetReplacement: this.puppetReplacementSnapshot, npcActivities: this.npcActivitySnapshot, assignedRoutes: this.assignedRouteSnapshot,
      ...(this.eventActivation ? { eventActivation: this.eventActivation } : {}) });
  }
  private collisionSwitches: FieldPuppetCollisionState = projectFieldPuppetCollision(true);
  private entityUpdateMask = 3;
  private nativeMessageMaskHost = false;
  /** Battle uses the same suspended field entity-mask owner as ordinary Msg.
   * No external callback is invoked between the final validation and writes. */
  prepareBattleMessageEffects(effects: readonly SourceMessageEffect[]) {
    if (effects.length !== 1 || effects[0]!.kind !== "entity-update-group" || effects[0]!.invokeCallback !== false ||
        ![8, 12].includes(effects[0]!.group)) throw new Error("Unknown battle source-message entity update group");
    if (this.options.sourceMessageEffects && !this.nativeMessageMaskHost)
      throw new Error("Custom battle source-message effects require an atomic field host");
    const before = this.entityUpdateMask, owner = this.sourceMessage, mask = sourceMessageUpdateMask(effects[0]!.group);
    let committed = false;
    const validate = () => { if (committed || this.sourceMessage !== owner || this.entityUpdateMask !== before)
      throw new Error("Stale battle source-message entity update group"); };
    return { validate, commit: () => { validate(); this.entityUpdateMask = mask; committed = true; } };
  }
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
    const groups = new Set(this.entityList.filter((entity) => [6, 10, 17].includes(entity.kind)).map((entity) => entity.kind === 10 ? entity.mapAnimation?.group : this.npcDefinition(entity)?.group));
    for (const group of groups) {
      const entities = this.entityList.filter((entity) => [6, 10, 17].includes(entity.kind) && (entity.kind === 10 ? entity.mapAnimation?.group : this.npcDefinition(entity)?.group) === group);
      projected.push(...this.prepareNativeNpcActors(entities, group, projected.map((actor) => actor.id), lifecycle, providers()));
    }
    this.publishNativeActors(projected, candidate.bindings, catalog, providers, controlContext, animationKeys, lifecycle);
  }
  /** Publication common to first creation and validated Web restore. Restore
   * supplies reconstructed actors directly and never runs NPC/factory Init. */
  private publishNativeActors(projected: NativeFieldActor[], sourceBindings: FieldActorFactoryBindings,
    catalog: FieldPuppetActorCatalog, providers: () => FieldPuppetHostProviders,
    controlContext: FieldPuppetControlContext, animationKeys: FieldNativeAnimationKeys | undefined,
    lifecycle: NonNullable<FieldGame["nativeRuntime"]>["mapLifecycle"], restored?: RestoredFieldNpcActivities): void {
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
            if (e.kind === 10) {
              const binding = mapAnimationSelector(this.mapAnimationDefinition(e));
              return binding ? [binding] : [];
            }
            const definition = this.npcDefinition(e);
            if (!definition) throw new Error("Native map selector requires its source NPC identity");
            const binding = fieldNativeNpcSelectorBinding(definition);
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
    const activities = this.prepareNpcActivities(projected, restored);
    for (const actor of projected) { this.actors[actor.id] = actor; this.hiddenEntities.delete(actor.id); }
    this.nativeActorBindings = bindings;
    this.nativeActorProviders = providers;
    this.nativeRuntime = { catalog: puppetCatalog, controlContext: structuredClone(controlContext),
      animationKeys: animationKeys ? structuredClone(animationKeys) : null, mapLifecycle: lifecycle };
    for (const [id, activity] of activities) this.npcActivities.set(id, activity);
    published = true;
    this.options.puppetActors = port;
    this.nativeMessageMaskHost = true;
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
  private readonly passiveEffects: ReturnType<typeof bindPassiveEffects>;
  private readonly relayBindings: ReturnType<typeof bindFieldRelays>;
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
  private timerState: FieldTimerSnapshot | null = null;
  private skyboxOwner:FieldSkyboxState|null=null;
  private skyboxDefinitionPin:string|null=null;
  get skyboxPresentation(){return !this.skyboxOwner||this.skyboxOwner.isRetired||this.skyboxOwner.readiness?null:this.requireSkyboxOwner().projection;}
  get skyboxSnapshot(){return this.skyboxOwner?.snapshot()??null;}
  retireSkyboxPresentation(){this.skyboxOwner?.retire();}
  private requireSkyboxOwner(){
    const owner=this.skyboxOwner,binding=fieldSkyboxBinding(this.content,this.options.skyboxPresentation);
    if(!owner||owner.isRetired||!binding||canonical(this.content.map.skybox)!==this.skyboxDefinitionPin||canonical(owner.binding)!==canonical(binding))throw Error("Source Skybox requires its current map/model/runtime/2D background owner");
    if(owner.readiness)throw Error(owner.readiness);return owner;
  }
  private screenPresentationState:FieldScreenPresentationState|null=null;
  get screenPresentation(){return this.screenPresentationState?.projection??null;}
  private colorFilterState: FieldColorFilterState | null = null;
  private cameraShakeState: FieldCameraShakeState | null = null;
  private timerOrigin: FieldTimerOriginContent | undefined;
  get storyRuntimeSnapshot(): FieldStoryRuntimeSnapshot | null {
    if (!this.timerState) return null;
    const timer = cloneFieldTimer(this.timerState), colorFilter = this.colorFilterState!.snapshot(),
      cameraShake = this.cameraShakeState?.snapshot();
    if(this.screenPresentationState)return {kind:"web-field-story-runtime-v3",timer,colorFilter,cameraShake:cameraShake??null,screenPresentation:this.screenPresentationState.snapshot()};
    return cameraShake ? { kind: "web-field-story-runtime-v2", timer, colorFilter, cameraShake }
      : { kind: WEB_FIELD_STORY_RUNTIME, timer, colorFilter };
  }
  get cameraShakeOffset(): Point { return this.cameraShakeState?.projection ?? { x: 0, y: 0 }; }
  private get cameraShakeAvailable(): boolean { return !!this.cameraShakeState && !!this.camera && this.ordinaryScreenEffectsAvailable; }
  get storyTimerOrigin(): FieldTimerOriginContent | undefined {
    return this.timerState?.active ? structuredClone(this.timerOrigin) : undefined;
  }
  get colorFilter() { return this.colorFilterState?.projection ?? null; }
  get timerProjection() { return this.timerState ? fieldTimerProjection(this.timerState) : null; }
  private get ordinaryScreenEffectsAvailable(): boolean {
    return !!this.colorFilterState?.known && (this.content.entry.viewPlan?.presentationViewType ?? 0) === 0;
  }
  /** Battle clocks the same field timer owner; callbacks wait for safe field publication. */
  advanceStoryTimer(milliseconds: number, scene: FieldTimerScene): void {
    if (this.timerState) this.timerState = advanceFieldTimer(this.timerState, milliseconds, scene);
  }
  private validateTimerCallback(request: FieldTimerCallbackRequest): void {
    const target = this.content.scripts[request.binding.callback.name]?.[0];
    if (!target || canonical(target.source) !== canonical(request.binding.callback.source))
      throw new Error("Timer callback is unavailable in the current trusted script namespace");
  }
  private dispatchExpiredTimer(): void {
    if (!this.timerState || !this.idleFieldReady || this.stop) return;
    const request = pendingFieldTimerCallback(this.timerState);
    if (!request) return;
    try {
      this.validateTimerCallback(request);
      const acknowledged = acknowledgeFieldTimerCallback(this.timerState, request);
      this.beginRoot(request.binding.callback.name, () => { this.timerState = acknowledged; });
    } catch (error) { this.block(error instanceof Error ? error.message : String(error)); }
  }
  dialogue: Dialogue | null = null;
  readonly sourceMessage: SourceMessageState;
  private sourceMessageTask: number | null = null;
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
  private coreRegisterPublishing = false;
  private nextEventSave = 1;
  private pendingEventSave: { request: GameEventSaveRequest; task: Task;
    barrier: { script: string; pc: number } } | null = null;
  get eventSaveRequest(): GameEventSaveRequest | null { return this.pendingEventSave?.request ?? null; }
  /** Execute owns SystemFlags for the whole event. ChangeScript replaces only
   * processing/name/custom animations and must not adopt the target flags. */
  private eventRootScript: string | null = null;
  private eventActivation: FieldEventActivationCheckpoint | null = null;
  get sourceEventActivation(): FieldEventActivationCheckpoint | null {
    return this.eventActivation && structuredClone(this.eventActivation);
  }
  private readonly sourceAnimationCatalog: SourceScriptAnimationCatalog | undefined;
  private currentCustomAnimationAsset: string | null = null;
  private hookedCustomAnimationAsset: string | null | undefined;
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
    activity?: { record: NpcActivityRuntime; lease: FieldNpcActivityLease; motion: Motion | null };
  } | null = null;
  private sourcePartySelectionRequest: {token:object;model:SourcePartySelectionModel;task:Task;validate():void}|null=null;
  get currentSourcePartySelection(): {token:object;model:SourcePartySelectionModel}|null {
    const pending=this.sourcePartySelectionRequest;
    if(!pending||this.stop)return null;
    return {token:pending.token,model:structuredClone(pending.model)};
  }
  private openSourcePartySelection(task:Task,op:Extract<Op,{kind:'source-party-selection'}>):void {
    const port=this.options.sourcePartySelectionPort;
    if(this.options.sourcePartySelection!==WEB_SOURCE_PARTY_SELECTION||!port||!this.partyActors||
      (!this.player.native&&this.content.developmentProfile?.kind!=='framework-development-v1')||
      this.sourcePartySelectionRequest||this.shopTask||this.pendingChoice||this.dialogue||this.messageWindow||
      this.sourceMessage.active||this.stop||this.actorVisibilityBusy||this.player.motion||task.slot!==null)
      throw new Error('Source party selection is missing its shared owner or conflicts with field activity');
    const captured=port.capture(),events=this.eventState,revision=events.mutationRevision;
    const model=projectSourcePartySelection(op.command,captured.current,index=>events.read({category:'ScenarioFlag1',index}));
    const program=this.content.scripts[task.script],pc=task.pc-1,script=task.script,identity=canonical(op),time=this.time,
      native=this.nativeActorStateFingerprint,party=this.partyActors,appearance=canonical(party.checkpoint()),
      actors=Object.values(this.actors).map(actor=>({actor,native:actor.native,entity:actor.native?.entity,
        animation:actor.animation,motion:actor.motion})),player=this.player,camera=this.camera;
    const token=Object.freeze({});let fieldCurrent:()=>boolean=()=>true;
    const validate=()=>{
      captured.validate();
      if(this.options.sourcePartySelection!==WEB_SOURCE_PARTY_SELECTION||this.options.sourcePartySelectionPort!==port||
        this.sourcePartySelectionRequest?.token!==token||this.stop||this.eventState!==events||events.mutationRevision!==revision||
        !this.tasks.includes(task)||task.done||task.script!==script||task.pc!==pc||this.content.scripts[script]!==program||
        program?.[pc]!==op||canonical(op)!==identity||this.time!==time||this.partyActors!==party||this.player!==player||
        this.camera!==camera||!fieldCurrent()||canonical(party.checkpoint())!==appearance||this.nativeActorStateFingerprint!==native||
        Object.values(this.actors).some((a,i)=>{const old=actors[i];return !old||a!==old.actor||a.native!==old.native||
          a.native?.entity!==old.entity||a.animation!==old.animation||a.motion!==old.motion;})||Object.values(this.actors).length!==actors.length)
        throw new Error('Stale source party selection Task or actor owner');
      captured.validate();
      if(events.mutationRevision!==revision)throw new Error('Stale source party selection variables');
    };
    task.pc=pc;this.remainder=0;this.sourcePartySelectionRequest={token,model,task,validate};fieldCurrent=this.captureMapPublication();
    try {validate();} catch(error){this.sourcePartySelectionRequest=null;task.pc=pc+1;throw error;}
  }
  /** The existing owned/actor commitWith is the sole publication boundary. */
  completeSourcePartySelection(token:object,outcome:SourcePartySelectionOutcome,stillAdmitted:()=>boolean=()=>true):boolean {
    const pending=this.sourcePartySelectionRequest;
    if(!pending||pending.token!==token||this.stop||!stillAdmitted())return false;
    pending.validate();
    const transaction=this.options.sourcePartySelectionPort!.prepare(pending.model,outcome);
    const publication=this.partyActors!.prepareSourceSelection(transaction.appearance,this.partyRenderer(),transaction.confirmed);
    transaction.validate();publication.validate();pending.validate();
    transaction.commitWith(()=>publication(()=>{if(!stillAdmitted())throw new Error('Source party selection host changed');pending.validate();}));
    pending.task.pc++;this.sourcePartySelectionRequest=null;
    return true;
  }
  private shopTask: {
    id: number;
    groupId: number;
    entityId: string;
    stage: "greeting" | "open" | "farewell";
    close: FieldMessage | null;
    scriptTaskId?: number;
  } | null = null;
  /** Only the open window authorizes a transaction. Greeting/farewell remain
   * busy field states but cannot buy, sell, or be closed a second time. */
  get currentShop(): { id: number; groupId: number; entityId: string } | null {
    const shop = this.shopTask;
    return !this.stop && shop?.stage === "open"
      ? { id: shop.id, groupId: shop.groupId, entityId: shop.entityId }
      : null;
  }
  closeShop(expectedVisitId?: number): boolean {
    const shop = this.shopTask;
    if (!Number.isSafeInteger(expectedVisitId) || !shop || shop.id !== expectedVisitId ||
        shop.stage !== "open" || this.stop) return false;
    if (shop.scriptTaskId !== undefined) {
      const task = this.tasks.find(candidate => candidate.id === shop.scriptTaskId), pending = task?.scriptShop;
      if (!task || task.done || !pending || pending.closed || pending.id !== shop.id ||
          task.pc !== pending.pc || pending.op.groupId !== shop.groupId ||
          canonical(this.content.scripts[task.script]?.[pending.pc]) !== pending.identity) {
        this.block("Source shop lost its suspended script owner");
        return false;
      }
      pending.closed = true;
      this.shopTask = null;
      this.pump();
      return true;
    }
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
    this.sourceAnimationCatalog = content.sourceScriptAnimations ? parseSourceScriptAnimationCatalog(content.sourceScriptAnimations) : undefined;
    if (this.sourceAnimationCatalog && (this.sourceAnimationCatalog.sourceSetHash !== content.sourceSetHash ||
        this.sourceAnimationCatalog.parentSourceSetHash !== content.parentSourceSetHash))
      throw new Error("Field source custom animation catalog belongs to another source");

    validateFieldViewChangePolicy(options.viewChange);
    validateWorldAutoTaskPolicy(options.worldAutoTasks);this.#worldAutoPolicy=options.worldAutoTasks;
    validateWorldAutoMovePolicy(options.worldAutoMove);this.#worldAutoMovePolicy=options.worldAutoMove;
    validateMobPolicy(options.mobColorFilter); validateMobPolicy(content.developmentProfile?.mobColorFilter);
    const mobBinding = fieldMobColorBinding(content,options.mobColorFilter);
    if (mobBinding) this.#mobControls = new FieldMobControls(mobBinding,()=>this.actors);
    validateBirdViewActorsPolicy(options.birdViewActors);
    validateBirdViewActorsPolicy(content.developmentProfile?.birdViewActors);
    if(options.sourcePartySelection!==undefined&&options.sourcePartySelection!==WEB_SOURCE_PARTY_SELECTION)throw new Error("Unknown source party selection policy");
    if (options.puppetRoutes !== undefined && options.puppetRoutes !== WEB_PUPPET_ROUTE_POLICY)
      throw new Error("Unknown Web puppet Route policy");
    this.puppetRoutePolicy = options.puppetRoutes;
    this.contentInvalidations = new FieldContentInvalidations(content, options.contentInvalidations);
    validateFieldEffectFlatContext(content);
    if (options.messageFees && options.messageFees.sourceSetHash !== content.parentSourceSetHash) throw new Error("Message fee catalog/source mismatch");
    this.sourceMessage = new SourceMessageState(options.messageFees, options.messageFeeSeed);
    if (hasFieldStoryRuntime(content)) {
      const seed = options.storyRuntimeSeed && restoreFieldStoryRuntime(options.storyRuntimeSeed, content, options.storyTimerOrigin, options.cameraShake,options.screenPresentation);
      this.timerState = seed?.timer ?? createFieldTimer(WEB_FIELD_TIMER_POLICY, content.parentSourceSetHash);
      this.colorFilterState = seed ? FieldColorFilterState.restore(seed.colorFilter, fieldScreenEffectsBinding(content))
        : new FieldColorFilterState(fieldScreenEffectsBinding(content), { ...WEB_CLEAR_COLOR_FILTER });
      this.cameraShakeState = (seed?.kind === "web-field-story-runtime-v2" || seed?.kind === "web-field-story-runtime-v3") && seed.cameraShake
        ? restoreFieldStoryShake(seed.cameraShake, content, options.cameraShake!)
        : options.cameraShake ? new FieldCameraShakeState(content.parentSourceSetHash, options.cameraShake) : null;
      if (this.timerState.active) this.timerOrigin = this.timerState.active.binding.mapContentHash === content.contentHash
        ? fieldTimerOriginContent(content) : options.storyTimerOrigin;
    } else if (options.storyRuntimeSeed || options.storyTimerOrigin) throw new Error("Story runtime host profile is unavailable");
    const screenBinding=fieldScreenPresentationBinding(content,options.screenPresentation);
    if(screenBinding)this.screenPresentationState=options.storyRuntimeSeed?.kind==='web-field-story-runtime-v3'?FieldScreenPresentationState.restore(options.storyRuntimeSeed.screenPresentation,screenBinding):new FieldScreenPresentationState(screenBinding);
    const skyboxBinding=fieldSkyboxBinding(content,options.skyboxPresentation);
    if(skyboxBinding){this.skyboxDefinitionPin=canonical(content.map.skybox);this.skyboxOwner=new FieldSkyboxState(content.map.skybox!,skyboxBinding);}
    this.flatNpcBindings = bindFieldNpcFlatProjections(content);
    this.npcBindings = bindFieldNpcActivities(content);
    if ((this.npcBindings.size || this.flatNpcBindings.size) && !options.nativeActorPreparation)
      throw new Error("Framework NPC activities require the native actor owner");
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
    this.passiveEffects = bindPassiveEffects(content);
    this.relayBindings = bindFieldRelays(content);
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
    this.mapTopology = content.map.topology ? structuredClone(content.map.topology) : null;
    if (this.mapTopology) {
      validateFieldMapTopology(this.mapTopology);
      if (canonical(this.mapTopology.range) !== canonical(this.collisionRange))
        throw new Error("Map topology is not bound to the collision range");
      if (content.cameraHost && (canonical(content.cameraHost.mapRange) !== canonical(this.mapTopology.range) ||
          canonical(content.cameraHost.loop) !== canonical(this.mapTopology.loop)))
        throw new Error("Map topology and camera disagree");
      Object.freeze(this.mapTopology.range); Object.freeze(this.mapTopology.loop); Object.freeze(this.mapTopology);
    }
    if (content.map.worldTerrain) {
      validateWorldTerrain(content.map.worldTerrain);
      if (content.map.worldTerrain.mapId !== content.map.identity?.mapId ||
          content.map.worldTerrain.sourceSetHash !== content.sourceSetHash ||
          content.map.worldTerrain.parentSourceSetHash !== content.parentSourceSetHash ||
          content.map.worldTerrain.mapName !== content.map.id || content.map.worldTerrain.width !== content.map.width ||
          content.map.worldTerrain.height !== content.map.height ||
          !this.mapTopology || this.mapTopology.range.x !== 0 || this.mapTopology.range.y !== 0 ||
          this.mapTopology.range.width !== content.map.width || this.mapTopology.range.height !== content.map.height ||
          (content.map.worldTerrain.loopType & 1) !== Number(this.mapTopology.loop.horizontal) ||
          ((content.map.worldTerrain.loopType >> 1) & 1) !== Number(this.mapTopology.loop.vertical))
        throw new Error("World terrain is not bound to its map topology");
    }
    if (content.map.entryContext?.foot.kind === "source-terrain-grid") {
      if (!content.map.worldTerrain) throw new Error("Field entry terrain is unavailable");
      validateFieldEntryTerrainBinding(content.map.entryContext, content.map.worldTerrain, {
        sourceSetHash: content.sourceSetHash, parentSourceSetHash: content.parentSourceSetHash,
      });
    }
    if (content.entry.viewPlan) {
      const view = parseMapEntryViewPlan(content.entry.viewPlan);
      if (view.mapId !== content.map.identity?.mapId || view.presentationViewType !== 0 ||
          view.presentationPolicy !== null && view.presentationPolicy !== frameworkWorldMapPresentation(content.developmentProfile) ||
          (view.loop.horizontal || view.loop.vertical) && !this.mapTopology ||
          this.mapTopology && canonical(view.loop) !== canonical(this.mapTopology.loop))
        throw new Error("Field map view is not bound to its content and presentation");
    }
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
        this.transportationPresentation, options.sourcePartySelection, () => this.currentPartyViewType) : null;
    if (this.partyActors) {
      const media = this.partyActors.playerMedia();
      if (media.asset !== this.player.asset || media.mount !== (this.player.mount || null))
        throw new Error("Field entry does not match source player appearance");
    }
    if (cameraState && !content.cameraHost) throw new Error("Saved camera cannot grant an unbound camera host");
    if (content.cameraHost && this.entityList.some((entity) => entity.kind === 15))
      throw new Error("Camera ChangeOffset trigger provider is unresolved");
    this.camera = content.cameraHost ? new FieldCameraHost(content.cameraHost, this.cameraPorts(), cameraState, fieldViewBinding(content,options.viewChange),options.viewChange,worldAutoBinding(content,this.#worldAutoPolicy)) : null;
    const treasures = restoringNative ? [] : this.prepareTreasureInitialization(this.entityList);
    this.tileAnimations.register(this.entityList);
    this.initializeTreasures(treasures);
    this.openTriggers.initialize(this.entityList, this.player);
    // All local dependencies are prepared before an external effect host can
    // publish. Native CreateMapEntity creates default first; ordering among
    // event groups is not yet bound, so no event-group FX can be lazily added.
    const eventEffects = Object.entries(groups ?? {}).some(([name, group]) =>
      name !== "entity_default" && group.entities.some((entity) => entity.kind === 11 && !this.passiveEffects.has(entity.id)));
    if (eventEffects) throw new Error("Event-group field effect creation order/lifecycle is unresolved");
    const sourceEffects = this.defaultProperties.filter((entity) => entity.kind === 11 && !this.passiveEffects.has(entity.id));
    if (this.entityList.filter((entity) => entity.kind === 11 && !this.passiveEffects.has(entity.id)).some((entity) => !sourceEffects.includes(entity)))
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
        const flatProjection = bindFieldEffectFlatProjection(content,entity,"entity_default");
        return { kind: "create", id: entity.id, definition: entity.effect, position: placement.position,
          ...(flatProjection ? {flatProjection} : {}) };
      });
      operations.push({ kind: "setup", registeredBoards: sourceEffects.map((entity) => entity.id), groupUpdate: false });
      if (content.fieldEffects.webPolicy && (content.developmentProfile?.logicalFieldEffects !== WEB_LOGICAL_FIELD_EFFECTS ||
          content.fieldEffects.webPolicy.sourceSetHash !== content.sourceSetHash ||
          content.fieldEffects.webPolicy.parentSourceSetHash !== content.parentSourceSetHash))
        throw new Error("Logical field effects lack their source-bound Web profile");
      const effects = options.fieldEffectMap ?? new FieldEffects(content.fieldEffects, options.fieldEffects);
      if (options.deferLogicalEffectRestore) {
        if (!restoringNative || !this.logicalEffectsPersistent || options.fieldEffectMap!.hasHistory ||
            sourceEffects.some(entity => !validateLogicalEffectMedia(content.fieldEffects!, entity.effect!.assetGroup) ||
              fieldEffectRuntimeBoardBlockers(entity.effect!,content.fieldEffects!,bindFieldEffectFlatProjection(content,entity,"entity_default"),entity.id).length > 0))
          throw new Error("Unbound unpublished logical effect restore shell");
        // Only immutable source/placement admission was checked. No create,
        // setup, host preparation, counter or manager state is replayed.
      } else if (options.fieldEffectMap?.restoreSeed) {
        if (!this.logicalEffectsPersistent) throw new Error("Unbound logical effect restore lease");
        const boards = effects.snapshot().boards;
        if (boards.length !== sourceEffects.length || operations.some(operation => operation.kind === "create" &&
            !boards.some(board => board.id === operation.id && canonical(board.definition) === canonical(operation.definition) &&
              canonical(board.position) === canonical(operation.position) && canonical(board.flatProjection ?? null) === canonical(operation.flatProjection ?? null))))
          throw new Error("Logical effect checkpoint board/source identity changed");
      } else effects.prepare(operations).commit();
      if (!options.deferLogicalEffectRestore) this.effects = effects;
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
    if (entities.some(entity => entity.kind === 10)) throw new Error("Animated map entities require the actual shared native actor owner");
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
          animation: this.initialAnimation(e.asset, e.direction!, null),
        };
    return actors;
  }
  private npcDefinition(entity: FieldEntity): FieldNativeNpcDefinition | null | undefined {
    return this.npcBindings.get(entity.id)?.definition ?? this.flatNpcBindings.get(entity.id)?.definition ?? entity.nativeNpc;
  }
  private npcBlockers(entity: FieldEntity): readonly string[] {
    return (entity.nativeNpcBlockers ?? []).filter(reason =>
      !(this.npcBindings.has(entity.id) && reason === "Native NPC autonomous movement controller is unresolved") &&
      !(this.flatNpcBindings.has(entity.id) && reason === "Native NPC birdview/cross-layer provider is unresolved"));
  }
  private groupBlockers(group: NonNullable<FieldContent["map"]["groups"]>[string]) {
    const blockers = passiveEffectsGroupBlockers({ ...group, blockers: fieldRelayGroupBlockers({ ...group,
      blockers: flatNpcGroupBlockers({ ...group, blockers: fieldNpcGroupBlockers(group, this.content.frameworkNpcActivity) }, this.content.frameworkNpcFlat) }, this.content.frameworkRelayInteraction) },
      this.content.frameworkPassiveEffects);
    return mapAnimationGroupBlockers({ ...group, blockers: logicalEffectsGroupBlockers({ ...group, blockers }, this.content) }, this.content);
  }
  private prepareNpcActivities(actors: readonly Actor[], restored?: RestoredFieldNpcActivities,
    entities: readonly FieldEntity[] = this.entityList): Map<string, NpcActivityRuntime> {
    const records = new Map<string, NpcActivityRuntime>();
    const candidates = new Map(actors.map(actor => [actor.id, actor]));
    for (const entity of entities) {
      const actor = candidates.get(entity.id);
      if (!actor) continue;
      const binding = this.npcBindings.get(actor.id);
      if (!binding) continue;
      const area = findFieldMoveArea(entities, binding.source.parameters.linkObjectId!, this.content.cameraHost!.mapRange);
      if (!actor.native || actor.layer !== binding.program.layer || !area ||
          canonical(area.moveArea) !== canonical(binding.program.moveArea))
        throw new Error("NPC activity is not bound to its active source Area and native actor");
      const saved = restored?.activities[actor.id];
      if (restored && !saved) throw new Error("Restored NPC activity domain is incomplete");
      const seed = parseInt(binding.program.definitionHash.slice(0, 8), 16) || 1;
      const state = saved?.state ?? createNpcActivity(binding.program, { generation: this.choiceNamespace, seed,
        initialDelayMs: binding.program.firstInterval
          ? parseInt(binding.program.definitionHash.slice(8, 16), 16) / 0xffffffff * binding.program.baseIntervalMs : 0 });
      if (!saved && actor.motion) throw new Error("Fresh NPC activity cannot adopt another movement owner");
      actor.motion = freezeNpcMotion(actor.motion);
      records.set(actor.id, { actor, binding, state, motion: actor.motion, ticket: saved?.ticket ?? null });
    }
    captureFieldNpcActivities(Object.fromEntries([...records].map(([id, r]) => [id,
      { program: r.binding.program, state: r.state, actor: r.actor }])));
    return records;
  }
  private assertNpcActivity(record: NpcActivityRuntime): void {
    const { actor, binding, state, ticket, motion } = record;
    if (this.npcActivities.get(actor.id) !== record || this.actors[actor.id] !== actor ||
        this.npcBindings.get(actor.id) !== binding || !this.activeGroups.has(binding.program.group) ||
        actor.motion !== motion || (state.pending !== null) !== (motion !== null) ||
        (state.pending !== null) !== (ticket !== null) || ticket &&
        (ticket.actorId !== actor.id || ticket.definitionHash !== state.definitionHash ||
          ticket.generation !== state.generation || ticket.commandId !== state.pending!.commandId ||
          ticket.revision !== state.pending!.revision))
      throw new Error("Stale NPC activity Field, actor or movement authority");
  }
  private isAutonomousMotion(actor: Actor): boolean {
    const assigned=this.assignedRoutes.get(actor.id);
    if(assigned){this.assertAssignedRoute(assigned);return assigned.motion===actor.motion;}
    if (!actor.motion) return false;
    const record = this.npcActivities.get(actor.id);
    if (!record || record.state.holder) return false;
    this.assertNpcActivity(record);
    return true;
  }
  private npcCheckpointRecords() {
    return Object.fromEntries([...this.npcActivities].map(([id, r]) => {
      this.assertNpcActivity(r);
      return [id, { program: r.binding.program, state: r.state, actor: r.actor }];
    }));
  }
  private mapAnimationDefinition(entity: FieldEntity): FieldMapAnimationDefinition {
    const d = entity.mapAnimation;
    if (this.content.developmentProfile?.mapAnimatedEntities !== WEB_FIELD_MAP_ANIMATION || entity.kind !== 10 ||
        entity.mapAnimationBlockers?.length || !d || d.entityId !== entity.id || d.asset.asset !== entity.asset ||
        d.geometry.layer !== entity.layer || canonical(d.source) !== canonical(entity.source))
      throw new Error("Animated map entity lacks its trusted Web/source lifecycle");
    return d;
  }
  private prepareNativeNpcActors(entities: readonly FieldEntity[], group: string | undefined,
    existingActorIds: readonly string[], lifecycle: NonNullable<FieldGame["nativeRuntime"]>["mapLifecycle"],
    providers: FieldPuppetHostProviders): NativeFieldActor[] {
    const npcs = entities.filter((entity) => [6, 17].includes(entity.kind));
    const animated = entities.filter(entity => entity.kind === 10);
    if (!npcs.length && !animated.length) return [];
    if (!lifecycle || !this.content.cameraHost || !this.options.partyAppearance)
      throw new Error("Native map-local actor factory is unresolved");
    const definitions = npcs.map((entity) => {
      if (this.npcBlockers(entity).length) throw new Error(this.npcBlockers(entity)[0]!);
      const definition = this.npcDefinition(entity);
      if (!definition || definition.entityId !== entity.id || definition.group !== group ||
          definition.objectType !== entity.kind || definition.asset.asset !== entity.asset ||
          definition.geometry.layer !== entity.layer || canonical(definition.source) !== canonical(entity.source))
        throw new Error("Native NPC is not bound to its source entity group");
      return definition;
    });
    const animatedDefinitions = animated.map(entity => {
      const d = this.mapAnimationDefinition(entity);
      if (d.group !== group) throw new Error("Animated map entity belongs to another group");
      return d;
    });
    const animatedActors = prepareFieldMapAnimations({ definitions: animatedDefinitions, policy: WEB_FIELD_MAP_ANIMATION,
      factory: lifecycle.factory, characters: this.content.characters, mapRange: this.content.cameraHost.mapRange, providers,
      existingActorIds, ...(this.content.nativeNpcStandby ? { standbyAnchorPosition: fieldNativeNpcStandbyPosition(this.content.nativeNpcStandby) } : {}) }).actors;
    return [...animatedActors, ...prepareFieldNativeNpcGroup({ definitions, factory: lifecycle.factory, characters: this.content.characters,
      mapRange: this.content.cameraHost.mapRange, providers, existingActorIds: [...existingActorIds, ...animatedActors.map(actor => actor.entity.id)],
      ...(this.content.frameworkNpcActivity ? { activityPolicy: this.content.frameworkNpcActivity.policy } : {}),
      ...(this.content.nativeNpcStandby ? { standbyAnchorPosition: fieldNativeNpcStandbyPosition(this.content.nativeNpcStandby) } : {}),
    }).actors].map((actor) => createNativeFieldActorProjection(actor, this.content.cameraHost!.mapRange,
      this.options.partyAppearance!.catalog, this.transportationPresentation));
  }
  /** Source SetEventEntityGroup appends entities; it does not replace existing groups. */
  private activateGroup(name: string, restoring = false): void {
    const group = this.content.map.groups?.[name];
    if (!group) throw new Error(`缺少实体组 ${name}`);
    if (this.activeGroups.has(name))
      throw new Error(`重复实体组激活尚未恢复：${name}`);
    const blockers = this.groupBlockers(group);
    if (blockers.length)
      throw new Error(`${name}：${blockers[0]!.reason}`);
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
    const activities = this.prepareNpcActivities(Object.values(actors), undefined, [...this.entityList, ...group.entities]);
    const effectSetup = restoring && this.options.fieldEffectMap?.restoreSeed ? undefined : this.effects?.prepare([{ kind: "setup", registeredBoards:
      this.defaultProperties.filter((entity) => entity.kind === 11 && !this.passiveEffects.has(entity.id)).map((entity) => entity.id), groupUpdate: true }]);
    const properties = [...this.defaultProperties, ...group.entities];
    const publish = () => {
      // register validates a private cells/regions draft before its two pointer
      // swaps. No FX host validation may run after those bindings become live.
      this.tileAnimations.register(group.entities);
      this.entityList.push(...group.entities);
      this.initializeTreasures(treasures);
      Object.assign(this.actors, actors);
      for (const [id, activity] of activities) this.npcActivities.set(id, activity);
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
          this.eventActivation = null;
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
  /** One native draft carries every target's Refresh(false) then the source
   * condition-leader effects. Only prepared writes remain after its last fence. */
  private prepareOwnedConditionAppearance(task: Task, op: Extract<Op, { kind: "owned-condition" | "field-recovery" }>,
    steps: readonly OwnedConditionAppearanceStep[], coreManaged = false): FieldPartyActorPublication {
    this.requireInstructionProviders(op, task.actor, true);
    const tasks = this.tasks, script = task.script, pc = task.pc, actorId = task.actor,
      time = this.time, root = this.eventRootScript, bank = task.generalRegisters,
      source = canonical(op), stack = canonical(task.stack);
    const flag = this.content.scriptSystemFlags?.[root ?? script]?.keepBadStatusVisual;
    if (typeof flag !== "boolean") throw new Error("Unknown source condition-visual context");
    const activity = this.options.conditionLeaderActivity, activityPrepare = activity?.prepare,
      activityPolicy = activity?.policy, actorBaseline = this.nativeActorStateFingerprint,
      factory = this.nativeRuntime?.mapLifecycle?.factory, factoryHash = canonical(factory ?? null);
    const validateTask = () => {
      if (this.tasks !== tasks || !tasks.includes(task) || task.done || task.script !== script || task.pc !== pc ||
          task.actor !== actorId || task.generalRegisters !== bank || this.time !== time ||
          canonical(task.stack) !== stack || this.eventRootScript !== root || this.stop ||
          this.content.scriptSystemFlags?.[root ?? script]?.keepBadStatusVisual !== flag ||
          this.options.conditionLeaderActivity !== activity || activity?.prepare !== activityPrepare || activity?.policy !== activityPolicy ||
          this.nativeRuntime?.mapLifecycle?.factory !== factory || canonical(factory ?? null) !== factoryHash ||
          this.nativeActorStateFingerprint !== actorBaseline || canonical(this.content.scripts[script]?.[pc - 1]) !== source)
        throw new Error("Stale owned condition actor task or source context");
    };
    if (!this.partyActors) throw new Error("Party actor refresh is unavailable");
    let validateActors: () => void, commitActors: () => void;
    if (this.player.native) {
      const port = this.options.puppetActors, appearance = this.options.partyAppearance,
        bindings = this.nativeActorBindings, runtime = this.nativeRuntime, camera = this.camera,
        providers = this.nativeActorProviders, map = this.content.cameraHost?.mapRange;
      if (!port || !appearance || !bindings || !runtime?.animationKeys || !camera || !providers || !map)
        throw new Error("Native condition actor source host is unavailable");
      const scope = flag && activity ? activity.prepare({ readActors: () => this.actors,
        readBindings: () => this.nativeActorBindings!, readFactory: () => {
          const bound = this.nativeRuntime?.mapLifecycle?.factory;
          if (!bound) throw new Error("Condition leader native factory source is unavailable");
          return bound;
        } }) : null;
      const prepared = prepareFieldConditionActors({ keepBadStatusVisual: flag,
        readActors: () => this.actors, readPartyActors: () => this.partyActors!, readCatalog: () => appearance.catalog,
        readPuppetContext: () => port.read(), readBindings: () => this.nativeActorBindings!,
        readMapRange: () => this.content.cameraHost!.mapRange, readCharacters: () => this.content.characters,
        readAnimationKeys: () => this.nativeRuntime!.animationKeys!, readProviders: () => this.nativeActorProviders!(),
        readCamera: () => { const state = camera.snapshot(); return { id: this.cameraActorId,
          position: state.dummy.position, layer: state.dummy.layer }; },
        readCameraOffset: () => this.mapScrollOffset,
        ...(scope ? { readActiveAndEnabled: (id, draft) => scope.isActiveAndEnabled(id, draft) } : {}),
        transportationId: this.transportationId,
        ...(this.transportationPresentation ? { transportationPresentation: this.transportationPresentation } : {}),
      }, steps);
      validateActors = () => {
        if (this.options.puppetActors !== port || this.options.partyAppearance !== appearance ||
            this.nativeActorBindings !== bindings || this.nativeRuntime !== runtime || this.camera !== camera ||
            this.nativeActorProviders !== providers || this.content.cameraHost?.mapRange !== map)
          throw new Error("Stale native condition actor host");
        scope?.validate(); prepared.validate();
      };
      // Fetch the detached value before publishing. After the first write no
      // host reads, media preparation or arbitrary callbacks remain.
      const offset = prepared.cameraOffset;
      commitActors = () => { prepared.commit(); this.mapScrollOffset = offset; };
    } else {
      if (flag) throw new Error("Source condition leader activity requires a native actor host");
      const legacy = this.partyActors.prepareSequence(steps, this.partyRenderer());
      validateActors = () => legacy.validate();
      // Legacy renderer commits only prevalidated writes. Its callable's last
      // validating phase remains before the Task fence and every owned write.
      commitActors = () => legacy(validateTask);
    }
    let consumed = false;
    const validate = () => {
      if (consumed || this.coreRegisterPublishing) throw new Error("Stale condition actor publication");
      validateActors(); validateTask();
    };
    const publish = (beforeWrite?: () => void) => {
      if (consumed || (!coreManaged && this.coreRegisterPublishing) || (coreManaged && !this.coreRegisterPublishing))
        throw new Error("Stale condition actor publication");
      if (!coreManaged) this.coreRegisterPublishing = true;
      try {
        validateActors(); validateTask(); beforeWrite?.();
        commitActors(); consumed = true;
      } finally { if (!coreManaged) this.coreRegisterPublishing = false; }
    };
    validateTask();
    return Object.assign(publish, { validate });
  }
  /** The real MainCore bank is part of this Task, not the owned roster or
   * ScriptLocal. Fence it AFTER the renderer's final callback, then publish
   * only prepared data inside GameState's existing owned publication lock. */
  private prepareOwnedConditionCore(task: Task, op: Extract<Op, { kind: "owned-condition" }>,
    steps: readonly OwnedConditionAppearanceStep[], writes: readonly number[]) {
    const tasks = this.tasks, before = task.generalRegisters, script = task.script,
      pc = task.pc, time = this.time, stack = canonical(task.stack), root = this.eventRootScript;
    const next = projectFieldCoreI0(before, writes), source = canonical(op);
    const validateCore = () => {
      if (this.tasks !== tasks || !tasks.includes(task) || task.done || task.slot !== null ||
          task.treasureRoot || task.actor !== "-1001" || task.sourceEntityId !== null ||
          task.script !== script || task.pc !== pc || this.time !== time ||
          canonical(task.stack) !== stack || this.eventRootScript !== root || this.stop ||
          task.generalRegisters !== before || canonical(this.content.scripts[script]?.[pc - 1]) !== source)
        throw new Error("Stale owned condition MainCore task");
      parseFieldCoreRegisters(before);
    };
    validateCore();
    let appearance: FieldPartyActorPublication | null = null;
    if (steps.length) appearance = this.prepareOwnedConditionAppearance(task, op, steps, true);
    let consumed = false;
    const validate = () => {
      if (consumed || this.coreRegisterPublishing) throw new Error("Stale owned condition Core publication");
      appearance?.validate(); validateCore();
    };
    const publish = () => {
      if (consumed || this.coreRegisterPublishing) throw new Error("Stale owned condition Core publication");
      this.coreRegisterPublishing = true;
      try {
        // Existing FieldPartyActors beforeWrite is exactly after all native
        // providers have returned and before its first actor/context write.
        if (appearance) appearance(validateCore); else validateCore();
        task.generalRegisters = next;
        consumed = true;
      } finally { this.coreRegisterPublishing = false; }
    };
    return Object.assign(publish, { validate });
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
      !!this.sourcePartySelectionRequest ||
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
      !this.options.deferLogicalEffectRestore &&
      (!this.options.puppetActors || !!(this.nativeActorBindings && this.nativeRuntime?.mapLifecycle &&
        this.nativeRuntime.animationKeys && this.nativeActorProviders && this.partyActors && this.camera)) &&
      !this.cameraEventActive && !this.worldAutoTasksBusy && (!this.puppetLifecycle || this.puppetLifecycle.finished) &&
      (!this.options.fieldEffectMap || this.options.fieldEffectMap.active) &&
      this.sourcePresentationContext?.advertisementOpeningFader !== "present" &&
      this.synchronizedEntry !== false &&
      !this.fieldActivityBusy &&
      !this.fader.active &&
      !this.skyboxOwner?.active && !this.colorFilterState?.active && !this.screenPresentationState?.active &&
      !this.actorVisibilityBusy &&
      !this.interaction &&
      Object.values(this.actors).every((a) => a.motion === null || this.isAutonomousMotion(a))
    );
  }
  get menuReady(): boolean { return !this.stop && this.idleFieldReady && !this.options.reservedScripts?.read(); }
  get checkpointReady(): boolean {
    if(this.skyboxOwner&&!this.skyboxOwner.readiness&&!this.nativeActorBindings)return false;
    return !Object.values(this.actors).some(actor=>actor.mobColor?.tween) && !this.stop && this.idleFieldReady && (this.logicalEffectsPersistent || !this.effects && !this.options.fieldEffectMap?.hasHistory);
  }
  get sourcePresentationContext(): SourcePresentationContext | null {
    return cloneSourcePresentationContext(this.options.sourcePresentation?.context() ?? null);
  }
  /** A preparation fence, not a save or another Field owner. Media hosts may
   * read this candidate but cannot silently advance or replace its state. */
  captureMapPublication(): () => boolean {
    const events = this.eventState, revision = events.mutationRevision, content = this.content;
    const message = this.sourceMessage, messageRevision = message.mutationRevision;
    const tasks = [...this.tasks], actors = Object.entries(this.actors).map(([id, actor]) =>
      ({ id, actor, native: actor.native, entity: actor.native?.entity, animation: actor.animation, motion: actor.motion }));
    const playerStep = this.pendingPlayerStep, walk = this.pendingWalkEncounter, encounter = this.sourceEncounterPending, boss=this.sourceBossPending;
    const replayHandles = tasks.map(task => task.bgmReplay?.handle);
    const before = this.mapPublicationState();
    return () => this.content === content && this.eventState === events && events.mutationRevision === revision &&
      this.sourceMessage === message && message.mutationRevision === messageRevision &&
      this.tasks.length === tasks.length && tasks.every((task, index) => this.tasks[index] === task && task.bgmReplay?.handle === replayHandles[index]) &&
      Object.keys(this.actors).length === actors.length && actors.every(({ id, actor, native, entity, animation, motion }) =>
        this.actors[id] === actor && actor.native === native && actor.native?.entity === entity && actor.animation === animation && actor.motion === motion) &&
      this.pendingPlayerStep === playerStep && this.pendingWalkEncounter === walk && this.sourceEncounterPending === encounter && this.sourceBossPending===boss &&
      this.mapPublicationState() === before;
  }
  private mapPublicationState(): string {
    // Opaque callbacks remain under their existing owners; capture their
    // references separately above. Task data/cursors are an observation only.
    const tasks = this.tasks.map(({ animationRepeat: repeat, bgmReplay: replay, birdViewMove: bird, ...task }) => ({ ...task,
      birdViewMove: bird && { op: bird.op, actorId: bird.actor.id },
      animationRepeat: repeat && { op: repeat.op, fingerprint: repeat.fingerprint, script: repeat.script,
        webPC: repeat.webPC, actorId: repeat.actorId, registers: repeat.registers },
      bgmReplay: replay && { op: replay.op } }));
    const data = {
      content: this.content, puppetRoutePolicy: this.puppetRoutePolicy ?? null, time: this.time, remainder: this.remainder, nextTask: this.nextTask,
      nextChoice: this.nextChoice, nextEventSave: this.nextEventSave, nextVisibilityTimer: this.nextVisibilityTimer,
      nextNpcEvent: this.nextNpcEvent, stop: this.stop, tasks, eventRootScript: this.eventRootScript,
      scriptHook: this.scriptHook && { ...this.scriptHook, locals: this.eventState.exportScriptLocalFrame(this.scriptHook.locals) },
      eventActivation: this.eventActivation, puppetLifecycle: this.puppetLifecycle,
      currentProperties: this.currentProperties, entities: this.entityList,
      activeGroups: [...this.activeGroups], hiddenEntities: [...this.hiddenEntities], openedTreasures: [...this.openedTreasures],
      mobControls: this.mobControlsSnapshot, events: this.eventState.snapshot(), contentInvalidations: this.contentInvalidationsSnapshot,
      native: this.nativeActorStateFingerprint,
      sourceCustomAnimations: { current: this.currentCustomAnimationAsset, hooked: this.hookedCustomAnimationAsset ?? null },
      actors: Object.values(this.actors).map(({ native: _, animation, ...actor }) => ({ ...actor, animation: animation?.snapshot() ?? null })),
      npcActivities: this.npcActivitySnapshot, assignedRoutes: this.assignedRouteSnapshot,
      tiles: this.tileAnimations.snapshot(), doors: this.openTriggers.snapshot(),
      bgm: this.bgm.snapshot(), environment: this.environment.snapshot(), se: this.se.snapshot(),
      fade: this.fader.snapshot(), camera: this.cameraSnapshot, worldAutoTasks:this.worldAutoTaskSnapshot, cameraOffset: this.cameraOffset, effects: this.fieldEffectsSnapshot,
      collision: this.collisionSwitches, updateMask: this.entityUpdateMask, transportation: this.transportationId,
      synchronizedEntry: this.synchronizedEntry, entryTaskStarted: this.entryTaskStarted, cameraEventActive: this.cameraEventActive,
      skybox: this.skyboxSnapshot, story: this.storyRuntimeSnapshot, storyOrigin: this.storyTimerOrigin ?? null,
      dialogue: this.dialogue, retainedMessage: this.retainedMessage, message: this.sourceMessage.snapshot(), sourceMessageTask: this.sourceMessageTask,
      choice: this.pendingChoice && { request: this.pendingChoice.request, taskId: this.pendingChoice.task.id,
        op: this.pendingChoice.op, answer: this.pendingChoice.answer },
      eventSave: this.pendingEventSave && { request: this.pendingEventSave.request, taskId: this.pendingEventSave.task.id,
        barrier: this.pendingEventSave.barrier },
      interaction: this.interaction && { entityId: this.interaction.entityId, restoreDirection: this.interaction.restoreDirection,
        waitUntil: this.interaction.waitUntil, activity: this.interaction.activity?.lease ?? null },
      sourcePartySelection: this.sourcePartySelectionRequest && {model:this.sourcePartySelectionRequest.model,taskId:this.sourcePartySelectionRequest.task.id},
      shop: this.shopTask, treasureScene: this.treasureSceneState,
      visibilityTimers: this.visibilityTimers.map(timer => ({ ticket: timer.ticket, op: timer.op,
        actorId: timer.actor.id, entityId: timer.entity.id, recordedSeconds: timer.recordedSeconds, delaySeconds: timer.delaySeconds,
        programName: timer.programName, webPc: timer.webPc, instruction: timer.instruction })),
    };
    return canonical(JSON.parse(JSON.stringify(data, (_key, value) => {
      if (typeof value === "function" || typeof value === "number" && !Number.isFinite(value))
        throw new Error("Unobservable candidate map publication state");
      return value;
    })));
  }
  private nativeCheckpointContext(bindings: FieldActorFactoryBindings, factory: FieldActorFactoryCatalog,
    providers: FieldPuppetHostProviders, autonomousMotions?: FieldNativeCheckpointContext["autonomousMotions"],
    assignedMotions?: FieldNativeCheckpointContext["assignedMotions"], animationKeys = this.nativeRuntime?.animationKeys): FieldNativeCheckpointContext {
    if (!this.partyActors || !this.options.partyAppearance || !this.content.cameraHost)
      throw new Error("Native checkpoint requires bound party, media and camera owners");
    const npcs = this.entityList.filter((entity) => [6, 17].includes(entity.kind)).map((entity) => {
      const npc = this.npcDefinition(entity);
      if (this.npcBlockers(entity).length || !npc || npc.entityId !== entity.id ||
          npc.objectType !== entity.kind || npc.asset.asset !== entity.asset || npc.geometry.layer !== entity.layer ||
          canonical(npc.source) !== canonical(entity.source) || !this.activeGroups.has(npc.group))
        throw new Error("Native checkpoint NPC is not bound to an active source group");
      return npc;
    });
    return { mapRange: this.content.cameraHost.mapRange, bindings, factory,
      partyCatalog: this.options.partyAppearance.catalog, partyCheckpoint: this.partyActors.checkpoint(),
      characters: this.content.characters, npcs, providers,
      ...(this.sourceAnimationCatalog ? {sourceScriptAnimations:this.sourceAnimationCatalog} : {}),
      ...(animationKeys ? {animationKeys} : {}),
      animated: this.entityList.filter(entity => entity.kind === 10).map(entity => {
        const d = this.mapAnimationDefinition(entity);
        if (!this.activeGroups.has(d.group)) throw new Error("Animated checkpoint group is not active");
        return d;
      }), ...(this.content.developmentProfile?.mapAnimatedEntities ? { animatedPolicy: this.content.developmentProfile.mapAnimatedEntities } : {}),
      ...(autonomousMotions ? { autonomousMotions } : {}),
      ...(assignedMotions ? { assignedMotions } : {}),
      ...(this.transportationPresentation ? { transportationPresentation: this.transportationPresentation } : {}) };
  }
  private nativeCheckpoint(continuation = false): FieldCheckpoint["native"] {
    if (this.actorVisibilityBusy) throw new Error("Active source visibility timer/fade cannot be checkpointed");
    if (!this.nativeActorBindings){if(this.skyboxOwner&&!this.skyboxOwner.readiness)throw Error("Skybox stable checkpoint requires actual native map child owner");return null;}
    if (!this.nativeRuntime?.mapLifecycle || !this.nativeActorProviders || !this.nativeRuntime.animationKeys)
      throw new Error("Native actor checkpoint source capabilities are incomplete");
    const lifecycle = this.puppetLifecycle;
    if (lifecycle && ((!continuation && !lifecycle.finished) ||
        canonical(lifecycle.script) !== canonical(this.content.scriptPuppetContexts?.[lifecycle.name])))
      throw new Error("Native script lifecycle is not stably bound to its source");
    const autonomousMotions = Object.fromEntries([...this.npcActivities].flatMap(([id, r]) => {
      this.assertNpcActivity(r);
      if (r.state.holder) throw new Error("Event-held NPC activity cannot be checkpointed");
      return r.state.pending ? [[id, { definitionHash: r.binding.program.definitionHash,
        sourceSpeedEnum: r.binding.program.sourceSpeedEnum, commandId: r.state.pending.commandId,
        secondsPerCell: sourceNpcSecondsPerCell(r.binding.program.sourceSpeedEnum) }]] : [];
    }));
    const mobControls = this.mobControlsEnabled ? this.mobControlsOwner().checkpoint() : undefined;
    const birdViewActors = this.captureBirdViewActorPoses();
    const puppetReplacement = this.puppetReplacementValue ? this.validatePuppetReplacementState(this.puppetReplacementValue) : null;
    return { ...(this.skyboxOwner&&!this.skyboxOwner.readiness?{skyboxPresentation:this.requireSkyboxOwner().snapshot()}:{}), ...(puppetReplacement ? {puppetReplacement} : {}), ...(mobControls ? {mobControls} : {}), ...(birdViewActors ? { birdViewActors } : {}), actors: captureFieldNativeCheckpoint(this.actors, this.nativeCheckpointContext(
      this.nativeActorBindings, this.nativeRuntime.mapLifecycle.factory, this.nativeActorProviders(), autonomousMotions,
      this.assignedCheckpoint ? restoreAssignedRoutes(this.assignedCheckpoint,this.content,this.entityList,this.time,this.options.assignedNpcRoutes).motions : undefined)),
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
    const npcActivities = this.content.frameworkNpcActivity
      ? captureFieldNpcActivities(this.npcCheckpointRecords()) : undefined;
    const snapshot: FieldCheckpointState = {
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
    const viewPlan = this.content.entry.viewPlan && structuredClone(this.content.entry.viewPlan);
    const storyRuntime = this.storyRuntimeSnapshot;
    const assignedNpcRoutes=this.assignedCheckpoint;
    const contentInvalidations = this.contentInvalidationsSnapshot;
    const sourceMessageValues = this.sourceMessage.feeSnapshot;
    if (this.sourceAnimationCatalog) {
      if (this.scriptHook !== null && this.hookedCustomAnimationAsset === undefined)
        throw new Error("Source custom animation hook owner is missing");
      const scriptAnimations=parseSourceFieldScriptAnimationState({kind:"source-field-script-animation-state-v1",
        catalogHash:this.sourceAnimationCatalog.contentHash,currentAsset:this.currentCustomAnimationAsset,
        ...(this.scriptHook?{hookedAsset:this.hookedCustomAnimationAsset}: {})},this.sourceAnimationCatalog,this.scriptHook!==null);
      return {...snapshot,kind:execution?"event-field-v8":"idle-field-v17",scriptAnimations,
        ...(sourceMessageValues?{sourceMessageValues}:{}),...(contentInvalidations?{contentInvalidations}:{}),
        ...(assignedNpcRoutes?{assignedNpcRoutes}:{}),...(storyRuntime?{storyRuntime}:{}),
        ...(npcActivities?{npcActivities}:{}),...(viewPlan?{viewPlan}:{}),...(execution?{execution}:{})}as FieldCheckpoint;
    }
    if (sourceMessageValues) return { ...snapshot, kind: execution ? "event-field-v7" : "idle-field-v16", sourceMessageValues,
      ...(contentInvalidations ? { contentInvalidations } : {}),
      ...(assignedNpcRoutes ? { assignedNpcRoutes } : {}), ...(storyRuntime ? { storyRuntime } : {}),
      ...(npcActivities ? { npcActivities } : {}), ...(viewPlan ? { viewPlan } : {}), ...(execution ? { execution } : {}) } as FieldCheckpoint;
    if (contentInvalidations) return execution ? { ...snapshot, kind: "event-field-v6", contentInvalidations,
      ...(assignedNpcRoutes ? { assignedNpcRoutes } : {}), ...(storyRuntime ? { storyRuntime } : {}),
      ...(npcActivities ? { npcActivities } : {}), ...(viewPlan ? { viewPlan } : {}), execution }
      : { ...snapshot, kind: "idle-field-v15", contentInvalidations,
        ...(assignedNpcRoutes ? { assignedNpcRoutes } : {}), ...(storyRuntime ? { storyRuntime } : {}),
        ...(npcActivities ? { npcActivities } : {}), ...(viewPlan ? { viewPlan } : {}) };
    if(assignedNpcRoutes) return execution ? {...snapshot,kind:'event-field-v5',assignedNpcRoutes,
      ...(storyRuntime?{storyRuntime}:{}),...(npcActivities?{npcActivities}:{}),...(viewPlan?{viewPlan}:{}),execution}
      : {...snapshot,kind:'idle-field-v14',assignedNpcRoutes,...(storyRuntime?{storyRuntime}:{}),
        ...(npcActivities?{npcActivities}:{}),...(viewPlan?{viewPlan}:{})};
    if (storyRuntime) return execution ? { ...snapshot, kind: "event-field-v4", storyRuntime,
      ...(viewPlan ? { viewPlan } : {}), ...(npcActivities ? { npcActivities } : {}), execution }
      : { ...snapshot, kind: "idle-field-v13", storyRuntime,
        ...(viewPlan ? { viewPlan } : {}), ...(npcActivities ? { npcActivities } : {}) };
    if (npcActivities) return execution ? { ...snapshot, kind: "event-field-v3", npcActivities,
      ...(viewPlan ? { viewPlan } : {}), execution } : { ...snapshot, kind: "idle-field-v12", npcActivities,
      ...(viewPlan ? { viewPlan } : {}) };
    if (viewPlan) return execution ? { ...snapshot, kind: "event-field-v2", viewPlan, execution }
      : { ...snapshot, kind: "idle-field-v11", viewPlan };
    return execution ? { ...snapshot, kind: "event-field-v1", execution } : { ...snapshot, kind: "idle-field-v10" };
  }
  /** A barrier owns one quiescent main core. Other live coroutine registers
   * need their own codecs before a content package may save through them. */
  private requireEventSaveBoundary(task: Task): void {
    if (this.stop || this.worldAutoTasksBusy || !this.logicalEffectsPersistent && (this.effects || this.options.fieldEffectMap?.hasHistory) ||
        this.options.fieldEffectMap && !this.options.fieldEffectMap.active ||
        this.sourcePresentationContext?.advertisementOpeningFader === "present" ||
        this.fader.active || this.skyboxOwner?.active || this.colorFilterState?.active || this.screenPresentationState?.active || this.actorVisibilityBusy || Object.values(this.actors).some(actor=>actor.mobColor?.tween) || this.sourceMessage.active || this.messageWindow ||
        this.pendingChoice || this.shopTask || this.sourcePartySelectionRequest || this.treasureSceneState !== "player" ||
        this.openTriggers.busy || this.interaction || this.pendingPlayerStep ||
        Object.values(this.actors).some((actor) => actor.motion !== null && !this.isAutonomousMotion(actor)) ||
        this.tasks.some((other) => other !== task && !other.done) ||
        task.done || task.slot !== null || task.treasureRoot || task.state !== "ready" ||
        task.wait !== 0 || task.skyboxWait || task.standaloneWait || task.puppetWait || task.fadeWait || task.screenBackdropWait || task.colorFadeWait || task.flashWait || task.cameraPath || task.cameraLerp ||
        task.scriptMove || task.scriptLerp || task.birdViewMove || task.remaining !== 0 || task.move ||
        task.animationWait || task.audioWait || task.bgmReplay || task.autoSaveWait || task.soundWait || task.treasure ||
        this.options.puppetActors && !this.nativeActorBindings)
      throw new Error("Event save requires a quiescent main task with supported field owners");
  }
  private eventContinuation(task: Task, barrier: { script: string; pc: number }): FieldEventCheckpoint {
    this.requireEventSaveBoundary(task);
    if (!this.eventRootScript) throw new Error("Event save has no root script");
    const lifecycle = this.puppetLifecycle;
    if (lifecycle?.finished) throw new Error("Event save cannot resume a completed puppet lifecycle");
    return captureFieldEventCheckpoint({ barrier, main: { id: task.id, script: task.script, pc: task.pc,
      stack: [...task.stack], actor: task.actor, sourceEntityId: task.sourceEntityId, range: { ...task.range },
      ...(fieldUsesCoreRegisters(this.content) ? { generalRegisters: parseFieldCoreRegisters(task.generalRegisters) } : {}) },
      eventRootScript: this.eventRootScript,
      ...(this.eventActivation ? { eventActivation: structuredClone(this.eventActivation) } : {}),
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
    assertFieldEventSaveAdmission(this.content, op);
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
    const passiveEffects = bindPassiveEffects(content);
    if (!(options.fieldEffectMap?.restoreSeed && options.fieldEffectMap.logicalPolicy === WEB_LOGICAL_FIELD_EFFECTS &&
          content.developmentProfile?.logicalFieldEffects === WEB_LOGICAL_FIELD_EFFECTS) &&
        (options.fieldEffectMap?.hasHistory || content.map.entities.some((entity) => entity.kind === 11 && !passiveEffects.has(entity.id)) ||
        Object.values(content.map.groups ?? {}).some((group) => group.entities.some((entity) => entity.kind === 11 && !passiveEffects.has(entity.id)))))
      throw new Error("Field effect particle/RNG checkpoint codec is unresolved");
    const s = structuredClone(raw);
    const hasCustom = s.kind === "idle-field-v17" || s.kind === "event-field-v8";
    const hasValues = s.kind === "idle-field-v16" || s.kind === "event-field-v7" || hasCustom && Object.hasOwn(s,"sourceMessageValues");
    const hasInvalidations = s.kind === "idle-field-v15" || s.kind === "event-field-v6" || (hasCustom || hasValues) && Object.hasOwn(s,"contentInvalidations");
    const hasAssigned = s.kind === "idle-field-v14" || s.kind === "event-field-v5" || (hasCustom || hasInvalidations || hasValues) && Object.hasOwn(s,"assignedNpcRoutes");
    const hasStory = s.kind === "idle-field-v13" || s.kind === "event-field-v4" || (hasCustom || hasAssigned || hasInvalidations || hasValues) && Object.hasOwn(s,"storyRuntime");
    const hasActivities = s.kind === "idle-field-v12" || s.kind === "event-field-v3" || (hasCustom || hasStory || hasAssigned || hasInvalidations || hasValues) && Object.hasOwn(s, "npcActivities");
    const continuation = s.kind === "event-field-v1" || s.kind === "event-field-v2" || s.kind === "event-field-v3" || s.kind === "event-field-v4" || s.kind === "event-field-v5" || s.kind === "event-field-v6" || s.kind === "event-field-v7" || s.kind === "event-field-v8";
    const hasView = s.kind === "idle-field-v11" || s.kind === "event-field-v2" || (hasCustom || hasActivities || hasStory || hasAssigned || hasInvalidations || hasValues) && Object.hasOwn(s, "viewPlan");
    checkpointKeys(
      s,
      "kind,contentHash,time,remainder,nextTask,transportationId,entrySynchronized,partyActors,sourcePresentation,eventState,activeGroups,hiddenEntities,openedTreasures,actors,tiles,doors,bgm,environment,se,fade,camera,native" +
        (continuation ? ",execution" : "") + (hasView ? ",viewPlan" : "") + (hasActivities ? ",npcActivities" : "") + (hasStory ? ",storyRuntime" : "") + (hasAssigned ? ",assignedNpcRoutes" : "") + (hasInvalidations ? ",contentInvalidations" : "") + (hasValues ? ",sourceMessageValues" : "") + (hasCustom ? ",scriptAnimations" : ""),
    );
    if (!["idle-field-v17", "event-field-v8", "idle-field-v16", "event-field-v7", "idle-field-v10", "idle-field-v11", "idle-field-v12", "idle-field-v13", "idle-field-v14", "idle-field-v15", "event-field-v6", "event-field-v5", "event-field-v1", "event-field-v2", "event-field-v3", "event-field-v4"].includes(s.kind) ||
        hasCustom !== (content.sourceScriptAnimations !== undefined) || s.contentHash !== content.contentHash || hasAssigned !== (options.assignedNpcRoutes === WEB_ASSIGNED_ROUTE_POLICY && content.npcRoutes !== undefined) || hasActivities !== (content.frameworkNpcActivity !== undefined) || hasStory !== hasFieldStoryRuntime(content))
      throw new Error("Field checkpoint source/version mismatch");
    if(hasStory){const saved=(s as {storyRuntime:FieldStoryRuntimeSnapshot}).storyRuntime;if(saved.kind==='web-field-story-runtime-v3'&&(saved.screenPresentation.tasks.length||saved.screenPresentation.backdrop.tween))throw new Error("Stable checkpoint cannot carry unfinished screen presentation");}
    if (hasStory && (s as { storyRuntime: FieldStoryRuntimeSnapshot }).storyRuntime.colorFilter?.tween)
      throw new Error("Stable field checkpoint cannot carry an unfinished color-filter tween");
    if (hasView !== (content.entry.viewPlan !== undefined) || hasView &&
        canonical(parseMapEntryViewPlan((s as { viewPlan?: MapEntryViewPlan }).viewPlan)) !== canonical(content.entry.viewPlan))
      throw new Error("Field checkpoint cannot grant or change map view presentation");
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
        s.entrySynchronized !== true && !(continuation && s.entrySynchronized === false) :
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
      { ...options, ...(native ? { nativeActorPreparation: true } : {}),
        ...(hasValues ? { messageFeeSeed: (s as { sourceMessageValues: SourceMessageFeeSnapshot }).sourceMessageValues } : {}),
        ...(hasStory ? { storyRuntimeSeed: restoreFieldStoryRuntime((s as { storyRuntime: FieldStoryRuntimeSnapshot }).storyRuntime, content, options.storyTimerOrigin, options.cameraShake,options.screenPresentation) } : {}) },
      FieldFadeState.restore(s.fade),
      s.camera ?? undefined,
      native !== undefined,
      FieldSoundState.restore(s.se, content.se),
    );
    const customState=hasCustom ? parseSourceFieldScriptAnimationState((s as {scriptAnimations:SourceFieldScriptAnimationState}).scriptAnimations,
      next.sourceAnimationCatalog!,continuation&&(s as Extract<FieldCheckpoint,{kind:"event-field-v8"}>).execution.scriptHook!==null) : null;
    if(customState){next.currentCustomAnimationAsset=customState.currentAsset;next.hookedCustomAnimationAsset=customState.hookedAsset;}
    checkpointIds(s.activeGroups);
    const initial = [...next.activeGroups];
    if (initial.some((id, n) => s.activeGroups[n] !== id))
      throw new Error("Initial field groups changed in checkpoint");
    for (const id of s.activeGroups.slice(initial.length)) {
      if (native) next.restoreNativeGroup(id);
      else next.activateGroup(id, true);
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
    const restoredActivities = hasActivities ? restoreFieldNpcActivities(Object.fromEntries(next.entityList.flatMap(e => {
      const binding = next.npcBindings.get(e.id); return binding ? [[e.id, binding.program]] : [];
    })), (s as { npcActivities: FieldNpcActivitiesCheckpoint }).npcActivities,
    { generation: next.choiceNamespace }) : undefined;
    const assignedRestore=hasAssigned ? restoreAssignedRoutes((s as {assignedNpcRoutes:AssignedRoutesCheckpoint}).assignedNpcRoutes,
      content,next.entityList,s.time,options.assignedNpcRoutes) : undefined;
    if (native) next.restoreNativeOwner(s.native!, native, restoredActivities,assignedRestore?.motions);
    // A v2 host can read an old walking view without rewriting its saved
    // policy. The old v1 payload never grants the newly supported rider host.
    if(next.currentView)next.viewTransportation(next.currentView.policy);
    if(assignedRestore) next.installAssignedRoutes(assignedRestore.rows,s.time);
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
          ? !content.map.collisions[a.layer] && !(a.layer === 0 && content.map.worldTerrain)
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
    if (hasInvalidations) next.contentInvalidations.restore((s as { contentInvalidations: FieldContentInvalidationsCheckpoint }).contentInvalidations);
    next.time = s.time;
    next.remainder = s.remainder;
    next.nextTask = s.nextTask;
    next.synchronizedEntry = s.entrySynchronized;
    next.entryTaskStarted = s.entrySynchronized === true;
    if (continuation) {
      const execution = restoreFieldEventCheckpoint(s.execution, { content, eventState: next.eventState.snapshot(),
        actorIds: Object.keys(next.actors), nextTask: s.nextTask, time: s.time, entrySynchronized: s.entrySynchronized });
      if (s.native?.completedScript) throw new Error("Event continuation cannot also own a completed script");
      const main = execution.main, task = next.task(main.script, main.pc, main.actor, main.id);
      Object.assign(task, { stack: [...main.stack], range: { ...main.range },
        sourceEntityId: main.sourceEntityId, lastClock: s.time,
        ...(main.generalRegisters ? { generalRegisters: parseFieldCoreRegisters(main.generalRegisters) } : {}) });
      next.tasks = [task];
      next.eventRootScript = execution.eventRootScript;
      next.eventActivation = execution.eventActivation ? Object.freeze(execution.eventActivation) : null;
      next.scriptHook = execution.scriptHook && { ...execution.scriptHook,
        locals: next.eventState.importScriptLocalFrame(execution.scriptHook.locals) };
      next.puppetLifecycle = execution.puppetLifecycle && { ...execution.puppetLifecycle,
        script: structuredClone(content.scriptPuppetContexts![execution.puppetLifecycle.name]!) };
      next.cameraEventActive = execution.cameraEventActive;
      next.entryTaskStarted = execution.entryTaskStarted;
      if(next.sourceAnimationCatalog&&(next.prepareScriptCustomAsset(main.script)!==next.currentCustomAnimationAsset ||
          next.scriptHook&&next.prepareScriptCustomAsset(next.scriptHook.script)!==next.hookedCustomAnimationAsset))
        throw new Error("Saved custom animation current/hook asset differs from its actual source continuation");
      next.requireEventSaveBoundary(task);
    }
    return next;
  }
  /** Re-register immutable group definitions for their saved ordering only.
   * NPC playback/positions, treasure state and tile state come from codecs;
   * ActivateGroup/Init/Look and source event callbacks must not run here. */
  private restoreNativeGroup(name: string): void {
    const group = this.content.map.groups?.[name];
    if (!group || this.activeGroups.has(name) || this.groupBlockers(group).length)
      throw new Error("Unknown or blocked saved native entity group");
    validateFieldMoveAreas([...this.entityList, ...group.entities]);
    if (group.entities.some((entity) => entity.kind === 11 && !this.passiveEffects.has(entity.id) || entity.kind === 15))
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
  private restoreNativeOwner(saved: NonNullable<FieldCheckpoint["native"]>, source: FieldNativeRestoreDependencies,
    restoredActivities?: RestoredFieldNpcActivities,assignedMotions?:FieldNativeCheckpointContext["assignedMotions"]): void {
    const hasSkybox=Object.hasOwn(saved,"skyboxPresentation"),expectedSkybox=!!this.skyboxOwner&&!this.skyboxOwner.readiness;
    if(hasSkybox!==expectedSkybox)throw Error("Skybox save cannot grant or discard its current content/runtime owner");
    const restoredSkybox=hasSkybox?FieldSkyboxState.restore(saved.skyboxPresentation!,this.content.map.skybox!,this.requireSkyboxOwner().binding):null;
    const hasPuppetReplacement = Object.hasOwn(saved, "puppetReplacement");
    const hasMobControls = Object.hasOwn(saved, "mobControls");
    if (hasMobControls !== this.mobControlsEnabled) throw new Error("Saved Mob controls cannot grant or discard content/runtime policy");
    const hasBirdViewActors = Object.hasOwn(saved, "birdViewActors");
    checkpointKeys(saved, "actors,collision,updateMask,cameraOffset,completedScript" + (hasSkybox?",skyboxPresentation":"") + (hasBirdViewActors ? ",birdViewActors" : "") + (hasMobControls ? ",mobControls" : "") + (hasPuppetReplacement ? ",puppetReplacement" : ""));
    if (hasBirdViewActors !== this.birdViewActorsEnabled) throw new Error("Saved BirdView actor poses cannot grant or discard content/runtime policy");
    const birdPoses = hasBirdViewActors ? parseFieldBirdViewActorCheckpoint(saved.birdViewActors!) : null;
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
      this.nativeCheckpointContext(bindings, source.factory, providers(), restoredActivities?.autonomousMotions,assignedMotions,source.animationKeys));
    for (const row of birdPoses?.poses ?? []) {
      const actor = actors.find(a => a.id === row.actorId) as Actor | undefined;
      if (!actor || !actor.native || !actor.native.entity.character || actor.native.entity.riding || actor.mount || !this.content.map.identity)
        throw new Error("Saved BirdView pose has no actual bound ordinary native actor");
      actor.birdView = createFieldBirdViewActorPose({ mapId: this.content.map.identity.mapId,
        contentHash: this.content.contentHash, actorId: actor.id }, row.height);
    }
    this.publishNativeActors(actors, bindings, source.catalog, providers, source.controlContext,
      source.animationKeys, { factory: structuredClone(source.factory) }, restoredActivities);
    if (hasPuppetReplacement) this.puppetReplacementValue = this.validatePuppetReplacementState(saved.puppetReplacement!);
    if (hasMobControls) {
      for (const pose of saved.mobControls!.poses) {const actor=this.actors[pose.actorId];if(!actor)throw new Error("Saved Mob pose actor missing");this.requireMobActor(actor);}
      this.mobControlsOwner().restore(saved.mobControls!);
    }
    if(restoredSkybox)this.skyboxOwner=restoredSkybox;
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
    if (this.content.map.worldTerrain && layer === 0) {
      try {
        if (this.transportationId === null) throw new Error("Unknown world terrain transportation");
        const mask = worldTerrainCollisionMask(this.content.map.worldTerrain, this.transportationId, { x: p.x, y: p.y });
        const dynamic = this.dynamicCollision(p, layer);
        return dynamic === null ? null : mask & dynamic;
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error)); return null;
      }
    }
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
  private animatedMapContains(entity: FieldEntity, point: Point): boolean {
    const actor = this.actors[entity.id], definition = this.mapAnimationDefinition(entity);
    if (!actor?.native || actor.native.scope?.kind !== "map-animated" ||
        canonical(actor.native.mapAnimation) !== canonical(definition))
      throw new Error("Animated map collider lost its actual owner");
    return Math.abs(point.x - actor.x) < (definition.geometry.width - 2) / 32 &&
      Math.abs(point.y - actor.y) < (definition.geometry.height - 2) / 32;
  }
  private occupied(points: Point[], layer: number, exceptActorId: string = this.player.id): boolean {
    if (!this.collisionSwitches.entityCollision) return false;
    return (
      this.entityList.some(
        (e) =>
          ((e.kind === 8 && this.openTriggers.blocks(e.id)) ||
            ((e.kind === 5 || e.kind === 7 || e.kind === 10) && e.mapObject?.collision)) &&
          (this.actors[e.id]?.layer ?? e.layer) === layer &&
          this.isEntityVisible(e.id) &&
          points.some((p) => e.kind === 10 ? this.animatedMapContains(e, p) : contains(e, p)),
      ) ||
      Object.values(this.actors).some(
        (a) =>
          a.id !== exceptActorId && a.native?.scope?.kind !== "map-animated" &&
          this.isEntityVisible(a.id) &&
          this.entityList.find((e) => e.id === a.id)?.npc?.collision !==
            false &&
          a.layer === layer &&
          points.some((p) => a.x === p.x && a.y === p.y ||
            this.npcActivities.has(a.id) && a.motion !== null &&
            [a.motion.from, a.motion.to].some(cell => cell.x === p.x && cell.y === p.y) ||
            exceptActorId !== this.player.id && a.id === this.player.id && a.motion !== null &&
            [a.motion.from, a.motion.to].some(cell => cell.x === p.x && cell.y === p.y)),
      )
    );
  }
  private npcActivityInput(record: NpcActivityRuntime): FieldNpcActivityInput {
    const actor = record.actor, range = this.content.cameraHost!.mapRange;
    if (!actor.native || actor.direction === null || actor.layer === null)
      throw new Error("NPC activity lost its native pose");
    return { worldPosition: { x: actor.native.entity.position.x, y: actor.native.entity.position.y },
      direction: actor.direction, motionActive: actor.motion !== null, dtMs: 10,
      updateMask: this.entityUpdateMask,
      destinations: Object.fromEntries(Object.entries(DELTA).map(([direction, delta]) => {
        const point = fieldCameraCellToWorld(range, { x: actor.x - range.x + delta.x,
          y: actor.y - range.y + delta.y }, actor.layer!);
        return [direction, { x: point.x, y: point.y }];
      })) as Record<Direction, Point> };
  }
  private advanceNpcActivity(record: NpcActivityRuntime): void {
    this.assertNpcActivity(record);
    const { actor, binding, state } = record, program = binding.program;
    if (state.holder || (this.entityUpdateMask & program.updateAttribute) === 0) return;
    if (actor.motion) {
      const next = prepareFieldActorMotionTick(actor.motion, actor.animation, 10);
      const nextState = next.completedRoute ? completeNpcActivity(program, state, record.ticket!) : state;
      this.assertNpcActivity(record);
      actor.x = next.point.x; actor.y = next.point.y; actor.animation = next.animation;
      actor.motion = freezeNpcMotion(next.motion); record.motion = actor.motion; record.state = nextState;
      if (next.completedRoute) { record.ticket = null; actor.steps++; }
      return;
    }
    if (!Number.isInteger(actor.x) || !Number.isInteger(actor.y))
      throw new Error("NPC activity requires a settled cell before a new move");
    const input = this.npcActivityInput(record), proposal = prepareNpcActivity(program, state, input);
    let outcome: "idle" | "started" | "blocked" = "idle", motion: Motion | null = null,
      animation = actor.animation?.clone() ?? null, direction = actor.direction;
    if (proposal.intent) {
      const intent = proposal.intent, delta = DELTA[intent.direction], from = { x: actor.x, y: actor.y },
        to = { x: from.x + delta.x, y: from.y + delta.y };
      const fromMask = this.collision(from, program.layer), toMask = this.collision(to, program.layer);
      if (fromMask === null || toMask === null) throw new Error("NPC collision provider is unresolved");
      if (!(fromMask & BIT[intent.direction]) || !(toMask & BIT[OPPOSITE[intent.direction]]) ||
          this.occupied([to], program.layer, actor.id)) outcome = "blocked";
      else {
        const seconds = sourceNpcSecondsPerCell(intent.sourceSpeedEnum);
        animation?.move(intent.direction, seconds);
        motion = { from, to, elapsed: 0, duration: seconds * 1000, manual: false };
        direction = intent.direction; outcome = "started";
      }
    } else if (animation?.playing) animation.advance(10);
    const settlement = settleNpcActivity(program, proposal, outcome, state, this.npcActivityInput(record));
    this.assertNpcActivity(record);
    record.state = settlement.state; record.ticket = settlement.ticket;
    record.motion = freezeNpcMotion(motion); actor.motion = record.motion; actor.animation = animation; actor.direction = direction;
  }
  private slopeDestination(
    direction: Direction,
    straight: Point,
  ): FieldMapStep | null {
    const p = this.player,
      map = this.content.map,
      grid = map.collisions[p.layer];
    if (!grid || !inCollisionRange(straight, this.collisionRange)) return null;
    const delta = redirectAtSlope(
      grid[straight.y * map.width + straight.x]!,
      direction,
    );
    if (!delta) return null;
    let plan: FieldMapStep;
    if (this.mapTopology) {
      try { plan = projectFieldMapStep(this.mapTopology, p, delta); }
      catch { return null; }
    } else {
      const to = { x: p.x + delta.x, y: p.y + delta.y };
      if (!inCollisionRange(to, this.collisionRange)) return null;
      plan = { from: { x: p.x, y: p.y }, destination: to, unwrappedDestination: to, motionDelta: delta };
    }
    const to = plan.destination;
    let mapping = this.collisionMappings.get(p.layer);
    if (!mapping) {
      mapping = buildCollisionMapping(
        grid,
        map.width,
        map.height,
        this.collisionRange,
        this.mapTopology?.loop.horizontal ?? false,
        this.mapTopology?.loop.vertical ?? false,
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
    return this.occupied([horizontal, vertical, to], p.layer) ? null : plan;
  }
  move(direction: Direction): boolean {
    return this.directionInput(direction).kind === "movement";
  }
  /** One real direction gesture. Its result distinguishes a started step
   * from the same gesture's source door contact or blocked-cell facing. */
  directionInput(direction: Direction): FieldDirectionInputResult {
    if (!Object.hasOwn(DELTA, direction)) throw new Error("Invalid field direction");
    const p = this.player;
    if (this.options.reservedScripts?.read() || this.busy || p.motion || this.worldAutoMovementBusy || this.movementBlocker) return { kind: "rejected" };
    const prepareFace = () => {
      const animation = p.animation?.clone() ?? null;
      animation?.look(direction);
      animation?.frame();
      return animation;
    };
    const publishFace = (animation: ActorAnimation | null) => {
      p.direction = direction; p.animation = animation;
    };
    const faceBlockedStep = (): FieldDirectionInputResult => {
      if (this.stop) return { kind: "rejected" };
      try {
        publishFace(prepareFace());
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
        return { kind: "rejected" };
      }
      return { kind: "facing" };
    };
    const d = DELTA[direction];
    let to = { x: p.x + d.x, y: p.y + d.y };
    let motionTo = to;
    if (this.mapTopology) {
      try {
        const step = projectFieldMapStep(this.mapTopology, p, d);
        to = step.destination; motionTo = step.unwrappedDestination;
      } catch { return faceBlockedStep(); }
    }
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
      if (doors.length > 1) {
        this.block("同格开门触发器的接触顺序尚未恢复", site);
        return { kind: "rejected" };
      } else
        try {
          // Complete fallible pose preparation before starting source tiles
          // and collision. A missing sprite cannot leave a half-open door.
          const animation = prepareFace(), started = this.openTriggers.start(e, this.entityList, direction);
          if (started && e.openTrigger!.soundId > 0)
            this.presentationOmissions.push({
              site,
              kind: "sound",
              soundId: e.openTrigger!.soundId,
            });
          publishFace(animation);
          if (started) return { kind: "door", entityId: e.id,
            regionId: this.openTriggers.snapshot().pending!.region };
          return { kind: "facing" };
        } catch (error) {
          this.block(
            error instanceof Error ? error.message : String(error),
            site,
          );
          return { kind: "rejected" };
        }
    }
    const fromMask = this.collision(p, p.layer),
      toMask = this.collision(to, p.layer);
    if (fromMask === null || toMask === null || !(fromMask & BIT[direction]))
      return faceBlockedStep();
    if (!(toMask & BIT[OPPOSITE[direction]])) {
      try {
        const redirected = this.slopeDestination(direction, to);
        if (!redirected) return faceBlockedStep();
        to = redirected.destination; motionTo = redirected.unwrappedDestination;
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
        return { kind: "rejected" };
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
      return { kind: "rejected" };
    }
    this.pendingPlayerStep = step;
    this.pendingWalkEncounter = encounter;
    p.direction = direction;
    p.animation = movementAnimation;
    p.motion = {
      from: { x: p.x, y: p.y },
      to: motionTo,
      elapsed: 0,
      duration: 240,
      manual: true,
    };
    return { kind: "movement" };
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
  #mobControls: FieldMobControls | null = null;
  private get mobControlsEnabled(): boolean { return fieldMobColorBinding(this.content,this.options.mobColorFilter) !== undefined; }
  private mobControlsOwner(): FieldMobControls {
    const map = fieldMobColorBinding(this.content,this.options.mobColorFilter);
    if (!map) throw new Error('Mob filter requires current content and runtime authorization');
    return this.#mobControls ??= new FieldMobControls(map,()=>this.actors);
  }
  get mobControlsSnapshot() { return this.#mobControls?.snapshot() ?? null; }
  /** Candidate-only transfer. No live actor reference crosses map publication. */
  inheritMobControls(previous: FieldGame): void {
    if (!previous.#mobControls) return;
    this.mobControlsOwner().transferFrom(previous.#mobControls);
  }
  retireMobControls(): void { this.#mobControls?.retire(); }
  private requireMobActor(actor: Actor): void {
    const native=actor.native,entity=native?.entity;
    const animated=native?.scope?.kind==='map-animated'&&native.mapAnimation!==undefined;
    if(this.#mobControls?.isRetired||!this.mobControlsEnabled||!this.nativeActorBindings||!this.nativeRuntime?.mapLifecycle||!this.nativeActorProviders||!this.options.puppetActors||
      this.actors[actor.id]!==actor||!native||!entity||entity.id!==actor.id||(!entity.character&&!animated)||
      entity.childEntityObject!=='absent'||!actor.animation)
      throw new Error('Mob filter requires an actual registered sprite/character; children and unknown renderers remain gated');
    if(entity.character)requireFieldTransportPose(entity,this.transportationPresentation);
    else if(entity.riding||actor.mount||!['absent','idle'].includes(entity.rideOnEntity))throw new Error('Unknown Mob map-sprite riding material');
    if(entity.riding){
      // The actual native projection owns both IDs and the single outer clock.
      // This accepts already-bound Web riding, never grants a transport or asset.
      const catalog=this.options.partyAppearance?.catalog,keys=this.nativeRuntime.animationKeys,
        outer=native.fieldAssetId===null?undefined:catalog?.assets[native.fieldAssetId],
        inner=entity.riderAssetId===null?undefined:catalog?.assets[entity.riderAssetId];
      if(this.transportationPresentation!=='framework-development'||!outer||!inner||!actor.mount||!actor.asset||
        outer.asset!==actor.mount||inner.asset!==actor.asset||!actor.direction)
        throw new Error('Mob riding material lacks its actual inner/outer identities');
      for(const row of [outer,inner]){
        const character=this.content.characters[row.asset],sourceKeys=keys?.assets[row.asset];
        if(!character||!sourceKeys||canonical(sourceKeys.source)!==canonical(character.source)||
          missingFieldPoses(character,row===inner).length||
          row===outer&&canonical(actor.animation.character)!==canonical(character))
          throw new Error('Mob riding inner/outer media or animation source changed');
      }
    }else if(actor.mount)throw new Error('Mob material mount disagrees with its actual native riding state');
  }
  mobColorFilterAlpha(actorId: string): number {
    const actor=this.actors[actorId];if(!actor)throw new Error('Unknown Mob render actor');
    if(!actor.mobColor)return 0;this.requireMobActor(actor);
    const alpha=cloneMobColor(actor.mobColor).alpha;if(!Number.isFinite(alpha)||Math.fround(alpha)!==alpha||alpha<0||alpha>1)throw new Error('Invalid actual Mob render filter');return alpha;
  }
  private mobRegistry(): Actor[] {
    if(!this.mobControlsEnabled||!this.nativeActorBindings||!this.nativeRuntime?.mapLifecycle||!this.options.puppetActors)
      throw new Error('Mob control lacks its complete Web actor registration owner');
    // These already-admitted Web logical entities have no sprite/material owner.
    // Unknown classes and effect renderers are never silently added to this set.
    const logical=new Set([0,1,2,3,5,7,8,9,12,13,14,15,16,18,19]),passive=bindPassiveEffects(this.content);
    if(canonical([...passive].sort())!==canonical([...this.passiveEffects].sort()))throw new Error('Mob passive no-material source binding changed');
    for(const entity of this.entityList){
      if([6,17,10].includes(entity.kind)){
        const actor=this.actors[entity.id];if(!actor?.native)throw new Error('Mob source sprite is missing its registered Actor');
      }else if(entity.kind===11){
        // Both classes below explicitly allocate no Web sprite/material.
        // An arbitrary effect declaration or activeSelf=false proves neither.
        if(this.passiveEffects.has(entity.id)){
          if(this.effectBoard(entity.id)||this.actors[entity.id])throw new Error('Passive Mob effect unexpectedly owns a renderer');
        }else{
          const board=this.effectBoard(entity.id);
          if(this.fieldEffectsDisplayPolicy!==WEB_LOGICAL_FIELD_EFFECTS||!this.content.fieldEffects||!entity.effect||!board||
            canonical(board.definition)!==canonical(entity.effect)||!validateLogicalEffectMedia(this.content.fieldEffects,board.definition.assetGroup)||this.actors[entity.id])
            throw new Error('Mob effect board lacks its explicit no-material Web owner');
        }
      }else if(!logical.has(entity.kind))throw new Error('Mob registry has an unsupported source entity class: '+entity.kind);
    }
    for(const board of this.fieldEffectsSnapshot?.boards??[]){
      if(this.fieldEffectsDisplayPolicy!==WEB_LOGICAL_FIELD_EFFECTS||!this.content.fieldEffects||
        !validateLogicalEffectMedia(this.content.fieldEffects,board.definition.assetGroup)||
        !this.entityList.some(entity=>entity.kind===11&&entity.id===board.id&&canonical(entity.effect)===canonical(board.definition)))
        throw new Error('Mob effect-board material lifecycle is unresolved');
    }
    const actors=Object.values(this.actors);
    for(const actor of actors){if(!actor.native||typeof actor.native.entity.visible!=='boolean')throw new Error('Mob registry contains an unknown native instance');}
    return actors;
  }
  private executeMobControl(op: FieldMobControlOp): void {
    op={...op,command:parseMobControlCommand(op.command)};
    const owner=this.mobControlsOwner(),port=this.options.puppetActors!,registry=this.mobRegistry(),read=port.read();
    const selectors=op.command.kind==='hide'?[900,901,902,...op.command.exemptions]:[];
    const excluded=selectors.map(id=>{const selected=resolveFieldPuppetActor(read.catalog,read.context,id);return selected.actor===null?null:this.actors[selected.actor]??(()=>{throw new Error('Mob exemption lost its actual selected actor');})();});
    const active=op.command.kind==='hide'?registry.filter(actor=>actor.native!.entity.visible&&!excluded.includes(actor)):owner.liveActors() as Actor[];
    for(const actor of active)this.requireMobActor(actor);
    const materialFingerprint=()=>canonical(active.filter(actor=>actor.native!.entity.riding).map(actor=>({id:actor.id,asset:actor.asset,mount:actor.mount,
      media:[this.content.characters[actor.asset!],this.content.characters[actor.mount!]],
      keys:[this.nativeRuntime!.animationKeys!.assets[actor.asset!],this.nativeRuntime!.animationKeys!.assets[actor.mount!]]}))),
      effectFingerprint=()=>canonical({policy:this.fieldEffectsDisplayPolicy,state:this.fieldEffectsSnapshot,catalog:this.content.fieldEffects??null}),
      materialBefore=materialFingerprint(),fingerprint=canonical(read),nativeFingerprint=this.nativeActorStateFingerprint,effectsBefore=effectFingerprint(),at=this.time,actors=[...registry];
    owner.prepare(op.command,registry,excluded,this.time/1000,()=>{
      if(this.options.puppetActors!==port||canonical(port.read())!==fingerprint||this.time!==at||this.nativeActorStateFingerprint!==nativeFingerprint||effectFingerprint()!==effectsBefore||this.mobRegistry().length!==actors.length||actors.some(actor=>this.actors[actor.id]!==actor))throw new Error('Mob selector/registration changed before publication');
      for(const actor of active)this.requireMobActor(actor);
      if(materialFingerprint()!==materialBefore)throw new Error('Mob riding material changed before publication');
    })();
  }
  private advanceMobColorFilters(): void {
    const candidates=Object.values(this.actors).filter(actor=>actor.mobColor?.tween&&actor.native?.entity.visible&&
      (this.entityUpdateMask&(actor.native.updateAttribute??2))!==0).map(actor=>{
      this.requireMobActor(actor);return {actor,native:actor.native!,entity:actor.native!.entity,prior:actor.mobColor!,next:tickMobColor(actor.mobColor!,this.time/1000)};
    });
    if(candidates.some(c=>this.actors[c.actor.id]!==c.actor||c.actor.native!==c.native||c.native.entity!==c.entity||c.actor.mobColor!==c.prior))throw new Error('Stale Mob material clock');
    for(const c of candidates)c.actor.mobColor=c.next;
  }
  private get birdViewActorsEnabled(): boolean {
    return fieldBirdViewActorBinding(this.content, this.options.birdViewActors) !== undefined;
  }
  private birdViewActorBinding(actor: Actor) {
    if (!this.birdViewActorsEnabled || !this.content.map.identity || !this.nativeActorBindings ||
        !this.nativeRuntime?.mapLifecycle || !this.nativeActorProviders || !this.camera ||
        this.actors[actor.id] !== actor || !actor.native || actor.native.entity.id !== actor.id ||
        !actor.native.entity.character || actor.native.entity.riding || actor.mount || this.effectBoard(actor.id))
      throw new Error("MoveBirdView requires its trusted Web policy and actual ordinary native actor owner");
    return { ...fieldBirdViewActorBinding(this.content, this.options.birdViewActors)!, actorId: actor.id };
  }
  /** Presentation-only pixels. Missing source instances never become a known
   * absent Bird puppet; unsupported actor bindings are rejected on execution. */
  birdViewActorElevation(actorId: string): number {
    const actor = this.actors[actorId];
    if (!actor?.birdView) return 0;
    return parseFieldBirdViewActorPose(actor.birdView, this.birdViewActorBinding(actor)).height;
  }
  private captureBirdViewActorPoses(): FieldBirdViewActorCheckpoint | undefined {
    const poses = Object.values(this.actors).filter(actor => actor.birdView !== undefined);
    if (!this.birdViewActorsEnabled) {
      if (poses.length) throw new Error("BirdView actor poses cannot grant a missing runtime/content policy");
      return undefined;
    }
    return { kind: "field-bird-view-actor-poses-v1", poses: poses.map(actor => ({ actorId: actor.id,
      height: parseFieldBirdViewActorPose(actor.birdView!, this.birdViewActorBinding(actor)).height })) };
  }
  private startBirdViewMove(task: Task, actor: Actor, op: Extract<Op, { kind: "field-bird-view-move" }>): NonNullable<Task["birdViewMove"]> {
    const binding = this.birdViewActorBinding(actor);
    const pose = actor.birdView ? parseFieldBirdViewActorPose(actor.birdView, binding) : createFieldBirdViewActorPose(binding);
    const progress = prepareFieldBirdViewMove(op.command, { kind: "present", height: pose.height }, this.time / 1000);
    const registers = projectFieldCoreSlots(task.generalRegisters, { r: { 0: progress.start, 1: progress.target, 2: progress.startedAt } });
    // All fallible height preparation precedes the existing Move publication.
    // The delegated Move retains every actor, loop, collision and media gate.
    if (op.command.move) this.startScriptMove(actor, { ...op, kind: "field-script-motion", command: op.command.move });
    task.generalRegisters = registers; actor.birdView = pose;
    return { op, registers, actor, native: actor.native!, entity: actor.native!.entity };
  }
  private tickBirdViewMove(task: Task, pending: NonNullable<Task["birdViewMove"]>): "wait" | "next" {
    const { actor, native, entity, op } = pending;
    if (task.generalRegisters !== pending.registers || this.actors[actor.id] !== actor || actor.native !== native || native.entity !== entity)
      throw new Error("MoveBirdView lost its actual actor instance");
    const binding = this.birdViewActorBinding(actor);
    const pose = parseFieldBirdViewActorPose(actor.birdView!, binding);
    const bank = parseFieldCoreRegisters(task.generalRegisters);
    const progress = { start: bank.r[0]!, target: bank.r[1]!, startedAt: bank.r[2]! };
    const next = projectFieldBirdViewMove(op.command, progress, { kind: "present", height: pose.height },
      this.time / 1000, actor.motion !== null);
    actor.birdView = createFieldBirdViewActorPose(binding, next.height!);
    return next.flow;
  }
  private requireOrdinaryScriptMove(actor: Actor): void {
    if (!actor.native || !this.nativeRuntime ||
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
  }
  private publishScriptMove(actor: Actor, command: Extract<Op, { kind: "field-script-motion" }>["command"] & { kind: "move" },
    plan: ReturnType<typeof prepareFieldScriptMove>): void {
    // Ordinary FieldEntity ctor has magnification 1. The actual player has a
    // separate MoveTo override and was explicitly excluded above.
    // Empty SearchSimple route leaves the entity untouched, but the caller
    // still observes Move's mandatory first-clock Wait.
    if (plan.points.length === 0) return;
    const animation = actor.animation!.clone();
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
  private gridRouteCanStep(from: Point, to: Point, layer: number | null, actorId: string): boolean {
    const direction = fieldRouteDirection(from, to);
    if (layer === null) throw new Error("Puppet Route lost its logical layer");
    const a = this.collision(from, layer), b = this.collision(to, layer);
    if (a === null || b === null) throw new Error(this.stop?.message ?? "Puppet Route collision provider is unavailable");
    return !!(a & BIT[direction]) && !!(b & BIT[OPPOSITE[direction]]) && !this.occupied([to], layer, actorId);
  }
  private puppetRouteCanStep(actor: Actor, from: Point, to: Point): boolean {
    return this.gridRouteCanStep(from, to, actor.layer, actor.id);
  }
  private cameraRouteGrid() {
    if (!this.camera || this.content.cameraHost?.callbacks !== "fresh-normal-field-v1" ||
        (this.content.entry.viewPlan?.presentationViewType ?? 0) !== 0)
      throw new Error("Camera Puppet Route requires its ordinary bound host");
    const layer = [349, 249, 149].indexOf(this.camera.snapshot().dummy.position.z);
    if (layer < 0) throw new Error("Camera Puppet Route source Z provider is unavailable");
    return { policy: this.puppetRoutePolicy, canStep: (from: Point, to: Point) => this.gridRouteCanStep(from, to, layer, this.cameraActorId) };
  }
  private startPuppetRoute(actor: Actor, op: Extract<Op, { kind: "field-puppet-route" }>): "next" | "wait" {
    if (!actor.native || !this.nativeRuntime || !this.nativeActorProviders || !this.camera ||
        (this.content.entry.viewPlan?.presentationViewType ?? 0) !== 0 ||
        this.content.cameraHost?.callbacks !== "fresh-normal-field-v1" || !actor.animation ||
        actor.layer === null || actor.layer > 2 || actor.motion)
      throw new Error("Puppet Route requires its settled ordinary native actor and map providers");
    if (!actor.native.entity.character || this.npcActivities.has(actor.id) || this.assignedRoutes.has(actor.id))
      throw new Error("Puppet Route requires an ordinary actor without another NPC controller owner");
    requireFieldTransportPose(actor.native.entity, this.transportationPresentation);
    if (actor.native.entity.riding || actor.mount)
      throw new Error("Puppet Route riding path provider is unavailable");
    if (actor.id === this.player.id)
      throw new Error("Actual-player Puppet Route movement-state magnification provider is unavailable");
    if (actor.native.entity.position.z !== [349, 249, 149][actor.layer])
      throw new Error("Puppet Route noncanonical Z provider is unavailable");
    const plan = prepareFieldPuppetRoute(op.command, { policy: this.puppetRoutePolicy,
      from: { x: actor.x, y: actor.y }, layer: actor.layer, range: this.content.cameraHost.mapRange,
      loop: this.content.cameraHost.loop, magnification: 1,
      canStep: (a, b) => this.puppetRouteCanStep(actor, a, b) });
    if (plan.flow === "next") return "next";
    this.publishScriptMove(actor, { kind: "move", direction: plan.direction,
      steps: plan.points.length, speedId: op.command.speedId, animation: op.command.animation }, plan);
    actor.motion!.route!.search = WEB_PUPPET_ROUTE_POLICY;
    return "wait";
  }
  private startScriptMove(actor: Actor, op: Extract<Op, { kind: "field-script-motion" }>): void {
    if (op.command.kind !== "move") throw new Error("Expected source Move command");
    this.requireOrdinaryScriptMove(actor);
    const plan = prepareFieldScriptMove(op.command, actor, { loop: this.content.cameraHost!.loop, magnification: 1 });
    this.publishScriptMove(actor, op.command, plan);
  }
  private startScriptMoveTo(actor: Actor, op: Extract<Op, { kind: "field-script-motion" }>): "next" | "wait" {
    if (op.command.kind !== "move-to") throw new Error("Expected source MoveTo command");
    if (!actor.native || !this.nativeRuntime || !this.nativeActorProviders || !this.camera ||
        this.content.cameraHost?.callbacks !== "fresh-normal-field-v1")
      throw new Error("Source MoveTo requires its native actor and ordinary map target providers");
    const command = op.command, map = this.content.cameraHost!.mapRange;
    let target: { x: number; y: number; z: number } | undefined;
    if (command.target.kind === "entity") {
      if (!this.options.puppetActors) throw new Error("Source MoveTo target entity selector owner is unavailable");
      const { catalog, context } = this.options.puppetActors.read();
      const resolved = resolveFieldPuppetActor(catalog, context, command.target.selector);
      if (resolved.actor === null) throw new Error("Source MoveTo target entity is unavailable");
      const entity = this.actors[resolved.actor]?.native?.entity;
      if (entity) target = { ...entity.position };
      else if (resolved.actor === this.cameraActorId && this.camera) target = { ...this.camera.snapshot().dummy.position };
      else throw new Error("Source MoveTo target entity has no bound native position");
    }
    const owner = { ...actor.native!.entity.position };
    const resolved = resolveFieldScriptMoveToTarget(command, map, owner, target);
    if (resolved === null) return "next"; // Source nullable-empty skips, without a Move or first-clock wait.
    this.requireOrdinaryScriptMove(actor);
    if (actor.native!.entity.riding)
      throw new Error("Source MoveTo riding movement provider is unavailable");
    if (resolved.logicalLayer !== actor.layer)
      throw new Error("Source MoveTo layer transition route provider is unavailable");
    if (owner.z !== [349, 249, 149][actor.layer!])
      throw new Error("Source MoveTo noncanonical Z waypoint provider is unavailable");
    const local = fieldCameraWorldToCell(map, { x: owner.x, y: owner.y }), from = { x: local.x + map.x, y: local.y + map.y };
    const distance = resolved.point[command.axis] - from[command.axis];
    if (distance === 0) throw new Error("Source MoveTo empty SearchSimple warning provider is unavailable");
    const direction: Direction = command.axis === "x" ? distance > 0 ? "right" : "left" : distance > 0 ? "down" : "up";
    const move = { kind: "move" as const, direction, steps: Math.abs(distance), speedId: command.speedId, animation: command.animation };
    const plan = prepareFieldScriptMove(move, from, { loop: this.content.cameraHost!.loop, magnification: 1 });
    this.publishScriptMove(actor, move, plan);
    return "wait";
  }
  /** Source actor commands prepare against the existing owner. Selector aliases
   * never become a second actor, and positioning never grants visibility. */
  private prepareActorControl(actorId: string, op: Extract<Op, { kind: "position" | "actor-visibility" }>): () => void {
    const actor = this.actors[actorId];
    if (op.kind === "actor-visibility") {
      if (typeof op.visible !== "boolean") throw new Error("Invalid source actor visibility");
      const visible = op.visible;
      if (op.timing && op.timing.durationSeconds !== 0) {
        if (!actor?.native || !this.options.puppetActors || this.effectBoard(actorId) || actorId === this.cameraActorId ||
            this.tileAnimations.has(actorId) || !actor.native.entity.character || !actor.animation)
          throw new Error("Timed source visibility requires its ordinary native sprite owner");
        if (!Number.isFinite(op.timing.durationSeconds) || Math.fround(op.timing.durationSeconds) !== op.timing.durationSeconds ||
            op.timing.durationSeconds <= 0 || !Number.isFinite(op.timing.delaySeconds))
          throw new Error("Invalid source actor visibility timing");
        return this.options.puppetActors.prepare({ leaderId: null, assignments: null, effects: [{ kind: "visibility-fade",
          actor: actor.id, visible, durationSeconds: op.timing.durationSeconds, nowSeconds: this.time / 1000 }] });
      }
      if (this.effectBoard(actorId)) {
        const next = this.effects!.prepare([{ kind: "visibility", id: actorId, visible, duration: 0 }]);
        return () => next.commit();
      }
      if (this.camera && actorId === this.cameraActorId) {
        const next = this.camera.prepareVisibility(visible);
        return () => next.commit();
      }
      if (this.tileAnimations.has(actorId)) throw new Error("Tile animation visibility lifecycle is not implemented");
      if (!actor) throw new Error("Source actor visibility requires its bound owner");
      if (actor.native) {
        const port = this.options.puppetActors;
        if (!port) throw new Error("Source actor visibility host is unavailable");
        return port.prepare({ leaderId: null, assignments: null,
          effects: [{ kind: visible ? "show" : "hide", actor: actor.id }] });
      }
      if (this.options.nativeActorPreparation || this.options.puppetActors || this.content.scriptPuppetContexts)
        throw new Error("Source actor visibility requires its native owner");
      const hidden = this.hiddenEntities.has(actorId);
      let committed = false;
      return () => {
        if (committed || this.actors[actorId] !== actor || this.hiddenEntities.has(actorId) !== hidden)
          throw new Error("Stale actor visibility transaction");
        if (visible) this.hiddenEntities.delete(actorId); else this.hiddenEntities.add(actorId);
        committed = true;
      };
    }
    if (!actor?.native || !op.nativeCommand || !this.nativeActorProviders || !this.camera ||
        this.content.cameraHost?.callbacks !== "fresh-normal-field-v1" ||
        op.x !== op.nativeCommand.x || op.y !== op.nativeCommand.y || op.animation !== op.nativeCommand.animation)
      throw new Error("Source actor SetPos operands or callback host are unavailable");
    const command = structuredClone(op.nativeCommand), port = this.options.puppetActors;
    let referenceActorId: string | undefined;
    const resolveReference = () => {
      if (command.mode !== 1) return undefined;
      if (!port || this.options.puppetActors !== port)
        throw new Error("Source relative SetPos selector owner is unavailable");
      const { catalog, context } = port.read();
      const resolved = resolveFieldPuppetActor(catalog, context, command.referenceEntityId);
      if (resolved.actor === null) throw new Error("Source relative SetPos reference entity is unavailable");
      return resolved.actor;
    };
    referenceActorId = resolveReference();
    return prepareNativeFieldActorProjection({
      readActors: () => this.actors, readProviders: this.nativeActorProviders,
      readCamera: () => { const state = this.camera!.snapshot();
        return { id: this.cameraActorId, position: state.dummy.position, layer: state.dummy.layer }; },
    }, (snapshot, providers) => projectNativeFieldPosition(snapshot, providers, actor.id, command,
      this.content.cameraHost!.mapRange, "source-absent", referenceActorId),
    () => { if (resolveReference() !== referenceActorId) throw new Error("Stale source relative SetPos selector"); });
  }
  private prepareCameraPosition(op: Extract<Op, { kind: "position" }>): () => void {
    const camera = this.camera, definition = this.content.cameraHost, command = op.cameraCommand;
    if (!camera || !definition || definition.callbacks !== "fresh-normal-field-v1" || !command ||
        op.x !== command.x || op.y !== command.y || op.animation !== "" ||
        op.nativeCommand && (op.nativeCommand.x !== command.x || op.nativeCommand.y !== command.y || op.nativeCommand.layer !== 0 || op.nativeCommand.animation !== "" ||
          op.nativeCommand.mode !== command.mode || op.nativeCommand.referenceEntityId !== command.referenceEntityId))
      throw new Error("Source camera SetPos operand shape or callback host is unavailable");
    if (this.#worldAutoDummyMotion || this.tasks.some(t => !t.done && t.actor === this.cameraActorId && (t.cameraLerp || t.cameraPath)))
      throw new Error("Source camera SetPos during active movement is unresolved");
    const port = this.options.puppetActors, fingerprint = canonical(definition), runtime = this.nativeRuntime,
      bindings = this.nativeActorBindings, providers = this.nativeActorProviders, factory = runtime?.mapLifecycle?.factory,
      sources = canonical({ runtime, bindings }), viewPolicy = this.options.viewChange,
      retainedPolicy = this.options.retainedWorldTransportation;
    const assertCurrentHost = () => {
      if (this.camera !== camera || canonical(this.content.cameraHost) !== fingerprint ||
          this.nativeRuntime !== runtime || this.nativeActorBindings !== bindings || this.nativeActorProviders !== providers ||
          runtime?.mapLifecycle?.factory !== factory || canonical({ runtime, bindings }) !== sources ||
          this.options.viewChange !== viewPolicy || this.options.retainedWorldTransportation !== retainedPolicy)
        throw new Error("Stale source camera SetPos host");
      const view = this.currentView;
      if (view && (viewPolicy === undefined || canonical(fieldViewBinding(this.content, viewPolicy)) !== canonical(view.binding)))
        throw new Error("Source camera SetPos dynamic view policy is unavailable");
    };
    assertCurrentHost();
    let referenceId: string | undefined, referencePosition, validateReference = () => {};
    if (command.mode === 1) {
      if (!op.nativeCommand || !port || !this.nativeActorProviders || !this.nativeActorBindings || !this.nativeRuntime?.mapLifecycle)
        throw new Error("Source relative camera SetPos selector owner is unavailable");
      const resolveReference = () => {
        if (this.options.puppetActors !== port) throw new Error("Source relative camera SetPos selector owner changed");
        const { catalog, context } = port.read();
        const resolved = resolveFieldPuppetActor(catalog, context, command.referenceEntityId);
        if (resolved.actor === null) throw new Error("Source relative camera SetPos reference entity is unavailable");
        return resolved.actor;
      };
      referenceId = resolveReference();
      const read = prepareNativeFieldActorRead({ readActors: () => this.actors, readProviders: this.nativeActorProviders,
        readCamera: () => { const state = camera.snapshot(); return { id: this.cameraActorId,
          position: state.dummy.position, layer: state.dummy.layer }; } });
      const reference = read.snapshot.actors.find(a => a.id === referenceId)
        ?? (read.snapshot.camera?.id === referenceId ? read.snapshot.camera : null);
      if (!reference) throw new Error("Source relative camera SetPos requires its actual native reference instance");
      referencePosition = reference.position;
      validateReference = () => {
        if (resolveReference() !== referenceId) throw new Error("Stale source relative camera SetPos selector");
        read.validate();
      };
    }
    const prepared = camera.prepareSetPosition(command, referencePosition);
    return () => {
      assertCurrentHost(); validateReference(); prepared.commit();
    };
  }
  private executeActorVisibility(actorId: string, op: Extract<Op, { kind: "actor-visibility" }>,
    programName: string, webPc: number): void {
    const durationSeconds = op.timing?.durationSeconds ?? 0, delaySeconds = op.timing?.delaySeconds ?? 0;
    if (!Number.isFinite(delaySeconds) || !Number.isFinite(durationSeconds) || durationSeconds < 0 ||
        Math.fround(durationSeconds) !== durationSeconds) throw new Error("Invalid source actor visibility timing");
    const actor = this.actors[actorId];
    // Validate every effect dependency before registering deferred work. The
    // returned candidate is deliberately not committed until its actual due update.
    const publish = this.prepareActorControl(actorId, op);
    if (delaySeconds !== 0) {
      if (!actor?.native || this.effectBoard(actorId) || actorId === this.cameraActorId || this.tileAnimations.has(actorId))
        throw new Error("Delayed source visibility requires its captured native actor identity");
      const program=this.content.scripts[programName];
      if (!program || program[webPc] !== op) throw new Error("Delayed source visibility lost its issuing Web instruction");
      const ticket = this.nextVisibilityTimer++;
      this.visibilityTimers.push({ ticket, op: structuredClone(op), programName, program, webPc, instruction: op,
        actor, entity: actor.native.entity,
        recordedSeconds: Math.fround(this.time / 1000), delaySeconds });
      this.visibilityJournal.push({ ticket, phase: "queued", site: op, actorId, atMilliseconds: this.time,
        visible: op.visible, durationSeconds, delaySeconds });
    } else {
      publish(); this.visibilityJournal.push({ ticket: null, phase: "applied", site: op, actorId,
        atMilliseconds: this.time, visible: op.visible, durationSeconds, delaySeconds });
    }
  }
  private advanceActorVisibilityTimers(): void {
    // Insert-at-zero plus reverse native scan yields oldest-first delivery.
    // Copy the eligible old set: new callbacks never execute in this Update.
    for (const pending of [...this.visibilityTimers]) {
      if (!sourceVisibilityDelayDue(pending.recordedSeconds, pending.delaySeconds, this.time / 1000)) continue;
      const { actor, op } = pending;
      if (this.actors[actor.id] !== actor || actor.native?.entity !== pending.entity ||
          this.content.scripts[pending.programName] !== pending.program ||
          pending.program[pending.webPc] !== pending.instruction || canonical(pending.instruction) !== canonical(op))
        throw new Error("Delayed source visibility lost its captured actor or source instruction");
      this.prepareActorControl(actor.id, op)();
      const index = this.visibilityTimers.indexOf(pending);
      if (index < 0) throw new Error("Source visibility timer ticket was reused");
      this.visibilityTimers.splice(index, 1);
      this.visibilityJournal.push({ ticket: pending.ticket, phase: "applied", site: op, actorId: actor.id,
        atMilliseconds: this.time, visible: op.visible, durationSeconds: op.timing?.durationSeconds ?? 0,
        delaySeconds: pending.delaySeconds });
    }
  }
  private advanceActorVisibilityFades(): void {
    const effects = Object.values(this.actors).flatMap(actor => actor.native && !actor.mobColor?.tween && actorFadeActive(actor.native.entity) &&
      (this.entityUpdateMask & (actor.native.updateAttribute ?? 2)) !== 0
      ? [{ kind: "visibility-tick" as const, actor: actor.id, nowSeconds: this.time / 1000 }] : []);
    if (!effects.length) return;
    if (!this.options.puppetActors) throw new Error("Source actor fade lost its native publication owner");
    this.options.puppetActors.prepare({ leaderId: null, assignments: null, effects })();
  }
  /** The scoped Web observer reads the current registration order and the
   * existing native actors. Immutable host bindings never become a second
   * live actor collection or a guessed link from a relay to a shopkeeper. */
  private relayInteractionTarget(target: Point, direction: Direction): FieldEntity | null | undefined {
    const host = this.content.frameworkRelayInteraction;
    if (!host) return undefined;
    const relays = this.entityList.filter(entity => entity.kind === 16);
    if (!relays.length) return undefined;
    const player = this.player, native = player.native;
    if (!native || !this.content.cameraHost || native.entity.moving || native.entity.riding ||
        player.mount || native.entity.direction !== player.direction || !DELTA[direction])
      throw new Error("Relay interaction requires the stationary walking native player");
    // Validate against live trusted content before touching an interaction.
    const currentBindings = bindFieldRelays(this.content);
    if (canonical([...currentBindings]) !== canonical([...this.relayBindings]))
      throw new Error("Relay interaction host changed after field creation");
    const range = this.content.cameraHost.mapRange,
      parentContext = host.parentContext,
      placements = relays.map(entity => {
        const definition = currentBindings.get(entity.id);
        if (!definition || canonical(definition) !== canonical(entity.relay))
          throw new Error("Registered relay lost its source geometry binding");
        return {
          worldPosition: fieldNativeMapObjectPosition({ ...definition.rawGeometry, layer: definition.layer }, range,
            this.content.nativeNpcStandby ? fieldNativeNpcStandbyPosition(this.content.nativeNpcStandby) : undefined),
          horizontalCellLimit: definition.horizontalCellLimit,
          verticalCellLimit: definition.verticalCellLimit,
        };
      }),
      searchRanges = projectFieldRelaySearchRanges({ playerLocalPosition: native.entity.position,
        registeredRelays: placements, parentContext }).searchRanges,
      loop = this.content.cameraHost.loop,
      mapArea = partyActorMapArea(range.width, range.height, (loop.horizontal ? 1 : 0) + (loop.vertical ? 2 : 0));
    const colocated: FieldEntity[] = [], front: FieldEntity[] = [];
    for (const entity of this.entityList) {
      if (![5, 6, 7, 10, 17].includes(entity.kind) ||
          entity.kind === 7 && entity.mapObject?.collision === false && this.openedTreasures.has(entity.id)) continue;
      const properties = entity.npc ?? entity.mapObject, actor = this.actors[entity.id];
      if (!this.isEntityVisible(entity.id) || !flatNpcInteractionLayer(this.flatNpcBindings.get(entity.id), actor?.layer ?? entity.layer, player.layer) ||
          (properties ? properties.interaction.kind === "none" : !entity.script) ||
          properties && (!(properties.acceptDirection & ACTION_SIDE[OPPOSITE[direction]]) ||
            properties.interaction.kind !== "blocked" && !properties.talkMounts.includes(player.mount ?? ""))) continue;
      if (entity.kind !== 6 && entity.kind !== 17) {
        if (entity.kind === 10 ? this.animatedMapContains(entity, target) : contains(entity, target)) front.push(entity);
        continue;
      }
      if (!actor?.native) throw new Error("Relay target has no current native actor position");
      const position = actor.native.entity.position;
      if ((!this.flatNpcBindings.get(entity.id)?.allLayerTarget && position.z !== native.entity.position.z) || !canFieldRelayInteractToEntityPosition({
        playerLocalPosition: native.entity.position, targetLocalPosition: position,
        playerDirection: direction, objectType: entity.kind, searchRanges, mapArea, parentContext,
      })) continue;
      if (entity.nativeNpc?.controller !== "wait" || actor.motion || actor.native.entity.moving)
        throw new Error("Relay moving-target observer is outside the declared known-Wait scope");
      if (position.x === native.entity.position.x && position.y === native.entity.position.y) colocated.push(entity);
      else front.push(entity);
    }
    return colocated[0] ?? front[0] ?? null;
  }
  /** Read-only target projection for the same direction/confirm command path.
   * A requested facing can be inspected before its actual animation commits;
   * this never turns an actor, opens a service or starts an event task. */
  interactionTarget(direction: Direction = this.player.direction): FieldEntity | null {
    if (!DELTA[direction]) throw new Error("Unknown interaction direction");
    if (this.options.reservedScripts?.read() || this.busy || this.player.motion || !this.collisionSwitches.interactiveObservation) return null;
    const p = this.player, d = DELTA[direction], rawTarget = { x: p.x + d.x, y: p.y + d.y };
    let target = rawTarget;
    if (this.mapTopology) {
      try { target = canonicalCell(this.mapTopology, rawTarget); }
      catch { return null; }
    }
    const relayTarget = this.relayInteractionTarget(target, direction);
    if (relayTarget !== undefined) return relayTarget;
    const hits = this.entityList.filter((e) => {
      const properties = e.npc ?? e.mapObject;
      return (
        (e.kind === 6 || e.kind === 17 || e.kind === 5 || e.kind === 7 || e.kind === 10) &&
        !(e.kind === 7 && e.mapObject?.collision === false && this.openedTreasures.has(e.id)) &&
        this.isEntityVisible(e.id) && flatNpcInteractionLayer(this.flatNpcBindings.get(e.id), this.actors[e.id]?.layer ?? e.layer, p.layer) &&
        (properties ? properties.interaction.kind !== "none" : !!e.script) &&
        (e.kind === 6 || e.kind === 17
          ? !!this.actors[e.id] && (this.actors[e.id]!.x === target.x && this.actors[e.id]!.y === target.y ||
            this.npcActivities.has(e.id) && this.actors[e.id]!.motion !== null &&
            [this.actors[e.id]!.motion!.from, this.actors[e.id]!.motion!.to]
              .some(cell => cell.x === target.x && cell.y === target.y))
          : e.kind === 10 ? this.animatedMapContains(e, target) : contains(e, target)) &&
        (!properties || !!(properties.acceptDirection & ACTION_SIDE[OPPOSITE[direction]]) &&
          (properties.interaction.kind === "blocked" || properties.talkMounts.includes(p.mount ?? "")))
      );
    });
    if (hits.length > 1) throw new Error("同格交互目标不明确");
    return hits[0] ?? null;
  }
  confirm(): void {
    if(this.sourcePartySelectionRequest)return;
    if (this.coreRegisterPublishing) throw new Error("Core publication is in progress");
    // Confirm is not a choice response. Even an answered request waits for its
    // own interpreter clock before another input can dismiss the next message.
    if (this.stop || this.pendingChoice) return;
    if (this.sourceMessage.active) { this.sourceMessage.confirm(); return; }
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
    if (this.options.reservedScripts?.read() || this.busy || this.player.motion || !this.collisionSwitches.interactiveObservation) return;
    const p = this.player;
    let e: FieldEntity | null;
    try { e = this.interactionTarget(); }
    catch (error) {
      this.block(error instanceof Error ? error.message : String(error));
      return;
    }
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
    const activity = actor && this.npcActivities.get(actor.id);
    if (npc && (npc.moveType !== 0 || actor?.motion) && !activity) {
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
    let acquisition: ReturnType<typeof acquireNpcActivity> | null = null,
      interactionAnimation = actor?.animation?.clone() ?? null;
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
      if (activity) {
        this.assertNpcActivity(activity);
        acquisition = acquireNpcActivity(activity.binding.program, activity.state,
          `npc-event:${this.choiceNamespace}:${this.nextNpcEvent}`);
      }
      if (npc?.eyeContact && actor) interactionAnimation?.look(OPPOSITE[p.direction]);
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
      ...(activity && acquisition ? { activity: { record: activity, lease: acquisition.lease, motion: actor!.motion } } : {}),
    };
    if (activity && acquisition) { activity.state = acquisition.state; this.nextNpcEvent++; }
    if (npc?.eyeContact && actor) {
      actor.direction = OPPOSITE[p.direction];
      actor.animation = interactionAnimation;
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
    const references = fieldMessageNameReferences(template);
    if (references.length && !this.options.messageNames) throw new Error("Source message character name owner is unavailable");
    const names = references.length ? this.options.messageNames!.prepare(references) : null;
    const fee = fieldMessageUsesFee(template) ? this.sourceMessage.prepareFeeValue() : null;
    const resolved = resolveFieldMessageTemplate(template, names?.names ?? [], fee?.value);
    return { message: { ...structuredClone(plain), text: resolved.pages[0]!, speaker: resolved.speaker },
      pages: resolved.pages, validate: () => { validateContent(); names?.validate(); fee?.validate(); } };
  }
  private beginManualDialogue(op: Extract<Op, { kind: "message" }>, task: Task): void {
    const manual = op.manual;
    if (!manual || !Array.isArray(manual.pages) || manual.pages.length === 0 ||
        manual.pages.some(page => typeof page !== "string" || page.length === 0 || /<|\\/.test(page)) ||
        op.text !== manual.pages[0] || !["frame", "none"].includes(manual.window) ||
        !["top", "middle", "bottom"].includes(manual.anchor) || !["close", "message", "choice"].includes(manual.after))
      throw new Error("Invalid ordinary source Msg document");
    const handoff = this.sourceMessage.active && this.sourceMessageTask === task.id && this.sourceMessage.sequenceAfter === "message",
      release = handoff ? this.sourceMessage.prepareManualHandoff() : null;
    if (this.sourceMessage.active && !handoff || this.shopTask || this.treasureSceneState === "message")
      throw new Error("Ordinary source Msg conflicts with an occupied message manager");
    const before = this.messageWindow, presentation = this.prepareMessagePresentation(op, manual.pages),
      prepared: Dialogue = { ...presentation.message, task: task.id,
      manual: { ...structuredClone(manual), pages: presentation.pages, page: 0, availableAt: this.time + 10,
        site: { script: op.script, index: op.index, source: structuredClone(op.source) } } },
      publish = this.prepareDialogueMask(8);
    if (this.messageWindow !== before) throw new Error("Stale ordinary source Msg preparation");
    presentation.validate();
    publish(); release?.commit();
    if (handoff) this.sourceMessageTask = null;
    this.retainedMessage = null;
    this.dialogue = prepared;
    // Manual source Msg is exactly rValues[0] === 0; r1 is untouched.
    task.generalRegisters = projectFieldCoreSlots(task.generalRegisters, { i: { 0: 0, 1: 0, 2: 0 }, r: { 2: 0 } });
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
      const close = this.sourceMessage.active ? this.sourceMessage.prepare({ kind: "source-message", command: { kind: "close" } }) : null;
      publish(); close?.commit();
      this.sourceMessageTask = null;
      this.retainedMessage = null;
    } else if (this.sourceMessage.active) {
      if (this.sourceMessageTask !== t.id) throw new Error("Source choice message belongs to another task");
      this.sourceMessage.retainAfterChoice();
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
    const { entityId, restoreDirection, activity } = this.interaction, actor = this.actors[entityId];
    try {
      const animation = actor?.animation?.clone() ?? null;
      let direction = restoreDirection;
      let settlement: ReturnType<typeof releaseNpcActivity> | null = null;
      if (activity) {
        this.assertNpcActivity(activity.record);
        if (actor !== activity.record.actor || actor.motion !== activity.motion)
          throw new Error("NPC event replaced its paused movement owner");
        settlement = releaseNpcActivity(activity.record.binding.program, activity.record.state, activity.lease);
        if (settlement.state.pending) {
          direction = settlement.state.pending.direction;
          animation?.move(direction, sourceNpcSecondsPerCell(activity.record.binding.program.sourceSpeedEnum));
          animation?.linkToMovement(actor.motion!.elapsed / actor.motion!.duration);
          animation?.frame();
        } else if (direction) animation?.look(direction);
      } else if (direction) animation?.look(direction);
      if (actor && direction) { actor.direction = direction; actor.animation = animation; }
      if (activity && settlement) { activity.record.state = settlement.state; activity.record.ticket = settlement.ticket; }
      this.interaction = null;
    } catch (error) { this.block(error instanceof Error ? error.message : String(error)); }
  }
  /** Integer 10 ms simulation steps make render-frame partitioning irrelevant. */
  advance(milliseconds: number): void {
    if(this.skyboxOwner?.isRetired)return;
    if (this.puppetReplacementRetired && this.puppetReplacementValue) return;
    if(this.sourcePartySelectionRequest)return;
    if (this.coreRegisterPublishing) throw new Error("Core publication is in progress");
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 60000
    )
      throw new Error("Invalid elapsed time");
    if ((this.skyboxOwner || this.mobControlsEnabled || this.birdViewActorsEnabled || this.content.frameworkNpcActivity || this.assignedRoutes.size > 0 || this.tasks.some(task => !task.done && task.animationRepeat)) && this.options.npcActivityClock && !this.options.npcActivityClock()) return;
    if (this.pendingEventSave) return;
    this.remainder += milliseconds;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.stop || this.pendingEventSave) continue;
      try { for (const task of this.tasks) if (!task.done && task.animationRepeat) this.assertFiniteAnimation(task); }
      catch (error) { this.block(error instanceof Error ? error.message : String(error)); return; }
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
      try { this.advanceWorldAutoTasks(); }
      catch(error){this.block(error instanceof Error?error.message:String(error));return;}
      try { this.advanceActorVisibilityTimers(); }
      catch (error) { this.block(error instanceof Error ? error.message : String(error)); return; }
      try{if(this.skyboxOwner&&(!this.options.npcActivityClock||this.options.npcActivityClock())){if(!fieldSkyboxBinding(this.content,this.options.skyboxPresentation)||canonical(this.content.map.skybox)!==this.skyboxDefinitionPin)throw Error("Skybox runtime/content owner changed");this.skyboxOwner.advance(Math.fround(this.time/1000));}}catch(error){this.block(error instanceof Error?error.message:String(error));return;}
      this.fader.advance(0.01);
      this.colorFilterState?.advance(0.01);
      try{if(this.screenPresentationState){if(!fieldScreenPresentationBinding(this.content,this.options.screenPresentation))throw new Error("Screen presentation runtime/content authorization revoked");if(!this.options.npcActivityClock||this.options.npcActivityClock())this.screenPresentationState.advance(10);}}catch(error){this.block(error instanceof Error?error.message:String(error));return;}
      try { this.cameraShakeState?.advance(); }
      catch (error) { this.block(error instanceof Error ? error.message : String(error)); return; }
      this.advanceStoryTimer(10, this.messageWindow || this.choicePending || this.sourceMessage.active ? "message"
        : this.openTriggers.busy || this.treasureSceneState === "message" ? "gimmick" : this.fieldActivityBusy ? this.eventActivation ? "gimmick" : "event" : "player");
      this.sourceMessage.advance(0.01);
      // Use the same post-message update mask as the existing actor loop.
      // Actor animation and this callback-free scalar fade commute within the
      // fixed Web step; native host callback/reentry is not admitted here.
      try { this.advanceActorVisibilityFades(); this.advanceMobColorFilters(); }
      catch (error) { this.block(error instanceof Error ? error.message : String(error)); return; }
      let entered = false;
      let walkParty: number | null = null;
      // Integer-like object keys are numerically reordered by JavaScript.
      // Keep legacy actor order, then use the source group/object insertion
      // order retained by the controller Map for competing NPC reservations.
      const tickActors = [...Object.values(this.actors).filter(actor => !this.npcActivities.has(actor.id)),
        ...[...this.npcActivities.values()].map(record => record.actor)];
      for (const a of tickActors) {
        // Source fresh player, party puppets and residents have attribute 2.
        // Map NPC SetProperty can choose 10 and needs a distinct factory host.
        // Message group 8 has mask 9; event group 12 has mask 3. Camera (10),
        // tile animation (42), VM and the global fader continue separately.
        if (a.native && (this.entityUpdateMask & (a.native.updateAttribute ?? 2)) === 0) continue;
        const routeSite = a.motion?.route?.search === WEB_PUPPET_ROUTE_POLICY
          ? this.tasks.find(task => task.actor === a.id && task.scriptMove?.kind === "field-puppet-route")?.scriptMove ?? null : null;
        try {
          const assigned = this.assignedRoutes.get(a.id);
          if (assigned) { this.assertAssignedRoute(assigned); if (this.interaction?.entityId === a.id) continue; }
          const activity = this.npcActivities.get(a.id);
          if (activity) { this.advanceNpcActivity(activity); continue; }
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
          // A settled waypoint keeps the same path and motion owner while a
          // known dynamic obstruction is present. Unknown collision stops
          // before publishing its timer, animation or next segment.
          if (m.route?.search === WEB_PUPPET_ROUTE_POLICY && m.route.pendingSegment &&
              m.route.index + 1 < m.route.points.length &&
              !this.puppetRouteCanStep(a, m.to, m.route.points[m.route.index + 1]!)) continue;
          const next = prepareFieldActorMotionTick(m, a.animation, 10);
          const point = this.mapTopology && (m.manual || this.#worldAutoActorMotion?.motion===m) && a.id === this.player.id
            ? canonicalCell(this.mapTopology, next.point) : next.point;
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
            if (a.native || next.completedSegment) { a.x = point.x; a.y = point.y; }
            if (m.route?.search === WEB_PUPPET_ROUTE_POLICY && m.route.pendingSegment &&
                next.motion?.route && next.motion.route.animation === "") a.direction = next.motion.route.direction;
            a.animation = next.animation;
            a.motion = next.motion;
            if(this.#worldAutoActorMotion?.actor===a&&this.#worldAutoActorMotion.motion===m){
              if(next.motion){this.#worldAutoActorMotion.motion=next.motion;this.#worldAutoActorMotion.expected=canonical(a.native!.entity.position);}
              else this.#worldAutoActorMotion=null;
            }
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
          this.block(error instanceof Error ? error.message : String(error), routeSite);
          return;
        }
      }
      for (const t of this.tasks) t.wait = Math.max(0, t.wait - 10);
      for (const record of [...this.assignedRoutes.values()]) {
        if ((this.entityUpdateMask & (record.actor.native?.updateAttribute ?? 2)) === 0) continue;
        // Generic actor tick above owns motion integration; only adopt the
        // exact result of that tick, never another command's motion.
        record.motion = record.actor.motion;
        try { this.advanceAssignedRoute(record); }
        catch (error) { this.block(error instanceof Error ? error.message : String(error), record.site); return; }
      }
      // Consume only on a new logical clock after the existing main/puppet
      // lifecycle is idle. A private candidate never consumes the shared slot.
      if (this.idleFieldReady && (!this.options.npcActivityClock || this.options.npcActivityClock())) {
        try {
          const reserved = this.options.reservedScripts?.prepareConsume(this.content);
          if (reserved) {
            reservedScriptBinding(this.content, reserved.script); reserved.validate();
            this.beginRoot(reserved.script, () => reserved.commit());
            if (this.stop) return;
            continue;
          }
        } catch (error) { this.block(error instanceof Error ? error.message : String(error)); return; }
      }
      const cellEvent = entered ? this.enter() : false;
      this.pump(0.01);
      if(this.sourcePartySelectionRequest)return;
      // This explicit development rule gives destination events priority. A
      // selected roll is consumed even when that event finishes synchronously;
      // it must not become a delayed surprise battle after the event returns.
      if (walkParty !== null && !cellEvent && this.menuReady && !this.scriptHook &&
          !this.hasUnfinishedNativeEncounterActivity())
        this.stop = { kind: "encounter", party: walkParty, returnTo: { kind: "field-idle" },
          site: null, message: "普通步行遭遇" };
      this.dispatchExpiredTimer();
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
    this.beginRoot(e.script, undefined, e);
    return true;
  }
  /** Runs a package-provided event through the same VM as map triggers. */
  startEvent(script: string): boolean {
    if (this.options.reservedScripts?.read() || this.busy || this.player.motion) return false;
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
      ...(this.content.map.worldTerrain ? { terrain: this.content.map.worldTerrain,
        sourceSetHash: this.content.sourceSetHash, parentSourceSetHash: this.content.parentSourceSetHash } : {}),
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
  private beginRoot(script: string, publishStory?: () => void, entity?: FieldEntity): void {
    let activation: FieldEventActivationCheckpoint | null = null;
    try {
      if (this.puppetReplacementRetired) throw new Error("Retired Puppet replacement/field owner cannot start scripts");
      if (entity?.eventActivation) {
        activation = captureFieldEventActivation(entity);
        restoreFieldEventActivation(activation, this.content, script);
      }
      if (this.coreRegisterPublishing) throw new Error("Core publication is in progress");
      if (this.hasUnfinishedInterpolation())
        throw new Error("Starting a script cannot discard unfinished source interpolation registers");
      if (this.options.nativeActorPreparation && !this.nativeActorBindings)
        throw new Error("Source field actors have not been installed");
      const locals = this.content.scriptLocals?.[script] ?? null;
      new EventState(this.eventState.snapshot()).beginScript(locals);
      const publish = this.preparePuppetStart(script);
      this.eventState.beginScript(locals);
      publish();
      publishStory?.();
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error), this.content.scripts[script]?.[0] ?? null);
      return;
    }
    this.eventRootScript = script;
    this.eventActivation = activation && Object.freeze(activation);
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
      targetMetadata: this.content.scriptTransitionMetadata?.[op.targetScript], targetLength: target.length,
      ...(this.sourceAnimationCatalog ? { animationCatalog: this.sourceAnimationCatalog } : {}) });
    const targetCustom = this.sourceAnimationCatalog ? this.prepareScriptCustomAsset(op.targetScript) : null;
    if (this.sourceAnimationCatalog && this.prepareScriptCustomAsset(t.script) !== this.currentCustomAnimationAsset)
      throw new Error("ChangeScript lost its current source custom animation asset");
    const localsByScript = this.content.scriptLocals;
    if (!localsByScript || !Object.hasOwn(localsByScript, t.script) || !Object.hasOwn(localsByScript, op.targetScript))
      throw new Error("ChangeScript source local declarations are unavailable");
    if (this.pendingChoice) throw new Error("ChangeScript conflicts with an unfinished choice task");
    if (this.sourceMessage.active && this.sourceMessageTask !== t.id)
      throw new Error("ChangeScript cannot detach another task's source message window");
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
    if (op.returnToCaller && this.sourceAnimationCatalog) this.hookedCustomAnimationAsset = this.currentCustomAnimationAsset;
    this.currentCustomAnimationAsset = targetCustom;
    this.scriptHook = hook;
    // ResetAll reaches all native cores, including Awake slots. External
    // treasure coroutines are not cores and keep their existing owner.
    this.tasks = this.tasks.filter((other) => other === t || other.treasureRoot);
    Object.assign(t, plan, { stack: [], wait: 0, state: "ready", lastClock: this.time,
      skyboxWait:null, standaloneWait: null,
      generalRegisters: initialFieldCoreRegisters(),
      puppetWait: null, scriptShop: null, fadeWait: null, screenBackdropWait:null, colorFadeWait: null, flashWait: null, cameraPath: null, cameraLerp: null, scriptMove: null, scriptLerp: null, birdViewMove: null, remaining: 0, move: null,
      animationWait: false, animationRepeat: null, audioWait: null, bgmReplay: null, autoSaveWait: null, sourceMessageWait: null, soundWait: null, treasure: null, done: false });
  }
  private restoreHookedScript(main: Task): void {
    const hook = this.scriptHook!;
    if (this.sourceMessage.active && this.sourceMessageTask !== main.id)
      throw new Error("Hooked script cannot detach another task's source message window");
    if (this.messageWindow && this.messageWindow.task !== main.id)
      throw new Error("Hooked script cannot detach another task's message window");
    // Exit/Entry do not clear the callee's stack. The old caller stack was
    // already cleared by ResetAll; a cross-script leftover stack is not yet
    // admitted as an ordinary same-script Return.
    if (main.stack.length) throw new Error("Hooked script returned with a nonempty callee Call stack");
    if (!this.content.scripts[hook.script]?.[hook.pc] || hook.pc < hook.range.min || hook.pc > hook.range.max)
      throw new Error("Hooked script return address is outside its source range");
    if (this.sourceAnimationCatalog && (this.hookedCustomAnimationAsset === undefined ||
        this.prepareScriptCustomAsset(hook.script) !== this.hookedCustomAnimationAsset))
      throw new Error("Hooked source custom animation asset is unavailable or changed");
    this.eventState.restoreScriptLocals(hook.locals);
    if (this.sourceAnimationCatalog) this.currentCustomAnimationAsset = this.hookedCustomAnimationAsset!;
    this.hookedCustomAnimationAsset = undefined;
    main.script = hook.script;
    main.pc = hook.pc;
    main.range = { ...hook.range };
    main.done = false;
    main.state = "ready";
    main.lastClock = this.time;
    main.wait = 0;
    main.standaloneWait = null;
    for (const task of this.tasks) if (task.slot !== null) task.done = true;
    this.scriptHook = null;
    // Integrator.Update returns after restoring. The caller resumes on the
    // following logical clock, without a finish/start actor lifecycle.
  }
  /** Source host effects and all native bindings are prepared before locals or
   * tasks change. The port publishes back into this field's actor owners. */
  private preparePuppetStart(name: string): () => void {
    const custom = this.sourceAnimationCatalog ? this.prepareScriptCustomAsset(name) : null;
    const publishCustom = () => { this.currentCustomAnimationAsset = custom; this.hookedCustomAnimationAsset = undefined; };
    if (!this.content.scriptPuppetContexts && !this.options.puppetActors) {
      const camera = this.prepareCameraEvent("start", false);
      return () => { camera(); publishCustom(); this.puppetLifecycle = null; };
    }
    const script = this.content.scriptPuppetContexts?.[name], port = this.options.puppetActors;
    if (!script || !port) throw new Error("Source puppet lifecycle host or script context is unavailable");
    const plan = projectFieldPuppetInitialization({ phase: "start", script, ...port.read() });
    const camera = this.prepareCameraEvent("start", this.separateCameraInitialization(plan));
    const publish = port.prepare(plan);
    if (typeof publish !== "function") throw new Error("Invalid source puppet actor transaction");
    const next = { name, script: structuredClone(script), leaderId: plan.leaderId,
      assignments: plan.assignments ?? fieldPuppetAssignments(), finished: false };
    return () => { publish(); camera(); publishCustom(); this.puppetLifecycle = next; };
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
    const selection=draft.prepareSelect({ target: phase === "start" ? "dummy" : "player" });selection.commit();
    const transaction = this.camera.prepareState(draft.snapshot());
    return () => { transaction.commit(); if(initialize||selection.resetDummyMovement){this.#worldAutoDummyMotion=null;this.#worldAutoDummyExpected=null;}this.cameraEventActive = phase === "start"; };
  }
  private task(script: string, pc: number, actor: string, id = this.nextTask++): Task {
    return {
      generalRegisters: initialFieldCoreRegisters(),
      id,
      script,
      pc,
      actor,
      sourceEntityId: null,
      stack: [],
      wait: 0,
      skyboxWait:null, standaloneWait: null,
      slot: null,
      state: "ready",
      range: { min: 0, max: (this.content.scripts[script]?.length ?? 0) - 1 },
      lastClock: -1,
      puppetWait: null,
      scriptShop: null,
      fadeWait: null,
      screenBackdropWait:null, colorFadeWait: null, flashWait: null, cameraPath: null,
      cameraLerp: null,
      scriptMove: null,
      birdViewMove: null,
      scriptLerp: null,
      remaining: 0,
      move: null,
      animationWait: false,
      animationRepeat: null,
      audioWait: null,
      bgmReplay: null,
      autoSaveWait: null,
      sourceMessageWait: null, soundWait: null,
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
    // Timing wrappers also own captured Core r0/r1 until their next-clock
    // completion. A script/map/battle replacement cannot discard that bank.
    return this.tasks.some((task) => !task.done && !!(task.scriptLerp || task.cameraLerp || task.cameraPath || task.skyboxWait || task.standaloneWait));
  }
  private hasUnfinishedNativeEncounterActivity(): boolean {
    return !!(Object.values(this.actors).some(actor=>actor.mobColor?.tween) || this.actorVisibilityBusy || this.pendingChoice || this.messageWindow || this.sourceMessage.active || this.shopTask ||
      this.treasureHandoffBlocked() || Object.values(this.actors).some((actor) => actor.motion !== null && !this.isAutonomousMotion(actor)));
  }
  /** Source Encount selects once and captures FootInfo while the actual
   * player still has its pre-sync transform. No live actor is written here. */
  private beginSourceBossEncounter(op:Extract<Op,{kind:'source-boss-encounter'}>,task:Task):void {
    const command=parseSourceBossEncounterCommand(op.command);
    if(this.options.sourceBossEntry!==WEB_SOURCE_BOSS_ENTRY||!this.nativeActorBindings||!this.nativeRuntime?.mapLifecycle||!this.nativeActorProviders||!this.player.native)throw new Error('Source Boss entry requires its explicit Web policy and native actors');
    if(!this.content.scripts[command.continuation])throw new Error('Missing source Boss continuation');
    const program=this.content.scripts[task.script],pc=task.pc,player=this.player,native=player.native!,entity=native.entity,camera=this.camera,runtime=this.nativeRuntime,providers=this.nativeActorProviders,bindings=this.nativeActorBindings,events=this.eventState,revision=events.mutationRevision;
    const fingerprint=()=>canonical({content:this.content,actors:this.nativeActorStateFingerprint,camera:this.cameraSnapshot,event:events.snapshot(),time:this.time,task:{script:task.script,pc:task.pc,done:task.done,registers:task.generalRegisters},op});
    const before=fingerprint();
    const request:Extract<Stop,{kind:'unsupported'|'encounter'}>={kind:'encounter',message:'正在准备来源Boss战斗…',site:op,party:command.partyId,continuation:command.continuation,sourceBoss:{kind:'source-boss-encounter-request-v1',policy:WEB_SOURCE_BOSS_ENTRY,command}};
    const key=canonical(request);this.sourceBossPending={request,validate:()=>{if(this.options.sourceBossEntry!==WEB_SOURCE_BOSS_ENTRY||this.stop!==request||canonical(request)!==key||!this.tasks.includes(task)||task.done||task.pc!==pc||this.content.scripts[task.script]!==program||program?.[pc-1]!==op||this.player!==player||player.native!==native||native.entity!==entity||this.camera!==camera||this.nativeRuntime!==runtime||this.nativeActorProviders!==providers||this.nativeActorBindings!==bindings||this.eventState!==events||events.mutationRevision!==revision||fingerprint()!==before)throw new Error('Stale source Boss entry');}};this.stop=request;
  }
  prepareSourceBossEncounterStart():{validate():void;commitWith(publish:()=>void):void}|null {
    if(this.stop?.kind!=='encounter'||this.stop.sourceBoss===undefined)return null;
    const pending=this.sourceBossPending;if(!pending||pending.request!==this.stop)throw new Error('Source Boss requires its original request');pending.validate();let consumed=false;
    const validate=()=>{if(consumed||this.sourceBossPending!==pending)throw new Error('Stale source Boss preparation');pending.validate();};
    return {validate,commitWith:(publish)=>{validate();publish();consumed=true;this.sourceBossPending=null;}};
  }
  private beginSourceEncounter(op: Extract<Op, { kind: "source-encounter" }>, task: Task): void {
    const command = parseSourceEncounterCommand(op.command), port = this.options.sourceEncounter;
    if (!port || port.policy !== WEB_SOURCE_ENCOUNTER_POLICY || !this.nativeActorBindings ||
        !this.nativeRuntime?.mapLifecycle || !this.nativeActorProviders || !this.camera || !this.player.native)
      throw new Error("Source encounter entry requires an explicit Web policy and native actor factory");
    if (!this.content.scripts[command.continuation]) throw new Error("Missing source encounter continuation");
    const camera = this.camera, bindings = this.nativeActorBindings, runtime = this.nativeRuntime,
      player = this.player, native = player.native!, entity = native.entity, tasks = this.tasks,
      program = this.content.scripts[task.script], pc = task.pc;
    const fingerprint = () => canonical({ actors: this.nativeActorStateFingerprint, camera: this.cameraSnapshot,
      event: this.eventState.snapshot(), time: this.time,
      fade: this.fader.snapshot(), collision: this.collisionSwitches, mask: this.entityUpdateMask,
      root: this.eventRootScript, activation: this.eventActivation, lifecycle: this.puppetLifecycle, party: this.partyActorCheckpoint,
      op, command, task: { script: task.script, pc: task.pc, done: task.done, generalRegisters: task.generalRegisters },
      map: { sourceSetHash: this.content.sourceSetHash, parentSourceSetHash: this.content.parentSourceSetHash,
        identity: this.content.map.identity ?? null, cameraHost: this.content.cameraHost ?? null,
        factory: runtime.mapLifecycle!.factory, bindings,
        entryContext: this.content.map.entryContext ?? null, terrain: this.content.map.worldTerrain ?? null } });
    const before = fingerprint();
    const validateOwner = () => {
      if (this.options.sourceEncounter !== port || this.camera !== camera || this.nativeActorBindings !== bindings ||
          this.nativeRuntime !== runtime || this.player !== player || player.native !== native || native.entity !== entity ||
          this.tasks !== tasks || !tasks.includes(task) || this.content.scripts[task.script] !== program ||
          task.pc !== pc || program?.[pc - 1] !== op || fingerprint() !== before)
        throw new Error("Stale source encounter entry owner");
    };
    const selected = port.prepare(command);
    if (!selected || typeof selected.validate !== "function") throw new Error("Invalid source encounter selection");
    // All observed source slots are contiguous. A provider cannot select a
    // different party/effect/continuation or manufacture a compressed hole.
    const expected = selectSourceEncounterSlot(command, { policy: port.policy, drawIndex: selected.selection.slotIndex });
    if (canonical(selected.selection) !== canonical(expected)) throw new Error("Source encounter selection identity mismatch");
    const source: SourceEncounterRequest = { kind: "source-encounter-request-v1", policy: port.policy,
      command, selection: structuredClone(expected), foot: captureSourceEncounterFootBackground({
        definition: this.content.map.entryContext, mapId: this.content.map.identity?.mapId ?? 0,
        entrySynchronized: this.synchronizedEntry,
        player: { id: player.id, position: entity.position, layer: entity.layer } }) };
    selected.validate(); validateOwner();
    const request: Extract<Stop, { kind: "unsupported" | "encounter" }> = { kind: "encounter",
      message: "正在准备来源战斗…", site: op, party: expected.partyId, continuation: command.continuation,
      sourceEncounter: structuredClone(source) };
    const key = canonical(request), sourceKey = canonical(source);
    this.sourceEncounterPending = { request, source, validate: () => {
      selected.validate(); validateOwner();
      if (this.stop !== request || canonical(request) !== key || canonical(source) !== sourceKey)
        throw new Error("Stale source encounter pending request");
    } };
    this.stop = request;
  }
  /** Private actor writes join the existing battle publication. A failed or
   * cancelled media candidate retains the original request and player pose. */
  prepareSourceEncounterStart(): PreparedFieldSourceEncounter | null {
    if (this.stop?.kind !== "encounter" || this.stop.sourceEncounter === undefined) return null;
    const pending = this.sourceEncounterPending, camera = this.camera, runtime = this.nativeRuntime,
      bindings = this.nativeActorBindings, providers = this.nativeActorProviders;
    if (!pending || pending.request !== this.stop || !camera || !runtime?.mapLifecycle ||
        !bindings || !providers || !this.content.cameraHost || !this.options.partyAppearance)
      throw new Error("Source encounter requires its original pending entry");
    pending.validate();
    const original = this.stop, key = canonical(original), cameraState = camera.snapshot();
    const actors = Object.fromEntries(Object.values(this.actors).filter(actor => actor.native).map(actor => {
      const copy = createNativeFieldActorDraft(actor, this.content.cameraHost!.mapRange,
        this.options.partyAppearance!.catalog, this.transportationPresentation);
      return [copy.id, copy];
    }));
    const player = actors[bindings.player];
    if (!player || this.player.id !== bindings.player || player.motion || player.layer === null)
      throw new Error("Source encounter actual player is unavailable");
    // Web's admitted ordinary factory stores local transforms directly. No
    // Look, material refresh, camera initialization or animation is inferred.
    player.native.entity.position = { ...cameraState.dummy.position };
    player.native.entity.layer = cameraState.dummy.layer;
    const actorsPrepared = prepareNativeFieldActorState({ readActors: () => this.actors,
      readCamera: () => null, readProviders: providers }, actors);
    const cameraFence = camera.prepareState(cameraState);
    let consumed = false;
    const validate = () => {
      if (consumed || this.stop !== original || canonical(original) !== key || this.camera !== camera ||
          this.nativeRuntime !== runtime || this.nativeActorBindings !== bindings || this.nativeActorProviders !== providers)
        throw new Error("Stale source encounter synchronization");
      pending.validate(); actorsPrepared.validate(); cameraFence.validate();
      pending.validate(); actorsPrepared.validate();
    };
    const battleEntryContext = projectFieldEntryContext(this.content.map.entryContext, {
      ...(this.content.map.worldTerrain ? { terrain: this.content.map.worldTerrain,
        sourceSetHash: this.content.sourceSetHash, parentSourceSetHash: this.content.parentSourceSetHash } : {}),
      mapId: this.content.map.identity?.mapId ?? null, transportationId: this.transportationId,
      activeGroups: [...this.activeGroups], player: { x: player.x, y: player.y, layer: player.layer! },
      entrySynchronized: this.synchronizedEntry });
    return Object.freeze({ request: structuredClone(pending.source),
      get battleEntryContext() { return structuredClone(battleEntryContext); }, validate,
      commitWith: (publishBattle: () => void): void => {
        if (typeof publishBattle !== "function") throw new Error("Source encounter requires a synchronous battle publisher");
        validate(); consumed = true;
        cameraFence.commitWith(() => {
          // The containing GameSession publisher is already prepared and may
          // only perform owned plain writes. No fallible read follows it.
          publishBattle(); actorsPrepared.commit(); return true;
        });
      } });
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
    const targetCustom = this.sourceAnimationCatalog ? this.prepareScriptCustomAsset(continuation) : null;
    if (!this.content.scripts[continuation])
      throw new Error("Missing battle continuation");
    const stop = this.stop, taskId = this.nextTask, tasks = this.tasks;
    const shake = this.prepareCameraShakeReturn();
    const locals = structuredClone(
      this.content.scriptLocals?.[continuation] ?? null,
    );
    new EventState(this.eventState.snapshot()).beginScript(locals);
    const shared = eventShared ? prepareBattleEventSharedReturn(this.eventState, eventShared) : null;
    const fingerprint = () => canonical({ stop: this.stop, event: this.eventState.snapshot(), activation: this.eventActivation, lifecycle: this.puppetLifecycle,
      camera: this.cameraSnapshot, collision: this.collisionSwitches, updateMask: this.entityUpdateMask,
      offset: this.mapScrollOffset, time: this.time, remainder: this.remainder,
      script: this.content.scripts[continuation], locals: this.content.scriptLocals?.[continuation] ?? null,
      sourceCustom: { current: this.currentCustomAnimationAsset, hooked: this.hookedCustomAnimationAsset ?? null,
        metadata: this.content.scriptTransitionMetadata?.[continuation] ?? null, catalogHash: this.sourceAnimationCatalog?.contentHash ?? null } });
    const before = fingerprint();
    const nextTask = this.task(continuation, 0, "-1001", taskId);
    const native = this.options.puppetActors || this.content.scriptPuppetContexts
      ? this.prepareNativeEncounterReturn(continuation, candidateOwned) : null;
    let consumed = false;
    const validateField = () => {
      shake.validate();
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
      this.currentCustomAnimationAsset = targetCustom; this.hookedCustomAnimationAsset = undefined;
      this.eventActivation = null;
      this.scriptHook = null;
      this.tasks = [nextTask];
      this.nextTask = taskId + 1;
      this.stop = null;
      this.sourceEncounterPending = null;
      this.remainder = 0;
      shake.commit();
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
    const shake = this.prepareCameraShakeReturn();
    const shared = eventShared ? prepareBattleEventSharedReturn(this.eventState, eventShared) : null;
    const owner = this.actors, tasks = this.tasks;
    const actors = Object.values(owner).map(actor => ({ actor, native: actor.native, entity: actor.native?.entity }));
    const fingerprint = () => canonical({ event: this.eventState.snapshot(), lifecycle: this.puppetLifecycle,
      camera: this.cameraSnapshot, collision: this.collisionSwitches, updateMask: this.entityUpdateMask,
      offset: this.mapScrollOffset, time: this.time, remainder: this.remainder, nextTask: this.nextTask,
      eventRootScript: this.eventRootScript, eventActivation: this.eventActivation, tasks: this.tasks, stop: this.stop,
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
        this.transportationPresentation, this.options.sourcePartySelection, () => this.currentPartyViewType);
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
      shake.validate();
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
      shake.commit();
    };
    return Object.assign(() => commitWith(() => {}), { validate, commitWith });
  }
  private prepareCameraShakeReturn() {
    const owner = this.cameraShakeState, before = canonical(owner?.snapshot() ?? null), after = owner?.afterBattle() ?? null;
    return { validate: () => {
      if (this.cameraShakeState !== owner || canonical(owner?.snapshot() ?? null) !== before)
        throw new Error("Stale camera-shake battle return");
    }, commit: () => { this.cameraShakeState = after; } };
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
        const copy = createNativeFieldActorDraft(actor, this.content.cameraHost!.mapRange, appearanceHost.catalog,
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
        this.transportationPresentation, this.options.sourcePartySelection, () => this.currentPartyViewType);
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
  private puppetReplacementValue: FieldPuppetReplacementState | null = null;
  private puppetReplacementRetired = false;
  get puppetReplacementSnapshot(): FieldPuppetReplacementState | null {
    return this.puppetReplacementValue && structuredClone(this.puppetReplacementValue);
  }
  private puppetReplacementSource() {
    const catalog = this.nativeRuntime?.catalog;
    if (this.puppetReplacementRetired || !catalog || !this.nativeActorBindings ||
        !this.nativeRuntime?.mapLifecycle || !this.nativeActorProviders || !this.camera ||
        !this.options.puppetActors || !this.options.puppetRoster?.replacement ||
        this.options.puppetActors.controlContext().callback !== "absent")
      throw new Error("Source Puppet replacement requires the actual native actor/three-Corps owner and an absent foreign callback");
    return { sourceSetHash: this.content.sourceSetHash,
      parentSourceSetHash: this.content.parentSourceSetHash, miscHash: catalog.miscHash };
  }
  private validatePuppetReplacementState(raw: FieldPuppetReplacementState): FieldPuppetReplacementState {
    const state = parsePuppetReplacementState(raw, this.puppetReplacementSource());
    const { catalog } = this.options.puppetActors!.read();
    // The saved list is data only. Its resident domain comes from the current
    // trusted catalog; it cannot introduce another resident or actor provider.
    const known = new Set(catalog.residents.map(r => -r.characterStatusId));
    for (const selector of state.selectors)
      if (selector !== 0 && ![-1030, -1031, -1032].includes(selector) && !known.has(selector))
        throw new Error("Saved Puppet replacement selector has no trusted resident identity");
    return state;
  }
  /** Detached session callback transfer. No reference to an actor on the old
   * map is transferred, and preparation never retires or edits the old owner. */
  inheritPuppetReplacements(previous: FieldGame): void {
    if (!previous.puppetReplacementValue) return;
    const before = previous.validatePuppetReplacementState(previous.puppetReplacementValue);
    const source = this.puppetReplacementSource();
    if (before.parentSourceSetHash !== source.parentSourceSetHash || before.miscHash !== source.miscHash)
      throw new Error("Puppet replacement cannot cross source/Misc universes");
    this.puppetReplacementValue = this.validatePuppetReplacementState({ ...before, ...source });
  }
  retirePuppetReplacements(): void { this.puppetReplacementRetired = true; }
  private executePuppetReplacement(command: FieldPuppetReplacementCommand): void {
    const source = this.puppetReplacementSource(), port = this.options.puppetActors!, roster = this.options.puppetRoster!;
    const old = this.puppetReplacementValue, before = canonical(port.read()), context = canonical(port.controlContext()), actors = this.nativeActorStateFingerprint;
    const events = this.eventState, revision = events.mutationRevision, owned = roster.replacement!();
    const selected = command.kind === "battle-party" ? events.read({ category: "ScenarioVariable", index: 4 }) : undefined;
    const selectors = projectPuppetReplacement(command, old?.selectors ?? null, owned, selected);
    const next = selectors === null ? null : this.validatePuppetReplacementState({ kind: "field-puppet-replacement-v1", ...source, selectors });
    const nowSource = this.puppetReplacementSource(), nowContext = port.controlContext(), nowActors = port.read(), nowOwned = roster.replacement!();
    if (this.puppetReplacementValue !== old || this.options.puppetActors !== port || this.options.puppetRoster !== roster ||
        canonical(nowOwned) !== canonical(owned) || canonical(nowActors) !== before || canonical(nowContext) !== context ||
        this.nativeActorStateFingerprint !== actors || this.eventState !== events || events.mutationRevision !== revision ||
        canonical(nowSource) !== canonical(source))
      throw new Error("Stale source Puppet replacement selection");
    this.puppetReplacementValue = next;
  }
  /** This is Current.ExecPuppetCallbackCommon, before Ready. Native list index
   * addresses track i, including sleeping holes; it never compacts Awake tracks. */
  private preparePuppetReplacementExec() {
    if (!this.puppetReplacementValue) return null;
    const value = this.puppetReplacementValue, state = this.validatePuppetReplacementState(value);
    const host = this.options.puppetActors!, read = host.read(), before = canonical(read), context = canonical(host.controlContext());
    const actors = this.nativeActorStateFingerprint, tasks = this.tasks;
    const selected: { child: Task; selector: number; actor: string; previousActor: string; previousSelector: number | null; pc: number; program: Op[] | undefined; bank: string }[] = [];
    const effects: import("./field-puppet-actors.js").FieldPuppetActorEffect[] = [];
    let dummy = false;
    for (const [slot, selector] of state.selectors.entries()) {
      const child = tasks.find(t => !t.done && t.slot === slot && t.state === "awake");
      if (!child) continue;
      const resolved = resolveFieldPuppetActor(read.catalog, read.context, selector);
      if (!resolved.actor) throw new Error("Puppet replacement callback destination is absent");
      if (selector === 0) {
        if (resolved.actor !== this.cameraActorId || !this.camera || !this.player.native)
          throw new Error("Puppet replacement zero is not the actual camera dummy");
        dummy = true;
      } else {
        const actor = this.actors[resolved.actor];
        if (!actor?.native || actor.motion || actor.native.entity.moving)
          throw new Error("Puppet replacement needs a known idle native actor instance");
        effects.push({ kind: "copy-position", actor: actor.id, from: read.context.player, mode: "player-z" },
          { kind: "copy-layer", actor: actor.id, from: read.context.player },
          { kind: "apply-view-properties", actor: actor.id }, { kind: "attach-transparent", actor: actor.id });
      }
      selected.push({ child, selector, actor: resolved.actor, previousActor: child.actor, previousSelector: child.sourceEntityId, pc: child.pc, program: this.content.scripts[child.script], bank: canonical(child.generalRegisters) });
    }
    const validate = () => {
      if (this.puppetReplacementValue !== value || canonical(this.validatePuppetReplacementState(value)) !== canonical(state) ||
          this.options.puppetActors !== host || canonical(host.read()) !== before || canonical(host.controlContext()) !== context ||
          this.nativeActorStateFingerprint !== actors || this.tasks !== tasks || selected.some(row =>
            !tasks.includes(row.child) || row.child.done || row.child.state !== "awake" ||
            row.child.actor !== row.previousActor || row.child.sourceEntityId !== row.previousSelector || row.child.pc !== row.pc ||
            this.content.scripts[row.child.script] !== row.program || canonical(row.child.generalRegisters) !== row.bank))
        throw new Error("Stale source Puppet replacement callback");
    };
    return { selected, effects, dummy, validate };
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
    if (this.stop || this.shopTask || this.sourcePartySelectionRequest || this.pendingEventSave) return;
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
    if (this.stop || this.pendingEventSave || this.shopTask || this.sourcePartySelectionRequest) return;
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
      const waitingMessage = this.tasks.find(task => !task.done && task.sourceMessageWait)?.sourceMessageWait;
      if (waitingMessage) {
        this.block("Main script ended with an unfinished source message task", waitingMessage.op); return;
      }
      if (this.sourceMessage.active && this.sourceMessageTask !== main.id) {
        this.block("Main script ended with another task's source message window"); return;
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
      this.eventActivation = null;
    }
    this.finishInteraction();
    this.finishMapEntry();
  }
  private assertFiniteAnimation(task: Task): void {
    const pending = task.animationRepeat;
    if (!pending || !task.animationWait || task.script !== pending.script || task.pc !== pending.webPC + 1 ||
        this.content.scripts[pending.script] !== pending.program || pending.program[pending.webPC] !== pending.op ||
        canonical(pending.op) !== pending.fingerprint || task.actor !== pending.actorId ||
        this.actors[pending.actorId] !== pending.actor || (pending.actor?.native?.entity ?? null) !== pending.nativeEntity ||
        pending.sourceEntity && !this.entityList.includes(pending.sourceEntity))
      throw new Error("Stale finite PlayAnim task, instruction or actor identity");
    if (task.generalRegisters !== pending.registers || task.generalRegisters.i[0] !== 0 ||
        task.generalRegisters.i[1] !== pending.op.repeatCount || task.generalRegisters.i[7] !== 0)
      throw new Error("Stale finite PlayAnim Core register binding");
    checkpointInteger(task.generalRegisters.i[6]!, 1, pending.op.repeatCount);
  }
  private prepareScriptCustomAsset(name: string): string | null {
    const id = sourceScriptAnimationAsset(this.content.scriptTransitionMetadata?.[name], this.sourceAnimationCatalog);
    if (id !== null) {
      const asset = this.sourceAnimationCatalog!.assets[id]!, first = this.content.scripts[name]?.[0];
      if (!first || ["file","assetPath","objectId"].some(key => first.source[key as keyof typeof first.source] !== asset.source[key as keyof typeof asset.source]) ||
          this.content.scriptPuppetContexts?.[name] && this.content.scriptPuppetContexts[name]!.scriptHash !== asset.rawScriptHash)
        throw new Error("Current script custom animation physical/body identity changed");
    }
    return id;
  }
  private prepareActorCustomAnimation(actor: Actor, animation: ActorAnimation, key: string): void {
    if (!this.sourceAnimationCatalog) {
      if (animation.hasSourceCustomAnimations) throw new Error("Actor custom animation cache requires its trusted world catalog");
      return;
    }
    if (Object.hasOwn(animation.character.animations,key)) return;
    const native=actor.native, entity=native?.entity, base=actor.asset && this.nativeRuntime?.animationKeys?.assets[actor.asset];
    if (!native || !entity || !entity.character || entity.riding || actor.mount || !base ||
        entity.animation !== actor.animation || !actor.asset ||
        canonical(animation.character) !== canonical(this.content.characters[actor.asset]))
      throw new Error("Source custom animation requires the actual unmounted actor sprite/media owner");
    animation.prepareSourceCustomKey(key,this.currentCustomAnimationAsset,{catalog:this.sourceAnimationCatalog,baseKeys:base.keys});
  }
  private playTaskAnimation(task: Task, op: Extract<Op, { kind: "animation-play" }>, replay: boolean): void {
    const actor = this.actors[task.actor];
    if (this.effectBoard(task.actor)) {
      this.effects!.prepare([{ kind: "play", id: task.actor,
        loopLimit: fieldEffectAnimationLoopLimit(op.loop ? 1 : 0) }]).commit();
    } else if (actor) {
      if (actor.mount && (!actor.native || !this.transportationPresentation))
        throw new Error("Mounted actor animation dispatch is not implemented");
      if (!actor.animation) throw new Error("Missing actor animation media " + actor.asset);
      const animation = actor.animation.clone();
      this.prepareActorCustomAnimation(actor,animation,op.animation);
      if (replay) animation.replayEntity(op.animation, op.speed);
      else animation.play(op.animation, op.loop, op.speed);
      actor.animation = animation;
    } else if (replay) this.tileAnimations.replayEntity(task.actor, op.loop, op.speed);
    else this.tileAnimations.play(task.actor, op.loop, op.speed);
  }
  private clockTask(t: Task, frameDeltaSeconds: number): void {
    if (this.sourcePartySelectionRequest || this.shopTask || t.done || t.state !== "ready" || t.lastClock === this.time ||
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
        if(t.skyboxWait){const pending=t.skyboxWait;try{
          if(this.content.scripts[t.script]!==pending.program||t.pc!==pending.webPC+1||pending.program[pending.webPC]!==pending.op||canonical(pending.op)!==pending.fingerprint||t.generalRegisters!==pending.registers||this.requireSkyboxOwner()!==pending.owner)throw Error("Skybox wait lost its original Core/program/model owner");
          const sample=skyboxScrollSample(pending.op.command,Math.fround(this.time/1000),Math.fround(t.generalRegisters.r[0]!));pending.owner.sampleOffset(sample.offset);if(!sample.complete)return;t.skyboxWait=null;
        }catch(error){this.block(error instanceof Error?error.message:String(error),pending.op);return;}}
        if (t.standaloneWait) {
          const pending = t.standaloneWait;
          try {
            if (this.content.scripts[t.script] !== pending.program || t.pc !== pending.webPC + 1 ||
                pending.program[pending.webPC] !== pending.op || canonical(pending.op) !== pending.fingerprint ||
                t.generalRegisters !== pending.registers)
              throw new Error("Standalone wait lost its source instruction or Core registers");
            const bank = parseFieldCoreRegisters(t.generalRegisters);
            if (this.time / 1000 - bank.r[1]! < bank.r[0]!) return;
            t.standaloneWait = null;
          } catch (error) {
            this.block(error instanceof Error ? error.message : String(error), pending.op); return;
          }
        }
        const actor = this.actors[t.actor];
        if (!actor && !this.hasEntity(t.actor)) {
          this.block(`缺少角色 ${t.actor}`);
          return;
        }
        // A movement suspends its own instruction, not every core currently
        // bound to that actor (in particular, the main core's dialogue/flags).
        if (actor?.motion && (t.move || t.scriptMove)) return;
        if (t.scriptMove) {
          if (t.scriptMove.kind === "field-puppet-route") this.puppetRouteJournal.push({ phase: "task-completed",
            site: structuredClone(t.scriptMove), actorId: t.actor, atMilliseconds: this.time });
          t.scriptMove = null;
        }
        if (t.birdViewMove) {
          const pending = t.birdViewMove;
          try {
            if (this.tickBirdViewMove(t, pending) === "wait") return;
            t.birdViewMove = null;
          } catch (error) { this.block(error instanceof Error ? error.message : String(error), pending.op); return; }
        }
        if (t.scriptLerp) {
          const pending = t.scriptLerp;
          try {
            if (!actor) throw new Error("Source actor Lerp lost its entity binding");
            const next = this.prepareActorScriptLerp(actor, pending.op, pending.progress);
            if (next.flow === "wait") { pending.progress = next.progress; return; }
            t.scriptLerp = null;
          } catch (error) { this.block(error instanceof Error ? error.message : String(error), pending.op); return; }
        }
        if (t.sourceMessageWait) {
          const pending = t.sourceMessageWait;
          try {
            if (pending.cursor === null) {
              if (!this.sourceMessage.endWaiting) return;
            } else {
              const result = pollSourceMessageTask(pending.cursor, this.sourceMessage.sequenceStatus(pending.cursor.ticket), this.time);
              if (result.action === "page-input") this.sourceMessage.executePageInput(pending.cursor.ticket);
              if (result.flow === "wait") { pending.cursor = result.cursor; return; }
              if (result.action === "close") {
                const next = this.sourceMessage.prepare({ kind: "source-message", command: { kind: "close" } }), publish = this.prepareDialogueMask(12);
                publish(); next.commit(); this.sourceMessageTask = null;
              }
              // The existing cursor owns the active timer. Once complete,
              // transfer its final source register projection back to Task;
              // do not create a second mutable message clock.
              if (pending.cursor.pageSeconds !== null)
                t.generalRegisters = projectFieldCoreSlots(t.generalRegisters, {
                  i: { 1: result.cursor.finalTimerStarted ? 0 : -1 }, r: { 1: result.cursor.anchorTime / 1000 },
                });
            }
            t.sourceMessageWait = null;
          } catch (error) { this.block(error instanceof Error ? error.message : String(error), pending.op); return; }
        }
        if (t.animationWait) {
          if (
            actor
              ? actor.animation?.playing
              : this.effectBoard(t.actor) ? this.effectPlaying(t.actor) : this.tileAnimations.isPlaying(t.actor)
          )
            return;
          if (t.animationRepeat) {
            const pending = t.animationRepeat;
            try {
              this.assertFiniteAnimation(t);
              const count = t.generalRegisters.i[6]! - 1;
              const registers = projectFieldCoreSlots(t.generalRegisters, { i: { 6: count } });
              // A failed media/owner preparation cannot decrement the existing
              // Core bank. Publish the bank only after the animation commits.
              if (count > 0) this.playTaskAnimation(t, pending.op, true);
              t.generalRegisters = registers; pending.registers = registers;
              this.finiteAnimationJournal.push({ phase: count > 0 ? "replayed" : "completed",
                site: structuredClone(pending.op), actorId: t.actor,
                repeatCount: pending.op.repeatCount!, remaining: count, atMilliseconds: this.time });
              if (count > 0) return;
              t.animationRepeat = null;
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), pending.op); return; }
          }
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
        if(t.screenBackdropWait){if(!this.screenPresentationState||!fieldScreenPresentationBinding(this.content,this.options.screenPresentation)){this.block("Backdrop wait lost its bound screen owner",t.screenBackdropWait);return;}if(this.screenPresentationState.backdropPending)return;t.screenBackdropWait=null;}
        if (t.colorFadeWait) {
          if (this.colorFilterState!.poll() === "wait") return;
          t.colorFadeWait = null;
        }
        if (t.flashWait) {
          const flash = t.flashWait;
          try {
            if (pollFieldFlash(this.fader, flash.cursor, frameDeltaSeconds) === "wait") return;
            t.generalRegisters = projectFieldCoreSlots(t.generalRegisters, { i: { 7: 1 } });
            t.flashWait = null;
          } catch (error) { this.block(error instanceof Error ? error.message : String(error), flash.op); return; }
        }
        if (t.cameraPath) {
          const path = t.cameraPath;
          try {
            if (!this.camera || t.actor !== this.cameraActorId) throw new Error("Camera path lost its source task owner");
            const command = path.op.kind === "field-puppet-route" ? { ...path.op.command, kind: "route" as const } : path.op.command;
            if (command.kind === "lerp") throw new Error("Camera path lost its source path command");
            const next = this.camera.preparePath(command, path.progress, this.time, undefined,
              path.op.kind === "field-puppet-route" ? this.cameraRouteGrid() : undefined);
            next.commit(); path.progress = next.progress;
            if (next.flow === "wait") return;
            if (path.op.kind === "field-puppet-route") this.puppetRouteJournal.push({ phase: "task-completed", site: structuredClone(path.op), actorId: t.actor, atMilliseconds: this.time });
            t.cameraPath = null;
          } catch (error) { this.block(error instanceof Error ? error.message : String(error), path.op); return; }
        }
        if (t.bgmReplay) {
          const replay = t.bgmReplay;
          try {
            this.bgm.finishReplay(replay.handle, this.content.bgm);
            t.bgmReplay = null;
          } catch (error) {
            this.block(error instanceof Error ? error.message : String(error), replay.op);
            return;
          }
        }
        if (t.autoSaveWait) {
          const op = t.autoSaveWait;
          // The same main cursor consumed the first-clock yield. Drop this
          // transient register only while preparing its ordinary stable barrier.
          t.autoSaveWait = null;
          try { this.requestEventSave(t, op); }
          catch (error) {
            t.autoSaveWait = op;
            this.block(error instanceof Error ? error.message : String(error), op);
          }
          return;
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
        if ((actor?.motion || this.assignedRoutes.has(t.actor) || this.tasks.some((other) => !other.done && other.actor === t.actor && (other.scriptLerp || other.birdViewMove || other.cameraPath?.op.kind === "field-puppet-route" || (op.kind === "field-puppet-route" || op.kind === "position") && (other.cameraPath || other.cameraLerp)))) &&
            ["move", "field-bird-view-move", "field-script-motion", "field-puppet-route", "field-camera-motion", "position", "look", "animation-play", "animation-cue"].includes(op.kind)) {
          this.block("Concurrent source actor movement arbitration is not implemented", op);
          return;
        }
        if (op.kind === "message" && this.messageWindow && this.messageWindow.task !== t.id) {
          this.block("Concurrent source message windows are not implemented", op);
          return;
        }
        if (this.dialogue?.manual && ["change-map", "encounter", "source-encounter", 'source-boss-encounter'].includes(op.kind)) {
          this.block("Field transition conflicts with an unfinished ordinary message", op);
          return;
        }
        if (this.sourceMessage.active && (op.kind === "encounter" || op.kind === "source-encounter" || op.kind==='source-boss-encounter')) {
          this.block("Source message must close before battle handoff", op); return;
        }
        if (this.pendingChoice && ["message", "source-message", "choice", "change-map", "encounter", "source-encounter", 'source-boss-encounter', "treasure-box"].includes(op.kind)) {
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
          case "source-gil-tag": {
            try { this.sourceMessage.prepareFee(op).commit();
              this.feeJournal.push({ site: { script: op.script, index: op.index, source: structuredClone(op.source) }, value: this.sourceMessage.feeSnapshot!, atMilliseconds: this.time });
            }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          }
          case 'source-battle-result': {const program=this.content.scripts[t.script],pc=t.pc,script=t.script,identity=canonical(op);try{executeCommittedBattleResult(this.eventState,this.options.sourceBattleResult,()=>{if(!this.tasks.includes(t)||t.done||this.stop!==null||t.pc!==pc||t.script!==script||this.content.scripts[script]!==program||program?.[pc-1]!==op||canonical(op)!==identity)throw new Error('Stale source result Task');});}catch(error){this.block(error instanceof Error?error.message:String(error),op);return;}break;}
          case "script-random": {
            const program = this.content.scripts[t.script], pc = t.pc, script = t.script, fingerprint = canonical(op);
            try { const value = executeFieldScriptRandom(op.command, this.eventState, this.options.scriptRandom, () => {
              if (!this.tasks.includes(t) || t.done || this.stop !== null || t.pc !== pc || t.script !== script ||
                  this.content.scripts[script] !== program || program?.[pc - 1] !== op || canonical(op) !== fingerprint)
                throw new Error("Stale source script random task");
            }); this.scriptRandomJournal.push({ site: { script: op.script, index: op.index, source: structuredClone(op.source) }, value, atMilliseconds: this.time }); } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          }
          case "event-save":
            try {
              if (Object.hasOwn(op, "sourceAutoSave")) {
                assertFieldEventSaveAdmission(this.content, op);
                // Reject unknown owner contexts before the Web variant's first
                // yield, without performing native player/puppet/camera sync.
                this.requireEventSaveBoundary(t);
                t.autoSaveWait = op;
              } else this.requestEventSave(t, op);
            }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); }
            return;
          case "script-transition":
            try { this.transitionScript(t, op); }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "branch-character":
          case "branch-player-direction":
          case "branch-leader":
            try {
              const leaderContext = op.kind === "branch-leader" ? this.options.puppetActors?.read().context : undefined;
              const roster = op.kind === "branch-character" || op.kind === "branch-leader"
                ? this.options.puppetRoster?.current() : undefined;
              if (op.kind === "branch-leader" && (!leaderContext || !roster ||
                  canonical(leaderContext.party) !== canonical(roster.party)))
                throw new Error("Source leader branch requires the current map and Corps owners");
              const next = prepareEventContextBranch(op, { nextPc: t.pc, range: t.range,
                ...(roster ? { roster } : {}),
                ...(op.kind === "branch-player-direction" ? { playerDirection: this.player.direction } : {}),
                ...(leaderContext ? { playableCharacterCorpsId: leaderContext.savedLeaderIndex } : {}) });
              t.pc = next.pc;
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case 'source-party-selection': {
            try { this.openSourcePartySelection(t,op); }
            catch(error){t.pc--;this.block(error instanceof Error?error.message:String(error),op);}
            return;
          }
          case "field-script-shop": {
            try {
              const pending = t.scriptShop;
              if (pending) {
                if (pending.pc !== t.pc - 1 || canonical(op) !== pending.identity || !pending.closed)
                  throw new Error("Source script shop continuation changed or is still open");
                t.scriptShop = null;
                break;
              }
              if (!this.options.shop || !Number.isSafeInteger(op.groupId) || op.groupId <= 0 ||
                  typeof op.selector !== "string" || !op.selector || this.shopTask || this.pendingChoice ||
                  this.sourceMessage.active || this.messageWindow || this.treasureSceneState !== "player")
                throw new Error("Source script shop is missing its shared owner or conflicts with an interaction");
              this.options.shop.validate(op.groupId);
              const id = this.nextTask++, pc = t.pc - 1;
              t.scriptShop = { id, pc, op, identity: canonical(op), closed: false };
              this.shopTask = { id, groupId: op.groupId, entityId: this.interaction?.entityId ?? t.actor,
                stage: "open", close: null, scriptTaskId: t.id };
              t.pc--;
              return;
            } catch (error) { t.pc--; this.block(error instanceof Error ? error.message : String(error), op); return; }
          }
          case "field-party-query":
            try {
              const next = prepareFieldPartyQuery(op, { nextPc: t.pc, range: t.range,
                ...(this.options.puppetRoster ? { roster: this.options.puppetRoster.current() } : {}) });
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
                return this.prepareOwnedConditionAppearance(t, op, steps);
              };
              if (op.kind === "owned-condition") executeOwnedConditionEvent(op, this.options.ownedConditions, prepare,
                (steps, writes) => this.prepareOwnedConditionCore(t, op, steps, writes));
              else executeFieldRecoveryEvent(op, this.options.recovery, prepare);
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case 'assign-npc-route':
            try { this.assignNpcRoute(op,t.script,t.pc-1); }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "animation-cue":
          case "animation-play":
            try {
              if (op.kind === "animation-play") {
                let repeat: Task["animationRepeat"] = null;
                if (op.repeatCount !== undefined) {
                  checkpointInteger(op.repeatCount, 2, 0x7fffffff);
                  if (op.loop) throw new Error("A finite PlayAnim cannot also request an unbounded loop");
                  const program = this.content.scripts[t.script], webPC = t.pc - 1;
                  if (!program || program[webPC] !== op) throw new Error("Finite PlayAnim lost its actual Web instruction binding");
                  repeat = { op, fingerprint: canonical(op), script: t.script, program, webPC, actorId: t.actor,
                    actor, nativeEntity: actor?.native?.entity ?? null,
                    sourceEntity: this.entityList.find(entity => entity.id === t.actor),
                    registers: projectFieldCoreSlots(t.generalRegisters, {
                      i: { 0: 0, 1: op.repeatCount, 6: op.repeatCount, 7: 0 }, r: { 3: t.generalRegisters.r[0]! },
                    }) };
                }
                this.playTaskAnimation(t, op, false);
                t.animationWait = !op.loop;
                t.animationRepeat = repeat;
                if (repeat) {
                  t.generalRegisters = repeat.registers;
                  this.finiteAnimationJournal.push({ phase: "started", site: structuredClone(op), actorId: t.actor,
                    repeatCount: op.repeatCount!, remaining: repeat.registers.i[6]!, atMilliseconds: this.time });
                }
                break;
              }
              if (this.effectBoard(t.actor)) {
                // The source board Cue override is proven empty. Its existing
                // field-effect owner continues to hold playback and completion.
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
                this.prepareActorCustomAnimation(actor,animation,op.animation);
                animation.cue(op.animation, op.frame);
                actor.animation = animation;
              } else this.tileAnimations.cue(t.actor, op.frame);
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
          case "bgm-pause":
            try { this.bgm.pause(op.channel, op.paused, op.fade, this.content.bgm); }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "bgm-replay":
            try {
              const handle = this.bgm.beginReplay(op.channel, op.fade, this.content.bgm);
              if (handle) { t.bgmReplay = { op, handle }; return; }
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "field-timer":
            try {
              if (!this.timerState) throw new Error("Story timer host profile is unavailable");
              const origin = op.command.kind === "set" ? fieldTimerOriginContent(this.content) : undefined;
              const prepared = prepareFieldTimerCommand(this.timerState, op,
                op.command.kind === "set" ? bindFieldStoryTimer(this.content, op) : undefined);
              if (prepared.callback) {
                this.validateTimerCallback(prepared.callback);
                const acknowledged = acknowledgeFieldTimerCallback(prepared.snapshot, prepared.callback);
                this.transitionScript(t, { ...op, kind: "script-transition",
                  targetScript: prepared.callback.binding.callback.name, returnToCaller: false });
                this.timerState = acknowledged;
              } else this.timerState = prepared.snapshot;
              if (origin) this.timerOrigin = origin;
              if (!this.timerState.active) this.timerOrigin = undefined;
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
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
          case "blank":
            // The existing task cursor already points to the next instruction.
            // lastClock prevents any second pump this clock; the next clock
            // resumes that same task. No elapsed-time or saveable timer exists.
            return;
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
          case "field-skybox-scroll":
            try{const owner=this.requireSkyboxOwner(),program=this.content.scripts[t.script]!,webPC=t.pc-1,now=Math.fround(this.time/1000),registers=projectFieldCoreSlots(t.generalRegisters,{r:{0:now}}),transaction=owner.prepareStart(op.command,now);
              if(this.requireSkyboxOwner()!==owner||program[webPC]!==op)throw Error("Stale source Skybox first clock");transaction.commit();t.generalRegisters=registers;t.skyboxWait={op,program,webPC,fingerprint:canonical(op),registers,owner};return;
            }catch(error){this.block(error instanceof Error?error.message:String(error),op);return;}
          case "standalone-wait":
            try {
              // The exact source wrapper reads category10/index7 once on its
              // first clock, publishes r0/r1, then yields even for <=0ms.
              const milliseconds = this.eventState.read({ category: "MapLocalVariable", index: 7 });
              if (milliseconds === null) throw new Error("Standalone wait requires known MapLocalVariable[7]");
              const registers = projectFieldCoreSlots(t.generalRegisters,
                { r: { 0: milliseconds / 1000, 1: this.time / 1000 } });
              const program = this.content.scripts[t.script]!;
              t.generalRegisters = registers;
              t.standaloneWait = { op, program, webPC: t.pc - 1, fingerprint: canonical(op), registers };
              return;
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
          case "puppet":
            try {
              const host = this.options.puppetActors, lifecycle = this.puppetLifecycle;
              const effect = this.effectBoard(op.actor);
              const nextOp = this.content.scripts[t.script]?.[op.target + 1], nextKind = nextOp?.kind;
              const plan = host && lifecycle && !effect ? projectFieldPuppetActorEntry({ ...host.read(), script: lifecycle.script,
                entityId: Number(op.actor), nextMnemonic: nextKind === "hide" ||
                  nextOp?.kind === "actor-visibility" && !nextOp.visible ? "Hide" : nextKind ?? "unknown",
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
              // Native Entry/Exit do not clear a reused PuppetCore's bank;
              // ResetAll drops old tasks only after their banks are reset.
              const previousCore = this.tasks.filter(other => other.slot === entry.slot).at(-1);
              if (previousCore) child.generalRegisters = previousCore.generalRegisters;
              publish();
              if (plan?.assignments) lifecycle!.assignments = plan.assignments;
              this.tasks.push(child);
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "field-puppet-replacement":
            try { this.executePuppetReplacement(op.command); }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "join": // Old authored fixtures; source compilation uses exec-puppets.
          case "exec-puppets":
          case "finish-puppets":
            try {
              const command = op.kind === "finish-puppets"
                ? { ...op, kind: "finish-puppets" as const }
                : { ...op, kind: "exec-puppets" as const,
                    asynchronous: op.kind === "exec-puppets" && op.asynchronous };
              const replacement = command.kind === "exec-puppets" ? this.preparePuppetReplacementExec() : null;
              const statuses = this.puppetStatuses();
              for (const row of replacement?.selected ?? []) if (row.selector === 0) statuses[row.child.slot!] = "sleep";
              const result = fieldPuppetControlStep({ kind: command.kind === "finish-puppets" ? "finish" : "exec",
                firstClock: true, asynchronous: command.kind === "exec-puppets" && command.asynchronous,
                ...this.puppetControlContext(), slots: statuses });
              // Resolve and validate the whole starting batch before publishing
              // any Ready state or visibility change. No partial Exec on error.
              const ready = result.startSlots.map((slot) => {
                const child = this.tasks.find((other) => !other.done && other.slot === slot)!;
                const mapped = replacement?.selected.find(row => row.child === child);
                let actor = mapped?.actor ?? child.actor;
                let binding: "present" | "absent" | "unknown";
                if ((mapped?.selector ?? child.sourceEntityId) !== null && this.options.puppetActors) {
                  const { catalog, context } = this.options.puppetActors.read();
                  const resolved = resolveFieldPuppetActor(catalog, context, mapped?.selector ?? child.sourceEntityId!);
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
              const showCamera = ready.some(r => r.plan.showActor && r.actor === this.cameraActorId);
              let cameraShow: ReturnType<FieldCameraHost["prepareState"]> | null = null;
              if (this.camera && (showCamera || replacement?.dummy)) {
                const draft = this.camera.fork(this.content.cameraHost!, this.cameraPorts());
                if (replacement?.dummy) {
                  const state = draft.snapshot(), player = this.player.native!.entity;
                  state.dummy.position.z = player.position.z;
                  state.dummy.layer = player.layer;
                  // Known sprite-less camera has no material attachments.
                  draft.prepareState(state).commit();
                }
                if (showCamera) draft.prepareVisibility(true).commit();
                cameraShow = this.camera.prepareState(draft.snapshot());
              }
              const effectShows: FieldEffectOperation[] = [...new Set(ready.filter((r) => r.plan.showActor && this.effectBoard(r.actor))
                .map((r) => r.actor))].map((id) => ({ kind: "visibility", id, visible: true, duration: 0 }));
              const effectShow = effectShows.length ? this.effects!.prepare(effectShows) : null;
              const publish = host && this.puppetLifecycle ? host.prepare({ leaderId: null,
                assignments: result.clearAssignments ? fieldPuppetAssignments() : null,
                effects: [...(replacement?.effects ?? []), ...ready.filter((r) => r.plan.showActor && !(this.camera && r.actor === this.cameraActorId) && !this.effectBoard(r.actor))
                  .map((r) => ({ kind: "show" as const, actor: r.actor }))] }) : () => {};
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
                replacement?.validate();
                publish();
                publishCollision();
                for (const row of replacement?.selected ?? []) {
                  row.child.actor = row.actor; row.child.sourceEntityId = row.selector;
                  if (row.selector === 0) { row.child.done = true; row.child.state = "awake"; }
                }
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
                this.prepareCameraPosition(op)();
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
                this.prepareActorControl(actor.id, op)();
              } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
              break;
            }
            if (op.nativeCommand && ("mode" in op.nativeCommand || !([0, 3].includes(op.nativeCommand.layer)) ||
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
          case "actor-visibility":
            try { this.executeActorVisibility(t.actor, op, t.script, t.pc - 1); }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case 'field-world-auto-move':
          case 'field-world-auto-task':
            try {this.applyWorldAutoTask({...op,kind:'field-world-auto-task'});}
            catch(error){this.block(error instanceof Error?error.message:String(error),op);return;}
            break;
          case "field-view-change":
            try { const prepared=this.prepareViewChange(op.command);prepared.commit();
              // Explicit Web join: one existing 10ms task clock. This is not
              // native IsDuringTakeoffAndLanding or r0 interpreted as seconds.
              if(op.command.wait){t.wait=10;return;}
            } catch(error){this.block(error instanceof Error?error.message:String(error),op);return;}
            break;
          case "field-camera":
            try {
              if (!this.camera) throw new Error("Source field camera host is unavailable");
              const selected = this.camera.prepareSelect(op.command);
              if (selected.resetDummyMovement && this.tasks.some(task => !task.done && task.cameraPath?.op.kind === "field-puppet-route"))
                throw new Error("Camera selection cannot cancel an active Puppet Route task");
              selected.commit();
              if(selected.resetDummyMovement){this.#worldAutoDummyMotion=null;this.#worldAutoDummyExpected=null;}
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
          case "field-puppet-route":
            try {
              if (t.actor === this.cameraActorId) {
                if (!this.camera) throw new Error("Camera Puppet Route host is unavailable");
                const next = this.camera.preparePath({ ...op.command, kind: "route" }, null, this.time, undefined, this.cameraRouteGrid());
                next.commit(); this.puppetRouteJournal.push({ phase: next.flow === "wait" ? "started" : "same-cell", site: structuredClone(op), actorId: t.actor, atMilliseconds: this.time });
                if (next.flow === "wait") { t.cameraPath = { op, progress: next.progress }; return; }
                break;
              }
              if (!actor) throw new Error("Puppet Route requires a bound ordinary actor; effect search is unavailable");
              const flow = this.startPuppetRoute(actor, op);
              this.puppetRouteJournal.push({ phase: flow === "wait" ? "started" : "same-cell",
                site: structuredClone(op), actorId: actor.id, atMilliseconds: this.time });
              if (flow === "wait") { t.scriptMove = op; return; }
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "field-mob-control":
            try { this.executeMobControl(op); } catch(error) { this.block(String(error),op); return; }
            break;
          case "field-bird-view-move":
            try {
              if (t.slot === null || !actor) throw new Error("MoveBirdView requires its actual PuppetCore native actor; camera/effect height is unadmitted");
              t.birdViewMove = this.startBirdViewMove(t, actor, op);
              return; // Native first clock always yields, even height-only/duration0.
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
          case "field-script-motion":
            try {
              if (t.actor === this.cameraActorId) {
                if (!this.camera) throw new Error("Camera source motion host is unavailable");
                if (op.command.kind !== "lerp") {
                  let target: { x: number; y: number; z: number } | undefined;
                  if (op.command.kind === "move-to" && op.command.target.kind === "entity") {
                    if (!this.options.puppetActors) throw new Error("Camera MoveTo target entity selector owner is unavailable");
                    const { catalog, context } = this.options.puppetActors.read();
                    const resolved = resolveFieldPuppetActor(catalog, context, op.command.target.selector);
                    const entity = resolved.actor === null ? undefined : this.actors[resolved.actor]?.native?.entity;
                    if (entity) target = { ...entity.position };
                    else if (resolved.actor === this.cameraActorId) target = { ...this.camera.snapshot().dummy.position };
                    else throw new Error("Camera MoveTo target has no trusted native position");
                  }
                  const next = this.camera.preparePath(op.command, null, this.time, target);
                  next.commit();
                  if (next.flow === "wait") { t.cameraPath = { op, progress: next.progress }; return; }
                  break;
                }
                if (op.command.layer !== 0 || op.command.animation !== "")
                  throw new Error("Camera animation or layer transition provider is unavailable");
                const command: FieldCameraLerp = { kind: "lerp", x: op.command.x, y: op.command.y,
                  layer: 0, duration: op.command.duration, arcHeight: op.command.arcHeight };
                if (command.duration < 0) throw new Error("Negative source Lerp duration is not admitted");
                const next = this.camera.prepareLerp(command, null, this.time / 1000);
                next.commit();
                if (next.flow === "wait") { t.cameraLerp = { op, command, progress: next.progress }; return; }
              } else {
                if (!actor) throw new Error("Source script motion requires a bound actor");
                if (op.command.kind === "move-to") {
                  if (this.startScriptMoveTo(actor, op) === "wait") { t.scriptMove = op; return; }
                  break;
                }
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
          case "field-screen-presentation":
            try {
              if(!this.screenPresentationState||!fieldScreenPresentationBinding(this.content,this.options.screenPresentation))throw new Error("Source screen presentation requires explicit current Web2D runtime/content owner");
              const state=this.screenPresentationState,transaction=state.prepare(op.command);
              if(this.screenPresentationState!==state||!fieldScreenPresentationBinding(this.content,this.options.screenPresentation))throw new Error("Stale screen presentation owner");
              transaction.commit();if(transaction.flow==='wait'){t.screenBackdropWait=op;return;}
            }catch(error){this.block(error instanceof Error?error.message:String(error),op);return;}
            break;
          case "field-color-fade":
            try {
              if (!this.ordinaryScreenEffectsAvailable) throw new Error("Ordinary Web screen-effects host is unavailable");
              if (this.colorFilterState!.start(op) === "wait") { t.colorFadeWait = op; return; }
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "field-content-invalidation":
            try { this.contentInvalidations.execute(t.script, t.pc - 1); }
            catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "field-shake":
            try {
              if (!this.cameraShakeAvailable) throw new Error("Normal field camera / explicit Web camera-shake policy is unavailable");
              const command = op.command, origin = command.kind === "play"
                ? bindFieldStoryShake(this.content, t.script, t.pc - 1, command) : null;
              this.cameraShakeState!.start(command, origin);
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "field-flash":
            try {
              if (!this.ordinaryScreenEffectsAvailable) throw new Error("Ordinary Web screen-effects host is unavailable");
              t.flashWait = { op, cursor: startFieldFlash(this.fader, op, frameDeltaSeconds) };
              t.generalRegisters = projectFieldCoreSlots(t.generalRegisters, { i: { 7: 0 } });
              return;
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
          case "source-message":
            try {
              const retained = this.retainedMessage,
                handoff = !this.dialogue && retained?.manual?.after === "message" && retained.task === t.id;
              if ((this.messageWindow && !handoff) || this.shopTask || this.treasureSceneState === "message")
                throw new Error("Source message conflicts with an occupied message window");
              if (op.command.kind === "finish-wait") {
                if (!this.sourceMessage.endWaiting) { t.sourceMessageWait = { op, cursor: null }; return; }
                break;
              }
              if (!this.options.sourceMessageEffects && !this.options.sourceMessageSequence)
                throw new Error("Source message entity-update host is unavailable");
              let preparedOp = op, timingOwner: ReturnType<NonNullable<FieldGameOptions["sourceMessageSequence"]>["prepare"]> | null = null,
                names: ReturnType<FieldGame["prepareMessagePresentation"]> | null = null;
              if (op.command.kind === "sequence") {
                if (!this.options.sourceMessageSequence) throw new Error("Source message sequence profile/timing owner is unavailable");
                timingOwner = this.options.sourceMessageSequence.prepare();
                const runs = sourceMessageSequenceTextRuns(op.command.document);
                names = this.prepareMessagePresentation({ key: op.command.key, speaker: op.command.speaker, text: runs[0]!,
                  ...(op.command.document.alignment === "center" ? { alignment: "center" as const } : {}),
                  ...(op.command.template ? { template: op.command.template } : {}) }, runs);
                const command = structuredClone(op.command); let run = 0;
                command.speaker = names.message.speaker;
                for (const token of command.document.tokens) if (token.kind === "text") token.text = names.pages[run++]!;
                delete command.template; preparedOp = { ...op, command };
              }
              const next = this.sourceMessage.prepare(preparedOp, timingOwner?.context), publish = this.options.sourceMessageEffects
                ? this.options.sourceMessageEffects.prepare(next.effects) : this.prepareDialogueMask(next.effects[0]!.group);
              const core = op.command.kind === "sequence" ? projectFieldCoreSlots(t.generalRegisters, {
                i: { 0: op.command.seconds > 0 ? 1 : 0, 1: op.command.seconds > 0 ? -1 : 0,
                  2: op.command.seconds > 0 && timingOwner!.context.integratorAutomatic ? 1 : 0 },
                r: { 2: next.timing!.pageSeconds ?? op.command.seconds,
                  ...(op.command.seconds > 0 ? { 1: this.time / 1000 } : {}) },
              }) : null;
              if (typeof publish !== "function") throw new Error("Invalid source message host transaction");
              if (this.retainedMessage !== retained) throw new Error("Stale source message handoff");
              names?.validate(); timingOwner?.validate();
              publish(); next.commit(); this.sourceMessageTask = op.command.kind === "close" ? null : t.id;
              if (core) t.generalRegisters = core;
              if (handoff) this.retainedMessage = null;
              if (op.command.kind === "sequence") {
                const cursor = createSourceMessageTaskCursor(op.command, next.timing!, next.ticket, this.time);
                if (cursor) { t.sourceMessageWait = { op, cursor }; return; }
              }
            } catch (error) { this.block(error instanceof Error ? error.message : String(error), op); return; }
            break;
          case "choice":
            try {
              const sourceWindow = this.sourceMessage.active && this.sourceMessageTask === t.id && this.sourceMessage.sequenceAfter === "choice";
              if (this.sourceMessage.active && !sourceWindow || this.shopTask || this.treasureSceneState === "message")
                throw new Error("Field choice conflicts with an occupied message manager");
              if (this.messageWindow && this.messageWindow.task !== t.id)
                throw new Error("Field choice message belongs to another task");
              if (op.presentation === "yes-no" && !this.messageWindow && !sourceWindow)
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
          case 'source-boss-encounter':
          case "source-encounter":
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
            if(op.kind==='source-boss-encounter'){try{this.beginSourceBossEncounter(op,t);}catch(error){this.block(error instanceof Error?error.message:String(error),op);}return;}
            if (op.kind === "source-encounter") {
              try { this.beginSourceEncounter(op, t); }
              catch (error) { this.block(error instanceof Error ? error.message : String(error), op); }
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
