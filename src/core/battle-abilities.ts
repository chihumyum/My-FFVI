import { validateOwnedCharacterAbilities, type OwnedCharacterAbilities, type OwnedAbility } from "./owned-character.js";

/** Source identities in this module are master-table row IDs. In particular,
 * condition IDs are not condition types and are not field transport IDs. */
export type BattleAbilityCatalog = {
  kind: "battle-abilities-v1";
  characters: { sourceId: number; jobId: number; blockers: string[] }[];
  commands: {
    id: number;
    nameKey: string;
    type: number;
    listType: number;
    executionType: number;
    abilityId: number;
    contentId: number | null;
    abilityTypes: number[];
    releaseType: number;
    releaseValues: [number, number];
    forbiddenConditionIds: number[];
    blockers: string[];
  }[];
  /** range is Ability.RengeId for command availability, not BattleRengeId. */
  abilities: { id: number; typeId: number; groupId: number; range: number }[];
  conditions: { id: number; type: number }[];
};

export type BattleAbilityMember = {
  sourceId: number;
  jobId: number;
  magicStoneId: number;
  abilities: OwnedCharacterAbilities;
};

export type BattleAbilityContext = {
  /** null means the host has not established the battle condition context.
   * [] is a positively known empty context. Never infer this from a mount. */
  conditionIds: readonly number[] | null;
  /** Source SystemConfig.BattleType: 0 / 1 controls extra-menu commands. */
  battleType: 0 | 1;
  /** Native trance-meter input; null keeps a dependent command blocked. */
  magicLearningValue: number | null;
  /** Source user-data content exclusions, after the field host supplies them. */
  invalidContentIds: readonly number[] | null;
  /** Inventory/war-time equipment menu eligibility belongs to the host. */
  itemMenuAvailable: boolean | null;
  /** Native members.Count, supplied from the actual battle party. */
  partySize: number | null;
};

export type BattleCommandEligibility = {
  commandId: number;
  nameKey: string;
  menu: "normal" | "extra" | "none";
  /** false is source-ineligible, null is unresolved. Preserve both in entries. */
  released: boolean | null;
  available: boolean | null;
  kind: "direct" | "ability-list" | "item" | "unresolved";
  /** Source-qualified ability identities; execution support is a separate gate. */
  abilityIds: number[];
  forbiddenConditionIds: number[];
  blockers: string[];
};

export type BattleAbilityProjection = {
  entries: BattleCommandEligibility[];
  /** Union for released source commands with a complete qualification path.
   * Does not certify the corresponding ability effect implementation. */
  abilityIds: number[];
  blockers: string[];
};

function uniqueIndex<T>(values: readonly T[], identity: (value: T) => number, label: string): Map<number, T> {
  const indexed = new Map<number, T>();
  for (const value of values) {
    const id = identity(value);
    if (!Number.isSafeInteger(id) || id < 1 || indexed.has(id)) throw new Error("Invalid battle ability " + label);
    indexed.set(id, value);
  }
  return indexed;
}

/** Native OrderBy(GetHierarchy) is stable within each command menu. */
export function battleCommandHierarchy(commandId: number): number {
  return commandId === 1 || commandId === 30 ? 0 : commandId === 7 ? 2 : commandId === 3 ? 3 : 1;
}

/** Project current owned abilities, not the character's initialization group or
 * learned-history list. Unknown providers remain visible, with null eligibility. */
