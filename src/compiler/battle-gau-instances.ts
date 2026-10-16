import {canonical} from "../core/canonical.js";
import {parseBattleGauInstanceContent,gauSourceParties,gauJoinedCharacterSource,type BattleGauInstanceContent} from '../core/battle-gau-instances.js';
import type {BattleAppearanceActor} from '../core/battle-appearance.js';
import type {BattleRow} from './battle.js';
import {checkpointKeys} from '../core/checkpoint-validation.js';
import {tableInteger as int} from './table.js';
/** All five animation_enemy_params rows bind independently of ownership. The
 * original physical misc object is already matched to the pinned corpus by
 * compileSharedBattleSource. No factory row grants runtime permission. */
export function compileBattleGauInstances(reader:{row(table:string,id:string|number):BattleRow},input:{misc:{source:unknown;data:unknown};actors:Record<string,BattleAppearanceActor>;blockers?:{sourceId:number;reasons:string[]}[]}){
  const raw=(input.misc.data as {animation_enemy_params?:unknown}).animation_enemy_params;
  if(!Array.isArray(raw)||!raw.length)throw new Error('Missing complete source animation_enemy_params');
  const rows:BattleRow[]=[];
  const playerPrefabs=raw.map(value=>{checkpointKeys(value,'monster_id,character_status_id,character_status_job_id,weapon_id');
    const v=value as {monster_id:number;character_status_id:number;character_status_job_id:number;weapon_id:number};
    for(const[table,id]of [['monster.csv',v.monster_id],['character_status.csv',v.character_status_id],['job.csv',v.character_status_job_id]] as const){
      const row=reader.row(table,id);if(int(row.values.id)!==id||row.source.rowId!==String(id))throw new Error('Changed source enemy player factory row');rows.push(structuredClone(row));}
    const character=reader.row('character_status.csv',v.character_status_id);
    if(int(character.values.job_id)!==v.character_status_job_id)throw new Error('Alternate source enemy player job needs its own appearance provider');
    const actor=input.actors[String(v.character_status_id)]??null;
    if(actor&&actor.characterAssetId!==int(character.values.character_asset_id))throw new Error('Source enemy player character asset changed');const gate=actor?null:input.blockers?.find(row=>row.sourceId===v.character_status_id)?.reasons.join('; ');
    if(!actor&&!gate)throw new Error('Missing explicit source enemy player prefab media dependency '+v.character_status_id);
    return {kind:'source-enemy-player-appearance-v1' as const,monsterId:v.monster_id,characterStatusId:v.character_status_id,
      jobId:v.character_status_job_id,weaponId:v.weapon_id,actor:structuredClone(actor),gate:gate??null};});
  const catalog:BattleGauInstanceContent=parseBattleGauInstanceContent({kind:'source-battle-gau-instances-v1',firstPartyId:gauSourceParties[0],
    returnPartyId:gauSourceParties[1],joinedSourceId:gauJoinedCharacterSource,playerPrefabs});
  return {catalog,source:structuredClone(input.misc.source),raw:structuredClone(raw),rows};
}

/** Reconstruct factory facts from the complete source rows in the producer's
 * proof, then compare every published encounter binding. This is independent
 * of the directory declaration and never grants a held owner or media host. */
export function validateSourceBattleGauFactoryProof(raw:unknown,input:{appearance:unknown;sprites:Record<string,{width:number;height:number;file:string}>;encounters:Record<string,import('../core/battle-content.js').BattleEncounter>}){
  checkpointKeys(raw,'catalog,source,raw,rows,appearance');
  const p=raw as ReturnType<typeof compileBattleGauInstances>&{appearance:import('./battle-appearance.js').BattleAppearanceInput&{catalog:unknown;actors:Record<string,BattleAppearanceActor>;blockers:{sourceId:number;reasons:string[]}[]}};
  const origin=p.source as {file:string;assetPath:string;objectId:string;serializedFile:string;sha256:string};
  if(!origin||typeof origin.file!=='string'||!origin.file||!origin.assetPath?.endsWith('/serial_misc_assets.json')||!/^[-]?\d+$/.test(origin.objectId??'')||BigInt(origin.objectId)<-(1n<<63n)||BigInt(origin.objectId)>=(1n<<63n)||!origin.serializedFile||!/^[a-f0-9]{64}$/.test(origin.sha256??''))throw new Error('Unbound source Gau factory physical object');
  if(!Array.isArray(p.raw)||!Array.isArray(p.rows)||p.rows.length!==p.raw.length*3||!p.appearance||!Array.isArray(p.appearance.blockers))throw new Error('Incomplete source Gau factory proof');
  if(canonical(p.appearance.catalog)!==canonical(input.appearance))throw new Error('Source Gau factory uses another appearance owner');
  const reader={row(table:string,id:string|number){const matches=p.rows.filter(row=>row.source.assetPath.endsWith('/'+table)&&row.source.rowId===String(id)&&row.values.id===String(id));
    if(!matches.length||matches.some(row=>canonical(row)!==canonical(matches[0])))throw new Error('Incomplete/conflicting source Gau factory row');return matches[0]!;}};
  const reconstructed=compileBattleGauInstances(reader,{misc:{source:p.source,data:{animation_enemy_params:p.raw}},actors:p.appearance.actors,blockers:p.appearance.blockers});
  if(canonical(reconstructed)!==canonical({catalog:p.catalog,source:p.source,raw:p.raw,rows:p.rows}))throw new Error('Changed source Gau factory mapping proof');
  for(const factory of reconstructed.catalog.playerPrefabs)if(factory.actor)for(const[name,key]of Object.entries(factory.actor.bodySprites)){
    const sprite=input.sprites[key],geometry=factory.actor.bodyGeometry[name];
    if(!sprite||!geometry||sprite.width!==geometry.width||sprite.height!==geometry.height)throw new Error('Source Gau factory has unbound sprite geometry');}
  for(const encounter of Object.values(input.encounters))if(encounter.gauInstances!==undefined&&canonical(encounter.gauInstances)!==canonical(reconstructed.catalog))throw new Error('Encounter Gau factory differs from the complete source proof');
}
