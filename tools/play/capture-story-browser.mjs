import { readdir, readFile, writeFile, mkdir, rename, open } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

// Consume the passive recorder while the unmodified regression is running.
// Each worker owns a browser profile and a disjoint sequence range. No worker
// sends gameplay input or writes a save; every frame is frozen by the app host.
const directory = path.resolve(process.env.PLAY_BOUNDARY_DIR),
  output = path.resolve(process.env.PLAY_SCREENSHOT_DIR),
  workers = Math.max(1, Math.min(4, Number(process.env.PLAY_CAPTURE_WORKERS || 3))),
  watch = process.env.PLAY_CAPTURE_WATCH === "1",
  maps = process.env.PLAY_FRAME_MAPS?.split(",").map(Number),
  manifestName = `capture-manifest-${process.pid}.json`,
  chunk = 300,
  entries = new Map(),
  active = new Map(),
  jobs = [];
await mkdir(output, { recursive: true });
let next = 1,
  finished = false;
async function refresh() {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json")));
    if (manifest.schema === "ffvi-boundary-checkpoints") {
      for (const entry of manifest.entries) entries.set(entry.sequence, entry);
      finished = true;
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (!finished)
    for (const file of await readdir(directory)) {
      const sequence = Number(file.match(/^(\d+)-.*\.json$/)?.[1]);
      if (!sequence || entries.has(sequence)) continue;
      try {
        entries.set(sequence, JSON.parse(await readFile(path.join(directory, file))).metadata);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  const manifest = {
    schema: "ffvi-screenshot-queue",
    entries: [...entries.values()].sort((a, b) => a.sequence - b.sequence),
  };
  await writeFile(path.join(directory, manifestName + ".tmp"), JSON.stringify(manifest));
  await rename(path.join(directory, manifestName + ".tmp"), path.join(directory, manifestName));
}
async function dispatch(first, last) {
  const log = await open(path.join(output, `capture-${first}-${last}.log`), "w"),
    job = { first, last, started: new Date().toISOString() },
    child = spawn(process.execPath, ["tools/play/capture-boundaries-browser.mjs"], {
      env: {
        ...process.env,
        PLAY_BOUNDARY_DIR: directory,
        PLAY_SCREENSHOT_DIR: output,
        PLAY_FRAME_MANIFEST: manifestName,
        PLAY_FRAME_RANGE: `${first}:${last}`,
      },
      stdio: ["ignore", log.fd, log.fd],
    });
  jobs.push(job);
  active.set(first, child);
  child.once("exit", async (code, signal) => {
    job.code = code;
    job.signal = signal;
    job.finished = new Date().toISOString();
    active.delete(first);
    await log.close();
    console.log(JSON.stringify(job));
  });
}
do {
  await refresh();
  if (!watch && !finished)
    throw new Error(
      "The recorder has no completed manifest; use PLAY_CAPTURE_WATCH=1 while recording",
    );
  let contiguous = 0;
  while (entries.has(contiguous + 1)) contiguous++;
  while (
    active.size < workers &&
    (next + chunk - 1 <= contiguous || (finished && next <= contiguous))
  ) {
    const last = Math.min(contiguous, next + chunk - 1);
    if (
      !maps ||
      [...entries.values()].some(
        (row) => row.sequence >= next && row.sequence <= last && maps.includes(row.mapId),
      )
    )
      await dispatch(next, last);
    next = last + 1;
  }
  if ((finished || !watch) && next > contiguous && !active.size) break;
  await wait(1000);
} while (true);
const summaries = await Promise.all(
  jobs.map(async (job) => {
    try {
      return JSON.parse(await readFile(path.join(output, `summary-${job.first}-${job.last}.json`)));
    } catch (error) {
      return { failed: 1, harnessError: error.message };
    }
  }),
);
const summary = {
  scope:
    "Every recorded boundary and visible companion, rendered by real static-package browsers. Capture success does not certify scene composition; contact sheets still require visual review.",
  source: directory,
  recorderFinished: finished,
  recorded: entries.size,
  requested: [...entries.values()].filter((row) => !maps || maps.includes(row.mapId)).length,
  captured: summaries.reduce((sum, row) => sum + (row.captured || 0), 0),
  failed: summaries.reduce((sum, row) => sum + (row.failed || 0) + (row.unattempted || 0), 0),
  pageErrors: summaries.reduce((sum, row) => sum + (row.pageErrors || 0), 0),
  jobs,
};
await writeFile(path.join(output, "capture-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (
  !finished ||
  summary.failed ||
  summary.pageErrors ||
  summary.captured !== summary.requested ||
  jobs.some((job) => job.code !== 0)
)
  process.exitCode = 1;
