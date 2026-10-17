import type { BattleCatalog } from "../core/battle-content.js";
import type { SourceWalkPolicyBinding, SourceWalkPolicyDeclaration } from "../core/source-walk-policy-content.js";
import { parseFrameworkWalkEncounterPolicy, type FrameworkWalkEncounterPolicy } from "../core/walk-encounters.js";
import type { Evidence } from "../field/types.js";
import type { SourceWalkEncounterDependencies, SourceWalkEncounterRowEvidence } from "../field/world.js";
import { analyzeBatchEncounters, type BatchEncountersAnalysis } from "./content-batch-battle.js";
import { validateSourceWalkEncounterDependencies } from "./content-dependencies.js";
import { canonical, hash } from "./content.js";
import { tableId } from "./table-id.js";

export type { SourceWalkPolicyBinding, SourceWalkPolicyDeclaration } from "../core/source-walk-policy-content.js";

export type SourceWalkPolicyDiagnostic = {
  code: string;
  reason: string;
  slot?: number;
  partyId?: number;
  abilityId?: number;
  source?: Evidence;
};
export type SourceWalkPolicyDependency = {
  slot: number;
  partyId: number;
  rawRate: string | null;
  rate: number | null;
  source: SourceWalkEncounterRowEvidence;
};
export type SourceWalkPolicyResult = {
  kind: "source-walk-policy-result-v1";
  /** Ready describes this explicit Web binding, never source lottery parity. */
  status: "ready" | "none" | "blocked";
  mapId: number;
  source: SourceWalkEncounterDependencies;
  sourceMetadataHash: string;
  declaration: SourceWalkPolicyDeclaration;
  /** All positive raw party references, including zero-rate and extra slots. */
  dependencies: SourceWalkPolicyDependency[];
  encounterIds: number[];
  selectableEncounterIds: number[];
  battleAnalysis: BatchEncountersAnalysis;
  policy: FrameworkWalkEncounterPolicy | null;
  binding: SourceWalkPolicyBinding | null;
  diagnostics: SourceWalkPolicyDiagnostic[];
  limitations: string[];
  runtimeAdmission: "unassessed";
};
export type SourceWalkPolicyInput = {
  mapId: number;
  source: SourceWalkEncounterDependencies;
  catalog: BattleCatalog;
  declaration: SourceWalkPolicyDeclaration;
  /** Optional expected SHA of the complete retained metadata, checked here. */
  sourceMetadataHash?: string;
};

const SHA256 = /^[a-f0-9]{64}$/;
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
function exact(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error(`Invalid ${label}`);
  const actual = Reflect.ownKeys(raw);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key)) ||
      keys.some(key => { const property = Object.getOwnPropertyDescriptor(raw, key);
        return !property?.enumerable || !("value" in property); })) throw new Error(`Invalid ${label} fields`);
  return raw as Record<string, unknown>;
}
function dense(raw: unknown, label: string): unknown[] {
  if (!Array.isArray(raw) || Reflect.ownKeys(raw).length !== raw.length + 1 ||
      Array.from({ length: raw.length }, (_, index) => Object.getOwnPropertyDescriptor(raw, index))
        .some(property => !property?.enumerable || !("value" in property))) throw new Error(`Invalid ${label}`);
  return raw;
}
function integer(raw: unknown, min: number, max: number, label: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || Object.is(raw, -0) || raw < min || raw > max)
    throw new Error(`Invalid ${label}`);
  return raw;
}
const identity = (raw: unknown, label: string): number => integer(raw, 1, 0x7fffffff, label);
function sha(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !SHA256.test(raw)) throw new Error(`Invalid ${label}`);
  return raw;
}
function sourceInteger(raw: unknown): number | null {
  try { const value = tableId(raw); return value >= 0 ? value : null; } catch { return null; }
}

export function parseSourceWalkPolicyDeclaration(raw: unknown): SourceWalkPolicyDeclaration {
  const value = exact(raw, ["kind", "id", "minSteps", "maxSteps", "transportationIds", "weighting"],
    "source walking development declaration");
  if (value.kind !== "framework-source-set-walk-v1" || value.weighting !== "source-rate-as-web-weight-v1" ||
      typeof value.id !== "string" || !value.id.length || value.id.trim() !== value.id)
    throw new Error("Invalid source walking development declaration identity or weighting");
  const minSteps = integer(value.minSteps, 1, 0xffffffff, "minimum Web walk steps");
  const maxSteps = integer(value.maxSteps, minSteps, 0xffffffff, "maximum Web walk steps");
  const transportationIds = dense(value.transportationIds, "Web walk transportation IDs")
    .map(value => identity(value, "Web walk transportation ID"));
  if (!transportationIds.length || new Set(transportationIds).size !== transportationIds.length)
    throw new Error("Missing or duplicate Web walk transportation ID");
  return { kind: value.kind, id: value.id, minSteps, maxSteps, transportationIds, weighting: value.weighting };
}

