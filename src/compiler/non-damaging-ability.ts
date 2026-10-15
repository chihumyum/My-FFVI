import type { AbilityFunction, AbilityProgram } from "../core/ability.js";
import type { NonDamagingAbilityEffect, NonDamagingAbilityPresentation } from "../core/non-damaging-ability.js";
import { WEB_NON_DAMAGING_PRESENTATION, validateNonDamagingPresentation } from "../core/non-damaging-ability.js";
import type { ConditionReader } from "./conditions.js";
import { tableInteger as int } from "./table.js";

/** Source-family contract, not an ability-ID list. FunctionProvider 3419c0 /
 * 342080 maps Function19 to NonFunction/NonFixedMiss. NonFunction 66b580 calls
 * GetFixedStatus(Hit=0); UpdateParameter is the shared ret body. CreateActFunction
 * 33f780 maps source type35 to NonAct. Other companions, processes, carriers,
 * ranges, Runic/reflect flags and metadata remain independently unresolved.
 * The existing Web action stages defer native VFX, not calculation/continuation. */
export function compileNonDamagingAbility(reader: ConditionReader, program: AbilityProgram, fn: AbilityFunction):
  { effect: NonDamagingAbilityEffect; presentation: NonDamagingAbilityPresentation; sources: ReturnType<ConditionReader["row"]>[] } {
  if (program.functions.length !== 1 || program.functions[0] !== fn || fn.slot !== 1 || fn.type !== 19 ||
      fn.series !== 0 || fn.values.length !== 3 || fn.values.some(v => v !== 0) ||
      program.process.key !== "None" || program.process.values.some(v => v !== 0) ||
      program.range !== 5 || program.rules.type_id !== 35 || program.rules.system_id !== 2 ||
      program.forbiddenConditionIds.length || program.contentFlags.length || program.elements.length)
    throw new Error("Unresolved non-damaging ability composition");
  const ability = reader.row("ability.csv", program.abilityId), group = reader.row("function_group.csv", program.groupId),
    functionRow = reader.row("function.csv", fn.functionId);
  if (int(ability.values.id) !== program.abilityId || int(ability.values.battle_function_group_id) !== program.groupId ||
      int(group.values.id) !== program.groupId || int(group.values.function1_id) !== fn.functionId ||
      fn.values.some((v,n) => int(group.values[`function1_value${n+1}`]) !== v) ||
      int(functionRow.values.type_id) !== 19 || int(functionRow.values.series_id) !== 0)
    throw new Error("Non-damaging ability dispatch differs from its source");
  const exact: Record<string, number> = { ability_lv: 0, standard_value: 0, use_value: 0, ability_wait: 0,
    attribute_id: 0, accuracy_rate: 100, attack_count: 0, Impact_status: 0, invalid_boss: 0,
    invalid_reflection: 1, resistance_attribute: 0, adding_hit_rate: 0, valid_hit_rate: 0, weak_hit_rate: 0,
    reaction_type: 0, condition_group_id: 0, content_flag_group_id: 0, attribute_group_id: 0 };
  for (const [key, value] of Object.entries(exact))
    if (int(ability.values[key]) !== value) throw new Error(`Unresolved non-damaging ability input ${key}`);
  const effectAssetId = int(ability.values.battle_effect_asset_id);
  if (effectAssetId < 0 || effectAssetId > 0x7fffffff) throw new Error("Invalid source ability effect identity");
  const sources = [];
  let sourceEffect: NonDamagingAbilityPresentation["sourceEffect"] = null;
  if (effectAssetId > 0) {
    const row = reader.row("battle_effect_asset.csv", effectAssetId); sources.push(row);
    const v = row.values, soundAssetIds: [number, number, number] =
      [int(v.se_asset_id), int(v.se_asset_id_2), int(v.critical_se_asset_id)];
    for (const id of soundAssetIds) if (id > 0) sources.push(reader.row("se_asset.csv", id));
    sourceEffect = { assetName: v.asset_name!, positionType: int(v.position_type), displayType: int(v.display_type), soundAssetIds };
  }
  const presentation: NonDamagingAbilityPresentation = { kind: WEB_NON_DAMAGING_PRESENTATION, effectAssetId, sourceEffect,
    originalEffect: "deferred", actionClock: "existing-web-action-stages" };
  validateNonDamagingPresentation(presentation);
  return { sources, effect: { kind: "non-damaging", slot: fn.slot, calculation: "fixed-status-hit", parameterUpdate: "none" },
    presentation };
}
