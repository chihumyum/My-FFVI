import { int32 } from '../core/script-integer.js';
import { parseFieldViewChangeCommand, type FieldViewChangeOp, viewDataKeys } from '../core/field-view-change.js';
function dense(raw:unknown,kind:'i'|'r'|'s'):unknown[] {
  if(!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype||raw.length!==8||Reflect.ownKeys(raw).length!==9)throw new Error('ChangeView requires complete dense eight-slot operands');
  for(let i=0;i<8;i++){const d=Object.getOwnPropertyDescriptor(raw,String(i));if(!d?.enumerable||!('value'in d))throw new Error('Invalid ChangeView operand');
    if(kind==='i')int32(d.value);else if(kind==='r'?typeof d.value!=='number'||!Number.isFinite(d.value):typeof d.value!=='string')throw new Error('Invalid ChangeView scalar');}
  return raw;
}
/** Misc/MainCore only. i1 takeoff and i2 environmental sound have no observed
 * nonzero source sites and retain their own unresolved providers. */
export function compileFieldViewChangeInstruction(raw:unknown):FieldViewChangeOp {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Expected MainCore ChangeView');
  const descriptors=Object.getOwnPropertyDescriptors(raw);
  for(const key of ['type','mnemonic','operands'])if(!descriptors[key]?.enumerable||!('value'in descriptors[key]!))throw new Error('Invalid ChangeView instruction data');
  const m=raw as Record<string,unknown>;
  if(m.type!==1||m.mnemonic!=='ChangeView')throw new Error('Expected MainCore ChangeView');
  viewDataKeys(m.operands,'iValues,rValues,sValues');const o=m.operands;
  const i=dense(o.iValues,'i') as number[],r=dense(o.rValues,'r') as number[],s=dense(o.sValues,'s') as string[];
  if(![0,1].includes(i[0]!)||i.slice(1).some(v=>v!==0)||r.slice(1).some(v=>v!==0)||s.some(v=>v!==''))throw new Error('Unsupported ChangeView selector/takeoff/audio/reserved operands');
  const rate=Math.fround(r[0]!);if(!Number.isFinite(rate))throw new Error('Unsupported ChangeView float32 rate');
  const timeScale=rate===0?1:Math.fround(1/Math.abs(rate));
  return {kind:'field-view-change',command:parseFieldViewChangeCommand({kind:'change-view',requestedViewType:i[0] as 0|1,timeScale,wait:rate>=0})};
}
