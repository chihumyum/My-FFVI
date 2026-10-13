import { checkpointKeys } from "./checkpoint-validation.js";

/** Identity/receipt metadata only. BattleGame remains the owner of actual
 * units, conditions, AI, clocks, actions, random state and the battle result. */
export type BattleParticipantEntry = {
  id: string;
  sourceId: number;
  /** Original party slot, not an index in the compact current-unit array. The
   * ordinary source formation uses 1..9; rejecting other values is Web admission. */
  uniqueId: number;
  removed: boolean;
  exp: number;
  gil: number;
};
export type BattleParticipantInitial = Omit<BattleParticipantEntry, "removed">;
export type BattleEnemyReplacement = Omit<BattleParticipantInitial, "id">;
export type BattleParticipantState = {
  kind: "battle-participant-state-v1";
  /** Web instance generations are never source slot identities. History is
   * retained so a restored/rolled-back allocator cannot alias a prior unit. */
  nextGeneration: number;
  entries: BattleParticipantEntry[];
};
export type BattleParticipantRewardScope = "active-units" | "all-entered";

const maximum = 0x7fffffff;
const dynamicPrefix = "enemy:dynamic:";

function integer(value: unknown, minimum = 0, limit = maximum): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > limit)
    throw new Error("Invalid battle participant integer");
}
function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length || value.trim() !== value || /\s/.test(value))
    throw new Error("Invalid battle participant instance identity");
}
function replacement(raw: unknown): BattleEnemyReplacement {
  checkpointKeys(raw, "sourceId,uniqueId,exp,gil");
  const value = raw as BattleEnemyReplacement;
  integer(value.sourceId, 1); integer(value.uniqueId, 1, 9);
  integer(value.exp); integer(value.gil);
  return { sourceId: value.sourceId, uniqueId: value.uniqueId, exp: value.exp, gil: value.gil };
}

/** External snapshots are exact, dense, detached metadata. A valid allocator
 * has retained each generated instance in order, including retired units.
 * This namespace/generation rule is a Web identity protocol, not native behavior. */
export function parseBattleParticipantState(raw: unknown): BattleParticipantState {
  checkpointKeys(raw, "kind,nextGeneration,entries");
  const value = raw as BattleParticipantState;
  if (value.kind !== "battle-participant-state-v1") throw new Error("Invalid battle participant state kind");
  integer(value.nextGeneration, 1);
  if (!Array.isArray(value.entries) || Object.keys(value.entries).length !== value.entries.length)
    throw new Error("Invalid battle participant history");
  const ids = new Set<string>(), activeSlots = new Set<number>(), initialSlots = new Set<number>();
  let generated = 0;
  const entries = Array.from(value.entries, (entry, index): BattleParticipantEntry => {
    if (!Object.hasOwn(value.entries, index)) throw new Error("Sparse battle participant history");
    checkpointKeys(entry, "id,sourceId,uniqueId,removed,exp,gil");
    identity(entry.id); integer(entry.sourceId, 1); integer(entry.uniqueId, 1, 9);
    integer(entry.exp); integer(entry.gil);
    if (typeof entry.removed !== "boolean" || ids.has(entry.id))
      throw new Error("Invalid or duplicate battle participant identity");
    ids.add(entry.id);
    if (entry.id.startsWith(dynamicPrefix)) {
      generated++;
      // Exact string comparison rejects leading zeroes, malformed suffixes,
      // missing generations and generation rewinds without parsing source ids.
      if (entry.id !== dynamicPrefix + generated)
        throw new Error("Invalid battle participant generation history");
    } else {
      if (generated || initialSlots.has(entry.uniqueId))
        throw new Error("Invalid initial battle participant history");
      initialSlots.add(entry.uniqueId);
    }
    if (!entry.removed) {
      if (activeSlots.has(entry.uniqueId)) throw new Error("Duplicate active battle participant slot");
      activeSlots.add(entry.uniqueId);
    }
    return { id: entry.id, sourceId: entry.sourceId, uniqueId: entry.uniqueId,
      removed: entry.removed, exp: entry.exp, gil: entry.gil };
  });
  if (generated + 1 !== value.nextGeneration)
    throw new Error("Battle participant allocator disagrees with history");
  const latest = new Map(entries.map(entry => [entry.uniqueId, entry.id]));
  if (entries.some(entry => !entry.removed && latest.get(entry.uniqueId) !== entry.id))
    throw new Error("Retired battle participant identity cannot become active again");
  return { kind: "battle-participant-state-v1", nextGeneration: value.nextGeneration, entries };
}

