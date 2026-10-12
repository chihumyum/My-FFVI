// Fresh system integration evidence from the same compiled runtime. A source
// route reaching an unsupported boundary is recorded separately from passing
// the controlled gameplay loop; neither proves a completed source campaign.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "build/reports/framework-systems-check.json");
const run = promisify(execFile);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lanes = [
  ["session-loop", "check-game-framework.mjs", "game-framework-check.json", "stages"],
  ["event-motion-and-recovery", "check-script-motion-integration.mjs", "script-motion-integration-check.json", "stages"],
  ["shared-ownership", "check-system-integration.mjs", "system-integration-check.json", "cases"],
  ["manual-dialogue-and-save", "check-field-manual-message.mjs", "field-manual-message-check.json", "controlledJourney.stages"],
  ["dialogue-choice-ui", "check-event-interactions-ui.mjs", "event-interaction-ui-check.json", "checks"],
  ["battle-command-ui", "check-battle-abilities-ui.mjs", "battle-abilities-ui-check.json", "checked"],
  ["battle-command-persistence", "check-battle-row-change.mjs", "battle-row-change-check.json", "stages"],
  ["transportation-state", "check-transportation-state.mjs", "transportation-state-check.json", "cases"],
  ["transportation-lifecycle", "check-field-transportation-session.mjs", "field-transportation-session-check.json", "cases"],
  ["field-compositor", "check-field-native-composition-ui.mjs", "field-native-composition-ui-check.json", "tests"],
  ["source-journey", "check-framework-route.mjs", "framework-source-route-check.json", "transitions"],
];
async function runtimeDigest() {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(?:js|mjs|json)$/.test(entry.name)) files.push(full);
    }
  }
  for (const folder of ["dist/src", "dist/tests", "apps/game", "scripts"]) await walk(resolve(root, folder));
  const hashes = await Promise.all(files.sort().map(async (path) => [relative(root, path), digest(await readFile(path))]));
  return digest(JSON.stringify(hashes));
}
const report = { kind: "framework-system-integration-suite-v1", result: "running", checks: [],
  evidence: "controlled-runtime-and-DOM", sourceJourney: null, readyForBatchPopulation: false,
  browserVerified: false, originalGameExecuted: false, fullGameMigration: false };
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
try {
  report.runtimeSha256 = await runtimeDigest();
  for (const [id, script, artifact, countKey] of lanes) {
    const path = resolve(root, "build/reports", artifact);
    await rm(path, { force: true });
    console.log("Checking " + id);
    const { stdout, stderr } = await run(process.execPath, [resolve(root, "scripts", script)],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(resolve(root, "build/reports/framework-suite-" + id + ".log"), stdout + stderr);
    const bytes = await readFile(path), result = JSON.parse(bytes);
    const cases = countKey.split(".").reduce((value, key) => value?.[key], result);
    assert.ok(Array.isArray(cases) && cases.length > 0, id + " has no exercised scenarios");
    if (result.result !== undefined) assert.ok(["pass", "passed"].includes(result.result), id + " did not pass");
    report.checks.push({ id, report: relative(root, path), sha256: digest(bytes),
      cases: cases.length, result: "passed" });
    if (id === "source-journey") {
      report.sourceJourney = { status: result.checkpointReady ? "stable-field-reached" : "incomplete",
        completeOpening: result.completeOpening, mapId: result.mapId, elapsedMs: result.elapsedMs,
        transitions: result.transitions.map(({ from, to }) => ({ from, to })), boundary: result.boundary };
    }
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  assert.equal(await runtimeDigest(), report.runtimeSha256, "Runtime changed during integration; rebuild and rerun");
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = String(error.stack ?? error);
  throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, systems: report.checks.length,
    sourceJourney: report.sourceJourney?.status ?? "not-run", readyForBatchPopulation: false,
    report: relative(root, output) }));
}
