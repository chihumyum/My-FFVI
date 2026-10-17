import type { AbilityEffect, AbilityProgram } from "../core/ability.js";
import { validateControlBehavior, type ControlConditionBehavior } from "../core/condition-control.js";
import type { ConditionDefinition } from "../core/conditions.js";
import type { BattleRow } from "./battle.js";
import type { ConditionReader } from "./conditions.js";
import { compileConditionResistanceProvider } from "./condition-resistance-provider.js";
import { compileContentFlags } from "./content-flags.js";
import { compileAttackElements } from "./elements.js";
import { tableInteger } from "./table.js";

const int = (value: string | undefined): number => {
  const result = tableInteger(value);
  if (result < -0x80000000 || result > 0x7fffffff) throw new Error("Condition application integer outside int32");
  return result;
};
const bound = (row: BattleRow): BattleRow => {
  if (row.source.rowId !== row.values.id) throw new Error("Condition application row identity mismatch");
  return row;
};

/** DoomConditionFunction .cctor 6af5e0 -> RuntimeHelpers.InitializeArray,
 * metadata field B6A9EDAFBE89B7FA33FCBA6C2444F0BB9B7D8B42, original
 * metadata offset 0x4df480, complete little-endian bytes
 * 11000000730200000b000000. This is a type array, never condition row IDs. */
export const sourceDoomPauseConditionTypes = [17, 627, 11] as const;

/** BattleBasicFunction.IsMagic 4f7720 complete FF6 jump table 4f7934,
 * followed by its separate 261 comparison. These are ability row identities. */
export const sourceConditionMagicAbilityIds = [125, 126, 128, 129, 131, 133, 135, 136, 137, 138, 139, 261] as const;

/** The native physical-recovery counter consumes Chanting.ForAiType, not the
 * effect executor's "physical" label or the damage amount. Keep the exact
 * function-group ID tests made by IsMagic as well as source type lookup. */
export function compileSourceConditionRecoveryHit(reader: ConditionReader, program: AbilityProgram): {
  metadata: { kind: "source-condition-recovery-hit-v1"; forAiType: number; isMagic: boolean };
  sources: BattleRow[];
} {
  const ability = bound(reader.row("ability.csv", program.abilityId));
  if (int(ability.values.id) !== program.abilityId || int(ability.values.type_id) !== program.rules.type_id ||
      int(ability.values.battle_function_group_id) !== program.groupId)
    throw new Error("Condition recovery-hit program differs from source");
  const rows = reader.group("chanting.csv", "ability_type_id", program.rules.type_id!);
  if (rows.length !== 1) throw new Error("Missing or ambiguous condition recovery-hit Chanting provider");
  const chanting = bound(rows[0]!);
  if (int(chanting.values.ability_type_id) !== program.rules.type_id)
    throw new Error("Changed condition recovery-hit Chanting binding");
  const forAiType = int(chanting.values.for_ai_type_id), sources = [ability, chanting];
  let magicFunction = false;
  if (program.groupId !== 0) {
    const group = bound(reader.row("function_group.csv", program.groupId)); sources.push(group);
    for (let slot = 1; slot <= 3; slot++) {
      const id = int(group.values[`function${slot}_id`]);
      if (id === 3 || id === 78) magicFunction = true;
    }
  }
  return { metadata: { kind: "source-condition-recovery-hit-v1", forAiType,
    isMagic: magicFunction || forAiType === 2 || forAiType === 3 ||
      (sourceConditionMagicAbilityIds as readonly number[]).includes(program.abilityId) }, sources };
}

/** EnemyCharacterParameter.ctor 4afb70 + its exact predicate 4b4d10:
 * native permanent master flag 2 supplies only the base bit. Current zombie,
 * Rampage mutation and player accessory checks are separate live inputs. */
export function compileSourceEnemyConditionTraits(reader: ConditionReader, sourceId: number): {
  metadata: { kind: "source-condition-traits-v1"; baseUndead: boolean };
  sources: BattleRow[];
} {
  const monster = bound(reader.row("monster.csv", sourceId));
  if (int(monster.values.id) !== sourceId) throw new Error("Changed enemy condition-trait source identity");
  const groupId = int(monster.values.monster_flag_group_id);
  if (groupId < 0) throw new Error("Invalid enemy condition-trait flag group");
  const rows = groupId === 0 ? [] : reader.group("monster_flag_group.csv", "group_id", groupId);
  if (groupId > 0 && !rows.length) throw new Error("Missing enemy condition-trait flag group");
  const sources = [monster], rowIds = new Set<number>();
  const flags = rows.map(raw => {
    const row = bound(raw), id = int(row.values.id), flag = int(row.values.monster_flag_id);
    if (id <= 0 || rowIds.has(id) || int(row.values.group_id) !== groupId || flag <= 0)
      throw new Error("Changed enemy condition-trait flag binding");
    rowIds.add(id); sources.push(row); return flag;
  });
  return { metadata: { kind: "source-condition-traits-v1", baseUndead: flags.includes(2) }, sources };
}

