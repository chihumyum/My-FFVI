import {parseWebBattleForcedSave} from '../core/battle-forced-save.js';
import {parseSourceBattleParticipantPolicy,validateSourceBattleParticipantProof} from './source-battle-participant-closure.js';
import { WEB_BATTLE_BRANCH_EXECUTION } from "../core/battle-branch-execution.js";
import { WEB_MANUAL_BATTLE_CONTROLS } from "../core/battle-controls.js";
import type { BattleCatalog } from "../core/battle-content.js";
import { verifyContent } from "../core/content-integrity.js";
import { assertSourceGameCatalog } from "../core/source-catalog.js";
import { validateBattleDropCatalog } from "../core/battle-rewards.js";
import type { WorldCatalog } from "../field/world.js";
import { analyzeBatchEncounters } from "./content-batch-battle.js";
import { canonical, hash, record } from "./content.js";

export type InitializedBattleSelection = "source-baseline-v1" | "shared-framework-directory-v1";
/** These are the complete, hashed producer documents, not readiness flags or
 * an encounter subset. Their cross-bindings are checked before selection. */
export type InitializedBattleDirectory = {
  frameworkCatalog: BattleCatalog;
  requests: unknown;
  report: unknown;
  strictCatalog?: BattleCatalog;
};
export type InitializedBattleDirectoryBinding = {
  catalogHash: string;
  requestsHash: string;
  reportHash: string;
};

function require(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Initialized battle binding: " + message);
}
const same = (a: unknown, b: unknown, label: string) => require(a !== undefined && b !== undefined &&
  canonical(a) === canonical(b), label + " mismatch");
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identity = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) &&
  value > 0 && value <= 0x7fffffff;
function ids(value: unknown, label: string): number[] {
  require(Array.isArray(value) && value.every(identity), "invalid " + label);
  require(value.every((id, index) => index === 0 || value[index - 1]! < id), "unordered or duplicate " + label);
  return value;
}
function rows(value: unknown, label: string): Record<string, unknown>[] {
  require(Array.isArray(value), "missing " + label);
  return value.map(record);
}
async function document(value: unknown, kind: string): Promise<Record<string, unknown> & { contentHash: string }> {
  const result = record(value);
  require(result.kind === kind && sha(result.contentHash), "invalid " + kind);
  await verifyContent(result as Record<string, unknown> & { contentHash: string });
  return result as Record<string, unknown> & { contentHash: string };
}

/** The only additive common policy needs its exact source-bound producer
 * receipt. Other capabilities and owned initialization remain identical. */
