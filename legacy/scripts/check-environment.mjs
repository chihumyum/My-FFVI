// Executes source operands and initializers, not an original-game audio comparison.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../dist/src/compiler/corpus.js";
import { loadAudioMedia } from "../dist/src/compiler/audio.js";
import { decodeFieldOp } from "../dist/src/compiler/field.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
import { FieldGame } from "../dist/src/core/field.js";
import { WorldSession } from "../dist/src/core/world-session.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(root + "/" + path, "utf8")));
const corpus = await loadCorpus(root);
const bootstrap = await read("build/game/narshe.json");
const catalog = await read("build/world/catalog.json");
const media = await loadAudioMedia(
  root,
  bootstrap.parentSourceSetHash,
  "environment",
);
const exported = JSON.parse(
  await readFile(root + "/build/environment/media.json", "utf8"),
);
assert.equal(exported.corpusSourceSetHash, corpus.sourceSetHash);
assert.equal(catalog.sourceSetHash, corpus.sourceSetHash);
assert.deepEqual(media, bootstrap.environment);
assert.deepEqual(media, catalog.environment);
const seedBgm = Number(Object.keys(bootstrap.bgm.tracks)[0]);
const seedEnvironment = Number(Object.keys(media.tracks)[0]);
const runs = [],
  excluded = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    if (
      !["PlayEnvSe", "StopEnvSe", "PauseEnvSe", "PitchEnvSe"].includes(
        raw.mnemonic,
      )
    )
      continue;
    const site = {
      script: "environment-probe",
      index,
      source: { ...asset.source, pointer: "/Mnemonics/" + index },
    };
    const op = decodeFieldOp(raw, site, {});
    if (op.kind === "blocked") {
      excluded.push(op);
      continue;
    }
    assert.ok(["environment-play", "environment-stop"].includes(op.kind));
    const game = new FieldGame({
      ...bootstrap,
      scripts: { "environment-probe": [op, { ...site, kind: "exit" }] },
    });
    // Controlled preconditions test independent buses and stopping a nonempty channel.
    game.bgm.play(seedBgm, 0, 0, 0, bootstrap.bgm);
    for (const channel of [0, 1])
      game.environment.play(seedEnvironment, channel, 0, 0, media);
    const beforeBgm = game.bgm.snapshot();
    const otherChannel = game.environment.snapshot().channels[1 - op.channel];
    game.startEvent("environment-probe");
    assert.equal(game.stop, null, JSON.stringify(site));
    assert.equal(game.busy, false);
    assert.deepEqual(game.bgm.snapshot(), beforeBgm);
    assert.equal(
      game.environment.snapshot().channels[1 - op.channel],
      otherChannel,
    );
    const current = game.environment.snapshot().channels[op.channel];
    if (op.kind === "environment-play") {
      assert.equal(
        game.environment.voices.find((v) => v.id === current).track,
        op.track,
      );
    } else assert.equal(current, null);
    game.advance(1000);
    runs.push({ site, kind: op.kind, snapshot: game.environment.snapshot() });
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
  if (world.field.environment.voices.length)
    entrances.push({
      mapId: run.mapId,
      entrance: run.entrance,
      environment: world.field.environment.snapshot(),
      bgm: world.field.bgm.snapshot(),
    });
}
const report = {
  formatVersion: 1,
  kind: "source-environment-check",
  sourceSetHash: corpus.sourceSetHash,
  environmentSourceSetHash: media.sourceSetHash,
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  tracks: Object.keys(media.tracks).length,
  files: new Set(Object.values(media.tracks).map((t) => t.sha256)).size,
  loops: Object.values(media.tracks).filter((t) => t.loop).length,
  ramps: Object.values(media.tracks).filter((t) => t.gainRamp).length,
  controlledPreconditions: {
    bgm: seedBgm,
    environment: seedEnvironment,
    channels: [0, 1],
  },
  runs,
  excluded,
  entrances,
  limitations: [
    "Isolated instruction probes seed audio explicitly; entrance probes use source initializers without audio seeding.",
    "No original-runtime, audible or full story-path comparison; idle entrances do not establish story reachability.",
    "Pause/PitchEnvSe, synchronous playback, nonzero seeks/pan, negative fades and native mixer features remain incomplete.",
  ],
};
await writeFile(
  root + "/build/reports/environment-check.json",
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(
  JSON.stringify(
    {
      tracks: report.tracks,
      files: report.files,
      loops: report.loops,
      ramps: report.ramps,
      executed: runs.length,
      excluded: excluded.length,
      environmentEntrances: entrances.length,
      environmentMaps: new Set(entrances.map((e) => e.mapId)).size,
      reportHash: hash(report),
    },
    null,
    2,
  ),
);
