import { z } from "zod";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { FieldContent } from "../field/types.js";
import type { BattleCatalog } from "../core/battle-content.js";
import type { SourceNewGameContent } from "../core/source-new-game.js";
import { assertFrameworkNewGameBindings, type FrameworkNewGameContent } from "../core/framework-new-game.js";
import { parseGameContentRefs } from "../core/game-content-refs.js";
import { parseGameMenuCommand } from "../core/game-menu-command.js";
import { parseGameDevelopmentEntry, validateGameDevelopmentEntryBindings,
  gameDevelopmentEntryBaseline } from "../core/game-development-entry.js";
import { hash, canonical } from "./content.js";
import { analyzeContentDependencies } from "./content-dependencies.js";
import { analyzeBatchEncounters } from "./content-batch-battle.js";
import { assertSourceWalkPolicyBinding } from "./source-walk-policy.js";

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
const shopRequest = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("buy"), productId: id, count: id }).strict(),
  z.object({ kind: z.literal("sell"), contentId: id, count: id }).strict(),
]);
const input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), direction: z.enum(["up", "right", "down", "left"]) }).strict(),
  // Facing is a declared interaction input, never a successful move through
  // an arbitrary wall. Its live target is checked by the same route driver.
  z.object({ kind: z.literal("face"), direction: z.enum(["up", "right", "down", "left"]),
    mapId: id, entityId: name.refine(value => value.trim() === value, "Invalid facing entity identity") }).strict(),
  z.object({ kind: z.literal("confirm") }).strict(),
  z.object({ kind: z.literal("menu"), command: menuCommand }).strict(),
  // Shops remain field interactions. A menu command does not authorize a
  // trade, and a declared group cannot redirect the live shop request.
  z.object({ kind: z.literal("shop"), groupId: id, request: shopRequest }).strict(),
  z.object({ kind: z.literal("leave-shop"), groupId: id }).strict(),
  z.object({ kind: z.literal("save-restore") }).strict(),
]);
const battleIdentity = z.object({ id: name.refine(value => value.trim() === value), sourceId: id }).strict();
const battleTarget = z.union([
  battleIdentity.extend({ ended: z.literal("skip") }).strict(),
  z.object({ kind: z.literal("side"), side: z.enum(["player", "enemy"]),
    members: z.array(battleIdentity).min(1), ended: z.literal("skip") }).strict(),
]);
// This is a declared player-input policy, not another battle executor. Every
// target retains its original identity, including after death or withdrawal.
const battleRule = z.object({
  actor: battleIdentity,
  commandId: id,
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ability"), abilityId: id }).strict(),
    z.object({ kind: z.literal("item"), itemId: id }).strict(),
  ]),
  target: battleTarget,
  when: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("target-alive") }).strict(),
    z.object({ kind: z.literal("target-resource-below"), resource: z.enum(["hp", "mp"]),
      percent: z.number().int().min(1).max(100) }).strict(),
  ]),
  minimumActorMp: z.number().int().nonnegative().max(0x7fffffff).optional(),
  minimumItemCount: id.optional(),
  avoidPendingRecovery: z.literal(true).optional(),
}).strict().superRefine((rule, context) => {
  if (rule.minimumItemCount !== undefined && rule.action.kind !== "item")
    context.addIssue({ code: "custom", message: "Item stock condition requires an item action" });
  if (rule.avoidPendingRecovery && rule.when.kind !== "target-resource-below")
    context.addIssue({ code: "custom", message: "Pending recovery guard requires an explicit resource condition" });
});
const battleInputs = z.array(z.object({ encounterId: id, rules: z.array(battleRule).min(1) }).strict()).min(1);
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
 * Public inputs are dispatched one at a time in their owning field/menu stage. */
