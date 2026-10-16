import { canonical } from './canonical.js';
import { checkpointKeys } from './checkpoint-validation.js';
import type { RosterNativeStep } from './roster.js';
import type { PartyAppearanceCandidate, PartyPosition, PartySlotIndex } from './party.js';

/** Recovered data for this build. This is not owned state or a saved grant. */
export type SourceRosterGroupCatalog = {
  kind: 'source-roster-groups-v1';
  nativeSha256: string;
  memberLimit: 4;
  group: { id: 'moogles'; sourceIds: number[]; firstSlot: 0; firstIndex: 1;
    lastSlot: 2; joinSkipSourceId: number; tailSourceId: number; tailSlot: 1; tailIndex: 0 };
};
export function sourceRosterGroupCatalog(): SourceRosterGroupCatalog {
  // Current.cctor typed List<int>.Add sequence 2a2167..2a228a, not source
  // Organize arguments. FF6 concrete virtual slot6: complete40a000..40a010.
  return { kind: 'source-roster-groups-v1',
    nativeSha256: '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',
    memberLimit: 4, group: { id: 'moogles', sourceIds: [19,20,21,11,22,23,24,25,26,27,28],
      firstSlot: 0, firstIndex: 1, lastSlot: 2, joinSkipSourceId: 11,
      tailSourceId: 11, tailSlot: 1, tailIndex: 0 } };
}
export function validateSourceRosterGroupCatalog(value: SourceRosterGroupCatalog): void {
  if (canonical(value) !== canonical(sourceRosterGroupCatalog()))
    throw new Error('Missing or unsupported source roster group definition/provider');
}
export type RosterGroupCommand = { kind: 'join' | 'secede'; group: 'moogles' };
export type RosterGroupEventOp = { kind: 'roster-group'; command: RosterGroupCommand;
  dependencies: { table: string; id: number }[] };
export type RosterGroupAppearanceStep = { appearance: PartyAppearanceCandidate;
  setDummy: boolean; sourceId: number | null };
export type RosterGroupTransaction = {
  readonly steps: readonly RosterGroupAppearanceStep[];
  validate(): void;
  commitWith(publish: (validateOwned: () => void) => void): void;
};
export function validateRosterGroupCommand(value: RosterGroupCommand): void {
  checkpointKeys(value, 'kind,group');
  if (!['join','secede'].includes(value.kind) || value.group !== 'moogles')
    throw new Error('Unknown source roster group command');
}
export type RosterGroupStep =
  | { kind: 'owned'; command: RosterNativeStep }
  | { kind: 'set-slot'; slot: PartySlotIndex; index: PartyPosition; sourceId: number }
  | { kind: 'remove-slot'; slot: PartySlotIndex; index: PartyPosition }
  | { kind: 'select-slot'; slot: PartySlotIndex }
  | { kind: 'refresh'; setDummy: boolean; sourceId: number | null };
/** Pure native call plan. Actual identities, resources and all projections are
 * resolved by the same existing GameState draft, never by another roster. */
export function rosterGroupSteps(catalog: SourceRosterGroupCatalog, command: RosterGroupCommand): RosterGroupStep[] {
  validateSourceRosterGroupCatalog(catalog); validateRosterGroupCommand(command);
  const group = catalog.group, result: RosterGroupStep[] = [];
  const join = (sourceId: number, slot: PartySlotIndex, index: PartyPosition) => {
    result.push({kind:'owned',command:{kind:'unlock',sourceId,refreshActors:false}},
      {kind:'owned',command:{kind:'enable-release',sourceId}},
      {kind:'set-slot',sourceId,slot,index},
      {kind:'owned',command:{kind:'correct-level',sourceId,firstJoin:true}},
      {kind:'owned',command:{kind:'recover',sourceId}},
      {kind:'refresh',setDummy:false,sourceId});
  };
  let slot: PartySlotIndex = group.firstSlot, index: number = group.firstIndex;
  for (const sourceId of group.sourceIds) {
    if (index < 0 || index >= catalog.memberLimit)
      throw new Error('Source roster group position exceeds the actual provider');
    if (command.kind === 'join') {
      if (sourceId !== group.joinSkipSourceId) join(sourceId,slot,index as PartyPosition);
    } else result.push({kind:'remove-slot',slot,index:index as PartyPosition},
      {kind:'owned',command:{kind:'secede',sourceId,removeEquipment:true,refreshActors:true}},
      {kind:'refresh',setDummy:true,sourceId});
    index++;
    if (index === catalog.memberLimit && slot !== group.lastSlot) { index=0; slot=(slot+1) as PartySlotIndex; }
  }
  if (command.kind === 'join') join(group.tailSourceId,group.tailSlot,group.tailIndex);
  else result.push({kind:'select-slot',slot:0},{kind:'refresh',setDummy:true,sourceId:null});
  return result;
}
