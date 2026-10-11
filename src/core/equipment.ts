import {
  confirmPlayerParameters,
  type ParameterEquipment,
  type ParameterLimits,
  type PlayerParameterInput,
} from "./parameters.js";
import {
  confirmPlayerPhysical,
  type PhysicalLimits,
} from "./physical-parameters.js";
import type { PhysicalParameters } from "./physical.js";
import type { OwnedAbility } from "./owned-character.js";
import { validateBattleRowCatalog, type BattleRowCatalog } from "./battle-row.js";
import {
  validateOrdinaryWeaponEffects, validateOrdinaryWeaponEffectsAdmission, validateOrdinaryWeaponRow,
  type OrdinaryWeapon, type OrdinaryWeaponEffectsCatalog,
} from "./ordinary-weapon.js";
import {
  mergeElementResistances,
  validateElements,
  validateElementResistances,
  type ElementResistances,
} from "./elements.js";

export type EquipmentSlot = 1 | 2 | 3 | 4 | 5 | 6;
export type EquipmentAbilityCost = {
  kind: "equipment-mp-cost";
  modifier: "half" | "one";
  /** AddEquipAbility creates one skill-level-zero entry per equipped copy. */
  ability: OwnedAbility;
};
export type EquipmentDefinition = {
  /** Inventory uses content identity, never the weapon/armor row identity. */
  id: number;
  equipmentId: number;
  name: string;
  kind: "weapon" | "armor";
  empty: boolean;
  parts: boolean[];
  jobIds: number[];
  parameter: Omit<ParameterEquipment, "slot"> | null;
  strength: number;
  accuracy: number;
  criticalRate: number;
  attackElements: number[];
  elementResistances: ElementResistances;
  /** Explicit action provider, including bare hands. Armor and unknown weapon
   * effects have null; a missing weapon provider is never ordinary by default. */
  ordinaryWeapon: OrdinaryWeapon | null;
  abilityCost?: EquipmentAbilityCost;
  /** An identity may be stored before all its effects are executable. */
  blockers: string[];
};
export type EquipmentCharacter = {
  sourceId: number;
  jobId: number;
  dominantArm: 1 | 2;
  accessoriesOnly: boolean;
  /** Resolved providers. A true/unknown value is not admitted by this profile. */
  hasTwoSwordStyle: boolean;
  hasTwoHand: boolean;
  equipAnyJob: boolean;
  initialSlots: number[];
  emptySlots: number[];
};
export type EquipmentCatalog = {
  kind: "equipment-development-v1";
  limit: number;
  definitions: Record<string, EquipmentDefinition>;
  characters: Record<string, EquipmentCharacter>;
  ordinaryWeaponEffects: OrdinaryWeaponEffectsCatalog;
};
export type EquipmentLoadout = {
  id: string;
  sourceId: number;
  equipment: number[];
};
/** Native Count includes equipped copies. Equipped and available are projections. */
export type EquipmentStock = { id: number; count: number };
export type EquipmentParameterContext = {
  parameters: Omit<PlayerParameterInput, "equipment">;
  physical: {
    baseAttack: number;
    strength: { base: number; additional: number; correction: number };
    temporary: PhysicalParameters;
  };
};

