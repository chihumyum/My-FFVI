import { parseSourceBattleFlags, type SourceBattleFlags } from "../core/battle-flags.js";
import type { BattleRow } from "./battle.js";
import { tableInteger } from "./table.js";

/** Compile only the proven common applicability/controller family. Other
 * source enum members are not erased or treated as absent. */
export function compileSourceBattleFlags(partyId: number, partySource: BattleRow["source"],
  groupId: number, rows: readonly BattleRow[]): SourceBattleFlags {
  if (partySource.rowId !== String(partyId) || !rows.length)
    throw new Error("Source battle flags have no exact party/group binding");
  const flags = rows.map(row => {
    if (tableInteger(row.values.group_id) !== groupId || row.source.rowId !== row.values.id)
      throw new Error("Changed source battle flag group binding");
    const flagId = tableInteger(row.values.battle_flag_id);
    if (flagId !== 14 && flagId !== 19) throw new Error("Unimplemented source battle flag: " + flagId);
    return { flagId, source: row.source };
  });
  return parseSourceBattleFlags({ kind:"source-battle-flags-v1",entryContext:"story",partySource,groupId,
    rows:flags,arDirectoryEligible:false });
}
