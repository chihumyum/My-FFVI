import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAudioMedia } from "../src/compiler/audio.js";
import { canonical, hash } from "../src/compiler/content.js";

// Authored bytes test the loader's provenance boundary, not an audio decoder.
const bytes = Buffer.from("controlled-lossless-audio-placeholder"), sha = createHash("sha256").update(bytes).digest("hex");
const sources = [
  { file: "GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" },
  { file: "FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat", sha256: "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45" },
  { file: "FINAL FANTASY VI_Data/Plugins/x86_64/sead.dll", sha256: "8607d832df2e1b359bc4bd45c5cbea859024091ce8b1b16726954a07b3630735" },
  { file: "master_assets_all_fixture.bundle", sha256: "a".repeat(64) },
  { file: "fixture_se_assets_all_fixture.bundle", sha256: "b".repeat(64) },
];
const binding = (id: number, name: string) => ({ group: "fixture_se", assetName: name, resident: 0,
  bankSha256: "c".repeat(64), source: { ...sources[4]!,
    assetPath: `Assets/GameAssets/Common/Res/Audio/fixture_se/${name}.bytes`, serializedFile: "CAB-fixture", objectId: "9223372036854775807" },
  tableSource: { ...sources[3]!, assetPath: "Assets/GameAssets/Serial/Data/Master/se_asset.csv",
    serializedFile: "CAB-table", objectId: "-9223372036854775808", pointer: `/id/${id}` } });
function media() {
  return { formatVersion: 1, adapterVersion: "se-0.1.0", parentSourceSetHash: "controlled-parent",
    sourceSetHash: hash(sources), sources: structuredClone(sources), decoder: { vgmstream: "r2117" }, masterRows: 2,
    tracks: { "101": { ...binding(101, "ordinary.sab"), file: `tracks/${sha}.flac`, sha256: sha,
      pcmSha256: "d".repeat(64), sampleRate: 44100, frames: 1000, channels: 1,
      loop: { start: 10, end: 990 }, gain: .5, gainRamp: null } },
    diagnostics: [{ ...binding(102, "complex.sab"), id: 102, stage: "program", reason: "Unsupported SAB curve" }] };
}
async function fixture(value = media()) {
  const root = await mkdtemp(join(tmpdir(), "ffvi-se-loader-")), directory = root + "/build/se/";
  await mkdir(directory + "tracks", { recursive: true });
  const write = async () => {
    const raw = canonical(value) + "\n";
    await writeFile(directory + "media.json", raw);
    await writeFile(directory + `tracks/${sha}.flac`, bytes);
    await writeFile(directory + "snapshot.json", canonical({ formatVersion: 1, files: [
      { file: "media.json", sha256: createHash("sha256").update(raw).digest("hex") },
      { file: `tracks/${sha}.flac`, sha256: sha },
    ] }));
  };
  await write();
  return { root, directory, value, write, close: () => rm(root, { recursive: true, force: true }) };
}

test("sound loader preserves source identities, sample loops and gain while leaving blocked rows absent", async () => {
  const f = await fixture();
  try {
    const loaded = await loadAudioMedia(f.root, "controlled-parent", "se");
    assert.equal(loaded.tracks[101]!.file, `/se/tracks/${sha}.flac`);
    assert.deepEqual(loaded.tracks[101]!.loop, { start: 10, end: 990 });
    assert.equal(loaded.tracks[101]!.gain, .5); assert.equal(loaded.tracks[102], undefined);
    assert.equal(loaded.tracks[101]!.source.objectId, "9223372036854775807");
    assert.equal(loaded.tracks[101]!.tableSource.objectId, "-9223372036854775808");
  } finally { await f.close(); }
});

test("changed media bytes and mismatched parents reject before a catalog is returned", async () => {
  const f = await fixture();
  try {
    await assert.rejects(loadAudioMedia(f.root, "another-parent", "se"), /source mismatch/);
    await writeFile(f.directory + `tracks/${sha}.flac`, "changed");
    await assert.rejects(loadAudioMedia(f.root, "controlled-parent", "se"), /Changed audio/);
    await f.write(); assert.ok((await loadAudioMedia(f.root, "controlled-parent", "se")).tracks[101]);
  } finally { await f.close(); }
});

test("SE diagnostics are an exhaustive disjoint partition and cannot authorize a playable blocked row", async () => {
  for (const change of [
    (value: ReturnType<typeof media>) => { value.masterRows = 3; },
    (value: ReturnType<typeof media>) => { value.diagnostics[0]!.id = 101; },
    (value: ReturnType<typeof media>) => { value.diagnostics.push(structuredClone(value.diagnostics[0]!)); value.masterRows++; },
    (value: ReturnType<typeof media>) => { value.diagnostics[0]!.reason = ""; },
  ]) {
    const value = media(); change(value); const f = await fixture(value);
    try { await assert.rejects(loadAudioMedia(f.root, "controlled-parent", "se"), /SE diagnostic|SE master/); }
    finally { await f.close(); }
  }
});

test("bank, table, source digest and 64-bit object identity must agree with the source manifest", async () => {
  for (const change of [
    (value: ReturnType<typeof media>) => { value.tracks[101].source.assetPath = "Assets/other.sab.bytes"; },
    (value: ReturnType<typeof media>) => { value.tracks[101].tableSource.pointer = "/id/102"; },
    (value: ReturnType<typeof media>) => { value.tracks[101].source.sha256 = "f".repeat(64); },
    (value: ReturnType<typeof media>) => { value.tracks[101].source.objectId = "9223372036854775808"; },
    (value: ReturnType<typeof media>) => { value.diagnostics[0]!.source.serializedFile = ""; },
  ]) {
    const value = media(); change(value); const f = await fixture(value);
    try { await assert.rejects(loadAudioMedia(f.root, "controlled-parent", "se"), /SE source|SE bank/); }
    finally { await f.close(); }
  }
});

test("sound gain, engine profile and decoder are checked independently of a valid snapshot digest", async () => {
  for (const change of [
    (value: ReturnType<typeof media>) => { value.tracks[101].gain = 2; },
    (value: ReturnType<typeof media>) => { value.tracks[101].loop.end = 1001; },
    (value: ReturnType<typeof media>) => { value.decoder.vgmstream = "future"; },
    (value: ReturnType<typeof media>) => { value.sources[2]!.sha256 = "e".repeat(64); value.sourceSetHash = hash(value.sources); },
  ]) {
    const value = media(); change(value); const f = await fixture(value);
    try { await assert.rejects(loadAudioMedia(f.root, "controlled-parent", "se"), /gain program|sample geometry|audio decoder|audio engine/); }
    finally { await f.close(); }
  }
});
