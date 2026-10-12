import type { Evidence, FieldEntity, Op, Site } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import { canonical } from "../core/canonical.js";

export type ContentDependencyRoot =
  | { kind: "entry"; mapId: number; entrance: number; continuation: string | null }
  | { kind: "script"; mapId: number; script: string };
export type ContentDependencyEdge = {
  from: string;
  kind: "map" | "entrance" | "script" | "entity-group" | "instruction" | "encounter" | "character";
  reference: string | number;
  target: string | null;
  resolution: "resolved" | "missing" | "ambiguous" | "outside-batch";
  site?: Site | Evidence;
};
export type ContentDependencyDiagnostic = {
  code: string;
  reason: string;
  mapId?: number;
  script?: string;
  index?: number;
  source?: Evidence;
};
export type ContentDependencyAnalysis = {
  roots: ContentDependencyRoot[];
  mapIds: number[];
  edges: ContentDependencyEdge[];
  diagnostics: ContentDependencyDiagnostic[];
  encounterIds: number[];
  requiredMapIds: number[];
  referenceClosure: "closed" | "incomplete";
  runtimeAdmission: "unassessed";
  limitations: string[];
};
type Location = Pick<ContentDependencyDiagnostic, "mapId" | "script" | "index" | "source">;
type Work = ContentDependencyRoot | { kind: "group"; mapId: number; group: string };
const own = (object: object, key: PropertyKey): boolean => Object.hasOwn(object, key);
const mapKey = (id: number): string => `map:${id}`;
const scriptKey = (id: number, name: string): string => `${mapKey(id)}/script:${encodeURIComponent(name)}`;
const groupKey = (id: number, name: string): string => `${mapKey(id)}/group:${encodeURIComponent(name)}`;
const integer = (value: number, min = 0): boolean => Number.isInteger(value) && value >= min && value <= 0x7fffffff;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
function stable<T>(values: Iterable<T>): T[] {
  const byValue = new Map([...values].map((value) => [canonical(value), value]));
  return [...byValue].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
}
function sourceOf(site?: Site | Evidence): Evidence | undefined {
  return site && "source" in site ? site.source : site;
}

/** A conservative graph of references exposed by compiled packages. It does
 * not decode raw source, evaluate flags, instantiate actors, or certify a route.
 * Whole reached scripts/groups are scanned, including conditional branches.
 * The caller verifies artifact bytes; this function verifies their cross-links. */