export function validateInitializedBattleSharedCapabilities(base: BattleCatalog, catalog: BattleCatalog,
  directoryReport?: unknown): void {
  same(catalog.gameState, base.gameState, "source initializer and owned catalogs");
  const { drops: before, ...baseCommon } = base.common, { drops: after, ...nextCommon } = catalog.common;
  require(!Object.hasOwn(baseCommon, "conditionControlPolicy"), "strict baseline cannot carry a Web condition policy");
  const report = directoryReport === undefined ? {} : record(directoryReport),
    policy = report.policy === undefined ? {} : record(report.policy),
    framework = policy.framework === undefined ? {} : record(policy.framework);
  const manualPolicy = policy.kind === "source-battle-directory-policy-v3" || ["source-battle-directory-policy-v4", "source-battle-directory-policy-v5", "source-battle-directory-policy-v6"].includes(String(policy.kind));
  if (manualPolicy) same(framework.manualControls, WEB_MANUAL_BATTLE_CONTROLS, "known Web manual controls policy");
  else require(!Object.hasOwn(framework, "manualControls"), "manual controls require the exact v3 or v4 directory declaration");
  if (["source-battle-directory-policy-v4", "source-battle-directory-policy-v5", "source-battle-directory-policy-v6"].includes(String(policy.kind)))
    same(framework.branchExecution, WEB_BATTLE_BRANCH_EXECUTION, "versioned directory branch execution policy");
  else require(!Object.hasOwn(framework, "branchExecution"), "branch execution requires the exact v4 or v5 directory declaration");
  if (Object.hasOwn(nextCommon, "conditionControlPolicy")) {
    const declared = { kind: "web-source-control-actions-v1" };
    require(policy.kind === "source-battle-directory-policy-v2" || manualPolicy, "condition policy requires a known versioned directory declaration");
    same(nextCommon.conditionControlPolicy, declared, "known Web condition policy");
    same(framework.conditionControlPolicy, declared, "declared Web condition policy");
    same(report.policyChanges, [{ kind: "framework-condition-policy-binding-v1",
      field: "common.conditionControlPolicy", from: null, to: declared,
      beforeCommonHash: hash(base.common), afterCommonHash: hash(catalog.common),
      beforeGameStateHash: hash(base.gameState), afterGameStateHash: hash(catalog.gameState),
      beforeCommon: base.common, afterCommon: catalog.common,
    }], "complete condition policy change receipt");
    const { conditionControlPolicy: _, ...unchanged } = nextCommon;
    same(unchanged, baseCommon, "shared battle capabilities");
  } else {
    require(!Object.hasOwn(framework, "conditionControlPolicy") &&
      (report.policyChanges === undefined || canonical(report.policyChanges) === "[]"),
    "condition policy declaration has no bound owner");
    same(nextCommon, baseCommon, "shared battle capabilities");
  }
  if (report.policy !== undefined) {
    const versions = ["source-battle-directory-policy-v1", "source-battle-directory-policy-v2",
      "source-battle-directory-policy-v3", "source-battle-directory-policy-v4", "source-battle-directory-policy-v5", "source-battle-directory-policy-v6"];
    require(versions.includes(String(policy.kind)), "unknown versioned directory policy");
    require(Object.keys(policy).sort().join(",") === "framework,kind", "unknown versioned directory policy fields");
    const allowed = ["handoff", "entry", ...(policy.kind === versions[0] ? [] : ["conditionControlPolicy"]),
      ...(manualPolicy ? ["manualControls"] : []), ...([versions[3],versions[4],versions[5]].includes(String(policy.kind)) ? ["branchExecution"] : []), ...([versions[4],versions[5]].includes(String(policy.kind)) ? ["sourceParticipants"] : []),...(policy.kind===versions[5]?["forcedSavePolicy"]:[])];
    require(Object.keys(framework).every(key => allowed.includes(key)), "unknown versioned directory framework fields");
    if(policy.kind===versions[5])parseWebBattleForcedSave(framework.forcedSavePolicy);
    for(const encounter of Object.values(catalog.encounters)){
      if(encounter.forcedSavePolicy!==undefined){require(policy.kind===versions[5],"forced save requires exact v6 directory policy");same(encounter.forcedSavePolicy,framework.forcedSavePolicy,"declared forced-save policy");}
      if(encounter.lifecycle?.mode==='script'&&encounter.lifecycle.program.instructions.some(({op})=>op.kind==='force-save-return'))require(encounter.forcedSavePolicy!==undefined,"missing bound forced-save encounter policy");
    }
    if([versions[4],versions[5]].includes(String(policy.kind))){
      require(framework.sourceParticipants!==undefined&&report.sourceParticipantClosure!==undefined,"versioned directory dynamic participant proof missing");
      parseSourceBattleParticipantPolicy(framework.sourceParticipants);
      validateSourceBattleParticipantProof(framework.sourceParticipants,report.sourceParticipantClosure,{encounters:catalog.encounters,
        diagnostics:catalog.encounterDiagnostics??[],entryScriptGroups:record(report.entryDependencies).scripts});
    }else require(report.sourceParticipantClosure===undefined,"dynamic participants require the exact v5 directory declaration");
  }
}
function validateSharedContent(base: BattleCatalog, catalog: BattleCatalog, directoryReport?: unknown): void {
  validateInitializedBattleSharedCapabilities(base, catalog, directoryReport);
  const before = base.common.drops, after = catalog.common.drops;
  require(before !== null && after !== null, "directory requires bound drop catalogs");
  validateBattleDropCatalog(before); validateBattleDropCatalog(after);
  same(after.weights, before.weights, "drop weights");
  for (const key of ["monsters", "contents"] as const) {
    for (const row of before[key]) same(after[key].find(next => next.id === row.id), row, "retained drop " + key + " " + row.id);
  }
  const usedMonsters = new Set(Object.values(catalog.encounters).flatMap(encounter => [
    ...encounter.enemies, ...Object.values(encounter.participants?.enemyDefinitions ?? {}),
  ].map(enemy => enemy.sourceId)));
  for (const monster of after.monsters)
    require(before.monsters.some(row => row.id === monster.id) || usedMonsters.has(monster.id), "unreferenced added drop monster");
  const usedContent = new Set(after.monsters.flatMap(monster => monster.slots.flatMap((slot, index) =>
    monster.rate > 0 && after.weights[index]! > 0 && slot.contentId ? [slot.contentId] : [])));
  for (const content of after.contents) {
    if (before.contents.some(row => row.id === content.id)) continue;
    require(usedContent.has(content.id), "unreferenced added drop content");
    require(content.kind === "item" ? base.gameState.items[content.id] :
      base.gameState.equipmentSystem?.catalog.definitions[content.id], "added drop has no source owned definition");
  }
}

