import type {DevelopmentAbilityPlan, AbilityProgram} from './ability.js';
import type {BattleConditions} from './battle-conditions.js';
import type {ActionParticipant} from './action-effects.js';

/** Read-only evidence supplied by the existing current battle parameter owner.
 * No source ability ID chooses the native Type3 versus ordinary query branch. */
export type SourceConditionDeathContext = {
  kind:'source-function9-death-override-v1'; actorId:string; abilityId:number; conditionId:number;
  targetIds:readonly string[]; normalBranch:'native-type3'|'known-non-undead';
};
export function sourceDeathApplication(plan:DevelopmentAbilityPlan,conditions:BattleConditions,program?:AbilityProgram){
  const deaths=plan.effects.filter(effect=>effect.kind==='add-condition'&&conditions.referenceTypes([effect.conditionId]).includes(5));
  if(!deaths.length)return null;
  const effect=deaths[0]!;
  if(effect.kind!=='add-condition'||deaths.length!==1||plan.effects.length!==1||effect.slot!==1)
    throw Error('Unresolved source Function9 death companion phases');
  if(program){const fn=program.functions[0];if(program.functions.length!==1||fn?.slot!==1||fn.type!==9||fn.series!==0||
      fn.values[0]!==effect.conditionId||![0,1].includes(fn.values[1])||fn.values[2]!==0||effect.fixedHit!==(fn.values[1]===1)||
      program.process.key!=='None'||program.process.values.some(Boolean))
    throw Error('Changed complete source Function9 death program');}
  return effect;
}
export function validateSourceDeathContext(context:SourceConditionDeathContext|undefined,actor:Pick<ActionParticipant,'id'>,
  target:Pick<ActionParticipant,'id'>,conditionId:number,abilityId:number|undefined){
  if(context?.kind!=='source-function9-death-override-v1'||context.actorId!==actor.id||context.conditionId!==conditionId||
      context.abilityId!==abilityId||!['native-type3','known-non-undead'].includes(context.normalBranch)||
      !Array.isArray(context.targetIds)||new Set(context.targetIds).size!==context.targetIds.length||!context.targetIds.includes(target.id))
    throw Error('Missing actual source Function9 death override provider');
}
