import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { FrameworkContent } from "./framework-content.js";
import type { loadCorpus } from "./corpus.js";
import { bindMapPackages } from "./map-package.js";
import { canonical, hash } from "./content.js";
import { compileFrameworkFieldPresentation, type FrameworkFieldPresentation,
  type FrameworkFieldPresentationInput } from "./framework-field-presentation.js";
import { resolveFieldPresentation } from "../core/field-presentation.js";

export const FRAMEWORK_ORDINARY_PRESENTATION = "framework-ordinary-field-flat-v1" as const;
export type FrameworkOrdinaryAssessment = {
  kind: "framework-ordinary-presentation-assessment-v1";
  mapId: number; sourceMapHash: string; sourceSetHash: string; parentSourceSetHash: string;
  reason: string; mode:"native-preserved"|"flat-alternative"|"unready";
  presentation: FrameworkFieldPresentation | null; blockers: string[]; contentHash: string;
};
export type FrameworkOrdinaryReport = {
  maps: number; available:number; derived: number; nativePreserved:number; unready: number; assessmentsHash: string;
  nativeParity: false; sourceGameplayAdmitted: false;
};
type CorpusInput = Pick<Awaited<ReturnType<typeof loadCorpus>>, "assets" | "tables" | "sourceSetHash" | "manifest">;

function verify(value: { contentHash: string }): void {
  const { contentHash, ...body } = value;
  if (!/^[a-f0-9]{64}$/.test(contentHash) || hash(body) !== contentHash)
    throw new Error("Ordinary presentation content identity mismatch");
}
function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _, ...body } = value; return { ...body, contentHash: hash(body) } as T;
}
export function isOrdinarySourceMap(map: WorldMapContent): boolean {
  return map.entryView?.isWorld === false && map.entryView.loopType === 0;
}

/** This only selects the already bounded flat material policy. Complete raw
 * source layers, package, range and render host are consumed by the existing
 * compiler; palette, real WaterGroup and every other unknown shape still fail. */
export function compileFrameworkOrdinaryPresentation(input: {
  map: WorldMapContent; sources: FrameworkFieldPresentationInput["sources"];
  tilemap: FrameworkFieldPresentationInput["tilemap"];
  mapPackage: FrameworkFieldPresentationInput["mapPackage"];
  renderHost: FrameworkFieldPresentationInput["renderHost"];
}): FrameworkFieldPresentation {
  const { map } = input; verify(map);
  const party = map.partyEntry, camera = map.cameraHost, geometry = map.map;
  if (!isOrdinarySourceMap(map) || !geometry || !party || !camera ||
      map.partyEntryBlockers?.length || map.cameraHostBlockers?.length ||
      party.mapId !== map.mapId || map.entryView!.mapId !== map.mapId || party.loopType !== 0 ||
      camera.loop.horizontal || camera.loop.vertical || geometry.identity?.mapId !== map.mapId ||
      geometry.identity.areaId !== map.areaId || party.width !== geometry.width || party.height !== geometry.height ||
      canonical(camera.mapRange) !== canonical(party.mapRange))
    throw new Error("Ordinary source map geometry, Foot range or camera is unavailable or mismatched");
  const presentation = compileFrameworkFieldPresentation({ policy: FRAMEWORK_ORDINARY_PRESENTATION,
    sources: input.sources, tilemap: input.tilemap, mapPackage: input.mapPackage, renderHost: input.renderHost,
    mapSize: { width: geometry.width, height: geometry.height }, mapRange: party.mapRange });
  const candidate = structuredClone(map);
  candidate.developmentProfile = { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: map.contentHash, omissions: [], fieldPresentation: FRAMEWORK_ORDINARY_PRESENTATION };
  candidate.frameworkPresentation = structuredClone(presentation);
  resolveFieldPresentation(candidate);
  return presentation;
}

/** One source snapshot plus every indexed strict map yields the complete
 * ordinary family, including all failed assessments. No inferred map list or
 * successful recipe subset is an input. */
