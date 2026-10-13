import { tableInteger } from "./table.js";
import {
  compileConditionGroup,
  hasSilenceBehavior,
  hasUnableFightBehavior,
  hasPoisonBehavior,
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
import { compileTargetRule } from "./battle-targets.js";
import { compileAttackElements } from "./elements.js";
import { compileDefendEffect } from "./defend.js";
import { compileChangeBattleRowEffect } from "./battle-row-change.js";
import { hasProtectionBehavior } from "./protection.js";
import { hasSpeedBehavior } from "./condition-speed.js";
import { hasBlindBehavior } from "./condition-blind.js";
import { compileUserConditionEffect, compileUniqueNoneEffect } from "./ability-user-conditions.js";

type Reader = ConditionReader;
/** SerialBattleUtility 0x85e170; type and ID arrays recovered from 0x85f000.
 * Source-specific classification stays in the compiler, not damage execution. */
export function isSourceNormalAttack(abilityId: number, typeId: number) {
  return (
    [4, 16, 608].includes(typeId) ||
    [
      377, 396, 399, 400, 401, 402, 403, 405, 422, 433, 466, 468, 475, 497, 524,
      550, 585, 619,
    ].includes(abilityId)
  );
}
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

export function compileFunctionGroup(reader: Reader, groupId: number) {
  const sources: ReturnType<Reader["row"]>[] = [];
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
  return { functions, sources };
}

/** Follow all three slots by function.type_id, never by ability/function row ID.
 * Unknown types remain data. Missing/ambiguous references remain hard errors. */
export function compileAbilityProgram(reader: Reader, abilityId: number) {
  const ability = reader.row("ability.csv", abilityId);
  const a = ability.values;
  const groupId = int(a.battle_function_group_id);
  const decoded = compileFunctionGroup(reader, groupId);
  const sources = [ability, ...decoded.sources];
  const functions = decoded.functions;
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
    elements: [],
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
  const elements = compileAttackElements(
    reader,
    int(a.attribute_id),
    program.rules.attribute_group_id!,
  );
  program.elements = elements.elements;
  sources.push(...elements.sources);
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
    "admitted arithmetic and ATB/chanting gates are source-backed; native dynamic semantics and original-game parity remain unverified",
    "fixed 10 ms stepping, 400/900 ms action presentation and UI time-scale/settings remain provisional",
  ];
  const effects: AbilityEffect[] = [];
  const zero = (values: number[]) => values.every((v) => v === 0);
  for (const fn of program.functions) {
    const [v1, v2, v3] = fn.values;
    if (fn.series !== 0) {
      blockers.push(`slot ${fn.slot}: unresolved series ${fn.series}`);
    } else if (fn.type === 15) {
      try {
        effects.push(compileDefendEffect(reader, program).effect);
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error));
      }
    } else if (fn.type === 17) {
      try {
        effects.push(compileChangeBattleRowEffect(reader, program));
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error));
      }
    } else if (fn.type === 38) {
      try {
        const compiled = compileUserConditionEffect(reader, program, fn);
        effects.push(compiled.effect);
        for (const row of compiled.sources)
          if (!sources.some(existing => existing.source.assetPath === row.source.assetPath &&
              existing.source.rowId === row.source.rowId)) sources.push(row);
        // Decode every source site, but only the proven remove path has no
        // additional incoming behavior/guard. The whole action still has to
        // close its companion slots, phase, type, range and primary result.
        if (compiled.effect.operation === "add") blockers.push(
          compiled.effect.conditionType === 501
            ? "unresolved user-condition Manipulate guard"
            : `unresolved user-condition active lifecycle ${compiled.effect.conditionId}`,
        );
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error));
      }
    } else if (fn.type === 2 && zero(fn.values)) {
      effects.push({ slot: fn.slot, kind: "physical" });
    } else if (fn.type === 3 && v1 === 1 && v2 === 0 && v3 === 0) {
      effects.push({ slot: fn.slot, kind: "magic" });
    } else if (
      fn.type === 9 &&
      [0, 1].includes(v2) &&
      v3 === 0 &&
      (hasSilenceBehavior(reader.row("condition.csv", v1)) ||
        hasPoisonBehavior(reader.row("condition.csv", v1)) ||
        hasProtectionBehavior(reader.row("condition.csv", v1)) ||
        hasSpeedBehavior(reader.row("condition.csv", v1)) ||
        hasBlindBehavior(reader.row("condition.csv", v1)))
    ) {
      effects.push({
        slot: fn.slot,
        kind: "add-condition",
        conditionId: v1,
        fixedHit: v2 === 1,
        // AddConditionExecution 0xa91a90: flag 1 skips the evasion calculation;
        // it does not bypass resistance (flag 4 in Function9.Calc 0x4f1d70).
        accuracy: program.contentFlags.includes(1) ? 255 : program.rules.accuracy_rate!,
      });
    } else if (
      fn.type === 11 &&
      v2 === 0 &&
      v3 === 0 &&
      hasUnableFightBehavior(reader.row("condition.csv", v1))
    ) {
      effects.push({
        slot: fn.slot,
        kind: "recover-condition",
        conditionIds: [v1],
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
      if (program.abilityId === 696) {
        try { effects.push(compileUniqueNoneEffect(program, fn)); }
        catch (error) { blockers.push(error instanceof Error ? error.message : String(error)); }
        continue;
      }
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
  const first = effects[0],
    second = effects[1];
  const userRemovalOnly = effects.length === 2 && first?.kind === "unique-none" &&
    first.primaryResult === "empty-dictionary" && second?.kind === "user-condition" &&
    second.operation === "remove" && second.phase === "fixed-parameter" &&
    second.conditionType === 682 && first.slot < second.slot &&
    program.range === 5 && program.rules.type_id === 35 && program.rules.system_id === 2;
  if (effects.some(effect => effect.kind === "user-condition") && !userRemovalOnly)
    blockers.push("unresolved user-condition whole-action stages or primary result");
  const revival =
    effects.length === 2 &&
    first?.kind === "recover-condition" &&
    first.conditionIds.length > 0 &&
    first.conditionIds.every((id) =>
      hasUnableFightBehavior(reader.row("condition.csv", id)),
    ) &&
    second?.kind === "recover-max-hp" &&
    first.slot < second.slot;
  if (effects.some((e) => e.kind === "recover-max-hp") && !revival)
    blockers.push("unresolved HP-ratio recovery composition");
  // More than one healing resource is supported. Other compositions need native
  // hit/death/condition sequencing before they can enter this development profile.
  if (
    effects.length > 1 &&
    !revival &&
    !userRemovalOnly &&
    !effects.every((e) => e.kind === "recovery" && e.calculation === "fixed")
  )
    blockers.push("unresolved multi-effect sequencing");
  let multiplyPercent: number | null = null;
  if (
    program.process.key === "multiply" &&
    effects.length === 1 &&
    effects[0]!.kind === "physical" &&
    program.process.values[0] > 0 &&
    zero(program.process.values.slice(1))
  ) {
    multiplyPercent = program.process.values[0];
  } else if (program.process.key !== "None" || !zero(program.process.values)) {
    blockers.push(
      `unresolved process ${program.process.key}(${program.process.values.join(",")})`,
    );
  }
  const r = program.rules;
  const physicalOnly = effects.length === 1 && effects[0]!.kind === "physical";
  const defendOnly = effects.length === 1 && effects[0]!.kind === "defend";
  const rowOnly = effects.length === 1 && effects[0]!.kind === "change-row";
  const conditionOnly =
    effects.length === 1 &&
    ["add-condition", "recover-condition", "defend"].includes(effects[0]!.kind);
  const protectionOnly = effects.length === 1 && first?.kind === "add-condition" &&
    hasProtectionBehavior(reader.row("condition.csv", first.conditionId));
  const protectionSupport = protectionOnly && r.system_id === 2 && [1, 3].includes(r.type_id!);
  const protectionSpell = protectionSupport && r.type_id === 1;
  const speedOnly = effects.length === 1 && first?.kind === "add-condition" &&
    hasSpeedBehavior(reader.row("condition.csv", first.conditionId));
  const speedSupport = speedOnly && [1, 3].includes(r.type_id!) &&
    r.system_id === (int(reader.row("condition.csv", first.conditionId).values.condition_type) === 15 ? 2 : 5);
  const speedSpell = speedSupport && r.type_id === 1;
  if (speedOnly && !speedSupport)
    blockers.push(`unresolved speed ability type/system ${r.type_id}/${r.system_id}`);
  const magicOnly =
    effects.length === 1 &&
    (effects[0]!.kind === "magic" ||
      (effects[0]!.kind === "recovery" && effects[0]!.calculation === "magic"));
  // Ordinary white/black magic uses the same source Function1/Function3
  // calculators as Magitek. Content flag 3 is the Runic targeting selector
  // (MagicSealSword.ForciblyTarget 0x922500), not a scalar damage flag.
  // Its behavior is admitted only in the host's no-Runic active-state domain.
  const ordinaryMagic = magicOnly && [1, 2].includes(r.type_id!);
  // Lore's ordinary damage uses the same Function3 -> GetMagicStatus ->
  // MagicExecution path. Type 504 controls command/observation eligibility;
  // it does not replace this calculator or grant learning to an actor.
  const loreMagic = magicOnly && effects[0]!.kind === "magic" && r.type_id === 504;
  for (const key of [
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
    !((conditionOnly || magicOnly || physicalOnly) && r.accuracy_rate! >= 0)
  )
    blockers.push(`unresolved accuracy_rate=${r.accuracy_rate}`);
  const allowedFlags = revival
    ? [1, 3]
    : protectionSpell || speedSpell
      ? [1, 3]
    : conditionOnly
      ? []
      : ordinaryMagic
        ? [1, 2, 3, 5]
        : magicOnly || physicalOnly
          ? [1, 2, 5]
          : [1];
  if (program.contentFlags.some((id) => !allowedFlags.includes(id)))
    blockers.push(`unresolved content flags=${program.contentFlags.join(",")}`);
  else if (program.contentFlags.length && !magicOnly && !physicalOnly)
    limitations.push(
      `content flags ${program.contentFlags.join(",")}: opening development restriction`,
    );
  if (!defendOnly && !rowOnly && !userRemovalOnly && !ordinaryMagic && !loreMagic && !protectionSpell && !speedSpell && !(revival ? [1] : [3, 4, 604]).includes(r.type_id!))
    blockers.push(`unresolved ability type ${r.type_id}`);
  if (!defendOnly && !rowOnly && !userRemovalOnly && !protectionSupport && !speedSupport && !(conditionOnly ? [1, 5] : [1, 3]).includes(r.system_id!))
    blockers.push(`unresolved ability system ${r.system_id}`);
  if ((ordinaryMagic || loreMagic || protectionSpell || speedSpell) && int(a.ability_lv) !== 0)
    blockers.push("unresolved level-specific ability consumption");
  if (abilityId === 154)
    blockers.push("unresolved play-time ability cost provider");
  // CalcControllerProvider.GetMagicDamage 0x3d8de0 suppresses group damage
  // correction for this .cctor array (0x3db330) and type 623. The scalar host
  // currently represents that same positive-damage branch only via flag 2.
  // Real ability 59 already carries it; do not invent a flag for other rows.
  if (magicOnly &&
      ([59, 360, 1312, 1330].includes(abilityId) || r.type_id === 623) &&
      !program.contentFlags.includes(2))
    blockers.push("unresolved all-target magic correction provider");
  if ((ordinaryMagic || protectionSpell || speedSpell) && program.contentFlags.includes(3))
    limitations.push("source flag 3 is Runic targeting; active Runic behavior must remain blocked by the host");
  if (![0, 1].includes(r.reaction_type!))
    blockers.push(`unresolved reaction_type=${r.reaction_type}`);
  if (![0, 1].includes(r.invalid_reflection!))
    blockers.push("invalid reflection selector");
  if (r.invalid_reflection === 0)
    limitations.push(
      "reflection unavailable: no-reflect development state required",
    );
  const targeting = compileTargetRule(program.range, r.system_id!);
  if (
    targeting &&
    (revival ||
      (effects.length === 1 &&
        first?.kind === "recover-condition" &&
        first.conditionIds.length > 0 &&
        first.conditionIds.every((id) =>
          hasUnableFightBehavior(reader.row("condition.csv", id)),
        )))
  )
    targeting.life = "include-fallen-players";
  if (!targeting) blockers.push(`unresolved battle range ${program.range}`);
  if (targeting?.normalFormationOnly)
    limitations.push(
      "selectable side scope requires normal formation; position groups remain blocked",
    );
  const power = int(a.standard_value),
    cost = int(a.use_value),
    wait = int(a.ability_wait),
    attribute = int(a.attribute_id);
  if ([power, cost, wait, attribute].some((v) => v < 0))
    blockers.push("negative ability value");
  if (userRemovalOnly && ([power, cost, wait, attribute].some(value => value !== 0) ||
      r.accuracy_rate !== 100 || r.invalid_reflection !== 1 ||
      r.reaction_type !== 0 || program.forbiddenConditionIds.length || program.elements.length))
    blockers.push("unresolved user-condition removal action inputs");
  const elements = program.elements;
  if (r.attribute_group_id && elements.length > 1)
    blockers.push("unreviewed source element group enumeration");
  if (!magicOnly && (attribute || r.attribute_group_id))
    blockers.push("unresolved non-magic element carrier");
  if (elements.length > 8) blockers.push("unreviewed magic element count");
  limitations.push(
    "only admitted active battle behaviors with their required hosts; poison row 88 and other unknown providers remain blocked; MP-cost equipment needs an owned source loadout; weapon-added actions, undead and Runic remain unsupported",
  );
  if (physicalOnly)
    limitations.push(
      "front rows, selected single arm; Defend and ordinary Protect only; other species, physical status/accessory/weapon modifiers remain unsupported",
    );
  if (conditionOnly && attribute !== 0)
    blockers.push("unresolved condition attribute");
  if ((conditionOnly || revival) && [290, 680, 681, 1333].includes(abilityId))
    blockers.push("unresolved native condition ability override");
  if (revival)
    limitations.push(
      "player revival only; enemy revival AI/rewards, items and summon execution remain unresolved",
    );
  if (magicOnly)
    limitations.push(
      "reviewed magic and elemental arithmetic; no accessory, critical, counter-stat or weapon modifiers",
    );
  const plan: DevelopmentAbilityPlan | null = blockers.length
    ? null
    : {
        effects,
        targeting: targeting!,
        physical: physicalOnly
          ? {
              normalAttack: isSourceNormalAttack(abilityId, r.type_id!),
              multiplyPercent,
              contentFlags: [...program.contentFlags],
            }
          : null,
        magic: magicOnly
          ? {
              accuracy: r.accuracy_rate!,
              contentFlags: program.contentFlags.filter((flag) => !ordinaryMagic || flag !== 3),
              elements,
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
      : rowOnly
        ? "row"
      : revival
        ? "heal"
        : conditionOnly
          ? "condition"
          : effects.every((e) => e.kind === "recovery")
            ? "heal"
            : effects[0]!.kind === "physical"
              ? "physical"
              : "beam",
  };
}