function integer(n: number, min = 0, max = 0x7fffffff): number {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new Error("Invalid equipment integer");
  return n;
}
function definition(catalog: EquipmentCatalog, id: number) {
  const item = catalog.definitions[integer(id, 1)];
  if (!item || item.id !== id)
    throw new Error("Unknown equipment content: " + id);
  return item;
}
function character(catalog: EquipmentCatalog, sourceId: number) {
  const result = catalog.characters[integer(sourceId, 1)];
  if (!result || result.sourceId !== sourceId)
    throw new Error("Unknown equipment character: " + sourceId);
  if (
    ![1, 2].includes(result.dominantArm) ||
    typeof result.accessoriesOnly !== "boolean" ||
    result.hasTwoSwordStyle !== false ||
    result.hasTwoHand !== false ||
    result.equipAnyJob !== false
  )
    throw new Error("Unimplemented equipment character provider");
  return result;
}
function executable(catalog: EquipmentCatalog, item: EquipmentDefinition) {
  if (item.blockers.length || !item.parameter)
    throw new Error("Unimplemented equipment effects: " + item.id);
  if (
    !["weapon", "armor"].includes(item.kind) ||
    typeof item.empty !== "boolean" ||
    item.parameter.kind !== item.kind
  )
    throw new Error("Invalid equipment definition");
  if (item.kind === "weapon") {
    validateOrdinaryWeaponEffectsAdmission(item.ordinaryWeapon!, catalog.ordinaryWeaponEffects);
    if (item.ordinaryWeapon!.contentId !== item.id || item.ordinaryWeapon!.weaponId !== item.equipmentId ||
        (item.ordinaryWeapon!.typeId === 2) !== item.empty)
      throw new Error("Ordinary weapon equipment identity mismatch");
  } else if (item.ordinaryWeapon !== null) {
    throw new Error("Armor cannot have an ordinary weapon provider");
  }
  for (const n of [item.strength, item.accuracy, item.criticalRate])
    integer(n, -0x80000000);
  if (item.abilityCost) validateAbilityCost(item);
}

/** Validate the frozen leased loadout against the action's row catalog before
 * row projection. Neither catalog can silently override the other. */
export function validateEquipmentBattleRows(
  catalog: EquipmentCatalog,
  loadout: EquipmentLoadout,
  rows: BattleRowCatalog,
): void {
  validateLoadout(catalog, loadout);
  validateBattleRowCatalog(rows);
  for (const id of loadout.equipment) {
    const item = definition(catalog, id);
    const row = rows.equipment.find((entry) => entry.contentId === id);
    if (item.kind === "weapon") validateOrdinaryWeaponRow(item.ordinaryWeapon!, row);
    else if (!row || row.weapon !== null) throw new Error("Armor and battle row provider mismatch");
  }
}

function validateAbilityCost(item: EquipmentDefinition): EquipmentAbilityCost {
  const value = item.abilityCost;
  if (!value || value.kind !== "equipment-mp-cost" ||
      !["half", "one"].includes(value.modifier) || item.kind !== "armor" || item.empty ||
      value.ability.skillLevel !== 0)
    throw new Error("Invalid equipment ability cost provider");
  integer(value.ability.abilityId, 1);
  integer(value.ability.contentId, 1);
  return value;
}

/** Native IsEquipSlot 0x4d7830 indexes hand flags relative to dominant arm. */
export function equipmentSlotAllowed(
  item: EquipmentDefinition,
  slot: number,
  owner: EquipmentCharacter,
) {
  integer(slot, 1, 6);
  if (item.parts.length !== 6 || item.parts.some((v) => typeof v !== "boolean"))
    throw new Error("Invalid equipment slot definition");
  return slot <= 2
    ? item.parts[slot === owner.dominantArm ? 0 : 1]!
    : item.parts[slot - 1]!;
}

function validateLoadout(catalog: EquipmentCatalog, loadout: EquipmentLoadout) {
  if (catalog.kind !== "equipment-development-v1")
    throw new Error("Unsupported equipment catalog");
  const owner = character(catalog, loadout.sourceId);
  if (!loadout.id || loadout.equipment.length !== 6)
    throw new Error("Invalid equipment loadout");
  const pieces = loadout.equipment.map((id, i) => {
    const item = definition(catalog, id);
    executable(catalog, item);
    if (!equipmentSlotAllowed(item, i + 1, owner))
      throw new Error("Equipment slot mismatch");
    if (!item.empty && !item.jobIds.includes(owner.jobId))
      throw new Error("Equipment job mismatch");
    // Umaro's source initial gear remains visible, but the menu may only edit accessories.
    if (owner.accessoriesOnly && i < 4 && id !== owner.initialSlots[i])
      throw new Error("Equipment slot is fixed for this character");
    return item;
  });
  const hands = pieces.slice(0, 2);
  if (
    hands.every((p) => p.kind === "weapon" && !p.empty) ||
    hands.every((p) => p.kind === "armor" && !p.empty)
  )
    throw new Error("Unresolved equipment hand conflict");
}

/** All slots participate in native GetMPDiameter; stock and inactive owners do
 * not. Preserve copies here even though the cost provider is non-stacking. */
