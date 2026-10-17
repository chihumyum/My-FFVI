import type { AbilityFunction, AbilityProgram } from "../core/ability.js";
import type { UserConditionEffect, UniqueNoneEffect } from "../core/ability-user-conditions.js";
import { validateUserConditionEffect } from "../core/ability-user-conditions.js";
import type { ConditionReader } from "./conditions.js";
import { tableInteger as int } from "./table.js";

/** Decode all source Function38 sites without granting their companion slots,
 * target ranges, Manipulate guard or active-condition lifecycle. */
export function compileUserConditionEffect(
  reader: ConditionReader, program: AbilityProgram, fn: AbilityFunction,
) {
  if (fn.type !== 38 || fn.series !== 0 || ![1, 2, 3].includes(fn.slot) ||
      fn.values.length !== 3 || fn.values[0] <= 0 ||
      ![0, 1].includes(fn.values[1]) || ![0, 1].includes(fn.values[2]) ||
      program.functions.filter(f => f.slot === fn.slot).length !== 1 ||
      !program.functions.some(f => f.slot === fn.slot && f.functionId === fn.functionId &&
        f.type === fn.type && f.series === fn.series && f.values.every((v, n) => v === fn.values[n])))
    throw new Error("Unresolved user-condition function operands");
  const ability = reader.row("ability.csv", program.abilityId);
  const group = reader.row("function_group.csv", program.groupId);
  const functionRow = reader.row("function.csv", fn.functionId);
  const condition = reader.row("condition.csv", fn.values[0]);
  const rows = [ability, group, functionRow, condition];
  if (rows.some(row => row.source.rowId !== row.values.id) ||
      int(ability.values.id) !== program.abilityId ||
      int(ability.values.battle_function_group_id) !== program.groupId ||
      int(group.values.id) !== program.groupId ||
      int(group.values[`function${fn.slot}_id`]) !== fn.functionId ||
      fn.values.some((v, n) => int(group.values[`function${fn.slot}_value${n + 1}`]) !== v) ||
      int(functionRow.values.id) !== fn.functionId || int(functionRow.values.type_id) !== 38 ||
      int(functionRow.values.series_id) !== 0 || int(condition.values.id) !== fn.values[0])
    throw new Error("User-condition dispatch differs from its source");
  const effect: UserConditionEffect = {
    kind: "user-condition", slot: fn.slot, conditionId: fn.values[0],
    conditionType: int(condition.values.condition_type),
    phase: fn.values[1] === 0 ? "fixed-parameter" : "update-parameter",
    operation: fn.values[2] === 0 ? "add" : "remove",
    rawValues: [fn.values[0], fn.values[1] as 0 | 1, fn.values[2] as 0 | 1],
  };
  validateUserConditionEffect(effect);
  return { effect, sources: rows };
}

/** BattleFunction23.HitCalc 97c4a0 preserves one explicit FF6 exception:
 * serial6 + source ability696/group557 + empty provider dictionary skips
 * Basic.HitCalc. SerialBattleUtilityBase 4cafa0 returns that dictionary as-is.
 * Core consumes the resulting typed fact and never branches on ability IDs.
 * Other None paths need their own complete Basic calculation contract. */
export function compileUniqueNoneEffect(program: AbilityProgram, fn: AbilityFunction): UniqueNoneEffect {
  if (program.abilityId !== 696 || program.groupId !== 557 ||
      fn.slot !== 1 || fn.type !== 23 || fn.series !== 0 ||
      fn.values.length !== 3 || fn.values.some(value => value !== 0) ||
      program.functions.filter(f => f.slot === 1).length !== 1 ||
      !program.functions.some(f => f.slot === 1 && f.functionId === fn.functionId &&
        f.type === 23 && f.series === 0 && f.values.length === 3 && f.values.every(v => v === 0)) ||
      program.process.key !== "None" ||
      program.process.values.some(value => value !== 0))
    throw new Error("Unresolved Unique None primary calculation");
  return { kind: "unique-none", slot: fn.slot, primaryResult: "empty-dictionary" };
}