/** For the independently verified fresh source PlayerCharacterParameter
 * construction caller only. Both native ctors 536dd0/537ca0 and base 4ac740
 * retain the zero-initialized base-undead field. This is not IsUndead(): the
 * latter also consumes current type34, live accessory armor124 and the
 * unsupported isUndeadFromRampage mutation, all owned by the battle host. */
export function compileSourceFreshPlayerConditionTraits(reader: ConditionReader, sourceId: number): {
  metadata: { kind: "source-condition-traits-v1"; baseUndead: false };
  sources: BattleRow[];
} {
  const character = bound(reader.row("character_status.csv", sourceId));
  if (int(character.values.id) !== sourceId || int(character.values.initial_condition_group) !== 0)
    throw new Error("Unresolved fresh player condition-trait initialization");
  return { metadata: { kind: "source-condition-traits-v1", baseUndead: false }, sources: [character] };
}

type Kind = ControlConditionBehavior["kind"];
const lifecycle = {
  7: { kind: "sleep", system: 1, until: 9, cover: 1 },
  12: { kind: "confusion", system: 1, until: 8, cover: 1 },
  630: { kind: "temptation", system: 4, until: 17, cover: 0 },
  404: { kind: "doom", system: 3, until: 2, cover: 0 },
  17: { kind: "stop", system: 3, until: 7, cover: 1 },
} as const;
function descriptor(row: Pick<BattleRow, "values">): (typeof lifecycle)[keyof typeof lifecycle] | null {
  const type = int(row.values.condition_type);
  return Object.hasOwn(lifecycle, type) ? lifecycle[type as keyof typeof lifecycle] : null;
}

/** Exact independently bound numeric lifecycle. Recognition alone does not
 * implement automatic control, timed recovery or the native undead provider. */
export function hasSourceControlConditionLifecycle(row: Pick<BattleRow, "values">): boolean {
  const expected = descriptor(row), v = row.values;
  if (!expected) return false;
  return int(v.system_type) === expected.system && int(v.until_type) === expected.until &&
    int(v.resistance_decision) === 1 && int(v.state_cover_unavailable) === expected.cover &&
    (expected.kind === "temptation" ? int(v.until_value) === 0 : int(v.until_value) > 0) &&
    int(v.condition_group_id) >= 0 && int(v.erase_condition_group_id) >= 0 &&
    int(v.battle_effect_asset_id) >= 0 && int(v.icon_id) >= 0 &&
    int(v.battle_effect_shadow_cloning) === (expected.kind === "stop" ? 1 : 0) &&
    ["overlapped_type", "invalid_type", "target_type", "parameter_group_id", "attribute_group_id",
      "species_group_id", "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid",
      "attack_target", "game_over_target", "damage_number", "field_se_asset_id",
    ].every(key => int(v[key]) === 0);
}

export function compileSourceControlCondition(
  reader: ConditionReader, row: BattleRow, name: (key: string) => string,
  definitions: readonly ConditionDefinition[],
) {
  if (!hasSourceControlConditionLifecycle(row))
    return { behavior: null, sources: [] as BattleRow[], blockers: [] as string[] };
  bound(row);
  const d = descriptor(row)!, key = row.values.mes_id_name;
  if (!key) throw new Error("Missing control-condition message identity");
  const common = { id: int(row.values.id), name: key === "None" ? "" : name(key), untilValue: int(row.values.until_value) };
  const behavior: ControlConditionBehavior = d.kind === "doom"
    ? { ...common, kind: d.kind, untilType: 2, pauseConditionTypes: [...sourceDoomPauseConditionTypes] }
    : d.kind === "sleep" ? { ...common, kind: d.kind, untilType: 9 }
    : d.kind === "confusion" ? { ...common, kind: d.kind, untilType: 8 }
    : d.kind === "stop" ? { ...common, kind: d.kind, untilType: 7 }
    : { ...common, kind: d.kind, untilType: 17 };
  validateControlBehavior(behavior);
  const result = compileConditionResistanceProvider(reader, row, behavior, definitions);
  // The presentation lane may explicitly omit these assets, but the source
  // references still have to exist. None/zero is never invented for a missing row.
  const effectId = int(row.values.battle_effect_asset_id), iconId = int(row.values.icon_id);
  const sources = [row, ...result.sources];
  if (effectId > 0) {
    const effect = bound(reader.row("battle_effect_asset.csv", effectId)); sources.push(effect);
    for (const field of ["se_asset_id", "se_asset_id_2", "critical_se_asset_id"])
      if (int(effect.values[field]) > 0) sources.push(bound(reader.row("se_asset.csv", int(effect.values[field]))));
  }
  if (iconId > 0) sources.push(bound(reader.row("icon.csv", iconId)));
  return { ...result, sources };
}

const rules = ["type_id", "system_id", "accuracy_rate", "condition_group_id", "content_flag_group_id",
  "attribute_group_id", "attack_count", "Impact_status", "invalid_boss", "invalid_reflection",
  "resistance_attribute", "adding_hit_rate", "valid_hit_rate", "weak_hit_rate", "reaction_type"] as const;
