// Continuous release compatibility through the real content/session owners.
// JSON I/O, media readiness and storage are controlled; this is not a browser,
// original-game run, source-story route or archived-media closure claim.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--compiled-dir", "--report"].includes(args[i]) && args[i + 1] && !options.has(args[i]),
    "Use --compiled-dir <directory> --report <path>");
  options.set(args[i], args[i + 1]);
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist");
const reportPath = resolve(root, options.get("--report") ?? "build/reports/content-release-session-check.json");
const logPath = reportPath.replace(/\.json$/, "") + ".tap";
const testFile = resolve(compiled, "tests/game-content-history-session.test.js");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const before = await runtimeDigest(root, compiled);
const report = { kind: "controlled-content-release-session-check-v1", result: "running", runtimeHash: before,
  cases: [], stages: [], evidence: {
    owners: ["GameFlow", "GameSession", "WorldSession", "GameState", "BattleGame"],
    sharedInterfaces: ["GameContentRepository", "GameContentHistory", "GameContentSessions", "GameEntryLoader",
      "GameMapLoader", "GameBattleHandoff", "GameCommands", "CheckpointStorage"],
    fixtures: ["tests/fixtures/content-release-session.ts", "tests/fixtures/framework-new-game.ts"],
    mode: "controlled-authored-initialized-releases", originalGameExecuted: false, browserExecuted: false,
    sourceStoryCoverage: false, archivedMediaVerified: false, semanticsVerified: false,
  } };
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
try {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", testFile],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const tap = result.stdout ?? "", stderr = result.stderr ?? "";
  await writeFile(logPath, tap + (stderr ? "\n" + stderr : ""));
  const count = key => Number(tap.match(new RegExp("^# " + key + " (\\d+)$", "m"))?.[1] ?? NaN);
  report.counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, count(key)]));
  report.cases = [...tap.matchAll(/^(ok|not ok) (\d+) - (.+)$/gm)]
    .map(([, status, index, name]) => ({ index: Number(index), name, pass: status === "ok" }));
  report.stages = report.cases.map(value => ({ name: value.name, passed: value.pass }));
  report.command = { executable: process.execPath, args: ["--test", "--test-reporter=tap", testFile],
    exitCode: result.status, signal: result.signal };
  report.log = { file: logPath, sha256: sha(await readFile(logPath)) };
  report.compiledTestSha256 = sha(await readFile(testFile));
  assert.equal(result.status, 0, result.error?.message ?? `Content release session regression failed; see ${logPath}`);
  assert.ok(report.cases.length > 0 && report.cases.every(value => value.pass));
  assert.equal(report.counts.tests, report.cases.length); assert.equal(report.counts.pass, report.cases.length);
  for (const key of ["fail", "cancelled", "skipped", "todo"]) assert.equal(report.counts[key], 0);
  const { contentReleaseSessionFixture } = await import(pathToFileURL(resolve(compiled,
    "tests/fixtures/content-release-session.js")).href);
  const fixture = await contentReleaseSessionFixture();
  report.content = { packageId: fixture.packageId, indexHash: fixture.index.contentHash,
    old: { releaseId: fixture.old.release.id, entryHash: fixture.old.content.contentHash,
      battleHash: fixture.old.battle.contentHash, worldHash: fixture.old.world.contentHash,
      mapHashes: [fixture.old.initialMap.contentHash, fixture.old.nextMap.contentHash] },
    current: { releaseId: fixture.current.release.id, entryHash: fixture.current.content.contentHash,
      battleHash: fixture.current.battle.contentHash, worldHash: fixture.current.world.contentHash,
      mapHashes: [fixture.current.initialMap.contentHash, fixture.current.nextMap.contentHash] } };
  report.limitations = [
    "Both releases are synthetic authored content built with the real initialized-entry compiler; no original story is changed or claimed.",
    "Archive JSON bodies and checkpoint identities remain unchanged. Network delay/failure, readiness and storage are controlled hosts.",
    "The explicit mediaBindings dictionaries are empty; real archived PNG/FLAC retention and browser decoding are separate acceptance lanes.",
    "An archive selects exact supported content. It does not upgrade an unsupported checkpoint codec or relax source capability gates.",
  ];
  const after = await runtimeDigest(root, compiled);
  if (after !== before) { report.result = "invalidated"; report.runtimeHashAfter = after; }
  else report.result = "passed";
  assert.equal(report.result, "passed", "Runtime changed while checking release continuation");
} catch (error) {
  if (report.result !== "invalidated") report.result = "failed";
  report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, cases: report.cases.length, runtimeHash: report.runtimeHash,
    report: reportPath, reportSha256: sha(await readFile(reportPath)), ...report.evidence }));
}
