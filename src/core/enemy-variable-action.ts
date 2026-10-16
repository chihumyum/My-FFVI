import type { AbilityDefinition } from './battle-content.js';
import type { AbilityProgram } from './ability.js';
import { canonical } from './canonical.js';
import { copyEnemyBehavior, enemyVariableCount, type EnemyBehaviorState } from './enemy-behavior.js';
import { checkpointKeys } from './checkpoint-validation.js';
import { int32 } from './script-integer.js';

export const sourceEnemyVariableKeys = ['SET_VARIABLE_CALC', 'ADD_VARIABLE_CALC', 'ADD_VARIABLE_CALC_TWO_DIMENTIONAL'] as const;
export type SourceEnemyVariableAction = {
  kind: 'source-enemy-variable-action-v1'; bank: 'attacker-enemy-current';
  phase: 'hit-calc-once-per-action'; slot: 2;
  targetFallback: 'fixed-miss-per-target';
  sourceProgram: AbilityProgram;
};
export type EnemyVariableActionResult = {
  slot: 2; ownerId: string; before: EnemyBehaviorState; after: EnemyBehaviorState;
  /** This separate attacker dictionary value is not a target damage/Hit. */
  attackerCalculation: { value: 0; hitType: -1; hitCount: 0; conditions: null; recovery: false };
  /** Native UniqueFunction fallback is Miss, independently per target; it
   * never replaces the primary result used by received-AI readiness. */
  targetCalculation: { value: 0; hitType: 2; hitCount: 0; conditions: []; recovery: false };
};
export function isSourceEnemyVariableKey(key: string): boolean {
  return (sourceEnemyVariableKeys as readonly string[]).includes(key);
}
function index(value: number): number {
  int32(value);
  // Native direct array addressing; unlike BattleAI operands, negative values
  // do not alias the first cell. Source ctor owns exactly fifteen int32 cells.
  if (value < 0 || value >= enemyVariableCount) throw new Error('Source Function23 variable index outside the actual enemy bank');
  return value;
}
export function validateSourceEnemyVariableMetadata(program: AbilityProgram, value: SourceEnemyVariableAction): void {
  checkpointKeys(value, 'kind,bank,phase,slot,targetFallback,sourceProgram');
  if (value.kind !== 'source-enemy-variable-action-v1' || value.bank !== 'attacker-enemy-current' ||
      value.phase !== 'hit-calc-once-per-action' || value.slot !== 2 || value.targetFallback !== 'fixed-miss-per-target' || canonical(value.sourceProgram) !== canonical(program) ||
      !isSourceEnemyVariableKey(program.process.key) || program.functions.length !== 2)
    throw new Error('Unbound source Function23 variable phase');
  const [primary, variable] = program.functions;
  if (primary?.slot !== 1 || primary.series !== 0 || ![1, 2, 3, 9, 10, 19, 46].includes(primary.type) ||
      variable?.slot !== 2 || variable.type !== 23 || variable.series !== 0 || variable.values.length !== 3 || variable.values.some(Boolean) ||
      program.process.values.length !== 3)
    throw new Error('Unresolved source Function23 complete companion/slot');
  program.process.values.forEach(int32);
  index(program.process.values[1]);
  if (program.process.key === 'ADD_VARIABLE_CALC_TWO_DIMENTIONAL') index(program.process.values[0]);
}
/** A process string alone never authorizes a mutation or an enemy bank. */
export function enemyVariableActorBlocker(ability: AbilityDefinition, side: 'player' | 'enemy'): string | null {
  const value = ability.enemyVariableAction;
  const needs = ability.program.functions.some(fn => fn.type === 23) && isSourceEnemyVariableKey(ability.program.process.key);
  if (!value) return needs && ability.plan ? 'Missing source Function23 variable lifecycle' : null;
  try {
    validateSourceEnemyVariableMetadata(ability.program, value);
    if (!ability.plan || ability.plan.effects.length !== 1 || ability.plan.effects[0]?.slot !== 1)
      throw new Error('Unresolved source Function23 primary calculation');
    const primary = ability.program.functions[0]!, effect = ability.plan.effects[0]!;
    const expected: Record<number, string> = { 1: 'recovery', 2: 'physical', 3: 'magic', 9: 'add-condition', 19: 'non-damaging', 46: 'random-ability' };
    if (expected[primary.type] !== effect.kind) throw new Error('Changed source Function23 primary effect');
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  return side === 'enemy' ? null : 'Source Function23 requires its actual attacker EnemyCharacterParameter bank';
}
/** Pure preparation for the existing combatant owner. The whole action calls
 * this once, independently of primary hit or nominal target cardinality. */
export function projectEnemyVariableAction(ability: AbilityDefinition,
    actor: { id: string; side: 'player' | 'enemy'; behavior: EnemyBehaviorState | null }): EnemyVariableActionResult | null {
  const blocker = enemyVariableActorBlocker(ability, actor.side);
  if (blocker) throw new Error(blocker);
  if (!ability.enemyVariableAction) return null;
  if (!actor.behavior || typeof actor.id !== 'string' || !actor.id) throw new Error('Missing actual source Function23 variable owner');
  const before = copyEnemyBehavior(actor.behavior), after = copyEnemyBehavior(before), [a, b, c] = ability.program.process.values;
  const add = (i: number) => { const at = index(i); after.variables[at] = (after.variables[at]! + c) | 0; };
  if (ability.program.process.key === 'SET_VARIABLE_CALC') after.variables[index(b)] = c;
  else { if (ability.program.process.key === 'ADD_VARIABLE_CALC_TWO_DIMENTIONAL') add(a); add(b); }
  return { slot: 2, ownerId: actor.id, before, after,
    attackerCalculation: { value: 0, hitType: -1, hitCount: 0, conditions: null, recovery: false },
    targetCalculation: { value: 0, hitType: 2, hitCount: 0, conditions: [], recovery: false } };
}