export function equipmentAbilityCostProviders(catalog: EquipmentCatalog, loadout: EquipmentLoadout) {
  validateLoadout(catalog, loadout);
  return loadout.equipment.flatMap((id) => {
    const item = definition(catalog, id);
    if (!item.abilityCost) return [];
    return [{ contentId: item.id, ...structuredClone(validateAbilityCost(item)) }];
  });
}

/** Existing passive ownership is independent of whether the host can currently
 * evaluate hand/job/parameter eligibility. Read only verified wear providers
 * from the trusted catalog; unknown eligibility must not erase known copies. */
export function equipmentOwnedAbilities(catalog: EquipmentCatalog, loadout: EquipmentLoadout): OwnedAbility[] {
  const owner = catalog.characters[loadout.sourceId];
  if (catalog.kind !== "equipment-development-v1" || !owner || owner.sourceId !== loadout.sourceId ||
      !loadout.id || !Array.isArray(loadout.equipment) || loadout.equipment.length !== 6)
    throw new Error("Invalid equipment ability owner");
  return loadout.equipment.flatMap((id) => {
    const item = definition(catalog, id);
    return item.abilityCost ? [structuredClone(validateAbilityCost(item).ability)] : [];
  });
}

/** Save/entry admission is catalog-aware: only these resolved equipment
 * abilities may have duplicate identities, with exactly one entry per copy. */
export function validateEquipmentAbilityOwnership(
  catalog: EquipmentCatalog, loadout: EquipmentLoadout, owned: readonly OwnedAbility[],
) {
  const providers = equipmentOwnedAbilities(catalog, loadout);
  const known = new Map<number, OwnedAbility>();
  for (const item of Object.values(catalog.definitions)) {
    if (!item.abilityCost) continue;
    const ability = validateAbilityCost(item).ability;
    const existing = known.get(ability.abilityId);
    if (existing && (existing.contentId !== ability.contentId || existing.skillLevel !== ability.skillLevel))
      throw new Error("Conflicting equipment ability identity");
    known.set(ability.abilityId, ability);
  }
  for (const [id, expected] of known) {
    const records = owned.filter((ability) => ability.abilityId === id);
    if (records.length !== providers.filter((p) => p.abilityId === id).length ||
        records.some((ability) => ability.contentId !== expected.contentId || ability.skillLevel !== 0))
      throw new Error("Equipment passive owned-ability mismatch");
  }
}

/** FixedEquip: remove first matching old ability; SetEquip; append the new
 * passive only while equipped copies outnumber matching owned records. No
 * command/order/slot/learning/equipment-ability-list finalizer is invoked by
 * this AddEquipAbility branch. The caller publishes this detached list with
 * the equipment candidate, never separately. */
export function applyEquipmentAbilityChange(
  owned: readonly OwnedAbility[], before: EquipmentLoadout, after: EquipmentLoadout,
  catalog: EquipmentCatalog,
): OwnedAbility[] {
  if (before.id !== after.id || before.sourceId !== after.sourceId)
    throw new Error("Equipment ability owner changed");
  equipmentAbilityCostProviders(catalog, before);
  validateEquipmentAbilityOwnership(catalog, before, owned);
  equipmentAbilityCostProviders(catalog, after);
  const result = structuredClone([...owned]);
  const current = structuredClone(before);
  const changed = before.equipment.flatMap((id, slot) => id === after.equipment[slot] ? [] : [slot]);
  for (const slot of changed) {
    const previous = definition(catalog, current.equipment[slot]!).abilityCost;
    if (previous) {
      const index = result.findIndex((ability) => ability.abilityId === previous.ability.abilityId);
      if (index >= 0) result.splice(index, 1);
    }
    current.equipment[slot] = after.equipment[slot]!;
    const next = definition(catalog, current.equipment[slot]!).abilityCost;
    if (next) {
      const equipped = current.equipment.filter((id) => id === current.equipment[slot]).length;
      const count = result.filter((ability) => ability.abilityId === next.ability.abilityId).length;
      if (equipped > count) result.push(structuredClone(next.ability));
    }
  }
  validateEquipmentAbilityOwnership(catalog, after, result);
  return result;
}

