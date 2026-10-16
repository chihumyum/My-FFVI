import { checkpointKeys } from './checkpoint-validation.js';
import { int32 } from './script-integer.js';
import { canonical } from './canonical.js';
import { BattleConditions } from './battle-conditions.js';
import { removeNullCoreConditions, type RecoverableJoinedCharacter } from './character-recovery.js';
import type { PartyState } from './party.js';
import type { FieldRecoveryTransaction } from './field-recovery.js';
export const WEB_SOURCE_BATTLE_HANDOFFS = 'web-source-battle-handoffs-atomic-v1' as const;
export type SourceBattleHandoffCatalog = {
  kind: 'source-battle-handoff-catalog-v1';
  policy: typeof WEB_SOURCE_BATTLE_HANDOFFS;
  sourceSetHash: string;
  conditions: {
    id: number;
    type: number;
    untilType: number;
  }[];
};
export type HandoffOwnedIdentity = {
  id: string;
  ownedId: number;
  sourceId: number;
};
export type SourceTakeOver0055 = {
  kind: 'source-takeover-0055-v1';
  sourceSetHash: string;
  capture: {
    battleSerial: number;
    encounterId: number;
    programHash: string;
    pc: number;
  };
  characters: (HandoffOwnedIdentity & {
    hp: number;
    mp: number;
    conditionTypes: number[];
  })[];
};
export type SourceFinalWaiting = {
  kind: 'source-final-waiting-v1';
  sourceSetHash: string;
  ownedIds: number[];
};
export type SourceBattleHandoffState = {
  takeOver0055?: SourceTakeOver0055;
  finalWaiting?: SourceFinalWaiting;
};
export type SourceBattleHandoffReturn = {
  takeOver0055?: SourceTakeOver0055;
  finalWaiting?: {
    entry: SourceFinalWaiting;
    remaining: SourceFinalWaiting;
  };
};
export type SourceBattleHandoffEntry = {
  catalogHash: string;
  catalog: SourceBattleHandoffCatalog;
  roster: (HandoffOwnedIdentity & {
    enabled: boolean;
  })[];
  battleSerial: number;
  encounterId: number;
  finalWaiting?: SourceFinalWaiting;
};
export type SourceBattleHandoffOp = {
  kind: 'source-battle-handoff';
  command: 'colosseum-recovery' | 'restore-0055';
};
export type FieldSourceBattleHandoffPort = {
  available(): boolean;
  prepare(command: SourceBattleHandoffOp['command'], battleOwnedId?: number): FieldRecoveryTransaction;
};
export type HandoffMember = HandoffOwnedIdentity & RecoverableJoinedCharacter & {
  enabled: boolean;
};
function positive(value: number): number {
  if (int32(value) <= 0) throw Error('Invalid source handoff identity');
  return value;
}
function dense(v: unknown): asserts v is unknown[] {
  if (!Array.isArray(v) || Object.keys(v).length !== v.length ||
    Array.from({ length: v.length }, (_, i) => !Object.hasOwn(v, i)).some(Boolean))
    throw Error('Invalid source handoff collection');
}
export function validateSourceBattleHandoffCatalog(c: SourceBattleHandoffCatalog): void {
  checkpointKeys(c, 'kind,policy,sourceSetHash,conditions');
  if (c.kind !== 'source-battle-handoff-catalog-v1' || c.policy !== WEB_SOURCE_BATTLE_HANDOFFS || typeof c.sourceSetHash !== 'string' || !c.sourceSetHash)
    throw Error('Unknown source handoff catalog');
  dense(c.conditions);
  const ids = new Set<number>();
  for (const row of c.conditions) {
    checkpointKeys(row, 'id,type,untilType');
    positive(row.id);
    if (int32(row.type) < 0 || int32(row.untilType) < 0 || ids.has(row.id))
      throw Error('Invalid source handoff condition master');
    ids.add(row.id);
  }
}
/** The source catalog and numeric held identities belong to the actual
 * leased GameState. An entry from another catalog cannot authorize captures
 * or pending player borrows in this Battle. This is ephemeral, never a save
 * grant or an additional story owner. */
