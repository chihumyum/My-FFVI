import type { AbilityFunction, DevelopmentAbilityPlan } from "./ability.js";

export type ItemStack = { id: number; count: number };
export type ItemUse = {
  program: { groupId: number; range: number; functions: AbilityFunction[] };
  plan: DevelopmentAbilityPlan | null;
  blockers: string[];
};
/** Content IDs identify stock. Item row IDs and ability IDs are separate namespaces. */
export type ItemDefinition = {
  id: number;
  itemId: number;
  name: string;
  important: boolean;
  power: number;
  systemId: number;
  forbiddenConditionIds: number[];
  uses: { menu: ItemUse; battle: ItemUse };
};
export type BattleInventory = {
  definitions: Record<string, ItemDefinition>;
  stacks: ItemStack[];
  limit: number;
};

export function validateItemStacks(
  stacks: readonly ItemStack[],
  definitions: Record<string, ItemDefinition>,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 0x7fffffff)
    throw new Error("Invalid inventory limit");
  const seen = new Set<number>();
  for (const stack of stacks) {
    if (
      Object.keys(stack).sort().join(",") !== "count,id" ||
      !Number.isSafeInteger(stack.id) ||
      stack.id <= 0 ||
      definitions[stack.id]?.id !== stack.id ||
      !Number.isSafeInteger(stack.count) ||
      stack.count < 0 ||
      stack.count > limit ||
      seen.has(stack.id)
    )
      throw new Error("Invalid inventory stack");
    seen.add(stack.id);
  }
}
