// Runs the maintained session integration tests; it does not duplicate their
// fixture or substitute aggregate counts for executable lifecycle checks.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const testFile = resolve(compiled, "tests/field-transportation-session.test.js");
const output = root + "build/reports/field-transportation-session-check.json";
const tapFile = root + "build/reports/field-transportation-session-check.tap";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", testFile],
  { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const tap = result.stdout ?? "", stderr = result.stderr ?? "";
await writeFile(tapFile, tap + (stderr ? "\n" + stderr : ""));
const cases = [...tap.matchAll(/^(ok|not ok) (\d+) - (.+)$/gm)]
  .map(([, result, index, name]) => ({ index: Number(index), name, pass: result === "ok" }));
const count = (label) => Number(tap.match(new RegExp("^# " + label + " (\\d+)$", "m"))?.[1] ?? NaN);
const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(label => [label, count(label)]));
const passed = result.status === 0 && cases.length > 0 && counts.tests === cases.length &&
  counts.pass === cases.length && [counts.fail, counts.cancelled, counts.skipped, counts.todo].every(value => value === 0) &&
  cases.every(c => c.pass);
const files = await Promise.all(["tests/field-transportation-session.test.ts", "tests/fixtures/source-new-game.ts",
  "src/core/game-state.ts", "src/core/source-native-state.ts", "src/core/transportation-state.ts",
  "src/core/field.ts", "src/core/world-session.ts", "src/core/game-session.ts"]
  .map(async file => ({ file, sha256: sha(await readFile(root + file)) })));
const report = { formatVersion: 1, kind: "field-transportation-session-check", status: passed ? "pass" : "fail",
  mode: "controlled-source-factory-session", files, compiledTestSha256: sha(await readFile(testFile)),
  command: { executable: process.execPath, args: ["--test", "--test-reporter=tap", testFile] },
  exitCode: result.status, signal: result.signal, counts, cases,
  stages: cases.map(c => ({ stage: c.name, pass: c.pass })),
  log: "build/reports/field-transportation-session-check.tap", logSha256: sha(await readFile(tapFile)),
  ownedFormatVersion: 10, originalGameExecuted: false, browserExecuted: false, semanticsVerified: false,
  limitations: ["Uses an explicit framework presentation capability and synthetic source factory/media with controlled timestamp.",
    "Exercises GameSession, title entry, native actor owners, EventState, map candidates and JSON restore without original-game execution.",
    "It does not validate source riding animation, vehicle audio, collision, GPS, speed or random-encounter providers."] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
assert.equal(passed, true, result.error?.message ?? `Transportation session tests failed; see ${tapFile}`);
console.log(JSON.stringify({ status: report.status, cases: cases.length, ...counts,
  reportSha256: sha(await readFile(output)), semanticsVerified: false }));
