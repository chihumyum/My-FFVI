import { ordinaryConditionSource } from './ordinary-condition-action.js';
import { fixture } from './battle-content.js';
export function mineralizationSource(fn: 9 | 11 = 9) {
  const f = ordinaryConditionSource(fn), base = f.tables['condition.csv']![0]!;
  const stone: Record<string, string> = { ...base, id: '1911', condition_type: '11', mes_id_name: 'STONE', system_type: '1', until_type: '3',
    until_value: '0', game_over_target: '1', recovery_invalid: '1', state_cover_unavailable: '1',
    battle_effect_asset_id: '808', icon_id: '77', condition_group_id: '1300' };
  f.tables['condition.csv']!.push(stone);
  f.tables['condition_group.csv']!.push({ id: '91', group_id: '1300', condition_id: '6', type_id: '1', invocation_rate: '0' });
  f.tables['icon.csv'] = [{ id: '77', asset_name: 'synthetic-stone-icon' }];
  Object.assign(f.group, { function1_value1: '1911', function1_value2: '1' });
  if (fn === 11) f.group.function1_value2 = '0';
  f.ability.battle_renge_id = '7';
  return { ...f, stone };
}
export function mineralizationContent() {
  const source = mineralizationSource(), c = fixture();
  c.conditions = source.compile().catalog; c.abilities[901] = source.compileAbility().abilities[901]!;
  const cure = mineralizationSource(11); cure.ability.id = '902'; cure.tables['content.csv']![0]!.type_value = '902';
  c.abilities[902] = cure.compileAbility().abilities[902]!;
  for (const p of c.players) p.abilities.push(901, 902);
  c.commands[100]!.abilityIds.push(901, 902);
  c.enemies = c.enemies.slice(0, 1); c.enemies[0]!.hp = 200; c.enemies[0]!.mp = 20;
  c.battleEvents = { conditions: c.conditions.rules.definitions.map(({ id, type }) => ({ id, type,
    attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 || type === 11 ? 1 : 0 })) };
  return { content: c, source, cure };
}
