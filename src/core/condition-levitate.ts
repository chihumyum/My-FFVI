import { validateElementResistances, type ElementResistances } from "./elements.js";

export const levitateConditionType = 409;
/** Original metadata initializer62E917E8... and IsForceMissAbilityForLeviteto
 * 0xa8f100. These are common source ability identities, never battle/PC cases. */
const forceMissAbilities: readonly number[] = [211, 226, 227];
export type LevitateBehavior = {
  id: number; kind: "levitate"; name: string; untilType: 3;
  elementProvider: { groupId: number; resistances: ElementResistances };
};
export function validateLevitateBehavior(behavior: LevitateBehavior): void {
  const provider = behavior.elementProvider;
  if (!provider || !Number.isInteger(provider.groupId) || provider.groupId <= 0 || provider.groupId > 0x7fffffff)
    throw new Error("Invalid Leviteto element provider");
  validateElementResistances(provider.resistances);
  if (Object.keys(provider.resistances).length !== 1 || provider.resistances[4] !== 3)
    throw new Error("Unresolved Leviteto element provider shape");
}
/** GetMagicStatus checks this before ordinary hit/damage randomness. Carrier
 * dispatch and numeric validation must already have admitted the whole plan. */
export function levitateForcesMagicMiss(abilityId: number | undefined, conditionTypes: readonly number[]): boolean {
  if (abilityId !== undefined && (!Number.isInteger(abilityId) || abilityId <= 0 || abilityId > 0x7fffffff))
    throw new Error("Invalid magic source ability identity");
  return abilityId !== undefined && forceMissAbilities.includes(abilityId) && conditionTypes.includes(levitateConditionType);
}
