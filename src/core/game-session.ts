import type { FieldContent } from "../field/types.js";
import { encounterContent, type BattleCatalog } from "./battle-content.js";
import { BattleGame, type Combatant } from "./battle.js";
import { WorldSession } from "./world-session.js";

/** Owns the encounter handoff and consumes rewards exactly once. No renderer state drives progression. */
export class GameSession {
  readonly world: WorldSession;
  get field() {
    return this.world.field;
  }
  battle: BattleGame | null = null;
  players: Combatant[] | undefined;
  gil: number;
  readonly completedEncounters: number[] = [];
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
    this.gil = battleCatalog.common.gil;
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
        const levels = this.players ?? content.players;
        if (
          content.maxPartyLevel !== null &&
          levels.some((c) => c.level > content.maxPartyLevel!)
        ) {
          this.field.stop = {
            kind: "unsupported",
            message: "狼犬的高等级行动分支尚未迁移。",
            site: this.field.stop.site,
          };
          continue;
        }
        this.currentSeed =
          (this.seed + Math.imul(this.encounterSerial++, 0x9e3779b1)) >>> 0;
        this.battle = new BattleGame(content, this.currentSeed, this.players);
      }
    }
  }
  continueVictory(): boolean {
    const result = this.battle?.takeVictory();
    if (!result) return false;
    this.players = result.players;
    this.gil += result.gil;
    this.completedEncounters.push(this.battle!.content.encounterId);
    this.field.finishEncounter(this.battle!.content.encounterId);
    this.battle = null;
    return true;
  }
  retryBattle(): boolean {
    if (this.battle?.phase !== "defeat") return false;
    this.battle = new BattleGame(
      this.battle.content,
      this.currentSeed,
      this.players,
    );
    return true;
  }
}
