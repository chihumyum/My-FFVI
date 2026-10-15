import { tableInteger as int } from "./table.js";
import type { BattleRow } from "./battle.js";
import type { BattleConditionCatalog } from "../core/battle-conditions.js";
import { hasDefendBehavior } from "./defend.js";
import { compileLevitateCondition } from "./condition-levitate.js";
import { compileProtectionCondition } from "./protection.js";
import { compileSpeedCondition } from "./condition-speed.js";
import { compileBlindCondition, compileBlindPresentation } from "./condition-blind.js";
import { compileConditionResistanceProvider } from "./condition-resistance-provider.js";
import { compileSourceControlCondition } from "./source-condition-application.js";
import {
  ConditionRules,
  type ConditionCatalog,
  type ConditionDefinition,
} from "../core/conditions.js";

export type ConditionReader = {
  /** Exact physical master array order; no group-row or numeric-sort fallback. */
  ordered?(table: string): BattleRow[];
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
};

/** GetConditions 0x4da710 filters only group identity. Type and invocation rate
 * are NOT filters in this call path. Preserve order and repeated IDs. */
export function compileConditionGroup(
  reader: ConditionReader,
  groupId: number,
) {
  const sources = reader.group("condition_group.csv", "group_id", groupId);
  const ids = sources.map((r) => int(r.values.condition_id));
  for (const id of ids) reader.row("condition.csv", id);
  return { ids, sources };
}

function hasPassiveBehavior(
  row: BattleRow,
  type: number,
  until: number,
): boolean {
  const v = row.values;
  return (
    int(v.condition_type) === type &&
    int(v.system_type) === 1 &&
    int(v.resistance_decision) === 1 &&
    int(v.until_type) === until &&
    [
      "until_value",
      "overlapped_type",
      "invalid_type",
      "target_type",
      "condition_group_id",
      "parameter_group_id",
      "attribute_group_id",
      "species_group_id",
      "rate_type1",
      "rate_type2",
      "rate_value1",
      "rate_value2",
      "recovery_invalid",
      "attack_target",
      "game_over_target",
      "state_cover_unavailable",
      "damage_number",
    ].every((key) => int(v[key]) === 0)
  );
}

export function hasSilenceBehavior(row: BattleRow): boolean {
  return hasPassiveBehavior(row, 6, 2);
}

/** Source Escape is a system-4 behavior, not death or an ordinary status
 * calculation. Preserve its target/game-over distinction and erase group. */
export function hasEscapeBehavior(row: Pick<BattleRow, "values">): boolean {
  const v = row.values;
  return int(v.condition_type) === 3 && int(v.system_type) === 4 &&
    int(v.target_type) === 1 && int(v.until_type) === 2 &&
    int(v.resistance_decision) === 1 && int(v.attack_target) === 1 &&
    int(v.erase_condition_group_id) === 33 &&
    ["until_value", "overlapped_type", "invalid_type", "condition_group_id",
      "parameter_group_id", "attribute_group_id", "species_group_id",
      "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid",
      "game_over_target", "state_cover_unavailable", "damage_number",
      "battle_effect_asset_id", "battle_effect_shadow_cloning", "field_se_asset_id", "icon_id",
    ].every((key) => int(v[key]) === 0);
}

/** Madou Start/Remove changes armor rendering and the effect posture size.
 * Its active admission also requires the separate battle appearance host. */
export function hasMagitekBehavior(row: Pick<BattleRow, "values">): boolean {
  const v = row.values;
  return int(v.condition_type) === 607 && int(v.system_type) === 4 &&
    int(v.resistance_decision) === 1 && int(v.until_type) === 3 &&
    ["until_value", "overlapped_type", "invalid_type", "target_type",
      "condition_group_id", "parameter_group_id", "attribute_group_id", "species_group_id",
      "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid",
      "attack_target", "game_over_target", "state_cover_unavailable", "damage_number",
      "battle_effect_asset_id", "battle_effect_shadow_cloning", "field_se_asset_id", "icon_id",
    ].every((key) => int(v[key]) === 0);
}

/** Poison's numeric/lifecycle contract; the generic resistance dictionary is
 * compiled separately for active states. damage_number is not battle damage. */
