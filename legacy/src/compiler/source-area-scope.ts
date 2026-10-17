import { z } from "zod";
import { canonical, hash } from "./content.js";
import type { Evidence, FieldEntity, MapRequest, Op } from "../field/types.js";
import type { ContentIssue, WorldCatalog, WorldMapContent } from "../field/world.js";
import type { MapPartyEntryDefinition } from "../core/map-party-entry.js";

export type SourceAreaScope = { kind: "source-area-scope-v1"; areaId: number };
const scopeSchema = z.object({ kind: z.literal("source-area-scope-v1"),
  areaId: z.number().int().min(1).max(0x7fffffff) }).strict();

export function parseSourceAreaScope(raw: unknown): SourceAreaScope {
  return scopeSchema.parse(raw);
}

type ProviderBlockers = {
  partyEntry: ContentIssue[]; cameraHost: ContentIssue[]; actorView: ContentIssue[];
  nativeComposition: ContentIssue[]; nativeFoot: ContentIssue[]; nativeNpcStandby: ContentIssue[];
};
export type SourceAreaScopeMap = {
  mapId: number; areaId: number; name: string; url: string; contentHash: string;
  initializer: string | null; geometryPresent: boolean; source: Evidence | null;
  /** Independently compiled source PointIns survive failed map geometry. Missing is unknown. */
  partyEntryPointIns: MapPartyEntryDefinition["pointIns"] | null;
  indexBlockers: ContentIssue[]; blockers: ContentIssue[]; providerBlockers: ProviderBlockers;
  initialGroups: string[];
  groups: { name: string; source: Evidence; blockers: ContentIssue[]; pointIns: FieldEntity[] }[];
  instructionBlockers: Extract<Op, { kind: "blocked" }>[];
};
type BoundaryBase = {
  fromMapId: number; targetMapId: number; entrance: number; continuation: string | null;
  source: Evidence; targetIndexed: boolean;
};
export type SourceAreaScopeBoundary = BoundaryBase & (
  { kind: "entity-exit"; group: string; entityId: string; entity: FieldEntity }
  | { kind: "script-change-map"; script: string; index: number; request: MapRequest }
);
export type SourceAreaScopeReceipt = {
  kind: "source-area-scope-receipt-v1"; contentHash: string; scope: SourceAreaScope;
  catalogHash: string; sourceSetHash: string; parentSourceSetHash: string; mediaSourceSetHash: string;
  mapIds: number[]; maps: SourceAreaScopeMap[]; boundaries: SourceAreaScopeBoundary[];
  worldPhase: "unknown"; storyReachability: "unverified"; runtimeAdmission: "unassessed";
};
export type SourceAreaScopeInput = {
  scope: SourceAreaScope; catalog: WorldCatalog;
  /** Exactly this source area's indexed maps. Blocked or null geometry is still required. */
  maps: readonly WorldMapContent[];
};

const sha = /^[a-f0-9]{64}$/;
function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !sha.test(value)) throw new Error("Invalid source area " + label);
}
function sealed(value: { contentHash: string }, label: string): void {
  digest(value?.contentHash, label + " hash");
  const { contentHash, ...body } = value;
  if (hash(body) !== contentHash) throw new Error("Source area " + label + " content hash mismatch");
}
function identity(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
}
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Immutable selection evidence, not a runtime or story admission. The caller
 * uses verifyContent at its I/O boundary; this pure compiler also checks seals
 * so a modified body cannot reuse its old pin. Membership follows areaId only,
 * never geometry readiness, PointIn availability, or a guessed story variant. */
