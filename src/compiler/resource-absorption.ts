import type {AbilityEffect,AbilityProgram} from '../core/ability.js';
import {WEB_RESOURCE_ABSORPTION,resourceAbsorptionEffect,type ResourceAbsorptionEffect} from '../core/resource-absorption.js';
import type {ConditionReader} from './conditions.js';
import {tableInteger as int} from './table.js';
/** All source slots and the separate native ForAiType selector are required.
 * No ability-ID lookup, ownership grant or source-body rewrite is involved. */
export function compileResourceAbsorption(reader:ConditionReader,program:AbilityProgram){
 const [primary,returned]=program.functions;
 if(program.functions.length!==2||primary?.slot!==1||returned?.slot!==2||![69,77].includes(primary.type)||returned.type!==13||
    primary.series!==0||returned.series!==0||![1,2].includes(primary.values[0])||primary.values.slice(1).some(Boolean)||
    returned.values[0]!==primary.values[0]||returned.values[1]!==100||![1,2].includes(returned.values[2])||
    program.process.key!=='None'||program.process.values.some(Boolean)||![3,7].includes(program.range)||
    ![1,2,3,13].includes(program.rules.type_id!)||![3,5].includes(program.rules.system_id!))
  throw Error('Unresolved whole source resource absorption composition');
 const ability=reader.row('ability.csv',program.abilityId),group=reader.row('function_group.csv',program.groupId),sources=[ability,group];
 if(int(ability.values.id)!==program.abilityId||int(ability.values.battle_function_group_id)!==program.groupId||int(group.values.id)!==program.groupId)
  throw Error('Resource absorption program differs from its source');
 for(const fn of program.functions){const row=reader.row('function.csv',fn.functionId);sources.push(row);
  if(int(group.values[`function${fn.slot}_id`])!==fn.functionId||fn.values.some((v,n)=>int(group.values[`function${fn.slot}_value${n+1}`])!==v)||
     int(row.values.type_id)!==fn.type||int(row.values.series_id)!==0)throw Error('Changed source absorption function binding');}
 const chanting=reader.group('chanting.csv','ability_type_id',program.rules.type_id!);
 if(chanting.length!==1||int(chanting[0]!.values.for_ai_type_id)!==returned.values[2])throw Error('Unresolved absorption Chanting.ForAiType phase selector');
 sources.push(chanting[0]!);
 const effectAssetId=int(ability.values.battle_effect_asset_id);if(effectAssetId<0)throw Error('Invalid source absorption effect identity');
 let sourceEffect:ResourceAbsorptionEffect['presentation']['sourceEffect']=null;
 if(effectAssetId){const row=reader.row('battle_effect_asset.csv',effectAssetId);sources.push(row);const v=row.values,
  soundAssetIds:[number,number,number]=[int(v.se_asset_id),int(v.se_asset_id_2),int(v.critical_se_asset_id)];
  for(const id of soundAssetIds)if(id>0)sources.push(reader.row('se_asset.csv',id));
  sourceEffect={assetName:v.asset_name!,positionType:int(v.position_type),displayType:int(v.display_type),soundAssetIds};}
 const calculation=primary.type===69?'magic':'physical',effect:ResourceAbsorptionEffect={kind:'absorb-resource',slot:2,
  calculation,resource:primary.values[0]===1?'hp':'mp',percent:100,forAiType:returned.values[2] as 1|2,recipient:'single-caster',overflow:'normal',
  presentation:{kind:WEB_RESOURCE_ABSORPTION,effectAssetId,sourceEffect,originalEffect:'deferred',actionClock:'existing-web-action-stages'}},
  effects:AbilityEffect[]=[{kind:calculation,slot:1},effect];
 resourceAbsorptionEffect({effects,targeting:{life:'alive',relation:'enemy',modes:['single'],defaultMode:'single',defaultRelation:'enemy',normalFormationOnly:false},physical:null,magic:null});
 return {effects,sources};
}
