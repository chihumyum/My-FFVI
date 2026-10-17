import type { AbilityProgram } from "../core/ability.js";
import type { ChangeBattleRowEffect } from "../core/battle-row-change.js";
import type { ConditionReader } from "./conditions.js";
import { tableInteger as int } from "./table.js";

/** Current build's ordinary self Change Row shape. Function17's multi-target
 * Corps branch, copied actions and other ability types are not inferred from
 * its name. Source command5/ability4 currently provide this exact shape. */
export function compileChangeBattleRowEffect(
  reader: ConditionReader,
  program: AbilityProgram,
): ChangeBattleRowEffect {
  const fn = program.functions[0];
  const rules: Record<string, number> = {
    type_id: 7, system_id: 2, accuracy_rate: 100, invalid_reflection: 1,
    condition_group_id: 0, content_flag_group_id: 0, attribute_group_id: 0,
    attack_count: 0, Impact_status: 0, invalid_boss: 0, resistance_attribute: 0,
    adding_hit_rate: 0, valid_hit_rate: 0, weak_hit_rate: 0, reaction_type: 0,
  };
  if (program.functions.length !== 1 || !fn || fn.type !== 17 || fn.series !== 0 ||
      fn.slot !== 1 || fn.values.some((value) => value !== 0) ||
      program.range !== 5 || program.process.key !== "None" ||
      program.process.values.some((value) => value !== 0) ||
      program.forbiddenConditionIds.length || program.contentFlags.length || program.elements.length ||
      Object.entries(rules).some(([key, value]) => program.rules[key] !== value))
    throw new Error("Unresolved Change Row action semantics");
  const ability = reader.row("ability.csv", program.abilityId).values;
  if (["standard_value", "use_value", "attribute_id"].some((key) => int(ability[key]) !== 0) ||
      int(ability.ability_wait) !== 3)
    throw new Error("Unresolved Change Row resource or waiting provider");
  return { kind: "change-row", slot: fn.slot };
}