export function projectBattleAbilities(
  catalog: BattleAbilityCatalog,
  member: BattleAbilityMember,
  context: BattleAbilityContext,
  equipmentAbilities: readonly OwnedAbility[] = [],
): BattleAbilityProjection {
  if (catalog.kind !== "battle-abilities-v1" || ![0, 1].includes(context.battleType))
    throw new Error("Invalid battle ability projection context");
  validateOwnedCharacterAbilities(member.abilities, equipmentAbilities);
  if (!Number.isSafeInteger(member.magicStoneId) || member.magicStoneId < 0)
    throw new Error("Invalid battle magic-stone identity");
  const characters = uniqueIndex(catalog.characters, (r) => r.sourceId, "character catalog");
  const commands = uniqueIndex(catalog.commands, (r) => r.id, "command catalog");
  const abilities = uniqueIndex(catalog.abilities, (r) => r.id, "ability catalog");
  const conditions = uniqueIndex(catalog.conditions, (r) => r.id, "condition catalog");
  const character = characters.get(member.sourceId);
  if (!character || character.jobId !== member.jobId) throw new Error("Unknown battle ability character/job origin");
  if (context.magicLearningValue !== null && (!Number.isInteger(context.magicLearningValue) || context.magicLearningValue < 0))
    throw new Error("Invalid battle magic-learning value");
  if (context.invalidContentIds !== null && (new Set(context.invalidContentIds).size !== context.invalidContentIds.length ||
    context.invalidContentIds.some((id) => !Number.isSafeInteger(id) || id < 1)))
    throw new Error("Invalid battle content exclusion identities");
  if (context.itemMenuAvailable !== null && typeof context.itemMenuAvailable !== "boolean")
    throw new Error("Invalid battle item-menu context");
  if (context.partySize !== null && (!Number.isInteger(context.partySize) || context.partySize < 1 || context.partySize > 4))
    throw new Error("Invalid battle party-size context");
  const active = context.conditionIds === null ? null : new Set(context.conditionIds);
  if (active !== null && (active.size !== context.conditionIds!.length || [...active].some((id) => !conditions.has(id))))
    throw new Error("Unknown or duplicate battle ability condition identity");
  const globalBlockers = [...character.blockers];
  if (active === null) globalBlockers.push("Unknown battle condition context for menu providers");
  if (active !== null && [...active].some((id) => conditions.get(id)!.type === 501))
    globalBlockers.push("Unresolved manipulated-character command menu");
  if (member.abilities.equipment.some((id) => id !== 0)) globalBlockers.push("Unresolved equipped command/ability replacement");
  for (const owned of member.abilities.owned)
    if (!abilities.has(owned.abilityId)) globalBlockers.push("Missing owned ability master: " + owned.abilityId);
  const entries = member.abilities.commandIds.map((commandId): BattleCommandEligibility => {
    const command = commands.get(commandId);
    if (!command) return { commandId, nameKey: "", menu: "normal", released: null, available: null,
      kind: "unresolved", abilityIds: [], forbiddenConditionIds: [], blockers: ["Unknown owned command master: " + commandId] };
    const blockers = [...globalBlockers, ...command.blockers];
    if (![1, 2, 5, 6].includes(command.type)) blockers.push("Unresolved command menu type: " + command.type);
    if (![0, 3, 5].includes(command.releaseType)) blockers.push("Unresolved command availability release type: " + command.releaseType);
    const menu = command.type === 1 ? "normal" : command.type === 2 ||
      command.type === (context.battleType === 0 ? 6 : 5) ? "extra" : [5, 6].includes(command.type) ? "none" : "normal";
    let released: boolean | null = true;
    const directAbility = command.abilityId ? abilities.get(command.abilityId) : null;
    if (command.abilityId && !directAbility) blockers.push("Missing direct command ability: " + command.abilityId);
    // SetCommandData appends BattleType-specific commands after the sorted
    // type-2 menu, without calling GetReleaseCommand on those appended rows.
    const appended = command.type === (context.battleType === 0 ? 6 : 5);
    if (!appended && [3, 5].includes(command.releaseType)) {
      if (active === null) {
        released = null;
        blockers.push("Unknown battle condition context for command release");
      } else {
        const matched = command.releaseValues.some((id) => active.has(id));
        released = command.releaseType === 3 ? matched : !matched;
        // IsRelease type 5 special-cases transformation Ability.TypeId=605.
        if (command.releaseType === 5 && directAbility?.typeId === 605 &&
          [...active].some((id) => [621, 684].includes(conditions.get(id)!.type))) released = false;
      }
    }
    let kind: BattleCommandEligibility["kind"] = "unresolved";
    const abilityIds: number[] = [];
    if (command.executionType === 1 && directAbility) {
      kind = "direct";
      abilityIds.push(directAbility.id);
      if ([610, 615].includes(directAbility.typeId))
        blockers.push(directAbility.typeId === 610 ? "Unresolved Runic weapon eligibility" : "Unresolved Leap beast-field eligibility");
    } else if (command.executionType === 2 && command.listType === 1) {
      kind = "item";
      if (command.abilityId !== 0) blockers.push("Unresolved specialized item command filter");
    } else if (command.executionType === 2 && [2, 3].includes(command.listType)) {
      kind = "ability-list";
      // AbilityFilter walks source group rows, then owned-list order, and the
      // FF6 provider admits SkillLevel > 99. byCommand is never trusted here.
      for (const typeId of command.abilityTypes)
        for (const owned of member.abilities.owned) {
          const master = abilities.get(owned.abilityId);
          if (master?.typeId === typeId && master.groupId !== 0 && owned.skillLevel >= 100)
            abilityIds.push(master.id);
        }
      if (command.abilityTypes.some((type) => ![1, 2, 604].includes(type)))
        blockers.push("Unresolved specialized battle ability-list provider");
      if (commandId === 7 && member.magicStoneId !== 0)
        blockers.push("Unresolved equipped magic-stone battle invocation");
    } else blockers.push("Unresolved command execution/list shape");
    let available: boolean | null = true;
    if (command.contentId !== null) {
      if (context.invalidContentIds === null) blockers.push("Unknown battle content exclusion context");
      else if (context.invalidContentIds.includes(command.contentId)) available = false;
    }
    if (active === null && command.forbiddenConditionIds.length)
      blockers.push("Unknown battle condition context for command availability");
    else if (command.forbiddenConditionIds.some((id) => active?.has(id))) available = false;
    if (commandId === 8) {
      if (context.magicLearningValue === null) blockers.push("Unknown transformation magic-learning value");
      else if (context.magicLearningValue < 8) available = false;
    }
    if (kind === "item") {
      if (context.itemMenuAvailable === null) blockers.push("Unknown battle item/equipment-menu availability");
      else if (!context.itemMenuAvailable) available = false;
    }
    // FF6 IsDisplayPhantomBeastInBattleMagic is true: CommandUtility permits
    // opening command 7 even when no ordinary spell has been learned.
    if (kind === "ability-list" && commandId !== 7 && !abilityIds.length) available = false;
    if (kind === "direct" && directAbility?.range === 12) {
      if (context.partySize === null) blockers.push("Unknown battle party size for command range 12");
      else if (context.partySize === 1) available = false;
    }
    if (blockers.length && available !== false) available = null;
    if (released === false || menu === "none") available = false;
    return { commandId, nameKey: command.nameKey, menu, released, available, kind, abilityIds,
      forbiddenConditionIds: [...command.forbiddenConditionIds], blockers: [...new Set(blockers)] };
  });
  const priority = (entry: BattleCommandEligibility) => entry.menu === "normal" ? 0 : entry.menu === "extra"
    ? commands.get(entry.commandId)?.type === 2 ? 1 : 2 : 3;
  entries.sort((a, b) => priority(a) - priority(b) ||
    (priority(a) >= 2 ? 0 : battleCommandHierarchy(a.commandId) - battleCommandHierarchy(b.commandId)));
  return { entries, abilityIds: [...new Set(entries.filter((e) => e.released === true && e.available === true)
    .flatMap((e) => e.abilityIds))], blockers: [...new Set(entries.flatMap((e) => e.blockers))] };
}