function validateCatalogReport(catalog: BattleCatalog, rawSummary: unknown, rawDiagnostics: unknown,
  requested: number[], parentSourceSetHash: string, battleSourceSetHash: string): void {
  const summary = record(rawSummary), { analysis, ...reported } = summary;
  require(catalog.encounterReport && Array.isArray(catalog.encounterDiagnostics), "missing complete encounter compiler evidence");
  same(reported, catalog.encounterReport, "encounter report");
  same(rawDiagnostics, catalog.encounterDiagnostics, "complete encounter diagnostics");
  const entries = catalog.encounterReport.entries;
  same(ids(entries.map(entry => entry.partyId), "encounter report identities"), requested, "complete requested encounter report");
  const compiled = entries.filter(entry => entry.status === "compiled").map(entry => entry.partyId);
  require(entries.every(entry => entry.status === "compiled" || entry.status === "blocked"), "invalid encounter status");
  same(Object.keys(catalog.encounters).map(Number).sort((a, b) => a - b), compiled, "complete encounter definitions");
  const diagnostics = catalog.encounterDiagnostics;
  require(diagnostics.every(d => requested.includes(d.partyId) &&
    ["blocked", "runtime-dependency", "development-omission"].includes(d.kind)), "diagnostic outside directory");
  require(entries.every(entry => (entry.status === "blocked") === diagnostics.some(d =>
    d.partyId === entry.partyId && d.kind === "blocked")), "blocked encounter evidence mismatch");
  for (const [key, expected] of Object.entries({ requested: requested.length, compiledDefinitions: compiled.length,
    blocked: requested.length - compiled.length,
    withRuntimeDependencies: new Set(diagnostics.filter(d => d.kind === "runtime-dependency").map(d => d.partyId)).size,
    withDevelopmentOmissions: new Set(diagnostics.filter(d => d.kind === "development-omission").map(d => d.partyId)).size }))
    require(summary[key] === expected, "encounter summary " + key + " mismatch");
  require(summary.originalGameExecuted === false, "directory is not original-game execution evidence");
  const assessed = analyzeBatchEncounters(catalog, requested);
  same(analysis, { ready: assessed.encounters.filter(entry => entry.status === "ready").length,
    conditional: assessed.encounters.filter(entry => entry.status === "conditional").length,
    blocked: assessed.encounters.filter(entry => entry.status === "blocked").length, entries: assessed.encounters },
  "current complete dependency analysis");
  for (const encounter of Object.values(catalog.encounters)) for (const enemy of [
    ...encounter.enemies, ...Object.values(encounter.participants?.enemyDefinitions ?? {}),
  ]) if (enemy.ai) {
    require(enemy.ai.source && enemy.ai.source.sourceSetHash === parentSourceSetHash &&
      enemy.ai.source.battleSourceSetHash === battleSourceSetHash, "enemy AI source identity mismatch");
  }
}

/** Selects content only. No encounter is removed, no conditional path becomes
 * ready, and no walking scheduler, party member or story flag is granted. */
