import { GameFlow } from "./game-flow.js";
import { GameSession } from "./game-session.js";
import { BattleGame } from "./battle.js";
import type { BattlePreferences } from "./battle-preferences.js";
import type { TargetSelection } from "./battle-targets.js";
import type { PartyMenuRequest } from "./party-menu.js";
import type { ShopTradePlan, ShopTradeRequest } from "./shop.js";
import { parseGameMenuCommand, type GameMenuCommand } from "./game-menu-command.js";
import type { FieldAbilityRequest } from "./field-abilities.js";

/** User command admission, bound to the exact published session. This gateway
 * owns no resources, menu model, clock or transaction; existing subsystem
 * owners still validate and publish every effect. Retained UI callbacks keep
 * this binding instead of redirecting their request to a replacement owner. */
export class GameCommands {
  constructor(private readonly flow: GameFlow, readonly owner: GameSession) {
    if (!(flow instanceof GameFlow) || !(owner instanceof GameSession))
      throw new Error("Game commands require a GameFlow and GameSession owner");
  }
  private get current(): boolean {
    return this.flow.started && this.flow.currentSession === this.owner;
  }
  get menuReady(): boolean { return this.current && this.flow.menuInputReady && this.owner.menuReady; }
  get settingsReady(): boolean { return this.current && this.flow.menuInputReady; }
  get battleReady(): boolean {
    return this.current && this.flow.inputReady && this.owner.battle?.phase === "active";
  }
  get shopReady(): boolean {
    return this.current && this.flow.inputReady && !this.owner.battle && !this.owner.state.inBattle &&
      this.owner.field.stop === null && this.owner.field.currentShop !== null;
  }
  /** Presentation may report pause/background clock inputs independently of
   * user-command readiness, but never to an old retry or replacement battle. */
  ownsBattle(battle: BattleGame): boolean {
    return battle instanceof BattleGame && this.current && this.owner.battle === battle;
  }
  menu(command: GameMenuCommand): boolean {
    const input = parseGameMenuCommand(command);
    switch (input.kind) {
      case "use-item": return this.useMenuItem(input.itemId, input.targetId);
      case "use-ability": return this.useMenuAbility({ actorId: input.actorId, abilityId: input.abilityId,
        selection: input.selection });
      case "change-equipment": return this.changeEquipment(input.playerId, input.slot, input.contentId);
      case "set-preferences": return this.setBattlePreferences(input.preferences);
      case "change-party": {
        if (!this.menuReady) return false;
        const model = this.owner.partyMenu();
        if (!model.editable) return false;
        return this.changeParty({ expected: model.expected, change: input.change });
      }
    }
  }
  useMenuItem(id: number, targetId: string): boolean {
    return this.menuReady ? this.owner.useMenuItem(id, targetId) : false;
  }
  useMenuAbility(request: FieldAbilityRequest): boolean {
    return this.menuReady ? this.owner.useMenuAbility(request, () => this.menuReady) : false;
  }
  changeEquipment(playerId: string, slot: number, contentId: number): boolean {
    return this.menuReady ? this.owner.changeEquipment(playerId, slot, contentId) : false;
  }
  changeParty(request: PartyMenuRequest): boolean {
    return this.menuReady ? this.owner.changeParty(request, () => this.menuReady) : false;
  }
  setBattlePreferences(value: BattlePreferences): boolean {
    if (!this.settingsReady) return false;
    this.owner.setBattlePreferences(value);
    return true;
  }
  tradeShop(request: ShopTradeRequest): ShopTradePlan | null {
    return this.shopReady ? this.owner.tradeShop(request) : null;
  }
  closeShop(): boolean { return this.shopReady ? this.owner.closeShop() : false; }
  command(battle: BattleGame, actorId: string, abilityId: number,
    target: string | TargetSelection, commandId?: number | null): boolean {
    return this.battleReady && this.ownsBattle(battle) ? battle.command(actorId, abilityId, target, commandId) : false;
  }
  commandItem(battle: BattleGame, actorId: string, itemId: number,
    selection: TargetSelection, commandId: number): boolean {
    return this.battleReady && this.ownsBattle(battle) ? battle.commandItem(actorId, itemId, selection, commandId) : false;
  }
  canEscape(battle: BattleGame): boolean {
    return this.battleReady && this.ownsBattle(battle) && this.owner.canEscape;
  }
  requestEscape(battle: BattleGame): boolean { return this.canEscape(battle) ? this.owner.requestEscape() : false; }
  /** The handoff coordinator remains the only owner of preparation, retry and
   * settlement. These checks authorize the captured terminal button only. */
  canReturnBattle(battle: BattleGame): boolean {
    return this.current && this.flow.inputReady && this.ownsBattle(battle) &&
      (battle.phase === "victory" || battle.phase === "escaped");
  }
  canRetryBattle(battle: BattleGame): boolean {
    return this.current && this.flow.inputReady && this.ownsBattle(battle) && battle.phase === "defeat";
  }
}
