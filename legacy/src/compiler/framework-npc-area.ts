import { canonical, hash } from "./content.js";
import { compileFieldNpcActivitySources, deriveFrameworkNpcActivity,
  type FieldNpcActivityCorpus, type FieldNpcActivitySources } from "./field-npc-activity.js";
import { parseFrameworkNpcActivityDeclaration, validateFrameworkNpcActivityBinding,
  type FrameworkNpcActivityDeclaration } from "../core/field-npc-activity-source.js";
import type { FieldNpcActivityHost } from "../core/field-npc-activity-host.js";
import type { FrameworkContent } from "./framework-content.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";

export type FrameworkNpcAreaTemplate = Omit<FrameworkNpcActivityDeclaration, "kind" | "sourceHash"> & {
  kind: "framework-npc-area-template-v1";
};
export type FrameworkNpcAreaMapRecord = {
  mapId: number; sourceMapHash: string; sources: FieldNpcActivitySources["definitions"];
  counts: FieldNpcActivitySources["counts"] & { derived: number };
  diagnostics: FieldNpcActivityHost["diagnostics"];
};
export type FrameworkNpcAreaAssessment = {
  kind: "framework-npc-area-assessment-v1"; contentHash: string;
  sourceSetHash: string; parentSourceSetHash: string;
  template: FrameworkNpcAreaTemplate; record: FrameworkNpcAreaMapRecord; host: FieldNpcActivityHost;
};
export type FrameworkNpcAreaReport = {
  template: FrameworkNpcAreaTemplate; maps: FrameworkNpcAreaMapRecord[]; nativeRulesVerified: false;
  counts: { maps: number; declared: number; derived: number; blocked: number };
};

const digest = /^[a-f0-9]{64}$/;
const limitation = "Web Area activity leaves every original dialogue, event, provider and story-reachability blocker visible.";
function keys(value: unknown, expected: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).some(key => typeof key !== "string") ||
      Reflect.ownKeys(value).sort().join(",") !== expected.split(",").sort().join(",") ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !d.enumerable || !Object.hasOwn(d, "value")))
    throw new Error("Invalid framework NPC Area fields");
}
function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _, ...body } = value; return { ...body, contentHash: hash(body) } as T;
}
function verified(value: { contentHash: string }): void {
  const { contentHash, ...body } = value;
  if (!digest.test(contentHash) || hash(body) !== contentHash) throw new Error("Framework NPC Area content hash mismatch");
}
export function parseFrameworkNpcAreaTemplate(raw: unknown): FrameworkNpcAreaTemplate {
  keys(raw, "kind,policy,missingFirstInterval,random,collision,schedule,takeover,reason");
  if (raw.kind !== "framework-npc-area-template-v1") throw new Error("Unknown framework NPC Area template");
  const { sourceHash: _, kind: _kind, ...declaration } = parseFrameworkNpcActivityDeclaration({
    ...raw, kind: "framework-npc-area-declaration-v1", sourceHash: "0".repeat(64),
  });
  return { kind: "framework-npc-area-template-v1", ...declaration };
}
export function frameworkNpcAreaTemplate(reason: string): FrameworkNpcAreaTemplate {
  return parseFrameworkNpcAreaTemplate({ kind: "framework-npc-area-template-v1", policy: "framework-npc-area-v1",
    missingFirstInterval: "source-ctor-true", random: "web-xorshift32-v1", collision: "actor-grid-reservations-v1",
    schedule: "fixed-step-source-order-v1", takeover: "pause-autonomous-motion-v1", reason });
}

/** The same per-map compilation is consumed by global framework derivation
 * and v4/v5 initialized recipes. Failed objects remain complete diagnostics;
 * a successful policy projection is never a map/story readiness claim. */
