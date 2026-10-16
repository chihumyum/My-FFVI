import {record,hash}from'./content.js';
import {WEB_RTS_PARTY_SWITCH,validateRtsCatalog,type SourceRtsPartyCatalog,type RtsPartyOp,type RtsPartyCommand}from'../core/field-rts-party.js';
import type {BattleRow}from'./battle.js';
type SourceTableReader={row(table:string,id:string|number):BattleRow};

export const sourceRtsPartySelectors={
 'RTS：エンカウントパーティ切替':'shift-encounter',
 'RTS：エンカウント前パーティ復元':'restore-encounter',
 'RTS：他パーティと会話':'talk',
 'RTS：操作パーティ切替':'switch',
 'RTS：操作パーティ切替（後）':'switch-after-map',
 'RTS：マップスクリプト実行':'map-script',
} as const satisfies Record<string,RtsPartyCommand>;
export function compileRtsPartyInstruction(raw:unknown):RtsPartyOp {
 const v=record(raw),o=record(v.operands),selector=Array.isArray(o.sValues)?o.sValues[0]:undefined;
 if(v.type!==1||v.mnemonic!=='SysCall'||typeof selector!=='string'||!Object.hasOwn(sourceRtsPartySelectors,selector))
   throw Error('Unsupported source RTS instruction or selector');
 for(const[key,empty]of[['iValues',0],['rValues',0],['sValues','']]as const){const values=o[key];
  if(!Array.isArray(values)||values.length!==8||Object.keys(values).length!==8||Reflect.ownKeys(values).length!==9)
    throw Error('Unknown source RTS operand bank');
  for(let i=0;i<8;i++){const d=Object.getOwnPropertyDescriptor(values,String(i));
   if(!d||!d.enumerable||!('value'in d)||d.value!==(key==='sValues'&&i===0?selector:empty))
     throw Error('Unsupported source RTS reserved operand');}}
 return{kind:'rts-party',command:sourceRtsPartySelectors[selector as keyof typeof sourceRtsPartySelectors]};
}
export function compileRtsPartyCatalog(reader:SourceTableReader,tables:Record<string,Record<string,string>[]>,misc:unknown):SourceRtsPartyCatalog {
 const m=record(misc),value=Object.hasOwn(m,'rtsmode_resident_talk_script')?m.rtsmode_resident_talk_script:5003;
 if(typeof value!=='number'||!Number.isInteger(value)||value<=0||value>0x7fffffff)throw Error('Unknown source RTS talk Script identity');
 const scriptId=value,script=reader.row('script.csv',scriptId);
 const catalog:SourceRtsPartyCatalog={kind:'source-rts-party-v1',policy:WEB_RTS_PARTY_SWITCH,
  nativeSha256:'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',
  miscHash:hash(m),stayMapIndices:[11,12,13],memberLimit:4,afterScript:'sc_sht_corps_after',
  talk:{scriptId,script:script.values.script_name as string,source:script.source},
  maps:(tables['map.csv']??[]).map(row=>{const source=reader.row('map.csv',Number(row.id));return{id:Number(row.id),mapName:source.values.map_name as string,source:source.source};})};
 validateRtsCatalog(catalog);return catalog;
}
