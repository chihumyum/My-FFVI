import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const base = path.resolve(process.env.PLAY_ACCEPTANCE_DIR || "build/play/acceptance/step-4"),
  frames = path.resolve(process.env.PLAY_SCREENSHOT_DIR || path.join(base, "screenshots-final")),
  manifest = JSON.parse(await readFile(path.join(base, "boundaries/manifest.json"))),
  reviews = (
    process.env.PLAY_REVIEW_FILES || "review-corrected-root.json,review-corrected-water-agent.json"
  ).split(","),
  reviewed = new Map(),
  missing = [],
  unchecked = [],
  browserErrors = [],
  pixelIssues = [],
  manualPending = [];
for (const file of reviews) {
  const report = JSON.parse(await readFile(path.resolve(base, file)));
  assert.equal(
    path.resolve(base, report.source),
    path.join(frames, "walls"),
    "A review must refer to the actual captured build, never a superseded screenshot set",
  );
  for (const row of report.walls) {
    reviewed.set(row.wall, Math.max(reviewed.get(row.wall) || 0, row.cellsReviewed));
    if (row.pending) manualPending.push({ wall: row.wall, ...row.pending, notes: row.notes });
  }
}
for (const entry of manifest.entries) {
  try {
    const row = JSON.parse(await readFile(path.join(frames, entry.file)));
    assert.equal(row.completed, true);
    assert.equal(row.sequence, entry.sequence);
    assert.equal(row.mapId, entry.mapId);
    assert.equal(row.time, entry.time);
    assert.equal(row.renderedFrame?.mapId, entry.mapId, "The requested map was not actually drawn");
    assert.equal(row.renderedFrame?.time, entry.time, "The GPU frame is stale");
    assert.equal(row.metrics.texturesLoading, 0, "Textures are still loading");
    assert.equal(row.metrics.texturesFailed, 0, "A source texture failed to load");
    await access(path.join(frames, row.screenshot));
    if (row.errors?.length) browserErrors.push({ sequence: entry.sequence, errors: row.errors });
    if (row.pixelIssues?.length)
      pixelIssues.push({ sequence: entry.sequence, issues: row.pixelIssues });
  } catch (error) {
    missing.push({ sequence: entry.sequence, file: entry.file, reason: error.message });
  }
}
for (let wall = 1; wall <= Math.ceil(manifest.entries.length / 16); wall++) {
  const expected = Math.min(16, manifest.entries.length - (wall - 1) * 16);
  if (reviewed.get(wall) !== expected)
    unchecked.push({ wall, expectedCells: expected, reviewedCells: reviewed.get(wall) || 0 });
  await access(path.join(frames, "walls", `${String(wall).padStart(3, "0")}.jpg`));
}
const rank = { high: 0, medium: 1, low: 2 };
manualPending.sort(
  (a, b) => (rank[a.confidence] ?? 1) - (rank[b.confidence] ?? 1) || a.wall - b.wall,
);
const report = {
  scope:
    "Coverage and human-agent review ledger only. An inspected cell is not a visual pass. Browser failures, transparent source textures and all pending scene questions remain visible; corrected follow-ups are separate reports.",
  requiredFrames: manifest.entries.length,
  eventCounts: manifest.counts,
  captureAndReviewComplete: !missing.length && !unchecked.length && !browserErrors.length,
  missing,
  unchecked,
  browserErrors,
  pixelIssues,
  manualPending,
};
await writeFile(path.join(base, "capture-coverage.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    frames: report.requiredFrames,
    missing: missing.length,
    uncheckedWalls: unchecked.length,
    browserErrorFrames: browserErrors.length,
    zeroAlphaFrames: pixelIssues.length,
    pendingWalls: manualPending.length,
  }),
);
if (missing.length || unchecked.length || browserErrors.length) process.exitCode = 1;
