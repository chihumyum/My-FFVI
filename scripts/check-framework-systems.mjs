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

const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "build/reports/framework-systems-check.json");
const run = promisify(execFile);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lanes = [
  ["session-loop", "check-game-framework.mjs", "game-framework-check.json", "stages"],
  ["battle-handoff-loop", "check-game-framework.mjs", "battle-handoff-framework-check.json", "stages",
    ["--battle-handoff", "prepared", "--report", "build/reports/battle-handoff-framework-check.json"]],
  ["battle-media-closure", "check-battle-media.mjs", "battle-media-check.json", "stages"],
  ["io-transactions", "check-framework-io.mjs", "framework-io-check.json", "cases"],
  ["host-io-recovery", "check-game-map-ui.mjs", "game-map-ui-check.json", "tests"],
  ["session-entry-ui", "check-game-entry-ui.mjs", "game-entry-ui-check.json", "tests"],
  ["shared-command-ui", "check-game-commands-ui.mjs", "game-commands-ui-check.json", "tests"],
  ["party-organization-owner-loop", "check-party-organization.mjs", "party-organization-check.json", "tests"],
  ["party-organization-ui", "check-party-menu-ui.mjs", "party-menu-ui-check.json", "cases"],
  ["field-abilities-ui", "check-field-abilities-ui.mjs", "field-abilities-ui-check.json", "tests"],
  ["shop-economy-loop", "check-shop-economy-loop.mjs", "shop-economy-loop-check.json", "tests"],
  ["magic-stones-ui", "check-magic-stones-ui.mjs", "magic-stones-ui-check.json", "cases"],
  ["battle-ai-target-transactions", "check-battle-ai-targets.mjs", "battle-ai-targets-check.json", "stages"],
  ["event-save-continuation", "check-event-save.mjs", "event-save-check.json", "tests"],
  ["content-batch-pipeline", "check-content-batch-pipeline.mjs", "content-batch-pipeline-check.json", "tests"],
  ["content-batch-menu-and-restore", "check-content-batch-program.mjs", "content-batch-program-check.json", "tests"],
  ["trusted-content-packages", "check-content-packages.mjs", "content-packages-check.json", "tests"],
  ["ordinary-source-battle-content", "check-battle-content-batch.mjs", "battle-content-batch-check.json", "stages"],
  ["source-development-content-route", "check-development-content-batch.mjs", "development-content-batch-check.json", "tests"],
  ["interactive-systems-playground", "check-systems-playground.mjs", "systems-playground-check.json", "tests"],
  ["source-initialized-systems-loop", "check-initialized-systems.mjs", "initialized-systems-check.json", "tests"],
  ["source-initialized-systems-ui", "check-initialized-systems-ui.mjs", "initialized-systems-ui-check.json", "cases"],
  ["walking-encounter-loop", "check-walk-encounters.mjs", "walk-encounters-check.json", "stages"],
  ["battle-formation-entry", "check-battle-formations.mjs", "battle-formations-check.json", "stages"],
  ["battle-escape-return", "check-battle-escape.mjs", "battle-escape-check.json", "stages"],
  ["battle-escape-ui", "check-battle-escape-ui.mjs", "battle-escape-ui-check.json", "checked"],
  ["battle-magic-points", "check-battle-magic-points.mjs", "battle-magic-points-check.json", "stages"],
  ["battle-magic-points-ui", "check-battle-magic-points-ui.mjs", "battle-magic-points-ui-check.json", "checked"],
  ["battle-event-lifecycle", "check-battle-lifecycle.mjs", "battle-lifecycle-check.json", "stages"],
  ["battle-event-shared-state", "check-battle-event-state.mjs", "battle-event-state-check.json", "stages"],
  ["battle-dynamic-participants", "check-battle-participants.mjs", "battle-participants-check.json", "stages"],
  ["battle-party-transition", "check-battle-party-transition.mjs", "battle-party-transition-check.json", "stages"],
  ["battle-player-transition", "check-battle-player-transition.mjs", "battle-player-transition-check.json", "stages"],
  ["battle-player-ui", "check-battle-player-ui.mjs", "battle-player-ui-check.json", "checks"],
  ["multi-map-lifecycle", "check-framework-lifecycle.mjs", "framework-lifecycle-check.json", "stages"],
  ["event-motion-and-recovery", "check-script-motion-integration.mjs", "script-motion-integration-check.json", "stages"],
  ["shared-ownership", "check-system-integration.mjs", "system-integration-check.json", "cases"],
  ["field-owned-recovery", "check-field-recovery.mjs", "field-recovery-check.json", "stages"],
  ["field-content-admission", "check-field-content-admission.mjs", "field-content-admission-check.json", "stages"],
  ["shared-game-catalog", "check-shared-game-catalog.mjs", "shared-game-catalog-check.json", "stages"],
  ["manual-dialogue-and-save", "check-field-manual-message.mjs", "field-manual-message-check.json", "controlledJourney.stages"],
  ["owned-dialogue-names", "check-field-message-names.mjs", "field-message-names-check.json", "stages"],
  ["dialogue-choice-ui", "check-event-interactions-ui.mjs", "event-interaction-ui-check.json", "checks"],
  ["battle-command-ui", "check-battle-abilities-ui.mjs", "battle-abilities-ui-check.json", "checked"],
  ["battle-command-persistence", "check-battle-row-change.mjs", "battle-row-change-check.json", "stages"],
  ["transportation-state", "check-transportation-state.mjs", "transportation-state-check.json", "cases"],
  ["transportation-lifecycle", "check-field-transportation-session.mjs", "field-transportation-session-check.json", "cases"],
  ["field-compositor", "check-field-native-composition-ui.mjs", "field-native-composition-ui-check.json", "tests"],
  ["sound-lifecycle", "check-field-sound-session.mjs", "field-sound-session-check.json", "cases"],
  ["sound-output", "check-field-sound-ui.mjs", "field-sound-ui-check.json", "tests"],
  ["source-journey", "check-framework-route.mjs", "framework-source-route-check.json", "transitions"],
];
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
