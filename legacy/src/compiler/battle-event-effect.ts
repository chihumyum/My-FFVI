import type {BattleRow} from './battle.js';
import {tableInteger as int} from './table.js';
import {parseBattleEventEffectOp,type BattleEventEffectOp,type BattleEffectDefinition} from '../core/battle-event-effect.js';
export type BattleEffectReader={row(table:string,id:number|string):BattleRow};
export function compileBattleEventEffect(raw:{type:number;mnemonic:string;operands:{iValues:number[];rValues:number[];sValues:string[]}},reader?:BattleEffectReader):BattleEventEffectOp {
 const {iValues:i,rValues:r,sValues:s}=raw.operands;
 if(raw.type!==1||i.length!==8||r.length!==8||s.length!==8||r.some(v=>v!==0)||s.some(v=>v!==''))throw new Error('Unsupported battle effect encoding');
 if(raw.mnemonic==='SyncBattleEffect'){if(i.some(v=>v!==0))throw new Error('Unsupported SyncBattleEffect operands');return {kind:'sync-battle-effect'};}
 if(raw.mnemonic!=='PlayBattleEffect'||![1,2].includes(i[0]!)||i[1]!<=0||i[2]!<=0||i.slice(4).some(v=>v!==0))throw new Error('Unsupported PlayBattleEffect target/effect/reserved operands');
 if(!reader)throw new Error('Native battle effect master/resource reader is unavailable');
 const effect=reader.row('battle_effect_asset.csv',i[2]!),ids=[...new Set(['se_asset_id','se_asset_id_2','critical_se_asset_id'].map(k=>int(effect.values[k])).filter(id=>id>0))];
 const definition:BattleEffectDefinition={kind:'source-battle-effect-v1',id:i[2]!,row:{...effect.values},source:{...effect.source},sounds:ids.map(id=>{const r=reader.row('se_asset.csv',id);return {id,row:{...r.values},source:{...r.source}};})};
 return parseBattleEventEffectOp({kind:'play-battle-effect',target:{side:i[0]===1?'player':'enemy',id:i[1]},effect:definition,wait:i[3]===0});
}
