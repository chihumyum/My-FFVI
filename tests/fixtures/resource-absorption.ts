import {battleAbilityContentFixture} from './battle-ability-content.js';
import {compileBattleAbilityContent} from '../../src/compiler/battle-ability-content.js';
import {fixture} from './battle-content.js';
import {controlledRowCatalog} from './controlled-battle.js';
export function absorptionSource(resource:'hp'|'mp'='hp',calculation:'magic'|'physical'='magic'){
 const f=battleAbilityContentFixture(),type=calculation==='physical'?3:resource==='hp'?2:1,forAi=type===3?1:2;
 Object.assign(f.ability,{type_id:String(type),system_id:resource==='hp'&&calculation==='magic'?'3':'5',
  battle_effect_asset_id:'808',standard_value:'30',use_value:'2',ability_wait:'0'});
 Object.assign(f.group,{function1_id:'869',function1_value1:resource==='hp'?'1':'2',function1_value2:'0',function1_value3:'0',
  function2_id:'813',function2_value1:resource==='hp'?'1':'2',function2_value2:'100',function2_value3:String(forAi)});
 f.tables['function.csv']=[{id:'869',type_id:calculation==='magic'?'69':'77',series_id:'0'},{id:'813',type_id:'13',series_id:'0'}];
 f.tables['chanting.csv']=[{id:'802',ability_type_id:String(type),for_ai_type_id:String(forAi)}];
 f.tables['battle_effect_asset.csv']=[{id:'808',asset_name:'synthetic_absorption',position_type:'5',display_type:'0',se_asset_id:'404',se_asset_id_2:'0',critical_se_asset_id:'0'}];
 f.tables['se_asset.csv']=[{id:'404',asset_name:'synthetic_absorption_sound'}];
 return {...f,compile:()=>compileBattleAbilityContent(f.reader(),f.tables,f.resolveName)};
}
export function absorptionContent(resource:'hp'|'mp'='hp',calculation:'magic'|'physical'='magic'){
 const c=fixture();c.abilities[901]=absorptionSource(resource,calculation).compile().abilities[901]!;
 c.commands[100]!.abilityIds.push(901);c.players[0]!.abilities.push(901);c.enemies=c.enemies.slice(0,1);c.enemies[0]!.hp=200;c.enemies[0]!.mp=20;
 for(const unit of [...c.players,...c.enemies])unit.conditionTraits={kind:'source-condition-traits-v1',baseUndead:false};
 c.battleRows=controlledRowCatalog(c);
 c.playerConditionTraits=Object.fromEntries(c.players.map(unit=>[unit.sourceId,{kind:'source-condition-traits-v1',baseUndead:false}]));
 return c;
}
