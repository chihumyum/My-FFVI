import { validateOwnedCharacterAbilities, type OwnedAbility, type OwnedCharacterAbilities } from "./owned-character.js";

/** Source parameter enum. The catalog compiler binds its dictionaries; core
 * never derives an esper or a summon from a consecutive content ID. */
export type MagicStoneBonus = { parameter: 0 | 2 | 3 | 4 | 5 | 6 | 14; value: number };
export type MagicStoneDefinition = {
  contentId: number; name: string; summonAbilityId: number;
  bonus: MagicStoneBonus;
  learning: { id: number; contentId: number; abilityId: number; rate: number }[];
  /** Equipping is admitted independently of the still unavailable summon. */
  summonBlockers: string[];
};
export type MagicStoneCatalog = {
  kind: "magic-stones-v1";
  rules: { kind: "magic-stone-rules-v1"; maxSkillLevel: 100;
    excludedSourceIds: [13, 14]; magicCommandId: 7; alternativeMagicCommandId: 31 };
  stones: Record<string, MagicStoneDefinition>;
};
export type MagicStoneAbilityMetadata = { id: number; typeId: number };
export type MagicStoneMember = {
  id: string; sourceId: number; enabled: boolean; magicStoneId: number;
  abilities: OwnedCharacterAbilities;
};
export type MagicStoneProjection<T extends MagicStoneMember = MagicStoneMember> = {
  roster: T[]; changedIds: string[];
};
export type MagicStoneInventoryRemovalProjection<T extends MagicStoneMember = MagicStoneMember> =
  MagicStoneProjection<T> & { heldIds: number[] };
export type MagicStonePassiveContext = Readonly<Record<string, readonly OwnedAbility[]>>;
export type MagicStoneGrowthIncrement = {
  hp: number; mp: number; strength: number; vitality: number; agility: number; magic: number;
};

function integer(value: number, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min || value > 0x7fffffff)
    throw new Error("Invalid magic stone integer");
  return value;
}
function fields(value: unknown, keys: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getOwnPropertySymbols(value).length)
    throw new Error("Invalid magic stone fields");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).sort().join(",") !== keys.split(",").sort().join(",") ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable))
    throw new Error("Invalid magic stone fields");
}
function dense(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length ||
      Object.getOwnPropertyNames(value).length !== value.length + 1)
    throw new Error("Invalid magic stone list");
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new Error("Invalid magic stone list");
  }
}

export function validateMagicStoneCatalog(catalog: MagicStoneCatalog): void {
  fields(catalog, "kind,rules,stones");
  fields(catalog.rules, "kind,maxSkillLevel,excludedSourceIds,magicCommandId,alternativeMagicCommandId");
  dense(catalog.rules.excludedSourceIds);
  if (catalog.kind !== "magic-stones-v1" || catalog.rules.kind !== "magic-stone-rules-v1" ||
      catalog.rules.maxSkillLevel !== 100 || catalog.rules.magicCommandId !== 7 ||
      catalog.rules.alternativeMagicCommandId !== 31 ||
      JSON.stringify(catalog.rules.excludedSourceIds) !== "[13,14]")
    throw new Error("Unsupported magic stone rules");
  fields(catalog.stones, Object.keys(catalog.stones).join(","));
  const learningIds = new Set<number>();
  for (const [key, stone] of Object.entries(catalog.stones)) {
    fields(stone, "contentId,name,summonAbilityId,bonus,learning,summonBlockers");
    integer(stone.contentId, 1); integer(stone.summonAbilityId, 1);
    if (key !== String(stone.contentId) || typeof stone.name !== "string" || !stone.name.trim())
      throw new Error("Invalid magic stone identity");
    fields(stone.bonus, "parameter,value");
    if (![0, 2, 3, 4, 5, 6, 14].includes(stone.bonus.parameter))
      throw new Error("Unknown magic stone bonus parameter");
    integer(stone.bonus.value);
    if (stone.bonus.parameter === 0 && stone.bonus.value !== 0)
      throw new Error("Invalid absent magic stone bonus");
    dense(stone.learning); dense(stone.summonBlockers);
    if (!stone.summonBlockers.length || stone.summonBlockers.some(reason => typeof reason !== "string" || !reason.trim()))
      throw new Error("Magic stone summon requires its separate execution contract");
    for (const row of stone.learning) {
      fields(row, "id,contentId,abilityId,rate");
      integer(row.id, 1); integer(row.contentId, 1); integer(row.abilityId, 1); integer(row.rate);
      if (learningIds.has(row.id)) throw new Error("Duplicate magic stone learning row");
      learningIds.add(row.id);
    }
  }
}

