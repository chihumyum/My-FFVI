import { checkpointKeys } from "./checkpoint-validation.js";
import { int32 } from "./script-integer.js";
import type { PartyActorMember } from "./party-actors.js";

export type PartySlotIndex = 0 | 1 | 2;
export type PartyPosition = 0 | 1 | 2 | 3;
export type PartyRow = "front" | "back";
/** Empty Corps positions still retain their front/back row. */
export type PartyCell = { id: string | null; row: PartyRow };
export type PartySlot = [PartyCell, PartyCell, PartyCell, PartyCell];
export type PartyState = {
  selectedSlot: PartySlotIndex;
  slots: [PartySlot, PartySlot, PartySlot];
};

/** id is an owned identity, sourceId is CharacterStatus.Id; they are not interchangeable. */
export type PartyRosterEntry = {
  id: string;
  sourceId: number;
  /** IsEnableCorps is independent of membership in any saved party slot. */
  enabled: boolean;
};
export type ActivePartyMember = {
  id: string;
  index: PartyPosition;
  row: PartyRow;
};
export type PartyCommand =
  | {
      kind: "organize-slot";
      slot: PartySlotIndex;
      /** Source character-status references, not owned identities. */
      members: [number | null, number | null, number | null, number | null];
      refreshActors: true;
    }
  | {
      kind: "select-slot";
      slot: PartySlotIndex;
      refreshActors: boolean;
    };
export type PartyEventOp = {
  kind: "party";
  command: PartyCommand;
  dependencies: { table: string; id: number }[];
};
export type PartyPreview = {
  state: PartyState;
  /** Omit empty entries here, but keep each source position in index. */
  activeMembers: ActivePartyMember[];
  refreshActors: boolean;
};
export type PartyEventTransaction = {
  readonly activeMembers: ActivePartyMember[];
  readonly refreshActors: boolean;
  readonly appearance?: PartyAppearanceCandidate;
  /** Reject stale/repeated publication, and publish the prepared state exactly once. */
  commit(): void;
};
/** Detached owned identities from the same transaction as the slot mutation. */
export type PartyAppearanceCandidate = {
  activeMembers: PartyActorMember[];
  parties: PartyActorMember[][];
};
export interface FieldPartyPort {
  /**
   * Prepare an independent owned-state draft. The field host prepares required
   * actor refresh before executePartyEvent publishes either projection.
   * Preparation must not mutate shared state or presentation.
   */
  prepare(command: PartyCommand): PartyEventTransaction;
}
/** Preparation may fail; the returned publication must be synchronous and non-failing. */
export type PreparePartyPresentation = (
  members: ActivePartyMember[],
  appearance?: PartyAppearanceCandidate,
  setDummy?: boolean,
) => () => void;

function slotIndex(value: number): PartySlotIndex {
  if (!Number.isInteger(value) || value < 0 || value > 2)
    throw new Error("Invalid party slot");
  return value as PartySlotIndex;
}
function sourceId(value: number): number {
  if (int32(value) <= 0) throw new Error("Invalid party character reference");
  return value;
}
function ownedIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function validateStructure(state: PartyState): void {
  checkpointKeys(state, "selectedSlot,slots");
  slotIndex(state.selectedSlot);
  if (!Array.isArray(state.slots) || state.slots.length !== 3)
    throw new Error("Party requires three saved slots");
  for (const slot of state.slots) {
    if (!Array.isArray(slot) || slot.length !== 4)
      throw new Error("Party slot requires four positions");
    const occupied = new Set<string>();
    for (const cell of slot) {
      checkpointKeys(cell, "id,row");
      if (cell.row !== "front" && cell.row !== "back")
        throw new Error("Invalid party row");
      if (cell.id === null) continue;
      if (!ownedIdentity(cell.id))
        throw new Error("Invalid party owned identity");
      // Native SetSlot does not enforce uniqueness. Duplicate actors are outside
      // the admitted battle/field model, so never silently remove or coalesce one.
      if (occupied.has(cell.id))
        throw new Error("Repeated actor within a party slot is not supported");
      occupied.add(cell.id);
    }
  }
}
function rosterIndex(roster: readonly PartyRosterEntry[]) {
  const ids = new Set<string>();
  const sources = new Map<number, string>();
  for (const member of roster) {
    if (!ownedIdentity(member.id) || typeof member.enabled !== "boolean")
      throw new Error("Invalid party roster entry");
    sourceId(member.sourceId);
    if (ids.has(member.id) || sources.has(member.sourceId))
      throw new Error("Ambiguous party roster identity");
    ids.add(member.id);
    sources.set(member.sourceId, member.id);
  }
  return { ids, sources };
}

