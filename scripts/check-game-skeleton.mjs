// Fresh representative journeys through existing owners. No build or content mutation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { runtimeDigest } from "./runtime-digest.mjs";
import { GAME_SKELETON_CHECKS, GAME_SKELETON_GROUPS } from "./game-skeleton-contract.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2), options = new Map();
const usage = "Use [--plan | --list] [--compiled-dir <directory>] [--content-dir <directory>] [--report <build/reports/path.json>]";
let mode = "run";
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (name === "--plan" || name === "--list") {
    assert.equal(mode, "run", usage); mode = name.slice(2);
  } else {
    assert.ok(["--compiled-dir", "--content-dir", "--report"].includes(name) && !options.has(name), usage);
    const value = args[++i];
    assert.ok(value && !value.startsWith("--"), usage); options.set(name, value);
  }
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist");
const content = resolve(root, options.get("--content-dir") ?? "build/content-packages");
const reports = resolve(root, "build/reports"), scope = resolve(reports, "game-skeleton");
const output = resolve(root, options.get("--report") ?? "build/reports/game-skeleton-check.json");
assert.ok(output.startsWith(reports + sep) && output.endsWith(".json"), usage);
const local = path => relative(root, path), scoped = id => resolve(scope, id + ".json");
const lanes = GAME_SKELETON_CHECKS.map(check => ({ ...check,
  artifact: resolve(reports, check.artifact),
  args: check.args.map(argument => argument === "{compiled}" ? compiled :
    argument === "{content}" ? content : argument === "{report}" ? scoped(check.id) : argument),
}));
const groupDefinitions = GAME_SKELETON_GROUPS;
assert.ok(!lanes.some(lane => output === lane.artifact || output === scoped(lane.id)), "Aggregate report cannot replace a child report");
const sharedOutputs = lanes.filter(lane => lane.artifact !== scoped(lane.id)).map(lane => local(lane.artifact));
const plan = {
  kind: "game-skeleton-plan-v1", mode, compiledDirectory: local(compiled), contentDirectory: local(content), report: local(output),
  groups: groupDefinitions,
  checkers: lanes.map(lane => ({ id: lane.id, script: "scripts/" + lane.script,
    arguments: lane.args.map(arg => arg.startsWith(root + sep) ? local(arg) : arg),
    sourceReport: local(lane.artifact), retainedReport: local(scoped(lane.id)),
    countKey: lane.countKey, scope: lane.scope, publicAPIs: lane.publicAPIs })),
  sharedOutputPaths: sharedOutputs,
  boundaries: ["No build or content production", "Do not run alongside the full framework suite or fixed-output checkers",
    "These controlled journeys do not admit whole source batches, browser presentation or full migration"],
};
if (mode !== "run") {
  console.log(JSON.stringify(mode === "list" ? { kind: plan.kind, mode, report: plan.report, groups: plan.groups,
    checkers: plan.checkers.map(({ id, script, sourceReport, retainedReport }) => ({ id, script, sourceReport, retainedReport })),
    sharedOutputPaths: sharedOutputs } : plan, null, 2));
} else {
  const report = {
    kind: "game-skeleton-check-v1", result: "running", startedAt: new Date().toISOString(),
    compiledDirectory: plan.compiledDirectory, contentDirectory: plan.contentDirectory,
    evidence: "fresh representative runtime journeys and controlled actual-app execution",
    checks: lanes.map(lane => ({ id: lane.id, script: "scripts/" + lane.script, status: "not-run",
      report: local(scoped(lane.id)), cases: 0, publicAPIs: lane.publicAPIs, scope: lane.scope })),
    skeletonContracts: { status: "running", groups: groupDefinitions.map(group => ({ ...group, status: "not-run", missing: [...group.required] })) },
    readyForDeclaredContentBatches: false,
    wholeSourceBatchAdmission: { status: "not-assessed", reason: "Every selected source batch requires its own complete dependency and continuous-route admission against this runtime" },
    sourceJourney: { status: "not-run", sourceCampaignComplete: false },
    browser: { status: "not-run", evidence: "Controlled DOM/Canvas and Renderer doubles do not establish browser pixels, image decode or audible output" },
    browserVerified: false, originalGameExecuted: false, fullGameMigration: false,
  };
  const lockPath = resolve(reports, ".game-skeleton-check.lock");
  let lock = null, running = null;
  const write = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
  const run = promisify(execFile), sha = bytes => createHash("sha256").update(bytes).digest("hex");
  const refreshGroups = () => {
    for (const group of report.skeletonContracts.groups) {
      const relevant = report.checks.filter(check => group.required.includes(check.id));
      group.missing = relevant.filter(check => check.status !== "passed").map(check => check.id);
      group.status = relevant.every(check => check.status === "passed") ? "passed"
        : relevant.some(check => check.status !== "not-run") ? "incomplete" : "not-run";
    }
  };
  try {
    await mkdir(scope, { recursive: true }); await mkdir(resolve(output, ".."), { recursive: true });
    try { lock = await open(lockPath, "wx"); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error("Another game skeleton check holds " + local(lockPath));
      throw error;
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: report.startedAt, report: local(output) }) + "\n");
    await write();
    report.runtimeSha256 = await runtimeDigest(root, compiled); await write();
    for (const [index, lane] of lanes.entries()) {
      running = report.checks[index];
      assert.equal(await runtimeDigest(root, compiled), report.runtimeSha256, "Runtime changed before " + lane.id);
      running.status = "running"; running.startedAt = new Date().toISOString(); await write();
      // Delete prior evidence, then execute the real checker. Never accept a cached pass.
      await rm(lane.artifact, { force: true });
      if (lane.artifact !== scoped(lane.id)) await rm(scoped(lane.id), { force: true });
      console.log("Checking " + lane.id);
      let stdout = "", stderr = "", processError = null;
      try {
        ({ stdout, stderr } = await run(process.execPath, [resolve(root, "scripts", lane.script), ...lane.args],
          { cwd: root, timeout: 180000, maxBuffer: 8 * 1024 * 1024 }));
      } catch (error) { stdout = error.stdout ?? ""; stderr = error.stderr ?? ""; processError = error; }
      const log = resolve(scope, lane.id + ".log");
      await writeFile(log, stdout + stderr);
      running.log = local(log); running.finishedAt = new Date().toISOString();
      let child = null;
      try {
        const bytes = await readFile(lane.artifact);
        if (lane.artifact !== scoped(lane.id)) await writeFile(scoped(lane.id), bytes);
        running.sha256 = sha(bytes); child = JSON.parse(bytes); running.reportedResult = child.result;
      } catch (error) {
        if (!processError) throw error;
        running.reportError = String(error.message ?? error);
      }
      if (processError) throw processError;
      assert.ok(child, lane.id + " produced no fresh report");
      assert.equal(child.kind, lane.kind, lane.id + " returned another evidence contract");
      assert.ok(["pass", "passed"].includes(child.result), lane.id + " did not pass");
      const cases = child[lane.countKey];
      assert.ok(Array.isArray(cases) && cases.length > 0, lane.id + " has no exercised scenarios");
      for (const exercised of cases) {
        assert.ok(exercised && typeof exercised.name === "string" && exercised.name.length, lane.id + " has an unnamed scenario");
        if (lane.marker) assert.equal(exercised[lane.marker], true, lane.id + " contains an unfinished scenario");
      }
      if (typeof child.runtimeSha256 === "string")
        assert.equal(child.runtimeSha256, report.runtimeSha256, lane.id + " used another runtime digest");
      assert.equal(await runtimeDigest(root, compiled), report.runtimeSha256, "Runtime changed during " + lane.id);
      running.cases = cases.length; running.scenarios = cases.map(item => item.name); running.status = "passed";
      refreshGroups(); await write();
    }
    assert.equal(await runtimeDigest(root, compiled), report.runtimeSha256, "Runtime changed during skeleton validation");
    refreshGroups(); assert.ok(report.skeletonContracts.groups.every(group => group.status === "passed"));
    report.skeletonContracts.status = "passed"; report.readyForDeclaredContentBatches = true; report.result = "passed";
  } catch (error) {
    report.result = "failed"; report.error = String(error.stack ?? error);
    if (running && running.status !== "passed") running.status = "failed";
    refreshGroups();
    report.skeletonContracts.status = /Runtime changed/.test(String(error.message)) ? "invalidated" : "incomplete";
    if (report.skeletonContracts.status === "invalidated")
      for (const group of report.skeletonContracts.groups) group.status = "invalidated";
    process.exitCode = 1; console.error(error.message ?? String(error));
  } finally {
    // A competing invocation cannot overwrite the active invocation's report.
    if (lock) {
      report.finishedAt = new Date().toISOString();
      try { await write(); } finally { await lock.close(); await rm(lockPath, { force: true }); }
    }
    console.log(JSON.stringify({ result: report.result, checkers: report.checks.filter(check => check.status === "passed").length,
      skeletonContracts: report.skeletonContracts.status, readyForDeclaredContentBatches: report.readyForDeclaredContentBatches,
      wholeSourceBatchAdmission: "not-assessed", browserVerified: false, fullGameMigration: false, report: local(output) }));
  }
}
