import type { FieldContent } from "../field/types.js";
import { encounterContent, type BattleCatalog } from "./battle-content.js";
import { BattleGame } from "./battle.js";
import { BattleAIError } from "./battle-ai.js";
import { WorldSession } from "./world-session.js";
import { GameState, type BattleLease } from "./game-state.js";

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
    if (field.sourceSetHash !== battleCatalog.common.fieldSourceSetHash)
      throw new Error("Field/battle source mismatch");
    this.world = new WorldSession(field);
    this.state = new GameState(
      battleCatalog.gameState,
      battleCatalog.common.players,
      battleCatalog.contentHash,
      battleCatalog.common.conditions,
    );
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
    );
    return true;
  }
}