/** The caller supplies explicit source slots; opaque initial instance ids are
 * never decoded to guess their source slot. The dynamic namespace is reserved. */
export function createBattleParticipantState(initial: readonly BattleParticipantInitial[]): BattleParticipantState {
  if (!Array.isArray(initial) || Object.keys(initial).length !== initial.length)
    throw new Error("Invalid initial battle participants");
  const entries = Array.from(initial, (entry, index): BattleParticipantEntry => {
    if (!Object.hasOwn(initial, index)) throw new Error("Sparse initial battle participants");
    checkpointKeys(entry, "id,sourceId,uniqueId,exp,gil");
    identity(entry.id);
    if (entry.id.startsWith(dynamicPrefix)) throw new Error("Reserved dynamic battle participant identity");
    return { id: entry.id, ...replacement({ sourceId: entry.sourceId, uniqueId: entry.uniqueId,
      exp: entry.exp, gil: entry.gil }), removed: false };
  });
  return parseBattleParticipantState({ kind: "battle-participant-state-v1", nextGeneration: 1, entries });
}

/** Pure preparation: replacing a source slot retires its current instance;
 * entering a previously empty slot retires none. No death/drop event is inferred.
 * The caller publishes this state with the complete unit/AI/clock transaction. */
export function projectEnemyReplacement(
  raw: BattleParticipantState,
  request: BattleEnemyReplacement,
): { state: BattleParticipantState; instanceId: string; removedId: string | null } {
  const state = parseBattleParticipantState(raw), next = replacement(request);
  if (state.nextGeneration === maximum) throw new Error("Battle participant generation exhausted");
  const instanceId = dynamicPrefix + state.nextGeneration;
  if (state.entries.some(entry => entry.id === instanceId))
    throw new Error("Battle participant instance identity collision");
  const previous = state.entries.find(entry => !entry.removed && entry.uniqueId === next.uniqueId);
  if (previous) previous.removed = true;
  state.entries.push({ id: instanceId, ...next, removed: false });
  state.nextGeneration++;
  return { state, instanceId, removedId: previous?.id ?? null };
}

/** Ordered by actual entry, not by parsed ids or a guessed native accessor order. */
export function activeBattleParticipantIds(raw: BattleParticipantState): string[] {
  return parseBattleParticipantState(raw).entries.filter(entry => !entry.removed).map(entry => entry.id);
}

/** EXP/Gil scope is supplied explicitly by admitted content. Native removal
 * bookkeeping is unresolved; this helper never decides rewards from HP/death,
 * fabricates drop registrations, or defaults an unknown scope. */
export function projectBattleParticipantRewards(
  raw: BattleParticipantState,
  scope: BattleParticipantRewardScope,
): { exp: number; gil: number } {
  const state = parseBattleParticipantState(raw);
  if (scope !== "active-units" && scope !== "all-entered")
    throw new Error("Unknown battle participant reward scope");
  let exp = 0, gil = 0;
  for (const entry of state.entries) {
    if (scope === "active-units" && entry.removed) continue;
    exp += entry.exp; gil += entry.gil;
    integer(exp); integer(gil);
  }
  return { exp, gil };
}

/** Optimistic pre-publication check only; this function owns no live state.
 * Comparing the complete ordered history also catches read-only metadata drift. */
export function assertBattleParticipantStateCurrent(
  actual: BattleParticipantState,
  expected: BattleParticipantState,
): void {
  if (JSON.stringify(parseBattleParticipantState(actual)) !== JSON.stringify(parseBattleParticipantState(expected)))
    throw new Error("Stale battle participant state");
}