export function analyzeContentDependencies(input: {
  catalog: WorldCatalog;
  maps: WorldMapContent[];
  roots: ContentDependencyRoot[];
  mapIds: number[];
}): ContentDependencyAnalysis {
  const { catalog } = input;
  if (catalog.kind !== "world-development" || catalog.formatVersion !== 1 ||
      ![catalog.contentHash, catalog.sourceSetHash, catalog.parentSourceSetHash, catalog.mediaSourceSetHash].every(text))
    throw new Error("Invalid dependency catalog identity");
  if (!Array.isArray(input.mapIds) || !input.mapIds.length || input.mapIds.some((id) => !integer(id, 1)) ||
      new Set(input.mapIds).size !== input.mapIds.length)
    throw new Error("Invalid or duplicate dependency batch map identity");
  if (!Array.isArray(input.roots) || !input.roots.length)
    throw new Error("Content dependency roots are required");
  for (const root of input.roots) {
    if (!root || !integer(root.mapId, 1) ||
        (root.kind === "entry" ? !integer(root.entrance) ||
          root.continuation !== null && typeof root.continuation !== "string" :
          root.kind !== "script" || !text(root.script)))
      throw new Error("Invalid content dependency root");
  }
  const maps = new Map<number, WorldMapContent>();
  for (const map of input.maps) {
    const indexed = catalog.maps[String(map.mapId)];
    if (!integer(map.mapId, 1) || maps.has(map.mapId))
      throw new Error("Invalid or duplicate dependency map identity");
    if (!own(catalog.maps, String(map.mapId)) || !indexed || map.kind !== "world-map-development" || map.formatVersion !== 1 ||
        !text(map.contentHash) || map.contentHash !== indexed.contentHash || map.areaId !== indexed.areaId ||
        map.sourceSetHash !== catalog.sourceSetHash || map.parentSourceSetHash !== catalog.parentSourceSetHash ||
        map.mediaSourceSetHash !== catalog.mediaSourceSetHash ||
        map.map !== null && (map.map.identity?.mapId !== map.mapId || map.map.identity.areaId !== map.areaId))
      throw new Error(`Dependency map/catalog identity mismatch: ${map.mapId}`);
    maps.set(map.mapId, map);
  }
  const declared = new Set(input.mapIds), requiredMaps = new Set<number>(), encounters = new Set<number>();
  const edges: ContentDependencyEdge[] = [], diagnostics: ContentDependencyDiagnostic[] = [];
  const queue: Work[] = [], visited = new Set<string>(), inspectedMaps = new Set<number>();
  const diagnose = (code: string, reason: string, location: Location = {}): void => {
    diagnostics.push({ code, reason, ...location });
  };
  const edge = (from: string, kind: ContentDependencyEdge["kind"], reference: string | number,
    target: string | null, resolution: ContentDependencyEdge["resolution"], site?: Site | Evidence): void => {
    const evidence = site && "source" in site ? { script: site.script, index: site.index, source: site.source } : site;
    edges.push({ from, kind, reference, target, resolution, ...(evidence ? { site: evidence } : {}) });
  };
  const location = (mapId: number, site?: Site | Evidence): Location => {
    const source = sourceOf(site);
    return { mapId, ...(source ? { source } : {}), ...(site && "script" in site ? { script: site.script, index: site.index } : {}) };
  };
  function requireMap(from: string, mapId: number, site?: Site | Evidence): WorldMapContent | null {
    if (integer(mapId, 1)) requiredMaps.add(mapId);
    const known = integer(mapId, 1) && own(catalog.maps, String(mapId));
    const resolution = !known ? "missing" : !declared.has(mapId) ? "outside-batch" : maps.has(mapId) ? "resolved" : "missing";
    edge(from, "map", mapId, resolution === "resolved" ? mapKey(mapId) : null, resolution, site);
    if (resolution !== "resolved") {
      diagnose(resolution === "outside-batch" ? "map-outside-batch" : "map-missing",
        resolution === "outside-batch" ? `Map ${mapId} is outside the declared batch` : `Missing compiled map dependency ${mapId}`,
        location(mapId, site));
      return null;
    }
    const map = maps.get(mapId)!;
    if (!inspectedMaps.has(mapId)) {
      inspectedMaps.add(mapId);
      for (const issue of [...catalog.maps[String(mapId)]!.blockers, ...map.blockers])
        diagnose("map-capability-blocked", issue.reason, { mapId, source: issue.source });
      for (const [provider, issues] of [
        ["party-entry", map.partyEntryBlockers], ["camera", map.cameraHostBlockers],
        ["actor-view", map.actorViewBlockers], ["composition", map.nativeCompositionBlockers],
        ["native-foot", map.nativeFootBlockers], ["npc-standby", map.nativeNpcStandbyBlockers],
      ] as const) for (const issue of issues ?? [])
        diagnose("map-provider-blocked", `${provider}: ${issue.reason}`, { mapId, source: issue.source });
      if (!map.map) diagnose("map-geometry-missing", "Compiled map geometry is unavailable", { mapId });
      // A controlled initial FieldGame activates the map's explicit initialGroups.
      // Keep those dependencies even when a later WorldSession entry uses only
      // the default group; never infer activation of other available groups.
      for (const group of new Set(["entity_default", ...(map.map?.initialGroups ?? [])]))
        referenceGroup(mapKey(mapId), map, group, map.map?.source);
    }
    return map;
  }
  function referenceScript(from: string, map: WorldMapContent, name: string, site?: Site | Evidence): void {
    const found = text(name) && own(map.scripts, name) && Array.isArray(map.scripts[name]);
    edge(from, "script", name, found ? scriptKey(map.mapId, name) : null, found ? "resolved" : "missing", site);
    if (!found) diagnose("script-missing", `Missing compiled map-local script ${JSON.stringify(name)}`, location(map.mapId, site));
    else queue.push({ kind: "script", mapId: map.mapId, script: name });
  }
  function referenceGroup(from: string, map: WorldMapContent, name: string, site?: Site | Evidence): void {
    const groups = map.map?.groups;
    const found = text(name) && groups !== undefined && own(groups, name) && groups[name] !== undefined;
    edge(from, "entity-group", name, found ? groupKey(map.mapId, name) : null, found ? "resolved" : "missing", site);
    if (!found) diagnose("entity-group-missing", `Missing compiled entity group ${JSON.stringify(name)}`, location(map.mapId, site));
    else queue.push({ kind: "group", mapId: map.mapId, group: name });
  }
  function referenceEntry(from: string, request: Extract<ContentDependencyRoot, { kind: "entry" }>, site?: Site | Evidence): void {
    const map = requireMap(from, request.mapId, site);
    if (!map) return;
    const entries = map.map?.groups?.entity_default?.entities.filter((entity) => entity.kind === 0 && entity.objectId === request.entrance) ?? [];
    const resolution = !integer(request.entrance) || entries.length === 0 ? "missing" : entries.length > 1 ? "ambiguous" : "resolved";
    edge(from, "entrance", request.entrance,
      resolution === "resolved" ? `${mapKey(request.mapId)}/entrance:${request.entrance}` : null, resolution, site);
    if (resolution !== "resolved") diagnose(`entrance-${resolution}`, `PointIn ${request.entrance} has ${entries.length} compiled candidates`, location(map.mapId, site));
    // WorldSession selects the continuation OR initializer, never both.
    const script = request.continuation || map.initializer;
    if (script !== null) referenceScript(from, map, script, site);
  }
  function inspectEntity(map: WorldMapContent, group: string, entity: FieldEntity): void {
    const from = `${groupKey(map.mapId, group)}/entity:${encodeURIComponent(entity.id)}`;
    if (entity.script !== null) referenceScript(from, map, entity.script, entity.source);
    if (entity.destination) referenceEntry(from, { kind: "entry", ...entity.destination, continuation: null }, entity.source);
    for (const interaction of [entity.npc?.interaction, entity.mapObject?.interaction]) {
      if (interaction?.kind === "script" && interaction.script !== null)
        referenceScript(from, map, interaction.script, entity.source);
      if (interaction?.kind === "blocked") diagnose("interaction-blocked", interaction.reason, { mapId: map.mapId, source: entity.source });
    }
    if (entity.treasure && entity.treasure.scriptId !== 0)
      referenceScript(from, map, entity.treasure.scriptName ?? "", entity.source);
    for (const reason of entity.nativeNpcBlockers ?? [])
      diagnose("entity-provider-blocked", reason, { mapId: map.mapId, source: entity.source });
    if (entity.asset !== null) {
      const found = text(entity.asset) && own(catalog.characters, entity.asset) && !!catalog.characters[entity.asset];
      edge(from, "character", entity.asset, found ? `character:${encodeURIComponent(entity.asset)}` : null, found ? "resolved" : "missing", entity.source);
      if (!found) diagnose("character-missing", `Missing compiled character ${entity.asset}`, { mapId: map.mapId, source: entity.source });
      for (const issue of catalog.characterIssues[entity.asset] ?? [])
        diagnose("character-capability-blocked", issue.reason, { mapId: map.mapId, source: issue.source });
    }
  }
  function instructionTarget(map: WorldMapContent, name: string, ops: Op[], pc: number, target: number, op: Op): void {
    let valid = integer(target) && target < ops.length;
    if (op.kind === "call" || op.kind === "branch-character" || op.kind === "branch-player-direction")
      valid &&= target + 1 < ops.length;
    if (op.kind === "puppet") valid &&= ops.slice(target).some((next) => next.kind === "exit");
    edge(`${scriptKey(map.mapId, name)}/instruction:${pc}`, "instruction", target,
      valid ? `${scriptKey(map.mapId, name)}/instruction:${target}` : null, valid ? "resolved" : "missing", op);
    if (!valid) diagnose("instruction-target-invalid", `Invalid ${op.kind} target ${target} or missing continuation/Exit`,
      { mapId: map.mapId, script: name, index: pc, source: op.source });
  }
  function inspectScript(map: WorldMapContent, name: string): void {
    const ops = map.scripts[name]!;
    if (!ops.length) diagnose("script-empty", `Compiled script ${name} has no instructions`, { mapId: map.mapId, script: name });
    ops.forEach((op, pc) => {
      const from = `${scriptKey(map.mapId, name)}/instruction:${pc}`;
      const at = { mapId: map.mapId, script: name, index: pc, source: op.source };
      switch (op.kind) {
        case "blocked": diagnose("instruction-blocked", `${op.mnemonic}: ${op.reason}`, at); break;
        case "script-transition":
          referenceScript(from, map, op.targetScript, op);
          for (const script of new Set([name, op.targetScript])) {
            if (map.scriptTransitionMetadata?.[script]?.customAnimations !== "none")
              diagnose("script-transition-metadata", `Missing or unsupported custom animation context for ${script}`, at);
            if (!map.scriptLocals || !own(map.scriptLocals, script))
              diagnose("script-transition-locals", `Missing source local declaration for ${script}`, at);
          }
          if (own(map.scripts, op.targetScript) && (map.scripts[op.targetScript]?.length ?? 0) < 2)
            diagnose("script-transition-entry", "ChangeScript target has no continuation at index 1", at);
          break;
        case "encounter":
          if (integer(op.party, 1)) encounters.add(op.party);
          edge(from, "encounter", op.party, integer(op.party, 1) ? `encounter:${op.party}` : null,
            integer(op.party, 1) ? "resolved" : "missing", op);
          if (!integer(op.party, 1)) diagnose("encounter-id-invalid", `Invalid encounter identity ${op.party}`, at);
          referenceScript(from, map, op.continuation, op);
          break;
        case "change-map": referenceEntry(from, { kind: "entry", ...op.request }, op); break;
        case "entities": referenceGroup(from, map, op.group, op); break;
        case "call": case "jump": case "branch": case "branch-character": case "puppet":
          instructionTarget(map, name, ops, pc, op.target, op); break;
        case "branch-player-direction":
          for (const target of op.targets) instructionTarget(map, name, ops, pc, target, op);
          break;
      }
    });
  }
  const roots = stable(structuredClone(input.roots));
  for (const root of roots) {
    const from = `root:${canonical(root)}`;
    if (root.kind === "entry") referenceEntry(from, root);
    else {
      const map = requireMap(from, root.mapId);
      if (map) referenceScript(from, map, root.script);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const work = queue[cursor]!, key = canonical(work);
    if (visited.has(key)) continue;
    visited.add(key);
    const map = maps.get(work.mapId)!;
    if (work.kind === "script") inspectScript(map, work.script);
    else if (work.kind === "group") {
      const group = map.map!.groups![work.group]!;
      for (const issue of group.blockers)
        diagnose("entity-group-blocked", issue.reason, { mapId: map.mapId, source: issue.source });
      for (const entity of group.entities) inspectEntity(map, work.group, entity);
    }
  }
  return structuredClone({ roots, mapIds: [...declared].sort((a, b) => a - b), edges: stable(edges), diagnostics: stable(diagnostics),
    encounterIds: [...encounters].sort((a, b) => a - b), requiredMapIds: [...requiredMaps].sort((a, b) => a - b),
    referenceClosure: diagnostics.length ? "incomplete" : "closed", runtimeAdmission: "unassessed",
    limitations: [
      "Only references exposed by compiled reachable scripts and groups are analyzed; this does not certify the full raw source reference graph.",
      "Every instruction and entity in a reached script/group is inspected conservatively; flags, current groups and story reachability are not inferred.",
      "Default and all explicitly declared initial groups of each reached map are included conservatively; a later WorldSession entry may activate only the default group.",
      "Encounter edges resolve numeric requests only. encounterIds must be checked against the separately supplied battle catalog and live party/AI admission.",
      "Media decoding, native actor/lifecycle providers, dynamic selectors, current state, transaction execution and save/playthrough compatibility require runtime evidence.",
      "Artifact bytes must be verified by the caller; this analysis validates catalog/map identity links and does not instantiate or execute game owners.",
    ],
  } satisfies ContentDependencyAnalysis);
}