export function equipmentAvailability(
  catalog: EquipmentCatalog,
  roster: readonly EquipmentLoadout[],
  stock: readonly EquipmentStock[],
): { id: number; count: number; equipped: number; available: number }[] {
  validateEquipmentState(catalog, roster, stock);
  const occupied = new Map<number, number>();
  for (const p of roster)
    for (const id of p.equipment)
      if (!definition(catalog, id).empty)
        occupied.set(id, (occupied.get(id) ?? 0) + 1);
  return stock.map(({ id, count }) => ({
    id,
    count,
    equipped: occupied.get(id) ?? 0,
    available: count - (occupied.get(id) ?? 0),
  }));
}

export function validateEquipmentState(
  catalog: EquipmentCatalog,
  roster: readonly EquipmentLoadout[],
  stock: readonly EquipmentStock[],
) {
  if (catalog.kind !== "equipment-development-v1")
    throw new Error("Unsupported equipment catalog");
  validateOrdinaryWeaponEffects(catalog.ordinaryWeaponEffects);
  integer(catalog.limit, 1);
  const counts = new Map<number, number>();
  for (const stack of stock) {
    if (Object.keys(stack).sort().join(",") !== "count,id")
      throw new Error("Invalid equipment stock record");
    const item = definition(catalog, stack.id);
    if (item.empty || counts.has(stack.id))
      throw new Error("Duplicate or empty equipment stock");
    counts.set(stack.id, integer(stack.count, 0, catalog.limit));
  }
  const identities = new Set<string>();
  const sources = new Set<number>();
  for (const p of roster) {
    if (identities.has(p.id) || sources.has(p.sourceId))
      throw new Error("Duplicate equipment owner");
    identities.add(p.id);
    sources.add(p.sourceId);
    validateLoadout(catalog, p);
    for (const id of p.equipment) {
      if (definition(catalog, id).empty) continue;
      const available = counts.get(id) ?? 0;
      if (available <= 0) throw new Error("Equipment exceeds owned count");
      counts.set(id, available - 1);
    }
  }
}

/** The caller must pass the full shared roster, not only the active party. */
export function previewEquipmentChange(
  catalog: EquipmentCatalog,
  roster: readonly EquipmentLoadout[],
  stock: readonly EquipmentStock[],
  playerId: string,
  slot: number,
  contentId: number,
) {
  validateEquipmentState(catalog, roster, stock);
  integer(slot, 1, 6);
  const next = structuredClone([...roster]);
  const target = next.find((p) => p.id === playerId);
  if (!target) throw new Error("Unknown equipment owner");
  const owner = character(catalog, target.sourceId);
  const incoming = definition(catalog, contentId);
  executable(catalog, incoming);
  if (owner.accessoriesOnly && slot < 5)
    throw new Error("Equipment slot is fixed for this character");
  if (!equipmentSlotAllowed(incoming, slot, owner))
    throw new Error("Equipment slot mismatch");
  if (!incoming.empty && !incoming.jobIds.includes(owner.jobId))
    throw new Error("Equipment job mismatch");
  const previous = target.equipment[slot - 1]!;
  const changes: { slot: number; from: number; to: number }[] = [];
  if (previous === contentId)
    return { roster: next, stock: structuredClone([...stock]), changes };
  if (
    !incoming.empty &&
    !equipmentAvailability(catalog, roster, stock).some(
      (s) => s.id === contentId && s.available > 0,
    )
  )
    throw new Error("No available equipment copy");
  target.equipment[slot - 1] = contentId;
  changes.push({ slot, from: previous, to: contentId });
  if (slot <= 2 && !incoming.empty) {
    const otherSlot = slot === 1 ? 2 : 1;
    const other = definition(catalog, target.equipment[otherSlot - 1]!);
    // Native SetEquip 0x333110 removes the other ordinary hand on conflict.
    if (!other.empty && other.kind === incoming.kind) {
      const empty = owner.emptySlots[otherSlot - 1];
      if (!empty || !definition(catalog, empty).empty)
        throw new Error("Unresolved empty equipment slot");
      target.equipment[otherSlot - 1] = empty;
      changes.push({ slot: otherSlot, from: other.id, to: empty });
    }
  }
  validateEquipmentState(catalog, next, stock);
  return { roster: next, stock: structuredClone([...stock]), changes };
}

