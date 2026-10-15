import { record } from './content.js';
import type { SourcePartySelectionCommand, SourcePartySelectionOp } from '../core/source-party-selection.js';
export const sourcePartySelectionSelectors = [
  'パーティ編成：１パーティ','パーティ編成：オペラ入場','パーティ編成：２パーティ',
  'パーティ編成：３パーティ','パーティ編成：ラストバトル',
] as const;
export function compileSourcePartySelectionInstruction(raw: unknown): SourcePartySelectionOp {
  const m=record(raw),o=record(m.operands);
  if(m.type!==1||m.mnemonic!=='SysCall') throw new Error('Source party selection requires MainCore SysCall');
  for(const [key,zero] of [['iValues',0],['rValues',0],['sValues','']] as const) {
    const a=o[key];
    if(!Array.isArray(a)||a.length!==8||Array.from({length:8},(_,i)=>Object.hasOwn(a,i)).some(v=>!v))
      throw new Error('Source party selection requires dense eight operands');
    for(let i=key==='sValues'?1:0;i<8;i++) if(a[i]!==zero)
      throw new Error('Unsupported source party selection reserved operand');
  }
  const selector=(o.sValues as unknown[])[0],index=sourcePartySelectionSelectors.indexOf(selector as never);
  if(index<0) throw new Error('Unknown source party selection selector');
  if(index===4) throw new Error('Source final battle ordering and downstream consumer are unresolved');
  const modes:SourcePartySelectionCommand['mode'][]=['one','opera','two','three'];
  return {kind:'source-party-selection',command:{kind:'source-party-selection',mode:modes[index]!}};
}
