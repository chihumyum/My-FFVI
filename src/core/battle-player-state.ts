import { checkpointKeys } from "./checkpoint-validation.js";

export type BattlePlayerRow = "front" | "back";
export type BattlePlayerOwner = { ownedId: string; sourceId: number };
/** The caller supplies an existing held record's identity. An empty Corps cell
 * retains its row and has no source identity to infer or initialize. */
export type BattlePlayerGroupSlot = { ownedId: string | null; sourceId?: number; row: BattlePlayerRow };
export type BattlePlayerSlot = { instanceId: string | null; row: BattlePlayerRow };
export type BattlePlayerEntry = BattlePlayerOwner & {
  instanceId: string;
  slot: number;
  row: BattlePlayerRow;
  removed: boolean;
};
export type BattlePlayerState = {
  kind: "battle-player-state-v1";
  nextGeneration: number;
  entries: BattlePlayerEntry[];
  /** Exactly four saved cells, including empty-cell rows. */
  slots: BattlePlayerSlot[];
};
export type BattlePlayerProjection = {
  state: BattlePlayerState;
  removedIds: string[];
  joins: Omit<BattlePlayerEntry, "removed">[];
};

const maximum = 0x7fffffff;
const dynamicPrefix = "player:dynamic:";

function integer(value: unknown, minimum = 0, limit = maximum): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > limit)
    throw new Error("Invalid battle player integer");
}
function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length || value.trim() !== value || /\s/.test(value))
    throw new Error("Invalid battle player identity");
}
function ownedIdentity(value: unknown): asserts value is string {
  identity(value);
  if (value.startsWith(dynamicPrefix)) throw new Error("Reserved dynamic battle player identity");
}
function row(value: unknown): asserts value is BattlePlayerRow {
  if (value !== "front" && value !== "back") throw new Error("Invalid battle player row");
}
function dense(value: unknown, length?: number): asserts value is unknown[] {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length) ||
      Object.keys(value).length !== value.length ||
      Array.from({ length: value.length }, (_, index) => !Object.hasOwn(value, index)).some(Boolean))
    throw new Error("Invalid or sparse battle player collection");
}
function owner(raw: unknown): BattlePlayerOwner {
  checkpointKeys(raw, "ownedId,sourceId");
  const value = raw as BattlePlayerOwner;
  ownedIdentity(value.ownedId); integer(value.sourceId, 1);
  return { ownedId: value.ownedId, sourceId: value.sourceId };
}

/** A source identity cannot be silently rebound to a different held record,
 * nor can a held record change source identity on a later battle entry. */
function bindOwner(
  value: BattlePlayerOwner,
  byOwner: Map<string, number>,
  bySource: Map<number, string>,
): void {
  if ((byOwner.has(value.ownedId) && byOwner.get(value.ownedId) !== value.sourceId) ||
      (bySource.has(value.sourceId) && bySource.get(value.sourceId) !== value.ownedId))
    throw new Error("Battle player held/source identity changed");
  byOwner.set(value.ownedId, value.sourceId); bySource.set(value.sourceId, value.ownedId);
}
function groupSlots(raw: unknown): BattlePlayerGroupSlot[] {
  dense(raw, 4);
  const owners = new Set<string>(), sources = new Set<number>();
  return raw.map((entry): BattlePlayerGroupSlot => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid battle player group cell");
    const value = entry as BattlePlayerGroupSlot;
    row(value.row);
    if (value.ownedId === null) {
      checkpointKeys(value, "ownedId,row");
      return { ownedId: null, row: value.row };
    }
    checkpointKeys(value, "ownedId,sourceId,row");
    const current = owner({ ownedId: value.ownedId, sourceId: value.sourceId });
    if (owners.has(current.ownedId) || sources.has(current.sourceId))
      throw new Error("Duplicate battle player group owner/source identity");
    owners.add(current.ownedId); sources.add(current.sourceId);
    return { ...current, row: value.row };
  });
}

