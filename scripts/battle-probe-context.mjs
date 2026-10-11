// Local source-check helpers, never imported by the game. Formula/AI probes
// deliberately grant their controlled actions; they do not prove acquisition,
// entry qualification or story reachability. Full entry checks use GameSession.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encounterContent } from "../dist/src/core/battle-content.js";
import { GameState } from "../dist/src/core/game-state.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { projectBattleFieldState } from "../dist/src/core/field-battle-entry.js";

/** Actual source-owned opening stock and six-slot identities. Numerical probes
 * may grant controlled actions, but row/cost providers still use owned data. */
export function sourceBattleInventory(catalog, encounterId = 3) {
  const state = new GameState(catalog.gameState, catalog.common.players,
    catalog.contentHash, catalog.common.conditions);
  const lease = state.openBattle(encounterId);
  const inventory = state.battleInventory(lease);
  state.cancelBattle(lease);
  return inventory;
}

export function sourceBattleContent(catalog, encounterId) {
  const content = structuredClone(encounterContent(catalog, encounterId));
  assert.ok(content, "Missing source probe encounter");
  const field = JSON.parse(readFileSync(new URL("../build/game/narshe.json", import.meta.url)));
  assert.equal(content.fieldSourceSetHash, field.sourceSetHash);
  const entry = projectBattleFieldState(content.battleEntry, {
    mapId: field.map.identity?.mapId ?? null,
    transportationId: field.entry.transportationId,
    isSavePoint: null, beastFieldController: null, footAttributeType: null,
  }, catalog.gameState.fieldConditions.transportations);
  assert.deepEqual(entry.blockers, []);
  assert.ok(entry.invalidContentIds);
  content.qualificationContext = { ...content.qualificationContext,
    invalidContentIds: entry.invalidContentIds };
  return content;
}

export function controlledBattleContent(catalog, encounterId) {
  const content = sourceBattleContent(catalog, encounterId);
  const state = new GameState(catalog.gameState, catalog.common.players,
    catalog.contentHash, catalog.common.conditions);
  const lease = state.openBattle(encounterId);
  const players = state.battlePlayers(lease);
  const battle = new BattleGame(content, 1, players, state.battleInventory(lease));
  content.players = players.map((player) => {
    const menu = battle.commandMenu(player.id).filter((command) => command.available);
    const controlled = { ...player, conditionIds: [],
      commands: menu.map((command) => command.id),
      abilities: [...new Set(menu.flatMap((command) => command.abilityIds))] };
    delete controlled.battleRequirements;
    return controlled;
  });
  state.cancelBattle(lease);
  content.qualificationContext.mode = "development-static";
  content.limitations = [...content.limitations,
    "Controlled formula/AI probe: action ownership and empty initial conditions are explicit test inputs, not source entry acceptance."];
  return content;
}
