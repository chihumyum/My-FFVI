import type { FieldContent } from "../field/types.js";
import type { GameEventSaveRequest } from "./field.js";
import { encounterContent, battleDefinitionBlocker, type BattleCatalog } from "./battle-content.js";
import { BattleGame } from "./battle.js";
import { EventState } from "./event-state.js";
import { battleEventSharedSnapshot } from "./battle-event-shared.js";
import type { AudioReadinessPort } from "./audio-readiness.js";
import type { FieldSoundPresentation } from "./field-sound-presentation.js";
import type { FieldEffectRuntimeHost } from "./field-effects.js";
import type { ShopTradeRequest } from "./shop.js";
import { projectPartyMenu, type PartyMenuRequest } from "./party-menu.js";
import { projectCharacterMenu } from "./character-menu.js";
import { equipmentOwnedAbilities } from "./equipment.js";
import { projectBattleFieldState } from "./field-battle-entry.js";
import {
  parseBattlePreferences,
  type BattlePreferences,
} from "./battle-preferences.js";
import { WorldSession, type WorldCheckpoint } from "./world-session.js";
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
import type { NewGameFieldLaunch, NewGameFieldPreparation } from "./new-game-field-entry.js";
import { FieldFadeState } from "./field-fade.js";
import { cloneSourcePresentationContext, createSourcePresentationContext, type SourcePresentationContext } from "./source-presentation.js";
import {
  checkpointKeys,
  checkpointInteger,
  checkpointNumber,
} from "./checkpoint-validation.js";

type GameCheckpointBase = {
  kind: "game-checkpoint";
  sourceSetHash: string;
  battleCatalogHash: string;
  origin: { kind: "development-checkpoint" } | { kind: "source-new-game"; sourceContentHash: string };
  seed: number;
  encounterSerial: number;
  remainder: number;
  battlePreferences: BattlePreferences;
  owned: GameStateSnapshot;
  world: WorldCheckpoint;
};
/** Version 4 is read-only compatibility for content without walk encounters. */
export type GameCheckpoint = GameCheckpointBase & (
  { formatVersion: 4 } | { formatVersion: 5; walkEncounters: WalkEncounterSnapshot }
);
/** External observations are rebound by the host on load, never trusted from saves. */
export type GameSessionRuntime = { audioReadiness?: AudioReadinessPort; fieldEffects?: FieldEffectRuntimeHost;
  soundPresentation?: FieldSoundPresentation;
  /** Host wall-clock observation for source parking timestamps; recorded as an
   * exact decimal Int64, never sampled by deterministic core state. */
  transportationTimestamp?: () => string };
type FreshSession = { content: SourceNewGameContent; state: GameState; events: EventState;
  map: WorldMapContent; fade: FieldFadeState; presentation: SourcePresentationContext; restoring?: true };
export type GameRestoreWorld = { catalog: WorldCatalog; map: WorldMapContent;
  source?: { content: SourceNewGameContent; initialMap: WorldMapContent } };
