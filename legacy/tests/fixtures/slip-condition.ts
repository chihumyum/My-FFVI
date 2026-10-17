import { ordinaryConditionSource } from './ordinary-condition-action.js';
import { fixture } from './battle-content.js';
export function slipSource(fn: 9 | 11 = 9) {
  const f = ordinaryConditionSource(fn, 'sleep');
  Object.assign(f.sleep, { id:'1916', condition_type: '407', system_type: '3', until_type: '2', until_value: '0',
    erase_condition_group_id: '6', state_cover_unavailable: '0', mes_id_name: 'PERIODIC', mes_id_description: 'None' });
  f.group.function1_value1='1916';
  f.tables['erase_condition_group.csv']!.push({ id: '91', group_id: '6', condition_id: '0', type_id: '2', erase_condition: '0' },
    { id: '92', group_id: '3', condition_id: '5', type_id: '3', erase_condition: String(1916) });
  return {...f,conditionId:1916};
}
export function slipContent(active = true) {
  const f = slipSource(), c = fixture(); c.conditions = f.compile().catalog;
  c.abilities[901] = f.compileAbility().abilities[901]!;
  const cure = slipSource(11); cure.ability.id = '902'; cure.tables['content.csv']![0]!.type_value = '902';
  c.abilities[902] = cure.compileAbility().abilities[902]!;
  for (const p of c.players) { p.abilities.push(901,902); p.hp = 1000; p.mp = 200; p.agility = 0; p.weight = 21; }
  c.commands[100]!.abilityIds.push(901,902); c.enemies = c.enemies.slice(0,1);
  c.enemies[0]!.hp = 20000; c.enemies[0]!.agility = 0; c.enemies[0]!.weight = 21;
  c.initialAtb = { player: [100,100], enemy: [0,0] };
  if (active) c.players[0]!.conditionIds = [f.conditionId];
  c.battleEvents = { conditions: c.conditions.rules.definitions.map(({ id,type }) => ({ id,type,attackTarget:type===5?1:0,gameOverTarget:type===5?1:0 })) };
  return { content:c, source:f };
}
