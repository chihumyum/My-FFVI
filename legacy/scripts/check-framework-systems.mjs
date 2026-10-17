// Fresh system integration evidence from the same compiled runtime. A source
// route reaching an unsupported boundary is recorded separately from passing
// the controlled gameplay loop; neither proves a completed source campaign.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";
import { FRAMEWORK_SUITE_CHECKS } from "./framework-suite-contract.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "build/reports/framework-systems-check.json");
const run = promisify(execFile);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lanes = FRAMEWORK_SUITE_CHECKS;
const report = { kind: "framework-system-integration-suite-v1", result: "running", checks: [],
  evidence: "controlled-runtime-and-DOM", sourceJourney: null, readyForBatchPopulation: false,
  frameworkContracts: { status: "running", missing: lanes.filter(([id]) => id !== "source-journey").map(([id]) => id) },
  batchAdmission: { status: "not-assessed", blockers: [
    "Source batches require a separate fresh batch:check against this runtime; the systems suite does not admit them.",
    "The multi-map lifecycle is a controlled systems fixture, not a held-out source-content playthrough.",
  ] },
  browserVerified: false, originalGameExecuted: false, fullGameMigration: false };
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
try {
  report.runtimeSha256 = await runtimeDigest(root);
  for (const [id, script, artifact, countKey, arguments_ = []] of lanes) {
    const path = resolve(root, "build/reports", artifact);
    await rm(path, { force: true });
    console.log("Checking " + id);
    const { stdout, stderr } = await run(process.execPath, [resolve(root, "scripts", script), ...arguments_],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(resolve(root, "build/reports/framework-suite-" + id + ".log"), stdout + stderr);
    const bytes = await readFile(path), result = JSON.parse(bytes);
    const cases = countKey.split(".").reduce((value, key) => value?.[key], result);
    assert.ok(Array.isArray(cases) && cases.length > 0, id + " has no exercised scenarios");
    if (result.result !== undefined) assert.ok(["pass", "passed"].includes(result.result), id + " did not pass");
    report.checks.push({ id, report: relative(root, path), sha256: digest(bytes),
      cases: cases.length, result: "passed" });
    report.frameworkContracts.missing = report.frameworkContracts.missing.filter(missing => missing !== id);
    if (report.frameworkContracts.missing.length === 0) report.frameworkContracts.status = "passed";
    if (id === "source-journey") {
      report.sourceJourney = { status: result.checkpointReady ? "stable-field-reached" : "incomplete",
        completeOpening: result.completeOpening, mapId: result.mapId, elapsedMs: result.elapsedMs,
        transitions: result.transitions.map(({ from, to }) => ({ from, to })), boundary: result.boundary };
    }
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  const unchanged = await runtimeDigest(root) === report.runtimeSha256;
  if (!unchanged) report.frameworkContracts.status = "invalidated";
  assert.equal(unchanged, true, "Runtime changed during integration; rebuild and rerun");
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  if (report.frameworkContracts.missing.length) report.frameworkContracts.status = "incomplete";
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, systems: report.checks.length,
    sourceJourney: report.sourceJourney?.status ?? "not-run", readyForBatchPopulation: false,
    report: relative(root, output) }));
}
