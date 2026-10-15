import type { planContentBatch } from "./content-batch.js";
import type { ContentDependencyDiagnostic, ContentProviderAssessment, ContentProviderRequirement } from "./content-dependencies.js";
import type { FieldCapability } from "../core/field-content-admission.js";
import { canonical } from "../core/canonical.js";

export type ContentBatchPlan = ReturnType<typeof planContentBatch>;
export const CONTENT_BATCH_SYSTEMS = [
  "entry-and-session", "map-event-and-travel", "battle-and-return",
  "owned-menus-economy-and-growth", "save-restore-and-continuation", "content-batch-interface", "unclassified",
] as const;
export type ContentBatchSystem = typeof CONTENT_BATCH_SYSTEMS[number];
export type ContentBatchWorkCounts = {
  diagnostics: number;
  providerRequirements: number;
  providerAssessments: number;
};
export type ContentBatchWorkDiagnostic = {
  index: number;
  owner: ContentBatchSystem;
  diagnostic: ContentBatchPlan["diagnostics"][number];
  /** All matching source locations, each retaining its original array index.
   * Matching never chooses the first of several locations or consumes one. */
  dependencyLocations: { index: number; diagnostic: ContentDependencyDiagnostic }[];
};
export type ContentBatchWorkPlan = {
  kind: "content-batch-work-plan-v1";
  batchId: string;
  profile: ContentBatchPlan["manifest"]["profile"];
  manifestHash: string;
  dependencyHash: string;
  contentHashes: Record<string, string>;
  countUnit: "diagnostic-and-provider-records";
  counts: ContentBatchWorkCounts & { unclassifiedDiagnostics: number };
  diagnostics: ContentBatchWorkDiagnostic[];
  providerRequirements: { index: number; owner: ContentBatchSystem; requirement: ContentProviderRequirement }[];
  providerAssessments: { index: number; owners: ContentBatchSystem[]; assessment: ContentProviderAssessment }[];
  workItems: {
    id: ContentBatchSystem;
    label: string;
    existingOwners: string[];
    publicInterfaces: string[];
    diagnosticIndices: number[];
    providerRequirementIndices: number[];
    providerAssessmentIndices: number[];
    counts: ContentBatchWorkCounts;
    implementation: {
      scope: string;
      parallelPreparation: "pure-rules-and-provider-candidates";
      publication: "existing-owner-transaction";
      integration: "root-owned-cross-system-integration";
    };
  }[];
  runtimeAdmission: "unassessed";
  sourceCampaignComplete: false;
  limitations: string[];
};

const systemDetails: Record<ContentBatchSystem, {
  label: string; existingOwners: string[]; publicInterfaces: string[]; scope: string;
}> = {
  "entry-and-session": { label: "入口与会话", existingOwners: ["GameSession", "GameFlow"],
    publicInterfaces: ["GameContentRepository", "GameEntryLoader"],
    scope: "Prepare and publish a trusted entry with the existing session and Flow ticket." },
  "map-event-and-travel": { label: "地图、事件与切图", existingOwners: ["WorldSession", "FieldGame"],
    publicInterfaces: ["GameMapLoader", "FieldPuppetActors", "Renderer"],
    scope: "Close shared map/event/provider contracts; rendering stays a host boundary of this system." },
  "battle-and-return": { label: "战斗、重试与返场", existingOwners: ["BattleGame", "GameSession", "GameState"],
    publicInterfaces: ["GameBattleHandoff"],
    scope: "Prepare battle dependencies and preserve the existing lease, fixed retry and once-only return." },
  "owned-menus-economy-and-growth": { label: "持有菜单、经济与成长", existingOwners: ["GameState"],
    publicInterfaces: ["GameCommands", "GameSession"],
    scope: "Use the held roster, inventory and progression transactions with their shared actor preparation." },
  "save-restore-and-continuation": { label: "存读档与续行", existingOwners: ["GameSession", "WorldSession", "GameState"],
    publicInterfaces: ["CheckpointStorage", "GameEntryLoader"],
    scope: "Bind saves to trusted content and resume through a new owner without replaying initialization or rewards." },
  "content-batch-interface": { label: "批量内容接口", existingOwners: [],
    publicInterfaces: ["planContentBatch", "runContentBatchRoute"],
    scope: "Close declared route/reference coverage through the existing game owners; create no gameplay owner." },
  unclassified: { label: "未归类", existingOwners: [], publicInterfaces: [],
    scope: "Identify the responsible shared contract from retained evidence before assigning implementation." },
};

