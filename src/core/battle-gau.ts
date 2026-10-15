import { checkpointKeys, checkpointInteger } from './checkpoint-validation.js';
import { validatePartyState, type PartyState } from './party.js';
import { projectBeastField } from './battle-entry.js';
import type { BattleFieldState } from './field-battle-entry.js';
import { int32 } from './script-integer.js';

/** Native CharacterStatusId.Gau, independent of held record and battle IDs. */
export const GAU_CHARACTER_STATUS_ID=12;
export type BattleGauEntry={
  kind:'source-battle-gau-entry-v1';catalogHash:string;
  /** GetOwnedCharactersClone(true) includes disabled owners. */
  roster:{id:string;sourceId:number;ownedId:number;enabled:boolean}[];
  party:PartyState;field:BattleFieldState;
  /** Separate native fixedPreeMptiveState, never inferred from a Web formation. */
  fixedPreemptiveState:-1|0|1|2|3|4|5|null;
};
export type BattleGauModePlan={
  /** A branch that makes no write preserves the current VM cell, even nonzero. */
  modeWrite:1|2|null;
  encounteredEnemyIds:number[]|null;
  endEnabled:false|null;
};
export function parseBattleGauEntry(raw:BattleGauEntry):BattleGauEntry{
  checkpointKeys(raw,'kind,catalogHash,roster,party,field,fixedPreemptiveState');
  if(raw.kind!=='source-battle-gau-entry-v1'||! /^[a-f0-9]{64}$/.test(raw.catalogHash)||!Array.isArray(raw.roster)||
    Object.keys(raw.roster).length!==raw.roster.length||raw.fixedPreemptiveState!==null&&
    ![-1,0,1,2,3,4,5].includes(raw.fixedPreemptiveState))throw new Error('Invalid source Gau battle entry');
  const roster=Array.from(raw.roster,row=>{
    checkpointKeys(row,'id,sourceId,ownedId,enabled');checkpointInteger(row.sourceId,1,0x7fffffff);checkpointInteger(row.ownedId,1,0x7fffffff);
    if(typeof row.id!=='string'||!row.id||row.id.trim()!==row.id||typeof row.enabled!=='boolean')throw new Error('Invalid Gau owned identity');
    return {...row};
  });
  for(const key of ['id','sourceId','ownedId'] as const)if(new Set(roster.map(row=>row[key])).size!==roster.length)throw new Error('Ambiguous Gau owned source identity');
  validatePartyState(raw.party,roster);
  checkpointKeys(raw.field,'mapId,transportationId,isSavePoint,beastFieldController,footAttributeType');
  for(const key of ['mapId','transportationId'] as const)if(raw.field[key]!==null)checkpointInteger(raw.field[key],1,0x7fffffff);
  if(raw.field.footAttributeType!==null)checkpointInteger(raw.field.footAttributeType,0,0x7fffffff);
  for(const key of ['isSavePoint','beastFieldController'] as const)if(raw.field[key]!==null&&typeof raw.field[key]!=='boolean')throw new Error('Unknown Gau field provider');
  return structuredClone({...raw,roster});
}

/** Pure dispatch. Randomness is drawn only through the caller's existing
 * BattleGame stream after every preceding native guard. No owned writes. */
export function planBattleGauMode(raw:BattleGauEntry|undefined,enemyIds:readonly number[],integer:(min:number,max:number)=>number):BattleGauModePlan{
  if(!raw)throw new Error('Gau mode requires the complete source-owned roster/Corps and current field entry');
  const entry=parseBattleGauEntry(raw),none:BattleGauModePlan={modeWrite:null,encounteredEnemyIds:null,endEnabled:null};
  const gau=entry.roster.find(row=>row.sourceId===GAU_CHARACTER_STATUS_ID);
  if(!gau)return none;
  const beast=projectBeastField({controllerPresent:entry.field.beastFieldController,footAttributeType:entry.field.footAttributeType,transportationId:entry.field.transportationId});
  if(beast===null)throw new Error('Gau mode requires the actual BeastField provider/foot/transportation predicate');
  if(!beast)return none;
  const corps=entry.party.slots[entry.party.selectedSlot];
  if(corps.some(cell=>cell.id===gau.id))return {...none,modeWrite:1};
  // IsEnableCorps is not membership. A known enabled reserve makes the
  // complete disjunction true without interpreting an unknown fixed state.
  if(gau.enabled||entry.fixedPreemptiveState!==null&&[2,4,5].includes(entry.fixedPreemptiveState))return none;
  if(entry.fixedPreemptiveState===null)throw new Error('Gau return requires the source fixedPreeMptiveState provider');
  if(corps.every(cell=>cell.id!==null))return none;
  // Native Range(0,100) has an exclusive upper bound; BattleGame integer uses
  // inclusive bounds. Retain duplicate enemy master IDs and current order.
  const draw=integer(0,99);checkpointInteger(draw,0,99);
  if(draw>69)return none;
  const captured=Array.from(enemyIds,id=>{checkpointInteger(id,1,0x7fffffff);return id;});
  return {modeWrite:2,encounteredEnemyIds:captured,endEnabled:false};
}

/** GetEnemyMode first obtains an actual parameter, then conditionally writes
 * ScriptLocal[1]. A missing slot is an error even when the guard differs. */
export function readBattleEnemyMode(uniqueId:number,expected:number,local:number,
  rows:readonly {uniqueId:number;mode:number}[]|undefined):number{
  checkpointInteger(uniqueId,1,9);int32(expected);int32(local);
  if(!rows)throw new Error('GetEnemyMode requires current battle enemy parameters');
  const matches=rows.filter(row=>row.uniqueId===uniqueId);
  if(matches.length!==1)throw new Error('GetEnemyMode actual unique-slot parameter is missing or ambiguous');
  const mode=int32(matches[0]!.mode);
  return local===expected?mode:local;
}
