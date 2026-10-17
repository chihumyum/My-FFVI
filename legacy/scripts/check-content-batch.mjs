// The plan command reports static requirements. The check command is a real,
// fail-closed gate for one nominated batch, not a replacement campaign oracle.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";
import { runContentBatchRoute } from "./content-batch-route.mjs";
import { readSourceBatch, batchRouteSpecs } from "./content-batch-files.mjs";
import { readFrameworkContractEvidence, finishFrameworkContractEvidence,
  frameworkContractReport } from "./framework-contract-evidence.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
const mode = args.shift();
const usage = "Use check-content-batch.mjs plan|check [manifest.json] [--framework-scope skeleton|full-suite] [--compiled-dir directory]";
if (!["plan", "check"].includes(mode)) throw new Error(usage);
let manifestPath = null;
const options = new Map();
for (let index = 0; index < args.length; index++) {
  const name = args[index];
  if (["--framework-scope", "--compiled-dir"].includes(name)) {
    const value = args[++index];
    if (!value || value.startsWith("--") || options.has(name)) throw new Error(usage);
    options.set(name, value);
  } else {
    if (name.startsWith("--") || manifestPath !== null) throw new Error(usage);
    manifestPath = name;
  }
}
manifestPath ??= "content-batches/framework-opening.json";
const scope = options.get("--framework-scope") ?? "skeleton", compiled = options.get("--compiled-dir") ?? "dist";
frameworkContractReport(scope); // Reject unknown scopes; never fall back to older evidence.
const { plan, repository } = await readSourceBatch(root, manifestPath, compiled);
const output = resolve(root, "build/reports/content-batch-" + plan.manifest.id + ".json");
// Manifest IDs are labels, never arbitrary filesystem components.
if (!/^[a-z0-9][a-z0-9-]*$/.test(plan.manifest.id)) throw new Error("Batch CLI id requires lowercase letters, numbers and hyphens");
await mkdir(resolve(root, "build/reports"), { recursive: true });
const report = { kind: "content-batch-check-v1", mode, plan, runs: [], admission: null,
  frameworkScope: scope, frameworkEvidence: null, originalGameExecuted: false, sourceCampaignComplete: false };
if (mode === "check") {
  const { assessContentBatchAdmission } = await import(pathToFileURL(resolve(root, compiled, "src/compiler/content-batch-admission.js")));
  const runtimeHash = await runtimeDigest(root, compiled);
  const prior = await readFrameworkContractEvidence(root, { scope, runtimeHash, compiled });
  for (const route of plan.manifest.routes)
    report.runs.push(await runContentBatchRoute({ root, compiled, plan, routeId: route.id, repository, runtimeHash }));
  const after = await readSourceBatch(root, manifestPath, compiled);
  const finalEvidence = await readFrameworkContractEvidence(root, { scope, runtimeHash, compiled });
  const afterRuntime = await runtimeDigest(root, compiled);
  const diagnostics = plan.diagnostics.map(({ code, reason }) => ({ code, reason }));
  if (after.plan.manifestHash !== plan.manifestHash || after.plan.dependencyHash !== plan.dependencyHash)
    diagnostics.push({ code: "BATCH_CHANGED_DURING_RUN", reason: "Manifest or compiled dependencies changed during execution" });
  const { framework, diagnostics: frameworkDiagnostics } = finishFrameworkContractEvidence(prior, finalEvidence, runtimeHash, afterRuntime);
  diagnostics.push(...frameworkDiagnostics);
  report.frameworkEvidence = { before: prior, after: finalEvidence };
  report.admission = assessContentBatchAdmission({
    manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: plan.contentHashes, profile: plan.manifest.profile, routes: batchRouteSpecs(plan.manifest),
    diagnostics, framework, receipts: report.runs.map(run => run.receipt),
  });
}
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ batch: plan.manifest.id, mode, frameworkScope: scope, declaredMaps: plan.manifest.mapIds,
  referencedEncounters: plan.dependencies.encounterIds, diagnostics: plan.diagnostics.length,
  referenceClosure: plan.dependencies.referenceClosure, admission: report.admission?.status ?? "unassessed",
  providerContracts: { requirements: plan.dependencies.providerRequirements.length,
    blockedContexts: plan.dependencies.providerAssessments.filter(assessment => assessment.status === "blocked").length,
    conditionalContexts: plan.dependencies.providerAssessments.filter(assessment => assessment.status === "conditional").length },
  routes: report.runs.map(run => ({ id: run.receipt.routeId, result: run.receipt.result,
    elapsedMs: run.elapsedMs, boundary: run.receipt.boundary })), report: output }, null, 2));
if (mode === "check" && report.admission?.status !== "passed") process.exitCode = 1;