export const ContentBatchManifest = z.object({
  kind: z.literal("content-batch-manifest-v1"), id: name,
  profile: z.enum(["source", "framework"]),
  contentRefs: contentRefs.optional(),
  mapIds: z.array(id).min(1), roots: z.array(root).min(1),
  routes: z.array(z.object({
    id: name, entry: z.enum(["source-new-game", "controlled-fixture", "development-map", "framework-new-game"]),
    expectedMapId: id, requiredMapIds: z.array(id).min(1), requiredEncounterIds: z.array(id),
    maxTicks: z.number().int().positive().max(1000000),
    inputs: z.array(input), choiceAnswers: z.array(z.number().int().nonnegative()),
    battleAbilityIds: z.array(id),
    battleInputs: battleInputs.optional(),
  }).strict()).min(1),
}).strict();
export type ContentBatchManifest = z.infer<typeof ContentBatchManifest>;
export type ContentBatchPackages = {
  catalog: WorldCatalog; maps: WorldMapContent[]; battle: BattleCatalog;
  entry: SourceNewGameContent | FieldContent | FrameworkNewGameContent;
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
    if (route.battleInputs) {
      if (route.battleAbilityIds.length) throw new Error("Declared battle inputs cannot mix with legacy ability selection");
      unique(route.battleInputs.map(input => input.encounterId), "battle input encounter");
      if (canonical(route.battleInputs.map(input => input.encounterId).sort((a, b) => a - b)) !==
          canonical([...route.requiredEncounterIds].sort((a, b) => a - b)))
        throw new Error("Declared battle inputs must cover the exact required encounters");
    }
  }
  for (const item of [catalog, ...maps, battle, entry]) verify(item);
  if (manifest.contentRefs) {
    const refs = manifest.contentRefs;
    if (refs.profile !== manifest.profile) throw new Error("Batch content references profile mismatch");
    if (refs.world.contentHash !== catalog.contentHash) throw new Error("Batch world reference/hash mismatch");
    const lane = entry.kind === "source-new-game-content-v1" ? refs.source :
      entry.kind === "framework-new-game-content-v1" ? refs.kind === "game-content-refs-v2" ? refs.initialized : null : refs.development;
    if (lane === null) throw new Error("Batch content references omit the required entry lane");
    if (lane.entry.contentHash !== entry.contentHash || lane.battle.contentHash !== battle.contentHash)
      throw new Error("Batch entry/battle reference/hash mismatch");
  }
  if (maps.length !== manifest.mapIds.length || maps.some(m => !manifest.mapIds.includes(m.mapId)))
    throw new Error("Batch packages must match the declared maps exactly");
  const framework = manifest.profile === "framework";
  for (const map of maps) if (map.frameworkWalkBinding !== undefined) {
    if (!framework || !map.sourceWalkEncounters || !map.walkEncounters)
      throw new Error("Source walking binding requires explicit framework source metadata and policy");
    assertSourceWalkPolicyBinding({ mapId: map.mapId, source: map.sourceWalkEncounters,
      catalog: battle, binding: map.frameworkWalkBinding, policy: map.walkEncounters });
  }
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
  let developmentStart: { mapId: number; entrance: number } | null = null;
  if (entry.kind === "framework-new-game-content-v1") {
    if (!framework || manifest.routes.some(r => r.entry !== "framework-new-game"))
      throw new Error("Batch initialized framework entry lane/profile mismatch");
    const initialMap = maps.find(m => m.mapId === entry.entry.mapId);
    if (!initialMap) throw new Error("Batch initialized framework start map is not declared");
    assertFrameworkNewGameBindings(entry, catalog, initialMap, battle);
    if (!battle.gameState.sourceNewGame) throw new Error("Batch initialized framework source initializer is missing");
    verify({ ...battle.gameState.sourceNewGame, contentHash: entry.initializerHash });
  } else if (entry.kind === "source-new-game-content-v1") {
    if (entry.worldCatalogHash !== catalog.contentHash || entry.battleCatalogHash !== battle.contentHash ||
        entry.sourceSetHash !== catalog.sourceSetHash ||
        maps.find(m => m.mapId === entry.entry.mapId)?.contentHash !== entry.mapContentHash)
      throw new Error("Batch source entry binding mismatch");
    if (manifest.routes.some(r => r.entry !== "source-new-game")) throw new Error("Batch entry lane mismatch");
  } else if (entry.developmentEntry !== undefined) {
    if (!framework) throw new Error("Batch development entry requires the framework profile");
    if (manifest.routes.some(r => r.entry !== "development-map")) throw new Error("Batch development entry lane mismatch");
    const descriptor = parseGameDevelopmentEntry(entry.developmentEntry);
    const initialMap = maps.find(m => m.mapId === descriptor.startMap);
    if (!initialMap) throw new Error("Batch development entry start map is not declared");
    const bound = validateGameDevelopmentEntryBindings(entry, battle, catalog, initialMap);
    verify(gameDevelopmentEntryBaseline(entry, catalog));
    developmentStart = { mapId: bound.startMap, entrance: bound.entrance };
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
  for (const route of manifest.routes) for (const program of route.battleInputs ?? []) {
    const encounter = battle.encounters[program.encounterId];
    if (!encounter || !dependencies.encounterIds.includes(program.encounterId))
      throw new Error("Declared battle input encounter is outside the scanned content");
    const players = battle.gameState.battleDefinitions ?? battle.common.players;
    const identities = [...players, ...encounter.enemies];
    for (const rule of program.rules) {
      const actor = players.find(player => player.id === rule.actor.id && player.sourceId === rule.actor.sourceId);
      const targets = "members" in rule.target ? rule.target.members : [rule.target];
      unique(targets.map(target => target.id), "battle target member");
      const targetKnown = targets.every(target => identities.some(unit => unit.id === target.id && unit.sourceId === target.sourceId));
      const command = battle.common.commands[rule.commandId];
      if (!actor || !targetKnown) throw new Error("Declared battle input actor or target identity is unknown");
      if ("members" in rule.target) {
        const side = rule.target.side === "enemy" ? encounter.enemies : battle.common.players;
        if (canonical([...targets].sort((a, b) => a.id.localeCompare(b.id))) !==
            canonical(side.map(unit => ({ id: unit.id, sourceId: unit.sourceId })).sort((a, b) => a.id.localeCompare(b.id))))
          throw new Error("Declared battle side must bind every original member exactly");
      }
      if (!command || command.kind !== rule.action.kind)
        throw new Error("Declared battle input command identity or kind is unknown");
      if (rule.action.kind === "ability" && (!battle.common.abilities[rule.action.abilityId] ||
          !command.abilityIds.includes(rule.action.abilityId)))
        throw new Error("Declared battle input ability does not belong to its command");
      if (rule.action.kind === "item" && !battle.gameState.items[rule.action.itemId])
        throw new Error("Declared battle input item identity is unknown");
    }
  }
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
  const entryMap = entry.kind === "source-new-game-content-v1" || entry.kind === "framework-new-game-content-v1" ? entry.entry.mapId :
    developmentStart?.mapId ?? entry.map.identity!.mapId;
  if (!manifest.roots.some(r => r.mapId === entryMap && (entry.kind !== "source-new-game-content-v1" ||
      r.kind === "entry" && r.entrance === entry.entry.entrance && r.continuation === entry.entry.reservedScript.name) &&
      (entry.kind !== "framework-new-game-content-v1" || r.kind === "entry" && r.entrance === entry.entry.entrance &&
        r.continuation === (maps.find(map => map.mapId === entry.entry.mapId)?.initializer ?? null)) &&
      (developmentStart === null || r.kind === "entry" && r.entrance === developmentStart.entrance && r.continuation === null)))
    diagnostics.push({ code: "BATCH_ENTRY_UNSCANNED", reason: "The launched entry is absent from dependency roots" });
  const contentHashes: Record<string, string> = { entry: entry.contentHash, world: catalog.contentHash, battle: battle.contentHash,
    ...Object.fromEntries([...maps].sort((a, b) => a.mapId - b.mapId).map(m => [`map:${m.mapId}`, m.contentHash])) };
  // Legacy routes keep their dependency identity. Extended programs bind the
  // actual ordered commands, not only their aggregate execution counts.
  const routePrograms = manifest.routes.some(r => r.inputs.some(i =>
    i.kind === "menu" || i.kind === "save-restore" || i.kind === "shop" || i.kind === "leave-shop")) ?
    manifest.routes.map(({ id, inputs }) => ({ id, inputs })) : null;
  const dependencyHash = hash({ contentHashes, dependencies, encounters, diagnostics,
    ...(manifest.contentRefs ? { contentRefs: manifest.contentRefs } : {}),
    ...(routePrograms ? { routePrograms } : {}),
    ...(manifest.routes.some(route => route.battleInputs) ? {
      battlePrograms: manifest.routes.filter(route => route.battleInputs)
        .map(({ id, battleInputs }) => ({ id, battleInputs })),
    } : {}) });
  return { kind: "content-batch-plan-v1" as const, manifest, manifestHash: hash(manifest), dependencyHash,
    contentHashes, dependencies, encounters, diagnostics,
    runtimeAdmission: "unassessed" as const, sourceCampaignComplete: false as const };
}
