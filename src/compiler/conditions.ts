import { tableInteger as int } from "./table.js";
import type { BattleRow } from "./battle.js";
import type { BattleConditionCatalog } from "../core/battle-conditions.js";
import {
  ConditionRules,
  type ConditionCatalog,
  type ConditionDefinition,
} from "../core/conditions.js";

export type ConditionReader = {
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
};

/** GetConditions 0x4da710 filters only group identity. Type and invocation rate
 * are NOT filters in this call path. Preserve order and repeated IDs. */
export function compileConditionGroup(
  reader: ConditionReader,
  groupId: number,
) {
  const sources = reader.group("condition_group.csv", "group_id", groupId);
  const ids = sources.map((r) => int(r.values.condition_id));
  for (const id of ids) reader.row("condition.csv", id);
  return { ids, sources };
}

export function hasSilenceBehavior(row: BattleRow): boolean {
  const v = row.values;
  return (
    int(v.condition_type) === 6 &&
    int(v.system_type) === 1 &&
    int(v.resistance_decision) === 1 &&
    int(v.until_type) === 2 &&
    [
      "until_value",
      "overlapped_type",
      "invalid_type",
      "target_type",
      "condition_group_id",
      "parameter_group_id",
      "attribute_group_id",
      "species_group_id",
      "rate_type1",
      "rate_type2",
      "rate_value1",
      "rate_value2",
      "recovery_invalid",
      "attack_target",
      "game_over_target",
      "state_cover_unavailable",
      "damage_number",
    ].every((key) => int(v[key]) === 0)
  );
}

export function compileBattleConditionCatalog(
  reader: ConditionReader,
  ids: readonly number[],
  name: (key: string) => string,
) {
  const result = compileConditionCatalog(reader, ids);
  const catalog: BattleConditionCatalog = {
    rules: result.catalog,
    behaviors: result.catalog.definitions.flatMap((d) => {
      const row = reader.row("condition.csv", d.id);
      return hasSilenceBehavior(row)
        ? [
            {
              id: d.id,
              kind: "silence" as const,
              name: name(row.values.mes_id_name!),
              untilType: 2 as const,
            },
          ]
        : [];
    }),
  };
  return { catalog, sources: result.sources };
}

/** Supply the complete condition master ID list from this source snapshot.
 * Compilation preserves all raw rows; decoding an effect type is not support
 * for its timer, behavior function, visual or resistance calculation.
 */
export function compileConditionCatalog(
  reader: ConditionReader,
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
