import type { AbilityProgram, DevelopmentAbilityPlan } from './ability.js';
import type { ActionParticipant } from './action-effects.js';
import { checkpointKeys } from './checkpoint-validation.js';
import { validateNonDamagingPresentation, WEB_NON_DAMAGING_PRESENTATION, type NonDamagingAbilityPresentation } from './non-damaging-ability.js';
import { drawBattleRandom, magicAccuracyHit, targetConditionAccuracy, type BattleRandom } from './battle-hit.js';

export const WEB_BASE_HP_MAGIC = 'web-source-base-hp-magic-deferred-v1' as const;
/** The native Value1/2/3 operands remain distinct from the ability row ID. */
export type BaseHpMagicEffect = {
  kind: 'base-hp-magic'; slot: number; rawValues: [number, number, number]; accuracy: number; contentFlags: number[];
  presentation: Omit<NonDamagingAbilityPresentation, 'kind'> & { kind: typeof WEB_BASE_HP_MAGIC };
};
/** EnemyCharacterParameter ctor -> bossFlag. This immutable content fact is
 * neither encounter boss metadata nor an owned character/save property. */
export type SourceEnemyBossParameter = { kind: 'source-enemy-boss-parameter-v1'; sourceId: number; bossFlag: number };
export function parseSourceEnemyBossParameter(raw: unknown, sourceId: number): SourceEnemyBossParameter {
  checkpointKeys(raw, 'kind,sourceId,bossFlag');
  const value = raw as SourceEnemyBossParameter;
  if (value.kind !== 'source-enemy-boss-parameter-v1' || value.sourceId !== sourceId ||
      !Number.isInteger(sourceId) || sourceId < 1 || sourceId > 0x7fffffff ||
      !Number.isInteger(value.bossFlag) || value.bossFlag < 0 || value.bossFlag > 0x7fffffff)
    throw Error('Invalid source enemy boss parameter binding');
  return { ...value };
}
export function validateBaseHpMagicEffect(effect: BaseHpMagicEffect) {
  checkpointKeys(effect, 'kind,slot,rawValues,accuracy,contentFlags,presentation');
  const v = effect.rawValues;
  if (effect.kind !== 'base-hp-magic' || !Number.isInteger(effect.slot) || effect.slot < 1 || effect.slot > 3 ||
      !Array.isArray(v) || v.length !== 3 || v.some(x => !Number.isInteger(x) || x < 0 || x > 0x7fffffff) ||
      ![1, 2].includes(v[0]) || ![1, 2, 3, 6].includes(v[1]) ||
      ([1, 6].includes(v[1]) ? v[2] !== 0 : v[2] < 1 || v[1] === 2 && v[2] > 100))
    throw Error('Unresolved source base HP magic operands');
  if (!Number.isInteger(effect.accuracy) || effect.accuracy < 0 || effect.accuracy > 0x7fffffff ||
      !Array.isArray(effect.contentFlags) || effect.contentFlags.some(flag => ![1, 2, 3, 5].includes(flag)))
    throw Error('Unresolved source base HP magic hit/flags');
  validateNonDamagingPresentation({ ...effect.presentation, kind: WEB_NON_DAMAGING_PRESENTATION });
  if (effect.presentation.kind !== WEB_BASE_HP_MAGIC) throw Error('Missing source base HP magic presentation policy');
}
/** Decode every slot, but never treat an unreviewed companion as an empty slot. */
export function baseHpMagicEffect(plan: DevelopmentAbilityPlan, program?: AbilityProgram): BaseHpMagicEffect | null {
  const effects = plan.effects.filter((e): e is BaseHpMagicEffect => e.kind === 'base-hp-magic');
  if (!effects.length) return null;
  for (const effect of effects) validateBaseHpMagicEffect(effect);
  if (effects.length !== 1 || plan.effects.length !== 1 || effects[0]!.slot !== 1 || plan.magic !== null || plan.physical !== null)
    throw Error('Unresolved whole source base HP magic composition');
  const effect = effects[0]!;
  if (program) {
    const fn = program.functions[0];
    if (program.functions.length !== 1 || fn?.type !== 33 || fn.slot !== 1 || fn.series !== 0 ||
        fn.values.some((v, n) => v !== effect.rawValues[n]) ||
        program.rules.accuracy_rate !== effect.accuracy || JSON.stringify(program.contentFlags) !== JSON.stringify(effect.contentFlags) ||
        program.elements.length !== 0 || program.rules.attribute_group_id !== 0 ||
        ![1, 2, 3, 13, 504].includes(program.rules.type_id!) || program.rules.system_id !== 3 ||
        program.process.key !== 'None' || program.process.values.some(Boolean))
      throw Error('Changed source base HP magic complete program binding');
  }
  return effect;
}
/** Read-only provenance supplied by the existing BattleGame parameter owner. */
export type BaseHpMagicContext = { actorId: string; targets: { targetId: string; parameter: 'player' | 'enemy'; boss: boolean }[] };

