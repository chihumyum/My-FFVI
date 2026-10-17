import { emptyPartyState, type PartyState } from "../../src/core/party.js";

/** Explicit synthetic initial membership for shared-state mechanism tests. */
export function fixtureParty(ids: readonly string[]): PartyState {
  if (ids.length > 4) throw new Error("Synthetic party exceeds four positions");
  const party = emptyPartyState();
  ids.forEach((id, i) => {
    party.slots[0][i]!.id = id;
  });
  return party;
}
