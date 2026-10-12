import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runContentBatchRoute } from "./content-batch-route.mjs";
import { batchRouteSpecs } from "./content-batch-files.mjs";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir");
const compiled = args[1] ?? "dist", load = name => import(pathToFileURL(resolve(root, compiled, name + ".js")));
const [{ contentBatchFixture, sealBatchContent }, { planContentBatch }, { assessContentBatchAdmission }, { GameContentRepository }] = await Promise.all([
  load("tests/fixtures/content-batch"), load("src/compiler/content-batch"), load("src/compiler/content-batch-admission"), load("src/core/game-content"),
]);
const runtimeHash = await runtimeDigest(root, compiled), fixture = contentBatchFixture();
const { packages, manifest } = fixture, plan = planContentBatch(manifest, packages), { entry, catalog, battle, maps } = packages;
const files = new Map([["/game/content.json", entry], ["/game/battle.json", battle], ["/world/catalog.json", catalog],
  ...maps.map(m => [catalog.maps[m.mapId].url, m])]);
const repository = new GameContentRepository(async url => {
  assert.ok(files.has(url), "Unprovided fixture content " + url); return files.get(url);
});
const route = manifest.routes[0], run = await runContentBatchRoute({ root, compiled, plan, routeId: route.id, repository, runtimeHash });
const base = { manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash, contentHashes: plan.contentHashes,
  profile: manifest.profile, routes: batchRouteSpecs(manifest), diagnostics: plan.diagnostics.map(({ code, reason }) => ({ code, reason })),
  // This is the gate's synthetic input fixture, not a claimed external systems
  // certificate. The containing framework suite exercises the real contracts.
  framework: { status: "passed", runtimeHash }, receipts: [run.receipt] };
const admission = assessContentBatchAdmission(base), tests = [];
const output = resolve(root, "build/reports/content-batch-pipeline-check.json");
const report = { kind: "controlled-content-batch-pipeline-v1", result: "running", plan, run, admission, tests,
  evidence: { lane: "synthetic-controlled", frameworkReceipt: "authored gate fixture",
    sourceMapCoverage: false, browserVerified: false, originalGameExecuted: false, fullGameMigration: false } };
await mkdir(resolve(root, "build/reports"), { recursive: true });
try {
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(run.receipt.result, "completed", JSON.stringify(run));
  assert.equal(admission.status, "passed", JSON.stringify(admission));
  assert.deepEqual(run.receipt.visitedMapIds, [1, 2]); assert.deepEqual(run.receipt.completedEncounterIds, [1000]);
  assert.equal(run.trace.find(step => step.kind === "victory").gilAward, 14); assert.ok(run.commands > 0);
  assert.ok(run.trace.some(step => step.kind === "event-save")); assert.ok(run.checkpointHash);
  tests.push({ name: "walk-trigger-event-save-real-battle-map-menu-save-restore", passed: true });
  const reject = (name, value) => { assert.equal(assessContentBatchAdmission(value).status, "blocked"); tests.push({ name, passed: true }); };
  reject("old-runtime-receipt", { ...base, runtimeHash: "0".repeat(64) });
  reject("no-route-evidence", { ...base, receipts: [] });
  reject("mid-route-boundary-is-not-completion", { ...base, receipts: [{ ...run.receipt, result: "blocked", boundary: { kind: "unsupported" } }] });
  reject("incomplete-coverage", { ...base, receipts: [{ ...run.receipt, visitedMapIds: [2] }] });
  reject("restore-is-mandatory", { ...base, receipts: [{ ...run.receipt, saveRestored: false }] });
  const changed = structuredClone(packages);
  changed.maps[1].name = "Changed content"; changed.maps[1] = sealBatchContent(changed.maps[1]);
  changed.catalog.maps[2].contentHash = changed.maps[1].contentHash; changed.catalog = sealBatchContent(changed.catalog);
  const next = planContentBatch(manifest, changed);
  reject("rehashed-content-invalidates-previous-route", { ...base, dependencyHash: next.dependencyHash, contentHashes: next.contentHashes });
  const substitutedWorld = sealBatchContent({ ...catalog, limitations: [...catalog.limitations, "Changed shared provider package"] });
  const otherRepository = new GameContentRepository(async url => url === "/world/catalog.json" ? substitutedWorld : files.get(url));
  const mismatched = await runContentBatchRoute({ root, compiled, plan, routeId: route.id, repository: otherRepository, runtimeHash });
  assert.equal(mismatched.receipt.result, "failed");
  assert.match(mismatched.receipt.boundary.reason, /Route dependency changed: world/);
  assert.deepEqual(mismatched.trace, [], "Wrong provider package is rejected before gameplay starts");
  reject("actual-repository-world-cannot-borrow-planned-hash", { ...base, receipts: [mismatched.receipt] });
  const editedRoute = structuredClone(plan); editedRoute.manifest.routes[0].inputs = [];
  const edited = await runContentBatchRoute({ root, compiled, plan: editedRoute, routeId: route.id, repository, runtimeHash });
  assert.equal(edited.receipt.result, "failed"); assert.match(edited.receipt.boundary.reason, /manifest payload changed/);
  assert.deepEqual(edited.trace, []);
  reject("edited-route-cannot-borrow-manifest-identity", { ...base, receipts: [edited.receipt] });
  await assert.rejects(runContentBatchRoute({ root, compiled, plan, routeId: "absent", repository, runtimeHash }), /one identity/);
  tests.push({ name: "undeclared-route-id-rejected", passed: true });
  assert.equal(await runtimeDigest(root, compiled), runtimeHash, "Runtime changed during batch check");
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally { await writeFile(output, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ result: report.result, tests: tests.length, report: output })); }
