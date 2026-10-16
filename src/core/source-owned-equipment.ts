import { checkpointKeys } from './checkpoint-validation.js';
import { validatePartyState, type PartyState } from './party.js';
import type { FieldRosterPort } from './roster.js';

export type SourceEquipmentCommand = { kind: 'remove-equipment-members'; scope: 'all' | 'reserve' } |
  { kind: 'strongest-non-accessories'; sourceId: number };
export type SourceEquipmentEventOp = { kind: 'source-owned-equipment'; command: SourceEquipmentCommand };
export type SourceEquipmentTransaction = {
  readonly targets: string[];
  readonly changes: { targetId: string; slot: number; from: number; to: number }[];
  validate(): void;
  commitWith(publish: () => void): void;
};
export function validateSourceEquipmentCommand(command: SourceEquipmentCommand): void {
  if (command.kind === 'strongest-non-accessories') {
    checkpointKeys(command, 'kind,sourceId');
    if (!Number.isInteger(command.sourceId) || command.sourceId < 1 || command.sourceId > 0x7fffffff)
      throw Error('Invalid source strongest equipment status identity');
    return;
  }
  checkpointKeys(command, 'kind,scope');
  if (command.kind !== 'remove-equipment-members' || !['all', 'reserve'].includes(command.scope))
    throw Error('Unknown source owned equipment command');
}
/** Current.RemoveEquipmentFromMembers 28de80 uses GetOwnedCharactersClone(false)
 * in held order, excludes CharacterStatus14, and compares owned IDs against the
 * current Corps. Other saved Corps do not define reserve membership here. */
export function sourceEquipmentTargets<T extends { id: string; sourceId: number; ownedId: number; enabled: boolean }>(
  roster: readonly T[], party: PartyState, command: SourceEquipmentCommand,
): string[] {
  validateSourceEquipmentCommand(command);
  validatePartyState(party, roster);
  if (command.kind === 'strongest-non-accessories') {
    const target = roster.find(member => member.sourceId === command.sourceId);
    if (!target) throw Error('Missing held source strongest equipment owner');
    if (!target.enabled) throw Error('Unimplemented disabled strongest equipment ownership');
    return [target.id];
  }
  const current = new Set(party.slots[party.selectedSlot]!.flatMap(cell => cell.id === null ? [] : [cell.id]));
  return roster.filter(member => member.enabled && member.sourceId !== 14 &&
    (command.scope === 'all' || !current.has(member.id))).map(member => member.id);
}
export function executeSourceEquipmentEvent(op: SourceEquipmentEventOp, roster: FieldRosterPort | undefined): void {
  validateSourceEquipmentCommand(op.command);
  const prepare = roster?.prepareEquipment;
  if (!prepare) throw Error('Source owned equipment transaction is unavailable');
  const transaction = prepare.call(roster, structuredClone(op.command));
  transaction.validate();
  // The source requests neither ChangeAssetPartyCharacter nor AffectLeader.
  // State and per-slot resource/passive effects publish under its existing lock.
  transaction.commitWith(() => {});
}
