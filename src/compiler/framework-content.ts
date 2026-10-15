import { deriveFrameworkFieldEffectFlatContent, type FrameworkFieldEffectFlatAssessment } from "./framework-field-effect-flat-projection.js";
import { deriveFrameworkNpcFlatContent, type FrameworkNpcFlatAssessment } from "./framework-npc-flat-projection.js";
import { canonical, hash } from "./content.js";
import { fieldEffectCompilationBlockers } from "./field-effects.js";
import { fieldEffectBoardBlockers, type FieldEffectCatalog } from "../core/field-effects.js";
import { validateLogicalEffectCatalog, WEB_LOGICAL_FIELD_EFFECTS } from "../core/field-logical-effects.js";
import type { DevelopmentOmission, DevelopmentProfile } from "../core/development-profile.js";
import { FRAMEWORK_TRANSPORTATION_LIMITATIONS, FRAMEWORK_STORY_RUNTIME_DECLARATIONS } from "../core/development-profile.js";
import type { SourceNewGameContent } from "../core/source-new-game.js";
import type { EntityGroup, Evidence, FieldEntity } from "../field/types.js";
import type { ContentIssue, WorldCatalog, WorldMapContent } from "../field/world.js";
import { deriveFrameworkPeriodicContent, type FrameworkPeriodicAssessment } from "./framework-periodic-presentation.js";
import { deriveFrameworkOrdinaryContent, type FrameworkOrdinaryAssessment, type FrameworkOrdinaryReport } from "./framework-ordinary-presentation.js";
import { WEB_FIELD_MAP_ANIMATION } from "../core/field-map-animation.js";
import { deriveFrameworkNpcAreaContent, type FrameworkNpcAreaAssessment, type FrameworkNpcAreaReport } from "./framework-npc-area.js";

export type LogicalFieldEffectsDeclaration = {
  kind: "web-logical-field-effects-declaration-v1";
  policy: typeof WEB_LOGICAL_FIELD_EFFECTS;
  sourceSetHash: string; parentSourceSetHash: string; catalogHash: string;
  mapIds: readonly number[]; reason: string;
};
export type FrameworkContentOptions = {
  mapAnimatedEntities?: typeof WEB_FIELD_MAP_ANIMATION;
  logicalFieldEffects?: { catalog: FieldEffectCatalog; declaration: LogicalFieldEffectsDeclaration };
  periodicPresentations?: readonly FrameworkPeriodicAssessment[];
  ordinaryPresentations?: readonly FrameworkOrdinaryAssessment[];
  npcAreaAssessments?: readonly FrameworkNpcAreaAssessment[];
  npcFlatAssessments?: readonly FrameworkNpcFlatAssessment[];
  fieldEffectFlat?: FrameworkFieldEffectFlatAssessment;
};

export type FrameworkContentRetained = {
  mapId: number;
  group: string;
  entityId: string;
  source: Evidence;
  reasons: string[];
};
export type FrameworkContentReport = {
  profile: DevelopmentProfile["kind"];
  policy: DevelopmentProfile["policy"];
  sourceCatalogHash: string;
  sourceEntryHash: string;
  catalogHash: string;
  entryHash: string;
  maps: { mapId: number; sourceContentHash: string; contentHash: string }[];
  omissions: DevelopmentOmission[];
  retained: FrameworkContentRetained[];
  logicalFieldEffects?: { declaration: LogicalFieldEffectsDeclaration; groups: number; additionalOmissions: 0; nativeParity: false };
  periodicReport?: { maps: FrameworkPeriodicAssessment[]; compiled: number; unready: number; sourceGameplayAdmitted: false };
  ordinaryPresentation?: FrameworkOrdinaryReport;
  npcActivity?: FrameworkNpcAreaReport;
  npcProjection?: {maps:number;declared:number;derived:number;unready:number;nativeParity:false};
  fieldEffectProjection?: {maps:number;declared:number;derived:number;unready:number;nativeParity:false};
  transportation: { capability: NonNullable<DevelopmentProfile["transportation"]>; limitations: string[] };
};
export type FrameworkContent = {
  catalog: WorldCatalog & { developmentProfile: DevelopmentProfile };
  maps: (WorldMapContent & { developmentProfile: DevelopmentProfile })[];
  entry: SourceNewGameContent & { developmentProfile: DevelopmentProfile };
  report: FrameworkContentReport;
};

