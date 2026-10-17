import type { WorldMapContent } from "../field/world.js";
import type { FieldMapTopology } from "../core/field-map-topology.js";
import { resolveFieldPresentation } from "../core/field-presentation.js";
import { compileFrameworkWorldPresentation } from "./framework-world-presentation.js";
import { compileFrameworkFieldPresentation, type FrameworkFieldPresentationInput } from "./framework-field-presentation.js";
import type { FieldBackgroundMedia } from "./field-background.js";
import { canonical, hash, record } from "./content.js";
import type { FrameworkContent } from "./framework-content.js";

export type FrameworkPeriodicPresentation = {
  mapId: number;
  sourceContentHash: string;
  alternative: NonNullable<WorldMapContent["frameworkPresentation"]>;
  topology: FieldMapTopology;
  textures: Record<string, string>;
};

export type FrameworkPeriodicAssessment = {
  mapId: number;
  sourceContentHash: string;
  presentation: FrameworkPeriodicPresentation | null;
  blockers: string[];
};

/** A whole-family derivation, including every unready map. The caller owns
 * publication and entry URL rebasing; this function changes no strict input. */
export function deriveFrameworkPeriodicContent(base: FrameworkContent,
  assessments: readonly FrameworkPeriodicAssessment[]): FrameworkContent & { periodicReport: {
    maps: FrameworkPeriodicAssessment[];
    compiled: number;
    unready: number;
    sourceGameplayAdmitted: false;
  } } {
  const verify = (value: { contentHash: string }) => {
    const { contentHash, ...body } = value;
    if (hash(body) !== contentHash) throw new Error("Periodic derivation input content identity mismatch");
  };
  verify(base.catalog); verify(base.entry); base.maps.forEach(verify);
  if (base.catalog.kind !== "world-development" || base.entry.kind !== "source-new-game-content-v1" ||
      base.maps.some(map => map.kind !== "world-map-development") ||
      base.entry.worldCatalogHash !== base.catalog.contentHash ||
      base.maps.some(map => base.catalog.maps[map.mapId]?.contentHash !== map.contentHash) ||
      base.maps.length !== Object.keys(base.catalog.maps).length || new Set(base.maps.map(map => map.mapId)).size !== base.maps.length)
    throw new Error("Periodic derivation requires all indexed maps of one framework catalog");
  const periodic = base.maps.filter(map => map.entryView?.loopType), ids = periodic.map(map => map.mapId).sort((a, b) => a - b);
  if (canonical(ids) !== canonical(assessments.map(row => row.mapId).sort((a, b) => a - b)))
    throw new Error("Periodic derivation requires the complete periodic family, including unready maps");
  for (const value of [base.catalog, base.entry, ...base.maps]) {
    if (!value.developmentProfile || value.developmentProfile.kind !== "framework-development-v1" ||
        value.developmentProfile.worldMap !== undefined || value.developmentProfile.fieldPresentation !== undefined)
      throw new Error("Periodic derivation requires an explicit framework input without another presentation upgrade");
  }
  const selected = new Map(assessments.map(row => [row.mapId, row]));
  for (const map of periodic) {
    const row = selected.get(map.mapId)!;
    if (row.sourceContentHash !== map.developmentProfile.sourceContentHash ||
        !Array.isArray(row.blockers) || row.blockers.some(reason => typeof reason !== "string" || !reason.length) ||
        (row.presentation === null ? row.blockers.length === 0 : row.blockers.length !== 0 ||
          row.presentation.mapId !== map.mapId || row.presentation.sourceContentHash !== row.sourceContentHash))
      throw new Error("Periodic derivation source assessment mismatch");
  }
  const seal = <T extends { contentHash: string }>(value: T): T => {
    const { contentHash: _, ...body } = value; return { ...body, contentHash: hash(body) } as T;
  };
  const declare = (profile: FrameworkContent["catalog"]["developmentProfile"]) => ({ ...structuredClone(profile),
    worldMap: "framework-world-map-flat-v1" as const, fieldPresentation: "framework-ordinary-field-flat-v1" as const });
  const maps = base.maps.map(source => {
    const map = structuredClone(source), plan = selected.get(map.mapId)?.presentation;
    map.developmentProfile = declare(map.developmentProfile);
    if (plan) {
      if (!map.map || map.frameworkPresentation) throw new Error("Periodic map geometry or alternative conflict");
      for (const [key, url] of Object.entries(plan.textures))
        if (map.map.textures[key] !== undefined && map.map.textures[key] !== url)
          throw new Error("Periodic map background texture conflict");
      map.frameworkPresentation = structuredClone(plan.alternative);
      map.map.topology = structuredClone(plan.topology);
      Object.assign(map.map.textures, structuredClone(plan.textures));
      resolveFieldPresentation(map);
    }
    return seal(map);
  });
  const catalog = structuredClone(base.catalog); catalog.developmentProfile = declare(catalog.developmentProfile);
  for (const map of maps) catalog.maps[map.mapId]!.contentHash = map.contentHash;
  const nextCatalog = seal(catalog), entryMap = maps.find(map => map.mapId === base.entry.entry.mapId);
  if (!entryMap) throw new Error("Periodic derivation initial map is missing");
  const entry = seal({ ...structuredClone(base.entry), developmentProfile: declare(base.entry.developmentProfile),
    worldCatalogHash: nextCatalog.contentHash, mapContentHash: entryMap.contentHash });
  return { catalog: nextCatalog, entry, maps, report: { ...structuredClone(base.report), catalogHash: nextCatalog.contentHash,
    entryHash: entry.contentHash, maps: maps.map(map => ({ mapId: map.mapId,
      sourceContentHash: map.developmentProfile.sourceContentHash, contentHash: map.contentHash })) },
    periodicReport: { maps: structuredClone([...assessments]), compiled: assessments.filter(row => row.presentation).length,
      unready: assessments.filter(row => !row.presentation).length, sourceGameplayAdmitted: false } };
}

