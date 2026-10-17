import {record} from './content.js';
import type {MultiCorpsCommand,MultiCorpsOp} from '../core/field-multi-corps.js';
export const sourceMultiCorpsSelectors={
 'パーティ配置：ティナ防衛戦':'deploy-terra-defense',
 'パーティ配置：幻獣防衛戦':'deploy-esper-defense',
 'パーティ配置：瓦礫の塔':'deploy-tower',
 'パーティ配置：フェニックスの洞窟':'deploy-phoenix',
 '夢のダンジョン：分離':'dream-separate',
 '夢のダンジョン：１人目合流':'dream-rejoin-first',
 '夢のダンジョン：２人目合流':'dream-rejoin-second',
} as const satisfies Record<string,MultiCorpsCommand>;
export function compileMultiCorpsInstruction(raw:unknown):MultiCorpsOp {
 const value=record(raw),operands=record(value.operands),selector=Array.isArray(operands.sValues)?operands.sValues[0]:undefined;
 if(value.type!==1||value.mnemonic!=='SysCall'||typeof selector!=='string'||!Object.hasOwn(sourceMultiCorpsSelectors,selector))throw Error('Unknown source multi-Corps wrapper');
 if(Object.keys(operands).sort().join(',')!=='iValues,rValues,sValues')throw Error('Unknown source multi-Corps operand fields');
 for(const [name,empty]of [['iValues',0],['rValues',0],['sValues','']] as const){const bank=operands[name];
  if(!Array.isArray(bank)||bank.length!==8||Reflect.ownKeys(bank).length!==9)throw Error('Unknown source multi-Corps operand bank');
  for(let i=0;i<8;i++){const d=Object.getOwnPropertyDescriptor(bank,String(i));
   if(!d||!d.enumerable||!('value'in d)||d.value!==(name==='sValues'&&i===0?selector:empty))throw Error('Unknown source multi-Corps reserved operand');}
 }
 return {kind:'multi-corps',command:sourceMultiCorpsSelectors[selector as keyof typeof sourceMultiCorpsSelectors]};
}
