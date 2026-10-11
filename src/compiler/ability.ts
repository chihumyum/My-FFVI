import { tableInteger } from "./table.js";
import {
  compileConditionGroup,
  hasSilenceBehavior,
  type ConditionReader,
} from "./conditions.js";
import type {
  AbilityProgram,
  AbilityFunction,
  AbilityEffect,
  DevelopmentAbilityPlan,
} from "../core/ability.js";
import type { AbilityDefinition } from "../core/battle-content.js";
import { compileContentFlags } from "./content-flags.js";

type Reader = ConditionReader;
function int(value: string | undefined) {
  const parsed = tableInteger(value);
  if (parsed < -2147483648 || parsed > 2147483647)
    throw new Error(`Ability integer outside native int32: ${value}`);
  return parsed;
}
const ruleColumns = [
  "type_id",
  "system_id",
  "accuracy_rate",
  "condition_group_id",
  "content_flag_group_id",
  "attribute_group_id",
  "attack_count",
  "Impact_status",
  "invalid_boss",
  "invalid_reflection",
  "resistance_attribute",
  "adding_hit_rate",
  "valid_hit_rate",
  "weak_hit_rate",
  "reaction_type",
] as const;

/** Follow all three slots by function.type_id, never by ability/function row ID.
 * Unknown types remain data. Missing/ambiguous references remain hard errors. */
export function compileAbilityProgram(reader: Reader, abilityId: number) {
  const ability = reader.row("ability.csv", abilityId);
  const a = ability.values;
  const groupId = int(a.battle_function_group_id);
  const sources = [ability];
  const functions: AbilityFunction[] = [];
  if (groupId !== 0) {
    const group = reader.row("function_group.csv", groupId);
    sources.push(group);
    for (let slot = 1; slot <= 3; slot++) {
      const functionId = int(group.values[`function${slot}_id`]);
      const values = [1, 2, 3].map((n) =>
        int(group.values[`function${slot}_value${n}`]),
      ) as [number, number, number];
      if (functionId === 0) {
        if (values.some(Boolean))
          throw new Error(
            `Orphan function values: group ${groupId}, slot ${slot}`,
          );
        continue;
      }
      if (functionId < 0)
        throw new Error("Negative ability function reference");
      const fn = reader.row("function.csv", functionId);
      sources.push(fn);
      functions.push({
        slot,
        functionId,
        values,
        type: int(fn.values.type_id),
        series: int(fn.values.series_id),
      });
    }
  }
  if (!a.process_prog) throw new Error("Missing ability process key");
  const program: AbilityProgram = {
    abilityId,
    groupId,
    functions,
    process: {
      key: a.process_prog,
      values: [int(a.data_a), int(a.data_b), int(a.data_c)],
    },
    range: int(a.battle_renge_id),
    rules: Object.fromEntries(ruleColumns.map((key) => [key, int(a[key])])),
    forbiddenConditionIds: [],
    contentFlags: [],
  };
  const forbidden = compileConditionGroup(
    reader,
    program.rules.condition_group_id!,
  );
  program.forbiddenConditionIds = forbidden.ids;
  sources.push(
    ...forbidden.sources,
    ...forbidden.ids.map((id) => reader.row("condition.csv", id)),
  );
  const flags = compileContentFlags(
    reader,
    program.rules.content_flag_group_id!,
  );
  program.contentFlags = flags.ids;
  sources.push(...flags.sources);
  return { program, sources };
}

/** Admission for the existing development battle, NOT full-game support.
 * Every function and every nontrivial battle rule is either admitted explicitly
 * below, recorded as a provisional dependency, or blocks the entire action. */