function hasPoisonLifecycle(row: BattleRow): boolean {
  const v = row.values;
  return (
    int(v.condition_type) === 10 &&
    int(v.system_type) === 1 &&
    int(v.resistance_decision) === 1 &&
    int(v.until_type) === 3 &&
    int(v.rate_type1) === 3 &&
    int(v.rate_value1) > 0 &&
    int(v.rate_value1) <= 0x7fffffff &&
    int(v.damage_number) === 32 &&
    [
      "until_value",
      "overlapped_type",
      "invalid_type",
      "target_type",
      "parameter_group_id",
      "attribute_group_id",
      "species_group_id",
      "rate_type2",
      "rate_value2",
      "recovery_invalid",
      "attack_target",
      "game_over_target",
      "state_cover_unavailable",
    ].every((key) => int(v[key]) === 0)
  );
}

/** Keep ordinary ability application distinct from provider-bearing states. */
export function hasPoisonBehavior(row: BattleRow): boolean {
  return hasPoisonLifecycle(row) && int(row.values.condition_group_id) === 0;
}

export function hasUnableFightBehavior(row: BattleRow): boolean {
  const v = row.values;
  return (
    int(v.condition_type) === 5 &&
    int(v.system_type) === 1 &&
    int(v.until_type) === 3 &&
    int(v.resistance_decision) === 1 &&
    [
      "attack_target",
      "game_over_target",
      "recovery_invalid",
      "state_cover_unavailable",
    ].every((key) => int(v[key]) === 1) &&
    [
      "until_value",
      "overlapped_type",
      "invalid_type",
      "target_type",
      "condition_group_id",
      "parameter_group_id",
      "attribute_group_id",
      "species_group_id",
      "rate_type1",
      "rate_type2",
      "rate_value1",
      "rate_value2",
      "damage_number",
    ].every((key) => int(v[key]) === 0)
  );
}

