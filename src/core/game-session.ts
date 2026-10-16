import {WEB_SOURCE_CHARACTER_NAMING} from './source-character-naming.js';
import {WEB_RTS_PARTY_SWITCH,validateRtsPolicy,type WebRtsPartySwitch}from'./field-rts-party.js';
import {parseWebBattleChildAdmission,type WebBattleChildAdmission} from './battle-child-admission.js';
import {WEB_BATTLE_GAU_INSTANCES,type BattleGauMediaHost} from "./battle-gau-instances.js";
import { WEB_BATTLE_GLOBAL_FADE } from "./battle-global-fade.js";
import { BATTLE_RESERVED_SCRIPTS, parseFieldReservation,parseRtsFieldReservation, reservationFingerprint, reservationSourceFingerprint, type FieldReservationSnapshot, type BattleFieldReservation, type BattleFieldReservationHost, type FieldReservedScriptPort } from "./field-reserved-script.js";
import { validateBattleEventConditions, type WebBattleEventConditions } from "./battle-event-condition.js";
import { validateBattleBranchExecutionPolicy, type WebBattleBranchExecution } from './battle-branch-execution.js';
import { WEB_BATTLE_EVENT_EFFECTS, createWebBattleEventEffectHost, type BattleEventEffectHost } from './battle-event-effect.js';
import { validateScriptedBattleActionPolicy, type WebScriptedBattleActions } from "./scripted-battle-action.js";
import { WEB_SOURCE_PARTY_SELECTION, type WebSourcePartySelection, type SourcePartySelectionOutcome } from './source-party-selection.js';
import { WEB_BATTLE_EVENT_MESSAGE_POLICY, type BattleEventMessageHost } from "./battle-event-message.js";
import { WEB_BATTLE_EVENT_CONTROLS, validateBattleEventControls, type WebBattleEventControls } from "./battle-controls.js";
import { parseSourceMessageFeeCatalog } from "./source-message-fees.js";
import { WEB_SOURCE_SCRIPT_RANDOM, type WebSourceScriptRandom } from "./field-script-random.js";
import { validateRetainedWorldTransportationPolicy } from "./world-transportation-entry.js";
import type { BattleGauEntry } from './battle-gau.js';
import { WEB_SOURCE_ENCOUNTER_POLICY, selectWebSourceEncounter, type WebSourceEncounterPolicy } from "./source-encounter-entry.js";
import { WEB_SOURCE_BOSS_ENTRY, type WebSourceBossEntry } from './source-boss-encounter.js';
import { WEB_COMMITTED_BATTLE_RESULT, projectCommittedBattleResult, type WebCommittedBattleResult } from './source-battle-result.js';
import { sourceEncounterCandidates } from "./source-encounter.js";
import type { FieldContent } from "../field/types.js";
import type { GameEventSaveRequest, FieldGame, FieldGameOptions, Stop } from "./field.js";
import { encounterContent, battleDefinitionBlocker, type BattleCatalog, type BattleContent } from "./battle-content.js";
import { BattleGame, type Combatant } from "./battle.js";
import { EventState } from "./event-state.js";
import { battleEventSharedSnapshot, type BattleEventSharedSnapshot } from "./battle-event-shared.js";
import { assessBattleHandoff } from "./battle-handoff-content.js";
import type { AudioReadinessPort } from "./audio-readiness.js";
import type { FieldSoundPresentation } from "./field-sound-presentation.js";
import type { FieldEffectRuntimeHost } from "./field-effects.js";
import { WEB_LOGICAL_FIELD_EFFECTS } from "./field-logical-effects.js";
import type { ShopTradeRequest } from "./shop.js";
import { projectPartyMenu, type PartyMenuRequest } from "./party-menu.js";
import { projectCharacterMenu } from "./character-menu.js";
import { equipmentAvailability, equipmentOwnedAbilities } from "./equipment.js";
import { projectBattleAbilities } from "./battle-abilities.js";
import { projectBattleItemMenu } from "./battle-entry.js";
import { BattleConditions } from "./battle-conditions.js";
import type { FieldAbilityContext, FieldAbilityRequest } from "./field-abilities.js";
import {
  parseBattlePreferences,
  type BattlePreferences,
} from "./battle-preferences.js";
import { WorldSession, type WorldCheckpoint } from "./world-session.js";
import type { FieldTimerOriginContent } from "./field-story-runtime.js";
import {
  GameState,
  type BattleLease,
  type GameStateSnapshot,
} from "./game-state.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import { canonical } from "./canonical.js";
import { WalkEncounterState, type WalkEncounterSnapshot } from "./walk-encounters.js";
import { prepareSourceNewGameField, installSourceNewGameActors, validateSourceNewGameLaunch,
  type SourceNewGameContent } from "./source-new-game.js";
import { assertFrameworkNewGameBindings, prepareFrameworkNewGameField, installFrameworkNewGameActors,
  type FrameworkNewGameContent } from "./framework-new-game.js";
import { verifyContent } from "./content-integrity.js";
import { verifiedContentValue, type VerifiedContent } from "./verified-content.js";
import type { NewGameFieldLaunch, NewGameFieldPreparation } from "./new-game-field-entry.js";
import { FieldFadeState } from "./field-fade.js";
import { cloneSourcePresentationContext, createSourcePresentationContext, type SourcePresentationContext } from "./source-presentation.js";
import { assertSourceGameCatalog, assertSourceEntryProfiles } from "./source-catalog.js";
import { battleMediaUrls, battleUnitMediaUrls } from "./game-content.js";
import {
  checkpointKeys,
  checkpointInteger,
  checkpointNumber,
} from "./checkpoint-validation.js";

type GameCheckpointBase = {
  kind: "game-checkpoint";
  sourceSetHash: string;
  battleCatalogHash: string;
  origin: { kind: "development-checkpoint" } | { kind: "source-new-game"; sourceContentHash: string }
    | { kind: "framework-new-game"; entryContentHash: string };
  seed: number;
  encounterSerial: number;
  remainder: number;
  battlePreferences: BattlePreferences;
  owned: GameStateSnapshot;
  world: WorldCheckpoint;
};
/** Version 4 is read-only compatibility for content without walk encounters. */
export type GameCheckpoint = GameCheckpointBase & (
  { formatVersion: 4 } | { formatVersion: 5 | 6; walkEncounters: WalkEncounterSnapshot } |
  { formatVersion: 7 | 8 | 9 | 10; walkEncounters: WalkEncounterSnapshot; fieldReservation: FieldReservationSnapshot }
);
/** External observations are rebound by the host on load, never trusted from saves. */
export type GameSessionRuntime = { sourceSnapshot?:import("./field-source-snapshot.js").ImmutableOwnedFieldSource; rtsPartySwitch?:WebRtsPartySwitch; sourceCharacterNaming?:typeof WEB_SOURCE_CHARACTER_NAMING; transportationParkingUpload?:import("./transportation-parking-upload.js").WebSourceTransportParkingUpload; vehicleLifecycle?:import("./field-vehicle-lifecycle.js").WebSourceVehicleLifecycle; battleChildPartyAdmission?:WebBattleChildAdmission; battleGauInstances?:BattleGauMediaHost; fieldEffectTransforms?:import("./field-effect-transforms.js").WebFieldEffectTransforms; skyboxPresentation?: import("./field-skybox.js").WebFlatSkybox; battleEventConditions?: WebBattleEventConditions; screenPresentation?: import("./field-screen-presentation.js").WebFieldScreenPresentation; battleGlobalFade?:typeof WEB_BATTLE_GLOBAL_FADE; mobColorFilter?: import("./field-mob-controls.js").WebFlatMobColorFilter; birdViewActors?: import("./field-bird-view-actors.js").WebFlatBirdViewActors; worldAutoMove?:import("./field-world-auto-move.js").WebFlatWorldAutoMove; worldAutoTasks?:import("./field-world-auto-tasks.js").WebFlatWorldAutoTasks; battleBranchExecution?:WebBattleBranchExecution; battleEventEffects?:BattleEventEffectHost|typeof WEB_BATTLE_EVENT_EFFECTS; battleEventControls?: WebBattleEventControls; viewChange?: import("./field-view-change.js").WebFlatFieldViewChange; battleEventMessages?: typeof WEB_BATTLE_EVENT_MESSAGE_POLICY; sourcePartySelection?: WebSourcePartySelection; scriptedBattleActions?: WebScriptedBattleActions; puppetRoutes?: import("./field-puppet-route.js").WebPuppetRoutePolicy; sourceBossEntry?:WebSourceBossEntry; sourceBattleResult?:WebCommittedBattleResult; scriptRandom?: WebSourceScriptRandom; retainedWorldTransportation?: import("./world-transportation-entry.js").WebRetainedWorldTransportation; assignedNpcRoutes?: import('./field-assigned-route.js').WebAssignedRoutePolicy; sourceEncounterPolicy?: WebSourceEncounterPolicy; audioReadiness?: AudioReadinessPort; fieldEffects?: FieldEffectRuntimeHost;
  soundPresentation?: FieldSoundPresentation;
  sourceMessageSequence?: NonNullable<FieldGameOptions["sourceMessageSequence"]>;
  conditionLeaderActivity?: NonNullable<FieldGameOptions["conditionLeaderActivity"]>;
  cameraShake?: NonNullable<FieldGameOptions["cameraShake"]>;
  /** Host prepares battle and return media before committing the same session
   * candidate used by the synchronous development compatibility adapter. */
  battleHandoff?: "prepared";
  /** Host wall-clock observation for source parking timestamps; recorded as an
   * exact decimal Int64, never sampled by deterministic core state. */
  transportationTimestamp?: () => string };
type FreshSession = { content: SourceNewGameContent | FrameworkNewGameContent; state: GameState; events: EventState;
  map: WorldMapContent; fade?: FieldFadeState; presentation: SourcePresentationContext; restoring?: true };
