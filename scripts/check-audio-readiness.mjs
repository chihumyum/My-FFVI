// Exact source operands in controlled audio/field hosts. Counts are instruction
// and mechanism evidence, never playable maps or original-runtime acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>",
);
const compiled = resolve(root, args[1] ?? "dist"),
  module = (name) =>
    import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const { loadCorpus } = await module("compiler/corpus"),
  { decodeFieldOp } = await module("compiler/field"),
  { compileAudioReadinessInstruction } = await module(
    "compiler/audio-readiness",
  ),
  { loadAudioMedia } = await module("compiler/audio"),
  { hash } = await module("compiler/content"),
  { pollAudioReadiness } = await module("core/audio-readiness"),
  { StaticAudioState } = await module("core/static-audio"),
  { FieldGame } = await module("core/field");
const reportPath = root + "build/reports/audio-readiness-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(
  process.execPath,
  [root + "scripts/check-audio-readiness-native.mjs"],
  { cwd: root, stdio: "pipe" },
);
const nativeBytes = await readFile(
    root + "build/reports/audio-readiness-native-check.json",
  ),
  native = JSON.parse(nativeBytes),
  corpus = await loadCorpus(root),
  media = await loadAudioMedia(
    root,
    corpus.manifest.parentSourceSetHash,
    "bgm",
  );
assert.equal(native.semanticsVerified, false);
assert.equal(
  corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256,
  native.nativeSha256,
);
const calls = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script"))
  for (const [index, instruction] of (asset.data.Mnemonics ?? []).entries())
    if (["ReadyBGM", "SyncBGM"].includes(instruction.mnemonic)) {
      const site = {
        script: asset.data.Name,
        index,
        source: { ...asset.source, pointer: `/Mnemonics/${index}` },
      };
      const direct = compileAudioReadinessInstruction(instruction),
        op = decodeFieldOp(instruction, site, {}, corpus.tables);
      assert.deepEqual(
        op,
        { ...direct, ...site },
        "Shared field compiler readiness dispatch",
      );
      assert.equal(typeof site.source.objectId, "string");
      assert.match(site.source.objectId, /^-?\d+$/);
      calls.push({
        site,
        mnemonic: instruction.mnemonic,
        instructionHash: hash(instruction),
        op,
      });
    }
assert.equal(calls.length, 55);
assert.equal(calls.filter((c) => c.op.kind === "bgm-ready").length, 1);
assert.equal(
  calls.filter((c) => c.op.kind === "bgm-sync" && c.op.channel === 0).length,
  49,
);
assert.equal(
  calls.filter((c) => c.op.kind === "bgm-sync" && c.op.channel === 1).length,
  5,
);
const oneShot = Object.entries(media.tracks).find(([, t]) => t.loop === null),
  looping = Object.entries(media.tracks).find(([, t]) => t.loop !== null);
assert.ok(oneShot && looping);
const [oneShotId, oneShotTrack] = [Number(oneShot[0]), oneShot[1]],
  [loopId] = [Number(looping[0])],
  duration = oneShotTrack.frames / oneShotTrack.sampleRate;
const probes = [],
  fieldProbes = [],
  controlled = [];
