import type { FieldPuppetRosterRead } from "./field-puppet-roster.js";
import type { FieldTaskRange } from "./field-task-control.js";
import { int32, integerOperation, isOperator, type Operator } from "./script-integer.js";

/** Queries read the shared owned/party projection. They never retain a roster or
 * infer a leader from the player sprite. Further source selectors remain gated. */
export type FieldPartyQuery = {
  kind: "member-count";
  scope: "current-party" | "enabled-roster";
};

export type FieldPartyQueryOp = {
  kind: "field-party-query";
  query: FieldPartyQuery;
  operator: Operator;
  value: number;
  /** Source label address, before Core.Clock's ForwardStep. */
  target: number;
};

export type FieldPartyQueryInput = {
  /** The task cursor after fetching this instruction. */
  nextPc: number;
  range: FieldTaskRange;
  roster?: FieldPuppetRosterRead;
};

/** BranchByNumOfMember (0xb44440): scope zero reads GetCorpsListClone()
 * (0x86e820), the current list replaced by SwitchSlot (0xaabdf0), not all three
 * saved Corps slots. GetMemberData (0x870230) resolves Owned.Id without filtering
 * enabled, HP or conditions. Nonzero scope reads GetOwnedCharactersClone(false)
 * (0x871840), whose IsEnableCorps filter is independent of current membership. */
export function queryFieldParty(
  query: FieldPartyQuery,
  roster: FieldPuppetRosterRead | undefined,
): number {
  if (!query || query.kind !== "member-count" ||
      (query.scope !== "current-party" && query.scope !== "enabled-roster"))
    throw new Error("Unsupported field party query");
  if (!roster || !Array.isArray(roster.owned) || !Array.isArray(roster.party) ||
      roster.party.length !== 4)
    throw new Error("Missing field party query roster provider");
  const ownedIds = new Set<number>();
  for (const member of roster.owned) {
    if (!member || int32(member.ownedId) <= 0 || int32(member.sourceId) <= 0 ||
        typeof member.enabled !== "boolean" || ownedIds.has(member.ownedId))
      throw new Error("Invalid field party query owned identity");
    ownedIds.add(member.ownedId);
  }
  const occupied = new Set<number>();
  for (const ownedId of roster.party) {
    if (int32(ownedId) < 0 || (ownedId !== 0 &&
        (!ownedIds.has(ownedId) || occupied.has(ownedId))))
      throw new Error("Unresolved field party query corps identity");
    if (ownedId !== 0) occupied.add(ownedId);
  }
  // These are owner identities, not distinct CharacterStatus source IDs. Active
  // conditions do not remove an owner from either source count.
  return query.scope === "current-party" ? occupied.size :
    int32(roster.owned.filter((member) => member.enabled).length);
}

function address(value: number): number {
  if (int32(value) < 0) throw new Error("Invalid field party query address");
  return value;
}

function inRange(value: number, range: FieldTaskRange): void {
  address(value);
  if (value < range.min || value > range.max)
    throw new Error("Field party query leaves the source task range");
}

/** Source OperationMain's result must equal exactly one; arithmetic results are
 * not JS truthiness. JumpCommon runs only on that result, then Next skips the
 * label once. Return a private cursor proposal; the host publishes it after all
 * validation without changing locals, actors, the party or the task stack. */
export function prepareFieldPartyQuery(
  op: FieldPartyQueryOp,
  input: FieldPartyQueryInput,
): { pc: number; branched: boolean; value: number } {
  if (!op || op.kind !== "field-party-query" || !isOperator(op.operator))
    throw new Error("Unsupported field party query instruction");
  address(input.range.min);
  address(input.range.max);
  if (input.range.min > input.range.max) throw new Error("Invalid source task range");
  inRange(input.nextPc - 1, input.range);
  address(op.target);
  int32(op.value);
  const value = queryFieldParty(op.query, input.roster);
  const branched = integerOperation(value, op.operator, op.value) === 1;
  if (branched) inRange(op.target, input.range);
  const pc = branched ? op.target + 1 : input.nextPc;
  inRange(pc, input.range);
  return { pc, branched, value };
}