/** Bind the complete v83 source inventory to an explicit Web policy. This
 * performs no I/O and never samples RNG. Callers still verify the enclosing
 * source map/set manifests and source-set relationships; a digest here binds
 * the supplied content, not its provenance or a playable live party.
 */
export function compileSourceWalkPolicy(input: SourceWalkPolicyInput): SourceWalkPolicyResult {
  const mapId = identity(input.mapId, "source walking map ID");
  const declaration = parseSourceWalkPolicyDeclaration(input.declaration);
  const source = structuredClone(input.source), sourceMetadataHash = hash(source);
  const result: SourceWalkPolicyResult = {
    kind: "source-walk-policy-result-v1", status: "blocked", mapId, source, sourceMetadataHash, declaration,
    dependencies: [], encounterIds: [], selectableEncounterIds: [],
    battleAnalysis: { encounterIds: [], diagnostics: [], encounters: [], runtimeAdmission: "unassessed" },
    policy: null, binding: null, diagnostics: [], runtimeAdmission: "unassessed",
    limitations: [
      "Native required_steps_min, required_steps_max and subtract_steps are retained verbatim; their units are not inferred.",
      "Thresholds, eligible transportation IDs and source-rate weighting are explicit Web development rules.",
      "Source zero-rate references remain dependencies; zero is a non-selected weight only under this Web declaration.",
      "Source timing, lottery and area-grid selection remain unimplemented; dependency readiness is not live runtime admission or original parity.",
    ],
  };
  const add = (code: string, reason: string, detail: Omit<SourceWalkPolicyDiagnostic, "code" | "reason"> = {}) =>
    result.diagnostics.push({ code, reason, ...detail });
  if (input.sourceMetadataHash !== undefined &&
      sha(input.sourceMetadataHash, "expected source walking metadata SHA") !== sourceMetadataHash)
    add("source-walk-metadata-hash", "Retained source walking metadata does not match the expected SHA");

  // Collect from raw source before validation. A bad rate or forged decoded
  // slot must not erase the corresponding positive source party reference.
  if (source?.set?.values && typeof source.set.values === "object" && !Array.isArray(source.set.values)) {
    const row = source.set;
    const keys = Object.keys(row.values).filter(key => /^monster_set\d+$/.test(key))
      .sort((a, b) => Number(a.slice(11)) - Number(b.slice(11)) || a.localeCompare(b));
    for (const key of keys) {
      const slot = Number(key.slice(11)), partyId = sourceInteger(row.values[key]);
      if (partyId === null || partyId === 0 || !Number.isSafeInteger(slot)) continue;
      const rawRate = row.values[`${key}_rate`] ?? null;
      result.dependencies.push({ slot, partyId, rawRate, rate: sourceInteger(rawRate),
        source: { ...structuredClone(row.source), pointer: `/id/${row.source.rowId}/${key}` } });
    }
  }
  result.encounterIds = [...new Set(result.dependencies.map(dependency => dependency.partyId))].sort((a, b) => a - b);
  result.selectableEncounterIds = [...new Set(result.dependencies.filter(dependency => dependency.rate !== null && dependency.rate > 0)
    .map(dependency => dependency.partyId))].sort((a, b) => a - b);

  try {
    exact(source, ["kind", "mapId", "map", "monsterSetId", "set", "slots", "blockers"], "source walking metadata");
    exact(source.map, ["source", "values"], "source walking map row");
    dense(source.slots, "source walking slots").forEach(slot =>
      exact(slot, ["index", "partyId", "rawPartyId", "rate", "rawRate", "source"], "source walking slot"));
    dense(source.blockers, "source walking diagnostics").forEach(blocker =>
      exact(blocker, ["code", "reason", "source"], "source walking diagnostic"));
    if (source.set !== null) exact(source.set, ["source", "values"], "source walking set row");
    validateSourceWalkEncounterDependencies(source, mapId);
    if (source.map.source.pointer !== `/id/${mapId}` || source.set !== null &&
        source.set.source.pointer !== `/id/${source.monsterSetId}`)
      throw new Error("Source walking master row pointer mismatch");
    for (const blocker of source.blockers) add(blocker.code, blocker.reason, { source: structuredClone(blocker.source) });
  } catch (error) { add("source-walk-encounter-binding-invalid", message(error)); }

  const grid = sourceInteger(source?.map?.values?.encount_area_grid_id);
  if (grid !== 0) add("source-walk-grid-unimplemented", grid === null
    ? "Source walking area-grid identity is unknown; no default-set fallback is authorized"
    : `Source walking area-grid ${grid} selection is not implemented`);
  if (source?.set?.values && typeof source.set.values === "object" && !Array.isArray(source.set.values)) {
    const values = source.set.values;
    const reviewed = new Set(Array.from({ length: 16 }, (_, offset) =>
      [`monster_set${offset + 1}`, `monster_set${offset + 1}_rate`]).flat());
    const unknown = Object.keys(values).filter(key => key.startsWith("monster_set") && !reviewed.has(key)).sort();
    if (unknown.length || source.slots.length !== 16)
      add("source-walk-slot-schema", `Only the complete reviewed 16-slot schema is supported${unknown.length ? `; unreviewed fields: ${unknown.join(", ")}` : ""}`);
    for (let slot = 1; slot <= 16; slot++) {
      const partyId = sourceInteger(values[`monster_set${slot}`]), rate = sourceInteger(values[`monster_set${slot}_rate`]);
      if (partyId === null || rate === null || partyId === 0 && rate > 0)
        add("source-walk-slot-invalid", "Unknown party/rate or positive rate for party zero cannot form a Web policy", { slot });
    }
  }

  try {
    const { contentHash, ...body } = input.catalog;
    if (sha(contentHash, "battle catalog SHA") !== hash(body)) throw new Error("Battle catalog payload changed");
  } catch (error) { add("battle-catalog-binding", message(error)); }
  try {
    result.battleAnalysis = analyzeBatchEncounters(input.catalog, result.encounterIds);
    for (const encounter of result.battleAnalysis.encounters) {
      for (const [code, details] of [["battle-dependency", encounter.blockers],
        ["battle-conditional", encounter.runtimeDependencies]] as const) for (const detail of details)
        add(code, `${detail.code}: ${detail.reason}`, { partyId: encounter.id,
          ...(detail.abilityId === undefined ? {} : { abilityId: detail.abilityId }) });
      result.limitations.push(...encounter.limitations);
    }
  } catch (error) { add("battle-analysis-invalid", message(error)); }

  if (source?.monsterSetId !== null && source?.monsterSetId > 0 && !result.selectableEncounterIds.length)
    add("source-walk-empty-pool", "The source set contains no selectable positive-rate party; no fallback encounter is invented");
  if (result.diagnostics.length === 0 && source.monsterSetId === 0) result.status = "none";
  else if (result.diagnostics.length === 0 && source.monsterSetId !== null && source.monsterSetId > 0 &&
      result.battleAnalysis.encounters.length === result.encounterIds.length &&
      result.battleAnalysis.encounters.every(encounter => encounter.status === "ready")) {
    const parties = new Map<number, number>();
    for (const dependency of result.dependencies) if (dependency.rate !== null && dependency.rate > 0)
      parties.set(dependency.partyId, (parties.get(dependency.partyId) ?? 0) + dependency.rate);
    try {
      const { id, minSteps, maxSteps, transportationIds } = declaration;
      result.policy = parseFrameworkWalkEncounterPolicy({ kind: "framework-walk-encounters-v1",
        id, minSteps, maxSteps, transportationIds, parties: [...parties].map(([partyId, weight]) => ({ partyId, weight })) });
      result.binding = { kind: "framework-source-set-walk-binding-v1", mapId, monsterSetId: source.monsterSetId,
        sourceMetadataHash, battleCatalogHash: input.catalog.contentHash, declaration: structuredClone(declaration), policyHash: hash(result.policy) };
      result.status = "ready";
    } catch (error) { add("source-walk-weight-range", message(error)); }
  }
  result.limitations = [...new Set(result.limitations)].sort();
  return result;
}

