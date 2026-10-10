import type { FieldContent } from "../field/types.js";
import type { BattleContent } from "./battle-content.js";
import { BattleGame, type Combatant } from "./battle.js";
import { FieldGame } from "./field.js";

/** Owns the encounter handoff and consumes rewards exactly once. No renderer state drives progression. */
export class GameSession {
  readonly field: FieldGame;
  battle: BattleGame | null = null;
  players: Combatant[] | undefined;
  gil: number;
  private remainder = 0;
  constructor(
    field: FieldContent,
    readonly battleContent: BattleContent,
    readonly seed = 20261010,
  ) {
    if (field.sourceSetHash !== battleContent.fieldSourceSetHash)
      throw new Error("Field/battle source mismatch");
    this.field = new FieldGame(field);
    this.gil = battleContent.gil;
  }
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000)
      throw new Error("Invalid session elapsed time");
    this.remainder += ms;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.battle) {
        this.battle.advance(10);
        continue;
      }
      this.field.advance(10);
      if (
        this.field.stop?.kind === "encounter" &&
        this.field.stop.party === this.battleContent.encounterId
      )
        this.battle = new BattleGame(
          this.battleContent,
          this.seed,
          this.players,
        );
    }
  }
  continueVictory(): boolean {
    const result = this.battle?.takeVictory();
    if (!result) return false;
    this.players = result.players;
    this.gil += result.gil;
    this.field.finishEncounter(this.battleContent.encounterId);
    this.battle = null;
    return true;
  }
  retryBattle(): boolean {
    if (this.battle?.phase !== "defeat") return false;
    this.battle = new BattleGame(this.battleContent, this.seed, this.players);
    return true;
  }
}
