import { checkpointInteger } from "./checkpoint-validation.js";
import type { FieldPuppetOwned } from "./field-puppet-actors.js";
import { validatePartyState, type PartyState } from "./party.js";

/** A detached read of the shared character owner, not another saved roster.
 * Source Corps cells contain OwnedCharacterData.Id; zero denotes an empty cell. */
export type FieldPuppetRosterRead = {
  owned: FieldPuppetOwned[];
  party: [number, number, number, number];
};

export type FieldPuppetRosterPort = {
  current(): FieldPuppetRosterRead;
  /** Same GameState owner, all three source Corps cells; never an active-party reconstruction. */
  replacement?(): import("./field-puppet-replacement.js").FieldPuppetReplacementRoster;
};

export type FieldPuppetRosterMember = {
  id: string;
  ownedId: number;
  sourceId: number;
  enabled: boolean;
  conditionIds: number[];
};

/** GetOwnedCharactersClone is a whole-roster read. Native resident selection
 * applies its enabled/source-id/order predicates afterward; deriving this from
 * the active party would incorrectly erase disabled or out-of-party owners. */
export function projectFieldPuppetRoster(
  roster: readonly FieldPuppetRosterMember[],
  party: PartyState,
  conditionDefinitions: readonly { id: number; type: number }[],
): FieldPuppetRosterRead {
  if (!Array.isArray(roster) || !Array.isArray(conditionDefinitions))
    throw new Error("Missing source puppet roster owner");
  validatePartyState(party, roster);
  const types = new Map<number, number>();
  for (const definition of conditionDefinitions) {
    checkpointInteger(definition.id, 1, 0x7fffffff);
    // The full source catalog includes None/type 0; unused definitions must
    // not be mistaken for an active condition or rejected as missing behavior.
    checkpointInteger(definition.type, 0, 0x7fffffff);
    if (types.has(definition.id))
      throw new Error("Ambiguous source puppet condition identity");
    types.set(definition.id, definition.type);
  }
  const ownedIds = new Set<number>();
  const ids = new Map<string, number>();
  const owned = roster.map((member: FieldPuppetRosterMember): FieldPuppetOwned => {
    checkpointInteger(member.ownedId, 1, 0x7fffffff);
    if (ownedIds.has(member.ownedId) || !Array.isArray(member.conditionIds) ||
        new Set(member.conditionIds).size !== member.conditionIds.length)
      throw new Error("Ambiguous source puppet owned identity or condition list");
    ownedIds.add(member.ownedId);
    ids.set(member.id, member.ownedId);
    return {
      ownedId: member.ownedId,
      sourceId: member.sourceId,
      enabled: member.enabled,
      conditionTypes: member.conditionIds.map((id) => {
        checkpointInteger(id, 1, 0x7fffffff);
        const type = types.get(id);
        if (type === undefined)
          throw new Error("Unknown source puppet owned condition: " + id);
        return type;
      }),
    };
  });
  return {
    owned,
    party: party.slots[party.selectedSlot].map((cell) =>
      cell.id === null ? 0 : ids.get(cell.id)!,
    ) as FieldPuppetRosterRead["party"],
  };
}
