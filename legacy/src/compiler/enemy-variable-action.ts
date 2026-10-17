import type { AbilityProgram } from '../core/ability.js';
import { isSourceEnemyVariableKey, validateSourceEnemyVariableMetadata, type SourceEnemyVariableAction } from '../core/enemy-variable-action.js';
import type { ConditionReader } from './conditions.js';
import { tableInteger as int } from './table.js';
import { canonical } from '../core/canonical.js';

/** Complete original rows remain intact. This describes a second source
 * phase; it does not replace the primary effect or grant a runtime owner. */
export function compileSourceEnemyVariableAction(reader: ConditionReader, program: AbilityProgram) {
  if (!isSourceEnemyVariableKey(program.process.key) || !program.functions.some(fn => fn.type === 23)) return null;
  const ability = reader.row('ability.csv', program.abilityId), group = reader.row('function_group.csv', program.groupId),
    sources = [ability, group];
  if (int(ability.values.id) !== program.abilityId || int(ability.values.battle_function_group_id) !== program.groupId ||
      int(group.values.id) !== program.groupId || ability.values.process_prog !== program.process.key ||
      ['data_a', 'data_b', 'data_c'].some((key, i) => int(ability.values[key]) !== program.process.values[i]))
    throw new Error('Changed source Function23 variable binding');
  const functions: AbilityProgram['functions'] = [];
  for (let slot = 1; slot <= 3; slot++) {
    const id = int(group.values[`function${slot}_id`]), values = [1, 2, 3].map(n => int(group.values[`function${slot}_value${n}`])) as [number, number, number];
    if (!id) { if (values.some(Boolean)) throw new Error('Orphan source Function23 companion operands'); continue; }
    const row = reader.row('function.csv', id); sources.push(row);
    functions.push({ slot, functionId: id, type: int(row.values.type_id), series: int(row.values.series_id), values });
  }
  const value: SourceEnemyVariableAction = { kind: 'source-enemy-variable-action-v1', bank: 'attacker-enemy-current',
    phase: 'hit-calc-once-per-action', slot: 2, targetFallback: 'fixed-miss-per-target', sourceProgram: structuredClone(program) };
  if (canonical(functions) !== canonical(program.functions) || sources.some(row => row.source.rowId !== row.values.id))
    throw new Error('Changed or omitted source Function23 companion');
  validateSourceEnemyVariableMetadata(program, value);
  return { value, sources };
}
