import type { ConditionReader } from './conditions.js';
import type { BattleRow } from './battle.js';
import type { ConditionDefinition } from '../core/conditions.js';
import { WEB_MINERALIZATION_PHASES, type MineralizationBehavior } from '../core/condition-mineralization.js';
import { compileConditionResistanceProvider } from './condition-resistance-provider.js';
import { tableInteger as int } from './table.js';

/** Positive lifecycle recognition; no other condition-type gains behavior.
 * In particular attack_target=0 and game_over_target=1 are independent. */
export function hasMineralizationLifecycle(row: Pick<BattleRow, 'values'>): boolean {
  const v = row.values;
  return int(v.condition_type) === 11 && int(v.system_type) === 1 && int(v.until_type) === 3 &&
    int(v.resistance_decision) === 1 && int(v.game_over_target) === 1 && int(v.recovery_invalid) === 1 &&
    int(v.state_cover_unavailable) === 1 && int(v.condition_group_id) >= 0 && int(v.erase_condition_group_id) > 0 &&
    int(v.battle_effect_asset_id) > 0 && int(v.icon_id) > 0 &&
    ['overlapped_type', 'until_value', 'invalid_type', 'target_type', 'parameter_group_id', 'attribute_group_id',
      'species_group_id', 'rate_type1', 'rate_type2', 'rate_value1', 'rate_value2', 'attack_target', 'damage_number',
      'battle_effect_shadow_cloning', 'field_se_asset_id'].every(key => int(v[key]) === 0);
}
export function compileMineralizationCondition(reader: ConditionReader, row: BattleRow,
    name: (key: string) => string, definitions: readonly ConditionDefinition[]) {
  if (!hasMineralizationLifecycle(row)) return { behavior: null, sources: [] as BattleRow[], blockers: [] as string[] };
  if (row.source.rowId !== row.values.id) throw new Error('Changed Mineralization condition binding');
  const key = row.values.mes_id_name;
  if (!key || key === 'None') throw new Error('Missing Mineralization message identity');
  const behavior: MineralizationBehavior = { id: int(row.values.id), kind: 'mineralization', name: name(key), untilType: 3,
    phasePolicy: WEB_MINERALIZATION_PHASES };
  const result = compileConditionResistanceProvider(reader, row, behavior, definitions);
  const effect = reader.row('battle_effect_asset.csv', int(row.values.battle_effect_asset_id)),
    icon = reader.row('icon.csv', int(row.values.icon_id)), sources = [row, ...result.sources, effect, icon];
  for (const field of ['se_asset_id', 'se_asset_id_2', 'critical_se_asset_id'])
    if (int(effect.values[field]) > 0) sources.push(reader.row('se_asset.csv', int(effect.values[field])));
  if (sources.some(source => source.source.rowId !== source.values.id)) throw new Error('Changed Mineralization dependency binding');
  return { ...result, sources };
}
