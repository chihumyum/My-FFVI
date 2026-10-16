import { checkpointKeys } from './checkpoint-validation.js';
/** Explicit Web text window arbitration, using the native acquisition/name phases.
 * Window animation/portrait/system SE are not certified by this policy. */
export const WEB_SOURCE_CHARACTER_NAMING = 'web-source-character-naming-input-v1' as const;
export type SourceCharacterNamingCommand = {kind:'source-character-naming';sourceId:number;prelude:'none'|'original-job';completion:'none'|'first-join-level'};
export type SourceCharacterNamingOp = {kind:'source-character-naming';command:SourceCharacterNamingCommand};
export type CharacterNameCatalog = {kind:'source-character-name-catalog-v1';entries:{sourceId:number;defaultName:string}[]};
export type CharacterNamingModel = {sourceId:number;ownedId:number;id:string;currentName:string;defaultName:string;wasNew:boolean};
export type CharacterNamingTransaction = {validate():void;commitWith(publish:()=>void):void};
export type CharacterNamingLease = {readonly model:CharacterNamingModel;validate():void;
 prepareName(value:string):CharacterNamingTransaction;prepareCompletion(firstJoin:boolean):CharacterNamingTransaction};
export type PreparedCharacterNaming = CharacterNamingTransaction & {readonly lease:CharacterNamingLease};
export interface FieldCharacterNamingPort {prepareOpen(command:SourceCharacterNamingCommand):PreparedCharacterNaming;}
const positive=(n:number)=>{if(!Number.isInteger(n)||n<1||n>0x7fffffff)throw Error('Invalid source character naming identity');return n;};
export function parseCharacterNamingCommand(raw:unknown):SourceCharacterNamingCommand {
 checkpointKeys(raw,'kind,sourceId,prelude,completion');const c=raw as SourceCharacterNamingCommand;
 if(c.kind!=='source-character-naming'||!['none','original-job'].includes(c.prelude)||!['none','first-join-level'].includes(c.completion)||c.prelude!=='none'&&c.completion!=='none')throw Error('Unknown source character naming phase');
 positive(c.sourceId);
 if(c.sourceId>14||c.prelude!==(c.sourceId===1?'original-job':'none')||c.completion!==(c.sourceId===12?'first-join-level':'none'))
  throw Error('Source character naming phase disagrees with native dispatch');
 return {...c};
}
export function parseCharacterNameCatalog(raw:unknown):CharacterNameCatalog {
 checkpointKeys(raw,'kind,entries');const c=raw as CharacterNameCatalog;
 if(c.kind!=='source-character-name-catalog-v1'||!Array.isArray(c.entries))throw Error('Missing source default-name catalog');
 const ids=new Set<number>();for(const r of c.entries){checkpointKeys(r,'sourceId,defaultName');positive(r.sourceId);
  if(ids.has(r.sourceId)||typeof r.defaultName!=='string'||!r.defaultName.length)throw Error('Invalid source default-name entry');ids.add(r.sourceId);}
 return structuredClone(c);
}
/** Native b167b0 iterates UTF16 chars with legacy width, not UTF8 encoding or
 * Unicode code points. Default names bypass the12-width limit at confirmation. */
export function characterNameConfirmation(value:string,defaultName:string):string {
 if(typeof value!=='string'||!value.length)throw Error('Character name must not be empty');
 if(typeof defaultName!=='string'||!defaultName.length)throw Error('Missing source default name');
 if(value===defaultName)return value;
 let width=0,result='';for(let i=0;i<value.length;i++){
  const c=value.charCodeAt(i),w=c<0x81||c===0xf8f0||c>=0xff61&&c<=0xff9f||c>=0xf8f1&&c<=0xf8f3?1:2;
  width+=w;if(width>12)break;result+=value[i];
 }return result;
}
