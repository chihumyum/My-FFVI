import type { BattlePlayerReturn } from "./battle-player-participants.js";
import { parseBattlePlayerReturn } from "./battle-player-participants.js";
import { checkpointKeys, checkpointRecord } from "./checkpoint-validation.js";

/** Forced=4 borrows only identities on return. Mutable battle resources are
 * intentionally absent: SaveParameter belongs to the separate, gated result6. */
export type BattleForcedReturnResult = {
  kind: "battle-no-save-return-v1";
  resultType: 4;
  participants: { ownedId: string; sourceId: number }[];
  playerParticipants?: BattlePlayerReturn;
};

export function parseBattleForcedReturnResult(raw: unknown): BattleForcedReturnResult {
  checkpointRecord(raw);
  const value = raw as Record<string, unknown>;
  checkpointKeys(value, "kind,resultType,participants" + (Object.hasOwn(value, "playerParticipants") ? ",playerParticipants" : ""));
  if (value.kind !== "battle-no-save-return-v1" || value.resultType !== 4 || !Array.isArray(value.participants) ||
      Object.keys(value.participants).length !== value.participants.length)
    throw new Error("Invalid no-save forced-return result");
  const seen = new Set<string>(), participants = Array.from(value.participants, rawEntry => {
    checkpointRecord(rawEntry); const entry = rawEntry as Record<string, unknown>; checkpointKeys(entry, "ownedId,sourceId");
    if (typeof entry.ownedId !== "string" || !entry.ownedId.length || seen.has(entry.ownedId) ||
        typeof entry.sourceId !== "number" || !Number.isSafeInteger(entry.sourceId) || entry.sourceId < 1 || entry.sourceId > 0x7fffffff)
      throw new Error("Invalid forced-return participant identity");
    seen.add(entry.ownedId); return { ownedId: entry.ownedId, sourceId: entry.sourceId };
  });
  return { kind: "battle-no-save-return-v1", resultType: 4, participants,
    ...(Object.hasOwn(value, "playerParticipants") ? { playerParticipants: parseBattlePlayerReturn(value.playerParticipants) } : {}) };
}
