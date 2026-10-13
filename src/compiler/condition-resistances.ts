import type { ConditionDefinition } from "../core/conditions.js";
import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
};
export type ConditionResistanceDependency = { table: string; id: number; field?: string };
export class ConditionResistanceCompilationError extends Error {
  constructor(message: string, readonly dependency: ConditionResistanceDependency) { super(message); }
}
const identity = (value: number) => Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** GroupMasterUtility.SetupResistanceConditionDic 0x4dc770 / callback 0x4ef750
 * copies ConditionId -> TypeId. InvocationRate is not a probability or value in
 * this consumer. EnemyCharacterParameter 0x4afb70 owns that copied dictionary.
 * Duplicate keys keep the first native enumeration; conflicting rows cannot
 * inherit an unproved CSV order. References do not admit active conditions. */
export function compileConditionResistances(reader: Reader, groupId: number,
  definitions?: readonly ConditionDefinition[]) {
  const groupDependency = { table: "condition_group.csv", id: groupId, field: "group_id" };
  if (!Number.isInteger(groupId) || groupId < 0 || groupId > 0x7fffffff)
    throw new ConditionResistanceCompilationError("Invalid condition resistance group", groupDependency);
  const resistances: Record<string, number> = {}, sources: BattleRow[] = [], shadowedRowIds: string[] = [];
  // Existing zero-group content must not gain a new table dependency or seed.
  if (groupId === 0) return { resistances, sources, shadowedRowIds };
  const bound = (table: string, row: BattleRow, expectedId?: number): number => {
    const id = int(row.values.id);
    if (!identity(id) || expectedId !== undefined && id !== expectedId || row.source.rowId !== String(id) ||
        !(row.source.assetPath === table || row.source.assetPath.endsWith("/" + table)))
      throw new Error("Changed condition resistance source identity: " + table + ":" + id);
    return id;
  };
  let rows: BattleRow[];
  try {
    rows = reader.group("condition_group.csv", "group_id", groupId);
    if (!rows.length) throw new Error("Missing condition resistance group " + groupId);
  } catch (error) { throw new ConditionResistanceCompilationError(message(error), groupDependency); }
  const rowIds = new Set<number>();
  for (const row of rows) {
    let dependency: ConditionResistanceDependency = groupDependency;
    try {
      const rowId = bound("condition_group.csv", row);
      dependency = { table: "condition_group.csv", id: rowId };
      if (rowIds.has(rowId)) throw new Error("Duplicate condition resistance source row " + rowId);
      rowIds.add(rowId);
      if (int(row.values.group_id) !== groupId) throw new Error("Changed condition resistance group binding");
      const conditionId = int(row.values.condition_id), selector = int(row.values.type_id), rate = int(row.values.invocation_rate);
      if (!identity(conditionId)) throw new Error("Invalid resistance condition identity");
      if (!Number.isInteger(selector) || selector < 0 || selector > 0x7fffffff)
        throw new Error("Invalid condition resistance selector");
      if (rate < -0x80000000 || rate > 0x7fffffff) throw new Error("Invalid condition group invocation integer");
      dependency = { table: "condition.csv", id: conditionId };
      const master = reader.row("condition.csv", conditionId);
      bound("condition.csv", master, conditionId);
      const type = int(master.values.condition_type), overlap = int(master.values.overlapped_type),
        eraseGroupId = int(master.values.erase_condition_group_id);
      if (type < 0 || type > 0x7fffffff || ![0, 1].includes(overlap) || !identity(eraseGroupId))
        throw new Error("Invalid resistance condition master " + conditionId);
      if (definitions !== undefined) {
        const matches = definitions.filter(definition => definition.id === conditionId);
        if (matches.length !== 1 || matches[0]!.type !== type || matches[0]!.overlapped !== (overlap === 1) ||
            matches[0]!.eraseGroupId !== eraseGroupId)
          throw new Error("Resistance condition master disagrees with the battle catalog: " + conditionId);
      }
      dependency = { table: "condition_group.csv", id: rowId, field: "condition_id/type_id" };
      if (Object.hasOwn(resistances, conditionId)) {
        if (resistances[conditionId] !== selector)
          throw new Error(`Unreviewed conflicting condition resistance rows in group ${groupId}, condition ${conditionId}`);
        shadowedRowIds.push(row.source.rowId);
      } else resistances[conditionId] = selector;
      sources.push(structuredClone(row), structuredClone(master));
    } catch (error) { throw new ConditionResistanceCompilationError(message(error), dependency); }
  }
  return { resistances, sources, shadowedRowIds };
}
