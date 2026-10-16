import type { AbilityFunction, AbilityProgram } from '../core/ability.js';
import { WEB_BASE_HP_MAGIC, validateBaseHpMagicEffect, parseSourceEnemyBossParameter, type BaseHpMagicEffect } from '../core/base-hp-magic.js';
import type { ConditionReader } from './conditions.js';
import { tableInteger as int } from './table.js';

/** A slot decoder, not whole-action admission. All other functions/processes
 * retain their own independent compiler diagnostics. */
export function compileBaseHpMagic(reader: ConditionReader, program: AbilityProgram, fn: AbilityFunction) {
  const ability = reader.row('ability.csv', program.abilityId), group = reader.row('function_group.csv', program.groupId),
    row = reader.row('function.csv', fn.functionId), sources = [ability, group, row];
  if (fn.type !== 33 || fn.series !== 0 || int(row.values.type_id) !== 33 || int(row.values.series_id) !== 0 ||
      int(ability.values.id) !== program.abilityId || int(ability.values.battle_function_group_id) !== program.groupId ||
      int(group.values.id) !== program.groupId || int(group.values[`function${fn.slot}_id`]) !== fn.functionId ||
      fn.values.some((v, n) => int(group.values[`function${fn.slot}_value${n + 1}`]) !== v))
    throw Error('Changed source base HP magic slot binding');
  const effectAssetId = int(ability.values.battle_effect_asset_id);
  let sourceEffect: BaseHpMagicEffect['presentation']['sourceEffect'] = null;
  if (effectAssetId) {
    const effect = reader.row('battle_effect_asset.csv', effectAssetId), v = effect.values; sources.push(effect);
    const soundAssetIds: [number, number, number] = [int(v.se_asset_id), int(v.se_asset_id_2), int(v.critical_se_asset_id)];
    for (const id of soundAssetIds) if (id > 0) sources.push(reader.row('se_asset.csv', id));
    sourceEffect = { assetName: v.asset_name!, positionType: int(v.position_type), displayType: int(v.display_type), soundAssetIds };
  }
  const effect: BaseHpMagicEffect = { kind: 'base-hp-magic', slot: fn.slot, rawValues: [...fn.values], accuracy: program.rules.accuracy_rate!, contentFlags: [...program.contentFlags],
    presentation: { kind: WEB_BASE_HP_MAGIC, effectAssetId, sourceEffect, originalEffect: 'deferred', actionClock: 'existing-web-action-stages' } };
  validateBaseHpMagicEffect(effect);
  return { effect, sources };
}

/** Enemy ctor4afb70 stores monster integer index37 through shared getter53e820;
 * Enemy.IsBoss4afb00 tests the unsigned field against zero. */
export function compileSourceEnemyBossParameter(reader: ConditionReader, sourceId: number) {
  const row = reader.row('monster.csv', sourceId);
  if (row.source.assetPath.split('/').at(-1) !== 'monster.csv' || row.source.rowId !== String(sourceId) ||
      int(row.values.id) !== sourceId) throw Error('Changed source enemy boss parameter source identity');
  return { metadata: parseSourceEnemyBossParameter({ kind: 'source-enemy-boss-parameter-v1', sourceId, bossFlag: int(row.values.boss) }, sourceId), sources: [row] };
}
