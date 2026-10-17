import {parseWorldAutoMoveCommand,type FieldWorldAutoMoveOp} from '../core/field-world-auto-move.js';
import { z } from 'zod';
import { int32 } from '../core/script-integer.js';
import { parseFieldWorldAutoCommand, type FieldWorldAutoOp } from '../core/field-world-auto-tasks.js';
export const worldAutoScalarMnemonics = ['AddAirShipRotateChangeTask', 'AddAirShipFlightAltitudeChangeTask', 'AddAirshipUpDownMoveTask'] as const;
export const worldAutoMnemonics = [...worldAutoScalarMnemonics, 'StartAirShipAutoManipulate'] as const;
export function compileFieldWorldAutoInstruction(raw: unknown): FieldWorldAutoOp {
  const m = z.object({ type: z.number().int(), mnemonic: z.string(), label: z.string().optional(), comment: z.string().optional(),
    operands: z.object({ iValues: z.array(z.number()).length(8), rValues: z.array(z.number().finite()).length(8), sValues: z.array(z.string()).length(8) }).strict() }).strict().parse(raw);
  const i = m.operands.iValues.map(int32), r = m.operands.rValues, s = m.operands.sValues;
  if (m.type !== 1 || !worldAutoMnemonics.includes(m.mnemonic as typeof worldAutoMnemonics[number])) throw new Error('Expected MainCore world auto-task instruction');
  if (i.slice(1).some(v => v !== 0) || s.some(v => v !== '') || r.slice(3).some(v => v !== 0)) throw new Error('Unsupported world auto-task reserved operands');
  if (m.mnemonic === 'StartAirShipAutoManipulate') {
    if (i[0] !== 0 || r.some(v => v !== 0)) throw new Error('Unsupported StartAirShipAutoManipulate operands');
    return { kind: 'field-world-auto-task', command: { kind: 'start' } };
  }
  const value = (n: number) => { const v = Math.fround(n); if (!Number.isFinite(v)) throw new Error('World auto-task operand overflows float32'); return v; };
  return { kind: 'field-world-auto-task', command: parseFieldWorldAutoCommand({ kind: 'add-scalar',
    channel: m.mnemonic === 'AddAirShipRotateChangeTask' ? 'rotation' : m.mnemonic === 'AddAirShipFlightAltitudeChangeTask' ? 'flightAltitude' : 'upDown',
    seconds: value(r[0]!), start: i[0] === 1 ? value(r[2]!) : null, value: value(r[1]!) }) };
}

export function compileFieldWorldAutoMove(raw:unknown):FieldWorldAutoMoveOp {
 const m=z.object({type:z.literal(1),mnemonic:z.literal('AddAirShipMoveTask'),label:z.string().optional(),comment:z.string().optional(),operands:z.object({iValues:z.array(z.number()).length(8),rValues:z.array(z.number().finite()).length(8),sValues:z.array(z.string()).length(8)}).strict()}).strict().parse(raw);
 const i=m.operands.iValues.map(int32),r=m.operands.rValues.map(Math.fround);
 if(i.slice(1).some(v=>v!==0)||r.slice(3).some(v=>v!==0)||m.operands.sValues.some(v=>v!==''))throw Error('Unsupported world auto-movement reserved operands');
 return {kind:'field-world-auto-move',command:parseWorldAutoMoveCommand({kind:'add-movement',seconds:r[0]!,axis:{x:r[1]!,y:r[2]!},speedId:i[0]!})};
}
