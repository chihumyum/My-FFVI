import type { BattleRow } from './battle.js';
import { tableInteger as int } from './table.js';
/** Full source master shape for the recovered FF6 type407 lifecycle. English
 * names and row identities are not a dispatch or a fallback. */
export function hasSlipBehavior(row: Pick<BattleRow, 'values'>): boolean {
  const v = row.values;
  return int(v.condition_type) === 407 && int(v.system_type) === 3 && int(v.until_type) === 2 &&
    int(v.resistance_decision) === 1 && int(v.erase_condition_group_id) === 6 &&
    v.mes_id_name !== undefined && v.mes_id_name !== 'None' && v.mes_id_description === 'None' &&
    ['attack_target','attribute_group_id','battle_effect_asset_id','battle_effect_shadow_cloning',
      'condition_group_id','damage_number','field_se_asset_id','game_over_target','icon_id','invalid_type',
      'overlapped_type','parameter_group_id','rate_type1','rate_type2','rate_value1','rate_value2',
      'recovery_invalid','species_group_id','state_cover_unavailable','target_type','until_value'].every(k => int(v[k]) === 0);
}
