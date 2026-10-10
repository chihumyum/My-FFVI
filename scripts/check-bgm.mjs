// Real source operands executed by the shared VM; this does not establish audible or native parity.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../dist/src/compiler/corpus.js";
import { decodeFieldOp } from "../dist/src/compiler/field.js";
import { loadBgmMedia } from "../dist/src/compiler/bgm.js";
import { FieldGame } from "../dist/src/core/field.js";
import { WorldSession } from "../dist/src/core/world-session.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(root + "/" + path, "utf8")));
const corpus = await loadCorpus(root),
  bootstrap = await read("build/game/narshe.json");
const media = await loadBgmMedia(root, bootstrap.parentSourceSetHash);
assert.deepEqual(media, bootstrap.bgm);
const catalog = await read("build/world/catalog.json");
assert.deepEqual(catalog.bgm, media);
const runs = [],
  excluded = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    if (!["PlayBGM", "StopBGM"].includes(raw.mnemonic)) continue;
    const site = {
      script: "audio-probe",
      index,
      source: { ...asset.source, pointer: "/Mnemonics/" + index },
    };
    const op = decodeFieldOp(raw, site, {});
    if (op.kind === "blocked") {
      excluded.push(op);
      continue;
    }
    const game = new FieldGame({
      ...bootstrap,
      scripts: { "audio-probe": [op, { ...site, kind: "exit" }] },
    });
    game.startEvent("audio-probe");
    assert.equal(game.stop, null, JSON.stringify(site));
    assert.equal(game.busy, false);
    if (op.kind === "bgm-play") {
      assert.equal(game.bgm.voices[0].track, op.track);
      assert.equal(
        game.bgm.snapshot().channels[op.channel],
        game.bgm.voices[0].id,
      );
      game.advance(1000);
    }
    runs.push({ site, kind: op.kind, snapshot: game.bgm.snapshot() });
  }
}
const loaded = await read("build/reports/world-check.json");
assert.equal(loaded.catalogHash, catalog.contentHash);
assert.equal(loaded.bootstrapHash, bootstrap.contentHash);
const entrances = [];
for (const run of loaded.runs.filter((r) => r.result === "idle")) {
  const target = await read(`build/world/maps/${run.mapId}.json`);
  const world = new WorldSession(bootstrap);
  world.field.previewMap(run.mapId, run.entrance);
  assert.ok(world.commit(world.prepare(catalog, target)));
  if (world.field.bgm.voices.length)
    entrances.push({
      mapId: run.mapId,
      entrance: run.entrance,
      bgm: world.field.bgm.snapshot(),
    });
}
assert.ok(entrances.length, "No original map initializer played BGM");
const report = {
  formatVersion: 1,
  kind: "source-bgm-check",
  sourceSetHash: corpus.sourceSetHash,
  bgmSourceSetHash: media.sourceSetHash,
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  tracks: Object.keys(media.tracks).length,
  loops: Object.values(media.tracks).filter((t) => t.loop).length,
  runs,
  excluded,
  entrances,
  limitations: [
    "Executes source audio operands and map initializers; no original-runtime or audible comparison.",
    "SyncBGM, synchronous PlayBGM, negative fades, environment sound, SE and automatic map/battle music remain incomplete.",
  ],
};
await writeFile(
  root + "/build/reports/bgm-check.json",
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(
  JSON.stringify(
    {
      tracks: report.tracks,
      loops: report.loops,
      executed: runs.length,
      excluded: excluded.length,
      musicEntrances: entrances.length,
      musicMaps: new Set(entrances.map((e) => e.mapId)).size,
      reportHash: hash(report),
    },
    null,
    2,
  ),
);
