import type { FieldContent } from "../field/types.js";
import { encounterContent, battleDefinitionBlocker, type BattleCatalog } from "./battle-content.js";
import { BattleGame } from "./battle.js";
import { EventState } from "./event-state.js";
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
import {
  checkpointKeys,
  checkpointInteger,
  checkpointNumber,
} from "./checkpoint-validation.js";

export type GameCheckpoint = {
  formatVersion: 2;
  kind: "game-checkpoint";
  sourceSetHash: string;
  battleCatalogHash: string;
  seed: number;
  encounterSerial: number;
  remainder: number;
  battlePreferences: BattlePreferences;
  owned: GameStateSnapshot;
  world: WorldCheckpoint;
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
  constructor(
    field: FieldContent,
    readonly battleCatalog: BattleCatalog,
    readonly seed = 20261010,
  ) {
    checkpointInteger(seed, 0, 0xffffffff);
    this.currentBattlePreferences = parseBattlePreferences({
      mode: battleCatalog.common.timing.mode,
    });
    if (field.sourceSetHash !== battleCatalog.common.fieldSourceSetHash)
      throw new Error("Field/battle source mismatch");
    this.state = new GameState(
      battleCatalog.gameState,
      battleCatalog.common.players,
      battleCatalog.contentHash,
      battleCatalog.common.conditions,
    );
    const initialEvents = new EventState();
    const seeded = new Set<string>();
    for (const { ref, value } of field.entry.initialEventValues ?? []) {
      const identity = `${ref.category}:${ref.index}`;
      if (seeded.has(identity)) throw new Error("Duplicate source checkpoint event seed");
      seeded.add(identity);
      initialEvents.write(ref, value);
    }
    this.world = new WorldSession(field, initialEvents, {
      current: {
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
    });
  }
  get battlePreferences(): BattlePreferences {
    return { ...this.currentBattlePreferences };
  }
  setBattlePreferences(value: BattlePreferences): void {
    const next = parseBattlePreferences(value);
    this.battle?.setPreferences(next);
    this.currentBattlePreferences = next;
  }
  get checkpointReady(): boolean {
    return (
      !this.battle &&
      !this.battleLease &&
      !this.state.inBattle &&
      this.field.checkpointReady
    );
  }
  useMenuItem(id: number, targetId: string): boolean {
    if (!this.checkpointReady) return false;
    return this.state.useMenuItem(id, targetId);
  }
  changeEquipment(playerId: string, slot: number, contentId: number): boolean {
    if (!this.checkpointReady) return false;
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
      formatVersion: 2,
      kind: "game-checkpoint",
      sourceSetHash: this.field.content.parentSourceSetHash,
      battleCatalogHash: this.battleCatalog.contentHash,
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
    world?: { catalog: WorldCatalog; map: WorldMapContent },
  ): GameSession {
    const s = structuredClone(raw);
    checkpointKeys(
      s,
      "formatVersion,kind,sourceSetHash,battleCatalogHash,seed,encounterSerial,remainder,battlePreferences,owned,world",
    );
    if (
      s.formatVersion !== 2 ||
      s.kind !== "game-checkpoint" ||
      s.sourceSetHash !== initial.parentSourceSetHash ||
      s.battleCatalogHash !== battle.contentHash
    )
      throw new Error("Game checkpoint source/version mismatch");
    checkpointInteger(s.seed, 0, 0xffffffff);
    checkpointInteger(s.encounterSerial);
    checkpointNumber(s.remainder, 0, 10);
    if (s.remainder >= 10) throw new Error("Invalid session remainder");
    const next = new GameSession(initial, battle, s.seed);
    next.setBattlePreferences(s.battlePreferences);
    next.state.restore(s.owned);
    if (s.encounterSerial !== s.owned.completedBattles.length)
      throw new Error("Saved encounter sequence disagrees with rewards");
    next.world.restore(s.world, world?.catalog, world?.map);
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
        if (!content) continue;
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
          );
          this.battle.setPreferences(this.currentBattlePreferences);
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
    );
    this.battle.setPreferences(this.currentBattlePreferences);
    return true;
  }
}
