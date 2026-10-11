import type { FieldContent } from "../field/types.js";
import { encounterContent, type BattleCatalog } from "./battle-content.js";
import { BattleGame } from "./battle.js";
import { BattleAIError } from "./battle-ai.js";
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
  formatVersion: 1;
  kind: "game-checkpoint";
  sourceSetHash: string;
  battleCatalogHash: string;
  seed: number;
  encounterSerial: number;
  remainder: number;
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
  constructor(
    field: FieldContent,
    readonly battleCatalog: BattleCatalog,
    readonly seed = 20261010,
  ) {
    checkpointInteger(seed, 0, 0xffffffff);
    if (field.sourceSetHash !== battleCatalog.common.fieldSourceSetHash)
      throw new Error("Field/battle source mismatch");
    this.state = new GameState(
      battleCatalog.gameState,
      battleCatalog.common.players,
      battleCatalog.contentHash,
      battleCatalog.common.conditions,
    );
    this.world = new WorldSession(field, undefined, {
      current: this.state.fieldInventory,
      prepare: () => this.state.prepareFieldInventory(),
    });
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
  checkpoint(): GameCheckpoint {
    if (!this.checkpointReady)
      throw new Error("Cannot save during battle, movement or an event");
    return {
      formatVersion: 1,
      kind: "game-checkpoint",
      sourceSetHash: this.field.content.parentSourceSetHash,
      battleCatalogHash: this.battleCatalog.contentHash,
      seed: this.seed,
      encounterSerial: this.encounterSerial,
      remainder: this.remainder,
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
      "formatVersion,kind,sourceSetHash,battleCatalogHash,seed,encounterSerial,remainder,owned,world",
    );
    if (
      s.formatVersion !== 1 ||
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
        const content = encounterContent(
          this.battleCatalog,
          this.field.stop.party!,
        );
        if (!content) continue;
        this.currentSeed =
          (this.seed + Math.imul(this.encounterSerial, 0x9e3779b1)) >>> 0;
        const lease = this.state.openBattle(content.encounterId);
        try {
          this.battle = new BattleGame(
            content,
            this.currentSeed,
            this.state.battlePlayers(lease),
            this.state.battleInventory(lease),
            this.state.battleProgression(lease),
          );
          this.battleLease = lease;
          this.encounterSerial++;
        } catch (error) {
          this.state.cancelBattle(lease);
          if (!(error instanceof BattleAIError)) throw error;
          this.field.stop = {
            kind: "unsupported",
            message: error.message,
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
      this.state.battleProgression(this.battleLease),
    );
    return true;
  }
}