export type GameRestoreWorld = { catalog: WorldCatalog; map: WorldMapContent;
  timerOrigin?: FieldTimerOriginContent;
  source?: { content: SourceNewGameContent; initialMap: WorldMapContent };
  initialized?: { content: FrameworkNewGameContent; initialMap: WorldMapContent } };
export type PreparedGameEventSave = {
  checkpoint: GameCheckpoint;
  validate(): void;
  /** Atomically write the prepared snapshot, then ACK without clocking events. */
  commitWith(write: () => void): void;
  discard(): void;
};
export type SessionBattleRequest = Stop & { kind: "encounter" };
export type SessionBattleReturnRequest = { outcome: "victory" | "escaped" | "forced"; request: SessionBattleRequest };
export type PreparedSessionBattleStart = {
  readonly kind: "start" | "retry";
  /** Every read is detached; the suspended field request's actual reference
   * remains private and is checked again before publication. */
  readonly request: SessionBattleRequest;
  readonly content: BattleContent;
  /** Exact encounter, registered enemies and frozen owned-player media. The
   * host reads a detached view while this candidate retains its entry lease. */
  readonly mediaUrls: readonly string[];
  /** Sticky even after an exception: an already published owner may never be
   * treated as a retryable host preparation failure. */
  readonly publicationStarted: boolean;
  validate(): void;
  commit(): boolean;
  discard(): void;
};
export type PreparedSessionBattleReturn = Omit<PreparedSessionBattleStart, "kind"> & {
  readonly kind: "return";
  readonly outcome: "victory" | "escaped" | "forced";
};
type BattleEntry = { field: FieldGame; request: SessionBattleRequest; lease: BattleLease;
  content: BattleContent; seed: number; shared: BattleEventSharedSnapshot; gau:BattleGauEntry|null; reservationHost:BattleFieldReservationHost };
type PendingBattleHandoff = { status: "prepared" | "publishing" | "consumed" | "discarded"; discard(): void };
class StaleSessionBattleHandoff extends Error {
  constructor() { super("Stale session battle handoff"); }
}
function isBattleRequest(stop: Stop | null): stop is SessionBattleRequest { return stop?.kind === "encounter"; }

