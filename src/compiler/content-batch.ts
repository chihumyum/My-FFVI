import { z } from "zod";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { FieldContent } from "../field/types.js";
import type { BattleCatalog } from "../core/battle-content.js";
import type { SourceNewGameContent } from "../core/source-new-game.js";
import { parseGameContentRefs } from "../core/game-content-refs.js";
import { parseGameMenuCommand } from "../core/game-menu-command.js";
import { hash, canonical } from "./content.js";
import { analyzeContentDependencies } from "./content-dependencies.js";
import { analyzeBatchEncounters } from "./content-batch-battle.js";

const id = z.number().int().positive().max(0x7fffffff);
const name = z.string().min(1).max(160);
const root = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entry"), mapId: id, entrance: z.number().int().nonnegative(),
    continuation: name.nullable() }).strict(),
  z.object({ kind: z.literal("script"), mapId: id, script: name }).strict(),
]);
const menuCommand = z.unknown().transform((value, context) => {
  try { return parseGameMenuCommand(value); }
  catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
    return z.NEVER;
  }
});
const input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), direction: z.enum(["up", "right", "down", "left"]) }).strict(),
  z.object({ kind: z.literal("confirm") }).strict(),
  z.object({ kind: z.literal("menu"), command: menuCommand }).strict(),
  z.object({ kind: z.literal("save-restore") }).strict(),
]);
// The runtime and compiler consume one reference contract. The manifest does
// not authorize another URL/profile shape or silently fill omitted lanes.
const contentRefs = z.unknown().transform((value, context) => {
  try { return parseGameContentRefs(value); }
  catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
    return z.NEVER;
  }
});
/** Authored routing metadata, never a source-data or saved-state replacement.
 * Inputs are public player actions, dispatched one at a time at stable fields. */
export const ContentBatchManifest = z.object({
  kind: z.literal("content-batch-manifest-v1"), id: name,
  profile: z.enum(["source", "framework"]),
  contentRefs: contentRefs.optional(),
  mapIds: z.array(id).min(1), roots: z.array(root).min(1),
  routes: z.array(z.object({
    id: name, entry: z.enum(["source-new-game", "controlled-fixture"]),
    expectedMapId: id, requiredMapIds: z.array(id).min(1), requiredEncounterIds: z.array(id),
    maxTicks: z.number().int().positive().max(1000000),
    inputs: z.array(input), choiceAnswers: z.array(z.number().int().nonnegative()),
    battleAbilityIds: z.array(id),
  }).strict()).min(1),
}).strict();
export type ContentBatchManifest = z.infer<typeof ContentBatchManifest>;
export type ContentBatchPackages = {
  catalog: WorldCatalog; maps: WorldMapContent[]; battle: BattleCatalog;
  entry: SourceNewGameContent | FieldContent;
};