export function assessFrameworkNpcAreaMap(corpus: FieldNpcActivityCorpus, sourceMap: WorldMapContent,
  rawTemplate: unknown): FrameworkNpcAreaAssessment {
  verified(sourceMap);
  if (sourceMap.developmentProfile !== undefined || sourceMap.frameworkNpcActivity !== undefined ||
      sourceMap.sourceSetHash !== corpus.sourceSetHash || sourceMap.parentSourceSetHash !== corpus.manifest.parentSourceSetHash)
    throw new Error("Framework NPC Area requires the matching strict source map");
  const template = parseFrameworkNpcAreaTemplate(rawTemplate), inventory = compileFieldNpcActivitySources(corpus, sourceMap.mapId),
    bindings: FieldNpcActivityHost["bindings"] = [], diagnostics = structuredClone(inventory.diagnostics);
  for (const source of inventory.definitions) {
    try { bindings.push(deriveFrameworkNpcActivity(source, { ...template,
      kind: "framework-npc-area-declaration-v1", sourceHash: source.contentHash })); }
    catch (error) { diagnostics.push({ code: "framework-npc-area-derivation",
      reason: error instanceof Error ? error.message : String(error), source: source.source }); }
  }
  const host: FieldNpcActivityHost = { kind: "framework-npc-area-host-v1", policy: template.policy,
    sourceMapHash: sourceMap.contentHash, sourceSetHash: sourceMap.sourceSetHash, parentSourceSetHash: sourceMap.parentSourceSetHash,
    bindings, diagnostics, limitations: [...new Set([...inventory.definitions.flatMap(source => source.nativeGaps), limitation])],
    nativeRulesVerified: false };
  const record: FrameworkNpcAreaMapRecord = { mapId: sourceMap.mapId, sourceMapHash: sourceMap.contentHash,
    sources: inventory.definitions, counts: { ...inventory.counts, derived: bindings.length }, diagnostics };
  const body = { kind: "framework-npc-area-assessment-v1" as const, sourceSetHash: sourceMap.sourceSetHash,
    parentSourceSetHash: sourceMap.parentSourceSetHash, template, record, host };
  return { ...structuredClone(body), contentHash: hash(body) };
}

/** Every indexed map is assessed, including empty, inactive and blocked maps.
 * No diagnostics or original raw objects are filtered by execution readiness. */
export function assessFrameworkNpcAreaWorld(corpus: FieldNpcActivityCorpus, sourceCatalog: WorldCatalog,
  sourceMaps: readonly WorldMapContent[], template: unknown): FrameworkNpcAreaAssessment[] {
  verified(sourceCatalog);
  if (sourceCatalog.developmentProfile !== undefined || sourceCatalog.sourceSetHash !== corpus.sourceSetHash ||
      sourceCatalog.parentSourceSetHash !== corpus.manifest.parentSourceSetHash || !Array.isArray(sourceMaps))
    throw new Error("Framework NPC Area requires the matching strict world");
  const ids = new Set<number>();
  for (let i = 0; i < sourceMaps.length; i++) {
    if (!Object.hasOwn(sourceMaps, i)) throw new Error("Sparse framework NPC Area map collection");
    const map = sourceMaps[i]!, index = sourceCatalog.maps[String(map.mapId)];
    if (!index || ids.has(map.mapId) || index.contentHash !== map.contentHash || index.areaId !== map.areaId ||
        map.mediaSourceSetHash !== sourceCatalog.mediaSourceSetHash)
      throw new Error("Framework NPC Area source map index mismatch");
    ids.add(map.mapId);
  }
  if (ids.size !== Object.keys(sourceCatalog.maps).length || Object.keys(sourceCatalog.maps).some(id => !ids.has(Number(id))))
    throw new Error("Framework NPC Area requires the complete source map collection");
  return [...sourceMaps].sort((a, b) => a.mapId - b.mapId).map(map => assessFrameworkNpcAreaMap(corpus, map, template));
}

