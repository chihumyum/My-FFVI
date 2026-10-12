import { GameSession } from "../../src/core/game-session.js";
import { equipmentGameFixture } from "./equipment-game.js";
import { actorCatalog, actorContext } from "./party-actors.js";

/** Known synthetic media/actor capabilities, not a source-map fallback. */
export function partyMenuFixture() {
  const { field, catalog: battle } = equipmentGameFixture();
  const initial = new GameSession(field, battle), actors = actorCatalog(), context = actorContext();
  actors.viewpointOffsets = [];
  context.player.id = "-1001";
  actors.characterAssets = initial.state.snapshot().roster.map((member, index) => ({
    id: index + 1, sourceId: member.sourceId, jobId: member.jobId, fieldAssetId: index + 1,
  }));
  actors.conditionTypes = Object.fromEntries(battle.common.conditions.rules.definitions.map((condition) =>
    [condition.id, condition.type]));
  field.characters.alpha = structuredClone(field.characters.hero!);
  field.characters.bravo = structuredClone(field.characters.hero!);
  field.entry.player.asset = "alpha";
  field.entry.transportationId = 1;
  field.entry.partyActors = { kind: "field-party-actors-v1", context, playerAssetCacheId: 1 };
  battle.gameState.partyActors = actors;
  return { field, battle, game: new GameSession(field, battle, 314) };
}
