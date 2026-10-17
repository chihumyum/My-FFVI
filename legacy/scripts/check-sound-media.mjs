// Source media/integrity checks, not browser playback or an original-game oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const argument = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const dist = resolve(root, argument("--dist", "dist"));
const { loadAudioMedia } = await import(pathToFileURL(dist + "/src/compiler/audio.js"));
const { canonical, hash } = await import(pathToFileURL(dist + "/src/compiler/content.js"));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const digest = async (path) => {
  const value = createHash("sha256");
  for await (const chunk of createReadStream(path)) value.update(chunk);
  return value.digest("hex");
};
const imported = await json(root + "/build/import/snapshot.json");
for (const name of ["project.json", "tables.json"]) {
  const entry = imported.files.find((file) => file.file === name);
  assert.ok(entry, "Missing source import dependency " + name);
  assert.equal(await digest(root + "/build/import/" + name), entry.sha256);
}
const project = await json(root + "/build/import/project.json");
assert.equal(hash(project.sources), project.sourceSetHash);
const rows = (await json(root + "/build/import/tables.json"))["se_asset.csv"];
const media = await loadAudioMedia(root, project.sourceSetHash, "se");
const exported = await json(root + "/build/se/media.json");
for (const source of exported.sources)
  assert.equal(await digest(root + "/build/runtime/game/" + source.file), source.sha256, source.file);
const ids = new Set(), blocked = new Map(exported.diagnostics.map((entry) => [String(entry.id), entry]));
const admitted = exported.tracks;
for (const row of rows) {
  assert.ok(!ids.has(row.id), "Duplicate source SE identity"); ids.add(row.id);
  const track = admitted[row.id], diagnostic = blocked.get(row.id);
  assert.equal(Boolean(track) !== Boolean(diagnostic), true, "SE row must have one explicit outcome: " + row.id);
  const entry = track ?? diagnostic;
  assert.equal(entry.assetName, row.asset_name); assert.equal(entry.group, row.se_name);
  assert.equal(entry.resident, Number(row.resident)); assert.equal(entry.tableSource.pointer, "/id/" + row.id);
  assert.equal(entry.source.assetPath, `Assets/GameAssets/Common/Res/Audio/${row.se_name}/${row.asset_name}.bytes`);
  if (!track) { assert.equal(media.tracks[row.id], undefined); continue; }
  const loaded = media.tracks[row.id]; assert.ok(loaded);
  assert.deepEqual({ ...loaded, file: track.file }, track);
  const encoded = await readFile(root + "/build/se/" + track.file);
  assert.equal(encoded.subarray(0, 4).toString(), "fLaC", "Source output is not FLAC");
  assert.equal(createHash("sha256").update(encoded).digest("hex"), track.sha256);
}
assert.equal(Object.keys(admitted).length + blocked.size, ids.size);
assert.deepEqual(new Set([...Object.keys(admitted), ...blocked.keys()]), ids);
const tracks = Object.values(admitted), unique = new Set(tracks.map((track) => track.file));
const report = { formatVersion: 1, kind: "source-sound-media-check", parentSourceSetHash: project.sourceSetHash,
  sourceSetHash: media.sourceSetHash, mediaSha256: await digest(root + "/build/se/media.json"),
  snapshotSha256: await digest(root + "/build/se/snapshot.json"), sourceFiles: exported.sources.length,
  masterRows: rows.length, tracks: tracks.length, uniqueMediaFiles: unique.size,
  oneShots: tracks.filter((track) => track.loop === null).length, loops: tracks.filter((track) => track.loop !== null).length,
  gainRamps: tracks.filter((track) => track.gainRamp !== null).length,
  codecs: [...new Set(tracks.map((track) => track.codec))].sort(), blocked: exported.diagnostics,
  originalGameExecuted: false, browserPlayed: false,
  limitations: exported.limitations };
await writeFile(root + "/build/reports/sound-media-check.json", canonical({ ...report, contentHash: hash(report) }) + "\n");
console.log(JSON.stringify({ rows: report.masterRows, tracks: report.tracks, uniqueMediaFiles: report.uniqueMediaFiles,
  oneShots: report.oneShots, loops: report.loops, gainRamps: report.gainRamps, blocked: blocked.size,
  sourceSetHash: report.sourceSetHash, reportHash: hash(report) }, null, 2));
