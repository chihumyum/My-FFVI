import { applyObservedLearning, observedLearningRows, validateObservedLearningCatalog, type ObservedLearningCatalog, type ObservedLearningReceipt } from "./character-learning.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { validateOwnedCharacterAbilities, type OwnedCharacterAbilities, type OwnedAbility } from "./owned-character.js";

/** Additional parameter storage is not the capped equipment projection. */
export type CharacterGrowthAdditional = {
  hp: number; mp: number; strength: number; vitality: number; agility: number; magic: number;
};
export type CharacterGrowthProgress = {
  additionalExp: number;
  additional: CharacterGrowthAdditional;
  observedLearning: ObservedLearningReceipt[];
};
export type CharacterGrowthMember = {
  sourceId: number; jobId: number; additionalLevel: number; magicStoneId: number;
  level: number; exp: number; hp: number; mp: number; maxHp: number; maxMp: number;
  equipment: number[]; abilities: OwnedCharacterAbilities;
};
export type CharacterGrowthPlan = {
  kind: "character-growth-v1";
  sourceId: number; jobId: number; baseExp: number; initialLevel: number;
  maxExp: number; maxLevel: number;
  experience: { id: number; level: number; totalExp: number }[];
  growth: { id: number; level: number; hp: number; mp: number }[];
  learning: { id: number; level: number; abilityId: number; contentId: number }[];
  initialAbilities: OwnedCharacterAbilities;
  abilities: { id: number; typeId: number; groupId: number; contentId: number }[];
  commands: { id: number; abilityTypes: number[] }[];
  /** Matching these source records requires separate learning providers. */
  equipmentLearningContentIds: number[];
  hasBattleBackgroundLearning: boolean;
  /** GetLearningAbility considers source Ability.TypeId=504. */
  observedLearningAbilityIds: number[];
  observedLearning?: ObservedLearningCatalog;
};
export type CharacterGrowthRequest =
  | { kind: "correct-level"; targetLevel: number }
  | { kind: "add-experience"; amount: number; context: "field" }
  | { kind: "add-experience"; amount: number; context: "battle";
      /** Source IsLearningAbility acts only when the catalog is supplied. */
      observedAbilityIds: readonly number[];
      learningReceipt?: { battleSerial: number; participantIndex: number } };
export type CharacterGrowthStep = {
  level: number; hp: number; mp: number; learnedAbilityIds: number[];
};
export type CharacterGrowthProjection = {
  level: number; exp: number; additional: CharacterGrowthAdditional;
  abilities: OwnedCharacterAbilities;
};

export const firstJoinLevelAdjustments: Readonly<Record<string, number>> = Object.fromEntries(
  [0, 2, 2, 0, 2, 2, 0, 2, 0, 0, 5, 2, 2, 0, -3, 5, 2, -3, 2, 0, 0, -3, 0, 2, 2, 0, 0, 2, 5, 0, -3, -3]
    .map((value, index) => [String(index + 1), value]),
);

function integer(value: number, min = 0, max = 0x7fffffff): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error("Invalid character growth integer");
  return value;
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key) => Object.hasOwn(b, key) &&
    same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
export function initialCharacterGrowth(): CharacterGrowthProgress {
  return { additionalExp: 0, additional: { hp: 0, mp: 0, strength: 0, vitality: 0, agility: 0, magic: 0 }, observedLearning: [] };
}