function heldIds(catalog: MagicStoneCatalog, ownedIds: readonly number[]): void {
  validateMagicStoneCatalog(catalog); dense(ownedIds);
  const seen = new Set<number>();
  for (const id of ownedIds) {
    integer(id, 1);
    if (!Object.hasOwn(catalog.stones, String(id))) throw new Error("Unknown held magic stone");
    if (seen.has(id)) throw new Error("Duplicate held magic stone");
    seen.add(id);
  }
}

/** Enabled-owner association is the admitted UI scope. Disabled associations
 * are retained and checked for identity, never silently cleared or transferred. */
export function validateMagicStoneOwnership<T extends MagicStoneMember>(
  catalog: MagicStoneCatalog, ownedIds: readonly number[], roster: readonly T[],
  equipmentAbilities: MagicStonePassiveContext = {},
): void {
  heldIds(catalog, ownedIds); dense(roster);
  const ids = new Set<string>(), enabledStones = new Set<number>();
  for (const member of roster) {
    if (member && typeof member === "object" && (Object.getOwnPropertySymbols(member).length ||
        Object.values(Object.getOwnPropertyDescriptors(member)).some(descriptor => !("value" in descriptor)) ||
        ["id", "sourceId", "enabled", "magicStoneId", "abilities"].some(key => !Object.hasOwn(member, key))))
      throw new Error("Invalid magic stone owned character fields");
    if (!member || typeof member !== "object" || typeof member.id !== "string" || !member.id ||
        ids.has(member.id) || typeof member.enabled !== "boolean")
      throw new Error("Invalid magic stone owned character");
    ids.add(member.id); integer(member.sourceId, 1); integer(member.magicStoneId);
    validateOwnedCharacterAbilities(member.abilities, equipmentAbilities[member.id] ?? []);
    if (member.magicStoneId === 0) continue;
    if (!ownedIds.includes(member.magicStoneId)) throw new Error("Unheld equipped magic stone");
    if (catalog.rules.excludedSourceIds.includes(member.sourceId as 13 | 14))
      throw new Error("Source character cannot equip magic stones");
    if (member.enabled) {
      if (enabledStones.has(member.magicStoneId)) throw new Error("Duplicate enabled magic stone association");
      enabledStones.add(member.magicStoneId);
    }
  }
}

export function projectAcquireMagicStone(catalog: MagicStoneCatalog, ownedIds: readonly number[], contentId: number): number[] {
  heldIds(catalog, ownedIds); integer(contentId, 1);
  if (!Object.hasOwn(catalog.stones, String(contentId))) throw new Error("Unknown acquired magic stone");
  return ownedIds.includes(contentId) ? [...ownedIds] : [...ownedIds, contentId];
}

/** Native list removal does not clear equips. This Web admission boundary
 * rejects still-associated IDs until that caller's lifecycle is recovered. */
export function projectRemoveOwnedMagicStone<T extends MagicStoneMember>(
  catalog: MagicStoneCatalog, ownedIds: readonly number[], roster: readonly T[], contentId: number,
  equipmentAbilities: MagicStonePassiveContext = {},
): number[] {
  validateMagicStoneOwnership(catalog, ownedIds, roster, equipmentAbilities); integer(contentId, 1);
  if (!ownedIds.includes(contentId)) throw new Error("Magic stone is not held");
  if (roster.some(member => member.magicStoneId === contentId))
    throw new Error("Removing an associated magic stone requires a separate lifecycle contract");
  return ownedIds.filter(id => id !== contentId);
}

