import type {
  AbilityEffect,
  AbilityEffectResult,
  DevelopmentAbilityPlan,
} from "./ability.js";
import type { BattleConditions } from "./battle-conditions.js";

type ConditionRecovery = Extract<AbilityEffect, { kind: "recover-condition" }>;
type HpRecovery = Extract<AbilityEffect, { kind: "recover-max-hp" }>;

/** A reviewed two-slot composition, not admission for arbitrary mixed effects. */
export function revivalEffects(
  plan: DevelopmentAbilityPlan,
): [ConditionRecovery, HpRecovery] | null {
  const [first, second] = plan.effects;
  return plan.effects.length === 2 &&
    first?.kind === "recover-condition" &&
    second?.kind === "recover-max-hp"
    ? [first, second]
    : null;
}

export function calculateRevivalEffects(
  plan: DevelopmentAbilityPlan,
  conditions: BattleConditions,
  target: { maxHp: number; conditionIds: number[] },
): { effects: AbilityEffectResult[]; conditionIds: number[] } {
  const sequence = revivalEffects(plan);
  if (!sequence) throw new Error("Unimplemented revival composition");
  const [recovery, restore] = sequence;
  if (
    !Number.isInteger(target.maxHp) ||
    target.maxHp < 1 ||
    target.maxHp > 0x7fffffff ||
    !Number.isInteger(restore.value) ||
    restore.value <= 0 ||
    !["percent", "divide"].includes(restore.mode) ||
    (restore.mode === "percent" && restore.value > 100) ||
    recovery.slot >= restore.slot ||
    !recovery.conditionIds.length ||
    recovery.conditionIds.some((id) => !conditions.isUnableFight([id]))
  )
    throw new Error("Invalid revival inputs");
  const change = conditions.recover(target.conditionIds, recovery.conditionIds);
  // Function groups calculate/update each slot before the next; a prior miss
  // prevents the later slot from producing free healing on a living target.
  const amount =
    restore.mode === "percent"
      ? Math.trunc(Math.imul(target.maxHp, restore.value) / 100)
      : Math.min(9999, Math.trunc(target.maxHp / restore.value));
  if (amount < 0) throw new Error("Unsupported revival HP overflow");
  return {
    conditionIds: change.currentIds,
    effects: [
      {
        slot: recovery.slot,
        resource: "condition",
        recovery: true,
        added: [],
        removed: change.removed,
        missed: change.missed,
      },
      {
        slot: restore.slot,
        resource: "hp",
        recovery: true,
        amount: change.missed ? 0 : amount,
        missed: change.missed,
      },
    ],
  };
}
