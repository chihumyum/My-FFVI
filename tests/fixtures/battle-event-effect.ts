import {compileBattleEventEffect} from '../../src/compiler/battle-event-effect.js';
import type {BattleEventProgram} from '../../src/core/battle-event.js';
export const effectRowValues={id:'99',asset_name:'authored_effect',position_type:'0',display_type:'0',se_asset_id:'0',se_asset_id_2:'0',critical_se_asset_id:'0'};
export const effectRowSource=(table:string,id:number)=>({file:'authored-master.bundle',assetPath:'Assets/Master/'+table,objectId:'9223372036854775806',serializedFile:'authored-cab',rowId:String(id)});
export const effectReader={row(table:string,id:string|number){if(table!=='battle_effect_asset.csv'||id!==99)throw Error('Unresolved authored effect row');return {source:effectRowSource(table,99),values:{...effectRowValues}};}};
export const effectRaw=(asynchronous=0,id=1000,side=1)=>({type:1,mnemonic:'PlayBattleEffect',operands:{iValues:[side,id,99,asynchronous,0,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
export const authoredBattleEffect=(asynchronous=0,id=1000,side=1)=>compileBattleEventEffect(effectRaw(asynchronous,id,side),effectReader);
export function prefixAuthoredBattleEffect(program:BattleEventProgram,sourceId:number){
 const p=structuredClone(program);for(const i of p.instructions)if(i.op.kind==='jump'||i.op.kind==='call'||i.op.kind==='branch'||i.op.kind==='variable-branch')i.op.target+=2;
 p.instructions.unshift({mnemonic:'PlayBattleEffect',op:authoredBattleEffect(1,sourceId)},{mnemonic:'SyncBattleEffect',op:{kind:'sync-battle-effect'}});p.end+=2;return p;
}
