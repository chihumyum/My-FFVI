import { record } from './content.js';
import type { BattleRow } from './battle.js';
import { parseCharacterNameCatalog,type SourceCharacterNamingCommand,type SourceCharacterNamingOp } from '../core/source-character-naming.js';
/** Exact Current.cctor literals and complete forwarding PE; these are dispatch
 * facts for this native build, not a map/PC/name-prefix inference. */
export const sourceCharacterNamingSelectors = {
 '名前入力：ティナ':{sourceId:1,prelude:'original-job',completion:'none'},
 '名前入力：ロック':{sourceId:2,prelude:'none',completion:'none'},
 '名前入力：カイエン':{sourceId:3,prelude:'none',completion:'none'},
 '名前入力：シャドウ':{sourceId:4,prelude:'none',completion:'none'},
 '名前入力：エドガー':{sourceId:5,prelude:'none',completion:'none'},
 '名前入力：マッシュ':{sourceId:6,prelude:'none',completion:'none'},
 '名前入力：セリス':{sourceId:7,prelude:'none',completion:'none'},
 '名前入力：ストラゴス':{sourceId:8,prelude:'none',completion:'none'},
 '名前入力：リルム':{sourceId:9,prelude:'none',completion:'none'},
 '名前入力：セッツァー':{sourceId:10,prelude:'none',completion:'none'},
 '名前入力：モグ':{sourceId:11,prelude:'none',completion:'none'},
 '名前入力：ガウ':{sourceId:12,prelude:'none',completion:'first-join-level'},
 '名前入力：ゴゴ':{sourceId:13,prelude:'none',completion:'none'},
 '名前入力：ウーマロ':{sourceId:14,prelude:'none',completion:'none'},
} as const;
export function compileSourceCharacterNamingInstruction(raw:unknown):SourceCharacterNamingOp {
 const m=record(raw),o=record(m.operands);
 if(m.type!==1||m.mnemonic!=='SysCall')throw Error('Source character naming requires MainCore SysCall');
 for(const [key,zero]of [['iValues',0],['rValues',0],['sValues','']]as const){const a=o[key];
  if(!Array.isArray(a)||a.length!==8||Array.from({length:8},(_,i)=>Object.hasOwn(a,i)).some(v=>!v))throw Error('Source character naming requires dense eight operands');
  for(let i=key==='sValues'?1:0;i<8;i++)if(a[i]!==zero)throw Error('Unsupported source character naming reserved operand');
 }
 const selector=(o.sValues as unknown[])[0];if(typeof selector!=='string'||!Object.hasOwn(sourceCharacterNamingSelectors,selector))throw Error('Unknown source character naming selector');
 const phases=sourceCharacterNamingSelectors[selector as keyof typeof sourceCharacterNamingSelectors];
 return {kind:'source-character-naming',command:{kind:'source-character-naming',...phases} satisfies SourceCharacterNamingCommand};
}
export function compileSourceCharacterNameCatalog(reader:{row(table:string,id:string|number):BattleRow},rows:readonly Record<string,string>[],name:(key:string)=>string){
 const sources:BattleRow[]=[];
 // FF6 data ctor74f670 sets ThinaId1. GetDefaultName74f310 exact metadata
 // binds CharacterStatus and MesIdName; the special message literal is explicit.
 const entries=rows.map(raw=>{const id=Number(raw.id),row=reader.row('character_status.csv',id);
  if(row.source.rowId!==String(id)||row.values.id!==raw.id||!row.source.assetPath.endsWith('/character_status.csv'))throw Error('Changed naming CharacterStatus source');
  sources.push(row);return{sourceId:id,defaultName:name(id===1?'MSG_CHAR_NAME_01':row.values.mes_id_name!)};});
 return {catalog:parseCharacterNameCatalog({kind:'source-character-name-catalog-v1',entries}),sources};
}
