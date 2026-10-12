// The plan command reports static requirements. The check command is a real,
// fail-closed gate for one nominated batch, not a replacement campaign oracle.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";
import { runContentBatchRoute } from "./content-batch-route.mjs";
import { readSourceBatch, batchRouteSpecs } from "./content-batch-files.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
const mode = args.shift();
if (!["plan", "check"].includes(mode) || args.length > 1)
  throw new Error("Use check-content-batch.mjs plan|check [manifest.json]");
const manifestPath = args[0] ?? "content-batches/framework-opening.json";
const { plan, repository } = await readSourceBatch(root, manifestPath);
const output = resolve(root, "build/reports/content-batch-" + plan.manifest.id + ".json");
// Manifest IDs are labels, never arbitrary filesystem components.
if (!/^[a-z0-9][a-z0-9-]*$/.test(plan.manifest.id)) throw new Error("Batch CLI id requires lowercase letters, numbers and hyphens");
await mkdir(resolve(root, "build/reports"), { recursive: true });
const report = { kind: "content-batch-check-v1", mode, plan, runs: [], admission: null,
  originalGameExecuted: false, sourceCampaignComplete: false };
if (mode === "check") {
  const { assessContentBatchAdmission } = await import(pathToFileURL(resolve(root, "dist/src/compiler/content-batch-admission.js")));
  const runtimeHash = await runtimeDigest(root);
  let prior = null;
  try { prior = JSON.parse(await readFile(resolve(root, "build/reports/framework-systems-check.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const route of plan.manifest.routes)
    report.runs.push(await runContentBatchRoute({ root, plan, routeId: route.id, repository, runtimeHash }));
  const after = await readSourceBatch(root, manifestPath), afterRuntime = await runtimeDigest(root);
  const diagnostics = plan.diagnostics.map(({ code, reason }) => ({ code, reason }));
  if (after.plan.manifestHash !== plan.manifestHash || after.plan.dependencyHash !== plan.dependencyHash)
    diagnostics.push({ code: "BATCH_CHANGED_DURING_RUN", reason: "Manifest or compiled dependencies changed during execution" });
  const frameworkPassed = prior?.kind === "framework-system-integration-suite-v1" && prior.result === "passed" &&
    prior.frameworkContracts?.status === "passed";
  const framework = { status: afterRuntime !== runtimeHash ? "invalidated" : frameworkPassed ? "passed" : "incomplete",
    runtimeHash: prior?.runtimeSha256 ?? "0".repeat(64) };
  report.admission = assessContentBatchAdmission({
    manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: plan.contentHashes, profile: plan.manifest.profile, routes: batchRouteSpecs(plan.manifest),
    diagnostics, framework, receipts: report.runs.map(run => run.receipt),
  });
}
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ batch: plan.manifest.id, mode, declaredMaps: plan.manifest.mapIds,
  referencedEncounters: plan.dependencies.encounterIds, diagnostics: plan.diagnostics.length,
  referenceClosure: plan.dependencies.referenceClosure, admission: report.admission?.status ?? "unassessed",
  routes: report.runs.map(run => ({ id: run.receipt.routeId, result: run.receipt.result,
    elapsedMs: run.elapsedMs, boundary: run.receipt.boundary })), report: output }, null, 2));
if (mode === "check" && report.admission?.status !== "passed") process.exitCode = 1;
