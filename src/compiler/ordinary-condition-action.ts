import type { AbilityEffect, AbilityProgram } from '../core/ability.js';
import { WEB_ORDINARY_CONDITION_ACTION, type OrdinaryConditionPresentation } from '../core/ordinary-condition-action.js';
import type { ConditionReader } from './conditions.js';
import { compileConditionGroup } from './conditions.js';
import { compileSourceConditionRecoveryHit } from './source-condition-application.js';
import { tableInteger as int } from './table.js';
import { compileContentFlags } from './content-flags.js';
import { compileAttackElements } from './elements.js';
import { validateNonDamagingPresentation, WEB_NON_DAMAGING_PRESENTATION } from '../core/non-damaging-ability.js';

/** Shared standard Act carriers, not an ability/condition identity list. The
 * existing decoder must positively establish an incoming active lifecycle.
 * Removal references may be inactive, but unknown active states stay hard. */
export function compileOrdinaryConditionAction(reader: ConditionReader, program: AbilityProgram, effect: AbilityEffect) {
  const [fn] = program.functions;
  if (program.functions.length !== 1 || fn?.slot !== 1 || fn.series !== 0 || ![9, 11, 12].includes(fn.type) ||
      program.process.key !== 'None' || program.process.values.some(Boolean) ||
      ![1, 2, 3, 4, 9, 13, 504, 604, 637].includes(program.rules.type_id!) ||
      ![1, 2, 3, 5].includes(program.rules.system_id!) ||
      ![1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 20, 21].includes(program.range) ||
      program.contentFlags.some(id => ![1, 3].includes(id)) || program.elements.length || program.rules.attribute_group_id !== 0)
    throw Error('Unresolved ordinary condition carrier/function/phase');
  if (effect.slot !== 1 || (fn.type === 9 ? effect.kind !== 'add-condition' || fn.values[0] !== effect.conditionId ||
      ![0, 1].includes(fn.values[1]) || fn.values[2] !== 0 : effect.kind !== 'recover-condition' ||
      fn.values[1] !== 0 || fn.values[2] !== 0))
    throw Error('Unresolved ordinary condition effect structure');
  const ability = reader.row('ability.csv', program.abilityId), group = reader.row('function_group.csv', program.groupId),
    row = reader.row('function.csv', fn.functionId), sources = [ability, group, row];
  const ruleKeys = ['type_id','system_id','accuracy_rate','condition_group_id','content_flag_group_id','attribute_group_id',
    'attack_count','Impact_status','invalid_boss','invalid_reflection','resistance_attribute','adding_hit_rate','valid_hit_rate','weak_hit_rate','reaction_type'];
  if (Object.keys(program.rules).length !== ruleKeys.length || ruleKeys.some(key => program.rules[key] !== int(ability.values[key])) ||
      program.process.key !== ability.values.process_prog || ['data_a','data_b','data_c'].some((key,n) => int(ability.values[key]) !== program.process.values[n]))
    throw Error('Changed ordinary condition complete rule/phase binding');
  const forbidden = compileConditionGroup(reader, program.rules.condition_group_id!),
    flags = compileContentFlags(reader, program.rules.content_flag_group_id!),
    elements = compileAttackElements(reader, int(ability.values.attribute_id), program.rules.attribute_group_id!);
  sources.push(...forbidden.sources,...forbidden.ids.map(id => reader.row('condition.csv',id)),...flags.sources,...elements.sources);
  if (JSON.stringify(forbidden.ids) !== JSON.stringify(program.forbiddenConditionIds) ||
      JSON.stringify(flags.ids) !== JSON.stringify(program.contentFlags) || JSON.stringify(elements.elements) !== JSON.stringify(program.elements))
    throw Error('Changed ordinary condition flags/forbidden/element binding');
  if (int(ability.values.id) !== program.abilityId || int(ability.values.battle_function_group_id) !== program.groupId ||
      int(ability.values.ability_lv) !== 0 || int(ability.values.type_id) !== program.rules.type_id ||
      int(ability.values.system_id) !== program.rules.system_id || int(ability.values.battle_renge_id) !== program.range ||
      int(ability.values.attribute_id) !== 0 || int(group.values.id) !== program.groupId ||
      int(group.values.function1_id) !== fn.functionId || int(row.values.type_id) !== fn.type || int(row.values.series_id) !== 0 ||
      fn.values.some((v, n) => int(group.values[`function1_value${n + 1}`]) !== v) ||
      [2, 3].some(slot => int(group.values[`function${slot}_id`]) !== 0 || [1, 2, 3].some(n => int(group.values[`function${slot}_value${n}`]) !== 0)))
    throw Error('Ordinary condition source has changed/omitted function or scalar input');
  const conditionIds = effect.kind === 'add-condition' ? [effect.conditionId] : effect.kind === 'recover-condition' ? effect.conditionIds : [];
  if (!conditionIds.length) throw Error('Empty ordinary condition action');
  for (const id of conditionIds) sources.push(reader.row('condition.csv', id));
  if(effect.kind==='recover-condition'&&conditionIds.some(id=>int(reader.row('condition.csv',id).values.condition_type)===5))
    throw Error('Ordinary recovery needs a separate source life/undead override provider');
  if (fn.type === 12) {
    const compiled = compileConditionGroup(reader, fn.values[0]); sources.push(...compiled.sources);
    if (JSON.stringify(compiled.ids) !== JSON.stringify(conditionIds)) throw Error('Changed ordinary condition group order');
  } else if (conditionIds.length !== 1 || conditionIds[0] !== fn.values[0]) throw Error('Changed ordinary condition row identity');
  const hit = compileSourceConditionRecoveryHit(reader, program); sources.push(...hit.sources);
  if(![1,2,3].includes(hit.metadata.forAiType))throw Error('Unresolved ordinary condition Chanting phase classification');
  const effectAssetId = int(ability.values.battle_effect_asset_id);
  if (effectAssetId < 0) throw Error('Invalid ordinary condition source effect identity');
  let sourceEffect: OrdinaryConditionPresentation['sourceEffect'] = null;
  if (effectAssetId) {
    const effectRow = reader.row('battle_effect_asset.csv', effectAssetId), v = effectRow.values; sources.push(effectRow);
    const soundAssetIds: [number, number, number] = [int(v.se_asset_id), int(v.se_asset_id_2), int(v.critical_se_asset_id)];
    for (const id of soundAssetIds) if (id > 0) sources.push(reader.row('se_asset.csv', id));
    sourceEffect = { assetName: v.asset_name!, positionType: int(v.position_type), displayType: int(v.display_type), soundAssetIds };
  }
  const presentation: OrdinaryConditionPresentation = { kind: WEB_ORDINARY_CONDITION_ACTION, functionType: fn.type as 9 | 11 | 12,
    conditionIds: [...conditionIds], sourceProgram:structuredClone(program), sourceHitClassification:hit.metadata, effectAssetId, sourceEffect, originalEffect: 'deferred', actionClock: 'existing-web-action-stages' };
  validateNonDamagingPresentation({kind:WEB_NON_DAMAGING_PRESENTATION,effectAssetId,sourceEffect,originalEffect:'deferred',actionClock:'existing-web-action-stages'});
  if(sources.some(row=>row.source.rowId!==row.values.id))throw Error('Ordinary condition source row identity mismatch');
  const boundEffect:AbilityEffect=effect.kind==='recover-condition'?{...effect,recoveryHit:'matching-current-condition-or-miss'}:effect;
  return { presentation, sources, effect:boundEffect };
}