/** CorpsClient.Initialize: three independent empty lists, front row, selected slot zero. */
export function emptyPartyState(): PartyState {
  const blank = (): PartySlot => [
    { id: null, row: "front" },
    { id: null, row: "front" },
    { id: null, row: "front" },
    { id: null, row: "front" },
  ];
  return { selectedSlot: 0, slots: [blank(), blank(), blank()] };
}

export function validatePartyState(
  state: PartyState,
  roster: readonly PartyRosterEntry[],
): void {
  validateStructure(state);
  const { ids } = rosterIndex(roster);
  for (const slot of state.slots)
    for (const cell of slot)
      if (cell.id !== null && !ids.has(cell.id))
        throw new Error(`Party references unowned character ${cell.id}`);
}

export function activePartyMembers(state: PartyState): ActivePartyMember[] {
  validateStructure(state);
  return state.slots[state.selectedSlot].flatMap((cell, index) =>
    cell.id === null
      ? []
      : [{ id: cell.id, index: index as PartyPosition, row: cell.row }],
  );
}

export function validatePartyCommand(command: PartyCommand): void {
  slotIndex(command.slot);
  if (command.kind === "select-slot") {
    checkpointKeys(command, "kind,slot,refreshActors");
    if (typeof command.refreshActors !== "boolean")
      throw new Error("Invalid party refresh request");
    return;
  }
  if (command.kind !== "organize-slot")
    throw new Error("Unknown party command");
  checkpointKeys(command, "kind,slot,members,refreshActors");
  if (
    !Array.isArray(command.members) ||
    command.members.length !== 4 ||
    command.refreshActors !== true
  )
    throw new Error("Invalid party organization request");
  const seen = new Set<number>();
  for (const member of command.members) {
    if (member === null) continue;
    sourceId(member);
    if (seen.has(member))
      throw new Error("Repeated actor within a party slot is not supported");
    seen.add(member);
  }
}

/**
 * Pure slot editing. It never unlocks/enables a character, initializes stats,
 * changes equipment or chooses an implicit fallback party. Missing identities
 * fail before any change. Organize uses all owned characters, including disabled.
 */
export function previewPartyCommand(
  current: PartyState,
  roster: readonly PartyRosterEntry[],
  command: PartyCommand,
): PartyPreview {
  validatePartyState(current, roster);
  validatePartyCommand(command);
  const state = structuredClone(current);
  if (command.kind === "select-slot") {
    state.selectedSlot = command.slot;
  } else {
    const { sources } = rosterIndex(roster);
    const resolved = command.members.map((member) => {
      if (member === null) return null;
      const id = sources.get(member);
      if (id === undefined)
        throw new Error(`Party references unowned source character ${member}`);
      return id;
    });
    state.slots[command.slot] = resolved.map((id, position) =>
      id === null
        ? { ...state.slots[command.slot][position]!, id: null }
        : { id, row: "front" },
    ) as PartySlot;
  }
  validatePartyState(state, roster);
  return {
    state,
    activeMembers: activePartyMembers(state),
    refreshActors: command.refreshActors,
  };
}

export function executePartyEvent(
  op: PartyEventOp,
  party: FieldPartyPort | undefined,
  preparePresentation?: PreparePartyPresentation,
): void {
  if (!party) throw new Error("Field party state is unavailable");
  if (op.kind !== "party") throw new Error("Invalid party event");
  validatePartyCommand(op.command);
  const transaction = party.prepare(structuredClone(op.command));
  if (transaction.refreshActors !== op.command.refreshActors)
    throw new Error("Party refresh transaction contract changed");
  let publishPresentation: (() => void) | undefined;
  if (transaction.refreshActors) {
    if (!preparePresentation)
      throw new Error("Party actor refresh is unavailable");
    publishPresentation = preparePresentation(
      structuredClone(transaction.activeMembers),
      structuredClone(transaction.appearance),
    );
    if (typeof publishPresentation !== "function")
      throw new Error("Invalid party presentation transaction");
  }
  transaction.commit();
  publishPresentation?.();
}
