import { z } from 'zod';
import { record } from './content.js';
import { int32 } from '../core/script-integer.js';
import type { FieldMobControlOp } from '../core/field-mob-controls.js';
export function compileFieldMobControl(raw: unknown): FieldMobControlOp {
 const m=record(raw),o=record(m.operands),i=z.array(z.unknown()).length(8).parse(o.iValues).map(int32),r=z.array(z.number().finite()).length(8).parse(o.rValues),s=z.array(z.string()).length(8).parse(o.sValues);
 if(m.type!==1||!['HideMob','RestoreMob'].includes(m.mnemonic as string)||i.slice(m.mnemonic==='HideMob'?5:0).some(v=>v!==0)||r.slice(1).some(v=>v!==0)||s.some(v=>v!==''))throw new Error('Unsupported Mob control operands');
 const durationSeconds=Math.fround(r[0]!);if(!Number.isFinite(durationSeconds)||durationSeconds<0)throw new Error('Unsupported Mob filter duration');
 return {kind:'field-mob-control',command:m.mnemonic==='HideMob'?{kind:'hide',exemptions:i.slice(0,5).filter(v=>v!==0),durationSeconds}:{kind:'restore',durationSeconds}};
}