export function assessFrameworkOrdinaryWorld(corpus: CorpusInput, world: WorldCatalog,
  maps: readonly WorldMapContent[], renderHost: FrameworkFieldPresentationInput["renderHost"], reason: string): FrameworkOrdinaryAssessment[] {
  verify(world);
  if (world.developmentProfile || typeof reason !== "string" || !reason.trim() ||
      world.sourceSetHash !== corpus.sourceSetHash || hash(corpus.manifest.sources)!==corpus.sourceSetHash ||
      world.parentSourceSetHash !== corpus.manifest.parentSourceSetHash)
    throw new Error("Ordinary presentation requires a strict same-source world and explicit reason");
  if (canonical(maps.map(map => map.mapId).sort((a,b) => a-b)) !==
      canonical(Object.keys(world.maps).map(Number).sort((a,b) => a-b)))
    throw new Error("Ordinary presentation assessment requires every indexed strict map");
  const assets = new Map(corpus.assets.map(asset => [asset.id, asset])), bindings = bindMapPackages(corpus.assets, corpus.tables),
    sources = (corpus.manifest.sources as {file:string;sha256:string}[]).map(({file,sha256}) => ({file,sha256}));
  if(assets.size!==corpus.assets.length)throw new Error("Duplicate ordinary physical source identity");
  for (const map of maps) {
    verify(map);
    if (map.developmentProfile || world.maps[String(map.mapId)]?.contentHash !== map.contentHash ||
        map.sourceSetHash !== world.sourceSetHash || map.parentSourceSetHash !== world.parentSourceSetHash)
      throw new Error("Ordinary presentation strict map/source identity mismatch");
  }
  return maps.filter(isOrdinarySourceMap).sort((a,b) => a.mapId-b.mapId).map(map => {
    let presentation: FrameworkFieldPresentation | null = null; const blockers: string[] = [];
    let nativeCompatible=false;try{resolveFieldPresentation(map);nativeCompatible=true;}catch{/* Strict diagnostic remains unchanged. */}
    try {
      const matches = bindings.filter(binding => Number(binding.id) === map.mapId);
      if (matches.length !== 1) throw new Error("Ordinary source map package binding unavailable");
      const tilemap = assets.get(matches[0]!.tilemap ?? ""), mapPackage = assets.get(matches[0]!.packageId ?? "");
      if (!tilemap || !mapPackage || typeof tilemap.source.objectId!=="string" || typeof mapPackage.source.objectId!=="string")
        throw new Error("Ordinary source tilemap/package asset unavailable");
      presentation = compileFrameworkOrdinaryPresentation({map,sources,
        tilemap:{data:tilemap.data,source:{...tilemap.source,objectId:tilemap.source.objectId}},
        mapPackage:{data:mapPackage.data,source:{...mapPackage.source,objectId:mapPackage.source.objectId}},renderHost});
    } catch (error) { blockers.push(String(error instanceof Error ? error.message : error)); }
    return seal({kind:"framework-ordinary-presentation-assessment-v1" as const,mapId:map.mapId,sourceMapHash:map.contentHash,
      sourceSetHash:world.sourceSetHash,parentSourceSetHash:world.parentSourceSetHash,reason,
      mode:presentation===null?"unready" as const:nativeCompatible?"native-preserved" as const:"flat-alternative" as const,
      presentation,blockers,contentHash:""});
  });
}

/** The ordinary alternative composes after periodic presentation and preserves
 * all existing capabilities/sidecars. A declared alternative changes no strict
 * raw body, blockers, source initializer, collision or world applicability. */
