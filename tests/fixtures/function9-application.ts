import {ordinaryConditionSource} from './ordinary-condition-action.js';
/** Invented source rows; condition and function row identities differ from
 * native types so the mechanism cannot pass through an ability ID branch. */
export function deathSource(type=2,id=1505){
  const f=ordinaryConditionSource();const row={...f.tables['condition.csv']!.find(r=>r.id==='5')!,id:String(id),mes_id_name:'DEATH_STATE'};
  if(id!==5)f.tables['condition.csv']!.push(row);
  Object.assign(f.ability,{type_id:String(type),system_id:'5',condition_group_id:'0',battle_renge_id:'3',accuracy_rate:'95'});
  f.tables['chanting.csv']![0]!.ability_type_id=String(type);f.group.function1_value1=String(id);
  return {...f,deathId:id};
}
