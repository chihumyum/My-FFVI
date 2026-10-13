import type { BattleEventOp } from "../../src/core/battle-event.js";
import { participantSessionFixture } from "./battle-participant-game.js";
import { fixtureRosterLifecycle } from "./roster-lifecycle.js";

/** Source status33 is only an operation parameter here. These owned actors,
 * maps and events are synthetic; this does not admit the original story. */
export function playerSessionFixture(ops: BattleEventOp[] = [
  { kind: "add-player", sourceId: 33 }, { kind: "wait", seconds: 0.05 },
  { kind: "change-player-group", group: 1 }, { kind: "wait", seconds: 0.05 },
  { kind: "change-player-group", group: 0 }, { kind: "add-player", sourceId: 33 },
]) {
  const f = participantSessionFixture(ops), template = f.battle.common.players[0]!;
  f.battle.common.sprites.synthetic = { file: "synthetic.png", width: 16, height: 16 };
  f.battle.common.players.push(...[
    ["guest:33", 33], ["c", 1002], ["d", 1003],
  ].map(([id, sourceId]) => ({ ...structuredClone(template), id: id as string,
    sourceId: sourceId as number, name: "Synthetic owned " + id })));
  f.battle.gameState.rosterLifecycle = fixtureRosterLifecycle(f.battle.common.players);
  for (const player of f.battle.common.players) f.battle.gameState.equipment[player.id] = [1, 2, 3, 4, 5, 5];
  const party = f.battle.gameState.initialParty;
  party.slots[0][1] = { id: null, row: "back" }; party.slots[0][2] = { id: "b", row: "front" };
  party.slots[1][1] = { id: "c", row: "back" }; party.slots[1][3] = { id: "d", row: "front" };
  f.battle.encounters[1000]!.playerParticipants = {
    kind: "battle-player-plan-v1", profile: "web-owned-borrow-v1", sourceIds: [33],
    groups: [0, 1], rewardScope: "all-entered", returnParty: "preserve-entry",
  };
  return f;
}