/** Owns the encounter handoff and consumes rewards exactly once. No renderer state drives progression. */
export class GameSession {
  readonly world: WorldSession;
  get field() {
    return this.world.field;
  }
  battle: BattleGame | null = null;
  readonly state: GameState;
  get players() {
    return this.state.partyPlayers();
  }
  get gil() {
    return this.state.gil;
  }
  get completedEncounters() {
    return this.state.completedEncounters;
  }
  private battleLease: BattleLease | null = null;
  private battleEntry: BattleEntry | null = null;
  private pendingBattleHandoff: PendingBattleHandoff | null = null;
  private battleHandoffPreparing = false;
  private readonly preparedBattleHandoff: boolean;
  readonly #battleEffectRuntime:BattleEventEffectHost|undefined;
  private readonly battleEventConditions: WebBattleEventConditions | undefined;
  private readonly scriptedBattleActions: WebScriptedBattleActions | undefined;
  private readonly battleBranchExecution:WebBattleBranchExecution|undefined;
  readonly #battleChildAdmission:WebBattleChildAdmission|undefined;
  readonly #battleGauRuntime:BattleGauMediaHost|undefined;
  private readonly battleGlobalFade:typeof WEB_BATTLE_GLOBAL_FADE|undefined;
  private readonly battleEventControls: WebBattleEventControls | undefined;
  readonly #battleMessageRuntime: { sequence: NonNullable<GameSessionRuntime["sourceMessageSequence"]> } | null;
  private fieldReservation: FieldReservationSnapshot | null = null;
  get reservedFieldScript(): FieldReservationSnapshot | null { return structuredClone(this.fieldReservation); }
  private readonly fieldReservationPort: FieldReservedScriptPort = {
    read: () => this.reservedFieldScript,
    prepareRts:content=>{
      const field=this.field,before=canonical(this.fieldReservation),catalog=this.state.fieldRtsParty.read().catalog;
      if(field.content!==content||field.rtsPolicy!==WEB_RTS_PARTY_SWITCH||this.battle||this.state.inBattle)
        throw Error('RTS reservation requires the current explicitly bound Field');
      const pin=reservationFingerprint(content,catalog.afterScript);let consumed=false;
      const validate=()=>{if(consumed||this.field!==field||this.battle||this.state.inBattle||
        canonical(this.fieldReservation)!==before||reservationFingerprint(content,catalog.afterScript)!==pin||
        canonical(this.state.fieldRtsParty.read().catalog)!==canonical(catalog))throw Error('Stale RTS reservation owner');};
      return{validate,commit:()=>{validate();consumed=true;this.fieldReservation={kind:'source-rts-field-reservation-v1',
        parentSourceSetHash:content.parentSourceSetHash,script:catalog.afterScript};}};
    },
    prepareConsume: content => {
      const queued = this.reservedFieldScript;
      if (!queued) return null;
      const field = this.field;
      if (field.content !== content || this.battle || this.state.inBattle)
        throw new Error('Reserved script requires the current unleased field owner');
      if (queued.parentSourceSetHash !== content.parentSourceSetHash)
        throw new Error('Reserved script belongs to another source domain');
      if(queued.kind==='source-rts-field-reservation-v1'&&field.rtsPolicy!==WEB_RTS_PARTY_SWITCH)throw Error('Saved RTS reservation cannot grant a runtime policy');
      const before = canonical(queued), pin = reservationFingerprint(content, queued.script);
      let consumed = false;
      const validate = () => {
        if (consumed || this.field !== field || this.battle || this.state.inBattle ||
            canonical(this.fieldReservation) !== before || reservationFingerprint(content, queued.script) !== pin)
          throw new Error('Stale reserved field script consumption');
      };
      return { script: queued.script, validate, commit: () => { validate(); consumed = true; this.fieldReservation = null; } };
    },
  };
  private captureBattleReservationHost(field: FieldGame): BattleFieldReservationHost {
    const targets = Object.fromEntries(Object.values(BATTLE_RESERVED_SCRIPTS).map(name => [name,
      reservationSourceFingerprint(field.content,name)]));
    const entry=this.reservedFieldScript;if(entry?.kind==='source-rts-field-reservation-v1')throw Error('Battle cannot borrow an outstanding RTS reservation');
    return { entry, require: role => {
      const name = BATTLE_RESERVED_SCRIPTS[role];
      if (!name || this.field !== field || reservationFingerprint(field.content, name) !== targets[name])
        throw new Error('Battle reserved script current source binding changed: ' + name);
      return parseFieldReservation({ kind: 'source-field-reservation-v1', script: name,
        parentSourceSetHash: field.content.parentSourceSetHash });
    } };
  }
  private prepareReservationReturn(raw: BattleFieldReservation | null, field: FieldGame) {
    if (!raw) throw new Error('Battle lost its borrowed field reservation');
    checkpointKeys(raw, 'kind,entry,candidate');
    if (raw.kind !== 'battle-field-reservation-v1') throw new Error('Invalid battle field reservation return');
    const entry = raw.entry === null ? null : parseFieldReservation(raw.entry),
      candidate = raw.candidate === null ? null : parseFieldReservation(raw.candidate), before = canonical(entry);
    if (candidate && candidate.parentSourceSetHash !== field.content.parentSourceSetHash)
      throw new Error('Battle field reservation source domain changed');
    const pin = candidate ? reservationFingerprint(field.content, candidate.script) : null;
    let consumed = false;
    const validate = () => {
      if (consumed || this.field !== field || canonical(this.fieldReservation) !== before ||
          candidate && reservationFingerprint(field.content, candidate.script) !== pin)
        throw new Error('Stale battle field reservation return');
    };
    validate();
    return { validate, commit: () => { validate(); consumed = true; this.fieldReservation = candidate; } };
  }
  private encounterSerial = 0;
  private remainder = 0;
  private currentBattlePreferences: BattlePreferences;
  private readonly walkEncounters: WalkEncounterState;
  private encounterFailure: { request: NonNullable<GameSession["field"]["stop"]>; message: string } | null = null;
  private freshEntry: { content: SourceNewGameContent; launched: boolean } | null = null;
  private initializedEntry: FrameworkNewGameContent | null = null;
  static prepareNewGame(content: SourceNewGameContent, world: WorldCatalog, map: WorldMapContent,
    battle: BattleCatalog, fade: FieldFadeState, presentation: SourcePresentationContext,
    runtime: GameSessionRuntime = {}, seed = 20261010): GameSession {
    assertSourceGameCatalog(battle, assertSourceEntryProfiles(content, world, map));
    const state = GameState.createNewGame(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
    const prepared = prepareSourceNewGameField(content, world, map, battle, state, fade.projection ?? undefined);
    const context = cloneSourcePresentationContext(presentation);
    if (context?.origin !== "title-new-game" || context.advertisementOpeningFader !== "absent")
      throw new Error("Fresh game requires ordinary title presentation context");
    const events = new EventState(prepared.fresh.events);
    events.clearMap(map.mapId);
    const session = new GameSession(prepared.field, battle, seed, runtime, { content, state,
      events, map, fade: fade.fork(), presentation: context });
    session.setBattlePreferences(prepared.fresh.battlePreferences);
    return session;
  }
  /** Source DataInitialize owns the initial domains; an independently declared
   * framework map owns placement. An optional authored presentation owner is
   * captured before asynchronous validation; omission leaves its state unknown.
   * Neither route nor legacy save is rewritten. */
  static async prepareFrameworkNewGame(content: FrameworkNewGameContent, world: WorldCatalog, map: WorldMapContent,
    battle: BattleCatalog, runtime: GameSessionRuntime = {}, seed = 20261010,
    initialFade?: FieldFadeState): Promise<GameSession> {
    if (initialFade !== undefined && !(initialFade instanceof FieldFadeState))
      throw new Error("Framework presentation requires an actual Field fade owner");
    const fade = initialFade?.fork();
    const input = structuredClone({ content, world, map, battle }), host = { ...runtime };
    if (!input.battle.gameState.sourceNewGame) throw new Error("Missing framework source initializer");
    await Promise.all([verifyContent(input.content), verifyContent(input.world), verifyContent(input.map), verifyContent(input.battle),
      verifyContent({ ...input.battle.gameState.sourceNewGame, contentHash: input.content.initializerHash })]);
    return GameSession.#instantiateFrameworkNewGame(input, host, seed, fade);
  }
  /** Explicit immutable definitions. Field/World retain their own R2 snapshots
   * and live identities; this capability cannot come from a checkpoint. */
  static async prepareFrameworkNewGameFromVerified(content: VerifiedContent<FrameworkNewGameContent>,
    world: VerifiedContent<WorldCatalog>, map: VerifiedContent<WorldMapContent>, battle: VerifiedContent<BattleCatalog>,
    runtime: GameSessionRuntime = {}, seed = 20261010, initialFade?: FieldFadeState): Promise<GameSession> {
    if (initialFade !== undefined && !(initialFade instanceof FieldFadeState))
      throw new Error("Framework presentation requires an actual Field fade owner");
    const fade = initialFade?.fork(), host = { ...runtime };
    if (host.sourceSnapshot !== 'immutable-owned-field-source-v1')
      throw new Error("Verified framework definitions require immutable owned Field source mode");
    const input = { content: verifiedContentValue(content), world: verifiedContentValue(world),
      map: verifiedContentValue(map), battle: verifiedContentValue(battle) };
    if (!input.battle.gameState.sourceNewGame) throw new Error("Missing framework source initializer");
    await verifyContent({ ...input.battle.gameState.sourceNewGame, contentHash: input.content.initializerHash });
    return GameSession.#instantiateFrameworkNewGame(input, host, seed, fade);
  }
  static #instantiateFrameworkNewGame(input: { content: FrameworkNewGameContent; world: WorldCatalog;
    map: WorldMapContent; battle: BattleCatalog }, host: GameSessionRuntime, seed: number, fade?: FieldFadeState): GameSession {
    assertFrameworkNewGameBindings(input.content, input.world, input.map, input.battle);
    const state = GameState.createNewGame(input.battle.gameState, input.battle.common.players,
      input.battle.contentHash, input.battle.common.conditions);
    const prepared = prepareFrameworkNewGameField(input.content, input.world, input.map, input.battle, state);
    const events = new EventState(prepared.fresh.events); events.clearMap(input.map.mapId);
    const presentation = createSourcePresentationContext({ kind: "title-new-game",
      titleCleanupComplete: true, openingCallbackStarted: false });
    const game = new GameSession(prepared.field, input.battle, seed, host,
      { content: input.content, state, events, map: input.map, presentation, ...(fade ? { fade } : {}) });
    game.field.startMapEntry(input.map.initializer ?? null);
    game.setBattlePreferences(prepared.fresh.battlePreferences);
    return game;
  }
  newGamePreparation(fieldUiReady: boolean): NewGameFieldPreparation {
    const fresh = this.freshEntry;
    if (!fresh || fresh.launched || !fieldUiReady || !this.field.player.native || !this.field.cameraSnapshot)
      throw new Error("Fresh game field/UI preparation is incomplete");
    return { kind: "source-new-game-field-prepared-v1", mapId: fresh.content.entry.mapId,
      entrance: fresh.content.entry.entrance, reservedScriptName: fresh.content.entry.reservedScript.name,
      firstLoad: true, mapLoadComplete: true, mapSetupComplete: true, mapViewSetupComplete: true,
      firstFieldSceneInitialized: true, fieldUiReady: true };
  }
  launchNewGame(launch: NewGameFieldLaunch): void {
    const fresh = this.freshEntry;
    if (!fresh || fresh.launched) throw new Error("No pending fresh game launch");
    validateSourceNewGameLaunch(fresh.content, launch);
    if (canonical(launch.fade.snapshot()) !== canonical(this.field.fader.snapshot()) ||
        canonical(launch.sourcePresentation) !== canonical(this.field.sourcePresentationContext))
      throw new Error("Fresh game lost the prepared title fade/presentation owner");
    this.field.startMapEntry(launch.scriptName);
    fresh.launched = true;
  }
  constructor(
    field: FieldContent,
    readonly battleCatalog: BattleCatalog,
    readonly seed = 20261010,
    runtime: GameSessionRuntime = {},
    fresh?: FreshSession,
  ) {
    checkpointInteger(seed, 0, 0xffffffff);
    validateBattleEventConditions(runtime.battleEventConditions);
    this.battleEventConditions = runtime.battleEventConditions;
    if(runtime.battleGauInstances!==undefined&&(runtime.battleGauInstances.policy!==WEB_BATTLE_GAU_INSTANCES||typeof runtime.battleGauInstances.prepare!=="function"))throw new Error("Unknown source Gau media runtime");
    this.#battleGauRuntime=runtime.battleGauInstances;
    this.#battleChildAdmission=runtime.battleChildPartyAdmission===undefined?undefined:parseWebBattleChildAdmission(runtime.battleChildPartyAdmission);
    validateScriptedBattleActionPolicy(runtime.scriptedBattleActions);
    this.scriptedBattleActions=runtime.scriptedBattleActions;
    validateBattleBranchExecutionPolicy(runtime.battleBranchExecution);this.battleBranchExecution=runtime.battleBranchExecution;
    if(runtime.battleGlobalFade!==undefined&&runtime.battleGlobalFade!==WEB_BATTLE_GLOBAL_FADE)throw new Error("Unknown battle global fade policy");
    this.battleGlobalFade=runtime.battleGlobalFade;
    validateBattleEventControls(runtime.battleEventControls);
    this.battleEventControls = runtime.battleEventControls;
    if(runtime.battleEventEffects!==undefined&&runtime.battleEventEffects!==WEB_BATTLE_EVENT_EFFECTS&&(runtime.battleEventEffects.policy!==WEB_BATTLE_EVENT_EFFECTS||typeof runtime.battleEventEffects.prepare!=='function'))throw new Error('Unknown session battle effect host');
    this.#battleEffectRuntime=runtime.battleEventEffects===WEB_BATTLE_EVENT_EFFECTS?createWebBattleEventEffectHost():runtime.battleEventEffects;
    if (runtime.battleEventMessages !== undefined && runtime.battleEventMessages !== WEB_BATTLE_EVENT_MESSAGE_POLICY)
      throw new Error("Unknown battle event message policy");
    this.#battleMessageRuntime = runtime.battleEventMessages === WEB_BATTLE_EVENT_MESSAGE_POLICY && runtime.sourceMessageSequence
      ? Object.freeze({ sequence: runtime.sourceMessageSequence }) : null;
    if (runtime.battleHandoff !== undefined && runtime.battleHandoff !== "prepared")
      throw new Error("Invalid session battle handoff mode");
    if (runtime.assignedNpcRoutes !== undefined && runtime.assignedNpcRoutes !== 'web-assigned-npc-route-grid-v1')
      throw new Error('Unknown assigned NPC route policy');
    if (runtime.sourceEncounterPolicy !== undefined && runtime.sourceEncounterPolicy !== WEB_SOURCE_ENCOUNTER_POLICY)
      throw new Error("Unknown source encounter runtime policy");
    if(runtime.sourceCharacterNaming!==undefined&&runtime.sourceCharacterNaming!==WEB_SOURCE_CHARACTER_NAMING)throw Error("Unknown source character naming runtime");
    validateRtsPolicy(runtime.rtsPartySwitch);
    if(runtime.sourcePartySelection!==undefined&&runtime.sourcePartySelection!==WEB_SOURCE_PARTY_SELECTION)throw new Error('Unknown source party selection policy');
    if(runtime.sourceBossEntry!==undefined&&runtime.sourceBossEntry!==WEB_SOURCE_BOSS_ENTRY)throw new Error('Unknown source Boss policy');
    if(runtime.sourceBattleResult!==undefined&&runtime.sourceBattleResult!==WEB_COMMITTED_BATTLE_RESULT)throw new Error('Unknown committed result policy');
    validateRetainedWorldTransportationPolicy(runtime.retainedWorldTransportation);
    if (runtime.scriptRandom !== undefined && runtime.scriptRandom !== WEB_SOURCE_SCRIPT_RANDOM)
      throw new Error("Unknown source script random policy");
    this.preparedBattleHandoff = runtime.battleHandoff === "prepared";
    this.walkEncounters = new WalkEncounterState(seed);
    this.currentBattlePreferences = parseBattlePreferences(battleCatalog.common.timing);
    if (!fresh && field.sourceSetHash !== battleCatalog.common.fieldSourceSetHash)
      throw new Error("Field/battle source mismatch");
    if (fresh && (fresh.content.sourceSetHash !== field.sourceSetHash ||
        fresh.content.battleCatalogHash !== battleCatalog.contentHash || fresh.state.catalogHash !== battleCatalog.contentHash))
      throw new Error("Fresh field/battle content binding mismatch");
    this.state = fresh?.state ?? new GameState(
      battleCatalog.gameState,
      battleCatalog.common.players,
      battleCatalog.contentHash,
      battleCatalog.common.conditions,
    );
    const initialEvents = fresh?.events ?? new EventState();
    const seeded = new Set<string>();
    for (const { ref, value } of fresh ? [] : field.entry.initialEventValues ?? []) {
      const identity = `${ref.category}:${ref.index}`;
      if (seeded.has(identity)) throw new Error("Duplicate source checkpoint event seed");
      seeded.add(identity);
      initialEvents.write(ref, value);
    }
    const messageFees = battleCatalog.common.sourceMessageFees && parseSourceMessageFeeCatalog(battleCatalog.common.sourceMessageFees);
    const { battleChildPartyAdmission:childAdmissionPolicy, battleGauInstances:gauMedia, battleEventConditions: battleConditionsPolicy, battleGlobalFade:fadePolicy, battleBranchExecution: branchPolicy, battleEventEffects: battleEffectsHost, battleEventControls: battleControlsPolicy, battleEventMessages: battleMessagesPolicy, scriptRandom: scriptRandomPolicy, sourceBattleResult: resultPolicy, scriptedBattleActions: scriptActionsPolicy, ...fieldRuntime } = runtime;
    this.world = new WorldSession(field, initialEvents, {
      current: {
        ...fieldRuntime,
        reservedScripts: this.fieldReservationPort,
        ...(runtime.sourceEncounterPolicy === undefined ? {} : { sourceEncounter: {
          policy: WEB_SOURCE_ENCOUNTER_POLICY,
          prepare: (command: import("./source-encounter.js").SourceEncounterCommand) => {
            const serial = this.encounterSerial;
            const selection = selectWebSourceEncounter(command, this.seed, serial);
            return { selection, validate: () => {
              if (this.encounterSerial !== serial) throw new Error("Stale source encounter session serial");
            } };
          },
        } }),
        ...(runtime.sourceBattleResult===undefined?{}:{sourceBattleResult:{policy:WEB_COMMITTED_BATTLE_RESULT,prepare:()=>this.prepareCommittedBattleResult()}}),
        ...(fresh ? { nativeActorPreparation: true,
          sourcePresentation: { context: () => structuredClone(fresh.presentation) } } : {}),
        ...(battleCatalog.common.battleEntry ? { contentInvalidations: {
          catalogHash: battleCatalog.contentHash, catalog: battleCatalog.common.battleEntry } } : {}),
        ...(messageFees ? { messageFees } : {}),
        puppetRoster: this.state.fieldPuppetRoster,
        inventory: this.state.fieldInventory,
        messageNames: this.state.fieldMessageNames,
        treasure: this.state.fieldTreasure,
        party: this.state.fieldParty,
        sourcePartySelectionPort: this.state.fieldSourcePartySelection,
        characterNamingPort:this.state.fieldCharacterNaming,
        roster: this.state.fieldRoster,
        rtsParty:this.state.fieldRtsParty,
        ownedConditions: this.state.fieldOwnedConditions,
        recovery: this.state.fieldRecovery,
        ...(scriptRandomPolicy === WEB_SOURCE_SCRIPT_RANDOM ? { scriptRandom: this.state.fieldScriptRandom } : {}),
        ...(this.state.fieldTransportation ? { transportation: this.state.fieldTransportation } : {}),
        shop: this.state.fieldShop,
        walkEncounters: {
          assertPolicy: (mapId, policy) => this.walkEncounters.assertPolicy(mapId, policy),
          prepareStep: (mapId, policy) => this.walkEncounters.prepareStep(mapId, policy),
        },
        ...(battleCatalog.gameState.fieldConditions ? { fieldSteps: this.state.fieldSteps } : {}),
        ...(this.state.fieldPartyAppearance ? { partyAppearance: this.state.fieldPartyAppearance } : {}),
        movementBlocker: (transportationId, manual) => this.state.fieldMoveBlocker(transportationId, manual),
      },
      prepare: () => this.state.prepareFieldState(scriptRandomPolicy === undefined ? {} : { scriptRandom: scriptRandomPolicy }),
      nativeState: () => this.state.nativeState,
    }, fresh?.fade, fresh?.restoring === true, fresh ? {
      catalogHash: fresh.content.worldCatalogHash,
      ...(fresh.content.developmentProfile ? { developmentProfile: fresh.content.developmentProfile } : {}),
    } : undefined);
    if (fresh) {
      if (fresh.content.kind === "framework-new-game-content-v1") {
        if (!fresh.restoring) installFrameworkNewGameActors(this.field, fresh.content, this.state, fresh.map);
        this.initializedEntry = structuredClone(fresh.content);
      } else {
        if (!fresh.restoring) installSourceNewGameActors(this.field, fresh.content, this.state, fresh.map);
        this.freshEntry = { content: structuredClone(fresh.content), launched: fresh.restoring === true };
      }
    }
  }
  prepareCommittedBattleResult(): ReturnType<import('./source-battle-result.js').FieldBattleResultPort['prepare']> {
    const serial=this.encounterSerial,project=()=>projectCommittedBattleResult(this.state.snapshot(),this.encounterSerial);
    const validateAvailable=()=>{if(this.field.stop?.kind==='encounter'||this.battle||this.battleEntry||this.battleLease||this.state.inBattle||this.pendingBattleHandoff||this.battleHandoffPreparing)throw new Error('Current battle result is uncommitted or unavailable');};
    validateAvailable();const facts=project(),identity=canonical(facts);
    return Object.freeze({...facts,validate:()=>{validateAvailable();if(this.encounterSerial!==serial||canonical(project())!==identity)throw new Error('Stale committed battle result identity');}});
  }
  get battlePreferences(): BattlePreferences {
    return { ...this.currentBattlePreferences };
  }
  setBattlePreferences(value: BattlePreferences): void {
    const next = parseBattlePreferences(value);
    this.battle?.setPreferences(next);
    this.currentBattlePreferences = next;
  }
  private get fieldOwnerReady(): boolean {
    return (
      !this.battle &&
      !this.battleLease &&
      !this.state.inBattle &&
      (!this.freshEntry || this.freshEntry.launched)
    );
  }
  get menuReady(): boolean { return this.fieldOwnerReady && this.field.menuReady; }
  get checkpointReady(): boolean { return this.fieldOwnerReady && this.field.checkpointReady; }
  get eventSaveRequest(): GameEventSaveRequest | null {
    return this.fieldOwnerReady ? this.field.eventSaveRequest : null;
  }
  partyMenu() {
    const owned = this.state.snapshot(), model = projectPartyMenu(owned.party, owned.roster);
    // Future group dependencies affect selection, not editing its held cells.
    // Reads never create an actor candidate or acquire a battle lease.
    if (this.menuReady) for (const slot of model.slots) {
      if (slot.blocker) continue;
      try { this.requirePartyMenuBattleDependencies(this.state.partyPlayers({ ...owned.party, selectedSlot: slot.index })); }
      catch (error) { slot.blocker = error instanceof Error ? error.message : String(error); }
    }
    const blocker = model.blocker ?? (!this.menuReady ? "请在地图空闲时调整编队。" : this.field.partyMenuBlocker);
    return { ...model, blocker, editable: blocker === null };
  }
  /** Check the selected participants using the same owned projection and pure
   * qualification/media contracts as battle entry. This chooses no encounter,
   * runs no AI/action and does not grant a missing source capability. */
  private requirePartyMenuBattleDependencies(players: readonly Combatant[]): void {
    const common = this.battleCatalog.common, owned = this.state.snapshot(), system = this.battleCatalog.gameState.equipmentSystem;
    let context = common.qualificationContext;
    if (context?.mode === "source" && common.battleEntry) {
      const field = this.field.projectBattleInvalidContents(common.battleEntry,
        this.battleCatalog.gameState.fieldConditions?.transportations ?? []);
      if (field.invalidContentIds === null || field.blockers.length)
        throw new Error(field.blockers.join("; ") || "Unknown battle field exclusions");
      context = { ...context, invalidContentIds: field.invalidContentIds, conditionContext: "current" };
    }
    const blocker = battleDefinitionBlocker(players, context, common.conditions);
    if (blocker) throw new Error(blocker);
    const conditions = new BattleConditions(common.conditions);
    battleUnitMediaUrls(common, players);
    for (const player of players) {
      conditions.validateActive(player.conditionIds); conditions.validateResistances(player.conditionResistances);
      const member = owned.roster.find(member => member.id === player.id);
      if (!member || !member.enabled || player.side !== "player" || player.sourceId !== member.sourceId)
        throw new Error("Party menu requires an enabled owned battle participant");
      let supported = false;
      if (context?.mode === "source") {
        if (!common.battleAbilities || !player.ownedAbilities)
          throw new Error("Source party member lacks owned battle command bindings");
        const equipment=this.state.currentEquipmentCatalog;
        const passives = equipment ? equipmentOwnedAbilities(equipment, member) : [];
        const inventory = equipment && common.battleEntry ? projectBattleItemMenu(common.battleEntry, {
          sourceId: member.sourceId, equipment: member.equipment,
          inventory: [...owned.items.map(item => ({ ...item, equipped: 0 })),
            ...equipmentAvailability(equipment, owned.roster.filter(member => member.enabled), owned.equipmentStock)],
        }, equipment) : null;
        const jobs=this.state.battleJobQualification;jobs.validateCatalog(common.battleAbilities,this.battleCatalog.contentHash);
        const qualification = projectBattleAbilities(common.battleAbilities, player.ownedAbilities, {
          conditionIds: context.conditionContext === "current" ? player.conditionIds : null,
          battleType: context.battleType, magicLearningValue: player.magicLearningValue ?? context.magicLearningValue,
          invalidContentIds: context.invalidContentIds, itemMenuAvailable: inventory?.available ?? null,
          partySize: players.length,
        }, passives,jobs);
        // A known temporary source exclusion is different from an unresolved
        // provider. Unknown optional skills remain visible in the existing menu.
        supported = qualification.entries.some(entry => entry.released !== null && entry.available !== null &&
          entry.blockers.length === 0 && common.commands[entry.commandId]?.kind === "ability" &&
          entry.abilityIds.some(id => common.abilities[id]?.plan !== null && common.abilities[id]?.plan !== undefined));
        if (!supported && qualification.blockers.length)
          throw new Error(`角色 ${player.name} 的战斗命令依赖尚未接入：${qualification.blockers.join("; ")}`);
      } else {
        for (const id of player.commands) if (!common.commands[id]) throw new Error("Unknown party member battle command: " + id);
        supported = player.commands.some(id => common.commands[id]?.kind === "ability" &&
          common.commands[id]!.abilityIds.some(abilityId => player.abilities.includes(abilityId) && common.abilities[abilityId]?.plan));
      }
      if (!supported) throw new Error(`角色 ${player.name} 没有已接入的战斗命令`);
    }
  }
  characterMenu(id: string) {
    const member = this.state.snapshot().roster.find((candidate) => candidate.id === id);
    if (!member) throw new Error("Character menu references an unowned member");
    const content = this.battleCatalog.gameState;
    return { ...projectCharacterMenu(member, {
      growth: this.state.characterGrowthPlan(id),
      developmentExperience: this.battleCatalog.common.experience,
      abilities: this.battleCatalog.common.abilities,
      commands: this.battleCatalog.common.commands,
      equipmentAbilities: this.state.currentEquipmentCatalog ? equipmentOwnedAbilities(this.state.currentEquipmentCatalog, member) : [],
    }), magicLearningValue: content.characterInitializations?.[id] ? member.magicLearningValue : null };
  }
  get currentCharacterNaming(){return this.fieldOwnerReady?this.field.currentCharacterNaming:null;}
  submitCharacterName(token:object,value:string,stillAdmitted:()=>boolean=()=>true):boolean {
    const field=this.field,admitted=()=>this.field===field&&this.fieldOwnerReady&&stillAdmitted();
    return admitted()?field.submitCharacterName(token,value,admitted):false;
  }
  confirmCharacterName(token:object,accepted:boolean,stillAdmitted:()=>boolean=()=>true):boolean {
    const field=this.field,admitted=()=>this.field===field&&this.fieldOwnerReady&&stillAdmitted();
    return admitted()?field.confirmCharacterName(token,accepted,admitted):false;
  }
  get currentSourcePartySelection(){return this.fieldOwnerReady?this.field.currentSourcePartySelection:null;}
  completeSourcePartySelection(token:object,outcome:SourcePartySelectionOutcome,stillAdmitted:()=>boolean=()=>true):boolean {
    const field=this.field;
    const admitted=()=>this.field===field&&this.fieldOwnerReady&&stillAdmitted();
    return admitted()?field.completeSourcePartySelection(token,outcome,admitted):false;
  }
  changeParty(request: PartyMenuRequest, stillAdmitted?: () => boolean): boolean {
    if (stillAdmitted !== undefined && typeof stillAdmitted !== "function")
      throw new Error("Invalid party menu admission predicate");
    if (!this.menuReady || stillAdmitted !== undefined && stillAdmitted() !== true) return false;
    const field = this.field, transaction = this.state.preparePartyMenu(request);
    if (!transaction.changed) return false;
    const checkParticipants = transaction.activeChanged && (request.change.kind === "set-member" || request.change.kind === "select-slot");
    if (checkParticipants) this.requirePartyMenuBattleDependencies(transaction.candidatePlayers);
    const publish = field.prepareMenuPartyAppearance(transaction.appearance);
    // Both owners finish fallible preparation before either is published. The
    // existing renderer publication writes prepared state without owned reads.
    publish.validate();
    if (this.field !== field || !this.menuReady) throw new Error("Field changed during party menu preparation");
    transaction.validate();
    if (checkParticipants) this.requirePartyMenuBattleDependencies(transaction.candidatePlayers);
    // A fallible appearance provider may synchronously replace the Flow owner,
    // return to title or revoke host readiness. Recheck before either publish.
    if (stillAdmitted !== undefined && stillAdmitted() !== true) return false;
    transaction.commitWith(() => publish(() => {
      if (this.field !== field || !this.menuReady || stillAdmitted !== undefined && stillAdmitted() !== true)
        throw new Error("Party menu owner or host changed before publication");
    }));
    return true;
  }
  useMenuItem(id: number, targetId: string): boolean {
    if (!this.menuReady) return false;
    return this.state.useMenuItem(id, targetId);
  }
  private fieldAbilityContext(): FieldAbilityContext {
    const entry = this.battleCatalog.common.battleEntry;
    if (!entry) return { invalidContentIds: null };
    const field = this.field.projectBattleInvalidContents(entry,
      this.battleCatalog.gameState.fieldConditions?.transportations ?? []);
    return { invalidContentIds: field.blockers.length ? null : field.invalidContentIds };
  }
  menuAbilities(actorId: string) {
    return this.menuReady ? this.state.menuAbilities(actorId, this.fieldAbilityContext()) : [];
  }
  menuAbilityTargets(actorId: string, abilityId: number) {
    return this.menuReady ? this.state.menuAbilityTargets(actorId, abilityId, this.fieldAbilityContext()) : [];
  }
  useMenuAbility(request: FieldAbilityRequest, stillAdmitted?: () => boolean): boolean {
    if (stillAdmitted !== undefined && typeof stillAdmitted !== "function")
      throw new Error("Invalid field ability admission predicate");
    if (!this.menuReady || stillAdmitted !== undefined && stillAdmitted() !== true) return false;
    const field = this.field, context = this.fieldAbilityContext(), baseline = canonical(context);
    const transaction = this.state.prepareFieldAbility(request, context);
    if (!transaction) return false;
    if (transaction.appearanceChanged && !transaction.appearance)
      throw new Error("Field ability condition appearance is unavailable");
    const publish = transaction.appearance ? field.prepareMenuPartyAppearance(transaction.appearance) : undefined;
    publish?.validate();
    if (this.field !== field || !this.menuReady || canonical(this.fieldAbilityContext()) !== baseline)
      throw new Error("Field ability context changed during preparation");
    transaction.validate();
    if (stillAdmitted !== undefined && stillAdmitted() !== true) return false;
    transaction.commitWith(() => publish?.(() => {
      if (this.field !== field || !this.menuReady || canonical(this.fieldAbilityContext()) !== baseline ||
          stillAdmitted !== undefined && stillAdmitted() !== true)
        throw new Error("Field ability owner, context or host changed before publication");
    }));
    return true;
  }
  changeEquipment(playerId: string, slot: number, contentId: number): boolean {
    if (!this.menuReady) return false;
    return this.state.changeEquipment(playerId, slot, contentId);
  }
  magicStoneMenu(playerId: string) { return this.state.magicStoneMenu(playerId); }
  changeMagicStone(playerId: string, contentId: number, stillAdmitted?: () => boolean): boolean {
    if (!this.menuReady || stillAdmitted !== undefined && stillAdmitted() !== true) return false;
    const field = this.field, transaction = this.state.prepareMagicStoneMenu(playerId, contentId);
    if (!transaction) return false;
    transaction.validate();
    if (this.field !== field || !this.menuReady || stillAdmitted !== undefined && stillAdmitted() !== true) return false;
    transaction.commit();
    return true;
  }
  private requireShop() {
    const shop = this.field.currentShop;
    if (this.battle || this.battleLease || this.state.inBattle || this.field.stop || !shop)
      throw new Error("No ordinary shop is open");
    return shop;
  }
  shopOptions() {
    return this.state.shopOptions(this.requireShop().groupId);
  }
  tradeShop(request: ShopTradeRequest) {
    const shop = this.requireShop(), field = this.field;
    const transaction = this.state.prepareShopTrade(shop.groupId, request);
    const current = this.requireShop();
    if (this.field !== field || current.id !== shop.id || current.groupId !== shop.groupId)
      throw new Error("Shop changed before trade confirmation");
    transaction.commit();
    return transaction.plan;
  }
  closeShop(expectedVisitId?: number): boolean {
    if (this.battle || this.battleLease || this.state.inBattle) return false;
    return this.field.closeShop(expectedVisitId);
  }
  checkpoint(): GameCheckpoint {
    if (!this.checkpointReady)
      throw new Error("Cannot save during battle, movement or an event");
    return this.captureCheckpoint(this.world.checkpoint());
  }
  private captureCheckpoint(world: WorldCheckpoint): GameCheckpoint {
    const value: GameCheckpointBase & {formatVersion: 5|6; walkEncounters: WalkEncounterSnapshot} = {
      formatVersion: this.initializedEntry ? 6 as const : 5 as const,
      kind: "game-checkpoint",
      sourceSetHash: this.field.content.parentSourceSetHash,
      battleCatalogHash: this.battleCatalog.contentHash,
      origin: this.freshEntry ? { kind: "source-new-game", sourceContentHash: this.freshEntry.content.contentHash }
        : this.initializedEntry ? { kind: "framework-new-game", entryContentHash: this.initializedEntry.contentHash }
        : { kind: "development-checkpoint" },
      seed: this.seed,
      encounterSerial: this.encounterSerial,
      remainder: this.remainder,
      battlePreferences: this.battlePreferences,
      walkEncounters: this.walkEncounters.snapshot(),
      owned: this.state.snapshot(),
      world,
    };
    if (this.fieldReservation) {
      reservationFingerprint(this.field.content, this.fieldReservation.script);
      return { ...value, formatVersion: this.fieldReservation.kind==='source-rts-field-reservation-v1'?(this.initializedEntry?10:9):(this.initializedEntry ? 8 : 7), fieldReservation: this.reservedFieldScript! };
    }
    return value;
  }
  /** Storage and UI never serialize the VM themselves. The private candidate
   * contains the state after a successful ACK, before any following opcode. */
  prepareEventSave(request: GameEventSaveRequest): PreparedGameEventSave {
    const field = this.field;
    const capture = (): GameCheckpoint => {
      if (!this.fieldOwnerReady || this.field !== field || this.eventSaveRequest !== request)
        throw new Error("Stale event save owner or request");
      return this.captureCheckpoint(this.world.eventCheckpoint(request));
    };
    const checkpoint = capture(), identity = canonical(checkpoint);
    let status: "prepared" | "committing" | "consumed" = "prepared";
    const validateLive = (): void => {
      if (canonical(checkpoint) !== identity || canonical(capture()) !== identity)
        throw new Error("Event save state changed during preparation");
    };
    const validate = (): void => {
      if (status !== "prepared") throw new Error("Event save preparation is already consumed");
      validateLive();
    };
    return Object.freeze({ checkpoint, validate,
      commitWith: (write: () => void): void => {
        if (typeof write !== "function") throw new Error("Event save requires a synchronous writer");
        validate(); status = "committing";
        try {
          write();
          // A throwing callback before write succeeds is retryable. Once it
          // returns, any owner/ACK failure is fatal to the host, not a retry.
          validateLive();
          field.acknowledgeEventSave(request);
        } finally { status = "consumed"; }
      },
      discard: (): void => { if (status === "prepared") status = "consumed"; },
    });
  }
  static restore(
    raw: GameCheckpoint,
    initial: FieldContent | undefined,
    battle: BattleCatalog,
    world?: GameRestoreWorld,
    runtime: GameSessionRuntime = {},
  ): GameSession {
    const s = structuredClone(raw);
    if (s.formatVersion !== 4 && s.formatVersion !== 5 && s.formatVersion !== 6 && s.formatVersion !== 7 && s.formatVersion !== 8 && s.formatVersion !== 9 && s.formatVersion !== 10) throw new Error("Game checkpoint source/version mismatch");
    checkpointKeys(
      s,
      "formatVersion,kind,sourceSetHash,battleCatalogHash,origin,seed,encounterSerial,remainder,battlePreferences,owned,world" +
        (s.formatVersion === 4 ? "" : ",walkEncounters") + (s.formatVersion === 7 || s.formatVersion === 8 || s.formatVersion === 9 || s.formatVersion === 10 ? ",fieldReservation" : ""),
    );
    if (
      (s.formatVersion !== 4 && s.formatVersion !== 5 && s.formatVersion !== 6 && s.formatVersion !== 7 && s.formatVersion !== 8 && s.formatVersion !== 9 && s.formatVersion !== 10) ||
      s.kind !== "game-checkpoint" ||
      s.battleCatalogHash !== battle.contentHash
    )
      throw new Error("Game checkpoint source/version mismatch");
    checkpointInteger(s.seed, 0, 0xffffffff);
    checkpointInteger(s.encounterSerial);
    checkpointNumber(s.remainder, 0, 10);
    if (s.remainder >= 10) throw new Error("Invalid session remainder");
    if ((s.formatVersion === 6 || s.formatVersion === 8 || s.formatVersion === 10) !== (s.origin?.kind === "framework-new-game"))
      throw new Error("Checkpoint initialization version/origin mismatch");
    let next: GameSession;
    if (s.origin?.kind === "framework-new-game") {
      checkpointKeys(s.origin, "kind,entryContentHash");
      const initialized = world?.initialized;
      if (!world || !initialized || world.source || initialized.content.contentHash !== s.origin.entryContentHash ||
          initialized.content.contentHash !== s.world.initialHash ||
          initialized.content.parentSourceSetHash !== s.sourceSetHash || s.owned.initialization !== "source-new-game")
        throw new Error("Framework new-game restore requires its trusted initializer/world dependencies");
      assertFrameworkNewGameBindings(initialized.content, world.catalog, initialized.initialMap, battle);
      assertSourceEntryProfiles(initialized.content, world.catalog, initialized.initialMap, world.map);
      const state = GameState.createNewGame(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
      const fade = s.world.field.fade === null ? undefined : FieldFadeState.restore(s.world.field.fade);
      const prepared = prepareFrameworkNewGameField(initialized.content, world.catalog, initialized.initialMap, battle, state,
        fade?.projection ?? undefined);
      const presentation = createSourcePresentationContext({ kind: "title-new-game",
        titleCleanupComplete: true, openingCallbackStarted: false });
      next = new GameSession(prepared.field, battle, s.seed, runtime, { content: initialized.content, state,
        events: new EventState(s.world.field.eventState), map: initialized.initialMap,
        ...(fade ? { fade } : {}), presentation, restoring: true });
    } else if (s.origin?.kind === "source-new-game") {
      checkpointKeys(s.origin, "kind,sourceContentHash");
      const source = world?.source;
      if (!source || !world || source.content.contentHash !== s.origin.sourceContentHash ||
          source.content.contentHash !== s.world.initialHash ||
          source.content.parentSourceSetHash !== s.sourceSetHash || s.owned.initialization !== "source-new-game")
        throw new Error("Source new-game restore requires trusted native actor/world checkpoint dependencies");
      assertSourceGameCatalog(battle, assertSourceEntryProfiles(source.content, world.catalog, source.initialMap, world.map));
      // A source checkpoint depends on its trusted entry map, never a legacy
      // opening field supplied by an older caller. Reject effect publication
      // before creating any native actor or external host during restoration.
      const map = source.initialMap.map;
      if (map && !(source.content.developmentProfile?.logicalFieldEffects === WEB_LOGICAL_FIELD_EFFECTS &&
            runtime.fieldEffects?.policy === WEB_LOGICAL_FIELD_EFFECTS) &&
          (map.entities.some((entity) => entity.kind === 11) ||
          Object.values(map.groups ?? {}).some((group) => group.entities.some((entity) => entity.kind === 11))))
        throw new Error("Field effect particle/RNG checkpoint codec is unresolved");
      if (s.world.field.fade === null) throw new Error("Source new-game checkpoint cannot discard the title fade host");
      const state = GameState.createNewGame(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
      const fade = FieldFadeState.restore(s.world.field.fade);
      // The pristine initializer proves the route and immutable actor inventory.
      // It is a private data projection only: no event, factory or Look is run.
      const prepared = prepareSourceNewGameField(source.content, world.catalog, source.initialMap, battle, state, fade.projection ?? undefined);
      const presentation = createSourcePresentationContext({ kind: "title-new-game",
        titleCleanupComplete: true, openingCallbackStarted: false });
      next = new GameSession(prepared.field, battle, s.seed, runtime, { content: source.content, state,
        events: new EventState(s.world.field.eventState), map: source.initialMap, fade, presentation, restoring: true });
    } else {
      checkpointKeys(s.origin, "kind");
      if (s.origin.kind !== "development-checkpoint" || s.owned.initialization !== "development-checkpoint")
        throw new Error("Checkpoint initialization origin mismatch");
      if (!initial || s.sourceSetHash !== initial.parentSourceSetHash)
        throw new Error("Game checkpoint source/version mismatch: development initial content is required");
      if (initial.map.entities.some((entity) => entity.kind === 11) ||
          Object.values(initial.map.groups ?? {}).some((group) => group.entities.some((entity) => entity.kind === 11)))
        throw new Error("Field effect particle/RNG checkpoint codec is unresolved");
      next = new GameSession(initial, battle, s.seed, runtime);
    }
    next.setBattlePreferences(s.battlePreferences);
    next.state.restore(s.owned);
    if (s.encounterSerial !== s.owned.completedBattles.length)
      throw new Error("Saved encounter sequence disagrees with settled battles");
    next.world.restore(s.world, world?.catalog, world?.map,
      s.origin.kind === "source-new-game" ? world!.source : s.origin.kind === "framework-new-game" ? world!.initialized : undefined,
      world?.timerOrigin);
    if (s.formatVersion !== 4) next.walkEncounters.restore(s.walkEncounters);
    else if (initial?.walkEncounters || next.field.content.walkEncounters)
      throw new Error("Legacy checkpoint has no walking encounter state");
    const walkMapId = next.field.content.map.identity?.mapId;
    if (walkMapId !== undefined)
      next.walkEncounters.assertPolicy(walkMapId, next.field.content.walkEncounters ?? null);
    else if (next.field.content.walkEncounters || s.formatVersion !== 4 && s.walkEncounters.maps.length)
      throw new Error("Saved walking encounters require a bound current map identity");
    if (s.formatVersion === 7 || s.formatVersion === 8 || s.formatVersion === 9 || s.formatVersion === 10) {
      const queued = s.formatVersion===9||s.formatVersion===10?parseRtsFieldReservation(s.fieldReservation):parseFieldReservation(s.fieldReservation);
      if((s.formatVersion===9||s.formatVersion===10)!==(queued.kind==='source-rts-field-reservation-v1'))throw Error('RTS reservation checkpoint version mismatch');
      if(queued.kind==='source-rts-field-reservation-v1'&&next.field.rtsPolicy!==WEB_RTS_PARTY_SWITCH)throw Error('Saved RTS reservation cannot grant its runtime/content owner');
      if (queued.parentSourceSetHash !== next.field.content.parentSourceSetHash)
        throw new Error('Saved field reservation source domain changed');
      reservationFingerprint(next.field.content, queued.script);
      next.fieldReservation = queued;
    }
    next.encounterSerial = s.encounterSerial;
    next.remainder = s.remainder;
    return next;
  }
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      throw new Error("Invalid session elapsed time");
    if (this.battleHandoffPreparing || this.pendingBattleHandoff ||
        this.preparedBattleHandoff && !this.battle && this.field.stop?.kind === "encounter") {
      this.remainder = 0;
      return;
    }
    if (this.eventSaveRequest || this.encounterPreparationError) return;
    this.remainder += ms;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.eventSaveRequest) continue;
      if (this.battle) {
        if (!this.field.soundReady) continue;
        this.field.advanceStoryTimer(10, "battle");
        this.field.bgm.advance(10, this.field.content.bgm);
        this.field.environment.advance(10, this.field.content.environment);
        this.field.se.advance(10, this.field.content.se);
        this.battle.advance(10);
        continue;
      }
      this.field.advance(10);
      if (this.field.stop?.kind === "encounter") {
        if (this.preparedBattleHandoff) { this.remainder = 0; return; }
        this.startEncounter();
      }
      if (this.encounterPreparationError) { this.remainder = 0; return; }
    }
  }
  /** A selected ordinary encounter survives preparation failure. Retrying it
   * does not walk again, draw another enemy, or acquire a second battle lease. */
  get encounterPreparationError(): string | null {
    const failed = this.encounterFailure;
    return failed && failed.request === this.field.stop ? failed.message : null;
  }
  retryEncounterPreparation(): boolean {
    if (this.preparedBattleHandoff) return false;
    if (!this.encounterPreparationError || this.battle || this.battleLease || this.state.inBattle) return false;
    this.encounterFailure = null;
    this.startEncounter();
    return this.battle !== null;
  }
  get battleStartRequest(): SessionBattleRequest | null {
    const request = this.field.stop;
    return !this.battle && isBattleRequest(request) ? structuredClone(request) : null;
  }
  get battleReturnRequest(): SessionBattleReturnRequest | null {
    const request = this.field.stop;
    if (!isBattleRequest(request)) return null;
    const outcome = this.battle?.previewVictory() ? "victory" : this.battle?.previewEscape() ? "escaped" : this.battle?.previewForcedReturn() ? "forced" : null;
    return outcome === null ? null : { outcome, request: structuredClone(request) };
  }
  private fieldBattleFingerprint(field: FieldGame): string {
    return canonical({ request: field.stop, contentInvalidations: field.contentInvalidationsSnapshot, events: field.eventState.snapshot(), entry: field.battleEntryContext.state,
      time: field.time, fade: field.fader.snapshot(), effects: field.fieldEffectsSnapshot,
      message: field.sourceMessage.snapshot(), messageRevision: field.sourceMessage.mutationRevision });
  }
  private rememberEncounterFailure(field: FieldGame, request: SessionBattleRequest, error: unknown): void {
    if (this.field === field && field.stop === request && !this.battle)
      this.encounterFailure = { request, message: error instanceof Error ? error.message : String(error) };
  }
  private createBattleHandoff(
    kind: "start" | "retry" | "return", entry: BattleEntry, isCurrent: () => boolean,
    validateDependencies: () => void, preparePublication: () => ((beginPublication: () => void) => void), cleanup: () => void,
    outcome?: "victory" | "escaped" | "forced", failure?: (error: unknown) => void,
  ): PreparedSessionBattleStart | PreparedSessionBattleReturn {
    const requestView = structuredClone(entry.request), owned = this.state;
    let publicationStarted = false;
    const operation: PendingBattleHandoff = { status: "prepared", discard: () => {} };
    const isPrepared = () => operation.status === "prepared" && this.pendingBattleHandoff === operation;
    const current = () => {
      if (!isPrepared()) return false;
      const same = isCurrent();
      return same && isPrepared();
    };
    const validate = () => {
      if (!current()) throw new StaleSessionBattleHandoff();
      validateDependencies();
      // Read-only actor validators can trigger host cancellation. They never
      // authorize publishing a candidate whose own ticket has since expired.
      if (!current()) throw new StaleSessionBattleHandoff();
    };
    const release = () => {
      if (this.pendingBattleHandoff !== operation) return;
      this.pendingBattleHandoff = null;
      cleanup();
    };
    const discard = () => {
      if (operation.status === "publishing") throw new Error("Battle handoff publication has started");
      if (operation.status !== "prepared") return;
      operation.status = "discarded";
      release();
    };
    operation.discard = discard;
    const commit = (): boolean => {
      if (!isPrepared()) return false;
      if (!current()) { discard(); return false; }
      try {
        validate();
        const publish = preparePublication();
        validate();
        publish(() => {
          // A field commitWith performs its final actor/shared checks before
          // invoking owned publication. Cancellation remains valid through
          // those checks and becomes irreversible immediately before writes.
          if (!current()) throw new StaleSessionBattleHandoff();
          operation.status = "publishing";
          publicationStarted = true;
        });
        if (operation.status !== "publishing") throw new Error("Battle handoff did not publish its owned transaction");
        operation.status = "consumed";
        if (this.pendingBattleHandoff === operation) this.pendingBattleHandoff = null;
        return true;
      } catch (error) {
        if (operation.status === "discarded") return false;
        operation.status = "discarded";
        release();
        if (error instanceof StaleSessionBattleHandoff) return false;
        failure?.(error);
        throw error;
      }
    };
    this.pendingBattleHandoff = operation;
    this.remainder = 0;
    return Object.freeze({ kind, ...(outcome === undefined ? {} : { outcome }),
      get request() { return structuredClone(requestView); },
      get content() { return structuredClone(entry.content); },
      get mediaUrls() {
        if (kind === "return") return [];
        const players = owned.battlePlayers(entry.lease), borrow = owned.battlePlayerBorrow(entry.lease);
        return battleMediaUrls(entry.content, [...players, ...(borrow?.candidates ?? [])]);
      },
      get publicationStarted() { return publicationStarted; }, validate, commit, discard,
    }) as PreparedSessionBattleStart | PreparedSessionBattleReturn;
  }
  private constructBattle(entry: BattleEntry): BattleGame {
    const content = structuredClone(entry.content);
    return new BattleGame(content, entry.seed, this.state.battlePlayers(entry.lease), this.state.battleInventory(entry.lease),
      this.state.battleProgression(entry.lease, content.experience), this.currentBattlePreferences,
      structuredClone(entry.shared), this.state.battlePlayerBorrow(entry.lease),
      { jobQualification:this.state.battleJobQualification,names: this.state.fieldMessageNames,
        ...(this.battleBranchExecution===undefined?{}:{branchExecution:this.battleBranchExecution}),
        ...(entry.gau?{gau:entry.gau}:{}),
        ...(this.#battleChildAdmission?{childPartyAdmission:this.#battleChildAdmission}:{}),
        ...(this.#battleGauRuntime?{gauInstances:{...this.#battleGauRuntime,owned:this.state.battleGauOwnedHost(entry.lease)}}:{}),
        ...(this.battleGlobalFade?{fade:{policy:this.battleGlobalFade,owner:entry.field.fader}}:{}),
        fieldContinuation: entry.reservationHost,
        ...(this.battleEventConditions === undefined ? {} : { conditions: this.battleEventConditions }),
        ...(this.battleEventControls === undefined ? {} : { controls: this.battleEventControls }),
        ...(this.#battleEffectRuntime ? {effects:this.#battleEffectRuntime} : {}),
        ...(this.scriptedBattleActions === undefined ? {} : { scriptedActions: this.scriptedBattleActions }),
        ...(this.#battleMessageRuntime ? { messages: {
          policy: WEB_BATTLE_EVENT_MESSAGE_POLICY, owner: entry.field.sourceMessage,
          sequence: this.#battleMessageRuntime.sequence, names: this.state.fieldMessageNames,
          prepareEffects: effects => entry.field.prepareBattleMessageEffects(effects),
        } satisfies BattleEventMessageHost } : {}),
      });
  }
  prepareBattleStart(): PreparedSessionBattleStart | null {
    const field = this.field, request = field.stop;
    if (!isBattleRequest(request) || this.battle || this.pendingBattleHandoff || this.battleHandoffPreparing) return null;
    if (this.battleLease || this.state.inBattle) throw new Error("Battle start requires an unleased shared owner");
    this.battleHandoffPreparing = true;
    let lease: BattleLease | null = null;
    try {
      const before = this.fieldBattleFingerprint(field);
      const seed = (this.seed + Math.imul(this.encounterSerial, 0x9e3779b1)) >>> 0;
      const sourceEntry = field.prepareSourceEncounterStart(),bossEntry=field.prepareSourceBossEncounterStart();
      const entryContext = sourceEntry?.battleEntryContext ?? field.battleEntryContext;
      const profile = this.initializedEntry ? "framework" : !this.freshEntry ? "development-checkpoint" :
        this.freshEntry.content.developmentProfile ? "framework" : "source";
      // The whole declared probability pool must remain available. Selecting a
      // ready primary cannot hide an unknown secondary or runtime dependency.
      if (sourceEntry) for (const candidate of sourceEncounterCandidates(sourceEntry.request.command)) {
        const candidateContent = encounterContent(this.battleCatalog, candidate.partyId, seed);
        if (!candidateContent) throw new Error(`Source encounter candidate ${candidate.partyId} is unavailable`);
        const candidateHandoff = assessBattleHandoff(candidateContent.handoff, profile);
        if (candidateHandoff.status === "blocked") throw new Error(candidateHandoff.reason);
        let candidateContext = candidateContent.qualificationContext;
        if (candidateContent.battleEntry && candidateContext?.mode === "source") {
          const projected = field.projectBattleInvalidContents(candidateContent.battleEntry,
            this.battleCatalog.gameState.fieldConditions?.transportations ?? [], entryContext.state);
          if (projected.invalidContentIds === null || projected.blockers.length)
            throw new Error(projected.blockers.join("; ") || "Unknown source encounter candidate field exclusions");
          candidateContext = { ...candidateContext, invalidContentIds: projected.invalidContentIds, conditionContext: "current" };
        }
        const candidateBlocker = battleDefinitionBlocker(this.state.partyPlayers(), candidateContext, candidateContent.conditions);
        if (candidateBlocker) throw new Error(candidateBlocker);
      }
      let content = encounterContent(this.battleCatalog, request.party!, seed);
      if (!content) {
        const reasons = this.battleCatalog.encounterDiagnostics
          ?.filter((item) => item.partyId === request.party && item.kind === "blocked")
          .map((item) => `${item.code}: ${item.reason}`) ?? [];
        throw new Error(`Battle content is unavailable for encounter ${request.party}` +
          (reasons.length ? ` (${reasons.join("; ")})` : ""));
      }
      if (content.lifecycle?.mode === "script" && content.lifecycle.program.instructions.some(({ op }) => op.kind === "message") &&
          (field.sourceMessage.active || field.messageWindow !== null || field.choicePending))
        throw new Error("Battle event Msg cannot replace an existing field window or choice at entry");
      if (content.battleEntry && content.qualificationContext?.mode === "source") {
        const projected = field.projectBattleInvalidContents(content.battleEntry,
          this.battleCatalog.gameState.fieldConditions?.transportations ?? [], entryContext.state);
        if (projected.invalidContentIds === null || projected.blockers.length)
          throw new Error(projected.blockers.join("; ") || "Unknown battle field exclusions");
        content = { ...content, qualificationContext: { ...content.qualificationContext,
          invalidContentIds: projected.invalidContentIds, conditionContext: "current" } };
      }
      if (content.escapePolicy && request.returnTo?.kind !== "field-idle") {
        const { escapePolicy: _, ...scripted } = content;
        content = scripted;
      }
      if (sourceEntry && sourceEntry.request.foot.backgroundId !== 0 &&
          sourceEntry.request.foot.backgroundId !== content.handoff?.source.metadata.backgroundId)
        throw new Error("Captured source FootInfo background needs its exact battle asset binding");
      const handoff = assessBattleHandoff(content.handoff, profile);
      if (handoff.status === "blocked") throw new Error(handoff.reason);
      if (this.state.battlePartyBlocker) throw new Error(this.state.battlePartyBlocker);
      const blocker = battleDefinitionBlocker(this.state.partyPlayers(), content.qualificationContext, content.conditions);
      if (blocker) throw new Error(blocker);
      const gau=content.lifecycle?.mode==='script'&&content.lifecycle.program.instructions.some(({op})=>op.kind==='set-gau-mode'||op.kind==='shadow-secede-lot'||op.kind==='shadow-battle-departure')
        ?this.state.sourceBattleGauEntry(entryContext.state):null;
      if (this.field !== field || field.stop !== request || this.fieldBattleFingerprint(field) !== before)
        throw new StaleSessionBattleHandoff();
      lease = this.state.openBattle(content.encounterId, content.rewardPolicy, content.playerParticipants, content.forcedSavePolicy);
      const ownedLease = lease;
      this.battleLease = ownedLease;
      const entry: BattleEntry = { field, request, lease: ownedLease, seed,
        content: structuredClone(content), shared: battleEventSharedSnapshot(field.eventState),gau, reservationHost: this.captureBattleReservationHost(field) };
      const ownedBefore = canonical(this.state.snapshot());
      this.encounterFailure = null;
      return this.createBattleHandoff("start", entry,
        () => this.field === field && field.stop === request && !this.battle && this.battleLease === ownedLease &&
          this.fieldBattleFingerprint(field) === before && canonical(this.state.snapshot()) === ownedBefore,
        () => { this.state.battlePlayers(ownedLease); sourceEntry?.validate(); bossEntry?.validate(); },
        () => {
          const battle = this.constructBattle(entry);
          return beginPublication => {
            const publish = () => {
              beginPublication();
              this.battle = battle; this.battleEntry = entry;
              this.encounterSerial++; this.encounterFailure = null;
            };
            if (sourceEntry) sourceEntry.commitWith(publish); else if(bossEntry)bossEntry.commitWith(publish);else publish();
          };
        },
        () => {
          if (this.battleLease === ownedLease && !this.battle) {
            this.state.cancelBattle(ownedLease); this.battleLease = null;
          }
        }, undefined, error => this.rememberEncounterFailure(field, request, error),
      ) as PreparedSessionBattleStart;
    } catch (error) {
      if (lease && this.battleLease === lease && !this.battle) {
        this.state.cancelBattle(lease); this.battleLease = null;
      }
      if (!(error instanceof StaleSessionBattleHandoff)) this.rememberEncounterFailure(field, request, error);
      throw error;
    } finally { this.battleHandoffPreparing = false; }
  }
  private startEncounter(): void {
    if (this.encounterPreparationError) return;
    // The compatibility path publishes synchronously, so the remaining
    // admitted logical ticks still belong to this advance call. Prepared
    // handoffs discard host wait time and never restore this remainder.
    const remaining = this.remainder;
    try { if (this.prepareBattleStart()?.commit()) this.remainder = remaining; }
    catch { /* The same pending request and preparation error are retained. */ }
  }

  continueVictory(): boolean {
    if (this.preparedBattleHandoff) return false;
    return this.battleReturnRequest?.outcome === "victory" ? this.prepareBattleReturn()?.commit() ?? false : false;
  }
  get canEscape(): boolean {
    return this.field.stop?.kind === "encounter" && this.field.stop.returnTo?.kind === "field-idle" &&
      this.field.stop.continuation === undefined && !!this.battleLease && !!this.battle?.canRequestEscape;
  }
  requestEscape(): boolean { return this.canEscape ? this.battle!.requestEscape() : false; }
  continueEscape(): boolean {
    if (this.preparedBattleHandoff) return false;
    return this.battleReturnRequest?.outcome === "escaped" ? this.prepareBattleReturn()?.commit() ?? false : false;
  }
  continueForcedReturn(): boolean {
    if (this.preparedBattleHandoff) return false;
    return this.battleReturnRequest?.outcome === "forced" ? this.prepareBattleReturn()?.commit() ?? false : false;
  }
  retryBattle(): boolean {
    if (this.preparedBattleHandoff) return false;
    return this.prepareBattleRetry()?.commit() ?? false;
  }
  prepareBattleRetry(): PreparedSessionBattleStart | null {
    const battle = this.battle, entry = this.battleEntry;
    if (battle?.phase !== "defeat" || this.pendingBattleHandoff || this.battleHandoffPreparing) return null;
    if (!entry || this.battleLease !== entry.lease) throw new Error("Missing battle state ownership");
    const before = this.fieldBattleFingerprint(entry.field), units = canonical(battle.combatants), retirement = battle.prepareEventRetirement();
    return this.createBattleHandoff("retry", entry,
      () => this.field === entry.field && entry.field.stop === entry.request && this.battle === battle &&
        battle.phase === "defeat" && this.battleLease === entry.lease && this.battleEntry === entry &&
        this.fieldBattleFingerprint(entry.field) === before && canonical(battle.combatants) === units,
      () => { this.state.battlePlayers(entry.lease); retirement.validate(); },
      () => { const retried = this.constructBattle(entry); return beginPublication => {
        retirement.validate(); beginPublication(); retirement.commit(); this.battle = retried;
      }; }, () => {},
    ) as PreparedSessionBattleStart;
  }
  prepareBattleReturn(): PreparedSessionBattleReturn | null {
    const field = this.field, request = field.stop, battle = this.battle, entry = this.battleEntry;
    const outcome = this.battleReturnRequest?.outcome;
    if (!battle || !outcome || !isBattleRequest(request) || this.pendingBattleHandoff || this.battleHandoffPreparing) return null;
    if (!entry || this.battleLease !== entry.lease) throw new Error("Missing battle state ownership");
    if (outcome === "escaped" && (request.returnTo?.kind !== "field-idle" || request.continuation !== undefined))
      throw new Error("Escape requires an owned ordinary field encounter");
    this.battleHandoffPreparing = true;
    try {
      const currentResult = () => outcome === "victory" ? battle.previewVictory() : outcome === "escaped" ? battle.previewEscape() : battle.previewForcedReturn();
      const resultFingerprint = () => canonical({ result: currentResult(), shared: battle.eventSharedReturn, reservation: battle.fieldReservationReturn,
        effects: field.fieldEffectsSnapshot, message: field.sourceMessage.snapshot(), messageRevision: field.sourceMessage.mutationRevision,
        ...(outcome === "forced" ? { units: battle.combatants } : {}) });
      const before = resultFingerprint(), retirement = battle.prepareEventRetirement(), reservation = this.prepareReservationReturn(battle.fieldReservationReturn, field);
      const owned = outcome === "victory" ? this.state.prepareVictory(entry.lease, battle.previewVictory()!) :
        outcome === "escaped" ? this.state.prepareEscape(entry.lease, battle.previewEscape()!) :
        this.state.prepareForcedReturn(entry.lease, battle.previewForcedReturn()!);
      const resume = field.prepareEncounterReturn(entry.content.encounterId, owned.fieldState, battle.eventSharedReturn);
      return this.createBattleHandoff("return", entry,
        () => this.field === field && field.stop === request && request === entry.request && field === entry.field &&
          this.battle === battle && this.battleLease === entry.lease && this.battleEntry === entry &&
          resultFingerprint() === before,
        () => { owned.validate(); resume.validate(); retirement.validate(); reservation.validate(); },
        () => beginPublication => {
          let published = false;
          resume.commitWith(() => { owned.validate(); retirement.validate(); reservation.validate(); beginPublication(); owned(); retirement.commit(); reservation.commit(); published = true; });
          if (!published) throw new Error("Battle return did not publish its owned transaction");
          if (outcome === "victory") battle.takeVictory(); else if (outcome === "escaped") battle.takeEscape(); else battle.takeForcedReturn();
          this.battleLease = null; this.battle = null; this.battleEntry = null;
        }, () => {}, outcome,
      ) as PreparedSessionBattleReturn;
    } finally { this.battleHandoffPreparing = false; }
  }
}
