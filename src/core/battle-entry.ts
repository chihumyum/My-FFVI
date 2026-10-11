import { equipmentSlotAllowed, type EquipmentCatalog } from "./equipment.js";

/** This catalog supplies qualification inputs, never executable item effects. */
export type BattleEntryCatalog = {
  kind: "battle-entry-v1";
  maps: { id: number; sleepingAvailability: number; movingAvailability: number }[];
  sleepingContents: number[];
  movingContents: { id: number; value2: number }[];
  transportationContents: number[];
  beastFieldContents: number[];
  /** Source table positively lacks FOR_ENCOUNTER_CONTENTS_DECISION_1. */
  encounterExclusions: "constant-absent";
  items: { id: number; type: 1 | 2 | 3; listType: number; throwFlag: number; battleFunctionGroupId: number }[];
  changeEquipmentSlots: [1, 2];
  characterItemRestrictions: "empty-source-provider";
};

export type FieldInvalidContentContext = {
  mapId: number;
  /** null represents no transportation controller, not an unknown identity. */
  transportation: { id: number; type: number } | null;
  isSavePoint: boolean;
  /** Unknown current BeastFieldEncount state must not become false. */
  beastField: boolean | null;
};

export type BattleItemMenuInput = {
  sourceId: number;
  equipment: readonly (number | null)[];
  /** Count includes equipped copies. The host derives equipped from enabled owners. */
  inventory: readonly { id: number; count: number; equipped: number }[];
};

function natural(value: number, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid battle entry integer");
  return value;
}
function identities(values: readonly number[]) {
  values.forEach((value) => natural(value, 1));
  if (new Set(values).size !== values.length) throw new Error("Duplicate battle entry identity");
}
function catalogKind(catalog: BattleEntryCatalog) {
  if (catalog.kind !== "battle-entry-v1" || catalog.encounterExclusions !== "constant-absent" ||
    catalog.characterItemRestrictions !== "empty-source-provider")
    throw new Error("Unresolved battle entry source provider");
}

/** FF6 IsBeastField needs the actual encounter-controller foot attribute and
 * transportation identity. Field rendering or a mount sprite is not evidence. */
export function projectBeastField(context: {
  controllerPresent: boolean | null;
  footAttributeType: number | null;
  /** null is unresolved. Controller absence is controllerPresent=false. */
  transportationId: number | null;
}): boolean | null {
  if (context.controllerPresent === false) return false;
  if (context.footAttributeType !== null) natural(context.footAttributeType);
  if (context.transportationId !== null) natural(context.transportationId, 1);
  if (context.transportationId !== null && context.transportationId !== 1 ||
    context.footAttributeType !== null && ![31, 32].includes(context.footAttributeType))
    return false;
  if (context.controllerPresent === null || context.footAttributeType === null || context.transportationId === null) return null;
  return true;
}

/** SetupCurrentInvalidContent selects the field list. CommandUtility uses this
 * list as-is; only the separate ability/item-use provider removes teleport IDs. */
export function projectFieldInvalidContents(catalog: BattleEntryCatalog, context: FieldInvalidContentContext): {
  invalidContentIds: number[] | null; blockers: string[];
} {
  catalogKind(catalog);
  natural(context.mapId, 1);
  if (typeof context.isSavePoint !== "boolean" || context.beastField !== null && typeof context.beastField !== "boolean")
    throw new Error("Invalid field exclusion context");
  const maps = catalog.maps.filter((row) => row.id === context.mapId);
  if (maps.length !== 1) throw new Error("Missing or ambiguous field exclusion map");
  const map = maps[0]!;
  natural(map.sleepingAvailability); natural(map.movingAvailability);
  identities(catalog.sleepingContents); identities(catalog.transportationContents); identities(catalog.beastFieldContents);
  identities(catalog.movingContents.map((row) => row.id));
  catalog.movingContents.forEach((row) => natural(row.value2));
  const ids: number[] = [];
  const add = (values: readonly number[]) => { for (const id of values) if (!ids.includes(id)) ids.push(id); };
  if (context.transportation !== null) {
    natural(context.transportation.id, 1); natural(context.transportation.type, 1);
  }
  if (context.transportation !== null && context.transportation.type !== 1) {
    add(catalog.sleepingContents);
    add(catalog.movingContents.map((row) => row.id));
    add(catalog.transportationContents);
  } else {
    if (!context.isSavePoint && map.sleepingAvailability === 0) add(catalog.sleepingContents);
    if (map.movingAvailability === 0) add(catalog.movingContents.map((row) => row.id));
    if (map.movingAvailability === 2) add(catalog.movingContents.filter((row) => row.value2 === 0).map((row) => row.id));
  }
  if (context.beastField === null && catalog.beastFieldContents.length)
    return { invalidContentIds: null, blockers: ["Unknown beast-field content exclusion context"] };
  if (context.beastField === false) add(catalog.beastFieldContents);
  else if (context.beastField === true)
    for (const id of catalog.beastFieldContents) { const index = ids.indexOf(id); if (index >= 0) ids.splice(index, 1); }
  return { invalidContentIds: ids, blockers: [] };
}

