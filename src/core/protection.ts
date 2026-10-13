/** Source condition types, not condition master row IDs. Proteus is the source
 * enum name for ordinary physical protection; ConditionType.Protect=423 is a
 * different, unsupported behavior. */
export const physicalProtectionType = 19;
export const magicProtectionType = 412;

export type ProtectionBehavior = {
  id: number;
  kind: "physical-protection" | "magic-protection";
  name: string;
  untilType: 2;
  /** Condition.ConditionGroupId supplies resistance selectors, not additional
   * active conditions. Recomputed from the current ordered condition list. */
  resistanceProvider?: {
    groupId: number;
    conditions: Record<string, number>;
  };
};

function nonnegativeInt32(amount: number) {
  if (!Number.isInteger(amount) || amount < 0 || amount > 0x7fffffff)
    throw new Error("Invalid protection damage amount");
}

/** PhysicalExecution 0xa97b20. Inside the non-ignore-defense branch, before
 * normal defense and its +1. The native quotient/remainder path avoids a large
 * amount*170 intermediate and does not itself add one. */
export function physicalProtectionDamage(amount: number): number {
  nonnegativeInt32(amount);
  return Math.trunc(amount / 256) * 170 + Math.trunc(((amount % 256) * 170) / 256);
}

/** MagicExecution 0xa94480. After normal magic defense and its +1, before
 * friendly damage, elements and target-count correction. Shell adds another
 * one only for a nonzero amount. The host excludes native overflow inputs. */
export function magicProtectionDamage(amount: number): number {
  nonnegativeInt32(amount);
  if (amount * 170 > 0x7fffffff)
    throw new Error("Shell arithmetic outside supported nonnegative range");
  return amount === 0 ? 0 : Math.trunc((amount * 170) / 256) + 1;
}