export function deriveSourceAreaScope(input: SourceAreaScopeInput): SourceAreaScopeReceipt {
  const scope = parseSourceAreaScope(input.scope), { catalog } = input;
  if (!catalog || catalog.kind !== "world-development" || catalog.formatVersion !== 1 ||
      catalog.developmentProfile !== undefined || !catalog.maps || typeof catalog.maps !== "object" || Array.isArray(catalog.maps))
    throw new Error("Source area requires a strict source world catalog");
  sealed(catalog, "catalog");
  for (const key of ["sourceSetHash", "parentSourceSetHash", "mediaSourceSetHash"] as const) digest(catalog[key], key);
  const mapIds = Object.keys(catalog.maps).flatMap(key => {
    const id = Number(key), index = catalog.maps[key]!;
    if (!identity(id) || String(id) !== key || !index || !Number.isInteger(index.areaId))
      throw new Error("Invalid source area world map index");
    return index.areaId === scope.areaId ? [id] : [];
  }).sort((a, b) => a - b);
  if (!mapIds.length) throw new Error("Source area has no indexed maps");
  if (!Array.isArray(input.maps) || input.maps.length !== mapIds.length)
    throw new Error("Source area map set is incomplete or contains extra maps");
  const expected = new Set(mapIds), maps = new Map<number, WorldMapContent>();
  for (const map of input.maps) {
    if (!map || !expected.has(map.mapId) || maps.has(map.mapId))
      throw new Error("Source area map set has a foreign or duplicate identity");
    const index = catalog.maps[String(map.mapId)]!;
    if (map.kind !== "world-map-development" || map.formatVersion !== 1 || map.areaId !== scope.areaId ||
        map.contentHash !== index.contentHash || map.name !== index.name ||
        map.sourceSetHash !== catalog.sourceSetHash || map.parentSourceSetHash !== catalog.parentSourceSetHash ||
        map.mediaSourceSetHash !== catalog.mediaSourceSetHash || map.developmentProfile !== undefined ||
        map.developmentOmissions !== undefined || map.walkEncounters !== undefined ||
        map.frameworkWalkBinding !== undefined || map.frameworkPresentation !== undefined ||
        map.map !== null && (map.map.identity?.mapId !== map.mapId || map.map.identity.areaId !== map.areaId))
      throw new Error("Source area map/catalog source binding mismatch: " + map.mapId);
    sealed(map, "map " + map.mapId);
    maps.set(map.mapId, map);
  }

  const boundaries: SourceAreaScopeBoundary[] = [];
  const selectedMaps = mapIds.map(mapId => {
    const map = maps.get(mapId)!, index = catalog.maps[String(mapId)]!;
    const groups = Object.entries(map.map?.groups ?? {}).sort(([a], [b]) => lexical(a, b)).map(([name, group]) => {
      for (const entity of group.entities) if (entity.destination && !expected.has(entity.destination.mapId)) {
        boundaries.push({ kind: "entity-exit", fromMapId: mapId, targetMapId: entity.destination.mapId,
          entrance: entity.destination.entrance, continuation: null, group: name, entityId: entity.id,
          entity: structuredClone(entity), source: structuredClone(entity.source),
          targetIndexed: Object.hasOwn(catalog.maps, String(entity.destination.mapId)) });
      }
      return { name, source: structuredClone(group.source), blockers: structuredClone(group.blockers),
        pointIns: structuredClone(group.entities.filter(entity => entity.kind === 0)) };
    });
    const instructionBlockers: Extract<Op, { kind: "blocked" }>[] = [];
    for (const [script, ops] of Object.entries(map.scripts).sort(([a], [b]) => lexical(a, b))) for (const op of ops) {
      if (op.kind === "blocked") instructionBlockers.push(structuredClone(op));
      if (op.kind === "change-map" && !expected.has(op.request.mapId))
        boundaries.push({ kind: "script-change-map", fromMapId: mapId, targetMapId: op.request.mapId,
          entrance: op.request.entrance, continuation: op.request.continuation, script, index: op.index,
          request: structuredClone(op.request), source: structuredClone(op.source),
          targetIndexed: Object.hasOwn(catalog.maps, String(op.request.mapId)) });
    }
    return { mapId, areaId: map.areaId, name: map.name, url: index.url, contentHash: map.contentHash,
      initializer: map.initializer, geometryPresent: map.map !== null,
      partyEntryPointIns: map.partyEntry ? structuredClone(map.partyEntry.pointIns) : null,
      source: map.map ? structuredClone(map.map.source) : null,
      indexBlockers: structuredClone(index.blockers), blockers: structuredClone(map.blockers),
      providerBlockers: {
        partyEntry: structuredClone(map.partyEntryBlockers ?? []), cameraHost: structuredClone(map.cameraHostBlockers ?? []),
        actorView: structuredClone(map.actorViewBlockers ?? []), nativeComposition: structuredClone(map.nativeCompositionBlockers ?? []),
        nativeFoot: structuredClone(map.nativeFootBlockers ?? []), nativeNpcStandby: structuredClone(map.nativeNpcStandbyBlockers ?? []),
      }, initialGroups: structuredClone(map.map?.initialGroups ?? []), groups, instructionBlockers };
  });
  const body = { kind: "source-area-scope-receipt-v1" as const, scope,
    catalogHash: catalog.contentHash, sourceSetHash: catalog.sourceSetHash,
    parentSourceSetHash: catalog.parentSourceSetHash, mediaSourceSetHash: catalog.mediaSourceSetHash,
    mapIds, maps: selectedMaps, boundaries, worldPhase: "unknown" as const,
    storyReachability: "unverified" as const, runtimeAdmission: "unassessed" as const };
  return { ...body, contentHash: hash(body) };
}

/** Reconstruct against trusted original source packages. A supplied receipt,
 * recipe map list, successful route, or resealed subset never grants membership. */
export function validateSourceAreaScope(receipt: unknown, input: SourceAreaScopeInput): void {
  const expected = deriveSourceAreaScope(input);
  if (canonical(receipt) !== canonical(expected)) throw new Error("Source area scope receipt binding mismatch");
}
