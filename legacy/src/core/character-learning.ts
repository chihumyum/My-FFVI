import { checkpointKeys } from "./checkpoint-validation.js";
import type { OwnedCharacterAbilities, OwnedAbility } from "./owned-character.js";

/** One immutable source catalog serves action observation and result learning.
 * Candidate order is the master Ability dictionary order, not action order. */
export type ObservedLearningCatalog = {
  kind: "observed-learning-v1";
  observerSourceId: 8;
  recipientAbilityId: 74;
  commandId: 17;
  forbiddenConditionTypes: number[];
  commandAbilityTypes: number[];
  candidates: {
    observedAbilityId: number;
    abilityId: number;
    contentId: number;
    typeId: number;
    groupId: number;
  }[];
};
export type ObservedLearningReceipt = {
  battleSerial: number;
  participantIndex: number;
  /** StatusUp runs natural level learning before ExecutionLearning. */
  level: number;
  observedAbilityIds: number[];
};
export type LearningObserver = {
  sourceId: number;
  conditionTypes: readonly number[];
  abilities: Pick<OwnedCharacterAbilities, "owned"> | null;
};
const forbidden = [5, 11, 9, 7, 17, 34, 12, 630, 410];
function integer(n: number, min = 0): void {
  if (!Number.isSafeInteger(n) || n < min || n > 0x7fffffff) throw new Error("Invalid observed learning integer");
}
export function validateObservedLearningCatalog(catalog: ObservedLearningCatalog): void {
  checkpointKeys(catalog, "kind,observerSourceId,recipientAbilityId,commandId,forbiddenConditionTypes,commandAbilityTypes,candidates");
  if (catalog.kind !== "observed-learning-v1" || catalog.observerSourceId !== 8 ||
      catalog.recipientAbilityId !== 74 || catalog.commandId !== 17 ||
      JSON.stringify(catalog.forbiddenConditionTypes) !== JSON.stringify(forbidden))
    throw new Error("Unsupported observed learning source rules");
  if (!Array.isArray(catalog.commandAbilityTypes) || !catalog.commandAbilityTypes.length)
    throw new Error("Missing observation command filter");
  catalog.commandAbilityTypes.forEach((id) => integer(id, 1));
  if (new Set(catalog.commandAbilityTypes).size !== catalog.commandAbilityTypes.length)
    throw new Error("Ambiguous observation command filter");
  if (!Array.isArray(catalog.candidates)) throw new Error("Missing observed learning candidates");
  const seen = new Set<number>();
  for (const row of catalog.candidates) {
    checkpointKeys(row, "observedAbilityId,abilityId,contentId,typeId,groupId");
    integer(row.observedAbilityId, 1); integer(row.abilityId, 1); integer(row.contentId, 1);
    integer(row.typeId, 1); integer(row.groupId);
    if (seen.has(row.observedAbilityId)) throw new Error("Duplicate observed learning candidate");
    seen.add(row.observedAbilityId);
  }
}

/** CheckAndSetLearningAbility executes at action start. It examines the first
 * source8 unit only, irrespective of the actor/target or that unit's ability74.
 * Result learning separately checks ability74 ownership. */
export function observeLearningAction(
  catalog: ObservedLearningCatalog,
  ability: { id: number; typeId: number },
  players: readonly LearningObserver[],
): number[] {
  validateObservedLearningCatalog(catalog);
  integer(ability.id, 1); integer(ability.typeId);
  if (ability.typeId !== 504) return [];
  const row = catalog.candidates.find((r) => r.observedAbilityId === ability.id);
  if (!row) throw new Error("Missing source observation ability");
  const observer = players.find((p) => p.sourceId === catalog.observerSourceId);
  if (!observer) return [];
  if (!Array.isArray(observer.conditionTypes) || observer.abilities === null)
    throw new Error("Missing source observation character context");
  observer.conditionTypes.forEach((id) => integer(id, 1));
  if (observer.conditionTypes.some((type) => catalog.forbiddenConditionTypes.includes(type))) return [];
  // The native filter is command17's group/type filter followed by FF6's
  // SkillLevel > 99 provider. Never trust stored byCommand as ownership.
  const learned = observer.abilities.owned.some((owned) => owned.abilityId === row.abilityId &&
    owned.contentId === row.contentId && owned.skillLevel >= 100 && row.groupId !== 0 &&
    catalog.commandAbilityTypes.includes(row.typeId));
  return learned ? [] : [ability.id];
}

/** GetLearningAbility's master-table order and raw ability74 ownership gate.
 * SkillLevel of ability74 does not participate. Returned rows are detached. */
export function observedLearningRows(
  catalog: ObservedLearningCatalog,
  owned: readonly OwnedAbility[],
  observedAbilityIds: readonly number[],
): ObservedLearningCatalog["candidates"] {
  validateObservedLearningCatalog(catalog);
  if (!Array.isArray(observedAbilityIds)) throw new Error("Missing observed battle abilities");
  observedAbilityIds.forEach((id) => integer(id, 1));
  if (new Set(observedAbilityIds).size !== observedAbilityIds.length)
    throw new Error("Duplicate observed battle ability");
  // Qualifying logs contain only flagged Type504 acts. Missing/unknown IDs must
  // not become a permissive fallback to the former all-actions log.
  if (observedAbilityIds.some((id) => !catalog.candidates.some((r) => r.observedAbilityId === id)))
    throw new Error("Unknown observed battle ability");
  if (!owned.some((a) => a.abilityId === catalog.recipientAbilityId)) return [];
  return structuredClone(catalog.candidates.filter((r) => observedAbilityIds.includes(r.observedAbilityId)));
}

/** ExecutionLearning mutates OwnedAbilityList and global OwnedMagicList only.
 * It does not append to owned additionOrder, sortOrder or initial history. */
export function applyObservedLearning(
  catalog: ObservedLearningCatalog,
  abilities: OwnedCharacterAbilities,
  observedAbilityIds: readonly number[],
): { abilities: OwnedCharacterAbilities; ownedMagicToAppend: number[] } {
  const rows = observedLearningRows(catalog, abilities.owned, observedAbilityIds);
  const next = structuredClone(abilities), ownedMagicToAppend: number[] = [];
  for (const row of rows) {
    let owned = next.owned.find((a) => a.abilityId === row.abilityId);
    if (owned) {
      if (owned.contentId !== row.contentId) throw new Error("Observed learning content identity changed");
      owned.skillLevel = 100;
    } else {
      owned = { abilityId: row.abilityId, contentId: row.contentId, skillLevel: 100 };
      next.owned.push(owned);
    }
    if (!ownedMagicToAppend.includes(row.contentId)) ownedMagicToAppend.push(row.contentId);
  }
  return { abilities: next, ownedMagicToAppend };
}
