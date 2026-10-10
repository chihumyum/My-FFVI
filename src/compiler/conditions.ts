import { tableInteger as int } from "./table.js";
import type { BattleRow } from "./battle.js";
import {
  ConditionRules,
  type ConditionCatalog,
  type ConditionDefinition,
} from "../core/conditions.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
};

/** Supply the complete condition master ID list from this source snapshot.
 * Compilation preserves all raw rows; decoding an effect type is not support
 * for its timer, behavior function, visual or resistance calculation.
 */
export function compileConditionCatalog(
  reader: Reader,
  ids: readonly number[],
) {
  const sources: BattleRow[] = [];
  const definitions: ConditionDefinition[] = ids.map((id) => {
    const row = reader.row("condition.csv", id);
    sources.push(row);
    const overlap = int(row.values.overlapped_type);
    if (![0, 1].includes(overlap))
      throw new Error("Unsupported condition overlap: " + overlap);
    return {
      id: int(row.values.id),
      type: int(row.values.condition_type),
      overlapped: overlap === 1,
      eraseGroupId: int(row.values.erase_condition_group_id),
    };
  });
  const eraseRules = [
    ...new Set(definitions.map((c) => c.eraseGroupId)),
  ].flatMap((groupId) =>
    reader
      .group("erase_condition_group.csv", "group_id", groupId)
      .map((row) => {
        sources.push(row);
        return {
          id: int(row.values.id),
          groupId: int(row.values.group_id),
          conditionId: int(row.values.condition_id),
          type: int(row.values.type_id),
          eraseConditionId: int(row.values.erase_condition),
        };
      }),
  );
  const catalog: ConditionCatalog = { definitions, eraseRules };
  new ConditionRules(catalog); // Validate identities, selectors and reference closure.
  return { catalog, sources };
}