/** Re-derive against the same complete source and battle catalog. A stored
 * binding or policy is evidence to validate, not permission by itself. */
export function assertSourceWalkPolicyBinding(input: {
  mapId: number;
  source: SourceWalkEncounterDependencies;
  catalog: BattleCatalog;
  binding: unknown;
  policy: unknown;
}): void {
  const binding = exact(input.binding, ["kind", "mapId", "monsterSetId", "sourceMetadataHash", "battleCatalogHash", "declaration", "policyHash"],
    "source walking policy binding");
  if (binding.kind !== "framework-source-set-walk-binding-v1" ||
      identity(binding.mapId, "binding map ID") !== input.mapId ||
      identity(binding.monsterSetId, "binding monster-set ID") !== input.source.monsterSetId)
    throw new Error("Source walking policy binding identity mismatch");
  const sourceMetadataHash = sha(binding.sourceMetadataHash, "binding metadata SHA");
  sha(binding.battleCatalogHash, "binding battle catalog SHA"); sha(binding.policyHash, "binding policy SHA");
  const declaration = parseSourceWalkPolicyDeclaration(binding.declaration);
  const policy = parseFrameworkWalkEncounterPolicy(input.policy);
  const derived = compileSourceWalkPolicy({ mapId: input.mapId, source: input.source, catalog: input.catalog,
    declaration, sourceMetadataHash });
  if (derived.status !== "ready" || !derived.binding || !derived.policy)
    throw new Error(`Source walking policy binding is not ready: ${derived.diagnostics.map(diagnostic => diagnostic.code).join(", ")}`);
  if (canonical(binding) !== canonical(derived.binding) || canonical(policy) !== canonical(derived.policy))
    throw new Error("Source walking policy binding or policy changed");
}
