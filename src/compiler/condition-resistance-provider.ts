import type { WithConditionResistanceProvider } from "../core/battle-conditions.js";
import type { ConditionDefinition } from "../core/conditions.js";
import type { BattleRow } from "./battle.js";
import { compileConditionResistances } from "./condition-resistances.js";
import { tableInteger as int } from "./table.js";

export type ActiveConditionCompilation<T> = {
  behavior: WithConditionResistanceProvider<T> | null;
  sources: BattleRow[];
  blockers: string[];
};

/** BattleConditionFunction.Init 45b450 -> 4dbaf0/4dc770 reads this provider
 * for every function. The caller must first admit the complete behavior
 * lifecycle; this helper never turns an unknown condition into a passive one.
 * It does not grant ordinary ability application or initial activation order. */
export function compileConditionResistanceProvider<T extends object>(
  reader: Parameters<typeof compileConditionResistances>[0],
  row: BattleRow,
  behavior: T | null,
  definitions: readonly ConditionDefinition[],
): ActiveConditionCompilation<T> {
  if (behavior === null) return { behavior: null, sources: [], blockers: [] };
  try {
    const groupId = int(row.values.condition_group_id);
    if (groupId === 0) return { behavior: structuredClone(behavior), sources: [], blockers: [] };
    const provider = compileConditionResistances(reader, groupId, definitions);
    return { behavior: { ...structuredClone(behavior), resistanceProvider: { groupId, conditions: provider.resistances } },
      sources: provider.sources, blockers: [] };
  } catch (error) {
    return { behavior: null, sources: [], blockers: [error instanceof Error ? error.message : String(error)] };
  }
}
