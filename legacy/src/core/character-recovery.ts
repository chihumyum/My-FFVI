import { BattleConditions } from "./battle-conditions.js";

export type RecoverableJoinedCharacter = {
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  conditionIds: number[];
};

/** Current.JoinCharacter's recovery branch, with its null interpreter context.
 * Only already-admitted active conditions may enter. The host also republishes
 * the field condition appearance after the enclosing roster transaction. */
export function recoverJoinedCharacter<T extends RecoverableJoinedCharacter>(
  member: T,
  conditions: BattleConditions,
): T {
  for (const [key, value] of Object.entries({ hp: member.hp, mp: member.mp, maxHp: member.maxHp, maxMp: member.maxMp }))
    if (!Number.isInteger(value) || value < (key === "maxHp" ? 1 : 0) || value > 0x7fffffff)
      throw new Error("Invalid joined character recovery resource");
  if (member.hp > member.maxHp || member.mp > member.maxMp)
    throw new Error("Joined character resource exceeds confirmed maximum");
  // Current admitted poison/silence/death/dying do not change confirmed maxima.
  // A newly admitted behavior must re-establish that before entering this path.
  conditions.validateActive(member.conditionIds);
  const candidate = structuredClone(member);
  candidate.hp = member.maxHp;
  // set_CurrentHP and RecoveryHp each invoke IfNeededDying.
  candidate.conditionIds = conditions.updateDying(candidate.hp, candidate.maxHp, candidate.conditionIds);
  candidate.conditionIds = conditions.updateDying(candidate.hp, candidate.maxHp, candidate.conditionIds);
  candidate.mp = member.maxMp;
  return removeNullCoreConditions(candidate, conditions);
}

/** Character.RemoveCondition(type0, mc=null): no Current hook/i0 writes.
 * Reused at the caller's actual order boundary; this does not recover HP/MP. */
export function removeNullCoreConditions<T extends RecoverableJoinedCharacter>(member: T, conditions: BattleConditions): T {
  conditions.validateActive(member.conditionIds);
  const candidate = structuredClone(member);
  const removalSnapshot = [...candidate.conditionIds];
  for (const id of removalSnapshot) {
    // duplicationRmove=true compares Condition.Id, not its type.
    candidate.conditionIds = candidate.conditionIds.filter((current) => current !== id);
    if (conditions.types([id])[0] === 5) {
      candidate.hp = Math.min(candidate.hp + 1, candidate.maxHp);
      candidate.conditionIds = conditions.updateDying(candidate.hp, candidate.maxHp, candidate.conditionIds);
    }
  }
  return candidate;
}