/** Detached metadata only: no HP, equipment, learning, AI or persistent roster
 * is copied here. The battle owner supplies trustworthy held-record identities. */
export function parseBattlePlayerState(raw: unknown): BattlePlayerState {
  checkpointKeys(raw, "kind,nextGeneration,entries,slots");
  const value = raw as BattlePlayerState;
  if (value.kind !== "battle-player-state-v1") throw new Error("Invalid battle player state kind");
  integer(value.nextGeneration, 1); dense(value.entries); dense(value.slots, 4);
  const instanceIds = new Set<string>(), activeOwners = new Set<string>(), activeSlots = new Set<number>();
  const byOwner = new Map<string, number>(), bySource = new Map<number, string>(), latest = new Map<string, string>();
  let generated = 0, initialSlot = -1;
  const entries = value.entries.map((entry): BattlePlayerEntry => {
    checkpointKeys(entry, "instanceId,ownedId,sourceId,slot,row,removed");
    identity(entry.instanceId); ownedIdentity(entry.ownedId); integer(entry.sourceId, 1);
    integer(entry.slot, 0, 3); row(entry.row);
    if (typeof entry.removed !== "boolean" || instanceIds.has(entry.instanceId))
      throw new Error("Invalid or duplicate battle player instance identity");
    instanceIds.add(entry.instanceId); bindOwner(entry, byOwner, bySource);
    latest.set(entry.ownedId, entry.instanceId);
    if (entry.instanceId.startsWith(dynamicPrefix)) {
      generated++;
      if (entry.instanceId !== dynamicPrefix + generated)
        throw new Error("Invalid battle player generation history");
    } else {
      if (generated || entry.instanceId !== entry.ownedId || entry.slot <= initialSlot)
        throw new Error("Invalid initial battle player history");
      initialSlot = entry.slot;
    }
    if (!entry.removed) {
      if (activeOwners.has(entry.ownedId) || activeSlots.has(entry.slot))
        throw new Error("Duplicate active battle player owner/slot");
      activeOwners.add(entry.ownedId); activeSlots.add(entry.slot);
    }
    return { instanceId: entry.instanceId, ownedId: entry.ownedId, sourceId: entry.sourceId,
      slot: entry.slot, row: entry.row, removed: entry.removed };
  });
  if (value.nextGeneration !== generated + 1) throw new Error("Battle player allocator disagrees with history");
  const slots = value.slots.map((entry): BattlePlayerSlot => {
    checkpointKeys(entry, "instanceId,row"); row(entry.row);
    if (entry.instanceId !== null) identity(entry.instanceId);
    return { instanceId: entry.instanceId, row: entry.row };
  });
  for (const entry of entries) {
    if (entry.removed) {
      if (slots.some(slot => slot.instanceId === entry.instanceId))
        throw new Error("Retired battle player instance occupies a current slot");
    } else if (slots[entry.slot]!.instanceId !== entry.instanceId || slots[entry.slot]!.row !== entry.row ||
        latest.get(entry.ownedId) !== entry.instanceId)
      throw new Error("Battle player active slot/history mismatch");
  }
  for (const [index, slot] of slots.entries()) if (slot.instanceId !== null &&
      !entries.some(entry => !entry.removed && entry.instanceId === slot.instanceId && entry.slot === index))
    throw new Error("Battle player slot has no active instance");
  return { kind: "battle-player-state-v1", nextGeneration: value.nextGeneration, entries, slots };
}

/** Preserve the saved four-cell layout exactly. Empty metadata is permitted
 * here; deciding whether an empty party may enter battle belongs to the host. */
