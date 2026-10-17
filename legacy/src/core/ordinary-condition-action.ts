import type { AbilityDefinition } from './battle-content.js';
import type { NonDamagingAbilityPresentation } from './non-damaging-ability.js';
import { validateNonDamagingPresentation, WEB_NON_DAMAGING_PRESENTATION } from './non-damaging-ability.js';
import { checkpointKeys } from './checkpoint-validation.js';
import type { AbilityProgram } from './ability.js';
import { canonical } from './canonical.js';

export const WEB_ORDINARY_CONDITION_ACTION = 'web-source-ordinary-condition-action-deferred-v1' as const;
export type OrdinaryConditionPresentation = Omit<NonDamagingAbilityPresentation, 'kind'> & {
  kind: typeof WEB_ORDINARY_CONDITION_ACTION;
  functionType: 9 | 11 | 12;
  conditionIds: number[];
  sourceProgram: AbilityProgram;
  sourceHitClassification: NonNullable<AbilityDefinition['conditionRecoveryHit']>;
};

/** A presentation declaration cannot authorize a condition lifecycle, grant an
 * owned ability, replace target identities or suppress a source companion. */
export function validateOrdinaryConditionAction(ability: Pick<AbilityDefinition,
  'ordinaryConditionPresentation' | 'presentation' | 'program' | 'plan' | 'conditionRecoveryHit'>): void {
  const value = ability.ordinaryConditionPresentation, first = ability.plan?.effects[0];
  const status = ability.plan?.effects.length === 1 && (first?.kind === 'add-condition' || first?.kind === 'recover-condition');
  if (!value) {
    if (status && ability.presentation === 'source-effect-deferred') throw Error('Missing ordinary condition presentation declaration');
    return;
  }
  checkpointKeys(value, 'kind,effectAssetId,sourceEffect,originalEffect,actionClock,functionType,conditionIds,sourceProgram,sourceHitClassification');
  if (value.kind !== WEB_ORDINARY_CONDITION_ACTION || ability.presentation !== 'source-effect-deferred' || !status)
    throw Error('Unresolved ordinary condition action declaration');
  if (value.sourceEffect) checkpointKeys(value.sourceEffect, 'assetName,positionType,displayType,soundAssetIds');
  const { functionType, conditionIds, sourceProgram, sourceHitClassification, ...presentation } = value;
  validateNonDamagingPresentation({ ...presentation, kind: WEB_NON_DAMAGING_PRESENTATION });
  const [fn] = ability.program.functions;
  if(!sourceProgram||!sourceHitClassification||!ability.conditionRecoveryHit)throw Error('Missing ordinary condition source phase binding');
  checkpointKeys(sourceHitClassification,'kind,forAiType,isMagic');
  if(sourceHitClassification.kind!=='source-condition-recovery-hit-v1'||![1,2,3].includes(sourceHitClassification.forAiType)||typeof sourceHitClassification.isMagic!=='boolean')
    throw Error('Unresolved ordinary condition source hit classification');
  if (canonical(sourceProgram) !== canonical(ability.program) || canonical(sourceHitClassification) !== canonical(ability.conditionRecoveryHit) || first!.slot !== 1 ||
      ability.program.functions.length !== 1 || fn?.slot !== 1 || fn.series !== 0 ||
      ![9, 11, 12].includes(fn.type) || fn.type !== functionType ||
      ability.program.process.key !== 'None' || ability.program.process.values.some(Boolean) ||
      !Array.isArray(conditionIds) || !conditionIds.length ||
      conditionIds.some(id => !Number.isInteger(id) || id < 1 || id > 0x7fffffff))
    throw Error('Changed ordinary condition source function/phase');
  if (functionType === 9) {
    if (first!.kind !== 'add-condition' || conditionIds.length !== 1 || conditionIds[0] !== first.conditionId ||
        fn.values[0] !== first.conditionId || ![0, 1].includes(fn.values[1]) || fn.values[2] !== 0 ||
        first.fixedHit !== (fn.values[1] === 1) ||
        first.accuracy !== (ability.program.contentFlags.includes(1) ? 255 : ability.program.rules.accuracy_rate))
      throw Error('Changed ordinary condition application binding');
  } else if (first!.kind !== 'recover-condition' || fn.values[1] !== 0 || fn.values[2] !== 0 ||
      first.recoveryHit !== 'matching-current-condition-or-miss' ||
      JSON.stringify(first.conditionIds) !== JSON.stringify(conditionIds) ||
      functionType === 11 && (conditionIds.length !== 1 || conditionIds[0] !== fn.values[0]))
    throw Error('Changed ordinary condition recovery binding');
}