/** Inventory Type9 uses UserDataManager rather than the direct UserDataClient
 * or UI removal. Its first association is from the whole owned list in order;
 * the native RemoveMagicStone call only clears the ID, including on disabled
 * owners. Count is not an input to this consumer. */
export function projectRemoveInventoryMagicStone<T extends MagicStoneMember>(
  catalog: MagicStoneCatalog, ownedIds: readonly number[], roster: readonly T[], contentId: number,
  equipmentAbilities: MagicStonePassiveContext = {},
): MagicStoneInventoryRemovalProjection<T> {
  validateMagicStoneOwnership(catalog, ownedIds, roster, equipmentAbilities); integer(contentId, 1);
  if (!Object.hasOwn(catalog.stones, String(contentId))) throw new Error("Unknown inventory magic stone");
  const next = structuredClone(roster) as T[];
  if (!ownedIds.includes(contentId)) return { heldIds: [...ownedIds], roster: next, changedIds: [] };
  const held = ownedIds.filter(id => id !== contentId), changedIds: string[] = [];
  const first = next.find(member => member.magicStoneId === contentId);
  if (first) { first.magicStoneId = 0; changedIds.push(first.id); }
  // The source would retain further associations. Such a candidate cannot be
  // persisted in the admitted Web owned state, so refuse the whole operation.
  if (next.some(member => member.magicStoneId === contentId))
    throw new Error("Inventory magic stone removal leaves another association requiring a separate lifecycle contract");
  validateMagicStoneOwnership(catalog, held, next, equipmentAbilities);
  return { heldIds: held, roster: next, changedIds };
}

function metadataTypes(metadata: readonly MagicStoneAbilityMetadata[]): Map<number, number> {
  dense(metadata);
  const types = new Map<number, number>();
  for (const row of metadata) {
    if (!row || typeof row !== "object" || Object.getOwnPropertySymbols(row).length ||
        Object.values(Object.getOwnPropertyDescriptors(row)).some(descriptor => !("value" in descriptor)) ||
        !Object.hasOwn(row, "id") || !Object.hasOwn(row, "typeId"))
      throw new Error("Invalid magic stone ability metadata");
    integer(row.id, 1); integer(row.typeId);
    if (types.has(row.id) && types.get(row.id) !== row.typeId)
      throw new Error("Conflicting magic stone ability metadata");
    types.set(row.id, row.typeId);
  }
  return types;
}

/** Command changes mirror the source UI; no temporary summon is granted and
 * neither partial skills nor their content order are removed. */
export function projectMagicStoneCommands(
  catalog: MagicStoneCatalog, abilities: OwnedCharacterAbilities, equipped: boolean,
  metadata: readonly MagicStoneAbilityMetadata[], equipmentAbilities: readonly OwnedAbility[] = [],
): OwnedCharacterAbilities {
  validateMagicStoneCatalog(catalog); validateOwnedCharacterAbilities(abilities, equipmentAbilities);
  if (typeof equipped !== "boolean") throw new Error("Invalid magic stone command context");
  const types = metadataTypes(metadata), next = structuredClone(abilities), rules = catalog.rules;
  if (equipped) {
    if (!next.commandIds.includes(rules.magicCommandId) && !next.commandIds.includes(rules.alternativeMagicCommandId))
      next.commandIds.push(rules.magicCommandId);
  } else if (next.commandIds.includes(rules.magicCommandId)) {
    let learnedMagic = false;
    for (const ability of next.owned) {
      const type = types.get(ability.abilityId);
      if (type === undefined) throw new Error("Unknown owned ability type during magic stone removal");
      if ((type === 1 || type === 2) && ability.skillLevel === rules.maxSkillLevel) learnedMagic = true;
    }
    if (!learnedMagic) {
      next.commandIds = next.commandIds.filter(id => id !== rules.magicCommandId);
      next.byCommand = next.byCommand.filter(command => command.commandId !== rules.magicCommandId);
    }
  }
  validateOwnedCharacterAbilities(next, equipmentAbilities);
  return next;
}