export function validateFrameworkNpcAreaAssessment(sourceMap: WorldMapContent, value: FrameworkNpcAreaAssessment): void {
  keys(value, "kind,contentHash,sourceSetHash,parentSourceSetHash,template,record,host");
  verified(value); verified(sourceMap);
  if (value.kind !== "framework-npc-area-assessment-v1" || value.record.mapId !== sourceMap.mapId ||
      value.record.sourceMapHash !== sourceMap.contentHash || value.host.sourceMapHash !== sourceMap.contentHash ||
      value.sourceSetHash !== sourceMap.sourceSetHash || value.parentSourceSetHash !== sourceMap.parentSourceSetHash ||
      value.host.sourceSetHash !== value.sourceSetHash || value.host.parentSourceSetHash !== value.parentSourceSetHash)
    throw new Error("Framework NPC Area assessment source binding mismatch");
  const template = parseFrameworkNpcAreaTemplate(value.template);
  if (value.host.kind !== "framework-npc-area-host-v1" || value.host.policy !== template.policy || value.host.nativeRulesVerified !== false ||
      value.record.counts.declared !== value.record.sources.length || value.record.counts.derived !== value.host.bindings.length ||
      canonical(value.record.diagnostics) !== canonical(value.host.diagnostics)) throw new Error("Framework NPC Area assessment inventory mismatch");
  const seen = new Set<string>();
  for (const binding of value.host.bindings) {
    validateFrameworkNpcActivityBinding(binding);
    const key = canonical(binding.source.source);
    if (seen.has(key) || !value.record.sources.some(source => canonical(source) === canonical(binding.source)) ||
        canonical(binding.declaration) !== canonical({ ...template, kind: "framework-npc-area-declaration-v1", sourceHash: binding.source.contentHash }))
      throw new Error("Framework NPC Area assessment omitted or duplicated a source binding");
    seen.add(key);
  }
}

/** Add only the independently assessed sidecar and existing Web policy marker.
 * Original maps/entities/scripts/foot metadata, media and blockers are intact. */
export function deriveFrameworkNpcAreaContent(content: FrameworkContent, sourceMaps: readonly WorldMapContent[],
  assessments: readonly FrameworkNpcAreaAssessment[]): FrameworkContent {
  const originals = new Map(sourceMaps.map(map => [map.mapId, map])), byId = new Map(assessments.map(a => [a.record.mapId, a]));
  if (originals.size !== sourceMaps.length || byId.size !== assessments.length || originals.size !== assessments.length ||
      content.maps.length !== assessments.length || content.maps.some(map => !byId.has(map.mapId)))
    throw new Error("Framework NPC Area requires exact complete assessment coverage");
  let template: FrameworkNpcAreaTemplate | undefined;
  for (const assessment of assessments) {
    const source = originals.get(assessment.record.mapId);
    if (!source) throw new Error("Unknown framework NPC Area assessment map");
    validateFrameworkNpcAreaAssessment(source, assessment);
    if (template && canonical(template) !== canonical(assessment.template)) throw new Error("Mixed framework NPC Area policies");
    template = structuredClone(assessment.template);
  }
  if (!template) throw new Error("Empty framework NPC Area assessment collection");
  const next = structuredClone(content), marker = template.policy;
  for (let i = 0; i < next.maps.length; i++) {
    const map = next.maps[i]!, record = byId.get(map.mapId)!, source = originals.get(map.mapId)!;
    verified(map);
    if (map.developmentProfile.sourceContentHash !== source.contentHash || map.frameworkNpcActivity !== undefined ||
        map.developmentProfile.npcActivity !== undefined) throw new Error("Framework NPC Area cannot replace an existing host");
    map.developmentProfile.npcActivity = marker; map.frameworkNpcActivity = structuredClone(record.host);
    next.maps[i] = seal(map); next.catalog.maps[String(map.mapId)]!.contentHash = next.maps[i]!.contentHash;
  }
  next.catalog.developmentProfile.npcActivity = marker; next.catalog = seal(next.catalog);
  next.entry.developmentProfile.npcActivity = marker; next.entry.worldCatalogHash = next.catalog.contentHash;
  const entryMap = next.maps.find(map => map.mapId === next.entry.entry.mapId);
  if (!entryMap) throw new Error("Framework NPC Area entry map is absent");
  next.entry.mapContentHash = entryMap.contentHash; next.entry = seal(next.entry);
  const records = [...assessments].sort((a, b) => a.record.mapId - b.record.mapId).map(a => structuredClone(a.record)),
    declared = records.reduce((sum, map) => sum + map.counts.declared, 0), derived = records.reduce((sum, map) => sum + map.counts.derived, 0);
  const report: FrameworkNpcAreaReport = { template, maps: records, nativeRulesVerified: false,
    counts: { maps: records.length, declared, derived, blocked: declared - derived } };
  next.report.catalogHash = next.catalog.contentHash; next.report.entryHash = next.entry.contentHash;
  next.report.maps = next.maps.map(map => ({ mapId: map.mapId, sourceContentHash: map.developmentProfile.sourceContentHash, contentHash: map.contentHash }));
  next.report.npcActivity = report;
  return next;
}