/** Pure alternative display for the entire periodic source-map family. The
 * original namespace, initializers, geometry, anchors and diagnostics remain
 * authoritative. Missing entry/range data never means a full-map default. */
export function compileFrameworkPeriodicPresentation(input: {
  map: WorldMapContent;
  sources: FrameworkFieldPresentationInput["sources"];
  tilemap: FrameworkFieldPresentationInput["tilemap"];
  mapPackage: FrameworkFieldPresentationInput["mapPackage"];
  renderHost: FrameworkFieldPresentationInput["renderHost"];
  backgroundMedia: FieldBackgroundMedia;
  verify: (file: string, sha256: string) => void;
}): FrameworkPeriodicPresentation {
  const { contentHash, ...sourceBody } = input.map;
  if (hash(sourceBody) !== contentHash) throw new Error("Periodic map source content identity mismatch");
  const { map, tilemap, mapPackage } = input, entry = map.entryView, party = map.partyEntry,
    camera = map.cameraHost, geometry = map.map;
  if (!geometry || !party || map.partyEntryBlockers?.length || !camera || map.cameraHostBlockers?.length ||
      !entry || entry.mapId !== map.mapId || entry.loopType === 0 || entry.loopType !== party.loopType ||
      party.mapId !== map.mapId || party.width !== geometry.width || party.height !== geometry.height ||
      canonical(camera.mapRange) !== canonical(party.mapRange) ||
      camera.loop.horizontal !== ((entry.loopType & 1) !== 0) ||
      camera.loop.vertical !== ((entry.loopType & 2) !== 0))
    throw new Error("Periodic map source entry/camera/range is unavailable or mismatched");
  const common = { sources: input.sources, tilemap, mapPackage,
    mapSize: { width: geometry.width, height: geometry.height }, renderHost: input.renderHost };
  const projection = entry.isWorld
    ? compileFrameworkWorldPresentation({ ...common, policy: "framework-world-map-flat-v1",
      backgroundMedia: input.backgroundMedia, verify: input.verify })
    : compileFrameworkFieldPresentation({ ...common, policy: "framework-ordinary-field-flat-v1", mapRange: party.mapRange });
  const textures = "textures" in projection ? projection.textures : {};
  const alternative: NonNullable<WorldMapContent["frameworkPresentation"]> = {
    kind: entry.isWorld ? "framework-world-field-presentation-v1" : "framework-ordinary-field-presentation-v1",
    view: projection.view, composition: projection.composition,
    ...(entry.isWorld ? { backgroundBindings: (record(tilemap.data).layers as unknown[]).flatMap((raw, index) => {
      const layer = record(raw);
      return projection.view.backgrounds.some(background => background.layerId === layer.id)
        ? [{ index, layerId: Number(layer.id) }] : [];
    }) } : {}),
  };
  const topology = { range: structuredClone(party.mapRange), loop: structuredClone(camera.loop) };
  if (geometry.topology && canonical(geometry.topology) !== canonical(topology))
    throw new Error("Periodic source topology disagrees with entry/camera");
  // Validate through the same runtime resolver, without publishing, replacing
  // strict views or clearing any source diagnostics.
  const candidate = structuredClone(map);
  candidate.developmentProfile = { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: map.contentHash, omissions: [], worldMap: "framework-world-map-flat-v1",
    fieldPresentation: "framework-ordinary-field-flat-v1" };
  candidate.frameworkPresentation = alternative;
  candidate.map!.topology = topology;
  Object.assign(candidate.map!.textures, textures);
  resolveFieldPresentation(candidate);
  return { mapId: map.mapId, sourceContentHash: map.contentHash, alternative: structuredClone(alternative),
    topology, textures: structuredClone(textures) };
}