function check(name, body) {
  body();
  controlled.push({ name, pass: true });
}
const syntheticSource = {
  file: "controlled",
  assetPath: "synthetic-audio-host",
};
function content(op) {
  return {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    contentHash: hash({ controlled: true, op }),
    map: {
      id: "controlled-audio-host",
      width: 3,
      height: 3,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(9).fill(0) },
      entities: [],
      source: syntheticSource,
    },
    characters: {},
    bgm: media,
    scripts: {
      probe: [
        op,
        { kind: "exit", script: "probe", index: 1, source: syntheticSource },
      ],
    },
    entry: {
      player: {
        x: 1,
        y: 1,
        layer: 1,
        direction: "up",
        asset: "controlled",
        mount: "",
      },
      evidence: [syntheticSource],
      description: "Controlled geometry, exact source audio instruction",
    },
    limitations: [],
  };
}
for (const call of calls) {
  const op = call.op,
    audio = new StaticAudioState();
  if (op.kind === "bgm-ready") {
    const observations = [];
    for (const ready of [false, true]) {
      const before = audio.snapshot(),
        flow = pollAudioReadiness(op, audio, media, {
          isReady: (track) => {
            assert.equal(track.sha256, media.tracks[op.track].sha256);
            return ready;
          },
        });
      assert.equal(flow, ready ? "next" : "wait");
      assert.deepEqual(audio.snapshot(), before);
      observations.push({ ready, flow });
    }
    assert.throws(() => pollAudioReadiness(op, audio, media), /provider/);
    probes.push({
      site: call.site,
      observations,
      missingProviderBlocked: true,
    });

    let loaded = false;
    const field = new FieldGame(content(op), undefined, undefined, undefined, {
      audioReadiness: { isReady: () => loaded },
    });
    assert.equal(field.startEvent("probe"), true);
    assert.equal(field.stop, null);
    assert.equal(field.busy, true);
    assert.equal(field.checkpointReady, false);
    assert.equal(field.bgm.voices.length, 0);
    assert.throws(() => field.checkpoint(), /Cannot save/);
    field.advance(30);
    assert.equal(field.busy, true);
    loaded = true;
    field.advance(10);
    assert.equal(field.stop, null);
    assert.equal(field.busy, false);
    assert.equal(field.bgm.voices.length, 0);
    const missing = new FieldGame(content(op));
    missing.startEvent("probe");
    assert.equal(missing.stop?.kind, "unsupported");
    assert.match(missing.stop.message, /provider/);
    fieldProbes.push({
      site: call.site,
      pendingThenCompleted: true,
      missingProviderBlocked: true,
      playbackUnchanged: true,
    });
  } else {
    const other = op.channel === 0 ? 1 : 0;
    assert.equal(pollAudioReadiness(op, audio, media), "next");
    audio.play(loopId, other, 0, 0, media);
    assert.equal(pollAudioReadiness(op, audio, media), "next");
    audio.play(oneShotId, op.channel, 0, duration - 0.025, media);
    assert.equal(pollAudioReadiness(op, audio, media), "wait");
    audio.advance(20, media);
    assert.equal(pollAudioReadiness(op, audio, media), "wait");
    audio.advance(10, media);
    assert.equal(pollAudioReadiness(op, audio, media), "next");
    audio.play(loopId, op.channel, 0, 0, media);
    audio.advance(1_000_000, media);
    assert.equal(pollAudioReadiness(op, audio, media), "wait");
    audio.stop(op.channel, 3);
    assert.equal(pollAudioReadiness(op, audio, media), "next");
    assert.ok(audio.voices.some((v) => v.stop !== null));
    probes.push({
      site: call.site,
      channel: op.channel,
      emptyAndOtherChannelComplete: true,
      oneShotCompletes: true,
      loopWaits: true,
      detachedTailCompletes: true,
    });

    const field = new FieldGame(content(op));
    field.bgm.play(oneShotId, op.channel, 0, duration - 0.025, media);
    assert.equal(field.startEvent("probe"), true);
    assert.equal(field.stop, null);
    assert.equal(field.busy, true);
    assert.equal(field.checkpointReady, false);
    field.advance(20);
    assert.equal(field.busy, true);
    field.advance(10);
    assert.equal(field.stop, null);
    assert.equal(field.busy, false);
    assert.equal(field.bgm.voices.length, 0);
    fieldProbes.push({
      site: call.site,
      sourceChannel: op.channel,
      waitingThenFinished: true,
    });
  }
}
const readyCall = calls.find((c) => c.op.kind === "bgm-ready"),
  syncCall = calls.find((c) => c.op.kind === "bgm-sync" && c.op.channel === 0);