const equal = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, n) => value === b[n]);

/** Source-safe complete Fn9 binding. A decoded effect is not an executable
 * action: the caller must close the same active-condition and targeting hosts.
 * No ability/condition row ID chooses an implementation. */
export function compileSourceConditionApplication(reader: ConditionReader, program: AbilityProgram): {
  effect: Extract<AbilityEffect, { kind: "add-condition" }> | null;
  controlKind: Kind | null;
  sources: BattleRow[];
  blockers: string[];
  requirements: string[];
  runtimeAdmission: "unassessed";
} {
  const sources: BattleRow[] = [], blockers: string[] = [], requirements: string[] = [];
  const result = (effect: Extract<AbilityEffect, { kind: "add-condition" }> | null, controlKind: Kind | null) =>
    ({ effect, controlKind, sources, blockers, requirements, runtimeAdmission: "unassessed" as const });
  const functions = program.functions.filter(fn => fn.type === 9);
  if (!functions.length) return result(null, null);
  const ability = bound(reader.row("ability.csv", program.abilityId));
  const group = bound(reader.row("function_group.csv", program.groupId));
  sources.push(ability, group);
  if (int(ability.values.id) !== program.abilityId || int(ability.values.battle_function_group_id) !== program.groupId ||
      int(group.values.id) !== program.groupId || program.range !== int(ability.values.battle_renge_id) ||
      program.process.key !== ability.values.process_prog ||
      !equal(program.process.values, ["data_a", "data_b", "data_c"].map(key => int(ability.values[key]))) ||
      Object.keys(program.rules).length !== rules.length ||
      rules.some(key => program.rules[key] !== int(ability.values[key])))
    throw new Error("Condition application program differs from its source");
  const allFunctions: AbilityProgram["functions"] = [];
  for (let slot = 1; slot <= 3; slot++) {
    const id = int(group.values[`function${slot}_id`]), values = [1, 2, 3].map(n => int(group.values[`function${slot}_value${n}`])) as [number, number, number];
    if (id === 0) {
      if (values.some(Boolean)) throw new Error("Condition application source has orphan operands");
      continue;
    }
    const fn = bound(reader.row("function.csv", id)); sources.push(fn);
    allFunctions.push({ slot, functionId: id, type: int(fn.values.type_id), series: int(fn.values.series_id), values });
  }
  if (allFunctions.length !== program.functions.length || allFunctions.some((fn, index) => {
    const candidate = program.functions[index];
    return !candidate || fn.slot !== candidate.slot || fn.functionId !== candidate.functionId ||
      fn.type !== candidate.type || fn.series !== candidate.series || !equal(fn.values, candidate.values);
  }))
    throw new Error("Condition application source has an omitted or changed function");
  const forbidden = reader.group("condition_group.csv", "group_id", program.rules.condition_group_id!);
  sources.push(...forbidden.map(bound));
  const ids = forbidden.map(row => {
    if (int(row.values.group_id) !== program.rules.condition_group_id) throw new Error("Condition application forbidden group mismatch");
    const id = int(row.values.condition_id); sources.push(bound(reader.row("condition.csv", id))); return id;
  });
  const flags = compileContentFlags(reader, program.rules.content_flag_group_id!);
  const elements = compileAttackElements(reader, int(ability.values.attribute_id), program.rules.attribute_group_id!);
  sources.push(...flags.sources, ...elements.sources);
  if (!equal(ids, program.forbiddenConditionIds) || !equal(flags.ids, program.contentFlags) || !equal(elements.elements, program.elements))
    throw new Error("Condition application dependency projection differs from its source");
  if (allFunctions.length !== 1 || functions.length !== 1) {
    blockers.push("unresolved condition-application companion function lifecycle"); return result(null, null);
  }
  const fn = functions[0]!, [conditionId, fixedHit, reserved] = fn.values;
  const condition = bound(reader.row("condition.csv", conditionId)); sources.push(condition);
  if (fn.series !== 0 || ![0, 1].includes(fixedHit) || reserved !== 0 || !hasSourceControlConditionLifecycle(condition)) {
    blockers.push("unresolved source control-condition operands or lifecycle"); return result(null, null);
  }
  const controlKind = descriptor(condition)!.kind;
  requirements.push("source-control-condition-active-owner");
  if (controlKind === "confusion" || controlKind === "temptation") requirements.push("source-control-automatic-action-selection");
  if (controlKind === "doom") requirements.push("source-doom-live-undead-provider");
  return result({ slot: fn.slot, kind: "add-condition", conditionId, fixedHit: fixedHit === 1,
    // AddConditionExecution a91a90 bypasses evasion only for flag1; it does
    // not grant flag4 resistance bypass or erase the original content flags.
    accuracy: flags.ids.includes(1) ? 255 : program.rules.accuracy_rate! }, controlKind);
}
