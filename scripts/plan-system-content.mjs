// Group a freshly inspected batch by shared systems. This is a work plan,
// never a cached admission report or a substitute for continuous execution.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSourceBatch } from "./content-batch-files.mjs";
import { GAME_SKELETON_GROUPS } from "./game-skeleton-contract.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
let manifest = "build/content-packages/figaro-initialized/manifest.json", compiled = "dist";
if (args[0] && !args[0].startsWith("--")) manifest = args.shift();
if (args.length) {
  if (args.length !== 2 || args[0] !== "--compiled-dir" || !args[1] || args[1].startsWith("--"))
    throw new Error("Use plan-system-content.mjs [manifest.json] [--compiled-dir directory]");
  compiled = args[1];
}
const { projectContentBatchWorkPlan } = await import(pathToFileURL(
  resolve(root, compiled, "src/compiler/content-batch-work-plan.js")));
const { plan } = await readSourceBatch(root, manifest, compiled);
if (!/^[a-z0-9][a-z0-9-]*$/.test(plan.manifest.id))
  throw new Error("Work plan batch id requires lowercase letters, numbers and hyphens");
const work = projectContentBatchWorkPlan(plan);
const systems = [...GAME_SKELETON_GROUPS.map(group => group.id), "unclassified"].sort();
if (JSON.stringify(work.workItems.map(item => item.id).sort()) !== JSON.stringify(systems))
  throw new Error("System work plan and current skeleton contract groups differ");
const output = resolve(root, "build/reports/system-work-" + plan.manifest.id + ".json");
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(work, null, 2) + "\n");
console.log(JSON.stringify({ batch: plan.manifest.id, declaredMaps: plan.manifest.mapIds,
  sharedWorkItems: work.workItems.length, diagnostics: plan.diagnostics.length,
  providerRequirements: plan.dependencies.providerRequirements.length,
  referenceClosure: plan.dependencies.referenceClosure,
  runtimeAdmission: work.runtimeAdmission, sourceCampaignComplete: false,
  report: output }, null, 2));
