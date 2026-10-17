import {canonical} from '../core/canonical.js';
import {parseBattlePartyContext,WEB_BATTLE_PARTY_CONTEXT,type BattlePartyDescriptor,type BattlePartyContext} from '../core/battle-party-context.js';
import type {SourceBattleEncounter} from './battle-encounters.js';
import type {BattleRow} from './battle.js';
import {tableInteger as int} from './table.js';
/** Preserve the original row fact independently of consumers and admission.
 * Raw descriptor values never replace the entry flags captured by Start. */
export function sourceBattlePartyDescriptor(reader:{row(table:string,id:number|string):BattleRow},encounter:SourceBattleEncounter):BattlePartyDescriptor{
 const row=reader.row('monster_party.csv',encounter.partyId),m=encounter.metadata;
 if(canonical(row.source)!==canonical(encounter.source)||int(row.values.id)!==encounter.partyId)throw new Error('Changed exact battle party descriptor source');
 return {source:structuredClone(row.source),partyId:encounter.partyId,battleFlagGroupId:m.battleFlagGroupId,backgroundId:m.backgroundId,bgmId:m.bgmId,appearanceProduction:m.appearanceProduction,notEscape:m.notEscape,getAp:m.getAp,getValue:m.getValue,scriptId:m.scriptId,patterns:[...encounter.patterns],
  flagRows:m.battleFlags.map(f=>({flagId:int(f.values.battle_flag_id),source:structuredClone(f.source)}))};
}
export function compileBattlePartyContext(reader:Parameters<typeof sourceBattlePartyDescriptor>[0]&{group(table:string,key:string,value:string|number):BattleRow[]},root:SourceBattleEncounter,children:readonly SourceBattleEncounter[]):BattlePartyContext{
 const entries:Record<string,BattlePartyDescriptor>={};
 for(const e of [root,...children]){const next=sourceBattlePartyDescriptor(reader,e);validateBattlePartyDescriptorRow(next,reader.row('monster_party.csv',e.partyId));const flags=e.metadata.battleFlagGroupId===0?[]:reader.group('battle_flag_group.csv','group_id',e.metadata.battleFlagGroupId);if(canonical(flags)!==canonical(e.metadata.battleFlags))throw new Error('Changed complete battle party descriptor flag rows');const old=entries[e.partyId];if(old&&canonical(old)!==canonical(next))throw new Error('Conflicting battle party descriptor');entries[e.partyId]=next;}
 return parseBattlePartyContext({kind:'source-battle-party-context-v1',policy:WEB_BATTLE_PARTY_CONTEXT,rootPartyId:root.partyId,entries});
}

/** Independent consumer cross-check against the complete immutable source row. */
export function validateBattlePartyDescriptorRow(descriptor:BattlePartyDescriptor|undefined,row:BattleRow):void{
 if(!descriptor||canonical(row.source)!==canonical(descriptor.source)||int(row.values.id)!==descriptor.partyId)throw new Error('Changed exact battle party descriptor row');
 const fields={battleFlagGroupId:'battle_flag_group_id',backgroundId:'battle_background_asset_id',bgmId:'battle_bgm_asset_id',appearanceProduction:'appearance_production',notEscape:'not_escape',getAp:'get_ap',getValue:'get_value',scriptId:'script_name'} as const;
 for(const [key,field]of Object.entries(fields))if(int(row.values[field])!==descriptor[key as keyof typeof fields])throw new Error('Changed battle party descriptor '+field);
 if(canonical(Array.from({length:6},(_,i)=>int(row.values['battle_pattern'+(i+1)])))!==canonical(descriptor.patterns))throw new Error('Changed exact battle party descriptor patterns');
}
