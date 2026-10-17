import type { GameStateContent } from "../../src/core/game-state.js";

/** Deliberately synthetic lifecycle metadata, never a source initialization fallback. */
export function fixtureRosterLifecycle(
  players: readonly { id: string; level: number }[],
): GameStateContent["rosterLifecycle"] {
  return {
    jobIds: [1],
    releasedJobIds: [1],
    firstJoinLevelAdjustments: {},
    initial: Object.fromEntries(
      players.map((p, index) => [
        p.id,
        {
          ownedId: index + 1,
          jobId: 1,
          additionalLevel: p.level,
          magicStoneId: 0,
          ownedJobs: [{ id: 1, level: 1, proficiency: 0 }],
        },
      ]),
    ),
  };
}