export type PreparedGameEventSave = {
  checkpoint: GameCheckpoint;
  validate(): void;
  /** Atomically write the prepared snapshot, then ACK without clocking events. */
  commitWith(write: () => void): void;
  discard(): void;
};

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
  private encounterSerial = 0;
  private currentSeed = 0;
  private remainder = 0;
  private currentBattlePreferences: BattlePreferences;
  private readonly walkEncounters: WalkEncounterState;
  private encounterFailure: { request: NonNullable<GameSession["field"]["stop"]>; message: string } | null = null;
  private freshEntry: { content: SourceNewGameContent; launched: boolean } | null = null;
  static prepareNewGame(content: SourceNewGameContent, world: WorldCatalog, map: WorldMapContent,
    battle: BattleCatalog, fade: FieldFadeState, presentation: SourcePresentationContext,
    runtime: GameSessionRuntime = {}, seed = 20261010): GameSession {
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
    this.world = new WorldSession(field, initialEvents, {
      current: {
        ...runtime,
        ...(fresh ? { nativeActorPreparation: true,
          sourcePresentation: { context: () => structuredClone(fresh.presentation) } } : {}),
        puppetRoster: this.state.fieldPuppetRoster,
        inventory: this.state.fieldInventory,
        treasure: this.state.fieldTreasure,
        party: this.state.fieldParty,
        roster: this.state.fieldRoster,
        ownedConditions: this.state.fieldOwnedConditions,
        ...(this.state.fieldTransportation ? { transportation: this.state.fieldTransportation } : {}),
        shop: this.state.fieldShop,
        walkEncounters: { prepareStep: (mapId, policy) => this.walkEncounters.prepareStep(mapId, policy) },
        ...(battleCatalog.gameState.fieldConditions ? { fieldSteps: this.state.fieldSteps } : {}),
        ...(this.state.fieldPartyAppearance ? { partyAppearance: this.state.fieldPartyAppearance } : {}),
        movementBlocker: (transportationId, manual) => this.state.fieldMoveBlocker(transportationId, manual),
      },
      prepare: () => this.state.prepareFieldState(),
      nativeState: () => this.state.nativeState,
    }, fresh?.fade, fresh?.restoring === true);
    if (fresh) {
      if (!fresh.restoring) installSourceNewGameActors(this.field, fresh.content, this.state, fresh.map);
      this.freshEntry = { content: fresh.content, launched: fresh.restoring === true };
    }
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
    const blocker = model.blocker ?? (!this.menuReady ? "请在地图空闲时调整编队。" : this.field.partyMenuBlocker);
    return { ...model, blocker, editable: blocker === null };
  }
  characterMenu(id: string) {
    const member = this.state.snapshot().roster.find((candidate) => candidate.id === id);
    if (!member) throw new Error("Character menu references an unowned member");
    const content = this.battleCatalog.gameState;
    return { ...projectCharacterMenu(member, {
      growth: content.characterGrowth?.[id] ?? null,
      developmentExperience: this.battleCatalog.common.experience,
      abilities: this.battleCatalog.common.abilities,
      commands: this.battleCatalog.common.commands,
      equipmentAbilities: content.equipmentSystem ? equipmentOwnedAbilities(content.equipmentSystem.catalog, member) : [],
    }), magicLearningValue: content.characterInitializations?.[id] ? member.magicLearningValue : null };
  }
  changeParty(request: PartyMenuRequest): boolean {
    if (!this.menuReady) return false;
    const field = this.field, transaction = this.state.preparePartyMenu(request);
    if (!transaction.changed) return false;
    const publish = field.prepareMenuPartyAppearance(transaction.appearance);
    // Both owners finish fallible preparation before either is published. The
    // existing renderer publication writes prepared state without owned reads.
    publish.validate();
    if (this.field !== field || !this.menuReady) throw new Error("Field changed during party menu preparation");
    transaction.validate();
    transaction.commit();
    publish();
    return true;
  }
  useMenuItem(id: number, targetId: string): boolean {
    if (!this.menuReady) return false;
    return this.state.useMenuItem(id, targetId);
  }
  changeEquipment(playerId: string, slot: number, contentId: number): boolean {
    if (!this.menuReady) return false;
    return this.state.changeEquipment(playerId, slot, contentId);
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
  closeShop(): boolean {
    if (this.battle || this.battleLease || this.state.inBattle) return false;
    return this.field.closeShop();
  }
  checkpoint(): GameCheckpoint {
    if (!this.checkpointReady)
      throw new Error("Cannot save during battle, movement or an event");
    return this.captureCheckpoint(this.world.checkpoint());
  }
  private captureCheckpoint(world: WorldCheckpoint): GameCheckpoint {
    return {
      formatVersion: 5,
      kind: "game-checkpoint",
      sourceSetHash: this.field.content.parentSourceSetHash,
      battleCatalogHash: this.battleCatalog.contentHash,
      origin: this.freshEntry ? { kind: "source-new-game", sourceContentHash: this.freshEntry.content.contentHash }
        : { kind: "development-checkpoint" },
      seed: this.seed,
      encounterSerial: this.encounterSerial,
      remainder: this.remainder,
      battlePreferences: this.battlePreferences,
      walkEncounters: this.walkEncounters.snapshot(),
      owned: this.state.snapshot(),
      world,
    };
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
    if (s.formatVersion !== 4 && s.formatVersion !== 5) throw new Error("Game checkpoint source/version mismatch");
    checkpointKeys(
      s,
      "formatVersion,kind,sourceSetHash,battleCatalogHash,origin,seed,encounterSerial,remainder,battlePreferences,owned,world" +
        (s.formatVersion === 5 ? ",walkEncounters" : ""),
    );
    if (
      (s.formatVersion !== 4 && s.formatVersion !== 5) ||
      s.kind !== "game-checkpoint" ||
      s.battleCatalogHash !== battle.contentHash
    )
      throw new Error("Game checkpoint source/version mismatch");
    checkpointInteger(s.seed, 0, 0xffffffff);
    checkpointInteger(s.encounterSerial);
    checkpointNumber(s.remainder, 0, 10);
    if (s.remainder >= 10) throw new Error("Invalid session remainder");
    let next: GameSession;
    if (s.origin?.kind === "source-new-game") {
      checkpointKeys(s.origin, "kind,sourceContentHash");
      const source = world?.source;
      if (!source || !world || source.content.contentHash !== s.origin.sourceContentHash ||
          source.content.contentHash !== s.world.initialHash ||
          source.content.parentSourceSetHash !== s.sourceSetHash || s.owned.initialization !== "source-new-game")
        throw new Error("Source new-game restore requires trusted native actor/world checkpoint dependencies");
      // A source checkpoint depends on its trusted entry map, never a legacy
      // opening field supplied by an older caller. Reject effect publication
      // before creating any native actor or external host during restoration.
      const map = source.initialMap.map;
      if (map && (map.entities.some((entity) => entity.kind === 11) ||
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
    next.world.restore(s.world, world?.catalog, world?.map, s.origin.kind === "source-new-game" ? world!.source : undefined);
    if (s.formatVersion === 5) next.walkEncounters.restore(s.walkEncounters);
    else if (initial?.walkEncounters || next.field.content.walkEncounters)
      throw new Error("Legacy checkpoint has no walking encounter state");
    if (next.field.content.walkEncounters)
      next.walkEncounters.assertPolicy(next.field.content.map.identity!.mapId, next.field.content.walkEncounters);
    next.encounterSerial = s.encounterSerial;
    next.remainder = s.remainder;
    return next;
  }
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      throw new Error("Invalid session elapsed time");
    if (this.eventSaveRequest || this.encounterPreparationError) return;
    this.remainder += ms;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.eventSaveRequest) continue;
      if (this.battle) {
        if (!this.field.soundReady) continue;
        this.field.bgm.advance(10, this.field.content.bgm);
        this.field.environment.advance(10, this.field.content.environment);
        this.field.se.advance(10, this.field.content.se);
        this.battle.advance(10);
        continue;
      }
      this.field.advance(10);
      if (this.field.stop?.kind === "encounter") this.startEncounter();
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
    if (!this.encounterPreparationError || this.battle || this.battleLease || this.state.inBattle) return false;
    this.encounterFailure = null;
    this.startEncounter();
    return this.battle !== null;
  }
  private startEncounter(): void {
    const request = this.field.stop;
    if (request?.kind !== "encounter" || this.battle || this.encounterPreparationError) return;
    let lease: BattleLease | null = null;
    try {
      const seed = (this.seed + Math.imul(this.encounterSerial, 0x9e3779b1)) >>> 0;
      let content = encounterContent(this.battleCatalog, request.party!, seed);
      if (!content) {
        const reasons = this.battleCatalog.encounterDiagnostics
          ?.filter((entry) => entry.partyId === request.party && entry.kind === "blocked")
          .map((entry) => `${entry.code}: ${entry.reason}`) ?? [];
        throw new Error(`Battle content is unavailable for encounter ${request.party}` +
          (reasons.length ? ` (${reasons.join("; ")})` : ""));
      }
      if (content.battleEntry && content.qualificationContext?.mode === "source") {
        const entry = projectBattleFieldState(content.battleEntry, this.field.battleEntryContext.state,
          this.battleCatalog.gameState.fieldConditions?.transportations ?? []);
        if (entry.invalidContentIds === null || entry.blockers.length)
          throw new Error(entry.blockers.join("; ") || "Unknown battle field exclusions");
        content = { ...content, qualificationContext: { ...content.qualificationContext,
          invalidContentIds: entry.invalidContentIds, conditionContext: "current" } };
      }
      // A scripted encounter currently has a victory continuation only. Never
      // let a catalog-level development policy bypass its story result branch.
      if (content.escapePolicy && request.returnTo?.kind !== "field-idle") {
        const { escapePolicy: _, ...scripted } = content;
        content = scripted;
      }
      if (this.state.battlePartyBlocker) throw new Error(this.state.battlePartyBlocker);
      const blocker = battleDefinitionBlocker(this.state.partyPlayers(), content.qualificationContext, content.conditions);
      if (blocker) throw new Error(blocker);
      lease = this.state.openBattle(content.encounterId, content.rewardPolicy);
      const battle = new BattleGame(content, seed, this.state.battlePlayers(lease), this.state.battleInventory(lease),
        this.state.battleProgression(lease, content.experience), this.currentBattlePreferences,
        battleEventSharedSnapshot(this.field.eventState));
      this.battle = battle;
      this.battleLease = lease;
      this.currentSeed = seed;
      this.encounterSerial++;
      this.encounterFailure = null;
    } catch (error) {
      if (lease) this.state.cancelBattle(lease);
      const message = error instanceof Error ? error.message : String(error);
      if (request.returnTo?.kind === "field-idle") this.encounterFailure = { request, message };
      else this.field.stop = { kind: "unsupported", message, site: request.site };
    }
  }

  continueVictory(): boolean {
    const result = this.battle?.previewVictory();
    if (!result) return false;
    if (!this.battleLease) throw new Error("Missing battle state ownership");
    const commit = this.state.prepareVictory(this.battleLease, result);
    const resume = this.field.prepareEncounterReturn(
      this.battle!.content.encounterId,
      commit.fieldState,
      this.battle!.eventSharedReturn,
    );
    // Prepare source actors against the post-victory owner, then validate both
    // before publishing rewards, poses, camera or continuation tasks.
    commit.validate();
    resume.commitWith(commit);
    this.battle!.takeVictory();
    this.battleLease = null;
    this.battle = null;
    return true;
  }
  get canEscape(): boolean {
    return this.field.stop?.kind === "encounter" && this.field.stop.returnTo?.kind === "field-idle" &&
      this.field.stop.continuation === undefined && !!this.battleLease && !!this.battle?.canRequestEscape;
  }
  requestEscape(): boolean { return this.canEscape ? this.battle!.requestEscape() : false; }
  continueEscape(): boolean {
    const result = this.battle?.previewEscape();
    if (!result) return false;
    if (!this.battleLease || this.field.stop?.kind !== "encounter" ||
        this.field.stop.returnTo?.kind !== "field-idle" || this.field.stop.continuation !== undefined)
      throw new Error("Escape requires an owned ordinary field encounter");
    const commit = this.state.prepareEscape(this.battleLease, result);
    const resume = this.field.prepareEncounterReturn(this.battle!.content.encounterId, commit.fieldState,
      this.battle!.eventSharedReturn);
    commit.validate();
    resume.commitWith(commit);
    this.battle!.takeEscape();
    this.battleLease = null;
    this.battle = null;
    return true;
  }
  retryBattle(): boolean {
    if (this.battle?.phase !== "defeat") return false;
    if (!this.battleLease) throw new Error("Missing battle state ownership");
    this.battle = new BattleGame(
      { ...this.battle.content, rewardPolicy: this.state.battleRewardPolicy(this.battleLease),
        lifecycle: this.battle.lifecycleDefinition },
      this.currentSeed,
      this.state.battlePlayers(this.battleLease),
      this.state.battleInventory(this.battleLease),
      this.state.battleProgression(this.battleLease, this.battle.content.experience),
      this.currentBattlePreferences,
      this.battle.eventSharedEntry,
    );
    return true;
  }
}