/** BaseValueFixedHPFunction.Calc 4f4760. Restrict to all observed Fn33 source
 * modes; unobserved random/digit modes remain unsupported. Native multiplication
 * is int32 and division truncates toward zero, including overflow. */
export function baseHpMagicValue(effect: BaseHpMagicEffect, actor: Pick<ActionParticipant, 'hp' | 'maxHp'>,
  target: Pick<ActionParticipant, 'hp' | 'maxHp'>) {
  validateBaseHpMagicEffect(effect);
  const source = effect.rawValues[0] === 1 ? actor : target, [_, mode, value] = effect.rawValues;
  for (const unit of [actor, target]) if (![unit.hp, unit.maxHp].every(x => Number.isInteger(x) && x >= 0 && x <= 0x7fffffff) ||
      unit.maxHp < 1 || unit.hp > unit.maxHp) throw Error('Invalid source base HP magic resource');
  return mode === 1 ? source.hp : mode === 2 ? Math.trunc(Math.imul(source.hp, value) / 100) :
    mode === 3 ? Math.trunc(source.hp / value) : source.maxHp - source.hp;
}

/** GetFixedBaseValueMagicStatus3d78d0 -> MagicExecution(fixType=1).
 * The current closed source family is neutral: no variance, defense, Shell,
 * actor-stat or friendly-side correction. Group correction and final cap remain.
 * The action owner rejects unimplemented active conditions on BOTH units and
 * checks target-owned equipment before supplying parameter provenance. Target
 * Trance/reversal are additionally refused here; no unimplemented type is
 * admitted into the actual BattleConditions owner by this scalar calculator. */
export function calculateBaseHpMagic(effect: BaseHpMagicEffect, actor: ActionParticipant, target: ActionParticipant,
  targetTypes: readonly number[], random: BattleRandom, targetCount: number, context: BaseHpMagicContext | undefined) {
  const base = baseHpMagicValue(effect, actor, target);
  if (base < 0) throw Error('Source base HP magic overflow/recovery provider remains unresolved');
  if (!Number.isInteger(targetCount) || targetCount < 1 || !Number.isInteger(target.magicEvasion) ||
      target.magicEvasion < 0 || target.magicEvasion > 0x7fffffff) throw Error('Invalid source base HP magic context');
  targetConditionAccuracy(effect.accuracy, targetTypes);
  if (targetTypes.some(type => [9, 11, 34, 621, 656, 684].includes(type)))
    throw Error('Unresolved source base HP magic condition override');
  const bound = context?.targets.filter(value => value.targetId === target.id);
  if (context?.actorId !== actor.id || bound?.length !== 1 || !['player', 'enemy'].includes(bound[0]!.parameter) ||
      typeof bound[0]!.boss !== 'boolean' || bound[0]!.parameter === 'player' && bound[0]!.boss)
    throw Error('Missing current source base HP magic parameter provenance');
  if (bound[0]!.parameter === 'enemy' && bound[0]!.boss)
    return { slot: effect.slot, resource: 'hp' as const, recovery: false, amount: 0, missed: true };
  const accuracy = effect.contentFlags.includes(1) ? 255 : Math.min(255, effect.accuracy);
  // Native force-hit conditions entered after the ordinary hit branch still
  // consume its one draw. Explicit fixed accuracy255 enters no hit branch.
  let hit: boolean;
  if (accuracy < 255 && targetTypes.some(type => [7, 17, 443, 444, 603, 604].includes(type))) {
    drawBattleRandom(random, 0, 255); hit = true;
  } else hit = magicAccuracyHit(accuracy, target.magicEvasion, targetTypes, random);
  if (!hit) return { slot: effect.slot, resource: 'hp' as const, recovery: false, amount: 0, missed: true };
  let amount = Math.min(base, 65535);
  if (targetCount > 1 && !effect.contentFlags.includes(2) && amount > 0) amount = Math.max(Math.trunc(amount / 2), 1);
  amount = Math.min(amount, 9999);
  return { slot: effect.slot, resource: 'hp' as const, recovery: false, amount, missed: false,
    ...(amount === 0 ? { nullified: true } : {}) };
}
