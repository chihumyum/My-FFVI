// Maintained core transaction tests, with synthetic content and explicit hosts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const names = ["game-map-loader", "game-entry-loader", "game-commands", "saved-game"];
const output = resolve(root, "build/reports/framework-io-check.json");
const report = { kind: "framework-io-check-v1", result: "running", cases: [],
  evidence: "real-core-with-synthetic-content-and-controlled-I/O", browserExecuted: false, originalGameExecuted: false };
await mkdir(resolve(root, "build/reports"), { recursive: true });
try {
  const tap = execFileSync(process.execPath, ["--test", "--test-reporter=tap",
    ...names.map(name => resolve(compiled, "tests", name + ".test.js"))], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  await writeFile(resolve(root, "build/reports/framework-io-check.tap"), tap);
  report.cases = [...tap.matchAll(/^\s*(ok|not ok) (\d+) - (.+)$/gm)]
    .map(([, status, index, name]) => ({ index: Number(index), name, pass: status === "ok" }));
  assert.ok(report.cases.length > 0 && report.cases.every(c => c.pass));
  for (const label of ["fail", "cancelled", "skipped", "todo"])
    assert.match(tap, new RegExp("^# " + label + " 0$", "m"));
  assert.match(tap, new RegExp("^# tests " + report.cases.length + "$", "m"));
  report.files = await Promise.all(names.map(async name => ({ file: `src/core/${name}.ts`,
    sha256: createHash("sha256").update(await readFile(resolve(root, "src/core", name + ".ts"))).digest("hex") })));
  report.result = "passed";
} catch (error) {
  if (error.stdout || error.stderr)
    await writeFile(resolve(root, "build/reports/framework-io-check.tap"), String(error.stdout ?? "") + String(error.stderr ?? ""));
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, cases: report.cases.length }));
}