/** These are exact published codes, not a prefix, mnemonic or reason guess.
 * Unknown compiler codes remain visible under unclassified. */
const diagnosticOwners: Readonly<Record<string, ContentBatchSystem>> = {
  "assigned-route-missing": "map-event-and-travel", "assigned-route-target-invalid": "map-event-and-travel",
  "assigned-route-action-blocked": "map-event-and-travel", "assigned-route-audio-missing": "map-event-and-travel",
  "assigned-route-catalog-invalid": "map-event-and-travel",
  "map-outside-batch": "content-batch-interface",
  "source-walk-encounter-policy-unimplemented": "map-event-and-travel",
  "source-walk-encounter-binding-invalid": "map-event-and-travel",
  "map-missing": "map-event-and-travel",
  "walk-encounter-policy-invalid": "map-event-and-travel",
  "map-capability-blocked": "map-event-and-travel",
  "map-provider-blocked": "map-event-and-travel",
  "map-geometry-missing": "map-event-and-travel",
  "script-missing": "map-event-and-travel",
  "script-empty": "map-event-and-travel",
  "entity-group-missing": "map-event-and-travel",
  "entity-group-blocked": "map-event-and-travel",
  "entrance-missing": "map-event-and-travel",
  "entrance-ambiguous": "map-event-and-travel",
  "interaction-blocked": "map-event-and-travel",
  "entity-provider-blocked": "map-event-and-travel",
  "character-missing": "map-event-and-travel",
  "character-capability-blocked": "map-event-and-travel",
  "instruction-target-invalid": "map-event-and-travel",
  "script-transition-metadata": "map-event-and-travel",
  "script-transition-locals": "map-event-and-travel",
  "script-transition-entry": "map-event-and-travel",
  "timer-callback-binding-invalid": "map-event-and-travel",
  "timer-callback-lottery-unimplemented": "map-event-and-travel",
  "encounter-id-invalid": "battle-and-return",
  "source-encounter-command-invalid": "battle-and-return",
  "source-battle-candidates-unresolved": "battle-and-return",
  "compiler-report": "battle-and-return",
  "compiler-evidence-missing": "battle-and-return",
  "missing-encounter": "battle-and-return",
  "encounter-identity": "battle-and-return",
  "battle-participant-content": "battle-and-return",
  "battle-participant-reference": "battle-and-return",
  "enemy-party-reference": "battle-and-return",
  "encounter-formation": "battle-and-return",
  "encounter-escape": "battle-and-return",
  "battle-lifecycle": "battle-and-return",
  "battle-lifecycle-missing": "battle-and-return",
  "owned-player-borrow-reference": "battle-and-return",
  "owned-player-template-missing": "battle-and-return",
  "owned-player-borrow-state": "battle-and-return",
  "enemy-identity": "battle-and-return",
  "media-reference": "battle-and-return",
  "condition-catalog": "battle-and-return",
  "condition-reference": "battle-and-return",
  "enemy-condition": "battle-and-return",
  "ai-reference": "battle-and-return",
  "ai-entry": "battle-and-return",
  "enemy-ability-reference": "battle-and-return",
  "ai-target": "battle-and-return",
  "ai-instruction": "battle-and-return",
  "ai-condition": "battle-and-return",
  "ai-event-provider": "battle-and-return",
  "ability-reference": "battle-and-return",
  "ability-plan": "battle-and-return",
  "ability-formation": "battle-and-return",
  "ability-condition-reference": "battle-and-return",
  "encounter-rewards": "owned-menus-economy-and-growth",
  "reward-provider": "owned-menus-economy-and-growth",
  "reward-reference": "owned-menus-economy-and-growth",
  "reward-ownership-reference": "owned-menus-economy-and-growth",
  BATCH_MAP_WITHOUT_ROUTE: "content-batch-interface",
  BATCH_ENCOUNTER_WITHOUT_ROUTE: "content-batch-interface",
  BATCH_ROUTE_OUTSIDE_MAPS: "content-batch-interface",
  BATCH_ROUTE_OUTSIDE_ENCOUNTERS: "content-batch-interface",
  BATCH_ENTRY_UNSCANNED: "content-batch-interface",
};
const capabilityOwners: Record<FieldCapability, ContentBatchSystem> = {
  screenPresentation:"map-event-and-travel",
  mobColorFilter: "map-event-and-travel",
  messageValues: "owned-menus-economy-and-growth",
  scriptRandom: "map-event-and-travel",
  inventory: "owned-menus-economy-and-growth",
  messageNames: "owned-menus-economy-and-growth",
  sourceMessageSequence: "map-event-and-travel",
  recovery: "owned-menus-economy-and-growth",
  ownedConditions: "owned-menus-economy-and-growth",
  party: "owned-menus-economy-and-growth",
  roster: "owned-menus-economy-and-growth",
  treasure: "owned-menus-economy-and-growth",
  transportation: "map-event-and-travel",
  puppetRoster: "owned-menus-economy-and-growth",
  sourceLeader: "map-event-and-travel",
  scriptShop: "owned-menus-economy-and-growth",
  partyActors: "map-event-and-travel",
  audioReadiness: "map-event-and-travel",
  soundPresentation: "map-event-and-travel",
  actorControl: "map-event-and-travel",
  sourcePosition: "map-event-and-travel",
  actorMotion: "map-event-and-travel",
  cameraMotion: "map-event-and-travel",
  effectMotion: "map-event-and-travel",
  conditionVisual: "map-event-and-travel",
  scriptMotion: "map-event-and-travel", puppetRoutes: "map-event-and-travel", assignedNpcRoutes: "map-event-and-travel",
  storyTimer: "map-event-and-travel",
  screenEffects: "map-event-and-travel",
  birdViewActors:"map-event-and-travel",
  viewChange:"map-event-and-travel",
  worldAutoTasks:'map-event-and-travel',
  worldAutoMove:'map-event-and-travel',
  cameraShake: "map-event-and-travel",
  contentInvalidations: "map-event-and-travel",
  eventSaveCompletion: "save-restore-and-continuation",
  sourceAutoSaveSync: "save-restore-and-continuation",
  battleHandoff: "battle-and-return", sourceEncounter: "battle-and-return", sourceBossEntry:'battle-and-return',sourceBattleResult:'battle-and-return',sourcePartySelection:'owned-menus-economy-and-growth',
};
const byCode = (code: string): ContentBatchSystem => code === "instruction-blocked" ? "unclassified"
  : Object.hasOwn(diagnosticOwners, code) ? diagnosticOwners[code]! : "unclassified";
