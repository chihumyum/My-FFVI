import { canonical } from './canonical.js';
import { checkpointKeys } from './checkpoint-validation.js';
import { activePartyMembers, emptyPartyState, validatePartyState, type PartyAppearanceCandidate,
  type PartyRosterEntry, type PartyState } from './party.js';

/** Explicit Web UI arbitration; this is not the original coroutine's open-time write. */
export const WEB_SOURCE_PARTY_SELECTION = 'web-source-party-selection-atomic-v1' as const;
export type WebSourcePartySelection = typeof WEB_SOURCE_PARTY_SELECTION;
export type SourcePartySelectionCommand = { kind: 'source-party-selection'; mode: 'one'|'two'|'three'|'opera' };
export type SourcePartySelectionOp = { kind: 'source-party-selection'; command: SourcePartySelectionCommand };
export type SourcePartySelectionRead = { party: PartyState; roster: PartyRosterEntry[] };
export type SourcePartySelectionModel = {
  command: SourcePartySelectionCommand; expected: SourcePartySelectionRead;
  slotCount: 1|2|3; members: PartyRosterEntry[]; forced: string[]; initial: PartyState;
};
export type SourcePartySelectionOutcome = { kind: 'cancel' }|{ kind: 'confirm'; slots: PartyState['slots'] };
export type SourcePartySelectionTransaction = {
  readonly appearance: PartyAppearanceCandidate; readonly confirmed: boolean;
  validate(): void; commitWith(publish:()=>void): void;
};
export interface FieldSourcePartySelectionPort {
  read(): SourcePartySelectionRead;
  capture(): { current: SourcePartySelectionRead; validate(): void };
  prepare(model: SourcePartySelectionModel, outcome: SourcePartySelectionOutcome): SourcePartySelectionTransaction;
}
const models = new WeakMap<object,string>();
export function parseSourcePartySelectionCommand(raw: unknown): SourcePartySelectionCommand {
  checkpointKeys(raw, 'kind,mode');
  const c = raw as SourcePartySelectionCommand;
  if(c.kind !== 'source-party-selection' || !['one','two','three','opera'].includes(c.mode))
    throw new Error('Unknown source party selection mode');
  return {kind:c.kind,mode:c.mode};
}
/** Native defaults are current source flags, never inferred from the script/map. */
export function projectSourcePartySelection(command: SourcePartySelectionCommand, current: SourcePartySelectionRead,
  readFlag: (index:number)=>number): SourcePartySelectionModel {
  command=parseSourcePartySelectionCommand(command);
  checkpointKeys(current,'party,roster'); validatePartyState(current.party,current.roster);
  const expected=structuredClone(current), members=expected.roster.filter(m=>m.enabled).sort((a,b)=>a.sourceId-b.sourceId);
  if(!members.length) throw new Error('Source party selection has no enabled owned characters');
  let forced: string[];
  if(command.mode==='opera') {
    forced=[7,2].map(sourceId=>{
      const m=members.find(m=>m.sourceId===sourceId);
      if(!m) throw new Error('Missing enabled source opera member '+sourceId);
      return m.id;
    });
  } else {
    const start=readFlag(155);
    if(start!==0&&start!==1) throw new Error('Unknown source party default start flag');
    let ids:number[]=[];
    if(start===1) {
      const end=readFlag(203);
      if(end!==0&&end!==1) throw new Error('Unknown source party default end flag');
      if(end===0) ids=[2,7];
    }
    // GetOwnedCharactersClone(false) preserves owned order for the provider defaults.
    for(const id of ids) if(!expected.roster.some(m=>m.enabled&&m.sourceId===id))
      throw new Error('Missing enabled source default member '+id);
    forced=expected.roster.filter(m=>m.enabled&&ids.includes(m.sourceId)).map(m=>m.id);
  }
  const slotCount:1|2|3=command.mode==='two'?2:command.mode==='three'?3:1;
  if(members.length<slotCount) throw new Error('Not enough enabled members for every requested party');
  const initial=emptyPartyState(); forced.forEach((id,index)=>{initial.slots[0][index]!.id=id;});
  const model={command,expected,slotCount,members:structuredClone(members),forced,initial};
  models.set(model,canonical(model));
  return model;
}
export function previewSourcePartySelection(model: SourcePartySelectionModel, current: SourcePartySelectionRead,
  outcome: SourcePartySelectionOutcome): PartyState {
  // Reconstruct all source-independent constraints; never trust a submitted UI model as authority.
  if(models.get(model)!==canonical(model)) throw new Error('Modified or untrusted source party selection model');
  validatePartyState(current.party,current.roster);
  if(canonical(current)!==canonical(model.expected)) throw new Error('Stale source party selection owned state');
  checkpointKeys(outcome,outcome?.kind==='confirm'?'kind,slots':'kind');
  if(outcome.kind==='cancel') return {...structuredClone(current.party),selectedSlot:0};
  if(outcome.kind!=='confirm') throw new Error('Unknown source party selection outcome');
  const state: PartyState={selectedSlot:0,slots:structuredClone(outcome.slots)};
  validatePartyState(state,current.roster);
  const enabled=new Set(current.roster.filter(m=>m.enabled).map(m=>m.id)), seen=new Set<string>();
  state.slots.forEach((slot,group)=>{
    if(group<model.slotCount&&!slot.some(c=>c.id!==null)) throw new Error('Each requested party needs a member');
    for(const cell of slot) {
      if(cell.row!=='front') throw new Error('Source party selection writes front rows');
      if(cell.id===null) continue;
      if(group>=model.slotCount||!enabled.has(cell.id)||seen.has(cell.id))
        throw new Error('Unavailable or repeated source party selection member');
      seen.add(cell.id);
    }
  });
  model.forced.forEach((id,index)=>{
    if(state.slots[0][index]!.id!==id) throw new Error('Source default member cannot be moved or removed');
  });
  return state;
}
export function sourcePartyLeaders(state: PartyState): [number,number,number] {
  return state.slots.map(slot=>Math.max(0,slot.findIndex(c=>c.id!==null))) as [number,number,number];
}
export { activePartyMembers };
