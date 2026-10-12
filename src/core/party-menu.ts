import { canonical } from "./canonical.js";
import { checkpointKeys, checkpointInteger } from "./checkpoint-validation.js";
import { activePartyMembers, validatePartyState, type PartyState, type PartyPosition,
  type PartyRosterEntry, type PartyRow } from "./party.js";

/** Explicit Web menu operations; source script organize/select commands retain
 * their separate semantics. This editor never changes membership or ownership. */
export type PartyMenuChange =
  | { kind: "swap"; from: PartyPosition; to: PartyPosition }
  | { kind: "set-row"; position: PartyPosition; row: PartyRow };
export type PartyMenuRequest = { expected: PartyState; change: PartyMenuChange };
export type PartyMenuMember = PartyRosterEntry & {
  name: string; level: number; hp: number; maxHp: number; mp: number; maxMp: number;
};
export type PartyMenuModel = {
  expected: PartyState;
  selectedSlot: number;
  cells: { position: PartyPosition; id: string | null; row: PartyRow; member: PartyMenuMember | null }[];
  roster: PartyMenuMember[];
  blocker: string | null;
};

export function projectPartyMenu(party: PartyState, roster: readonly PartyMenuMember[]): PartyMenuModel {
  validatePartyState(party, roster);
  const members = roster.map(({ id, sourceId, enabled, name, level, hp, maxHp, mp, maxMp }) =>
    ({ id, sourceId, enabled, name, level, hp, maxHp, mp, maxMp }));
  const cells = party.slots[party.selectedSlot].map((cell, position) => ({
    ...cell, position: position as PartyPosition,
    member: cell.id === null ? null : structuredClone(members.find((member) => member.id === cell.id)!),
  }));
  return { expected: structuredClone(party), selectedSlot: party.selectedSlot,
    cells, roster: members,
    blocker: cells.some((cell) => cell.member && !cell.member.enabled)
      ? "当前队伍有不可编组的成员。" : null };
}

export function previewPartyMenu(current: PartyState, roster: readonly PartyRosterEntry[], request: PartyMenuRequest) {
  validatePartyState(current, roster);
  checkpointKeys(request, "expected,change");
  validatePartyState(request.expected, roster);
  if (canonical(request.expected) !== canonical(current)) throw new Error("Stale party menu selection");
  const state = structuredClone(current), slot = state.slots[state.selectedSlot], change = request.change;
  if (slot.some((cell) => cell.id !== null && !roster.find((member) => member.id === cell.id)!.enabled))
    throw new Error("Current party has unavailable members");
  if (change.kind === "swap") {
    checkpointKeys(change, "kind,from,to");
    checkpointInteger(change.from, 0, 3); checkpointInteger(change.to, 0, 3);
    // A row travels with its owned member. Empty cells remain explicit cells.
    [slot[change.from], slot[change.to]] = [slot[change.to], slot[change.from]];
  } else if (change.kind === "set-row") {
    checkpointKeys(change, "kind,position,row");
    checkpointInteger(change.position, 0, 3);
    if (change.row !== "front" && change.row !== "back") throw new Error("Invalid party menu row");
    if (slot[change.position].id === null) throw new Error("Cannot change row of an empty party position");
    slot[change.position].row = change.row;
  } else throw new Error("Unknown party menu change");
  validatePartyState(state, roster);
  return { state, changed: canonical(current) !== canonical(state), activeMembers: activePartyMembers(state) };
}