/** FF6 InvalidContentIdData filters only teleport stone/spell for individual
 * battle use. Do not replace the command-level UserData list with this result. */
export function battleUseInvalidContents(invalidContentIds: readonly number[]): number[] {
  identities(invalidContentIds);
  return invalidContentIds.filter((id) => id !== 23 && id !== 412);
}

/** Ordinary item command (AbilityId=0). Item candidates can still be disabled
 * by use-time conditions, targets, or unavailable effect implementations. */
export function projectBattleItemMenu(
  catalog: BattleEntryCatalog,
  input: BattleItemMenuInput,
  equipmentCatalog: EquipmentCatalog,
): { available: boolean | null; usableItemIds: number[]; canChangeEquipment: boolean | null; blockers: string[] } {
  catalogKind(catalog);
  natural(input.sourceId, 1);
  if (input.equipment.length !== 6 || catalog.changeEquipmentSlots.join() !== "1,2")
    throw new Error("Unresolved battle equipment slot configuration");
  const items = new Map(catalog.items.map((row) => [row.id, row]));
  identities(catalog.items.map((row) => row.id));
  for (const item of catalog.items) {
    if (![1, 2, 3].includes(item.type)) throw new Error("Unknown battle entry item type");
    natural(item.listType); natural(item.throwFlag); natural(item.battleFunctionGroupId);
  }
  identities(input.inventory.map((row) => row.id));
  const usableItemIds: number[] = [];
  for (const stack of input.inventory) {
    natural(stack.count); natural(stack.equipped);
    if (stack.equipped > stack.count) throw new Error("Battle inventory count below equipment occupancy");
    const item = items.get(stack.id);
    if (!item) throw new Error("Unknown battle inventory content: " + stack.id);
    if (stack.count > stack.equipped && item.type === 1 && item.throwFlag !== 1 &&
      item.listType !== 2 && item.battleFunctionGroupId > 0) usableItemIds.push(item.id);
  }
  const owner = equipmentCatalog.characters[input.sourceId];
  if (!owner || owner.sourceId !== input.sourceId) throw new Error("Unknown battle equipment owner");
  const blockers: string[] = [];
  // Native IsChangeEquip immediately accepts null or non-placeholder hands.
  let canChangeEquipment: boolean | null = false;
  for (const slot of catalog.changeEquipmentSlots) {
    const currentId = input.equipment[slot - 1];
    if (currentId === undefined) throw new Error("Missing battle equipment slot");
    if (currentId === null) { canChangeEquipment = true; break; }
    const current = items.get(currentId);
    if (!current || ![2, 3].includes(current.type)) throw new Error("Unknown battle equipped content");
    if (current.listType !== 2) { canChangeEquipment = true; break; }
  }
  if (canChangeEquipment !== true) {
    const candidates = input.inventory.filter((stack) => stack.count > stack.equipped &&
      [2, 3].includes(items.get(stack.id)!.type) && items.get(stack.id)!.listType !== 2);
    if (candidates.length && (owner.hasTwoSwordStyle !== false || owner.equipAnyJob !== false)) {
      canChangeEquipment = null;
      blockers.push("Unresolved battle equipment eligibility provider");
    } else {
      for (const stack of candidates) {
        const item = items.get(stack.id)!;
        const gear = equipmentCatalog.definitions[item.id];
        if (!gear) throw new Error("Missing battle equipment qualification metadata");
        // Effect blockers do not erase source menu candidates.
        if (gear.jobIds.includes(owner.jobId) && catalog.changeEquipmentSlots.some((slot) => equipmentSlotAllowed(gear, slot, owner))) {
          canChangeEquipment = true; break;
        }
      }
    }
  }
  return { available: usableItemIds.length ? true : canChangeEquipment, usableItemIds, canChangeEquipment, blockers };
}

/** Owned storage is keyed by owner identity. This deliberately implements only
 * the already-resolved selected-party target; it is not a field presentation
 * transaction or permission to execute arbitrary AddCondition instructions. */
export function appendSelectedPartyCondition<T extends { id: string; conditionIds: number[] }>(
  roster: readonly T[], selectedOwnerIds: readonly string[], conditionId: number,
): T[] {
  natural(conditionId, 1);
  const byId = new Map(roster.map((owner) => [owner.id, owner]));
  if (byId.size !== roster.length || roster.some((owner) => !owner.id) || new Set(selectedOwnerIds).size !== selectedOwnerIds.length)
    throw new Error("Invalid owned condition target identities");
  for (const id of selectedOwnerIds) if (!byId.has(id)) throw new Error("Unknown selected condition owner");
  const selected = new Set(selectedOwnerIds);
  return roster.map((owner) => {
    identities(owner.conditionIds);
    const result = structuredClone(owner);
    if (selected.has(owner.id) && !result.conditionIds.includes(conditionId)) result.conditionIds.push(conditionId);
    return result;
  });
}