function validatePlan(plan: CharacterGrowthPlan): void {
  if (plan.kind !== "character-growth-v1") throw new Error("Unknown character growth plan");
  integer(plan.sourceId, 1); integer(plan.jobId, 1);
  integer(plan.maxLevel, 1, 99); integer(plan.maxExp, 1);
  integer(plan.baseExp, 0, plan.maxExp); integer(plan.initialLevel, 1, plan.maxLevel);
  if (plan.experience.length !== plan.maxLevel || plan.growth.length !== plan.maxLevel)
    throw new Error("Incomplete character growth levels");
  for (let i = 0; i < plan.maxLevel; i++) {
    const exp = plan.experience[i]!, growth = plan.growth[i]!;
    if (exp.level !== i + 1 || growth.level !== i + 1)
      throw new Error("Ambiguous character growth level");
    if (exp.id !== exp.level) throw new Error("Unresolved correction experience identity");
    integer(exp.id, 1); integer(growth.id, 1);
    integer(exp.totalExp, 0, plan.maxExp); integer(growth.hp); integer(growth.mp);
    if (i && exp.totalExp <= plan.experience[i - 1]!.totalExp)
      throw new Error("Nonincreasing character experience curve");
  }
  if (plan.experience[0]!.totalExp !== 0) throw new Error("Missing initial experience threshold");
  validateOwnedCharacterAbilities(plan.initialAbilities);
  if (new Set(plan.abilities.map((a) => a.id)).size !== plan.abilities.length)
    throw new Error("Ambiguous growth ability identity");
  for (const ability of plan.abilities) {
    integer(ability.id, 1); integer(ability.typeId); integer(ability.groupId); integer(ability.contentId);
  }
  for (const learning of plan.learning) {
    integer(learning.id, 1); integer(learning.level, 1, plan.maxLevel);
    const ability = plan.abilities.find((a) => a.id === learning.abilityId);
    if (!ability || !learning.contentId || ability.contentId !== learning.contentId)
      throw new Error("Unresolved growth learning ability");
  }
  if (typeof plan.hasBattleBackgroundLearning !== "boolean" || !Array.isArray(plan.equipmentLearningContentIds))
    throw new Error("Missing character learning guards");
  plan.equipmentLearningContentIds.forEach((id) => integer(id, 1));
  if (!Array.isArray(plan.observedLearningAbilityIds)) throw new Error("Missing observed learning catalog");
  plan.observedLearningAbilityIds.forEach((id) => integer(id, 1));
  if (new Set(plan.observedLearningAbilityIds).size !== plan.observedLearningAbilityIds.length)
    throw new Error("Duplicate observed learning identity");
  if (plan.observedLearning) {
    validateObservedLearningCatalog(plan.observedLearning);
    if (!same(plan.observedLearningAbilityIds, plan.observedLearning.candidates.map((r) => r.observedAbilityId)))
      throw new Error("Observed learning catalog order changed");
    for (const row of plan.observedLearning.candidates)
      if (!plan.abilities.some((a) => a.id === row.abilityId && a.contentId === row.contentId &&
          a.typeId === row.typeId && a.groupId === row.groupId))
        throw new Error("Missing observed learning ability metadata");
  }
  for (const command of plan.commands) {
    if (!plan.initialAbilities.commandIds.includes(integer(command.id, 1)))
      throw new Error("Unowned growth command");
    command.abilityTypes.forEach((id) => integer(id));
  }
}
function levelFromExp(plan: CharacterGrowthPlan, exp: number): number {
  return Math.max(...plan.experience.filter((row) => row.totalExp <= exp).map((row) => row.level));
}
function grant(abilities: OwnedCharacterAbilities, row: CharacterGrowthPlan["learning"][number]): void {
  let owned = abilities.owned.find((a) => a.abilityId === row.abilityId);
  if (!owned) {
    owned = { abilityId: row.abilityId, contentId: row.contentId, skillLevel: 0 };
    abilities.owned.push(owned);
    // Native newly constructed abilities enter this CONTENT list before learning.
    abilities.additionOrder.push(row.contentId);
  }
  if (owned.contentId !== row.contentId) throw new Error("Growth ability content identity changed");
  owned.skillLevel = 100;
  if (!abilities.additionOrder.includes(owned.contentId)) abilities.additionOrder.push(owned.contentId);
}
function projectCommands(plan: CharacterGrowthPlan, abilities: OwnedCharacterAbilities): void {
  abilities.byCommand = [];
  for (const command of plan.commands) {
    const ids: number[] = [];
    for (const type of command.abilityTypes)
      for (const owned of abilities.owned) {
        const source = plan.abilities.find((a) => a.id === owned.abilityId);
        if (!source) throw new Error("Unknown growth ability");
        if (source.typeId === type && source.groupId !== 0 && owned.skillLevel >= 100)
          ids.push(owned.abilityId);
      }
    if (!ids.length) continue;
    const existing = abilities.byCommand.find((c) => c.commandId === command.id);
    if (existing) {
      for (const id of ids) if (!existing.abilityIds.includes(id)) existing.abilityIds.push(id);
    } else abilities.byCommand.push({ commandId: command.id, abilityIds: ids });
  }
}