export function parseSourceBattleHandoffEntry(raw: SourceBattleHandoffEntry): SourceBattleHandoffEntry {
  checkpointKeys(raw, 'catalogHash,catalog,roster,battleSerial,encounterId' + (Object.hasOwn(raw, 'finalWaiting') ? ',finalWaiting' : ''));
  validateSourceBattleHandoffCatalog(raw.catalog);
  if (typeof raw.catalogHash !== 'string' || !raw.catalogHash || int32(raw.battleSerial) < 0)
    throw Error('Invalid actual source handoff catalog/lease identity');
  positive(raw.encounterId); dense(raw.roster);
  const ids = new Set<string>(), owned = new Set<number>(), sources = new Set<number>();
  for (const member of raw.roster) {
    checkpointKeys(member, 'id,ownedId,sourceId,enabled');
    positive(member.ownedId); positive(member.sourceId);
    if (typeof member.id !== 'string' || !member.id || member.id.trim() !== member.id || /\s/.test(member.id) ||
        typeof member.enabled !== 'boolean' || ids.has(member.id) || owned.has(member.ownedId) || sources.has(member.sourceId))
      throw Error('Repeated or malformed actual source handoff held identity');
    ids.add(member.id); owned.add(member.ownedId); sources.add(member.sourceId);
  }
  if (Object.hasOwn(raw, 'finalWaiting')) validateSourceBattleHandoffState({ finalWaiting: raw.finalWaiting! }, raw.catalog, raw.roster);
  return structuredClone(raw);
}
export function validateSourceBattleHandoffState(state: SourceBattleHandoffState, catalog: SourceBattleHandoffCatalog, roster: readonly HandoffOwnedIdentity[]): void {
  validateSourceBattleHandoffCatalog(catalog);
  checkpointKeys(state, [Object.hasOwn(state, 'takeOver0055') ? 'takeOver0055' : '', Object.hasOwn(state, 'finalWaiting') ? 'finalWaiting' : ''].filter(Boolean).join(','));
  if (!state.takeOver0055 && !state.finalWaiting)
    throw Error('Empty source handoff facts cannot grant a state version');
  const owners = new Map(roster.map(m => [m.ownedId, m]));
  if (state.takeOver0055) {
    const h = state.takeOver0055;
    checkpointKeys(h, 'kind,sourceSetHash,capture,characters');
    if (h.kind !== 'source-takeover-0055-v1' || h.sourceSetHash !== catalog.sourceSetHash)
      throw Error('Source takeover history identity mismatch');
    checkpointKeys(h.capture, 'battleSerial,encounterId,programHash,pc');
    positive(h.capture.encounterId);
    if (int32(h.capture.battleSerial) < 0 || int32(h.capture.pc) < 0 || typeof h.capture.programHash !== 'string' || !h.capture.programHash)
      throw Error('Invalid actual source capture origin');
    dense(h.characters);
    const seen = new Set<number>();
    for (const p of h.characters) {
      checkpointKeys(p, 'id,ownedId,sourceId,hp,mp,conditionTypes');
      const owner = owners.get(positive(p.ownedId));
      if (!owner || owner.id !== p.id || owner.sourceId !== p.sourceId || seen.has(p.ownedId))
        throw Error('Retired or mismatched source takeover owned identity');
      seen.add(p.ownedId);
      if (int32(p.hp) < 0 || int32(p.mp) < 0)
        throw Error('Invalid source takeover resources');
      dense(p.conditionTypes);
      for (const type of p.conditionTypes)
        if (int32(type) < 0 || !catalog.conditions.some(c => c.type === type && c.untilType === 3))
          throw Error('Source takeover conditions are native Type / UntilType3, never ConditionId');
    }
  }
  if (state.finalWaiting) {
    const h = state.finalWaiting;
    checkpointKeys(h, 'kind,sourceSetHash,ownedIds');
    if (h.kind !== 'source-final-waiting-v1' || h.sourceSetHash !== catalog.sourceSetHash)
      throw Error('Source final waiting identity mismatch');
    dense(h.ownedIds);
    if (new Set(h.ownedIds).size !== h.ownedIds.length)
      throw Error('Repeated source waiting owned identity');
    for (const id of h.ownedIds)
      if (!owners.has(positive(id)))
        throw Error('Missing source waiting owned identity');
  }
}
/** The wrapper derives this from Corps 1/2 AFTER UI close, including cancel.
* Zero cells are omitted, never turned into a new owner or a sourceId. */
export function sourceFinalWaiting(party: PartyState, roster: readonly HandoffOwnedIdentity[], catalog: SourceBattleHandoffCatalog): SourceFinalWaiting {
  validateSourceBattleHandoffCatalog(catalog);
  const order = [[1, 0], [1, 1], [2, 0], [2, 1], [1, 2], [1, 3], [2, 2], [2, 3]] as const;
  const ownedIds = order.flatMap(([group, index]) => {
    const cell = party.slots[group][index]!;
    if (cell.id === null)
      return [];
    const found = roster.filter(m => m.id === cell.id);
    if (found.length !== 1)
      throw Error('Missing final ordering Corps owner');
    return [found[0]!.ownedId];
  });
  const finalWaiting: SourceFinalWaiting = { kind: 'source-final-waiting-v1', sourceSetHash: catalog.sourceSetHash, ownedIds };
  validateSourceBattleHandoffState({ finalWaiting }, catalog, roster);
  return finalWaiting;
}
/** Capture the actual Battle player parameters at the source instruction, not
* battle entry values, current field members or the later result projection. */
export function captureSourceTakeOver0055(catalog: SourceBattleHandoffCatalog, roster: readonly HandoffOwnedIdentity[], players: readonly (HandoffOwnedIdentity & {
  hp: number;
  mp: number;
  conditionIds: readonly number[];
})[], capture: SourceTakeOver0055['capture']): SourceTakeOver0055 {
  const rows = new Map(catalog.conditions.map(r => [r.id, r]));
  const takeOver0055: SourceTakeOver0055 = { kind: 'source-takeover-0055-v1', sourceSetHash: catalog.sourceSetHash, capture: { ...capture },
    characters: players.map(p => ({ id: p.id, ownedId: p.ownedId, sourceId: p.sourceId, hp: p.hp, mp: p.mp, conditionTypes: p.conditionIds.flatMap(id => {
        const row = rows.get(id);
        if (!row)
          throw Error('Unknown actual source capture condition identity');
        return row.untilType === 3 ? [row.type] : [];
      }) })) };
  validateSourceBattleHandoffState({ takeOver0055 }, catalog, roster);
  return takeOver0055;
}
export function projectSourceColosseumRecovery<T extends HandoffMember>(roster: readonly T[], party: PartyState, battleOwnedId: number, conditions: BattleConditions) {
  int32(battleOwnedId);
  const next = structuredClone([...roster]), targets: string[] = [], steps: {
    targetId: string;
    roster: T[];
  }[] = [];
  for (const cell of party.slots[party.selectedSlot]) {
    if (cell.id === null)
      continue;
    const index = next.findIndex(m => m.id === cell.id);
    if (index < 0)
      throw Error('Missing current Corps owned identity');
    const member = next[index]!;
    if (member.ownedId !== battleOwnedId)
      continue;
    if (targets.includes(member.id))
      throw Error('Repeated current Corps owned identity');
    targets.push(member.id);
    const types = conditions.referenceTypes(member.conditionIds);
    if (types.includes(601))
      throw Error('Colosseum Type601 re-add requires its independently admitted active condition lifecycle');
    const removed = removeNullCoreConditions(member, conditions);
    next[index] = removed;
    // Exactly the null-Core RemoveCondition refresh precedes HP/MP recovery.
    steps.push({ targetId: member.id, roster: structuredClone(next) });
    if (int32(removed.maxHp) < 1 || int32(removed.maxMp) < 0 || removed.hp + removed.maxHp > 0x7fffffff || removed.mp + removed.maxMp > 0x7fffffff)
      throw Error('Colosseum recovery resource overflow');
    removed.hp = removed.maxHp;
    removed.conditionIds = conditions.updateDying(removed.hp, removed.maxHp, removed.conditionIds);
    removed.conditionIds = conditions.updateDying(removed.hp, removed.maxHp, removed.conditionIds);
    removed.mp = removed.maxMp;
  }
  return { roster: next, targets, steps };
}
/** Apply only actual Battle facts to the same durable owner. A waiting cursor
* cannot replace another entry queue or appear solely because a save says so. */
export function projectSourceHandoffReturn(current: SourceBattleHandoffState | undefined, delta: SourceBattleHandoffReturn | undefined, catalog: SourceBattleHandoffCatalog, roster: readonly HandoffOwnedIdentity[]) {
  if (!delta)
    return current && structuredClone(current);
  checkpointKeys(delta, [Object.hasOwn(delta, 'takeOver0055') ? 'takeOver0055' : '', Object.hasOwn(delta, 'finalWaiting') ? 'finalWaiting' : ''].filter(Boolean).join(','));
  const next = structuredClone(current ?? {});
  if (delta.takeOver0055)
    next.takeOver0055 = structuredClone(delta.takeOver0055);
  if (delta.finalWaiting) {
    if (canonical(current?.finalWaiting ?? null) !== canonical(delta.finalWaiting.entry))
      throw Error('Stale source final waiting return');
    const entry = delta.finalWaiting.entry, remaining = delta.finalWaiting.remaining;
    if (remaining.ownedIds.length > entry.ownedIds.length || canonical(remaining.ownedIds) !== canonical(entry.ownedIds.slice(entry.ownedIds.length - remaining.ownedIds.length)))
      throw Error('Source final waiting return must consume an original prefix, never reorder or grant owners');
    next.finalWaiting = structuredClone(remaining);
  }
  validateSourceBattleHandoffState(next, catalog, roster);
  return next;
}
/** Restore has a different source order from Join: clear with null Core, add
* retained native Types, then set saved resources. The Type607 storage-only
* add is independently admitted; other field AddCondition lifecycles remain
* a precise gate even if Battle recognizes their active behavior. */
export function projectSourceRestore0055<T extends HandoffMember>(roster: readonly T[], history: SourceTakeOver0055 | undefined, catalog: SourceBattleHandoffCatalog, conditions: BattleConditions) {
  if (!history)
    throw Error('Source0055 restore requires an actual prior source capture; a legacy save or battle entry grants no history');
  validateSourceBattleHandoffState({ takeOver0055: history }, catalog, roster);
  const next = structuredClone([...roster]), targets: string[] = [];
  const steps: {
    targetId: string;
    roster: T[];
  }[] = [];
  for (const record of history.characters) {
    const index = next.findIndex(member => member.ownedId === record.ownedId);
    const member = removeNullCoreConditions(next[index]!, conditions);
    next[index] = member;
    targets.push(member.id);
    steps.push({ targetId: member.id, roster: structuredClone(next) });
    for (const type of record.conditionTypes) {
      if (type !== 607)
        throw Error('Source0055 retained Type' + type + ' requires its independently admitted field AddCondition lifecycle');
      const rows = catalog.conditions.filter(row => row.type === type);
      if (rows.length !== 1)
        throw Error('Ambiguous source0055 field condition add order');
      const id = rows[0]!.id;
      conditions.validateActive([id]);
      if (!member.conditionIds.includes(id))
        member.conditionIds.push(id);
      steps.push({ targetId: member.id, roster: structuredClone(next) });
    }
    member.hp = Math.min(record.hp, member.maxHp);
    member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
    member.mp = Math.min(record.mp, member.maxMp);
  }
  return { roster: next, targets, steps };
}
