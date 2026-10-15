import {record}from'./content.js';import type{FieldPuppetReplacementCommand,FieldPuppetReplacementOp}from'../core/field-puppet-replacement.js';
const prefix='パペット入れ替え：';
const commands:Record<string,FieldPuppetReplacementCommand>={
 '解除':{kind:'reset'},'スロット２':{kind:'slot',slot:1,selection:'all'},'スロット３':{kind:'slot',slot:2,selection:'all'},
 'スロット２先頭':{kind:'slot',slot:1,selection:'leader'},'スロット３先頭':{kind:'slot',slot:2,selection:'leader'},
 'スロット２先頭以外':{kind:'slot',slot:1,selection:'except-leader'},'スロット３先頭以外':{kind:'slot',slot:2,selection:'except-leader'},
 'スロット２・３先頭':{kind:'leaders'},'バトルパーティ':{kind:'battle-party'},
};
export const sourcePuppetReplacementSelectors=[...Object.keys(commands).map(k=>prefix+k),prefix+'瓦礫の塔スロット２先頭NPC',prefix+'瓦礫の塔スロット３先頭NPC',prefix+'オペラNPC'];
export function compileFieldPuppetReplacementInstruction(raw:unknown):FieldPuppetReplacementOp{
 const value=record(raw),operands=record(value.operands);if(value.type!==1||value.mnemonic!=='SysCall')throw Error('Unsupported Puppet replacement instruction domain');
 const selector=Array.isArray(operands.sValues)?operands.sValues[0]:undefined;if(typeof selector!=='string'||!sourcePuppetReplacementSelectors.includes(selector))throw Error('Unknown Puppet replacement selector');
 for(const[key,empty]of[['iValues',0],['rValues',0],['sValues','']]as const){const values=operands[key];if(!Array.isArray(values)||values.length!==8||Reflect.ownKeys(values).length!==9||Object.keys(values).length!==8)throw Error('Unknown Puppet replacement reserved operands');
  for(let i=0;i<8;i++){const d=Object.getOwnPropertyDescriptor(values,String(i));if(!d||!d.enumerable||!('value'in d)||d.value!==(key==='sValues'&&i===0?selector:empty))throw Error('Unsupported Puppet replacement reserved operand');}}
 const command=commands[selector.slice(prefix.length)];if(!command)throw Error('Source Puppet NPC replacement dictionary/placement phase is unavailable');
 return{kind:'field-puppet-replacement',command:structuredClone(command)};
}