export function compileDevelopmentAbility(
  reader: Reader,
  abilityId: number,
  name: string,
): AbilityDefinition {
  const { program, sources } = compileAbilityProgram(reader, abilityId);
  const a = sources[0]!.values;
  const blockers: string[] = [];
  const limitations = [
    "development formulas/targeting/scheduling; no original-game parity",
  ];
  const effects: AbilityEffect[] = [];
  const zero = (values: number[]) => values.every((v) => v === 0);
  for (const fn of program.functions) {
    const [v1, v2, v3] = fn.values;
    if (fn.series !== 0) {
      blockers.push(`slot ${fn.slot}: unresolved series ${fn.series}`);
    } else if (fn.type === 2 && zero(fn.values)) {
      effects.push({ slot: fn.slot, kind: "physical" });
    } else if (fn.type === 3 && v1 === 1 && v2 === 0 && v3 === 0) {
      effects.push({ slot: fn.slot, kind: "magic" });
    } else if (
      fn.type === 9 &&
      [0, 1].includes(v2) &&
      v3 === 0 &&
      hasSilenceBehavior(reader.row("condition.csv", v1))
    ) {
      effects.push({
        slot: fn.slot,
        kind: "add-condition",
        conditionId: v1,
        fixedHit: v2 === 1,
        accuracy: program.rules.accuracy_rate!,
      });
    } else if (fn.type === 12 && v2 === 0 && v3 === 0) {
      const group = compileConditionGroup(reader, v1);
      if (!group.ids.length) blockers.push("empty recovery condition group");
      effects.push({
        slot: fn.slot,
        kind: "recover-condition",
        conditionIds: group.ids,
      });
    } else if (
      fn.type === 1 &&
      [1, 2].includes(v1) &&
      [2, 3].includes(v2) &&
      v3 === 0
    ) {
      effects.push({
        slot: fn.slot,
        kind: "recovery",
        resource: v2 === 2 ? "hp" : "mp",
        calculation: v1 === 1 ? "fixed" : "magic",
      });
    } else if (
      fn.type === 23 &&
      zero(fn.values) &&
      ["None", "multiply"].includes(program.process.key)
    ) {
      // FF6 Unique provider has no numeric branch for these two keys, for an
      // ability without an item/equipment carrier. multiply belongs to damage.
      limitations.push(
        `slot ${fn.slot}: Unique ${program.process.key}; targeting and presentation remain provisional`,
      );
    } else {
      blockers.push(
        `slot ${fn.slot}: unsupported function type ${fn.type} values ${fn.values.join(",")}`,
      );
    }
  }
  if (!effects.length) blockers.push("no implemented effect");
  // More than one healing resource is supported. Other compositions need native
  // hit/death/condition sequencing before they can enter this development profile.
  if (
    effects.length > 1 &&
    !effects.every((e) => e.kind === "recovery" && e.calculation === "fixed")
  )
    blockers.push("unresolved multi-effect sequencing");
  let multiplier = 1;
  if (
    program.process.key === "multiply" &&
    effects.length === 1 &&
    effects[0]!.kind === "physical" &&
    program.process.values[0] > 0 &&
    zero(program.process.values.slice(1))
  ) {
    multiplier = program.process.values[0] / 100;
    limitations.push("physical multiply order remains provisional");
  } else if (program.process.key !== "None" || !zero(program.process.values)) {
    blockers.push(
      `unresolved process ${program.process.key}(${program.process.values.join(",")})`,
    );
  }
  const r = program.rules;
  const conditionOnly =
    effects.length === 1 &&
    ["add-condition", "recover-condition"].includes(effects[0]!.kind);
  const magicOnly =
    effects.length === 1 &&
    (effects[0]!.kind === "magic" ||
      (effects[0]!.kind === "recovery" && effects[0]!.calculation === "magic"));
  for (const key of [
    "attribute_group_id",
    "attack_count",
    "Impact_status",
    "invalid_boss",
    "resistance_attribute",
    "adding_hit_rate",
    "valid_hit_rate",
    "weak_hit_rate",
  ])
    if (r[key] !== 0) blockers.push(`unresolved ${key}=${r[key]}`);
  if (
    r.accuracy_rate !== 100 &&
    !((conditionOnly || magicOnly) && r.accuracy_rate! >= 0)
  )
    blockers.push(`unresolved accuracy_rate=${r.accuracy_rate}`);
  const allowedFlags = conditionOnly ? [] : magicOnly ? [1, 2, 5] : [1];
  if (program.contentFlags.some((id) => !allowedFlags.includes(id)))
    blockers.push(`unresolved content flags=${program.contentFlags.join(",")}`);
  else if (program.contentFlags.length && !magicOnly)
    limitations.push(
      `content flags ${program.contentFlags.join(",")}: opening development restriction`,
    );
  if (![3, 4, 604].includes(r.type_id!))
    blockers.push(`unresolved ability type ${r.type_id}`);
  if (!(conditionOnly ? [1, 5] : [1, 3]).includes(r.system_id!))
    blockers.push(`unresolved ability system ${r.system_id}`);
  if (![0, 1].includes(r.reaction_type!))
    blockers.push(`unresolved reaction_type=${r.reaction_type}`);
  if (![0, 1].includes(r.invalid_reflection!))
    blockers.push("invalid reflection selector");
  if (r.invalid_reflection === 0)
    limitations.push(
      "reflection unavailable: no-reflect development state required",
    );
  const target = ({ 1: "ally", 3: "enemy", 5: "self", 7: "either" } as const)[
    program.range as 1 | 3 | 5 | 7
  ];
  if (!target) blockers.push(`unresolved battle range ${program.range}`);
  const power = int(a.standard_value),
    cost = int(a.use_value),
    wait = int(a.ability_wait),
    attribute = int(a.attribute_id);
  if ([power, cost, wait, attribute].some((v) => v < 0))
    blockers.push("negative ability value");
  if (attribute)
    limitations.push(
      `attribute ${attribute}: neutral-affinity development state required`,
    );
  limitations.push(
    "only admitted silence behavior; no equipment-added functions, undead or Runic overrides",
  );
  if (conditionOnly && attribute !== 0)
    blockers.push("unresolved condition attribute");
  if (conditionOnly && [290, 680, 681, 1333].includes(abilityId))
    blockers.push("unresolved native condition ability override");
  if (magicOnly)
    limitations.push(
      "reviewed neutral magic arithmetic; no accessory, critical, counter-stat or weapon modifiers; single-target action only",
    );
  const plan: DevelopmentAbilityPlan | null = blockers.length
    ? null
    : {
        effects,
        target: target!,
        multiplier,
        magic: magicOnly
          ? {
              accuracy: r.accuracy_rate!,
              contentFlags: [...program.contentFlags],
              // GetRecoveryStatus 0x3d9af0 supplies this source-specific override.
              forceDefense:
                effects[0]!.kind === "recovery" && abilityId === 210,
            }
          : null,
      };
  return {
    id: abilityId,
    name,
    program,
    plan,
    blockers,
    limitations,
    power,
    cost,
    wait,
    attribute,
    presentation: !plan
      ? "unsupported"
      : conditionOnly
        ? "condition"
        : effects.every((e) => e.kind === "recovery")
          ? "heal"
          : effects[0]!.kind === "physical"
            ? "physical"
            : "beam",
  };
}