check("Ready source site follows PlayBGM of the same master identity", () => {
  const asset = corpus.assets.find(
    (a) =>
      a.source.objectId === readyCall.site.source.objectId &&
      a.source.file === readyCall.site.source.file,
  );
  assert.ok(asset);
  const prior = asset.data.Mnemonics[readyCall.site.index - 1];
  assert.equal(prior.mnemonic, "PlayBGM");
  assert.equal(prior.operands.iValues[0], readyCall.op.track);
  assert.equal(media.tracks[readyCall.op.track].loop, null);
});
check(
  "host decode failure stops a field task without replaying or creating a voice",
  () => {
    const field = new FieldGame(
      content(readyCall.op),
      undefined,
      undefined,
      undefined,
      {
        audioReadiness: {
          isReady: () => {
            throw new Error("Controlled decode failure");
          },
        },
      },
    );
    field.startEvent("probe");
    assert.equal(field.stop?.kind, "unsupported");
    assert.match(field.stop.message, /decode failure/);
    assert.equal(field.bgm.voices.length, 0);
    assert.equal(field.checkpointReady, false);
  },
);
check(
  "replacement keeps a pending Sync tied to current source channel rather than an old handle",
  () => {
    const field = new FieldGame(content(syncCall.op));
    field.bgm.play(oneShotId, 0, 0, duration - 0.025, media);
    field.startEvent("probe");
    field.bgm.play(loopId, 0, 0, 0, media);
    field.advance(1000);
    assert.equal(field.stop, null);
    assert.equal(field.busy, true);
    assert.equal(field.bgm.voices.length, 1);
    field.bgm.stop(0, 3);
    field.advance(10);
    assert.equal(field.busy, false);
    assert.equal(field.bgm.voices.length, 1);
    assert.ok(field.bgm.voices[0].stop);
  },
);
check(
  "stable audio checkpoint restoration recreates completion without serializing decoded buffers",
  () => {
    const field = new FieldGame(content(syncCall.op));
    field.bgm.play(oneShotId, 0, 0, duration - 1, media);
    const saved = field.checkpoint(),
      restored = FieldGame.restore(content(syncCall.op), saved);
    assert.deepEqual(restored.bgm.snapshot(), field.bgm.snapshot());
    for (const owner of [field, restored]) {
      owner.startEvent("probe");
      owner.advance(1010);
      assert.equal(owner.busy, false);
      assert.equal(owner.stop, null);
    }
    assert.deepEqual(restored.bgm.snapshot(), field.bgm.snapshot());
  },
);
const codeBindings = {};
for (const file of [
  "core/audio-readiness",
  "core/static-audio",
  "core/field",
  "compiler/audio-readiness",
  "compiler/field",
])
  codeBindings[file] = sha(
    await readFile(resolve(compiled, "src", file + ".js")),
  );
const report = {
  formatVersion: 1,
  kind: "source-audio-readiness-check",
  sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  bgmSourceSetHash: media.sourceSetHash,
  nativeReportSha256: sha(nativeBytes),
  nativeSemanticsVerified: native.semanticsVerified,
  codeBindings,
  sourceCallCount: calls.length,
  readyCallCount: 1,
  syncCallCount: 54,
  sourceCalls: calls,
  ownerProbes: probes,
  fieldProbes,
  controlled,
  media: {
    oneShotId,
    loopId,
    validatedTracks: Object.keys(media.tracks).length,
  },
  limitations: [
    "Exact source sites and validated source FLAC geometry run in controlled field/audio hosts; this is not full-script or map reachability.",
    "Decoded-buffer readiness is explicitly supplied. No browser decode, audible or original-game timing claim is made by this check.",
    "Source Sync waits for a channel to finish, not a musical timestamp. Looping music remains pending until another operation finishes or detaches that channel.",
    "Full new-game prelude, LoadBGM/SE readiness, synchronous PlayBGM and active-task save/restore remain outside this check.",
  ],
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, bytes);
console.log(
  JSON.stringify(
    {
      sourceCalls: calls.length,
      ownerProbes: probes.length,
      fieldProbes: fieldProbes.length,
      controlledChecks: controlled.length,
      nativeChecks: native.checks.length,
      reportSha256: sha(bytes),
      reportPath,
    },
    null,
    2,
  ),
);
