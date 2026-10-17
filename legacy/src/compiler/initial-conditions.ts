import { BattleConditions, type BattleConditionCatalog } from "../core/battle-conditions.js";
import type { BattleRow } from "./battle.js";
import type { ConditionReader } from "./conditions.js";
import { tableInteger as int } from "./table.js";

export type InitialConditionDependency = { table: string; id: number; field?: string };
export class InitialConditionCompilationError extends Error {
  constructor(message: string, readonly dependency: InitialConditionDependency) { super(message); }
}

const identity = (value: number) => Number.isInteger(value) && value > 0 && value <= 0x7fffffff;

/** GetStartCondition 0x45d0b0 gets group membership, then filters the condition
 * MASTER array by membership (4672a0). Group selector/rate do not filter this
 * consumer, repeated membership does not duplicate a master. Init's callback
 * 4674c0 appends missing identities directly before constructing behaviors: no
 * accuracy, resistance or condition-conflict pass. Multiple masters require an exact master view and a proved commuting
 * behavior family; the ctor's direct-master/group-ID collision stays gated. */
export function compileEnemyInitialConditions(reader: ConditionReader, groupId: number,
  catalog: BattleConditionCatalog): { conditionIds: number[]; sources: BattleRow[] } {
  const groupDependency = { table: "condition_group.csv", id: groupId, field: "group_id" };
  if (!Number.isInteger(groupId) || groupId < 0 || groupId > 0x7fffffff)
    throw new InitialConditionCompilationError("Invalid enemy initial condition group", groupDependency);
  if (groupId === 0) return { conditionIds: [], sources: [] };
  let dependency: InitialConditionDependency = groupDependency;
  try {
    if (catalog.rules.definitions.some((definition) => definition.id === groupId))
      throw new Error("Unresolved enemy initial condition group/master identity collision");
    const bound = (table: string, row: BattleRow, expectedId?: number) => {
      const id = int(row.values.id);
      if (!identity(id) || expectedId !== undefined && id !== expectedId || row.source.rowId !== String(id) ||
          !(row.source.assetPath === table || row.source.assetPath.endsWith("/" + table)))
        throw new Error("Changed initial condition source identity: " + table + ":" + id);
      return id;
    };
    const rows = reader.group("condition_group.csv", "group_id", groupId);
    if (!rows.length) throw new Error("Missing enemy initial condition group " + groupId);
    const rowIds = new Set<number>(), ids = new Set<number>(), sources: BattleRow[] = [];
    for (const row of rows) {
      const rowId = bound("condition_group.csv", row);
      dependency = { table: "condition_group.csv", id: rowId };
      if (rowIds.has(rowId) || int(row.values.group_id) !== groupId)
        throw new Error("Changed or duplicate initial condition group row");
      rowIds.add(rowId);
      for (const key of ["type_id", "invocation_rate"])
        if (int(row.values[key]) < -0x80000000 || int(row.values[key]) > 0x7fffffff)
          throw new Error("Invalid initial condition group integer");
      const id = int(row.values.condition_id);
      if (!identity(id)) throw new Error("Invalid initial condition identity");
      dependency = { table: "condition.csv", id };
      const master = reader.row("condition.csv", id);
      bound("condition.csv", master, id);
      const definitions = catalog.rules.definitions.filter((definition) => definition.id === id);
      if (definitions.length !== 1 || definitions[0]!.type !== int(master.values.condition_type) ||
          definitions[0]!.eraseGroupId !== int(master.values.erase_condition_group_id) ||
          ![0, 1].includes(int(master.values.overlapped_type)) ||
          definitions[0]!.overlapped !== (int(master.values.overlapped_type) === 1))
        throw new Error("Initial condition master disagrees with the battle catalog: " + id);
      ids.add(id);
      sources.push(structuredClone(row), structuredClone(master));
    }
    let conditionIds = [...ids];
    const conditions = new BattleConditions(catalog);
    for (const id of conditionIds) {
      dependency = { table: "condition.csv", id };
      conditions.validateActive([id]);
    }
    if (ids.size > 1) {
      dependency = groupDependency;
      if (!reader.ordered) throw new Error("Unresolved multiple enemy initial condition activation order: missing ordered master view");
      const ordered = reader.ordered("condition.csv"), seen = new Set<number>();
      conditionIds = [];
      for (const master of ordered) {
        const id = bound("condition.csv", master);
        if (seen.has(id)) throw new Error("Duplicate ordered condition master");
        seen.add(id);
        if (!ids.has(id)) continue;
        if (JSON.stringify(master) !== JSON.stringify(reader.row("condition.csv", id)))
          throw new Error("Changed ordered condition master binding");
        conditionIds.push(id);
      }
      if (conditionIds.length !== ids.size) throw new Error("Missing ordered condition master membership");
      conditions.validateInitialComposition(conditionIds);
    }
    conditions.validateOwner(conditionIds, "enemy");
    conditions.validateActive(conditionIds);
    if (conditions.isEscaped(conditionIds))
      throw new Error("Source initial Escape component lifecycle is not admitted");
    return { conditionIds, sources };
  } catch (error) {
    throw new InitialConditionCompilationError(error instanceof Error ? error.message : String(error), dependency);
  }
}
