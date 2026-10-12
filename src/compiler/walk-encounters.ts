import type { BattleCatalog } from "../core/battle-content.js";
import { parseFrameworkWalkEncounterPolicy, type FrameworkWalkEncounterPolicy } from "../core/walk-encounters.js";
import type { BattleRow } from "./battle.js";
import { analyzeBatchEncounters, type BatchEncountersAnalysis } from "./content-batch-battle.js";
import { tableInteger } from "./table.js";

export type WalkEncounterReader = { row(table: string, id: string | number): BattleRow };
export type WalkEncounterDevelopmentSettings = Pick<FrameworkWalkEncounterPolicy,
  "id" | "minSteps" | "maxSteps" | "transportationIds">;
export type WalkEncounterDiagnostic = {
  code: string;
  reason: string;
  partyId?: number;
  abilityId?: number;
  slot?: number;
};
export type WalkEncounterInventory = {
  mapId: number;
  /** These original rows are inventory evidence, not a native encounter clock. */
  source: { map: BattleRow | null; monsterSet: BattleRow | null };
  monsterSetId: number | null;
  encountAreaGridId: number | null;
  sourceSteps: { requiredStepsMin: number; requiredStepsMax: number; subtractSteps: number } | null;
  slots: { slot: number; partyId: number; weight: number }[];
  partyIds: number[];
  battleAnalysis: BatchEncountersAnalysis;
  diagnostics: WalkEncounterDiagnostic[];
  limitations: string[];
  policy: FrameworkWalkEncounterPolicy | null;
};

const int32 = (value: number, min = 0) => Number.isInteger(value) && value >= min && value <= 0x7fffffff;
const uint32 = (value: number) => Number.isInteger(value) && value > 0 && value <= 0xffffffff;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function developmentSettings(value: WalkEncounterDevelopmentSettings): WalkEncounterDevelopmentSettings {
  if (!value || typeof value.id !== "string" || !value.id.length || value.id.trim() !== value.id ||
      !uint32(value.minSteps) || !uint32(value.maxSteps) || value.maxSteps < value.minSteps ||
      !Array.isArray(value.transportationIds) || !value.transportationIds.length ||
      Object.keys(value.transportationIds).length !== value.transportationIds.length ||
      value.transportationIds.some(id => !int32(id, 1)) ||
      new Set(value.transportationIds).size !== value.transportationIds.length)
    throw new Error("Invalid explicit development walk encounter settings");
  return { id: value.id, minSteps: value.minSteps, maxSteps: value.maxSteps,
    transportationIds: [...value.transportationIds] };
}

/** Inventory the map's default monster_set without changing its sampling pool.
 * Native threshold/selection, attribute grids and event/transport eligibility
 * are not recovered here. A policy is an explicit Web development protocol;
 * callers still bind it to the map/profile and validate live battle admission.
 * The battle catalog must already have passed its source/hash verification.
 */
export function compileWalkEncounters(
  reader: WalkEncounterReader, mapId: number, catalog: BattleCatalog,
  development?: WalkEncounterDevelopmentSettings,
): WalkEncounterInventory {
  if (!int32(mapId, 1)) throw new Error("Invalid walk encounter map identity");
  const settings = development === undefined ? null : developmentSettings(development);
  const result: WalkEncounterInventory = {
    mapId, source: { map: null, monsterSet: null }, monsterSetId: null, encountAreaGridId: null,
    sourceSteps: null, slots: [], partyIds: [], battleAnalysis: analyzeBatchEncounters(catalog, []),
    diagnostics: [], limitations: [
      "Native encounter thresholds, random sequence, formation selection and movement eligibility are unassessed",
      "A generated policy uses caller-supplied development step thresholds and transportation IDs",
      "Dependency readiness does not establish a playable map or original-game equivalence",
    ], policy: null,
  };
  const add = (code: string, reason: string, extra: Partial<WalkEncounterDiagnostic> = {}) =>
    result.diagnostics.push({ code, reason, ...extra });
  const row = (table: string, id: number) => {
    const value = reader.row(table, id);
    if (tableInteger(value.values.id) !== id || value.source.rowId !== String(id))
      throw new Error(`Mismatched source identity: ${table}:${id}`);
    return structuredClone(value);
  };
  const number = (value: BattleRow, key: string) => {
    const parsed = tableInteger(value.values[key]);
    if (!int32(parsed)) throw new Error(`Invalid source ${key}: ${parsed}`);
    return parsed;
  };
  try {
    const map = result.source.map = row("map.csv", mapId);
    result.monsterSetId = number(map, "monster_set_id");
    result.encountAreaGridId = number(map, "encount_area_grid_id");
    result.sourceSteps = { requiredStepsMin: number(map, "required_steps_min"),
      requiredStepsMax: number(map, "required_steps_max"), subtractSteps: number(map, "subtract_steps") };
    if (result.monsterSetId === 0) {
      add("source-grid-selection", "No default monster set: attribute/encount-area selection is not implemented");
      return result;
    }
    const set = result.source.monsterSet = row("monster_set.csv", result.monsterSetId);
    // Never compact slots or pick a supported subset. Preserve zero entries and
    // repeated identities even when they cannot produce a development policy.
    for (let slot = 1; slot <= 16; slot++) {
      const partyId = number(set, `monster_set${slot}`), weight = number(set, `monster_set${slot}_rate`);
      result.slots.push({ slot, partyId, weight });
      if (weight > 0 && partyId === 0)
        add("source-empty-party", "A positive-weight slot has no party; its native selection semantics are unresolved", { slot });
    }
  } catch (error) { add("source-reference", message(error)); }

  result.partyIds = [...new Set(result.slots.filter(slot => slot.weight > 0 && slot.partyId > 0)
    .map(slot => slot.partyId))].sort((a, b) => a - b);
  if (result.slots.length === 16 && !result.slots.some(slot => slot.weight > 0))
    add("source-empty-pool", "The source default monster set has no positive-weight slots");
  result.battleAnalysis = analyzeBatchEncounters(catalog, result.partyIds);
  for (const encounter of result.battleAnalysis.encounters) {
    for (const detail of encounter.blockers.concat(encounter.runtimeDependencies))
      add(encounter.status === "blocked" ? "battle-dependency" : "battle-conditional",
        `${detail.code}: ${detail.reason}`, { partyId: encounter.id,
          ...(detail.abilityId === undefined ? {} : { abilityId: detail.abilityId }) });
    result.limitations.push(...encounter.limitations);
  }
  result.limitations = [...new Set(result.limitations)].sort();
  if (settings && result.diagnostics.length === 0 && result.partyIds.length > 0 && result.slots.length === 16 &&
      result.battleAnalysis.encounters.every(encounter => encounter.status === "ready")) {
    const parties = new Map<number, number>();
    for (const slot of result.slots) if (slot.weight > 0)
      parties.set(slot.partyId, (parties.get(slot.partyId) ?? 0) + slot.weight);
    const total = [...parties.values()].reduce((sum, weight) => sum + weight, 0);
    if (!uint32(total)) add("source-weight-range", "Source party weights exceed the development sampler range");
    else result.policy = parseFrameworkWalkEncounterPolicy({ kind: "framework-walk-encounters-v1", ...settings,
      parties: [...parties].map(([partyId, weight]) => ({ partyId, weight })) });
  }
  return result;
}