export async function selectInitializedBattleCatalog(input: {
  selection: InitializedBattleSelection;
  sourceBattle: BattleCatalog;
  sourceWorld: WorldCatalog;
  directory?: InitializedBattleDirectory;
}): Promise<{ catalog: BattleCatalog; directoryBinding: InitializedBattleDirectoryBinding | null }> {
  // Capture the entire candidate before hashing yields to another caller.
  const { selection, sourceBattle, sourceWorld, directory } = structuredClone(input);
  require(selection === "source-baseline-v1" || selection === "shared-framework-directory-v1", "unknown selection");
  await Promise.all([verifyContent(sourceBattle), verifyContent(sourceWorld)]);
  assertSourceGameCatalog(sourceBattle);
  require(sourceWorld.kind === "world-development" && sourceWorld.formatVersion === 1 &&
    sourceWorld.developmentProfile === undefined, "world must be the strict source catalog");
  if (selection === "source-baseline-v1") return { catalog: sourceBattle, directoryBinding: null };
  require(directory, "shared framework directory proof is missing");
  const [requests, report] = await Promise.all([
    document(directory.requests, "source-battle-directory-requests-v1"),
    document(directory.report, "source-battle-directory-build-v1"),
  ]);
  const sourceRequests = await document(requests.sourceRequests, "source-battle-requests-v1");
  const catalog = await verifyContent(directory.frameworkCatalog);
  assertSourceGameCatalog(catalog, "framework"); validateSharedContent(sourceBattle, catalog, report);
  require(report.baselineHash === sourceBattle.contentHash && report.frameworkCatalogHash === catalog.contentHash &&
    report.requestsHash === requests.contentHash && sha(report.strictCatalogHash), "directory payload binding mismatch");
  for (const proof of [requests, sourceRequests, report])
    require(proof.sourceSetHash === sourceWorld.sourceSetHash && proof.parentSourceSetHash === sourceWorld.parentSourceSetHash,
      "directory source identity mismatch");
  require(sourceRequests.worldCatalogHash === sourceWorld.contentHash && sourceRequests.runtimeAdmission === "unassessed",
    "directory source world binding mismatch");
  require(typeof report.battleSourceSetHash === "string" && report.battleSourceSetHash.length > 0, "missing battle source identity");
  const mapBindings = Object.entries(sourceWorld.maps).map(([id, map]) => ({ mapId: Number(id), contentHash: map.contentHash }))
    .sort((a, b) => a.mapId - b.mapId);
  require(mapBindings.every(map => identity(map.mapId) && sha(map.contentHash)), "invalid source map index");
  same(sourceRequests.mapBindings, mapBindings, "complete source world map bindings");
  const retained = record(requests.retainedBase);
  require(retained.catalogHash === sourceBattle.contentHash, "retained baseline mismatch");
  const retainedIds = [...new Set(sourceBattle.encounterReport?.entries.map(entry => entry.partyId) ?? [])].sort((a, b) => a - b);
  same(ids(retained.partyIds, "retained baseline parties"), retainedIds, "retained baseline parties");
  const sourceIds = ids(sourceRequests.requestedPartyIds, "source requested parties"), sourceSites = rows(sourceRequests.requests, "source sites");
  same(sourceSites.map(site => site.partyId), sourceIds, "complete source request sites");
  for (const request of sourceSites) {
    const sites = rows(request.sites, "party source sites");
    require(sites.length > 0 && sites.every(site => site.partyId === request.partyId &&
      (site.mapId === null || mapBindings.some(map => map.mapId === site.mapId))), "source request site binding mismatch");
  }
  const requested = ids(requests.requestedPartyIds, "directory parties");
  same(requested, [...new Set([...sourceIds, ...retainedIds])].sort((a, b) => a - b), "complete source and baseline requests");
  same(report.requestedPartyIds, requested, "build report requested parties");
  const diagnostics = record(report.diagnostics);
  require(Array.isArray(sourceRequests.diagnostics), "missing source request diagnostics");
  same(diagnostics.requests, sourceRequests.diagnostics, "source request diagnostics");
  validateCatalogReport(catalog, report.framework, diagnostics.framework, requested,
    sourceWorld.parentSourceSetHash, report.battleSourceSetHash);
  if (directory.strictCatalog !== undefined) {
    const strict = await verifyContent(directory.strictCatalog, report.strictCatalogHash);
    assertSourceGameCatalog(strict); validateSharedContent(sourceBattle, strict);
    validateCatalogReport(strict, report.strict, diagnostics.strict, requested,
      sourceWorld.parentSourceSetHash, report.battleSourceSetHash);
  }
  return { catalog, directoryBinding: { catalogHash: catalog.contentHash, requestsHash: requests.contentHash, reportHash: report.contentHash } };
}