/** Reconstructs only admitted, monotone ordinary growth from source initialization.
 * External learning, job changes and esper bonuses must get another proven plan. */
export function expectedOwnedGrowth(plan: CharacterGrowthPlan, progress: CharacterGrowthProgress): CharacterGrowthProjection {
  validatePlan(plan);
  checkpointKeys(progress, "additionalExp,additional,observedLearning");
  integer(progress.additionalExp, 0, plan.maxExp);
  checkpointKeys(progress.additional, "hp,mp,strength,vitality,agility,magic");
  Object.values(progress.additional).forEach((value) => integer(value));
  const exp = Math.min(plan.maxExp, plan.baseExp + progress.additionalExp);
  const level = levelFromExp(plan, exp);
  if (level < plan.initialLevel || levelFromExp(plan, plan.baseExp) !== plan.initialLevel)
    throw new Error("Unresolved character growth origin");
  const additional = initialCharacterGrowth().additional;
  let abilities = structuredClone(plan.initialAbilities);
  if (!Array.isArray(progress.observedLearning)) throw new Error("Missing observed learning progress");
  let serial = -1, learnedAt = plan.initialLevel;
  for (const receipt of progress.observedLearning) {
    checkpointKeys(receipt, "battleSerial,participantIndex,level,observedAbilityIds");
    // The common result owner uses first-entry ordinals for explicit Web
    // borrowing. This is not a native Corps-position range claim.
    integer(receipt.battleSerial); integer(receipt.participantIndex);
    integer(receipt.level, plan.initialLevel, level);
    if (receipt.battleSerial <= serial || receipt.level < learnedAt || !plan.observedLearning)
      throw new Error("Invalid observed learning receipt order or provider");
    serial = receipt.battleSerial; learnedAt = receipt.level;
  }
  const observeAt = (at: number) => {
    for (const receipt of progress.observedLearning.filter((r) => r.level === at)) {
      const rows = observedLearningRows(plan.observedLearning!, abilities.owned, receipt.observedAbilityIds);
      if (!rows.length || !same(rows.map((r) => r.observedAbilityId), receipt.observedAbilityIds))
        throw new Error("Invalid observed learning receipt identity or order");
      abilities = applyObservedLearning(plan.observedLearning!, abilities, receipt.observedAbilityIds).abilities;
    }
  };
  observeAt(plan.initialLevel);
  for (let next = plan.initialLevel + 1; next <= level; next++) {
    const row = plan.growth[next - 1]!;
    additional.hp = integer(additional.hp + row.hp);
    additional.mp = integer(additional.mp + row.mp);
    for (const learning of plan.learning.filter((l) => l.level === next)) grant(abilities, learning);
    observeAt(next);
  }
  // Command availability is a projection using the recovered FF6 filter.
  projectCommands(plan, abilities);
  validateOwnedCharacterAbilities(abilities);
  return { level, exp, additional, abilities };
}

