import type { AbilityProgram } from "../core/ability.js";
import type { DefendCatalog, DefendEffect } from "../core/defend.js";
import type { BattleRow } from "./battle.js";
import type { ConditionReader } from "./conditions.js";
import { tableInteger as int } from "./table.js";

/** DefendConditionFunction changes the idle state; it is system type 4, not a
 * passive type-1 condition. Numerical damage handling is in PhysicalExecution. */
export function hasDefendBehavior(row: Pick<BattleRow, "values">): boolean {
  const v = row.values;
  return int(v.condition_type) === 1 && int(v.system_type) === 4 &&
    int(v.until_type) === 1 && int(v.resistance_decision) === 1 &&
    ["until_value", "overlapped_type", "invalid_type", "target_type",
      "condition_group_id", "parameter_group_id", "attribute_group_id",
      "species_group_id", "rate_type1", "rate_type2", "rate_value1", "rate_value2",
      "recovery_invalid", "attack_target", "game_over_target", "state_cover_unavailable",
      "damage_number", "battle_effect_asset_id", "battle_effect_shadow_cloning",
      "field_se_asset_id", "icon_id"].every((key) => int(v[key]) === 0);
}

/** The function's FirstOrDefault predicate reads ConditionType == 1. Refuse
 * ambiguous master order rather than silently select a second Defend record. */
export function compileDefendCatalog(reader: ConditionReader): {
  catalog: DefendCatalog; sources: BattleRow[];
} {
  const matches = reader.group("condition.csv", "condition_type", 1);
  if (matches.length !== 1 || !hasDefendBehavior(matches[0]!))
    throw new Error("Unresolved Defend condition provider");
  const row = matches[0]!;
  const id = int(row.values.id);
  if (id <= 0) throw new Error("Invalid Defend condition identity");
  const erase = reader.group("erase_condition_group.csv", "group_id", int(row.values.erase_condition_group_id));
  if (!erase.length) throw new Error("Unresolved Defend condition conflict rules");
  return { catalog: { conditionId: id, conditionType: 1, untilType: 1 },
    sources: [row, ...erase] };
}

/** Source-backed narrow action admission. Dispatch is by function type 15,
 * not by the familiar command/ability ID. Unreviewed composition is an error
 * for the caller to preserve as an action blocker. */
export function compileDefendEffect(reader: ConditionReader, program: AbilityProgram): {
  effect: DefendEffect; catalog: DefendCatalog; sources: BattleRow[];
} {
  const fn = program.functions[0];
  const rules: Record<string, number> = {
    type_id: 5, system_id: 2, accuracy_rate: 100, invalid_reflection: 1,
    condition_group_id: 0, content_flag_group_id: 0, attribute_group_id: 0,
    attack_count: 0, Impact_status: 0, invalid_boss: 0, resistance_attribute: 0,
    adding_hit_rate: 0, valid_hit_rate: 0, weak_hit_rate: 0, reaction_type: 0,
  };
  if (program.functions.length !== 1 || !fn || fn.type !== 15 || fn.series !== 0 ||
      fn.slot !== 1 || fn.values.some((value) => value !== 0) ||
      program.range !== 5 || program.process.key !== "None" ||
      program.process.values.some((value) => value !== 0) ||
      program.forbiddenConditionIds.length || program.contentFlags.length || program.elements.length ||
      Object.entries(rules).some(([key, value]) => program.rules[key] !== value))
    throw new Error("Unresolved Defend action semantics");
  const ability = reader.row("ability.csv", program.abilityId);
  if (["standard_value", "use_value", "ability_wait", "attribute_id"].some((key) => int(ability.values[key]) !== 0))
    throw new Error("Unresolved Defend resource or attribute provider");
  const group = reader.row("function_group.csv", program.groupId);
  const sourceFunction = reader.row("function.csv", fn.functionId);
  if (int(sourceFunction.values.type_id) !== 15 || int(sourceFunction.values.series_id) !== 0)
    throw new Error("Defend function dispatch differs from its source");
  const { catalog, sources } = compileDefendCatalog(reader);
  return { effect: { kind: "defend", slot: fn.slot, conditionId: catalog.conditionId },
    catalog, sources: [ability, group, sourceFunction, ...sources] };
}
