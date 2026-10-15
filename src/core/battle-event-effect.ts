import { canonical } from './canonical.js';
import { checkpointKeys, checkpointRecord } from './checkpoint-validation.js';
export const WEB_BATTLE_EVENT_EFFECTS = 'web-source-battle-effects-pulse-v1' as const;
export const WEB_BATTLE_EFFECT_PULSE_MILLISECONDS = 300;
export type BattleEffectSource = {file:string;assetPath:string;objectId:string;serializedFile:string;rowId:string};
export type BattleEffectDefinition = {kind:'source-battle-effect-v1';id:number;row:Record<string,string>;source:BattleEffectSource;
  sounds:{id:number;row:Record<string,string>;source:BattleEffectSource}[]};
export type BattleEventEffectOp = {kind:'play-battle-effect';target:{side:'player'|'enemy';id:number};effect:BattleEffectDefinition;wait:boolean}|{kind:'sync-battle-effect'};
const int=(v:unknown,min=0)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>0x7fffffff)throw new Error('Invalid battle effect identity');return v;};
function source(raw:BattleEffectSource,table:string,id:number){checkpointKeys(raw,'file,assetPath,objectId,serializedFile,rowId');
  if([raw.file,raw.assetPath,raw.serializedFile].some(s=>typeof s!=='string'||!s)||!raw.assetPath.endsWith('/'+table)||raw.rowId!==String(id)||typeof raw.objectId!=='string'||! /^-?(?:0|[1-9]\d*)$/.test(raw.objectId)||BigInt(raw.objectId)<-(1n<<63n)||BigInt(raw.objectId)>=(1n<<63n))throw new Error('Unbound battle effect physical table row');}
function row(raw:Record<string,string>){checkpointRecord(raw);if(!Object.keys(raw).length||Object.values(raw).some(v=>typeof v!=='string'))throw new Error('Invalid battle effect source row');}
export function parseBattleEffectDefinition(raw:unknown):BattleEffectDefinition {
  checkpointKeys(raw,'kind,id,row,source,sounds');const v=raw as BattleEffectDefinition;int(v.id,1);row(v.row);source(v.source,'battle_effect_asset.csv',v.id);
  if(v.kind!=='source-battle-effect-v1'||v.row.id!==String(v.id)||!v.row.asset_name||v.row.asset_name==='None'||!Array.isArray(v.sounds))throw new Error('Missing native battle effect asset');
  for(const key of ['position_type','display_type','se_asset_id','se_asset_id_2','critical_se_asset_id'])if(! /^\d+$/.test(v.row[key]??''))throw new Error('Invalid battle effect source metadata');
  const ids=[...new Set(['se_asset_id','se_asset_id_2','critical_se_asset_id'].map(k=>Number(v.row[k])).filter(id=>id>0))];
  if(v.sounds.length!==ids.length)throw new Error('Missing battle effect sound dependency');
  for(const sound of v.sounds){checkpointKeys(sound,'id,row,source');int(sound.id,1);row(sound.row);source(sound.source,'se_asset.csv',sound.id);
    if(!ids.includes(sound.id)||v.sounds.filter(s=>s.id===sound.id).length!==1||sound.row.id!==String(sound.id)||!sound.row.asset_name||sound.row.asset_name==='None')throw new Error('Unbound battle effect sound asset');}
  return structuredClone(v);
}
export function parseBattleEventEffectOp(raw:unknown):BattleEventEffectOp {
  checkpointRecord(raw);const v=raw as BattleEventEffectOp;
  if(v.kind==='sync-battle-effect'){checkpointKeys(v,'kind');return {kind:v.kind};}
  checkpointKeys(v,'kind,target,effect,wait');if(v.kind!=='play-battle-effect')throw new Error('Invalid battle effect operation');checkpointKeys(v.target,'side,id');
  if(!['player','enemy'].includes(v.target.side)||typeof v.wait!=='boolean')throw new Error('Invalid battle effect target/wait');int(v.target.id,1);
  return {kind:v.kind,target:{...v.target},effect:parseBattleEffectDefinition(v.effect),wait:v.wait};
}
/** A resource lease carries no simulation clock, queue, target state or result.
 * prepare is side-effect free; commit starts acquisition, discard cancels it.
 * The BattleGame polls current leases inside its normal atomic frame. */
export type BattleEffectResourceLease = {status():'loading'|'ready'|'failed';validate():void;commit():void;discard():void};
export type BattleEffectPresentationRequest = {ticket:number;effect:BattleEffectDefinition;targetInstanceIds:string[]};
export type BattleEventEffectHost = {policy:typeof WEB_BATTLE_EVENT_EFFECTS;prepare(request:BattleEffectPresentationRequest):BattleEffectResourceLease};
/** The public flat Web renderer uses an explicit pulse, not a Unity prefab or
 * fabricated native completion. Native asset/audio metadata remains bound. */
export function createWebBattleEventEffectHost():BattleEventEffectHost {
 return {policy:WEB_BATTLE_EVENT_EFFECTS,prepare(request){const original=canonical(request);parseBattleEffectDefinition(request.effect);let committed=false,cancelled=false;
   const validate=()=>{if(cancelled||canonical(request)!==original)throw new Error('Stale Web battle effect resource');};
   return {validate,status(){validate();return committed?'ready':'loading';},commit(){validate();if(committed)throw new Error('Battle effect resource already committed');committed=true;},discard(){cancelled=true;}};
 }};
}
export type BattleEffectProjection = {ticket:number;pc:number;effect:BattleEffectDefinition;targetInstanceIds:string[];phase:'loading'|'playing';elapsed:number;duration:number};
