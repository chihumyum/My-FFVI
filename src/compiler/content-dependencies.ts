import { compileAssignedRouteProgram } from '../core/field-assigned-route.js';
import { parseFieldNpcRouteCatalog } from '../core/field-npc-route.js';
import type { Evidence, FieldEntity, Op, Site } from "../field/types.js";
import type { SourceWalkEncounterDependencies, SourceWalkEncounterRowEvidence, WorldCatalog, WorldMapContent } from "../field/world.js";
import { tableId } from "./table-id.js";
import { canonical } from "../core/canonical.js";
import { parseFrameworkWalkEncounterPolicy } from "../core/walk-encounters.js";
import { parseSourceBossEncounterCommand } from '../core/source-boss-encounter.js';
import { parseSourceEncounterCommand } from "../core/source-encounter.js";
import { fieldInstructionRequirements, assessFieldRequirements,
  type FieldRequirement, type FieldAdmissionContext } from "../core/field-content-admission.js";

export type ContentDependencyRoot =
  | { kind: "entry"; mapId: number; entrance: number; continuation: string | null }
  | { kind: "script"; mapId: number; script: string };
export type ContentDependencyEdge = {
  from: string;
  kind: "map" | "entrance" | "script" | "entity-group" | "instruction" | "encounter" | "character" | "npc-route" | "audio";
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
export type ContentProviderRequirement = FieldRequirement & { mapId: number };
export type ContentProviderAssessment = ReturnType<typeof assessFieldRequirements> & { mapId: number; site: Site };
/** Optional trusted tooling observations. Content/manifest data never grants
 * a provider, and script-local flags do not establish a live root context. */
export type ContentProviderContext = FieldAdmissionContext | ((instruction: {
  mapId: number; script: string; index: number; op: Op;
}) => FieldAdmissionContext);
export type ContentDependencyAnalysis = {
  roots: ContentDependencyRoot[];
  mapIds: number[];
  edges: ContentDependencyEdge[];
  diagnostics: ContentDependencyDiagnostic[];
  providerRequirements: ContentProviderRequirement[];
  providerAssessments: ContentProviderAssessment[];
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

/** Check decoded values against retained source rows without treating a rate
 * as probability or a zero rate as permission to omit a referenced party. */
export function validateSourceWalkEncounterDependencies(value: SourceWalkEncounterDependencies, mapId: number): void {
  const parsed = (raw: string | null | undefined): number | null => {
    try { const n = tableId(raw); return n >= 0 ? n : null; } catch { return null; }
  };
  const evidence = (source: Evidence): boolean => !!source && text(source.file) && text(source.assetPath) &&
    (source.objectId === undefined || typeof source.objectId === "string" && /^-?\d+$/.test(source.objectId));
  const rowEvidence = (source: SourceWalkEncounterRowEvidence, id: number): boolean =>
    evidence(source) && source.rowId === String(id) && text(source.serializedFile);
  const rawRow = (values: Record<string, string>): boolean => !!values && typeof values === "object" &&
    !Array.isArray(values) && Object.values(values).every(raw => typeof raw === "string");
  if (!value || value.kind !== "source-walk-encounter-dependencies-v1" || value.mapId !== mapId ||
      !Array.isArray(value.slots) || !Array.isArray(value.blockers) || !value.map || !evidence(value.map.source) ||
      !rawRow(value.map.values) || parsed(value.map.values.id) !== mapId ||
      !rowEvidence(value.map.source, mapId) ||
      parsed(value.map.values.monster_set_id) !== value.monsterSetId ||
      value.blockers.some(blocker => blocker.code !== "source-walk-encounter-binding-invalid" || !text(blocker.reason) || !evidence(blocker.source)))
    throw new Error("Source walking dependency header/raw binding mismatch");
  if (value.map.values.encount_area_grid_id !== undefined &&
      (parsed(value.map.values.encount_area_grid_id) === null || parsed(value.map.values.encount_area_grid_id)! > 0) &&
      !value.blockers.length)
    throw new Error("Source walking area-grid dependency diagnostic is missing");
  if (value.monsterSetId === null || value.monsterSetId === 0) {
    if (value.set !== null || value.slots.length || value.monsterSetId === null && !value.blockers.length)
      throw new Error("Source walking empty/unknown set binding mismatch");
    return;
  }
  if (!integer(value.monsterSetId, 1)) throw new Error("Invalid source walking monster-set identity");
  if (value.set === null) {
    if (!value.blockers.length || value.slots.length) throw new Error("Missing source walking set diagnostic");
    return;
  }
  if (!rowEvidence(value.set.source, value.monsterSetId) || !rawRow(value.set.values) || parsed(value.set.values.id) !== value.monsterSetId ||
      value.slots.length < 16) throw new Error("Source walking monster-set row/slot binding mismatch");
  let previous = 0;
  for (const [offset, slot] of value.slots.entries()) {
    if (!integer(slot.index, 1) || slot.index <= previous || offset < 16 && slot.index !== offset + 1 ||
        slot.index > 16 && !value.blockers.length || !rowEvidence(slot.source, value.monsterSetId) ||
        slot.source.file !== value.set.source.file || slot.source.assetPath !== value.set.source.assetPath ||
        slot.source.objectId !== value.set.source.objectId || slot.source.serializedFile !== value.set.source.serializedFile ||
        slot.source.pointer !== `/id/${value.set.source.rowId}/monster_set${slot.index}` ||
        (slot.rawPartyId ?? undefined) !== value.set.values[`monster_set${slot.index}`] ||
        (slot.rawRate ?? undefined) !== value.set.values[`monster_set${slot.index}_rate`] ||
        parsed(slot.rawPartyId) !== slot.partyId || parsed(slot.rawRate) !== slot.rate ||
        (slot.partyId === null || slot.rate === null) && !value.blockers.length)
      throw new Error("Source walking slot/raw binding mismatch");
    previous = slot.index;
  }
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
  providerContext?: ContentProviderContext;
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
  const providerRequirements: ContentProviderRequirement[] = [], providerAssessments: ContentProviderAssessment[] = [];
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
      if (map.sourceWalkEncounters !== undefined) {
        const source = map.sourceWalkEncounters;
        // A malformed rate or row/header must not erase the valid party
        // references still present in its retained raw set. Admission remains
        // blocked below; these edges only describe the source dependency.
        if (source?.set?.values && typeof source.set.values === "object") for (const key of Object.keys(source.set.values)) {
          const match = /^monster_set([1-9]\d*)$/.exec(key);
          if (!match) continue;
          const index = Number(match[1]);
          try {
            const partyId = tableId(source.set.values[key]);
            if (partyId <= 0) continue;
            encounters.add(partyId);
            const site = source.set.source ? { ...source.set.source,
              pointer: `${source.set.source.pointer ?? `/id/${source.monsterSetId}`}/monster_set${index}` } : undefined;
            edge(`${mapKey(mapId)}/source-walk-encounters/slot:${index}`, "encounter", partyId, `encounter:${partyId}`, "resolved", site);
          } catch { /* The raw field and the invalid-binding diagnostic remain. */ }
        }
        try {
          validateSourceWalkEncounterDependencies(source, mapId);
          for (const blocker of source.blockers)
            diagnose(blocker.code, blocker.reason, { mapId, source: blocker.source });
          if (source.monsterSetId !== null && source.monsterSetId > 0)
            diagnose("source-walk-encounter-policy-unimplemented",
              "Source walking encounter timing and lottery have no admitted runtime policy; source rates are retained as observations",
              { mapId, source: source.map.source });
        } catch (error) {
          diagnose("source-walk-encounter-binding-invalid", error instanceof Error ? error.message : String(error),
            { mapId, source: source?.map?.source });
        }
      }
      if (map.walkEncounters !== undefined) {
        try {
          const policy = parseFrameworkWalkEncounterPolicy(map.walkEncounters);
          for (const { partyId } of policy.parties) {
            encounters.add(partyId);
            edge(`${mapKey(mapId)}/walk-encounters`, "encounter", partyId, `encounter:${partyId}`, "resolved");
          }
        } catch (error) {
          diagnose("walk-encounter-policy-invalid", String(error), { mapId });
        }
      }
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
    if (op.kind === "call" || op.kind === "branch-character" || op.kind === "branch-leader" || op.kind === "branch-player-direction" || op.kind === "field-party-query")
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
      const requirements = fieldInstructionRequirements(op);
      if (requirements.length) {
        const site: Site = { script: op.script, index: op.index, source: structuredClone(op.source) };
        const context = input.providerContext === undefined
          ? { providers: {}, actorKind: "unknown" as const }
          : typeof input.providerContext === "function"
            ? input.providerContext({ mapId: map.mapId, script: name, index: pc, op: structuredClone(op) })
            : input.providerContext;
        const assessment = assessFieldRequirements(requirements, structuredClone(context));
        providerRequirements.push(...requirements.map(requirement => ({ ...requirement, mapId: map.mapId })));
        providerAssessments.push({ ...assessment, mapId: map.mapId, site });
      }
      switch (op.kind) {
        case "blocked": diagnose("instruction-blocked", `${op.mnemonic}: ${op.reason}`, at); break;
        case "field-scenario-timer":
          if (op.command === "shadow-setup") referenceScript(from, map, "sc_secede_shadow", op);
          break;
        case "field-timer":
          if (op.command.kind === "set") {
            const names = op.command.callbackScripts;
            if (!Array.isArray(names) || !names.length)
              diagnose("timer-callback-binding-invalid", "SetTimer callback script list is missing or empty", at);
            if (Array.isArray(names)) {
              // The whole literal callback list survives even when the live
              // host cannot admit its lottery; no first-candidate shortcut.
              for (const name of names) {
                if (typeof name !== "string" || !name || name.trim() !== name)
                  diagnose("timer-callback-binding-invalid", "SetTimer contains an invalid callback script name", at);
                else referenceScript(from, map, name, op);
              }
              if (names.length > 1)
                diagnose("timer-callback-lottery-unimplemented",
                  "Multiple SetTimer callback scripts require an admitted source lottery provider", at);
            }
          }
          break;
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
        case 'assign-npc-route': {
          try {
            const routes=map.npcRoutes&&parseFieldNpcRouteCatalog(map.npcRoutes);
            if(!routes||routes.mapId!==map.mapId||routes.sourceSetHash!==map.sourceSetHash||routes.parentSourceSetHash!==map.parentSourceSetHash)
              throw new Error('Assigned route catalog is missing or belongs to another map/source');
            const route=routes.routes[String(op.routeId)];edge(from,'npc-route',op.routeId,route?`${mapKey(map.mapId)}/npc-route:${op.routeId}`:null,route?'resolved':'missing',op);
            if(!route){diagnose('assigned-route-missing','Missing package-local assigned route '+op.routeId,at);break;}
            const targets=Object.values(map.map?.groups??{}).flatMap(g=>g.entities.filter(e=>[6,17].includes(e.kind)&&e.id===String(op.entityId)).map(e=>({g,e})));
            if(targets.length!==1)diagnose('assigned-route-target-invalid','Assigned route target source NPC is missing or ambiguous',at);
            for(const target of targets){referenceGroup(from,map,target.g.name,op);if(target.e.nativeNpc?.controller!=='wait')diagnose('assigned-route-target-invalid','Assigned route requires source Wait NPC startup',at);}
            for(const instruction of compileAssignedRouteProgram(route).instructions){
              for(const reason of instruction.blockers)diagnose('assigned-route-action-blocked',`Route ${route.id} instruction ${instruction.index}: ${reason}`,{...at,source:instruction.source});
              if(instruction.action?.kind==='play-se'){const id=instruction.action.soundId,found=Object.hasOwn(catalog.se?.tracks??{},String(id));
                edge(`${from}/npc-route:${route.id}/instruction:${instruction.index}`,'audio',id,found?`se:${id}`:null,found?'resolved':'missing',instruction.source);
                if(!found)diagnose('assigned-route-audio-missing','Missing assigned route SE '+id,{...at,source:instruction.source});}
            }
          }catch(error){diagnose('assigned-route-catalog-invalid',error instanceof Error?error.message:String(error),at);}
          break;
        }
        case 'source-boss-encounter': {
          try{parseSourceBossEncounterCommand(op.command);}catch(error){diagnose('source-boss-command-invalid',error instanceof Error?error.message:String(error),at);}
          const id=op.command.partyId,valid=integer(id,1);if(valid)encounters.add(id);
          edge(from,'encounter',id,valid?`encounter:${id}`:null,valid?'resolved':'missing',op);
          referenceScript(from,map,op.command.continuation,op);break;
        }
        case "source-encounter": {
          try { parseSourceEncounterCommand(op.command); }
          catch (error) { diagnose("source-encounter-command-invalid", error instanceof Error ? error.message : String(error), at); }
          // Retain each physical slot edge, including repeated IDs. The final
          // catalog request set deduplicates definitions, never probabilities.
          if (Array.isArray(op.command.slots)) for (const [slotIndex, partyId] of op.command.slots.entries()) {
            if (partyId === 0) continue;
            const valid = slotIndex < 4 && integer(partyId, 1), site = { ...op, source: { ...op.source,
              pointer: `${op.source.pointer ?? `/Mnemonics/${op.index}`}/operands/iValues/${slotIndex}` } };
            if (valid) encounters.add(partyId);
            edge(`${from}/source-encounter-slot:${slotIndex}`, "encounter", partyId,
              valid ? `encounter:${partyId}` : null, valid ? "resolved" : "missing", site);
            if (!valid) diagnose("encounter-id-invalid", `Invalid source encounter slot ${slotIndex}: ${partyId}`, at);
          }
          referenceScript(from, map, op.command.continuation, op);
          break;
        }
        case "change-map": referenceEntry(from, { kind: "entry", ...op.request }, op); break;
        case "entities": referenceGroup(from, map, op.group, op); break;
        case "call": case "jump": case "branch": case "branch-character": case "branch-leader": case "field-party-query": case "puppet":
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
    providerRequirements: stable(providerRequirements), providerAssessments: stable(providerAssessments),
    encounterIds: [...encounters].sort((a, b) => a - b), requiredMapIds: [...requiredMaps].sort((a, b) => a - b),
    referenceClosure: diagnostics.length ? "incomplete" : "closed", runtimeAdmission: "unassessed",
    limitations: [
      "Only references exposed by compiled reachable scripts and groups are analyzed; this does not certify the full raw source reference graph.",
      "Every instruction and entity in a reached script/group is inspected conservatively; flags, current groups and story reachability are not inferred.",
      "Default and all explicitly declared initial groups of each reached map are included conservatively; a later WorldSession entry may activate only the default group.",
      "Encounter edges resolve numeric requests only. encounterIds must be checked against the separately supplied battle catalog and live party/AI admission.",
      "Media decoding, native actor/lifecycle providers, dynamic selectors, current state, transaction execution and save/playthrough compatibility require runtime evidence.",
      "Artifact bytes must be verified by the caller; this analysis validates catalog/map identity links and does not instantiate or execute game owners.",
      "Provider requirements and assessments describe potential reached instructions separately from reference diagnostics; they neither remove existing blockers nor certify an executed route.",
      "Provider observations are unknown by default. Tooling may supply explicit runtime facts; map/script metadata does not infer actor bindings, refresh need or the active event root's condition-visual context.",
      "Every literal timer callback name is retained in its origin map/Resident namespace, including unsupported lottery candidates. Expiry timing, cross-map callback delivery and source story applicability remain runtime evidence.",
    ],
  } satisfies ContentDependencyAnalysis);
}
