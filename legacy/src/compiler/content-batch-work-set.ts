import { hash } from "./content.js";
import { CONTENT_BATCH_SYSTEMS, projectContentBatchWorkPlan,
  type ContentBatchPlan } from "./content-batch-work-plan.js";

export type ContentBatchWorkSetInput = {
  selection: { id: string; sha256: string };
  runtimeSha256: string;
  batches: {
    packageId: string; label: string; recipePath: string; recipeSha256: string;
    plan: ContentBatchPlan;
  }[];
};

const digest = (value: string) => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Work set requires the actual input and runtime digests");
};
const text = (value: string) => {
  if (typeof value !== "string" || !value.trim() || value.length > 160)
    throw new Error("Invalid work set identity or label");
};

/** A collection-wide projection of this candidate's real batch plans. Shared
 * work is grouped once, while each source record keeps its batch and index.
 * This neither constructs a game owner nor admits any batch for execution. */
export function projectContentBatchWorkSet(input: ContentBatchWorkSetInput) {
  text(input.selection.id); digest(input.selection.sha256); digest(input.runtimeSha256);
  if (!Array.isArray(input.batches) || !input.batches.length ||
      Object.keys(input.batches).length !== input.batches.length)
    throw new Error("Work set requires a nonempty complete batch selection");
  const packages = new Set<string>(), paths = new Set<string>(), manifests = new Set<string>();
  const batches = input.batches.map(item => {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.packageId) ||
        !/^content-batches\/[a-z0-9][a-z0-9-]{0,79}\.recipe\.json$/.test(item.recipePath))
      throw new Error("Invalid work set package or recipe path");
    text(item.label); digest(item.recipeSha256);
    const work = projectContentBatchWorkPlan(item.plan);
    if (packages.has(item.packageId) || paths.has(item.recipePath) || manifests.has(work.batchId))
      throw new Error("Work set package, recipe and manifest identities must be unique");
    packages.add(item.packageId); paths.add(item.recipePath); manifests.add(work.batchId);
    return { packageId: item.packageId, label: item.label, recipePath: item.recipePath,
      recipeSha256: item.recipeSha256, work };
  });
  const location = (batch: typeof batches[number], index: number) =>
    ({ packageId: batch.packageId, batchId: batch.work.batchId, index });
  const workItems = CONTENT_BATCH_SYSTEMS.map(id => {
    const examples = batches.map(batch => batch.work.workItems.find(item => item.id === id)!);
    const first = examples[0]!;
    const diagnosticLocations = batches.flatMap((batch, index) =>
      examples[index]!.diagnosticIndices.map(record => location(batch, record)));
    const providerRequirementLocations = batches.flatMap((batch, index) =>
      examples[index]!.providerRequirementIndices.map(record => location(batch, record)));
    const providerAssessmentLocations = batches.flatMap((batch, index) =>
      examples[index]!.providerAssessmentIndices.map(record => location(batch, record)));
    return { id, label: first.label, existingOwners: [...first.existingOwners], publicInterfaces: [...first.publicInterfaces],
      implementation: structuredClone(first.implementation),
      diagnosticLocations, providerRequirementLocations, providerAssessmentLocations,
      counts: { diagnostics: diagnosticLocations.length, providerRequirements: providerRequirementLocations.length,
        providerAssessments: providerAssessmentLocations.length } };
  });
  const sum = (key: "diagnostics" | "providerRequirements" | "providerAssessments" | "unclassifiedDiagnostics") =>
    batches.reduce((total, batch) => total + batch.work.counts[key], 0);
  const body = {
    kind: "content-batch-work-set-v1" as const,
    selection: structuredClone(input.selection), runtimeSha256: input.runtimeSha256,
    countUnit: "batch-diagnostic-and-provider-records" as const,
    batches, workItems,
    counts: { batches: batches.length, diagnostics: sum("diagnostics"),
      providerRequirements: sum("providerRequirements"), providerAssessments: sum("providerAssessments"),
      unclassifiedDiagnostics: sum("unclassifiedDiagnostics") },
    runtimeAdmission: "unassessed" as const, sourceCampaignComplete: false as const,
    limitations: [
      "Each batch retains its complete original work plan, dependencies, source positions and conditional assessments.",
      "Identical record text across batches is not deduplicated or treated as shared execution evidence.",
      "Provider assessment counts may overlap systems; collection totals count each original batch record once.",
      "Compilation and work grouping do not prove route execution, story reachability, browser behavior or source parity.",
    ],
  };
  return { ...body, contentHash: hash(body) };
}
