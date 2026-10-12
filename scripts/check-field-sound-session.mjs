// Runs maintained owner/session tests rather than a second hand-written runtime.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"), testFile = resolve(compiled, "tests/field-sound-session.test.js");
const output = root + "build/reports/field-sound-session-check.json",
  tapFile = root + "build/reports/field-sound-session-check.tap";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", testFile],
  { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const tap = result.stdout ?? "", stderr = result.stderr ?? "";
await writeFile(tapFile, tap + (stderr ? "\n" + stderr : ""));
const cases = [...tap.matchAll(/^(ok|not ok) (\d+) - (.+)$/gm)]
  .map(([, status, index, name]) => ({ index: Number(index), name, pass: status === "ok" }));
const count = label => Number(tap.match(new RegExp("^# " + label + " (\\d+)$", "m"))?.[1] ?? NaN);
const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(label => [label, count(label)]));
const passed = result.status === 0 && cases.length > 0 && counts.tests === cases.length &&
  counts.pass === cases.length && [counts.fail, counts.cancelled, counts.skipped, counts.todo].every(value => value === 0) &&
  cases.every(c => c.pass);
const files = await Promise.all(["tests/field-sound-session.test.ts", "tests/fixtures/checkpoint-game.ts",
  "src/core/field-sound.ts", "src/core/field-sound-command.ts", "src/core/field-sound-presentation.ts",
  "src/core/static-audio.ts", "src/compiler/field-sound.ts",
  "src/core/field.ts", "src/core/event-state.ts", "src/core/world-session.ts", "src/core/game-session.ts"]
  .map(async file => ({ file, sha256: sha(await readFile(root + file)) })));
const report = { formatVersion: 1, kind: "field-sound-session-check", status: passed ? "pass" : "fail",
  mode: "controlled-decoder-session", files, compiledTestSha256: sha(await readFile(testFile)),
  command: { executable: process.execPath, args: ["--test", "--test-reporter=tap", testFile] },
  exitCode: result.status, signal: result.signal, counts, cases,
  stages: cases.map(c => ({ stage: c.name, pass: c.pass })),
  log: "build/reports/field-sound-session-check.tap", logSha256: sha(await readFile(tapFile)),
  ownedFormatVersion: 10, fieldKind: "idle-field-v10", worldKind: "idle-world-v10", gameFormatVersion: 4,
  originalGameExecuted: false, browserExecuted: false, semanticsVerified: false,
  limitations: ["Uses synthetic media and script content with the real source decoder and explicit controlled readiness/presentation acknowledgments.",
    "Exercises FieldGame, GameSession, EventState, WorldSession candidates and stable JSON restore; it is not source-playthrough coverage.",
    "Linear gain, repeated-stop fade rebasing and duration-based completion are the explicit Web audio adapter, not native mixer timing."] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
assert.equal(passed, true, result.error?.message ?? `SE session tests failed; see ${tapFile}`);
console.log(JSON.stringify({ status: report.status, cases: cases.length, ...counts,
  reportSha256: sha(await readFile(output)), semanticsVerified: false }));
