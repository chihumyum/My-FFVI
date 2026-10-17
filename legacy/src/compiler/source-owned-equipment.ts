import { z } from 'zod';
import { record } from './content.js';
import { int32 } from '../core/script-integer.js';
import type { SourceEquipmentEventOp } from '../core/source-owned-equipment.js';
export const sourceOwnedEquipmentSelectors = ['全員の装備を外す', '控えメンバーの装備を外す', '最強装備：ティナ', '最強装備：エドガー'] as const;
export function compileSourceOwnedEquipmentInstruction(raw: unknown): SourceEquipmentEventOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || instruction.mnemonic !== 'SysCall' || Object.keys(operands).sort().join(',') !== 'iValues,rValues,sValues')
    throw Error('Unknown source owned equipment instruction');
  const i = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const r = z.array(z.number().finite()).length(8).parse(operands.rValues), s = z.array(z.string()).length(8).parse(operands.sValues);
  if (i.some(v => v !== 0) || r.some(v => v !== 0) || s.slice(1).some(v => v !== ''))
    throw Error('Unsupported source owned equipment operand banks');
  if (s[0] === '最強装備：ティナ' || s[0] === '最強装備：エドガー')
    return { kind: 'source-owned-equipment', command: { kind: 'strongest-non-accessories', sourceId: s[0] === '最強装備：ティナ' ? 1 : 5 } };
  if (s[0] !== '全員の装備を外す' && s[0] !== '控えメンバーの装備を外す')
    throw Error('Unknown source owned equipment selector');
  return { kind: 'source-owned-equipment', command: { kind: 'remove-equipment-members', scope: s[0] === '全員の装備を外す' ? 'all' : 'reserve' } };
}
