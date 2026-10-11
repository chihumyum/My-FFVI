import { compileFunctionGroup } from "./ability.js";
import {
  compileConditionGroup,
  hasUnableFightBehavior,
  type ConditionReader,
} from "./conditions.js";
import { compileTargetRule } from "./battle-targets.js";
import { tableInteger as int } from "./table.js";
import type { ItemDefinition, ItemUse } from "../core/items.js";
import type { AbilityEffect } from "../core/ability.js";

/** Ordinary, guaranteed-consumption recovery. Decode BOTH contexts
 * completely; a menu plan is never borrowed for a battle (or conversely). */
export function compileItem(
  reader: ConditionReader,
  contentId: number,
  name: string,
) {
  const content = reader.row("content.csv", contentId);
  if (int(content.values.type_id) !== 1)
    throw new Error("Not an item content identity");
  const item = reader.row("item.csv", int(content.values.type_value)),
    v = item.values;
  const forbidden = compileConditionGroup(reader, int(v.condition_group_id));
  const sources = [
    content,
    item,
    ...forbidden.sources,
    ...forbidden.ids.map((id) => reader.row("condition.csv", id)),
  ];
  const common: string[] = [];
  const expect = (key: string, value: number) => {
    if (int(v[key]) !== value)
      common.push(`unimplemented item ${key}=${v[key]}`);
  };
  for (const key of [
    "attribute_id",
    "period_id",
    "throw_flag",
    "preparation_flag",
    "drink_flag",
    "machine_flag",
  ])
    expect(key, 0);
  for (const key of ["type_id", "system_id", "invalid_reflection"])
    expect(key, 1);
  expect("accuracy_rate", 100);
  expect("destroy_rate", 100);
  const power = int(v.standard_value);
  if (power < 0 || power > 0x7fffffff) common.push("unimplemented item power");
  const use = (context: "menu" | "battle"): ItemUse => {
    const groupId = int(v[`${context}_function_group_id`]);
    const range = int(v[`${context}_renge_id`]);
    const decoded = compileFunctionGroup(reader, groupId);
    sources.push(...decoded.sources);
    const blockers = [...common],
      effects: AbilityEffect[] = [];
    for (const fn of decoded.functions) {
      const [v1, v2, v3] = fn.values;
      if (fn.series !== 0) {
        blockers.push(
          `slot ${fn.slot}: unimplemented item series ${fn.series}`,
        );
      } else if (fn.type === 1 && v1 === 1 && [2, 3].includes(v2) && v3 === 0) {
        if (power === 0)
          blockers.push("fixed recovery requires positive power");
        effects.push({
          slot: fn.slot,
          kind: "recovery",
          resource: v2 === 2 ? "hp" : "mp",
          calculation: "fixed",
        });
      } else if ([11, 12].includes(fn.type) && v2 === 0 && v3 === 0) {
        const recovery =
          fn.type === 12
            ? compileConditionGroup(reader, v1)
            : { ids: [v1], sources: [] };
        sources.push(
          ...recovery.sources,
          ...recovery.ids.map((id) => reader.row("condition.csv", id)),
        );
        if (!recovery.ids.length)
          blockers.push("empty recovery condition group");
        effects.push({
          slot: fn.slot,
          kind: "recover-condition",
          conditionIds: recovery.ids,
        });
      } else if (
        fn.type === 34 &&
        v1 === 2 &&
        [4, 5].includes(v2) &&
        v3 > 0 &&
        (v2 !== 4 || v3 <= 100)
      ) {
        effects.push({
          slot: fn.slot,
          kind: "recover-max-hp",
          mode: v2 === 4 ? "percent" : "divide",
          value: v3,
        });
      } else {
        blockers.push(
          `slot ${fn.slot}: unimplemented item function ${fn.type} (${fn.values})`,
        );
      }
    }
    if (!effects.length) blockers.push("no admitted item effect");
    const [first, second] = effects;
    const deathRecovery =
      first?.kind === "recover-condition" &&
      first.conditionIds.length > 0 &&
      first.conditionIds.every((id) =>
        hasUnableFightBehavior(reader.row("condition.csv", id)),
      );
    const revival =
      effects.length === 2 &&
      deathRecovery &&
      second?.kind === "recover-max-hp" &&
      first.slot < second.slot;
    if (!(
      revival ||
      (effects.length === 1 && first?.kind === "recover-condition") ||
      effects.every((e) => e.kind === "recovery" && e.calculation === "fixed")
    ))
      blockers.push("unimplemented item effect composition");
    const targeting = compileTargetRule(range, int(v.system_id));
    if (targeting && deathRecovery && (revival || effects.length === 1))
      targeting.life = "include-fallen-players";
    if (!targeting || (context === "menu" && ![1, 7].includes(range)))
      blockers.push(`unimplemented ${context} item target range ${range}`);
    return {
      program: { groupId, range, functions: decoded.functions },
      plan: blockers.length
        ? null
        : { effects, targeting: targeting!, physical: null, magic: null },
      blockers,
    };
  };
  const definition: ItemDefinition = {
    id: int(content.values.id),
    itemId: int(v.id),
    name,
    important: int(v.type_id) === 2,
    power,
    systemId: int(v.system_id),
    forbiddenConditionIds: forbidden.ids,
    uses: { menu: use("menu"), battle: use("battle") },
  };
  return { definition, sources };
}
