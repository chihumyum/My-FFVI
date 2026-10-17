import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const reportUrl = new URL("../build/reports/battle-ai-targets-check.json", import.meta.url);
const report = { kind: "battle-ai-target-integration-v1", result: "running",
  evidence: "authored-controlled-runtime", stages: [],
  browserVerified: false, originalGameExecuted: false, sourceGameplayAdmitted: false };
await mkdir(new URL(".", reportUrl), { recursive: true });
try {
  report.runtimeSha256 = await runtimeDigest(root);
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ["--test", "--test-reporter=tap", "dist/tests/battle-ai-target-integration.test.js"],
    { cwd: root, maxBuffer: 2 * 1024 * 1024 });
  await writeFile(new URL("battle-ai-targets-runtime.log", reportUrl), stdout + stderr);
  report.stages = [...stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => ({ name: match[1], result: "passed" }));
  assert.equal(report.stages.length, 7, "The integration scenarios did not all execute");
  assert.match(stdout, /^# fail 0$/m);
  assert.equal(await runtimeDigest(root), report.runtimeSha256, "Runtime changed during the check");
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(reportUrl, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length,
    report: "build/reports/battle-ai-targets-check.json" }));
}