const PROFILE = "framework-development-v1";
const POLICY = "omit-anonymous-environment-particles-v1";
const REASON = "Framework development omits this anonymous, non-interactive environment particle; exact-source playback remains unimplemented.";
const LIMITATION = "Framework development omits source-bound anonymous environment particles and enables an explicit walking/Magitek transportation variant. It preserves parking, release flags, actor identity and current transportation, while vehicle control, collision geometry, encounter-table switching, transport BGM, transport condition removal and native boarding/feet/rider animation are not reproduced. Other story instructions and blockers remain unchanged; this is not exact-source acceptance.";
const ENTITY_KEYS = new Set(["id", "objectId", "kind", "layer", "x", "y", "width", "height", "asset", "direction",
  "script", "collision", "destinationLayer", "source", "effect"]);
const EFFECT_KEYS = new Set(["kind", "assetId", "assetGroup", "assetName", "pixelPosition", "pixelSize", "playOnAwake",
  "front", "split", "zOffset", "affected", "blendType", "zTest", "collision", "building", "birdviewPuppet",
  "screen", "visibleMinimap", "source"]);

function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _, ...payload } = value;
  return { ...payload, contentHash: hash(payload) } as T;
}
function verify(value: { contentHash: string; developmentProfile?: DevelopmentProfile }): void {
  const { contentHash, ...payload } = value;
  if (!/^[a-f0-9]{64}$/.test(contentHash) || hash(payload) !== contentHash)
    throw new Error("Framework input content identity mismatch");
  if (value.developmentProfile !== undefined)
    throw new Error("Framework derivation requires strict input, not an existing development profile");
}
function profile(sourceContentHash: string, omissions: DevelopmentOmission[]): DevelopmentProfile {
  return { kind: PROFILE, policy: POLICY, sourceContentHash, omissions: structuredClone(omissions),
    transportation: "walking-magitek-framework-v1", ...FRAMEWORK_STORY_RUNTIME_DECLARATIONS };
}
function sourceObject(a: Evidence, b: Evidence): boolean {
  const { pointer: _a, ...objectA } = a, { pointer: _b, ...objectB } = b;
  return canonical(objectA) === canonical(objectB);
}
function sameSource(a: Evidence, b: Evidence): boolean {
  return canonical(a) === canonical(b);
}
function affects(issue: ContentIssue, source: Evidence): boolean {
  if (!sourceObject(issue.source, source)) return false;
  const parent = issue.source.pointer;
  return !parent || parent === source.pointer || source.pointer?.startsWith(parent + "/") === true;
}
/** Check every compiled instruction, including currently unreachable branches.
 * Unknown instructions remain blocked in the derivative. Anonymous source
 * boards cannot be addressed through a numeric actor selector (zero is camera).
 * The internal Web identity is nevertheless protected against authored/new ops. */
function referenceStrings(value: unknown, result: Set<string>): void {
  if (typeof value === "string") result.add(value);
  else if (Array.isArray(value)) value.forEach((v) => referenceStrings(v, result));
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) if (key !== "source") referenceStrings(child, result);
}
function expectedParticleBlockers(map: WorldMapContent, entity: FieldEntity): Set<string> {
  const effect = entity.effect!;
  const media = map.fieldEffects?.media[effect.assetGroup];
  // Exact compiler diagnostics only. A string prefix alone is not proof that
  // an unknown blocker is presentation-only.
  return new Set([
    ...fieldEffectCompilationBlockers(effect),
    ...(media ? fieldEffectCompilationBlockers(effect, media) : []),
  ].filter((reason) => reason.startsWith("Field effect particle provider unavailable: ")));
}
function eligibility(map: WorldMapContent, groupKey: string, group: EntityGroup, entity: FieldEntity,
  scriptReferences: ReadonlySet<string>): { reasons: string[]; particleBlockers: Set<string> } {
  const reasons: string[] = [];
  const pointer = /^\/layers\/(0|[1-9]\d*)\/objects\/(0|[1-9]\d*)$/.exec(entity.source.pointer ?? "");
  if (groupKey !== group.name || entity.objectId !== 0 || !pointer ||
      entity.id !== `${group.name}:${pointer[1]}:${pointer[2]}` ||
      !sourceObject(entity.source, group.source))
    reasons.push("Anonymous source entity identity is not established");
  if (Object.keys(entity).some((key) => !ENTITY_KEYS.has(key)) || entity.script !== null ||
      entity.collision !== null || entity.destinationLayer !== null || entity.asset !== null)
    reasons.push("Entity has an interaction, script, collision, media or unknown property");
  if (!Number.isInteger(entity.layer) || entity.layer < 0 || entity.layer > 3 ||
      ![entity.x, entity.y, entity.width, entity.height].every(Number.isFinite) || entity.width <= 0 || entity.height <= 0 ||
      (entity.direction === null || !["up", "right", "down", "left"].includes(entity.direction)))
    reasons.push("Entity placement is unresolved");
  let particleBlockers = new Set<string>();
  try {
    if (!entity.effect || !sameSource(entity.effect.source, entity.source) ||
        Object.keys(entity.effect).some((key) => !EFFECT_KEYS.has(key)))
      throw new Error("Complete source-bound environment effect definition is missing");
    const blockers = fieldEffectBoardBlockers(entity.effect);
    if (blockers.length) reasons.push(...blockers);
    particleBlockers = expectedParticleBlockers(map, entity);
  } catch (error) { reasons.push(error instanceof Error ? error.message : String(error)); }
  if (group.entities.filter((e) => e.id === entity.id || sameSource(e.source, entity.source)).length !== 1)
    reasons.push("Ambiguous entity identity or source object");
  const copies = map.map!.entities.filter((e) => e.id === entity.id || sameSource(e.source, entity.source));
  if (copies.length > 1 || copies.some((e) => canonical(e) !== canonical(entity)))
    reasons.push("Active entity differs from its source group definition");
  if (scriptReferences.has(entity.id))
    reasons.push("A compiled script references this entity identity");
  for (const issue of [...map.blockers, ...group.blockers])
    if (affects(issue, entity.source) &&
        !(sameSource(issue.source, entity.source) && particleBlockers.has(issue.reason)))
      reasons.push("Non-particle source blocker: " + issue.reason);
  return { reasons: [...new Set(reasons)], particleBlockers };
}

