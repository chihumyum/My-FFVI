import {ordinaryConditionSource} from './ordinary-condition-action.js';
import {fixture} from './battle-content.js';
import {cyclingAI} from './battle-ai.js';
import type {BattleContent} from '../../src/core/battle-content.js';

/** Redistributable source-shaped rows. The function row identity deliberately
 * differs from its native function type; no original ability IDs or text. */
export function enemyMagicSource(){
 const f=ordinaryConditionSource();Object.assign(f.ability,{type_id:'13',system_id:'3',standard_value:'2',accuracy_rate:'100',
  battle_renge_id:'3',content_flag_group_id:'0',condition_group_id:'77',invalid_reflection:'1',reaction_type:'0',ability_lv:'0',use_value:'3'});
 Object.assign(f.group,{function1_id:'809',function1_value1:'1',function1_value2:'0',function1_value3:'0'});
 f.tables['function.csv']=[{id:'809',type_id:'3',series_id:'0'}];
 f.tables['condition_group.csv']=[{id:'81',group_id:'77',condition_id:'6',type_id:'0',invocation_rate:'100'}];
 f.tables['chanting.csv']=[{id:'802',ability_type_id:'13',for_ai_type_id:'2'}];
 f.tables['content_flag_group.csv']=[];
 return f;
}
export function installEnemyMagic(content:Pick<BattleContent,'conditions'|'abilities'>,source=enemyMagicSource()){
 content.abilities[901]=source.compileAbility().abilities[901]!;const conditions=source.compile().catalog;
 if(!content.conditions.rules.definitions.some(d=>d.id===6)){content.conditions.rules.definitions.push(structuredClone(conditions.rules.definitions.find(d=>d.id===6)!));content.conditions.behaviors.push(structuredClone(conditions.behaviors.find(d=>d.id===6)!));content.conditions.rules.eraseRules.push(...conditions.rules.eraseRules.filter(r=>r.groupId===1).map((r,i)=>({...r,id:9900+i})));}
 return source;
}
export function enemyMagicContent(){
 const content=fixture(),source=installEnemyMagic(content);
 content.enemies=content.enemies.slice(0,1);content.enemies[0]!.abilities=[901];content.enemies[0]!.ai=cyclingAI([901]);
 content.enemies[0]!.hp=200;content.enemies[0]!.mp=20;content.initialAtb.enemy=[100,100];
 return {source,content};
}
