import type { Evidence } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { CorpusAsset, loadCorpus } from "./corpus.js";
import { canonical, hash, record } from "./content.js";
import { tableId } from "./table-id.js";
import { validateSourceWalkEncounterDependencies } from "./content-dependencies.js";

export type SourceBattleRequestSite = {
  kind: "source-walking-slot" | "typed-field-encounter" | "blocked-field-primary" | "unbound-field-primary";
  partyId: number;
  mapId: number | null;
  script: string | null;
  index: number | null;
  slot: string | null;
  source: Evidence;
  rawPartyId: string | number;
  rawRate: string | null;
  /** Full operands survive unknown Encount variants. They grant no execution. */
  rawInstruction: unknown | null;
};
export type SourceBattleRequestDiagnostic = {
  code: string;
  reason: string;
  mapId: number | null;
  script: string | null;
  index: number | null;
  source: Evidence | null;
};
export type SourceBattleRequests = {
  kind: "source-battle-requests-v1";
  contentHash: string;
  sourceSetHash: string;
  parentSourceSetHash: string;
  worldCatalogHash: string;
  mapBindings: { mapId: number; contentHash: string }[];
  requestedPartyIds: number[];
  requests: { partyId: number; onlyBlockedCandidates: boolean; sites: SourceBattleRequestSite[] }[];
  diagnostics: SourceBattleRequestDiagnostic[];
  runtimeAdmission: "unassessed";
};

const identity = (value: unknown): value is number => Number.isInteger(value) &&
  (value as number) > 0 && (value as number) <= 0x7fffffff;
const sourceKey = (source: Evidence): string => JSON.stringify([
  source.file, source.assetPath, source.objectId,
]);
const rawAt = (asset: CorpusAsset, index: number): unknown | null => {
  const data = asset.data;
  return data && typeof data === "object" && !Array.isArray(data) &&
    Array.isArray((data as Record<string, unknown>).Mnemonics)
    ? (data as { Mnemonics: unknown[] }).Mnemonics[index] ?? null : null;
};

/** Whole-world discovery, independent of branch reachability or battle entry.
 * Every typed source reference and blocked literal primary candidate survives.
 * Extra Encount operands and region grids remain explicit unknowns. The caller
 * verifies payload bytes; cross-bindings and completeness are checked here. */