/** Produce a separately identified framework world with declared omissions
 * and an explicit transportation integration variant. Callers publish under /framework/;
 * strict packages remain independently loadable and verifiable. */
export function compileFrameworkContent(strictCatalog: WorldCatalog, strictMaps: readonly WorldMapContent[],
  strictEntry: SourceNewGameContent, options: FrameworkContentOptions = {}): FrameworkContent {
  verify(strictCatalog); verify(strictEntry);
  if (strictCatalog.kind !== "world-development" || strictCatalog.formatVersion !== 1 ||
      strictEntry.kind !== "source-new-game-content-v1" ||
      strictEntry.worldCatalogHash !== strictCatalog.contentHash ||
      strictEntry.sourceSetHash !== strictCatalog.sourceSetHash ||
      strictEntry.parentSourceSetHash !== strictCatalog.parentSourceSetHash)
    throw new Error("Framework strict entry/catalog binding mismatch");
  const ids = new Set<number>();
  for (const map of strictMaps) {
    verify(map);
    const indexed = strictCatalog.maps[String(map.mapId)];
    if (!Number.isInteger(map.mapId) || map.mapId <= 0 || ids.has(map.mapId) || !indexed ||
        map.kind !== "world-map-development" || map.formatVersion !== 1 || indexed.contentHash !== map.contentHash ||
        indexed.name !== map.name || indexed.areaId !== map.areaId ||
        map.sourceSetHash !== strictCatalog.sourceSetHash || map.parentSourceSetHash !== strictCatalog.parentSourceSetHash ||
        map.mediaSourceSetHash !== strictCatalog.mediaSourceSetHash ||
        (map.map !== null && (map.map.identity?.mapId !== map.mapId || map.map.identity.areaId !== map.areaId)) ||
        map.developmentOmissions?.length)
      throw new Error("Framework strict map/catalog binding mismatch");
    ids.add(map.mapId);
  }
  if (Object.keys(strictCatalog.maps).length !== ids.size ||
      Object.keys(strictCatalog.maps).some((key) => !ids.has(Number(key)) || String(Number(key)) !== key))
    throw new Error("Framework derivation requires every indexed strict map");
  const initial = strictMaps.find((map) => map.mapId === strictEntry.entry.mapId);
  if (!initial || strictEntry.mapContentHash !== initial.contentHash)
    throw new Error("Framework strict entry/map binding mismatch");

  if (Object.keys(options).some(key => key !== "logicalFieldEffects" && key !== "periodicPresentations" && key !== "ordinaryPresentations" && key !== "mapAnimatedEntities" && key !== "npcAreaAssessments" && key !== "npcFlatAssessments" && key !== "fieldEffectFlat"))
    throw new Error("Unknown framework derivation option");
  if (options.mapAnimatedEntities !== undefined && options.mapAnimatedEntities !== WEB_FIELD_MAP_ANIMATION)
    throw new Error("Unknown framework animated map entity policy");
  const mapAnimatedEntities = options.mapAnimatedEntities;
  const logical = options.logicalFieldEffects === undefined ? undefined : structuredClone(options.logicalFieldEffects);
  if (logical) {
    if (Object.keys(logical).sort().join(",") !== "catalog,declaration") throw new Error("Invalid logical field effects option");
    const d = logical.declaration, policy = logical.catalog.webPolicy;
    if (policy?.boardProjection !== undefined) throw new Error("Flat field effect projection requires its explicit full-source assessment option");
    if (Object.keys(d).sort().join(",") !== "catalogHash,kind,mapIds,parentSourceSetHash,policy,reason,sourceSetHash" ||
        d.kind !== "web-logical-field-effects-declaration-v1" || d.policy !== WEB_LOGICAL_FIELD_EFFECTS ||
        typeof d.reason !== "string" || !d.reason.trim() || !Array.isArray(d.mapIds) ||
        d.mapIds.some(id => !Number.isInteger(id) || id <= 0) || new Set(d.mapIds).size !== d.mapIds.length ||
        canonical([...ids].sort((a,b) => a-b)) !== canonical([...d.mapIds].sort((a,b) => a-b)) ||
        !policy || d.sourceSetHash !== strictCatalog.sourceSetHash || d.parentSourceSetHash !== strictCatalog.parentSourceSetHash ||
        policy.sourceSetHash !== d.sourceSetHash || policy.parentSourceSetHash !== d.parentSourceSetHash ||
        d.catalogHash !== policy.catalogHash || policy.catalogHash !== hash({sourceSetHash:policy.sourceSetHash,
          parentSourceSetHash:policy.parentSourceSetHash,media:logical.catalog.media,proofs:policy.proofs}))
      throw new Error("Logical field effects declaration/catalog/source closure mismatch");
    validateLogicalEffectCatalog(logical.catalog);
  }
  const derivedProfile = (sourceContentHash: string, local: DevelopmentOmission[]): DevelopmentProfile => ({
    ...profile(sourceContentHash, local), ...(mapAnimatedEntities ? { mapAnimatedEntities } : {}), ...(logical ? { logicalFieldEffects: WEB_LOGICAL_FIELD_EFFECTS } : {}),
  });
  const retained: FrameworkContentRetained[] = [], omissions: DevelopmentOmission[] = [], scriptReferences = new Set<string>();
  for (const map of strictMaps) referenceStrings(map.scripts, scriptReferences);
  const maps = [...strictMaps].sort((a, b) => a.mapId - b.mapId).map((strictMap) => {
    const map = structuredClone(strictMap), local: DevelopmentOmission[] = [];
    const removed: { entity: FieldEntity; particleBlockers: Set<string> }[] = [];
    for (const [key, group] of Object.entries(map.map?.groups ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      for (const entity of group.entities.filter((e) => e.kind === 11)) {
        const decision = eligibility(strictMap, key, group, entity, scriptReferences);
        if (decision.reasons.length) {
          retained.push({ mapId: map.mapId, group: key, entityId: entity.id,
            source: structuredClone(entity.source), reasons: decision.reasons });
          continue;
        }
        local.push({ kind: "field-effect", mapId: map.mapId, group: key, entityId: entity.id,
          source: structuredClone(entity.source), sourceMapContentHash: strictMap.contentHash, reason: REASON });
        removed.push({ entity, particleBlockers: decision.particleBlockers });
      }
    }
    // A kind-11 object without a group definition is never inferred to be an
    // environment effect simply because another map had the same shape.
    for (const entity of map.map?.entities.filter((e) => e.kind === 11) ?? []) {
      if (Object.values(map.map?.groups ?? {}).some((group) => group.entities.some((e) =>
        e.id === entity.id && sameSource(e.source, entity.source)))) continue;
      retained.push({ mapId: map.mapId, group: "<unbound-map-entity>", entityId: entity.id,
        source: structuredClone(entity.source), reasons: ["No source group definition"] });
    }
    const isRemoved = (e: FieldEntity) => removed.some(({ entity }) => e.id === entity.id && sameSource(e.source, entity.source));
    const omittedBlocker = (issue: ContentIssue) => removed.some(({ entity, particleBlockers }) =>
      sameSource(issue.source, entity.source) && particleBlockers.has(issue.reason));
    if (map.map) {
      map.map.entities = map.map.entities.filter((e) => !isRemoved(e));
      for (const group of Object.values(map.map.groups ?? {})) {
        group.entities = group.entities.filter((e) => !isRemoved(e));
        group.blockers = group.blockers.filter((issue) => !omittedBlocker(issue));
      }
    }
    const mapAnimationAdmitted = (issue: ContentIssue) => mapAnimatedEntities === WEB_FIELD_MAP_ANIMATION && issue.reason === "Native animated map entity presentation/lifecycle is unbound" &&
      Object.values(map.map?.groups ?? {}).some(group => group.entities.some(entity => entity.kind === 10 &&
        entity.mapAnimation && !entity.mapAnimationBlockers?.length && canonical(entity.source) === canonical(issue.source)));
    if (map.map) for (const group of Object.values(map.map.groups ?? {}))
      group.blockers = group.blockers.filter(issue => !mapAnimationAdmitted(issue));
    map.blockers = map.blockers.filter((issue) => !omittedBlocker(issue) && !mapAnimationAdmitted(issue));
    map.developmentOmissions = local.map(({ kind, group, entityId, source, reason }) =>
      ({ kind, group, entityId, source: structuredClone(source), reason }));
    map.limitations.push(LIMITATION);
    omissions.push(...local);
    return seal({ ...map, ...(logical ? { fieldEffects: structuredClone(logical.catalog) } : {}),
      developmentProfile: derivedProfile(strictMap.contentHash, local) });
  });
  const catalog = structuredClone(strictCatalog);
  for (const map of maps) {
    const index = catalog.maps[String(map.mapId)]!;
    index.url = `/framework/world/maps/${map.mapId}.json`;
    index.contentHash = map.contentHash;
    index.geometryReady = map.map !== null && map.blockers.length === 0;
    index.defaultGroupReady = !!map.map?.groups?.entity_default && map.map.groups.entity_default.blockers.length === 0;
    index.blockers = structuredClone(map.blockers);
  }
  catalog.limitations.push(LIMITATION);
  const derivedCatalog = seal({ ...catalog, developmentProfile: derivedProfile(strictCatalog.contentHash, omissions) });
  const entry = seal({ ...structuredClone(strictEntry), worldCatalogHash: derivedCatalog.contentHash,
    mapContentHash: maps.find((map) => map.mapId === strictEntry.entry.mapId)!.contentHash,
    developmentProfile: derivedProfile(strictEntry.contentHash, omissions) });
  const result: FrameworkContent = { catalog: derivedCatalog, maps, entry,
    report: { profile: PROFILE, policy: POLICY, sourceCatalogHash: strictCatalog.contentHash,
      ...(logical ? { logicalFieldEffects: { declaration: structuredClone(logical.declaration),
        groups: Object.keys(logical.catalog.media).length, additionalOmissions: 0 as const, nativeParity: false as const } } : {}),
      transportation: { capability: "walking-magitek-framework-v1", limitations: [...FRAMEWORK_TRANSPORTATION_LIMITATIONS] },
      sourceEntryHash: strictEntry.contentHash, catalogHash: derivedCatalog.contentHash, entryHash: entry.contentHash,
      maps: maps.map((map) => ({ mapId: map.mapId, sourceContentHash: map.developmentProfile.sourceContentHash,
        contentHash: map.contentHash })), omissions: structuredClone(omissions), retained } };
  let composed = result;
  if (options.periodicPresentations !== undefined) {
    if (!Array.isArray(options.periodicPresentations)) throw new Error("Invalid complete periodic presentation assessments");
    const periodic = deriveFrameworkPeriodicContent(composed, options.periodicPresentations);
    composed = { ...periodic, report: { ...periodic.report, periodicReport: structuredClone(periodic.periodicReport) } };
  }
  if (options.ordinaryPresentations !== undefined) {
    if (!Array.isArray(options.ordinaryPresentations)) throw new Error("Invalid complete ordinary presentation assessments");
    composed = deriveFrameworkOrdinaryContent(composed, strictMaps, options.ordinaryPresentations);
  }
  if (options.npcAreaAssessments !== undefined) {
    if (!Array.isArray(options.npcAreaAssessments)) throw new Error("Invalid complete NPC Area assessments");
    composed = deriveFrameworkNpcAreaContent(composed, strictMaps, options.npcAreaAssessments);
  }
  if (options.npcFlatAssessments !== undefined) {
    if (!Array.isArray(options.npcFlatAssessments)) throw new Error("Invalid complete NPC flat assessments");
    composed = deriveFrameworkNpcFlatContent(composed, strictMaps, options.npcFlatAssessments);
  }
  return options.fieldEffectFlat === undefined ? composed : deriveFrameworkFieldEffectFlatContent(composed, strictMaps, options.fieldEffectFlat);
}