export function validateCharacterGrowth(plan: CharacterGrowthPlan, member: CharacterGrowthMember,
  progress: CharacterGrowthProgress, equipmentAbilities: readonly OwnedAbility[] = []): void {
  const expected = expectedOwnedGrowth(plan, progress);
  validateOwnedCharacterAbilities(member.abilities, equipmentAbilities);
  const passiveIds = new Set(equipmentAbilities.map((a) => a.abilityId));
  if (expected.abilities.owned.some((a) => passiveIds.has(a.abilityId)))
    throw new Error("Equipment passive conflicts with ordinary learning");
  const ordinary = { ...member.abilities, owned: member.abilities.owned.filter((a) => !passiveIds.has(a.abilityId)) };
  if (member.sourceId !== plan.sourceId || member.jobId !== plan.jobId || member.magicStoneId !== 0)
    throw new Error("Unimplemented character growth identity, job or magic stone");
  if (member.level !== expected.level || member.additionalLevel !== expected.level || member.exp !== expected.exp ||
      !same(progress.additional, expected.additional) || !same(ordinary, expected.abilities))
    throw new Error("Owned character growth disagrees with source projection");
}

/** BattleResult invokes ExecutionLearning even for characters ineligible for
 * experience. That path observes abilities without running ordinary StatusUp,
 * equipment learning, background learning, or parameter projection. */
export function validateObservedLearning(
  plan: CharacterGrowthPlan,
  member: Pick<CharacterGrowthMember, "abilities">,
  observedAbilityIds: readonly number[],
  equipmentAbilities: readonly OwnedAbility[] = [],
): void {
  validatePlan(plan);
  validateOwnedCharacterAbilities(member.abilities, equipmentAbilities);
  if (!Array.isArray(observedAbilityIds)) throw new Error("Missing observed battle abilities");
  observedAbilityIds.forEach((id) => integer(id, 1));
  if (plan.observedLearning) {
    observedLearningRows(plan.observedLearning, member.abilities.owned, observedAbilityIds);
    return;
  }
  if (member.abilities.owned.some((a) => a.abilityId === 74) &&
    observedAbilityIds.some((id) => plan.observedLearningAbilityIds.includes(id)))
    throw new Error("Unimplemented observed-ability learning provider");
}

/** Replays the persistent receipt through the same provider used at victory.
 * A receipt describes a transition; the owned list remains the sole ability owner. */
export function learnObservedCharacter<T extends CharacterGrowthMember>(
  plan: CharacterGrowthPlan, member: T, progress: CharacterGrowthProgress,
  observedAbilityIds: readonly number[],
  receipt: { battleSerial: number; participantIndex: number } | undefined,
  equipmentAbilities: readonly OwnedAbility[] = [],
): { member: T; progress: CharacterGrowthProgress } {
  validateCharacterGrowth(plan, member, progress, equipmentAbilities);
  validateObservedLearning(plan, member, observedAbilityIds, equipmentAbilities);
  const rows = plan.observedLearning
    ? observedLearningRows(plan.observedLearning, member.abilities.owned, observedAbilityIds) : [];
  if (!rows.length) return { member: structuredClone(member), progress: structuredClone(progress) };
  if (!receipt) throw new Error("Missing observed learning battle receipt");
  const nextProgress = structuredClone(progress);
  nextProgress.observedLearning.push({ ...receipt, level: member.level,
    observedAbilityIds: rows.map((r) => r.observedAbilityId) });
  const expected = expectedOwnedGrowth(plan, nextProgress);
  const next = { ...structuredClone(member), abilities: preserveEquipmentAbilities(member.abilities,
    expected.abilities, equipmentAbilities) };
  validateCharacterGrowth(plan, next, nextProgress, equipmentAbilities);
  return { member: next, progress: nextProgress };
}
function preserveEquipmentAbilities(
  current: OwnedCharacterAbilities, expected: OwnedCharacterAbilities, equipmentAbilities: readonly OwnedAbility[],
): OwnedCharacterAbilities {
  const passiveIds = new Set(equipmentAbilities.map((a) => a.abilityId));
  const owned = current.owned.map((a) => structuredClone(passiveIds.has(a.abilityId)
    ? a : expected.owned.find((row) => row.abilityId === a.abilityId)!));
  for (const ability of expected.owned)
    if (!owned.some((a) => a.abilityId === ability.abilityId)) owned.push(structuredClone(ability));
  return { ...expected, owned };
}

