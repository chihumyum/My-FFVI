import { canonical } from "./canonical.js";
import { checkpointKeys, checkpointInteger } from "./checkpoint-validation.js";
import { activePartyMembers, validatePartyState, type PartyState, type PartyPosition,
  type PartyRosterEntry, type PartyRow, type PartySlotIndex } from "./party.js";

/** Explicit Web menu operations; source script organize/select commands retain
 * their separate semantics. Editing a cell never changes roster ownership. */
export type PartyMenuChange =
  | { kind: "swap"; from: PartyPosition; to: PartyPosition }
  | { kind: "set-row"; position: PartyPosition; row: PartyRow }
  | { kind: "set-member"; slot: PartySlotIndex; position: PartyPosition; ownedId: string | null; row: PartyRow }
  | { kind: "select-slot"; slot: PartySlotIndex };
export type PartyMenuRequest = { expected: PartyState; change: PartyMenuChange };
export type PartyMenuMember = PartyRosterEntry & {
  name: string; level: number; hp: number; maxHp: number; mp: number; maxMp: number;
};
export type PartyMenuModel = {
  expected: PartyState;
  selectedSlot: number;
  cells: PartyMenuCell[];
  /** Browsing these views does not select a group or publish a party change. */
  slots: { index: PartySlotIndex; cells: PartyMenuCell[]; blocker: string | null }[];
  roster: PartyMenuMember[];
  blocker: string | null;
};
export type PartyMenuCell = { position: PartyPosition; id: string | null; row: PartyRow; member: PartyMenuMember | null };

function dataFields(value: unknown, expected?: string): void {
  if (expected !== undefined) checkpointKeys(value, expected);
  else if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid party menu data");
  const descriptors = Object.getOwnPropertyDescriptors(value as object);
  if (Object.getOwnPropertySymbols(value as object).length ||
      Object.values(descriptors).some(descriptor => !descriptor.enumerable || !Object.hasOwn(descriptor, "value")))
    throw new Error("Party menu requires own data fields");
}
function partyData(state: PartyState): void {
  dataFields(state, "selectedSlot,slots");
  const dense = (value: unknown, length: number) => {
    if (!Array.isArray(value) || value.length !== length || Object.getOwnPropertySymbols(value).length ||
        Object.keys(value).join(",") !== Array.from({ length }, (_, index) => String(index)).join(","))
      throw new Error("Party menu requires complete saved slots");
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new Error("Party menu requires saved slot data");
    }
  };
  dense(state.slots, 3);
  for (const slot of state.slots) {
    dense(slot, 4);
    for (const cell of slot) dataFields(cell, "id,row");
  }
}
function slotBlocker(cells: readonly { id: string | null; member: PartyMenuMember | null }[]): string | null {
  if (!cells.some(cell => cell.id !== null)) return "编队没有成员，无法选为当前队伍。";
  return cells.some(cell => cell.member && !cell.member.enabled) ? "当前队伍有不可编组的成员。" : null;
}

export function projectPartyMenu(party: PartyState, roster: readonly PartyMenuMember[]): PartyMenuModel {
  validatePartyState(party, roster);
  const members = roster.map(({ id, sourceId, enabled, name, level, hp, maxHp, mp, maxMp }) =>
    ({ id, sourceId, enabled, name, level, hp, maxHp, mp, maxMp }));
  const slots = party.slots.map((slot, index) => {
    const cells = slot.map((cell, position) => ({
      ...cell, position: position as PartyPosition,
      member: cell.id === null ? null : structuredClone(members.find((member) => member.id === cell.id)!),
    }));
    return { index: index as PartySlotIndex, cells, blocker: slotBlocker(cells) };
  });
  const cells = structuredClone(slots[party.selectedSlot]!.cells);
  return { expected: structuredClone(party), selectedSlot: party.selectedSlot,
    cells, slots, roster: members,
    blocker: cells.some((cell) => cell.member && !cell.member.enabled)
      ? "当前队伍有不可编组的成员。" : null };
}

export function previewPartyMenu(current: PartyState, roster: readonly PartyRosterEntry[], request: PartyMenuRequest) {
  partyData(current);
  validatePartyState(current, roster);
  dataFields(request, "expected,change");
  partyData(request.expected);
  validatePartyState(request.expected, roster);
  if (canonical(request.expected) !== canonical(current)) throw new Error("Stale party menu selection");
  dataFields(request.change);
  const state = structuredClone(current), slot = state.slots[state.selectedSlot], change = request.change;
  if (slot.some((cell) => cell.id !== null && !roster.find((member) => member.id === cell.id)!.enabled))
    throw new Error("Current party has unavailable members");
  if (change.kind === "swap") {
    dataFields(change, "kind,from,to");
    checkpointInteger(change.from, 0, 3); checkpointInteger(change.to, 0, 3);
    // A row travels with its owned member. Empty cells remain explicit cells.
    [slot[change.from], slot[change.to]] = [slot[change.to], slot[change.from]];
  } else if (change.kind === "set-row") {
    dataFields(change, "kind,position,row");
    checkpointInteger(change.position, 0, 3);
    if (change.row !== "front" && change.row !== "back") throw new Error("Invalid party menu row");
    if (slot[change.position].id === null) throw new Error("Cannot change row of an empty party position");
    slot[change.position].row = change.row;
  } else if (change.kind === "set-member") {
    dataFields(change, "kind,slot,position,ownedId,row");
    checkpointInteger(change.slot, 0, 2); checkpointInteger(change.position, 0, 3);
    if (change.row !== "front" && change.row !== "back") throw new Error("Invalid party menu row");
    if (change.ownedId !== null) {
      if (typeof change.ownedId !== "string" || !change.ownedId.length || change.ownedId.length > 160 ||
          change.ownedId.trim() !== change.ownedId) throw new Error("Invalid party menu owned identity");
      const member = roster.find(member => member.id === change.ownedId);
      if (!member) throw new Error("Party menu references an unowned member");
      if (!member.enabled) throw new Error("Party menu member is unavailable");
    }
    state.slots[change.slot][change.position] = { id: change.ownedId, row: change.row };
    if (state.slots[change.slot].some(cell => cell.id !== null && !roster.find(member => member.id === cell.id)!.enabled))
      throw new Error("Candidate party has unavailable members");
    if (change.slot === state.selectedSlot && state.slots[change.slot].every(cell => cell.id === null))
      throw new Error("Current party must retain a member");
  } else if (change.kind === "select-slot") {
    dataFields(change, "kind,slot"); checkpointInteger(change.slot, 0, 2);
    const selected = state.slots[change.slot];
    if (!selected.some(cell => cell.id !== null)) throw new Error("Cannot select an empty party");
    if (selected.some(cell => cell.id !== null && !roster.find(member => member.id === cell.id)!.enabled))
      throw new Error("Cannot select a party with unavailable members");
    state.selectedSlot = change.slot;
  } else throw new Error("Unknown party menu change");
  validatePartyState(state, roster);
  return { state, changed: canonical(current) !== canonical(state), activeMembers: activePartyMembers(state) };
}
