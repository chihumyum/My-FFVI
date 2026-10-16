import { battleAbilityContentFixture } from './battle-ability-content.js';
import { compileBattleAbilityContent } from '../../src/compiler/battle-ability-content.js';
import { fixture } from './battle-content.js';
import { compileScriptedBattleAction } from '../../src/compiler/battle-scripted-action.js';
import type { BattleEventOp } from '../../src/core/battle-event.js';
import { syntheticAI } from './battle-ai.js';
import { enemyMagicSource } from './enemy-magic-carrier.js';
export function variableSource(key = 'ADD_VARIABLE_CALC', a = 999, b = 0, value = 3, fn = 19) {
  const f = battleAbilityContentFixture();
  Object.assign(f.ability, { type_id: '35', system_id: '2', battle_renge_id: '5', standard_value: '0',
    use_value: '0', ability_wait: '0', battle_effect_asset_id: '0', process_prog: key,
    data_a: String(a), data_b: String(b), data_c: String(value) });
  Object.assign(f.group, { function1_value1: '0', function1_value2: '0', function2_id: '823' });
  f.tables['function.csv'] = [{ id: '801', type_id: String(fn), series_id: '0' }, { id: '823', type_id: '23', series_id: '0' }];
  f.tables['content.csv'] = [];
  return { ...f, compile: () => compileBattleAbilityContent(f.reader(), f.tables, f.resolveName) };
}
export const variableAction = (id = 901, targetSide = 2, target = 1, actor = 1) => compileScriptedBattleAction({ type: 1, mnemonic: 'BattleAction',
  operands: { iValues: [2, actor, id, targetSide, target, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill('') } });
export function variableContent(held = false) {
  const f = variableSource(), c = fixture(); c.abilities[901] = f.compile().abilities[901]!;
  c.enemies = c.enemies.slice(0, 1); c.enemies[0]!.hp = 5000; c.enemies[0]!.mp = 20;
  if (held) {
    const magic = variableMagicSource(); c.abilities[901] = magic.compileAbility().abilities[901]!;
    c.enemies.push({ ...structuredClone(c.enemies[0]!), id: 'e2', ai: syntheticAI([['Nop'], ['SyncAI'], ['StartTable', [0]], ['Act', [13]], ['EndTable'],
      ['Blank'], ['Blank'], ['ValueCalc', [0, 1], [], ['＋']], ['JumpBattleAI', [0]]]) });
  }
  const ops: BattleEventOp[] = [{ kind: 'end-enabled', enabled: false }, ...(held ? [{ kind: 'exec-ai' } as const] : []),
    { kind: 'pause', enabled: true }, variableAction(901, 2, held ? 2 : 1), { kind: 'calc', index: 0, operator: '＋', right: { kind: 'immediate', value: 1 } },
    { kind: 'nop' }, { kind: 'blank' }, { kind: 'jump', target: held ? 5 : 4 }];
  c.battleEvents = { conditions: c.conditions.rules.definitions.map(({ id, type }) => ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  c.lifecycle = { kind: 'battle-lifecycle-v1', mode: 'script', scriptId: 1, program: { kind: 'battle-event-v1', source: null,
    entry: 0, end: ops.length, localNames: ['after'], initialLocals: [0], instructions: ops.map(op => ({ mnemonic: op.kind, op })), blockers: [] } };
  return { content: c, source: f };
}
export function variableMagicSource() {
  const f = enemyMagicSource();
  Object.assign(f.ability, { process_prog: 'ADD_VARIABLE_CALC', data_a: '999', data_b: '0', data_c: '3', condition_group_id: '0' });
  Object.assign(f.group, { function2_id: '823' });
  f.tables['function.csv']!.push({ id: '823', type_id: '23', series_id: '0' });
  return f;
}
