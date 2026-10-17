import { ConditionRules } from "./conditions.js";
import type { ConditionChange } from "./battle-conditions.js";

/** Bound by the source ConditionType lookup, not by a persistent defending bit. */
export type DefendCatalog = {
  conditionId: number;
  conditionType: 1;
  untilType: 1;
};
export type DefendEffect = {
  slot: number;
  kind: "defend";
  conditionId: number;
};
export type DefendAdmission = {
  route: "atb" | "direct";
  /** The complete accepted action group; ordinary items can have no abilities. */
  abilities: readonly { id: number; type: number }[];
  /** The current host has no native chain stack. It must not invent an empty
   * stack when importing an action from a future chain provider. */
  nativeChain: "empty" | "unresolved";
};

function validate(catalog: DefendCatalog, rules: ConditionRules, ids: readonly number[]) {
  if (catalog.conditionType !== 1 || catalog.untilType !== 1 ||
      !rules.hasType([catalog.conditionId], 1))
    throw new Error("Invalid Defend lifecycle catalog");
  // Validate every identity even when a subsequent source branch short-circuits.
  rules.hasType(ids, 1);
  if (ids.some((id) => id !== catalog.conditionId && rules.hasType([id], 1)))
    throw new Error("Unresolved alternative Defend identity");
}

/** BattleFunction15.UpdateParameter (0x979d50) directly appends the source
 * record, then the shared condition-conflict stage runs. This is not ordinary
 * AddCondition: no resistance, IsAddable, accuracy check or random draw. */
export function applyDefend(
  catalog: DefendCatalog,
  rules: ConditionRules,
  currentIds: readonly number[],
  actorId: string,
  targetId: string,
): ConditionChange {
  validate(catalog, rules, currentIds);
  if (!actorId || actorId !== targetId)
    throw new Error("Defend requires the source self target");
  const result = rules.resolveConflict({
    currentIds: [...currentIds, catalog.conditionId],
    equipmentIds: [],
    incomingId: catalog.conditionId,
  });
  return {
    currentIds: result.currentIds,
    added: [catalog.conditionId],
    removed: result.removed.map((removed) => removed.id),
    missed: false,
  };
}

/** ATB.SetActData (0x679920) calls Recovery(actor, until=1) after admission and
 * before charging/presentation. ActDecisionUpdate itself does not expire it.
 * Direct counter/reaction execution does not cross this boundary. The native
 * special chain/selection branches are deliberately blocked when relevant. */
export function clearDefendOnAdmission(
  catalog: DefendCatalog,
  rules: ConditionRules,
  currentIds: readonly number[],
  admission: DefendAdmission,
): ConditionChange {
  validate(catalog, rules, currentIds);
  if (!["atb", "direct"].includes(admission.route) ||
      !["empty", "unresolved"].includes(admission.nativeChain) ||
      !Array.isArray(admission.abilities) ||
      admission.abilities.some(({ id, type }) =>
        !Number.isInteger(id) || id <= 0 || id > 0x7fffffff ||
        !Number.isInteger(type) || type < 0 || type > 0x7fffffff))
    throw new Error("Invalid Defend action admission");
  const unchanged: ConditionChange = {
    currentIds: [...currentIds], added: [], removed: [], missed: false,
  };
  if (admission.route === "direct" || !currentIds.includes(catalog.conditionId))
    return unchanged;
  if (admission.nativeChain !== "empty" || rules.hasType(currentIds, 506) ||
      admission.abilities.some(({ id, type }) =>
        [17, 83].includes(id) || [8, 40, 41].includes(type)))
    throw new Error("Unresolved Defend ATB chain/selection exception");
  return {
    currentIds: currentIds.filter((id) => id !== catalog.conditionId),
    added: [],
    removed: currentIds.filter((id) => id === catalog.conditionId),
    missed: false,
  };
}
