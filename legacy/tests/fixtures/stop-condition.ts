import {ordinaryConditionSource} from './ordinary-condition-action.js';
import {fixture} from './battle-content.js';
import type {AbilityDefinition} from '../../src/core/battle-content.js';
/** Synthetic metadata identities, full original-like structure. This is not
 * a source battle/ability replacement or a campaign execution claim. */
export function stopConditionSource(fn:9|11|12=9) {
 const f=ordinaryConditionSource(fn,'sleep');
 Object.assign(f.sleep,{condition_type:'17',system_type:'3',until_type:'7',until_value:'30',
  state_cover_unavailable:'1',battle_effect_asset_id:'808',battle_effect_shadow_cloning:'1',mes_id_name:'STOP'});
 if(fn===12)f.tables['condition_group.csv']!.find(row=>row.id==='84')!.condition_id='110';
 return f;
}
export function stopConditionContent(untilValue=30) {
 const source=stopConditionSource(),content=fixture();source.sleep.until_value=String(untilValue);
 content.conditions=source.compile().catalog;content.abilities[901]=source.compileAbility().abilities[901]!;
 content.conditionControlPolicy={kind:'web-source-control-actions-v1'};
 const cure=stopConditionSource(11);cure.ability.id='902';cure.tables['content.csv']![0]!.type_value='902';
 content.abilities[902]=cure.compileAbility().abilities[902]!;
 const authored=(id:number,effect:NonNullable<AbilityDefinition['plan']>['effects'][number])=>{
  const a=structuredClone(content.abilities[12]!);Object.assign(a,{id,cost:0,wait:0,power:0,name:'Authored '+id});a.program.abilityId=id;
  a.plan={effects:[effect],targeting:{relation:'either',modes:['single'],defaultMode:'single',defaultRelation:'ally',normalFormationOnly:false,life:'alive'},physical:null,magic:null};
  a.conditionRecoveryHit={kind:'source-condition-recovery-hit-v1',forAiType:2,isMagic:true};content.abilities[id]=a;
 };
 authored(903,{slot:1,kind:'add-condition',conditionId:110,fixedHit:true,accuracy:255});
 authored(904,{slot:1,kind:'recover-condition',conditionIds:[110]});
 content.conditions.rules.definitions.push({id:2907,type:7,overlapped:false,eraseGroupId:1});
 content.conditions.behaviors.push({id:2907,kind:'sleep',name:'Sleep',untilType:9,untilValue:300});
 authored(905,{slot:1,kind:'add-condition',conditionId:2907,fixedHit:true,accuracy:255});
 authored(906,{slot:1,kind:'recover-condition',conditionIds:[2907]});
 for(const id of [901,902,903,904,905,906]){
  for(const player of content.players)player.abilities.push(id);content.commands[100]!.abilityIds.push(id);
 }
 content.enemies=content.enemies.slice(0,1);content.enemies[0]!.hp=9999;content.enemies[0]!.mp=200;
 content.enemies[0]!.agility=0;content.enemies[0]!.weight=21;
 for(const player of content.players){player.hp=500;player.mp=200;player.agility=0;player.weight=21;}
 return{source,content};
}
