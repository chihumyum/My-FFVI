import type { FieldContent } from "../field/types.js";
import { encounterContent, battleDefinitionBlocker, type BattleCatalog } from "./battle-content.js";
import { BattleGame } from "./battle.js";
import { EventState } from "./event-state.js";
import type { AudioReadinessPort } from "./audio-readiness.js";
import type { FieldEffectRuntimeHost } from "./field-effects.js";
import type { ShopTradeRequest } from "./shop.js";
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

export type GameCheckpoint = {
  formatVersion: 4;
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
/** External observations are rebound by the host on load, never trusted from saves. */
export type GameSessionRuntime = { audioReadiness?: AudioReadinessPort; fieldEffects?: FieldEffectRuntimeHost };
type FreshSession = { content: SourceNewGameContent; state: GameState; events: EventState;
  map: WorldMapContent; fade: FieldFadeState; presentation: SourcePresentationContext; restoring?: true };
export type GameRestoreWorld = { catalog: WorldCatalog; map: WorldMapContent;
  source?: { content: SourceNewGameContent; initialMap: WorldMapContent } };

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
        shop: this.state.fieldShop,
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
    return {
      formatVersion: 4,
      kind: "game-checkpoint",
      sourceSetHash: this.field.content.parentSourceSetHash,
      battleCatalogHash: this.battleCatalog.contentHash,
      origin: this.freshEntry ? { kind: "source-new-game", sourceContentHash: this.freshEntry.content.contentHash }
        : { kind: "development-checkpoint" },
      seed: this.seed,
      encounterSerial: this.encounterSerial,
      remainder: this.remainder,
      battlePreferences: this.battlePreferences,
      owned: this.state.snapshot(),
      world: this.world.checkpoint(),
    };
  }
  static restore(
    raw: GameCheckpoint,
    initial: FieldContent,
    battle: BattleCatalog,
    world?: GameRestoreWorld,
    runtime: GameSessionRuntime = {},
  ): GameSession {
    if (initial.map.entities.some((entity) => entity.kind === 11) ||
        Object.values(initial.map.groups ?? {}).some((group) => group.entities.some((entity) => entity.kind === 11)))
      throw new Error("Field effect particle/RNG checkpoint codec is unresolved");
    const s = structuredClone(raw);
    checkpointKeys(
      s,
      "formatVersion,kind,sourceSetHash,battleCatalogHash,origin,seed,encounterSerial,remainder,battlePreferences,owned,world",
    );
    if (
      s.formatVersion !== 4 ||
      s.kind !== "game-checkpoint" ||
      s.sourceSetHash !== initial.parentSourceSetHash ||
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
          source.content.parentSourceSetHash !== s.sourceSetHash || s.owned.initialization !== "source-new-game")
        throw new Error("Source new-game restore requires trusted native actor/world checkpoint dependencies");
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
      next = new GameSession(initial, battle, s.seed, runtime);
    }
    next.setBattlePreferences(s.battlePreferences);
    next.state.restore(s.owned);
    if (s.encounterSerial !== s.owned.completedBattles.length)
      throw new Error("Saved encounter sequence disagrees with rewards");
    next.world.restore(s.world, world?.catalog, world?.map, s.origin.kind === "source-new-game" ? world!.source : undefined);
    next.encounterSerial = s.encounterSerial;
    next.remainder = s.remainder;
    return next;
  }
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      throw new Error("Invalid session elapsed time");
    this.remainder += ms;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.battle) {
        this.field.bgm.advance(10, this.field.content.bgm);
        this.field.environment.advance(10, this.field.content.environment);
        this.battle.advance(10);
        continue;
      }
      this.field.advance(10);
      if (this.field.stop?.kind === "encounter") {
        let content = encounterContent(
          this.battleCatalog,
          this.field.stop.party!,
        );
        if (!content) {
          this.field.stop = { kind: "unsupported",
            message: `Battle content is unavailable for encounter ${this.field.stop.party}`,
            site: this.field.stop.site };
          continue;
        }
        if (content.battleEntry && content.qualificationContext?.mode === "source") {
          try {
            const entry = projectBattleFieldState(content.battleEntry,
              this.field.battleEntryContext.state,
              this.battleCatalog.gameState.fieldConditions?.transportations ?? []);
            if (entry.invalidContentIds === null || entry.blockers.length)
              throw new Error(entry.blockers.join("; ") || "Unknown battle field exclusions");
            content = { ...content, qualificationContext: { ...content.qualificationContext,
              invalidContentIds: entry.invalidContentIds, conditionContext: "current" } };
          } catch (error) {
            this.field.stop = { kind: "unsupported", message: error instanceof Error ? error.message : String(error),
              site: this.field.stop.site };
            continue;
          }
        }
        if (this.state.battlePartyBlocker) {
          this.field.stop = {
            kind: "unsupported",
            message: this.state.battlePartyBlocker,
            site: this.field.stop.site,
          };
          continue;
        }
        const templateBlocker = battleDefinitionBlocker(this.state.partyPlayers(), content.qualificationContext, content.conditions);
        if (templateBlocker) {
          this.field.stop = { kind: "unsupported", message: templateBlocker, site: this.field.stop.site };
          continue;
        }
        this.currentSeed =
          (this.seed + Math.imul(this.encounterSerial, 0x9e3779b1)) >>> 0;
        const lease = this.state.openBattle(content.encounterId);
        try {
          this.battle = new BattleGame(
            content,
            this.currentSeed,
            this.state.battlePlayers(lease),
            this.state.battleInventory(lease),
            this.state.battleProgression(lease, content.experience),
            this.currentBattlePreferences,
          );
          this.battleLease = lease;
          this.encounterSerial++;
        } catch (error) {
          this.state.cancelBattle(lease);
          this.field.stop = {
            kind: "unsupported",
            message: error instanceof Error ? error.message : String(error),
            site: this.field.stop.site,
          };
        }
      }
    }
  }
  continueVictory(): boolean {
    const result = this.battle?.previewVictory();
    if (!result) return false;
    if (!this.battleLease) throw new Error("Missing battle state ownership");
    const resume = this.field.prepareEncounterReturn(
      this.battle!.content.encounterId,
    );
    const commit = this.state.prepareVictory(this.battleLease, result);
    // Synchronous commits: no event code or user callbacks execute between them.
    commit();
    resume();
    this.battle!.takeVictory();
    this.battleLease = null;
    this.battle = null;
    return true;
  }
  retryBattle(): boolean {
    if (this.battle?.phase !== "defeat") return false;
    if (!this.battleLease) throw new Error("Missing battle state ownership");
    this.battle = new BattleGame(
      this.battle.content,
      this.currentSeed,
      this.state.battlePlayers(this.battleLease),
      this.state.battleInventory(this.battleLease),
      this.state.battleProgression(this.battleLease, this.battle.content.experience),
      this.currentBattlePreferences,
    );
    return true;
  }
}
