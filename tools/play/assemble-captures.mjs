import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";

const base = path.resolve(process.env.PLAY_ACCEPTANCE_DIR || "build/play/acceptance/step-4"),
  manifest = JSON.parse(await readFile(path.join(base, "boundaries/manifest.json"))),
  overrides = JSON.parse(
    await readFile(path.join(base, "boundaries/final-material-manifest.json")),
  ),
  requiredOverrides = new Set(overrides.entries.map((row) => row.sequence)),
  cameraOverrides = JSON.parse(
    await readFile(path.join(base, "boundaries/camera-lifetime-final-manifest.json")),
  ),
  requiredCameraOverrides = new Set(cameraOverrides.entries.map((row) => row.sequence)),
  farOverrides = JSON.parse(
    await readFile(path.join(base, "boundaries/far-variant-final-manifest.json")),
  ),
  requiredFarOverrides = new Set(farOverrides.entries.map((row) => row.sequence)),
  output = path.join(base, "screenshots-final"),
  limit = Number(process.env.PLAY_FRAME_LIMIT || Infinity),
  entries = manifest.entries.filter((row) => row.sequence <= limit),
  missing = [],
  sources = {},
  failures = [];
await mkdir(output, { recursive: true });
for (const entry of entries) {
  const source = requiredFarOverrides.has(entry.sequence)
    ? "screenshots-far-final"
    : requiredCameraOverrides.has(entry.sequence)
      ? "screenshots-camera-final"
      : requiredOverrides.has(entry.sequence)
        ? "screenshots-material-final"
        : "screenshots-reviewed";
  try {
    const row = JSON.parse(await readFile(path.join(base, source, entry.file)));
    assert.equal(row.completed, true);
    assert.equal(row.sequence, entry.sequence);
    assert.equal(row.renderedFrame?.mapId, entry.mapId);
    assert.equal(row.renderedFrame?.time, entry.time);
    assert.equal(row.metrics.texturesLoading, 0);
    assert.equal(row.metrics.texturesFailed, 0);
    assert.deepEqual(row.errors || [], []);
    await copyFile(path.join(base, source, row.screenshot), path.join(output, row.screenshot));
    await writeFile(
      path.join(output, entry.file),
      JSON.stringify({ ...row, sourceCapture: `${source}/${entry.file}` }, null, 2),
    );
    sources[source] = (sources[source] || 0) + 1;
  } catch (error) {
    const issue = { sequence: entry.sequence, source, reason: error.message };
    (error.code === "ENOENT" ? missing : failures).push(issue);
    await rm(path.join(output, entry.file), { force: true });
    await rm(path.join(output, entry.file.replace(/\.json$/, ".png")), { force: true });
  }
}
const report = {
  required: entries.length,
  fullRunFrames: manifest.entries.length,
  copied: Object.values(sources).reduce((a, b) => a + b, 0),
  sources,
  missing,
  failures,
  complete: entries.length === manifest.entries.length && !missing.length && !failures.length,
  scope:
    "Final still-frame assembly. Every corrected-map frame must use its corrected build; a missing corrected frame cannot fall back to the superseded render. No screenshot failure is counted as a pass.",
};
await writeFile(path.join(output, "assembly.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    required: report.required,
    copied: report.copied,
    missing: missing.length,
    failures: failures.length,
    complete: report.complete,
  }),
);
if (missing.length || failures.length) process.exitCode = 1;
