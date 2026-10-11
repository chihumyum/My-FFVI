import { int32 } from "./script-integer.js";

/** EnemyCharacterParameter owns these independently of the AI program counter,
 * field variables and other enemies. Source ctor 0x4afb70 allocates 15 zeroes. */
export type EnemyBehaviorState = { mode: number; variables: number[] };
export const enemyVariableCount = 15;

export function initialEnemyBehavior(): EnemyBehaviorState {
  return { mode: 0, variables: Array(enemyVariableCount).fill(0) };
}

export function copyEnemyBehavior(
  state: EnemyBehaviorState,
): EnemyBehaviorState {
  if (
    !Array.isArray(state.variables) ||
    state.variables.length !== enemyVariableCount
  )
    throw new Error("Invalid enemy behavior variable bank");
  return { mode: int32(state.mode), variables: state.variables.map(int32) };
}
