import { checkpointKeys } from "./checkpoint-validation.js";
import type { RosterMember } from "./roster.js";
import type { EquipmentCharacter, EquipmentParameterContext } from "./equipment.js";
import type { ParameterLimits, ParameterValues } from "./parameters.js";
import type { PhysicalLimits } from "./physical-parameters.js";

export type OwnedAbility = {
  abilityId: number;
  /** Native null Content is persisted as contentId=0. */
  contentId: number;
  skillLevel: number;
};
export type OwnedCharacterAbilities = {
  commandIds: number[];
  owned: OwnedAbility[];
  /** Only commands with a nonempty native SetTargetAbilityList projection. */
  byCommand: { commandId: number; abilityIds: number[] }[];
  /** These two order lists use CONTENT identities, not ability identities. */
  additionOrder: number[];
  sortOrder: number[];
  slots: { level: number; abilityIds: (number | null)[] }[];
  skillLevelTargets: Record<string, number>;
  learning: number[];
  equipment: number[];
};
export type InitializedOwnedCharacter = RosterMember & {
  name: string;
  level: number;
  exp: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  conditionIds: number[];
  abilities: OwnedCharacterAbilities;
};
export type OwnedCharacterInitializationTemplate = {
  kind: "owned-character-initialization-v1";
  /** Localization key and substitution tag are separate source namespaces. */
  nameKey: string;
  nameTag: string | null;
  initial: Omit<InitializedOwnedCharacter, "id" | "ownedId" | "ownedJobs">;
  parameterContext: EquipmentParameterContext;
  limits: { parameters: ParameterLimits; physical: PhysicalLimits };
  equipmentCharacter: EquipmentCharacter;
  confirmed: ParameterValues;
  /** Source base values retained even where the current battle model does not use them. */
  base: {
    level: number;
    intelligence: number;
    spirit: number;
    luck: number;
    mpCounts: number[];
  };
  jobIds: number[];
};

function integer(n: number, min = 0, max = 0x7fffffff): number {
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("Invalid owned character initialization integer");
  return n;
}
function unique(values: readonly number[], label: string) {
  if (new Set(values).size !== values.length)
    throw new Error("Duplicate owned character " + label);
}

/** Validation also serves save admission; unknown learned or command identities
 * cannot be silently converted into a new source initialization. */
export function validateOwnedCharacterAbilities(value: OwnedCharacterAbilities): void {
  checkpointKeys(value, "commandIds,owned,byCommand,additionOrder,sortOrder,slots,skillLevelTargets,learning,equipment");
  for (const ids of [value.commandIds, value.additionOrder, value.sortOrder, value.learning, value.equipment]) {
    if (!Array.isArray(ids)) throw new Error("Missing owned character ability list");
    ids.forEach((id) => integer(id, ids === value.equipment ? 0 : 1));
  }
  if (!Array.isArray(value.owned) || !Array.isArray(value.byCommand) || !Array.isArray(value.slots))
    throw new Error("Missing owned character abilities");
  unique(value.owned.map((a) => a.abilityId), "ability identity");
  const owned = new Map(value.owned.map((a) => [a.abilityId, a]));
  for (const ability of value.owned) {
    checkpointKeys(ability, "abilityId,contentId,skillLevel");
    integer(ability.abilityId, 1);
    integer(ability.contentId);
    integer(ability.skillLevel, 0, 100);
  }
  unique(value.additionOrder, "addition order");
  unique(value.sortOrder, "sort order");
  for (const id of [...value.additionOrder, ...value.sortOrder])
    if (!value.owned.some((a) => a.contentId === id))
      throw new Error("Unowned ability order content");
  unique(value.byCommand.map((c) => c.commandId), "command projection");
  for (const command of value.byCommand) {
    checkpointKeys(command, "commandId,abilityIds");
    if (!value.commandIds.includes(command.commandId) || !Array.isArray(command.abilityIds) || !command.abilityIds.length)
      throw new Error("Invalid owned command ability projection");
    for (const id of command.abilityIds)
      if (!owned.has(id) || owned.get(id)!.skillLevel < 100)
        throw new Error("Unlearned command ability");
  }
  if (value.slots.length !== 8) throw new Error("Missing source ability levels");
  for (const [index, slot] of value.slots.entries()) {
    checkpointKeys(slot, "level,abilityIds");
    if (slot.level !== index + 1 || !Array.isArray(slot.abilityIds) || slot.abilityIds.length !== 3)
      throw new Error("Invalid source ability slots");
    for (const id of slot.abilityIds)
      if (id !== null && !owned.has(id)) throw new Error("Unowned slotted ability");
  }
  checkpointKeys(value.skillLevelTargets, "");
}

/** Returns a detached candidate and ordered side effects. The caller publishes
 * member, equipment registration, name binding and global history together. */
export function createOwnedCharacter(
  template: OwnedCharacterInitializationTemplate,
  request: {
    id: string;
    ownedId: number;
    releasedJobIds: readonly number[];
    learnedAbilityIds: readonly number[];
  },
): {
  member: InitializedOwnedCharacter;
  learnedAbilityIdsToAppend: number[];
  nameBinding: { key: string; value: string } | null;
} {
  if (template.kind !== "owned-character-initialization-v1" || !request.id || typeof request.id !== "string" || !template.nameKey)
    throw new Error("Invalid owned character initialization template");
  if (template.nameTag !== null && (typeof template.nameTag !== "string" || !template.nameTag))
    throw new Error("Invalid initial character name tag");
  integer(request.ownedId, 1);
  unique(template.jobIds, "job catalog");
  unique(request.releasedJobIds, "released job");
  unique(request.learnedAbilityIds, "learned history");
  request.learnedAbilityIds.forEach((id) => integer(id, 1));
  template.jobIds.forEach((id) => integer(id, 1));
  const initial = template.initial;
  for (const jobId of [initial.jobId, ...request.releasedJobIds])
    if (!template.jobIds.includes(integer(jobId, 1)))
      throw new Error("Unknown initialization job");
  if (!initial.enabled || initial.magicStoneId !== 0 || !initial.name || initial.conditionIds.length)
    throw new Error("Unresolved initial owned character state");
  integer(initial.sourceId, 1);
  integer(initial.level, 1, 99);
  if (initial.additionalLevel !== initial.level)
    throw new Error("Initial level differs from native additional level");
  integer(initial.exp);
  integer(initial.maxHp, 1);
  integer(initial.maxMp);
  integer(initial.hp, 0, initial.maxHp);
  integer(initial.mp, 0, initial.maxMp);
  if (initial.equipment.length !== 6) throw new Error("Missing initial equipment");
  initial.equipment.forEach((id) => integer(id, 1));
  validateOwnedCharacterAbilities(initial.abilities);
  const member: InitializedOwnedCharacter = {
    ...structuredClone(initial),
    id: request.id,
    ownedId: request.ownedId,
    ownedJobs: [initial.jobId, ...request.releasedJobIds.filter((id) => id !== initial.jobId)]
      .map((id) => ({ id, level: 1, proficiency: 0 })),
  };
  const seen = new Set(request.learnedAbilityIds);
  const learnedAbilityIdsToAppend: number[] = [];
  for (const { abilityId } of member.abilities.owned)
    if (!seen.has(abilityId)) {
      seen.add(abilityId);
      learnedAbilityIdsToAppend.push(abilityId);
    }
  return { member, learnedAbilityIdsToAppend,
    nameBinding: template.nameTag === null ? null : { key: template.nameTag, value: member.name } };
}
