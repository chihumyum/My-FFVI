import {conditionSpeedAbilityFixture} from './condition-speed.js';
import {compileBattleAbilityContent} from '../../src/compiler/battle-ability-content.js';
import {fixture} from './battle-content.js';

export function ordinaryConditionSource(fn:9|11|12=9,kind:'silence'|'sleep'|'confusion'='silence',type=1){
 const f=conditionSpeedAbilityFixture('slow'),row=f.tables['condition.csv']![0]!;
 const sleep={...row,id:'1907',condition_type:'7',system_type:'1',until_type:'9',until_value:'30',state_cover_unavailable:'1',mes_id_name:'SLEEP'};
 const confusion={...sleep,id:'1912',condition_type:'12',until_type:'8',until_value:'1',mes_id_name:'CONFUSION'};
 const unknown={...row,id:'1999',condition_type:'999',mes_id_name:'UNIMPLEMENTED'};
 f.tables['condition.csv']!.push(sleep,confusion,unknown);
 const conditionId=kind==='silence'?6:kind==='sleep'?1907:1912;
 Object.assign(f.ability,{id:'901',type_id:String(type),system_id:fn===9?'5':'1',ability_wait:'0',use_value:'2',accuracy_rate:'100',battle_effect_asset_id:'808'});
 Object.assign(f.group,{function1_id:'809',function1_value1:String(fn===12?699:conditionId),function1_value2:'0',function1_value3:'0'});
 f.tables['function.csv']=[{id:'809',type_id:String(fn),series_id:'0'}];
 f.tables['content_flag_group.csv']=[...(fn===9?[]:[{id:'1',group_id:'91',content_flag_id:'1'}]),{id:'2',group_id:'91',content_flag_id:'3'}];
 f.tables['condition_group.csv']=[{id:'81',group_id:'699',condition_id:'6',type_id:'-8',invocation_rate:'0'},
  {id:'82',group_id:'699',condition_id:'6',type_id:'9',invocation_rate:'1'},
  {id:'83',group_id:'699',condition_id:'1907',type_id:'0',invocation_rate:'100'},
  {id:'84',group_id:'699',condition_id:'1999',type_id:'0',invocation_rate:'100'}];
 f.tables['chanting.csv']=[{id:'802',ability_type_id:String(type),for_ai_type_id:'2'}];
 f.tables['battle_effect_asset.csv']=[{id:'808',asset_name:'synthetic-status',position_type:'5',display_type:'0',se_asset_id:'804',se_asset_id_2:'0',critical_se_asset_id:'0'},
  {id:'833',asset_name:'synthetic-haste',position_type:'5',display_type:'0',se_asset_id:'0',se_asset_id_2:'0',critical_se_asset_id:'0'},
  {id:'834',asset_name:'synthetic-slow',position_type:'5',display_type:'0',se_asset_id:'0',se_asset_id_2:'0',critical_se_asset_id:'0'}];
 f.tables['se_asset.csv']=[{id:'804',asset_name:'synthetic-status-se'}];
 f.tables['content.csv']=[{id:'401',type_id:'4',type_value:'901',mes_id_name:'STATUS',mes_id_battle:'None',mes_id_description:'None',icon_id:'0'}];
 const compileAbility=()=>compileBattleAbilityContent(f.reader(),f.tables,key=>key);
 return {...f,sleep,confusion,unknown,conditionId,compileAbility};
}
export function ordinaryConditionContent(fn:9|11|12=9,kind:'silence'|'sleep'|'confusion'='silence',type=1){
 const source=ordinaryConditionSource(fn,kind,type),c=fixture();c.conditions=source.compile().catalog;
 c.abilities[901]=source.compileAbility().abilities[901]!;c.commands[100]!.abilityIds.push(901);c.players[0]!.abilities.push(901);
 c.enemies=c.enemies.slice(0,1);c.enemies[0]!.hp=200;c.enemies[0]!.mp=20;
 c.conditionControlPolicy={kind:'web-source-control-actions-v1'};
 return {content:c,source};
}
