import type { AbilityEffectResult } from "./ability.js";
import type { BattleAIReaction } from "./battle-ai.js";

export type BattleReactionRules = {
  /** This profile has one function group and one result per target per action. */
  counterLimit: 1;
  excludedAbilityIds: number[];
};

export function validateReactionRules(rules: BattleReactionRules) {
  if (
    rules.counterLimit !== 1 ||
    !Array.isArray(rules.excludedAbilityIds) ||
    rules.excludedAbilityIds.some(
      (id) => !Number.isInteger(id) || id <= 0 || id > 0x7fffffff,
    ) ||
    new Set(rules.excludedAbilityIds).size !== rules.excludedAbilityIds.length
  )
    throw new Error("Unimplemented battle reaction rules");
}

/** CounterModule + FF6 IsLocalSerialCounter. For the admitted providers,
 * `missed` maps to HitType.Miss; every other result is eligible for SetCounter,
 * including zero damage, absorption and a successful status-only action.
 * FunctionGroupInfo.GetICalcResult reads the FIRST function, not net HP loss.
 * Other HitTypes/providers must extend this contract before admission.
 */
export function battleReaction(
  rules: BattleReactionRules,
  input: {
    actor: string;
    target: string;
    isCounter: boolean;
    abilityId: number;
    systemId: number;
    primarySlot: number;
    effects: readonly AbilityEffectResult[];
  },
): BattleAIReaction | null {
  if (input.isCounter || input.actor === input.target) return null;
  const first = input.effects[0];
  if (first?.resource === "none") {
    if (first.slot !== input.primarySlot || first.primaryResult !== "empty-dictionary" || first.calcResult !== null)
      throw new Error("Invalid empty primary reaction calculation");
    return null;
  }
  if (!first || typeof first.missed !== "boolean")
    throw new Error("Missing primary reaction calculation");
  if (first.slot !== input.primarySlot)
    throw new Error("Unimplemented primary function reaction calculation");
  if (
    !Number.isInteger(input.abilityId) ||
    input.abilityId <= 0 ||
    input.abilityId > 0x7fffffff
  )
    throw new Error("Missing received ability identity");
  if (
    !Number.isInteger(input.systemId) ||
    input.systemId < 0 ||
    input.systemId > 0x7fffffff
  )
    throw new Error("Missing received ability system identity");
  if (!first.missed && rules.excludedAbilityIds.includes(input.abilityId)) {
    // Excluded recovery abilities can use the separate recovery-ready lane.
    // No such source ability is admitted yet; do not turn it into a no-op.
    if (input.systemId === 2)
      throw new Error("Unimplemented excluded-ability recovery reaction");
    return null;
  }
  return {
    counterReady: !first.missed,
    receivedAbilityId: input.abilityId,
    receivedSystemId: input.systemId,
  };
}