export function createBattlePlayerState(initial: readonly BattlePlayerGroupSlot[]): BattlePlayerState {
  const group = groupSlots(initial), entries: BattlePlayerEntry[] = [];
  const slots = group.map((cell, slot): BattlePlayerSlot => {
    if (cell.ownedId !== null) entries.push({ instanceId: cell.ownedId, ownedId: cell.ownedId,
      sourceId: cell.sourceId!, slot, row: cell.row, removed: false });
    return { instanceId: cell.ownedId, row: cell.row };
  });
  return parseBattlePlayerState({ kind: "battle-player-state-v1", nextGeneration: 1, entries, slots });
}

function admitOwners(state: BattlePlayerState, owners: readonly BattlePlayerOwner[]): void {
  const byOwner = new Map<string, number>(), bySource = new Map<number, string>();
  for (const entry of state.entries) bindOwner(entry, byOwner, bySource);
  for (const entry of owners) bindOwner(entry, byOwner, bySource);
}
function reserveInstances(state: BattlePlayerState, count: number): string[] {
  if (state.nextGeneration > maximum - count) throw new Error("Battle player generation exhausted");
  const ids = Array.from({ length: count }, (_, index) => dynamicPrefix + (state.nextGeneration + index));
  if (ids.some(id => state.entries.some(entry => entry.instanceId === id)))
    throw new Error("Battle player instance identity collision");
  return ids;
}

/** Join borrows a known held-record identity. It never initializes that record
 * or enables the persistent party. The first empty saved cell supplies its row. */
export function projectPlayerJoin(raw: BattlePlayerState, request: BattlePlayerOwner): BattlePlayerProjection {
  const state = parseBattlePlayerState(raw), candidate = owner(request);
  admitOwners(state, [candidate]);
  if (state.entries.some(entry => !entry.removed && entry.ownedId === candidate.ownedId))
    throw new Error("Battle player owner is already active");
  const slot = state.slots.findIndex(cell => cell.instanceId === null);
  if (slot < 0) throw new Error("Battle player party is full");
  const instanceId = reserveInstances(state, 1)[0]!, currentRow = state.slots[slot]!.row;
  const join = { instanceId, ...candidate, slot, row: currentRow };
  state.entries.push({ ...join, removed: false }); state.nextGeneration++;
  state.slots[slot] = { instanceId, row: currentRow };
  return { state, removedIds: [], joins: [join] };
}

/** Replace a complete four-cell player group. Old instances retire; returning
 * held records get new instance ids while retaining their source identity. */
export function projectPlayerGroup(raw: BattlePlayerState, requested: readonly BattlePlayerGroupSlot[]): BattlePlayerProjection {
  const state = parseBattlePlayerState(raw), group = groupSlots(requested);
  const owners = group.flatMap(cell => cell.ownedId === null ? [] : [{ ownedId: cell.ownedId, sourceId: cell.sourceId! }]);
  if (!owners.length) throw new Error("Replacement battle player group must not be empty");
  admitOwners(state, owners);
  const ids = reserveInstances(state, owners.length), joins: BattlePlayerProjection["joins"] = [];
  const slots = group.map((cell, slot): BattlePlayerSlot => {
    if (cell.ownedId === null) return { instanceId: null, row: cell.row };
    const instanceId = ids[joins.length]!;
    joins.push({ instanceId, ownedId: cell.ownedId, sourceId: cell.sourceId!, slot, row: cell.row });
    return { instanceId, row: cell.row };
  });
  const removedIds = state.entries.filter(entry => !entry.removed).map(entry => entry.instanceId);
  for (const entry of state.entries) entry.removed = true;
  state.entries.push(...joins.map(entry => ({ ...entry, removed: false })));
  state.nextGeneration += joins.length; state.slots = slots;
  return { state, removedIds, joins };
}

/** Resource receipt order is the first actual entry of each held identity.
 * Returning in later groups never creates a second receipt for that owner. */
export function firstEnteredOwnerIds(raw: BattlePlayerState): string[] {
  return [...new Set(parseBattlePlayerState(raw).entries.map(entry => entry.ownedId))];
}