function verify(value: { contentHash: string }): void {
  const { contentHash, ...payload } = value;
  if (!/^[a-f0-9]{64}$/.test(contentHash) || contentHash !== hash(payload))
    throw new Error("Batch content payload/hash mismatch");
}
function unique(values: (number | string)[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate batch ${label}`);
}

/** Recomputes dependency requirements from the actual packages. Neither an
 * old report nor the manifest can assert readiness on behalf of the owners. */
export function planContentBatch(raw: unknown, packages: ContentBatchPackages) {
  const manifest = ContentBatchManifest.parse(raw), { catalog, maps, battle, entry } = packages;
  unique(manifest.mapIds, "map"); unique(manifest.routes.map(r => r.id), "route");
  for (const route of manifest.routes) {
    unique(route.requiredMapIds, "route map"); unique(route.requiredEncounterIds, "route encounter");
    unique(route.battleAbilityIds, "battle input");
  }
  for (const item of [catalog, ...maps, battle, entry]) verify(item);
  if (manifest.contentRefs) {
    const refs = manifest.contentRefs;
    if (refs.profile !== manifest.profile) throw new Error("Batch content references profile mismatch");
    if (refs.world.contentHash !== catalog.contentHash) throw new Error("Batch world reference/hash mismatch");
    const lane = entry.kind === "source-new-game-content-v1" ? refs.source : refs.development;
    if (lane === null) throw new Error("Batch content references omit the required entry lane");
    if (lane.entry.contentHash !== entry.contentHash || lane.battle.contentHash !== battle.contentHash)
      throw new Error("Batch entry/battle reference/hash mismatch");
  }
  if (maps.length !== manifest.mapIds.length || maps.some(m => !manifest.mapIds.includes(m.mapId)))
    throw new Error("Batch packages must match the declared maps exactly");
  const framework = manifest.profile === "framework";
  for (const item of [catalog, ...maps, entry])
    if ((item.developmentProfile?.kind === "framework-development-v1") !== framework ||
        !framework && "walkEncounters" in item && item.walkEncounters !== undefined)
      throw new Error("Batch content profile mismatch");
  if (!framework && Object.values(battle.encounters).some(e => e.formationPlan?.kind === "development"))
    throw new Error("Batch source profile cannot use development formation selection");
  if (!framework && (Object.hasOwn(battle.common, "escapePolicy") || Object.values(battle.encounters).some(e => e.escapePolicy !== undefined)))
    throw new Error("Batch source profile cannot use development escape policy");
  if (!framework && Object.values(battle.encounters).some(e => e.lifecycle?.mode === "development-omission"))
    throw new Error("Batch source profile cannot omit battle lifecycle scripts");
  if (entry.parentSourceSetHash !== catalog.parentSourceSetHash)
    throw new Error("Batch entry/world source mismatch");
  if (entry.kind === "source-new-game-content-v1") {
    if (entry.worldCatalogHash !== catalog.contentHash || entry.battleCatalogHash !== battle.contentHash ||
        entry.sourceSetHash !== catalog.sourceSetHash ||
        maps.find(m => m.mapId === entry.entry.mapId)?.contentHash !== entry.mapContentHash)
      throw new Error("Batch source entry binding mismatch");
    if (manifest.routes.some(r => r.entry !== "source-new-game")) throw new Error("Batch entry lane mismatch");
  } else {
    if (manifest.routes.some(r => r.entry !== "controlled-fixture") || entry.sourceSetHash !== battle.common.fieldSourceSetHash)
      throw new Error("Batch controlled entry binding mismatch");
    // The initial fixture must be covered by the same map graph, not a hidden
    // extra set of scripts that the batch analyzer never inspected.
    const initialMap = maps.find(m => m.mapId === entry.map.identity?.mapId);
    if (!initialMap || canonical(initialMap.map) !== canonical(entry.map) ||
        canonical(initialMap.scripts) !== canonical(entry.scripts) ||
        canonical(initialMap.walkEncounters ?? null) !== canonical(entry.walkEncounters ?? null))
      throw new Error("Batch controlled entry map/scripts mismatch");
  }
  const dependencies = analyzeContentDependencies({ catalog, maps, roots: manifest.roots, mapIds: manifest.mapIds });
  const encounters = analyzeBatchEncounters(battle, dependencies.encounterIds);
  const diagnostics: { code: string; reason: string }[] = [...dependencies.diagnostics, ...encounters.diagnostics];
  const coveredMaps = new Set(manifest.routes.flatMap(r => r.requiredMapIds));
  const coveredEncounters = new Set(manifest.routes.flatMap(r => r.requiredEncounterIds));
  for (const mapId of manifest.mapIds)
    if (!coveredMaps.has(mapId)) diagnostics.push({ code: "BATCH_MAP_WITHOUT_ROUTE", reason: `Map ${mapId} has no required route` });
  for (const encounterId of dependencies.encounterIds)
    if (!coveredEncounters.has(encounterId)) diagnostics.push({ code: "BATCH_ENCOUNTER_WITHOUT_ROUTE", reason: `Encounter ${encounterId} has no required route` });
  for (const route of manifest.routes) {
    for (const mapId of [...route.requiredMapIds, route.expectedMapId])
      if (!manifest.mapIds.includes(mapId)) diagnostics.push({ code: "BATCH_ROUTE_OUTSIDE_MAPS", reason: `${route.id} requires undeclared map ${mapId}` });
    for (const encounterId of route.requiredEncounterIds)
      if (!dependencies.encounterIds.includes(encounterId)) diagnostics.push({ code: "BATCH_ROUTE_OUTSIDE_ENCOUNTERS", reason: `${route.id} requires unscanned encounter ${encounterId}` });
  }
  const entryMap = entry.kind === "source-new-game-content-v1" ? entry.entry.mapId : entry.map.identity!.mapId;
  if (!manifest.roots.some(r => r.mapId === entryMap && (entry.kind !== "source-new-game-content-v1" ||
      r.kind === "entry" && r.entrance === entry.entry.entrance && r.continuation === entry.entry.reservedScript.name)))
    diagnostics.push({ code: "BATCH_ENTRY_UNSCANNED", reason: "The launched entry is absent from dependency roots" });
  const contentHashes: Record<string, string> = { entry: entry.contentHash, world: catalog.contentHash, battle: battle.contentHash,
    ...Object.fromEntries([...maps].sort((a, b) => a.mapId - b.mapId).map(m => [`map:${m.mapId}`, m.contentHash])) };
  // Legacy routes keep their dependency identity. Extended programs bind the
  // actual ordered commands, not only their aggregate execution counts.
  const routePrograms = manifest.routes.some(r => r.inputs.some(i => i.kind === "menu" || i.kind === "save-restore")) ?
    manifest.routes.map(({ id, inputs }) => ({ id, inputs })) : null;
  const dependencyHash = hash({ contentHashes, dependencies, encounters, diagnostics,
    ...(manifest.contentRefs ? { contentRefs: manifest.contentRefs } : {}),
    ...(routePrograms ? { routePrograms } : {}) });
  return { kind: "content-batch-plan-v1" as const, manifest, manifestHash: hash(manifest), dependencyHash,
    contentHashes, dependencies, encounters, diagnostics,
    runtimeAdmission: "unassessed" as const, sourceCampaignComplete: false as const };
}
