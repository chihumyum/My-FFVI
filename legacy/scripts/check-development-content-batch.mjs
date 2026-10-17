// A real source-content development route. Its completed trajectory and its
// conservative whole-map dependency admission remain separate results.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readSourceBatch } from "./content-batch-files.mjs";
import { runContentBatchRoute } from "./content-batch-route.mjs";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = resolve(import.meta.dirname, ".."), tests = [];
const output = resolve(root, "build/reports/development-content-batch-check.json");
const report = { kind: "source-content-development-route-check-v1", result: "running", tests,
  sourceCampaignComplete: false, browserVerified: false, originalGameExecuted: false,
  evidence: "real source map and script payloads; controlled development baseline and headless media readiness" };
await mkdir(resolve(output, ".."), { recursive: true });
try {
  const runtimeHash = await runtimeDigest(root);
  const { plan, repository } = await readSourceBatch(root, "build/content-packages/figaro-development/manifest.json");
  const run = await runContentBatchRoute({ root, plan, routeId: "figaro-roundtrip", repository, runtimeHash });
  report.plan = plan; report.run = run;
  assert.equal(run.receipt.result, "completed", JSON.stringify(run.receipt));
  assert.equal(run.receipt.lane, "source-content-development");
  assert.deepEqual(run.receipt.visitedMapIds, [22, 23]);
  assert.equal(run.receipt.finalMapId, 22); assert.equal(run.receipt.boundary, null);
  assert.deepEqual(run.trace.filter(step => step.kind === "map").map(step => [step.from, step.to]), [[22, 23], [23, 22]]);
  tests.push({ name: "source-point-in-and-source-exits-complete-22-23-22", passed: true });
  assert.deepEqual(run.receipt.program, { inputCount: 9, menuCount: 2, restoreCount: 2, postRestoreInputCount: 2 });
  assert.equal(run.execution.entriesCommitted, 1); assert.equal(run.execution.loadsCommitted, 2);
  assert.equal(run.execution.staleCommandChannelsRejected, 2);
  const middle = run.trace.findIndex(step => step.kind === "save-restore" && !step.final);
  assert.ok(middle > 0 && middle < run.trace.findIndex(step => step.kind === "map" && step.to === 22));
  assert.equal(run.receipt.saveRestored, true); assert.equal(run.receipt.checkpointReady, true);
  tests.push({ name: "actual-menus-and-both-restores-preserve-owner-before-returning", passed: true });
  assert.equal(plan.dependencies.referenceClosure, "incomplete");
  assert.ok(plan.diagnostics.some(item => item.code === "map-outside-batch"));
  assert.ok(plan.diagnostics.some(item => item.code === "map-provider-blocked"));
  assert.ok(plan.diagnostics.some(item => item.code === "instruction-blocked"));
  assert.equal(plan.runtimeAdmission, "unassessed");
  tests.push({ name: "unwalked-branches-external-maps-and-source-provider-gaps-remain-blocked", passed: true });
  assert.equal(await runtimeDigest(root), runtimeHash); report.runtimeHash = runtimeHash;
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: tests.length, report: output }));
}