export function projectRemoveMagicStone<T extends MagicStoneMember>(
  catalog: MagicStoneCatalog, ownedIds: readonly number[], roster: readonly T[], ownedId: string,
  metadata: readonly MagicStoneAbilityMetadata[], equipmentAbilities: MagicStonePassiveContext = {},
): MagicStoneProjection<T> {
  validateMagicStoneOwnership(catalog, ownedIds, roster, equipmentAbilities);
  const member = roster.find(candidate => candidate.id === ownedId && candidate.enabled);
  if (!member) throw new Error("Magic stone menu requires an enabled owned character");
  const next = structuredClone(roster) as T[];
  if (member.magicStoneId === 0) return { roster: next, changedIds: [] };
  const target = next.find(candidate => candidate.id === ownedId)!;
  target.magicStoneId = 0;
  target.abilities = projectMagicStoneCommands(catalog, target.abilities, false, metadata, equipmentAbilities[ownedId] ?? []);
  return { roster: next, changedIds: [ownedId] };
}

export function projectEquipMagicStone<T extends MagicStoneMember>(
  catalog: MagicStoneCatalog, ownedIds: readonly number[], roster: readonly T[],
  request: { ownedId: string; contentId: number }, metadata: readonly MagicStoneAbilityMetadata[],
  equipmentAbilities: MagicStonePassiveContext = {},
): MagicStoneProjection<T> {
  fields(request, "ownedId,contentId");
  validateMagicStoneOwnership(catalog, ownedIds, roster, equipmentAbilities); integer(request.contentId, 1);
  const member = roster.find(candidate => candidate.id === request.ownedId && candidate.enabled);
  if (!member) throw new Error("Magic stone menu requires an enabled owned character");
  if (catalog.rules.excludedSourceIds.includes(member.sourceId as 13 | 14))
    throw new Error("Source character cannot equip magic stones");
  if (!ownedIds.includes(request.contentId)) throw new Error("Magic stone is not held");
  if (roster.some(candidate => !candidate.enabled && candidate.magicStoneId === request.contentId))
    throw new Error("Disabled magic stone association requires a separate lifecycle contract");
  // Selecting the same equipped stone is the source UI's remove operation.
  if (member.magicStoneId === request.contentId)
    return projectRemoveMagicStone(catalog, ownedIds, roster, member.id, metadata, equipmentAbilities);
  const next = structuredClone(roster) as T[], changedIds: string[] = [];
  const previous = next.find(candidate => candidate.enabled && candidate.magicStoneId === request.contentId);
  if (previous) {
    previous.magicStoneId = 0;
    previous.abilities = projectMagicStoneCommands(catalog, previous.abilities, false, metadata,
      equipmentAbilities[previous.id] ?? []);
    changedIds.push(previous.id);
  }
  const target = next.find(candidate => candidate.id === member.id)!;
  target.magicStoneId = request.contentId;
  target.abilities = projectMagicStoneCommands(catalog, target.abilities, true, metadata, equipmentAbilities[target.id] ?? []);
  changedIds.push(target.id);
  validateMagicStoneOwnership(catalog, ownedIds, next, equipmentAbilities);
  return { roster: next, changedIds };
}

/** GetParameterValue receives this level's base HP/MP increment, never a
 * current maximum. Integer overflow is a Web admission error, not wraparound. */
export function magicStoneGrowthIncrement(catalog: MagicStoneCatalog, magicStoneId: number,
  hp: number, mp: number): MagicStoneGrowthIncrement {
  validateMagicStoneCatalog(catalog); integer(magicStoneId); integer(hp); integer(mp);
  const result: MagicStoneGrowthIncrement = { hp, mp, strength: 0, vitality: 0, agility: 0, magic: 0 };
  if (magicStoneId === 0) return result;
  const stone = catalog.stones[String(magicStoneId)];
  if (!stone) throw new Error("Unknown growth magic stone");
  const { parameter, value } = stone.bonus;
  if (parameter === 2 || parameter === 3) {
    const key = parameter === 2 ? "hp" : "mp", base = result[key];
    result[key] = integer(base + Number(BigInt(base) * BigInt(value) / 100n));
  } else if (parameter !== 0) {
    const key = ({ 4: "strength", 5: "vitality", 6: "agility", 14: "magic" } as const)[parameter];
    result[key] = value;
  }
  return result;
}
