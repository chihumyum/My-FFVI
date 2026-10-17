import {checkpointKeys,checkpointInteger,checkpointRecord} from './checkpoint-validation.js';
import type {BattleDropGrant} from './battle-rewards.js';
import type {BattlePlayerReturn} from './battle-player-participants.js';
import {parseBattlePlayerReturn} from './battle-player-participants.js';
import type {BattleEntryInventory} from './battle-entry.js';
import type {Combatant} from './battle.js';
import type {ItemStack} from './items.js';

export const WEB_BATTLE_FORCED_SAVE='web-source-battle-forced-save-v1' as const;
export type WebBattleForcedSave={kind:typeof WEB_BATTLE_FORCED_SAVE};
export function parseWebBattleForcedSave(raw:unknown):WebBattleForcedSave{
 checkpointKeys(raw,'kind');if((raw as WebBattleForcedSave).kind!==WEB_BATTLE_FORCED_SAVE)throw new Error('Unknown Web forced-save policy');return {kind:WEB_BATTLE_FORCED_SAVE};
}
export type BattleRetainedLoot={kind:'battle-retained-loot-v1';stolen:BattleDropGrant[];drops:BattleDropGrant[]};
export function parseBattleRetainedLoot(raw:unknown):BattleRetainedLoot{
 checkpointKeys(raw,'kind,stolen,drops');const input=raw as BattleRetainedLoot;if(input.kind!=='battle-retained-loot-v1')throw new Error('Invalid retained battle loot kind');
 const grants=(rows:BattleDropGrant[])=>{
  if(!Array.isArray(rows)||Object.keys(rows).length!==rows.length)throw new Error('Invalid retained battle loot collection');
  const ids=new Set<number>();return Array.from(rows,row=>{checkpointKeys(row,'kind,id,count');checkpointInteger(row.id,1,0x7fffffff);checkpointInteger(row.count,1,0x7fffffff);
   if(!['grant-item','grant-equipment'].includes(row.kind)||ids.has(row.id))throw new Error('Invalid retained battle loot grant');ids.add(row.id);return {...row};});
 };
 return {kind:input.kind,stolen:grants(input.stolen),drops:grants(input.drops)};
}
/** A real battle-local owner. Death registrations are not grants. Only a
 * committed lottery or admitted writer may publish into these two collections. */
export class BattleRetainedLootLedger{
 #state:BattleRetainedLoot={kind:'battle-retained-loot-v1',stolen:[],drops:[]};
 snapshot():BattleRetainedLoot{return structuredClone(this.#state);}
 restore(raw:BattleRetainedLoot):void{this.#state=parseBattleRetainedLoot(raw);}
 record(kind:'stolen'|'drops',grants:readonly BattleDropGrant[]):void{
  const next=this.snapshot();for(const grant of grants){const old=next[kind].find(row=>row.id===grant.id);if(old){if(old.kind!==grant.kind)throw new Error('Conflicting retained battle loot kind');old.count+=grant.count;}else next[kind].push({...grant});}
  this.#state=parseBattleRetainedLoot(next);
 }
}
export type BattleSavedForcedReturnResult={
 kind:'battle-save-return-v1';resultType:6;policy:WebBattleForcedSave;
 participants:{ownedId:string;sourceId:number}[];
 players:Combatant[];consumedItems:ItemStack[];retainedLoot:BattleRetainedLoot;
 /** The actual frozen qualification includes every admitted owner's six slots
  * and complete stock/occupancy. It is not a second mutable equipment owner. */
 equipment:BattleEntryInventory|null;playerParticipants?:BattlePlayerReturn;
};
export function parseBattleSavedForcedReturnResult(raw:unknown):BattleSavedForcedReturnResult{
 checkpointRecord(raw);const value=raw as BattleSavedForcedReturnResult;
 checkpointKeys(value,'kind,resultType,policy,participants,players,consumedItems,retainedLoot,equipment'+(Object.hasOwn(value,'playerParticipants')?',playerParticipants':''));
 if(value.kind!=='battle-save-return-v1'||value.resultType!==6||!Array.isArray(value.players)||Object.keys(value.players).length!==value.players.length||!Array.isArray(value.consumedItems))throw new Error('Invalid saved forced-return result');
 return {...structuredClone(value),policy:parseWebBattleForcedSave(value.policy),retainedLoot:parseBattleRetainedLoot(value.retainedLoot),
  ...(Object.hasOwn(value,'playerParticipants')?{playerParticipants:parseBattlePlayerReturn(value.playerParticipants)}:{})};
}
