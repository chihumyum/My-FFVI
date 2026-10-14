import type { AbilityProgram } from "../core/ability.js";
import type { BattleDerivedActionPlan, RandomAbilityDispatchPlan } from "../core/battle-derived-actions.js";
import { validateRandomAbilityDispatch, validateForcedEscapeDispatch } from "../core/battle-derived-actions.js";
import type { ConditionReader } from "./conditions.js";
import { compileConditionGroup } from "./conditions.js";
import { tableInteger } from "./table.js";

function int(value: string | undefined) {
  const number = tableInteger(value);
  if (number < -0x80000000 || number > 0x7fffffff) throw new Error("Derived-action integer outside int32");
  return number;
}
function boundRow(row: ReturnType<ConditionReader["row"]>) {
  if (row.source.rowId !== row.values.id) throw new Error("Derived-action row identity mismatch");
  return row;
}

/** Complete metadata binding is separate from runtime child admission. No
 * ability-ID exception selects an implementation. Unsupported compositions,
 * fallback and conditional lottery consumers retain their source blockers. */
export function compileBattleDerivedAction(reader: ConditionReader, program: AbilityProgram): {
  dispatch: BattleDerivedActionPlan | null;
  blockers: string[];
  sources: ReturnType<ConditionReader["row"]>[];
} {
  const blockers: string[] = [], sources: ReturnType<ConditionReader["row"]>[] = [];
  const functions = program.functions.filter(fn => fn.type === 16 || fn.type === 46);
  if (!functions.length) return { dispatch: null, blockers, sources };
  if (program.functions.length !== 1 || functions.length !== 1) return {
    dispatch: null, blockers: ["unresolved derived-action function composition"], sources,
  };
  const fn = functions[0]!;
  if (fn.series !== 0 || ![1, 2, 3].includes(fn.slot) || fn.values.length !== 3 ||
      fn.values.some(value => !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff))
    return { dispatch: null, blockers: ["unresolved derived-action operands"], sources };
  const ability = boundRow(reader.row("ability.csv", program.abilityId));
  const group = boundRow(reader.row("function_group.csv", program.groupId));
  const functionRow = boundRow(reader.row("function.csv", fn.functionId));
  sources.push(ability, group, functionRow);
  if (int(ability.values.id) !== program.abilityId || int(ability.values.battle_function_group_id) !== program.groupId ||
      int(group.values.id) !== program.groupId || int(group.values[`function${fn.slot}_id`]) !== fn.functionId ||
      fn.values.some((value, n) => int(group.values[`function${fn.slot}_value${n + 1}`]) !== value) ||
      int(functionRow.values.type_id) !== fn.type || int(functionRow.values.series_id) !== fn.series ||
      program.range !== int(ability.values.battle_renge_id) ||
      ["type_id", "system_id"].some(key => program.rules[key] !== int(ability.values[key])))
    throw new Error("Derived-action dispatch differs from its source");
  for (let slot = 1; slot <= 3; slot++) {
    if (slot !== fn.slot && ["id", "value1", "value2", "value3"].some(key =>
      int(group.values[`function${slot}_${key}`]) !== 0))
      throw new Error("Derived-action source has an omitted companion slot");
  }
  if (fn.type === 46) {
    const [groupId, fallbackAbilityId, retarget] = fn.values;
    if (groupId <= 0 || fallbackAbilityId < 0 || ![0, 1].includes(retarget)) return {
      dispatch: null, blockers: ["unresolved random-ability function operands"], sources,
    };
    const rows = reader.group("ability_random_group.csv", "group_id", groupId);
    const decoded: RandomAbilityDispatchPlan["rows"] = [];
    for (const raw of rows) {
      const row = boundRow(raw), abilityId = int(row.values.ability_id);
      if (int(row.values.group_id) !== groupId || abilityId <= 0)
        throw new Error("Random-ability source group/reference mismatch");
      sources.push(row, boundRow(reader.row("ability.csv", abilityId)));
      const conditionGroupId = int(row.values.condition_group_id);
      if (conditionGroupId < 0) throw new Error("Invalid random-ability condition group");
      const conditions = conditionGroupId === 0 ? { ids: [], sources: [] } : compileConditionGroup(reader, conditionGroupId);
      sources.push(...conditions.sources, ...conditions.ids.map(id => boundRow(reader.row("condition.csv", id))));
      decoded.push({ rowId: int(row.values.id), abilityId,
        invocationRate: int(row.values.invocation_rate), conditionGroupId, conditionIds: [...conditions.ids] });
    }
    if (fallbackAbilityId > 0) {
      sources.push(boundRow(reader.row("ability.csv", fallbackAbilityId)));
      blockers.push("unresolved random-ability fallback dispatch");
    }
    if (decoded.some(row => row.conditionGroupId !== 0)) blockers.push("unresolved random-ability condition-group selection");
    const dispatch: RandomAbilityDispatchPlan = { kind: "random-ability", slot: fn.slot,
      rawValues: [groupId, fallbackAbilityId, retarget as 0 | 1], groupId, fallbackAbilityId,
      retarget: retarget === 1, rows: decoded, primaryResult: { hitType: 0, value: 0 },
      child: { actType: 5, useType: 1, commandId: null, armType: 0,
        actAbilityType: 0, continuousCommandCount: 1, isCounter: false } };
    validateRandomAbilityDispatch(dispatch);
    return { dispatch, blockers, sources };
  }
  if (fn.values[0] !== 2 || fn.values[1] !== 0 || fn.values[2] !== 0 ||
      program.range !== 5 || program.rules.type_id !== 13 || program.rules.system_id !== 2 ||
      program.contentFlags.length !== 1 || program.contentFlags[0] !== 1)
    return { dispatch: null, blockers: ["unresolved forced-escape function or actor domain"], sources };
  const conditions = reader.group("condition.csv", "condition_type", 3);
  if (conditions.length !== 1) throw new Error("Missing or ambiguous Escape condition master");
  const condition = boundRow(conditions[0]!);
  sources.push(condition);
  const dispatch: BattleDerivedActionPlan = { kind: "forced-escape", slot: fn.slot,
    rawValues: [2, 0, 0], actorDomain: "enemy", target: "self",
    conditionId: int(condition.values.id), conditionType: 3, primaryResult: { hitType: 0, value: 0 } };
  validateForcedEscapeDispatch(dispatch);
  return { dispatch, blockers, sources };
}