/** The amount is already distributed and adjusted by the battle reward/passive
 * owner. Candidate output never mutates the source member or parameter input. */
export function growCharacter<T extends CharacterGrowthMember>(
  plan: CharacterGrowthPlan,
  member: T,
  progress: CharacterGrowthProgress,
  request: CharacterGrowthRequest,
  projectParameters: (member: T, progress: CharacterGrowthProgress) => { maxHp: number; maxMp: number },
  equipmentAbilities: readonly OwnedAbility[] = [],
): { member: T; progress: CharacterGrowthProgress; learnedAbilityIdsToAppend: number[]; steps: CharacterGrowthStep[] } {
  validateCharacterGrowth(plan, member, progress, equipmentAbilities);
  if (request.kind !== "correct-level" && request.kind !== "add-experience")
    throw new Error("Unknown character growth request");
  if (request.kind === "correct-level") {
    integer(request.targetLevel, 1, plan.maxLevel);
    if (request.targetLevel <= member.additionalLevel)
      return { member: structuredClone(member), progress: structuredClone(progress), learnedAbilityIdsToAppend: [], steps: [] };
  } else {
    integer(request.amount, 0, plan.maxExp);
    if (!["field", "battle"].includes(request.context)) throw new Error("Unknown growth execution context");
    if (request.context === "battle") {
      validateObservedLearning(plan, member, request.observedAbilityIds, equipmentAbilities);
      if (plan.hasBattleBackgroundLearning)
        throw new Error("Unimplemented battle background learning provider");
    }
  }
  if (member.equipment.some((id) => plan.equipmentLearningContentIds.includes(id)))
    throw new Error("Unimplemented equipment learning provider");
  const candidateProgress = structuredClone(progress);
  if (request.kind === "correct-level") {
    // CorrectLevel indexes ExpTable by ID, independently of the selected group.
    const target = plan.experience.find((row) => row.id === request.targetLevel);
    if (!target) throw new Error("Unresolved correction experience row");
    candidateProgress.additionalExp = Math.min(plan.maxExp, target.totalExp);
  } else candidateProgress.additionalExp = Math.min(plan.maxExp, progress.additionalExp + request.amount);
  const expected = expectedOwnedGrowth(plan, candidateProgress);
  candidateProgress.additional = expected.additional;
  // Equipment passives share OwnedAbilityList but not ordinary learning order.
  // Keep their current positions/copies; new natural abilities append after
  // existing records, as AddAbility does, without entering the passive list.
  let candidate: T = { ...structuredClone(member), level: expected.level, additionalLevel: expected.level,
    exp: expected.exp, abilities: preserveEquipmentAbilities(member.abilities, expected.abilities, equipmentAbilities) };
  if (request.kind === "add-experience" && request.context === "battle") {
    const learning = learnObservedCharacter(plan, candidate, candidateProgress, request.observedAbilityIds,
      request.learningReceipt, equipmentAbilities);
    candidate = learning.member;
    candidateProgress.observedLearning = learning.progress.observedLearning;
  }
  const resources = projectParameters(structuredClone(candidate), structuredClone(candidateProgress));
  candidate.maxHp = integer(resources.maxHp, 1); candidate.maxMp = integer(resources.maxMp);
  candidate.hp = Math.min(integer(member.hp), candidate.maxHp);
  candidate.mp = Math.min(integer(member.mp), candidate.maxMp);
  validateCharacterGrowth(plan, candidate, candidateProgress, equipmentAbilities);
  const steps: CharacterGrowthStep[] = [];
  for (let level = member.level + 1; level <= candidate.level; level++) {
    const row = plan.growth[level - 1]!;
    steps.push({ level, hp: row.hp, mp: row.mp, learnedAbilityIds: plan.learning.filter((l) => l.level === level).map((l) => l.abilityId) });
  }
  return { member: candidate, progress: candidateProgress, learnedAbilityIdsToAppend: [], steps };
}
