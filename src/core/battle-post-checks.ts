import { projectBeastField, type BattleEntryInventory, type BattleEntryCatalog } from './battle-entry.js';
import { parseBattleGauEntry, type BattleGauEntry } from './battle-gau.js';
import type { VariableRef } from './event-state.js';
import { int32 } from './script-integer.js';

/** Native constants, bound to Current's two complete source methods, closures,
 * the complete content/owned tables, and the exact metadata array payloads.
 * These are source identities, never encounter or VM-PC dispatch exceptions. */
export const CURSED_SHIELD_CONTENT_ID=213, UNCURSED_SHIELD_CONTENT_ID=214;
export const SHADOW_CHARACTER_STATUS_ID=4;
export const SHADOW_SECEDE_FLAGS=Object.freeze([
  Object.freeze({start:97,stop:108}),Object.freeze({start:123,stop:125}),Object.freeze({start:147,stop:158}),
]);
export type PostBattleSharedRead=(ref:VariableRef)=>number;
export type PostBattlePlayer={id:string;sourceId:number};
export type SourceBattleActionLogEntry={actorSide:'player'|'enemy';ownedId:string|null;commandId:number|null};

/** Pure preparation against the same borrowed equipment and shared banks as
 * battle return. A conversion must not publish its preceding counter write:
 * the existing battle transaction keeps the entire instruction atomic. */
export function planCursedShieldCheck(read:PostBattleSharedRead,players:readonly PostBattlePlayer[],
  equipment:BattleEntryInventory|undefined,catalog:BattleEntryCatalog|undefined):{counter:number|null}{
  if(read({category:'ScenarioVariable',index:2})===-1001)return {counter:null};
  if(players.length===0)return {counter:null};
  if(!equipment)throw new Error('CursedShield requires the actual borrowed player equipment');
  let counter:number|null=null;
  for(const player of players){
    const members=equipment.members.filter(member=>member.id===player.id&&member.sourceId===player.sourceId);
    if(members.length!==1||members[0]!.equipment.length!==6)throw new Error('CursedShield actual player equipment owner is missing or ambiguous');
    const slots=members[0]!.equipment;
    // The native dictionary scan breaks on its first matching slot; count once
    // per actual player, including a player whose battle HP is already zero.
    const wearsShield=slots.includes(CURSED_SHIELD_CONTENT_ID);
    // The source scans actual OwnedItem.Id before consulting a shield master.
    // Missing unused content cannot turn the proven no-shield branch into an
    // unresolved equipment conversion. A real wearer still needs its binding.
    if(wearsShield){
      if(!catalog)throw new Error('CursedShield requires exact source content 213 equipment binding');
      const rows=catalog.items.filter(row=>row.id===CURSED_SHIELD_CONTENT_ID),gear=equipment.equipmentCatalog.definitions[CURSED_SHIELD_CONTENT_ID];
      if(rows.length!==1||rows[0]!.type!==3||!gear||gear.id!==CURSED_SHIELD_CONTENT_ID||gear.kind!=='armor'||gear.empty)
        throw new Error('CursedShield requires exact source content 213 equipment binding');
    }
    if(slots.some(id=>!equipment.equipmentCatalog.definitions[id]))throw new Error('CursedShield equipped content identity is unresolved');
    if(!wearsShield)continue;
    counter=(int32(counter??read({category:'ScenarioVariable',index:9}))+1)|0;
    if(counter===256)throw new Error('CursedShield 256 conversion requires atomic owned content 214 grant, exact equipped-slot SetEquip, content 213 removal and parameter/provider refresh');
  }
  return {counter};
}

/** Branch order follows LotSecedeShadow. Unread later providers may be unknown;
 * a reached missing provider is never a fabricated empty log or false flag. */
export function planShadowSecedeLot(raw:BattleGauEntry|undefined,read:PostBattleSharedRead,
  currentCorps:()=>readonly string[],readActionLog:()=>readonly SourceBattleActionLogEntry[],
  integer:(min:number,max:number)=>number):0|1{
  if(!raw)throw new Error('Shadow lottery requires the complete source-owned roster/field entry');
  const entry=parseBattleGauEntry(raw),beast=projectBeastField({controllerPresent:entry.field.beastFieldController,
    footAttributeType:entry.field.footAttributeType,transportationId:entry.field.transportationId});
  if(beast===null)throw new Error('Shadow lottery requires the actual BeastField provider/foot/transportation predicate');
  if(beast)return 0;
  let eligible=false;
  for(const pair of SHADOW_SECEDE_FLAGS){
    const start=read({category:'ScenarioFlag1',index:pair.start}),stop=read({category:'ScenarioFlag1',index:pair.stop});
    if(start===1&&stop===0){eligible=true;break;}
  }
  if(!eligible)return 0;
  const shadow=entry.roster.find(row=>row.sourceId===SHADOW_CHARACTER_STATUS_ID);
  if(!shadow)return 0; // isAll=true includes disabled owned records.
  const corps=currentCorps();
  if(!corps.includes(shadow.id)||corps.length<=1)return 0;
  if(entry.fixedPreemptiveState===null)throw new Error('Shadow lottery requires the source fixedPreeMptiveState provider');
  if([2,4,5].includes(entry.fixedPreemptiveState))return 0;
  const log=readActionLog();
  if(!Array.isArray(log))throw new Error('Shadow lottery requires the actual BattleActLog owner');
  if(!log.some(row=>row.actorSide==='player'&&row.ownedId===shadow.id&&row.commandId===1))return 0;
  const draw=integer(0,99);int32(draw);
  if(draw<0||draw>99)throw new Error('Invalid Shadow source random draw');
  return draw<1?1:0;
}
