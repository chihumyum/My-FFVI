import {checkpointKeys} from './checkpoint-validation.js';
/** Explicit Web alternative: expand the source initial group in complete master
 * order and install supported conditions on each fresh enemy before AI/timers.
 * This does not certify native late ctor lookup or Unity activation timing. */
export const WEB_ENEMY_SPAWN_CONDITIONS='web-source-enemy-spawn-conditions-v1' as const;
export type WebEnemySpawnConditions={kind:typeof WEB_ENEMY_SPAWN_CONDITIONS};
export function parseWebEnemySpawnConditions(raw:unknown):WebEnemySpawnConditions{
 checkpointKeys(raw,'kind');if((raw as WebEnemySpawnConditions).kind!==WEB_ENEMY_SPAWN_CONDITIONS)throw new Error('Unknown Web enemy spawn condition policy');return {kind:WEB_ENEMY_SPAWN_CONDITIONS};
}
