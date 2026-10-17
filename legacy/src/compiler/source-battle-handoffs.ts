import { record } from './content.js';
import { tableInteger } from './battle.js';
import { WEB_SOURCE_BATTLE_HANDOFFS, validateSourceBattleHandoffCatalog, type SourceBattleHandoffCatalog, type SourceBattleHandoffOp } from '../core/source-battle-handoffs.js';
export const sourceBattleHandoffSelectors = ['コロシアム回復', 'コロシアム開始', 'バトルデータ復元：sc_b_0055'] as const;
export function compileSourceBattleHandoffCatalog(tables: Record<string, unknown>, sourceSetHash: string): SourceBattleHandoffCatalog {
  const rows = tables['condition.csv'];
  if (!Array.isArray(rows))
    throw Error('Missing complete source handoff condition master');
  const catalog: SourceBattleHandoffCatalog = { kind: 'source-battle-handoff-catalog-v1', policy: WEB_SOURCE_BATTLE_HANDOFFS,
    sourceSetHash, conditions: rows.map(raw => {
      const row = record(raw);
      return { id: tableInteger(row.id as string), type: tableInteger(row.condition_type as string), untilType: tableInteger(row.until_type as string) };
    }) };
  validateSourceBattleHandoffCatalog(catalog);
  return catalog;
}
export function compileSourceBattleHandoffInstruction(raw: unknown): SourceBattleHandoffOp {
  const m = record(raw), o = record(m.operands);
  if (m.type !== 1 || m.mnemonic !== 'SysCall')
    throw Error('Source handoff requires MainCore SysCall');
  for (const [key, zero] of [['iValues', 0], ['rValues', 0], ['sValues', '']] as const) {
    const values = o[key];
    if (!Array.isArray(values) || values.length !== 8 || Object.keys(values).length !== 8 ||
      Array.from({ length: 8 }, (_, i) => !Object.hasOwn(values, i)).some(Boolean))
      throw Error('Source handoff requires dense eight operands');
    for (let i = key === 'sValues' ? 1 : 0; i < 8; i++)
      if (values[i] !== zero)
        throw Error('Unadmitted source handoff reserved operand');
  }
  const selector = (o.sValues as unknown[])[0];
  if (selector === 'コロシアム開始')
    throw Error('Source Colosseum start requires its actual bet/opponent menu, automatic-battle and settlement providers');
  if (selector === 'コロシアム回復')
    return { kind: 'source-battle-handoff', command: 'colosseum-recovery' };
  if (selector === 'バトルデータ復元：sc_b_0055')
    return { kind: 'source-battle-handoff', command: 'restore-0055' };
  throw Error('Unknown source battle handoff selector');
}
