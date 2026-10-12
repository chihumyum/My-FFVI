import type { Direction } from "../field/types.js";
import type { FieldPuppetRosterRead } from "./field-puppet-roster.js";
import type { FieldTaskRange } from "./field-task-control.js";
import { int32 } from "./script-integer.js";

/** A read of the shared owner; these branches do not retain a second roster. */
export type EventContextBranchOp =
  | {
      kind: "branch-character";
      sourceId: number;
      presence: "present" | "absent";
      scope: "current-party" | "enabled-roster";
      target: number;
    }
  | {
      kind: "branch-player-direction";
      /** North, east, south, west source label addresses. Zero is a valid label. */
      targets: readonly [number, number, number, number];
    };

export type EventContextBranchInput = {
  /** Web cursor after fetching the current instruction. */
  nextPc: number;
  range: FieldTaskRange;
  roster?: FieldPuppetRosterRead;
  /** The actual player, not the current task actor. Null is a known source zero
   * direction; an omitted/undefined value means the provider is unavailable. */
  playerDirection?: Direction | null;
};

function address(value: number): number {
  if (int32(value) < 0) throw new Error("Invalid event context branch address");
  return value;
}

function inRange(value: number, range: FieldTaskRange): void {
  address(value);
  if (value < range.min || value > range.max)
    throw new Error("Event context branch leaves the source task range");
}

function characterPresent(
  sourceId: number,
  scope: "current-party" | "enabled-roster",
  roster: FieldPuppetRosterRead | undefined,
): boolean {
  if (int32(sourceId) <= 0) throw new Error("Invalid source character identity");
  if (!roster || !Array.isArray(roster.owned) || !Array.isArray(roster.party) ||
      roster.party.length !== 4)
    throw new Error("Missing event context branch roster provider");
  const byOwnedId = new Map<number, FieldPuppetRosterRead["owned"][number]>();
  for (const member of roster.owned) {
    if (!member || int32(member.ownedId) <= 0 || int32(member.sourceId) <= 0 ||
        typeof member.enabled !== "boolean" || byOwnedId.has(member.ownedId))
      throw new Error("Invalid event context branch owned identity");
    byOwnedId.set(member.ownedId, member);
  }
  const occupied = new Set<number>();
  for (const ownedId of roster.party) {
    if (int32(ownedId) < 0 || (ownedId !== 0 &&
        (!byOwnedId.has(ownedId) || occupied.has(ownedId))))
      throw new Error("Unresolved event context branch corps identity");
    if (ownedId !== 0) occupied.add(ownedId);
  }
  if (scope === "current-party") {
    // GetMemberData matches Corps.CharacterId to Owned.Id without enabled filtering.
    return roster.party.some((ownedId) => byOwnedId.get(ownedId)?.sourceId === sourceId);
  }
  if (scope === "enabled-roster") {
    // GetOwnedCharactersClone(false) filters IsEnableCorps before copying members.
    return roster.owned.some((member) => member.enabled && member.sourceId === sourceId);
  }
  throw new Error("Unsupported event context branch roster scope");
}

/** Both source instructions return Next. JumpCommon writes the label address;
 * Core.Clock then calls ForwardStep, so the next executable address is label+1.
 * Validation completes before returning a replacement cursor to the host. */
export function prepareEventContextBranch(
  op: EventContextBranchOp,
  input: EventContextBranchInput,
): { pc: number; branched: boolean } {
  address(input.range.min);
  address(input.range.max);
  if (input.range.min > input.range.max) throw new Error("Invalid source task range");
  inRange(input.nextPc - 1, input.range);
  let target: number | null = null;
  switch (op.kind) {
    case "branch-character": {
      address(op.target);
      if (op.presence !== "present" && op.presence !== "absent")
        throw new Error("Unsupported event context branch presence predicate");
      const present = characterPresent(op.sourceId, op.scope, input.roster);
      if (present === (op.presence === "present")) target = op.target;
      break;
    }
    case "branch-player-direction": {
      if (!Array.isArray(op.targets) || op.targets.length !== 4)
        throw new Error("Missing player-direction branch targets");
      for (const candidate of op.targets) address(candidate);
      const directions = { up: 0, right: 1, down: 2, left: 3 } as const;
      // Native normalized (0,0) satisfies x==0, y<=0 and selects south.
      const direction = input.playerDirection;
      if (direction !== null && (typeof direction !== "string" ||
          !Object.hasOwn(directions, direction)))
        throw new Error("Missing or unsupported actual player direction");
      target = op.targets[direction === null ? 2 : directions[direction]]!;
      break;
    }
    default:
      throw new Error("Unsupported event context branch instruction");
  }
  if (target !== null) inRange(target, input.range);
  const pc = target === null ? input.nextPc : target + 1;
  inRange(pc, input.range);
  return { pc, branched: target !== null };
}
