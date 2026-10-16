import type {AbilityProgram} from './ability.js';
import type {AbilityDefinition} from './battle-content.js';
import {baseHpMagicEffect} from './base-hp-magic.js';

/** Source EnemyMagic is a carrier, never permission to replace arbitrary
 * Function3 operands, learning/owned commands or actual actor providers. */
export function isSourceEnemyMagicProgram(program:AbilityProgram):boolean {
 const fn=program.functions[0];return program.rules.type_id===13&&program.rules.system_id===3&&
  program.functions.length===1&&fn?.type===3&&fn.series===0&&
  fn.values[0]===1&&fn.values[1]===0&&fn.values[2]===0&&
  program.process.key==='None'&&program.process.values.every(value=>value===0);
}
/** Existing Type13 control/absorption families keep their own contracts.
 * This only guards the newly admitted single numerical magic carrier. */
export function enemyMagicActorBlocker(ability:AbilityDefinition,side:'player'|'enemy'):string|null {
 if(ability.program.rules.type_id===13&&ability.plan?.effects[0]?.kind==='base-hp-magic'){
  try{baseHpMagicEffect(ability.plan,ability.program);}catch{return 'Unresolved source EnemyMagic fixed-base HP function/phase carrier';}
  if(ability.program.rules.reaction_type!==0)return 'Unresolved source EnemyMagic reaction_type provider';
  const hit=ability.conditionRecoveryHit;
  if(hit?.kind!=='source-condition-recovery-hit-v1'||hit.forAiType!==2||hit.isMagic!==true)
   return 'Missing exact source EnemyMagic Chanting/hit classification';
  return side==='enemy'?null:'Unresolved player/special EnemyMagic actor and owned command provider';
 }
 if(ability.program.rules.type_id!==13||ability.plan?.effects.length!==1||ability.plan.effects[0]?.kind!=='magic')return null;
 if(!isSourceEnemyMagicProgram(ability.program))return 'Unresolved source EnemyMagic function/phase carrier';
 if(ability.program.rules.reaction_type!==0)return 'Unresolved source EnemyMagic reaction_type provider';
 const hit=ability.conditionRecoveryHit;
 if(hit?.kind!=='source-condition-recovery-hit-v1'||hit.forAiType!==2||hit.isMagic!==true)
  return 'Missing exact source EnemyMagic Chanting/hit classification';
 return side==='enemy'?null:'Unresolved player/special EnemyMagic actor and owned command provider';
}