const byCapability = (capability: FieldCapability): ContentBatchSystem =>
  Object.hasOwn(capabilityOwners, capability) ? capabilityOwners[capability] : "unclassified";
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function dense(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1)
    throw new Error("Work plan requires complete diagnostic/provider arrays");
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      throw new Error("Work plan requires plain diagnostic/provider values");
  }
}
function digest(value: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Work plan requires the original batch content identities");
}

/** Projection only. The caller passes the already prepared plan; this does
 * not load packages, scan instructions, recompute dependencyHash, assess a
 * provider, certify a route or turn conditional evidence into availability. */
export function projectContentBatchWorkPlan(plan: ContentBatchPlan): ContentBatchWorkPlan {
  if (plan.kind !== "content-batch-plan-v1" || plan.runtimeAdmission !== "unassessed" ||
      plan.sourceCampaignComplete !== false)
    throw new Error("Work plan requires an unassessed content batch plan");
  digest(plan.manifestHash); digest(plan.dependencyHash);
  for (const value of Object.values(plan.contentHashes)) digest(value);
  for (const array of [plan.diagnostics, plan.dependencies.diagnostics,
    plan.dependencies.providerRequirements, plan.dependencies.providerAssessments]) dense(array);
  const messageKey = (diagnostic: { code: string; reason: string }) => canonical([diagnostic.code, diagnostic.reason]);
  const dependencyIndex = new Map<string, {
    index: number; diagnostic: ContentDependencyDiagnostic; sourceKey: string | undefined;
  }[]>();
  plan.dependencies.diagnostics.forEach((diagnostic, index) => {
    const key = messageKey(diagnostic), bucket = dependencyIndex.get(key) ?? [];
    bucket.push({ index, diagnostic, sourceKey: diagnostic.source === undefined ? undefined : canonical(diagnostic.source) });
    dependencyIndex.set(key, bucket);
  });
  const diagnostics: ContentBatchWorkDiagnostic[] = plan.diagnostics.map((diagnostic, index) => {
    if (typeof diagnostic.code !== "string" || !diagnostic.code || typeof diagnostic.reason !== "string")
      throw new Error("Invalid batch diagnostic projection");
    const original = diagnostic as ContentDependencyDiagnostic & { encounterId?: number; abilityId?: number };
    const sourceKey = original.source === undefined ? undefined : canonical(original.source);
    const candidates = original.encounterId !== undefined || original.abilityId !== undefined ? []
      : dependencyIndex.get(messageKey(diagnostic)) ?? [];
    const dependencyLocations = candidates.flatMap(candidate => {
      if ((["mapId", "script", "index"] as const).some(key =>
        Object.hasOwn(original, key) && (!Object.hasOwn(candidate.diagnostic, key) ||
          original[key] !== candidate.diagnostic[key])) ||
          Object.hasOwn(original, "source") && (!Object.hasOwn(candidate.diagnostic, "source") || sourceKey !== candidate.sourceKey)) return [];
      return [{ index: candidate.index, diagnostic: structuredClone(candidate.diagnostic) }];
    });
    return { index, owner: byCode(diagnostic.code), diagnostic: structuredClone(diagnostic), dependencyLocations };
  });
  const providerRequirements = plan.dependencies.providerRequirements.map((requirement, index) => ({
    index, owner: byCapability(requirement.capability), requirement: structuredClone(requirement),
  }));
  const providerSiteKey = (mapId: number, site: ContentProviderRequirement["site"]) => canonical([mapId, site]);
  const requirementOwners = new Map<string, Set<ContentBatchSystem>>();
  for (const { owner, requirement } of providerRequirements) {
    const key = providerSiteKey(requirement.mapId, requirement.site), owners = requirementOwners.get(key) ?? new Set<ContentBatchSystem>();
    owners.add(owner); requirementOwners.set(key, owners);
  }
  const providerAssessments = plan.dependencies.providerAssessments.map((assessment, index) => {
    if (!["ready", "conditional", "blocked"].includes(assessment.status))
      throw new Error("Invalid batch provider assessment status");
    dense(assessment.diagnostics);
    const owners = new Set<ContentBatchSystem>(requirementOwners.get(providerSiteKey(assessment.mapId, assessment.site)) ?? []);
    for (const diagnostic of assessment.diagnostics) owners.add(byCapability(diagnostic.capability));
    if (!owners.size) owners.add("unclassified");
    return { index, owners: CONTENT_BATCH_SYSTEMS.filter(owner => owners.has(owner)), assessment: structuredClone(assessment) };
  });
  const workItems: ContentBatchWorkPlan["workItems"] = CONTENT_BATCH_SYSTEMS.map(id => {
    const details = systemDetails[id];
    const diagnosticIndices = diagnostics.filter(row => row.owner === id).map(row => row.index),
      providerRequirementIndices = providerRequirements.filter(row => row.owner === id).map(row => row.index),
      providerAssessmentIndices = providerAssessments.filter(row => row.owners.includes(id)).map(row => row.index);
    return { id, label: details.label, existingOwners: [...details.existingOwners], publicInterfaces: [...details.publicInterfaces],
      diagnosticIndices, providerRequirementIndices, providerAssessmentIndices,
      counts: { diagnostics: diagnosticIndices.length, providerRequirements: providerRequirementIndices.length,
        providerAssessments: providerAssessmentIndices.length },
      implementation: { scope: details.scope, parallelPreparation: "pure-rules-and-provider-candidates",
        publication: "existing-owner-transaction", integration: "root-owned-cross-system-integration" } };
  });
  return { kind: "content-batch-work-plan-v1", batchId: plan.manifest.id, profile: plan.manifest.profile,
    manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash,
    contentHashes: Object.fromEntries(Object.entries(plan.contentHashes).sort(([a], [b]) => lexical(a, b))),
    countUnit: "diagnostic-and-provider-records",
    counts: { diagnostics: diagnostics.length, providerRequirements: providerRequirements.length,
      providerAssessments: providerAssessments.length, unclassifiedDiagnostics: diagnostics.filter(row => row.owner === "unclassified").length },
    diagnostics, providerRequirements, providerAssessments, workItems,
    runtimeAdmission: "unassessed", sourceCampaignComplete: false,
    limitations: [
      "This is a work projection of the existing plan, not another dependency scan or content-readiness assessment.",
      "Unknown codes and instruction-blocked remain unclassified; reasons and namespaces do not infer implementation ownership.",
      "Counts describe original diagnostics and provider records, not playable maps, story progress or migration coverage.",
      "A provider assessment may concern several systems; its original index/status/diagnostics are retained and system counts can overlap.",
      "Conditional or ready provider evidence does not grant route execution, story applicability, browser verification or source parity.",
      "Pure rules and provider preparation may proceed in parallel; cross-owner publication uses the existing transactions and root integration.",
    ],
  };
}