export function collectSourceBattleRequests(input: {
  catalog: WorldCatalog;
  maps: readonly WorldMapContent[];
  corpus: Pick<Awaited<ReturnType<typeof loadCorpus>>, "sourceSetHash" | "manifest" | "assets">;
}): SourceBattleRequests {
  const { catalog, corpus } = input;
  if (catalog.sourceSetHash !== corpus.sourceSetHash ||
      catalog.parentSourceSetHash !== corpus.manifest.parentSourceSetHash || catalog.developmentProfile !== undefined)
    throw new Error("Source battle request world/corpus identity mismatch");
  const maps = new Map<number, WorldMapContent>();
  for (const map of input.maps) {
    const index = catalog.maps[String(map.mapId)];
    if (!identity(map.mapId) || maps.has(map.mapId) || !index || index.contentHash !== map.contentHash ||
        index.areaId !== map.areaId || map.sourceSetHash !== catalog.sourceSetHash ||
        map.parentSourceSetHash !== catalog.parentSourceSetHash || map.mediaSourceSetHash !== catalog.mediaSourceSetHash ||
        map.developmentProfile !== undefined)
      throw new Error("Source battle request map/catalog identity mismatch");
    maps.set(map.mapId, map);
  }
  if (maps.size !== Object.keys(catalog.maps).length || Object.keys(catalog.maps).some(id => !maps.has(Number(id))))
    throw new Error("Source battle requests require every indexed map");
  const assets = new Map<string, CorpusAsset>();
  for (const asset of corpus.assets) {
    const key = sourceKey(asset.source);
    if (assets.has(key)) throw new Error("Ambiguous source battle script identity");
    assets.set(key, asset);
  }
  const references = new Map<number, SourceBattleRequestSite[]>(), diagnostics: SourceBattleRequestDiagnostic[] = [];
  const mappedRaw = new Set<string>();
  const diagnose = (code: string, reason: string, mapId: number | null, source: Evidence | null,
    script: string | null = null, index: number | null = null) => diagnostics.push({ code, reason, mapId, script, index, source });
  const add = (site: SourceBattleRequestSite) => {
    const sites = references.get(site.partyId) ?? [];
    sites.push(structuredClone(site)); references.set(site.partyId, sites);
  };
  const primary = (raw: unknown): number | null => {
    try { const i = record(record(raw).operands).iValues; return Array.isArray(i) && identity(i[0]) ? i[0] : null; }
    catch { return null; }
  };
  for (const map of [...maps.values()].sort((a, b) => a.mapId - b.mapId)) {
    const walking = map.sourceWalkEncounters;
    if (!walking) diagnose("source-battle-walking-metadata-missing", "Source walking dependency metadata is unavailable", map.mapId, map.map?.source ?? null);
    else {
      // Scan retained raw rows first: invalid rates/decoded headers must not
      // hide valid party references from the inspection directory.
      if (walking.set) for (const [key, raw] of Object.entries(walking.set.values)) {
        const match = /^monster_set([1-9]\d*)$/.exec(key); if (!match) continue;
        try {
          const partyId = tableId(raw); if (!identity(partyId)) continue;
          add({ kind: "source-walking-slot", partyId, mapId: map.mapId, script: null, index: null, slot: match[1]!,
            source: { ...walking.set.source, pointer: `/id/${walking.set.source.rowId}/` + key },
            rawPartyId: raw, rawRate: walking.set.values[key + "_rate"] ?? null, rawInstruction: null });
        } catch { /* Retained raw metadata and binding diagnostics cover invalid refs. */ }
      }
      try { validateSourceWalkEncounterDependencies(walking, map.mapId); }
      catch (error) { diagnose("source-walk-encounter-binding-invalid", error instanceof Error ? error.message : String(error), map.mapId, walking.map.source); }
      for (const blocker of walking.blockers) diagnose(blocker.code, blocker.reason, map.mapId, blocker.source);
      if (walking.monsterSetId !== null && walking.monsterSetId > 0)
        diagnose("source-walk-encounter-policy-unimplemented", "Source timing and lottery remain unimplemented", map.mapId, walking.map.source);
    }
    for (const [script, ops] of Object.entries(map.scripts)) for (const op of ops) {
      if (op.kind !== "encounter" && !(op.kind === "blocked" && op.mnemonic === "Encount")) continue;
      const key = sourceKey(op.source), asset = assets.get(key), raw = asset ? rawAt(asset, op.index) : null;
      if (!raw || record(raw).mnemonic !== "Encount") {
        diagnose("source-battle-field-source-missing", "Field encounter has no matching original instruction", map.mapId, op.source, script, op.index);
        continue;
      }
      mappedRaw.add(key + ":" + op.index);
      const partyId = primary(raw);
      if (op.kind === "encounter" && (!identity(op.party) || partyId !== op.party)) {
        diagnose("source-battle-field-source-mismatch", "Typed field encounter disagrees with its original primary operand", map.mapId, op.source, script, op.index);
        if (partyId !== null) add({ kind: "blocked-field-primary", partyId, mapId: map.mapId, script, index: op.index,
          slot: null, source: op.source, rawPartyId: partyId, rawRate: null, rawInstruction: structuredClone(raw) });
        continue;
      }
      if (op.kind === "blocked") diagnose("source-battle-field-variant-unimplemented", op.reason, map.mapId, op.source, script, op.index);
      if (partyId === null) {
        diagnose("source-battle-primary-unresolved", "Source Encount primary operand is not a positive literal identity", map.mapId, op.source, script, op.index);
        continue;
      }
      add({ kind: op.kind === "encounter" ? "typed-field-encounter" : "blocked-field-primary", partyId,
        mapId: map.mapId, script, index: op.index, slot: null, source: op.source,
        rawPartyId: partyId, rawRate: null, rawInstruction: structuredClone(raw) });
    }
  }
  // Raw scripts without a selected alias/map binding still remain visible.
  for (const asset of corpus.assets) {
    const data = asset.data;
    if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).Mnemonics)) continue;
    for (const [index, raw] of ((data as { Mnemonics: unknown[] }).Mnemonics).entries()) {
      if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).mnemonic !== "Encount" ||
          mappedRaw.has(sourceKey(asset.source) + ":" + index)) continue;
      const partyId = primary(raw), source = { ...asset.source, pointer: `/Mnemonics/${index}` };
      diagnose("source-battle-field-map-binding-unresolved", "Original Encount has no matched compiled map/script site", null, source, null, index);
      if (partyId !== null) add({ kind: "unbound-field-primary", partyId, mapId: null, script: null, index, slot: null,
        source, rawPartyId: partyId, rawRate: null, rawInstruction: structuredClone(raw) });
    }
  }
  const requestedPartyIds = [...references.keys()].sort((a, b) => a - b);
  const body = { kind: "source-battle-requests-v1" as const, sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: catalog.parentSourceSetHash, worldCatalogHash: catalog.contentHash,
    mapBindings: [...maps.values()].map(({ mapId, contentHash }) => ({ mapId, contentHash })).sort((a, b) => a.mapId - b.mapId),
    requestedPartyIds, requests: requestedPartyIds.map(partyId => ({ partyId,
      onlyBlockedCandidates: references.get(partyId)!.every(site => ["blocked-field-primary", "unbound-field-primary"].includes(site.kind)),
      sites: references.get(partyId)!.sort((a, b) => canonical(a).localeCompare(canonical(b))) })),
    diagnostics: diagnostics.sort((a, b) => canonical(a).localeCompare(canonical(b))), runtimeAdmission: "unassessed" as const };
  return { ...structuredClone(body), contentHash: hash(body) };
}