/** Bootstrap total ownership from explicitly supplied starting loadouts only.
 * No empty placeholders are granted, and no spare equipment is invented. */
export function initialEquipmentStock(
  catalog: EquipmentCatalog,
  roster: readonly EquipmentLoadout[],
): EquipmentStock[] {
  const totals = new Map<number, number>();
  for (const p of roster)
    for (const id of p.equipment)
      if (!definition(catalog, id).empty)
        totals.set(id, (totals.get(id) ?? 0) + 1);
  const stock = [...totals]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id - b.id);
  validateEquipmentState(catalog, roster, stock);
  return stock;
}

/** Ordinary action with no UseArmType override or unique weapon provider.
 * Native GetFightAttackArmType 0x15a6b50 prefers a real weapon over bare hands,
 * then the only weapon record, then character dominance. */
export function equipmentAttackArm(
  catalog: EquipmentCatalog,
  sourceId: number,
  slots: readonly number[],
): 1 | 2 {
  const owner = character(catalog, sourceId);
  validateLoadout(catalog, {
    id: "projection",
    sourceId,
    equipment: [...slots],
  });
  const right = definition(catalog, slots[0]!);
  const left = definition(catalog, slots[1]!);
  const rightWeapon = right.kind === "weapon";
  const leftWeapon = left.kind === "weapon";
  if (rightWeapon && !right.empty && (!leftWeapon || left.empty)) return 1;
  if ((!rightWeapon || right.empty) && leftWeapon && !left.empty) return 2;
  if (rightWeapon && !leftWeapon) return 1;
  if (!rightWeapon && leftWeapon) return 2;
  return owner.dominantArm;
}

/** Pure projection of explicit growth/status/passive inputs. It never turns
 * current HP/maxHP into guessed growth or persists derived battle values. */
export function projectEquipmentParameters(
  catalog: EquipmentCatalog,
  slots: readonly number[],
  context: EquipmentParameterContext,
  limits: { parameters: ParameterLimits; physical: PhysicalLimits },
) {
  if (slots.length !== 6) throw new Error("Invalid equipment loadout");
  if (
    context.parameters.condition601 !== false ||
    context.parameters.twoHandMultiplier !== 1
  )
    throw new Error("Unimplemented physical equipment provider");
  const pieces = slots.map((id) => {
    const item = definition(catalog, id);
    executable(catalog, item);
    validateElements(item.attackElements);
    validateElementResistances(item.elementResistances);
    return item;
  });
  const equipment = pieces.map((item, index) => ({
    ...structuredClone(item.parameter!),
    slot: index + 1,
  }));
  const parameters = confirmPlayerParameters(
    { ...structuredClone(context.parameters), equipment },
    limits.parameters,
  );
  const bareHands = pieces
    .slice(0, 2)
    .every((p) => p.kind === "weapon" && p.empty);
  const physical = (arm: 1 | 2) => {
    const item = pieces[arm - 1]!;
    const weapon = item.kind === "weapon";
    const attack = weapon ? item.parameter!.values.attack : 0;
    return confirmPlayerPhysical(
      {
        baseAttack: context.physical.baseAttack,
        bareHands,
        weaponAttack:
          weapon && item.parameter!.reversedByCondition601 && attack > 0
            ? 1
            : attack,
        weaponAccuracy: weapon ? item.accuracy : 0,
        weaponCriticalRate: weapon ? item.criticalRate : 0,
        strength: {
          ...context.physical.strength,
          equipment: pieces.reduce((n, p) => (n + p.strength) | 0, 0),
        },
        temporary: { ...context.physical.temporary },
      },
      limits.physical,
    );
  };
  return {
    parameters,
    physicalByArm: { 1: physical(1), 2: physical(2) },
    attackElementsByArm: {
      1: [...pieces[0]!.attackElements],
      2: [...pieces[1]!.attackElements],
    },
    elementResistances: mergeElementResistances(
      ...pieces.map((p) => p.elementResistances),
    ),
  };
}