export function compileBattleConditionCatalog(
  reader: ConditionReader & {
    unique(table: string, key: string, value: string): BattleRow;
  },
  ids: readonly number[],
  name: (key: string) => string,
) {
  const result = compileConditionCatalog(reader, ids);
  const presentationSources: BattleRow[] = [];
  const providerBlockers: { conditionId: number; reason: string }[] = [];
  const dying = result.catalog.definitions.filter((d) => d.type === 4);
  const threshold = reader.unique(
    "game_constant_int.csv",
    "key_name",
    "RATE_HAVE_NEAR_DEATH",
  );
  if (
    dying.length !== 1 ||
    !hasPassiveBehavior(reader.row("condition.csv", dying[0]!.id), 4, 3) ||
    int(threshold.values.value1) < 1
  )
    throw new Error("Unresolved dying condition dependency");
  const catalog: BattleConditionCatalog = {
    rules: result.catalog,
    // UpdateConditionHp 0x459980 passes master identity 5 to the dictionary
    // overload 0x4582c0; this is not a first-match condition-type lookup.
    hpZeroConditionId: 5,
    dying: {
      conditionId: dying[0]!.id,
      thresholdDivisor: int(threshold.values.value1),
    },
    behaviors: result.catalog.definitions.flatMap(
      (d): BattleConditionCatalog["behaviors"] => {
        const row = reader.row("condition.csv", d.id);
        const levitate = compileLevitateCondition(reader, row, name, result.catalog.definitions);
        providerBlockers.push(...levitate.blockers.map(reason => ({ conditionId: d.id, reason })));
        if (levitate.behavior) {
          presentationSources.push(...levitate.sources);
          return [levitate.behavior];
        }
        const protection = compileProtectionCondition(reader, row, name, result.catalog.definitions);
        providerBlockers.push(...protection.blockers.map((reason) => ({ conditionId: d.id, reason })));
        if (protection.behavior) {
          presentationSources.push(...protection.sources);
          return [protection.behavior];
        }
        const speed = compileSpeedCondition(reader, row, name, result.catalog.definitions);
        providerBlockers.push(...speed.blockers.map((reason) => ({ conditionId: d.id, reason })));
        if (speed.behavior) {
          presentationSources.push(...speed.sources);
          return [speed.behavior];
        }
        const blind = compileBlindCondition(reader, row, name, result.catalog.definitions);
        providerBlockers.push(...blind.blockers.map((reason) => ({ conditionId: d.id, reason })));
        if (blind.behavior) {
          presentationSources.push(...blind.sources, ...compileBlindPresentation(reader, blind.behavior));
          return [blind.behavior];
        }
        const poison = compileConditionResistanceProvider(reader, row, hasPoisonLifecycle(row) ? {
          id: d.id, kind: "poison" as const, name: name(row.values.mes_id_name!),
          untilType: 3 as const, hpDivisor: int(row.values.rate_value1),
        } : null, result.catalog.definitions);
        providerBlockers.push(...poison.blockers.map((reason) => ({ conditionId: d.id, reason })));
        if (poison.behavior) {
          presentationSources.push(...poison.sources);
          return [poison.behavior];
        }
        const control = compileSourceControlCondition(reader, row, name, result.catalog.definitions);
        providerBlockers.push(...control.blockers.map(reason => ({ conditionId: d.id, reason })));
        if (control.behavior) {
          presentationSources.push(...control.sources);
          return [control.behavior];
        }
        return hasEscapeBehavior(row)
          ? [{ id: d.id, kind: "escape", untilType: 2,
              name: row.values.mes_id_name === "None" ? "" : name(row.values.mes_id_name!) }]
          : hasDefendBehavior(row)
          ? [{ id: d.id, kind: "defend", untilType: 1,
              name: row.values.mes_id_name === "None" ? "" : name(row.values.mes_id_name!) }]
          : hasSilenceBehavior(row)
          ? [
              {
                id: d.id,
                kind: "silence" as const,
                name: name(row.values.mes_id_name!),
                untilType: 2 as const,
              },
            ]
          : hasUnableFightBehavior(row)
            ? [
                {
                  id: d.id,
                  kind: "unable-fight",
                  name: name(row.values.mes_id_name!),
                  untilType: 3,
                },
              ]
            : hasPassiveBehavior(row, 4, 3)
              ? [
                  {
                    id: d.id,
                    kind: "dying",
                    name: name(row.values.mes_id_name!),
                    untilType: 3,
                  },
                ]
              : hasMagitekBehavior(row)
                  ? [{ id: d.id, kind: "magitek", untilType: 3,
                    name: row.values.mes_id_name === "None" ? "" : name(row.values.mes_id_name!) }]
                  : [];
      },
    ),
  };
  return { catalog, sources: [...result.sources, threshold, ...presentationSources], providerBlockers };
}

/** Supply the complete condition master ID list from this source snapshot.
 * Compilation preserves all raw rows; decoding an effect type is not support
 * for its timer, behavior function, visual or resistance calculation.
 */
export function compileConditionCatalog(
  reader: ConditionReader,
  ids: readonly number[],
) {
  const sources: BattleRow[] = [];
  const definitions: ConditionDefinition[] = ids.map((id) => {
    const row = reader.row("condition.csv", id);
    sources.push(row);
    const overlap = int(row.values.overlapped_type);
    if (![0, 1].includes(overlap))
      throw new Error("Unsupported condition overlap: " + overlap);
    return {
      id: int(row.values.id),
      type: int(row.values.condition_type),
      overlapped: overlap === 1,
      eraseGroupId: int(row.values.erase_condition_group_id),
    };
  });
  const eraseRules = [
    ...new Set(definitions.map((c) => c.eraseGroupId)),
  ].flatMap((groupId) =>
    reader
      .group("erase_condition_group.csv", "group_id", groupId)
      .map((row) => {
        sources.push(row);
        return {
          id: int(row.values.id),
          groupId: int(row.values.group_id),
          conditionId: int(row.values.condition_id),
          type: int(row.values.type_id),
          eraseConditionId: int(row.values.erase_condition),
        };
      }),
  );
  const catalog: ConditionCatalog = { definitions, eraseRules };
  new ConditionRules(catalog); // Validate identities, selectors and reference closure.
  return { catalog, sources };
}
