// Preserve the old closure before any shared package writer replaces it, then
// snapshot the newly published closure. This wrapper does not admit content.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { archivePublishedContentPackages } from "./archive-content-release.mjs";

const root = resolve(import.meta.dirname, "..");
if (process.argv.length !== 2) throw new Error("Use build-versioned-content-packages.mjs without arguments");
const builders = ["build-content-packages.mjs", "build-battle-content-batch.mjs",
  "build-development-content-batch.mjs", "build-systems-playground.mjs",
  "build-initialized-systems.mjs", "build-world-travel.mjs"];
const report = { kind: "versioned-content-package-build-v1", result: "running", stages: [],
  sourceGameplayAdmitted: false, fullGameMigration: false };
const output = resolve(root, "build/reports/versioned-content-package-build.json");
await mkdir(resolve(output, ".."), { recursive: true });
const persist = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
try {
  report.before = await archivePublishedContentPackages({ root }); await persist();
  for (const script of builders) {
    await new Promise((yes, no) => {
      const child = spawn(process.execPath, [resolve(root, "scripts", script)], { cwd: root, stdio: "inherit" });
      child.once("error", no);
      child.once("exit", (code, signal) => code === 0 ? yes() : no(new Error(`${script} exited ${signal ?? code}`)));
    });
    report.stages.push({ script, status: "passed" }); await persist();
  }
  report.after = await archivePublishedContentPackages({ root }); report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally { await persist(); }