export function deriveFrameworkOrdinaryContent(base: FrameworkContent, strictMaps: readonly WorldMapContent[],
  assessments: readonly FrameworkOrdinaryAssessment[]): FrameworkContent {
  verify(base.catalog); verify(base.entry); base.maps.forEach(verify); strictMaps.forEach(verify);
  const ids = Object.keys(base.catalog.maps).map(Number).sort((a,b) => a-b);
  if (base.catalog.kind!=="world-development"||base.entry.kind!=="source-new-game-content-v1"||
      base.maps.some(map=>map.kind!=="world-map-development")||strictMaps.some(map=>map.developmentProfile!==undefined||
        map.sourceSetHash!==base.catalog.sourceSetHash||map.parentSourceSetHash!==base.catalog.parentSourceSetHash)||
      canonical(ids) !== canonical(base.maps.map(map=>map.mapId).sort((a,b)=>a-b)) ||
      canonical(ids) !== canonical(strictMaps.map(map=>map.mapId).sort((a,b)=>a-b)) ||
      base.entry.worldCatalogHash !== base.catalog.contentHash ||
      base.entry.mapContentHash!==base.maps.find(map=>map.mapId===base.entry.entry.mapId)?.contentHash||
      base.maps.some(map=>base.catalog.maps[String(map.mapId)]!.contentHash !== map.contentHash))
    throw new Error("Ordinary derivation requires all maps of one framework generation");
  const original = new Map(strictMaps.map(map=>[map.mapId,map]));
  const family = strictMaps.filter(isOrdinarySourceMap).map(map=>map.mapId).sort((a,b)=>a-b);
  if (canonical(family) !== canonical(assessments.map(row=>row.mapId).sort((a,b)=>a-b)))
    throw new Error("Ordinary derivation requires the complete ordinary family, including all unready maps");
  const selected = new Map(assessments.map(row=>[row.mapId,row]));
  for (const row of assessments) {
    verify(row); const source = original.get(row.mapId)!;
    let nativeCompatible=false;try{resolveFieldPresentation(source);nativeCompatible=true;}catch{/* No source diagnostic is removed. */}
    const expectedMode=row.presentation===null?"unready":nativeCompatible?"native-preserved":"flat-alternative";
    if (row.kind !== "framework-ordinary-presentation-assessment-v1" || row.sourceMapHash !== source.contentHash ||
        row.sourceSetHash !== source.sourceSetHash || row.parentSourceSetHash !== source.parentSourceSetHash ||
        typeof row.reason !== "string" || !row.reason.trim() || row.reason !== assessments[0]!.reason ||
        row.mode!==expectedMode||
        !Array.isArray(row.blockers) || row.blockers.some(v=>typeof v!=="string"||!v.length) ||
        (row.presentation === null ? row.blockers.length === 0 : row.blockers.length !== 0))
      throw new Error("Ordinary derivation source assessment mismatch");
  }
  for (const value of [base.catalog,base.entry,...base.maps])
    if (value.developmentProfile?.kind !== "framework-development-v1" ||
        value.developmentProfile.fieldPresentation !== undefined && value.developmentProfile.fieldPresentation !== FRAMEWORK_ORDINARY_PRESENTATION)
      throw new Error("Ordinary derivation requires a compatible explicit framework profile");
  const declare = (profile: FrameworkContent["catalog"]["developmentProfile"]) =>
    ({...structuredClone(profile),fieldPresentation:FRAMEWORK_ORDINARY_PRESENTATION});
  const maps = base.maps.map(source=>{
    const map=structuredClone(source),strict=original.get(map.mapId)!,assessment=selected.get(map.mapId);
    if (map.developmentProfile.sourceContentHash !== strict.contentHash)
      throw new Error("Ordinary derivative strict map binding mismatch");
    map.developmentProfile=declare(map.developmentProfile);
    if (assessment?.presentation&&assessment.mode==="flat-alternative") {
      if (map.frameworkPresentation) throw new Error("Ordinary presentation alternative conflicts with an existing owner");
      map.frameworkPresentation=structuredClone(assessment.presentation);
      resolveFieldPresentation(map);
    }
    return seal(map);
  });
  const catalog=structuredClone(base.catalog);catalog.developmentProfile=declare(catalog.developmentProfile);
  for (const map of maps) catalog.maps[String(map.mapId)]!.contentHash=map.contentHash;
  const next=seal(catalog),entryMap=maps.find(map=>map.mapId===base.entry.entry.mapId);
  if(!entryMap)throw new Error("Ordinary derivation initial map missing");
  const entry=seal({...structuredClone(base.entry),developmentProfile:declare(base.entry.developmentProfile),
    worldCatalogHash:next.contentHash,mapContentHash:entryMap.contentHash});
  return {catalog:next,maps,entry,report:{...structuredClone(base.report),catalogHash:next.contentHash,entryHash:entry.contentHash,
    maps:maps.map(map=>({mapId:map.mapId,sourceContentHash:map.developmentProfile.sourceContentHash,contentHash:map.contentHash})),
    ordinaryPresentation:{maps:assessments.length,available:assessments.filter(row=>row.presentation).length,
      derived:assessments.filter(row=>row.mode==="flat-alternative").length,nativePreserved:assessments.filter(row=>row.mode==="native-preserved").length,
      unready:assessments.filter(row=>!row.presentation).length,assessmentsHash:hash(assessments),nativeParity:false,sourceGameplayAdmitted:false}}};
}
