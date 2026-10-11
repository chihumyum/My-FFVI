import test from "node:test";
import assert from "node:assert/strict";
import {
  audioReadinessTrack,
  pollAudioReadiness,
  type AudioReadinessOp,
  type AudioReadinessPort,
} from "../src/core/audio-readiness.js";
import {
  StaticAudioState,
  type AudioMedia,
  type AudioTrack,
} from "../src/core/static-audio.js";
import { compileAudioReadinessInstruction } from "../src/compiler/audio-readiness.js";

const track = (loop: AudioTrack["loop"], sha256: string): AudioTrack => ({
  file: "/controlled/" + sha256 + ".flac",
  sha256,
  sampleRate: 1000,
  frames: 2000,
  channels: 2,
  loop,
  source: { file: "controlled", assetPath: "controlled-audio" },
  tableSource: { file: "controlled", assetPath: "controlled-bgm-table" },
});
const media: AudioMedia = {
  sourceSetHash: "controlled-audio-set",
  tracks: {
    1: track(null, "a".repeat(64)),
    2: track({ start: 500, end: 1500 }, "b".repeat(64)),
    3: track(null, "c".repeat(64)),
  },
};
const ready: AudioReadinessOp = { kind: "bgm-ready", track: 1 },
  sync0: AudioReadinessOp = { kind: "bgm-sync", channel: 0 },
  sync1: AudioReadinessOp = { kind: "bgm-sync", channel: 1 };
const raw = (mnemonic: string, value: number) => ({
  type: 1,
  mnemonic,
  operands: {
    iValues: [value, ...Array<number>(7).fill(0)],
    rValues: Array<number>(8).fill(0),
    sValues: Array<string>(8).fill(""),
  },
});

test("Ready polls explicit asset completion and never starts or advances playback", () => {
  const audio = new StaticAudioState(),
    before = audio.snapshot(),
    observed: string[] = [];
  let loaded = false;
  const port = {
    isReady: (asset: AudioTrack) => {
      observed.push(asset.sha256);
      return loaded;
    },
  };
  assert.equal(pollAudioReadiness(ready, audio, media, port), "wait");
  assert.equal(pollAudioReadiness(ready, audio, media, port), "wait");
  loaded = true;
  assert.equal(pollAudioReadiness(ready, audio, media, port), "next");
  assert.deepEqual(audio.snapshot(), before);
  assert.deepEqual(observed, Array(3).fill(media.tracks[1]!.sha256));
});

test("missing resource, missing host and nonboolean observations cannot complete Ready", () => {
  const audio = new StaticAudioState();
  assert.throws(() => pollAudioReadiness(ready, audio), /Missing BGM.*media/);
  assert.throws(() => pollAudioReadiness(ready, audio, media), /provider/);
  for (const value of [undefined, null, 0, 1, "ready", Promise.resolve(true)])
    assert.throws(
      () =>
        pollAudioReadiness(ready, audio, media, {
          isReady: () => value,
        } as unknown as AudioReadinessPort),
      /observation/,
    );
  assert.throws(
    () =>
      pollAudioReadiness(ready, audio, media, {
        isReady: () => {
          throw new Error("Decoded asset hash mismatch");
        },
      }),
    /hash mismatch/,
  );
  assert.equal(audio.voices.length, 0);
});

test("readiness follows asset identity across media changes and does not expose mutable content", () => {
  const decoded = new Set([media.tracks[1]!.sha256]),
    port = { isReady: (asset: AudioTrack) => decoded.has(asset.sha256) },
    audio = new StaticAudioState(),
    changed = structuredClone(media);
  changed.tracks[1]!.sha256 = "d".repeat(64);
  assert.equal(pollAudioReadiness(ready, audio, media, port), "next");
  assert.equal(pollAudioReadiness(ready, audio, changed, port), "wait");
  const copy = audioReadinessTrack(1, media);
  copy.source.assetPath = "mutated";
  assert.equal(media.tracks[1]!.source.assetPath, "controlled-audio");
});

test("Sync completes an empty channel immediately without a resource provider", () => {
  const audio = new StaticAudioState(),
    before = audio.snapshot();
  assert.equal(pollAudioReadiness(sync0, audio), "next");
  assert.equal(pollAudioReadiness(sync1, audio), "next");
  assert.deepEqual(audio.snapshot(), before);
});

test("Sync keeps a loading or paused logical voice pending until its owner finishes", () => {
  const audio = new StaticAudioState();
  audio.play(1, 0, 0, 0, media);
  assert.equal(
    pollAudioReadiness(ready, audio, media, { isReady: () => false }),
    "wait",
  );
  const paused = audio.snapshot();
  for (let i = 0; i < 10; i++)
    assert.equal(pollAudioReadiness(sync0, audio, media), "wait");
  assert.deepEqual(audio.snapshot(), paused);
  audio.advance(1999, media);
  assert.equal(pollAudioReadiness(sync0, audio, media), "wait");
  audio.advance(1, media);
  assert.equal(pollAudioReadiness(sync0, audio, media), "next");
});

test("Sync uses the selected channel, honors seek, and preserves completion across frame partitioning", () => {
  const one = new StaticAudioState(),
    split = new StaticAudioState();
  for (const audio of [one, split]) {
    audio.play(1, 0, 0, 1.5, media);
    audio.play(2, 1, 0, 0, media);
  }
  one.advance(500, media);
  for (const step of [101, 99, 200, 100]) split.advance(step, media);
  assert.deepEqual(one.snapshot(), split.snapshot());
  assert.equal(pollAudioReadiness(sync0, one, media), "next");
  assert.equal(pollAudioReadiness(sync1, one, media), "wait");
});

test("looping BGM never acquires a guessed timeout", () => {
  const audio = new StaticAudioState();
  audio.play(2, 0, 0, 0, media);
  audio.advance(1_000_000, media);
  assert.equal(pollAudioReadiness(sync0, audio, media), "wait");
});

test("Stop releases Sync immediately while the detached fade tail remains audible", () => {
  const audio = new StaticAudioState();
  audio.play(2, 0, 0, 0, media);
  audio.advance(300, media);
  audio.stop(0, 2);
  assert.equal(audio.voices.length, 1);
  assert.notEqual(audio.voices[0]!.stop, null);
  assert.equal(pollAudioReadiness(sync0, audio, media), "next");
});

test("Sync polls live channel ownership after replacement, rather than a captured voice", () => {
  const audio = new StaticAudioState();
  audio.play(1, 0, 0, 1.9, media);
  assert.equal(pollAudioReadiness(sync0, audio, media), "wait");
  audio.play(2, 0, 0, 0, media);
  audio.advance(3000, media);
  assert.equal(pollAudioReadiness(sync0, audio, media), "wait");
  assert.equal(audio.voices.length, 1);
  assert.equal(audio.voices[0]!.track, 2);
});

test("saved audio ownership drives Sync without saving or reusing external readiness", () => {
  const audio = new StaticAudioState();
  audio.play(1, 0, 0, 1, media);
  audio.advance(300, media);
  const restored = StaticAudioState.restore(audio.snapshot(), media);
  assert.equal(pollAudioReadiness(sync0, restored, media), "wait");
  assert.throws(() => pollAudioReadiness(ready, restored, media), /provider/);
  for (const owner of [audio, restored]) owner.advance(700, media);
  assert.equal(pollAudioReadiness(sync0, restored, media), "next");
  assert.deepEqual(restored.snapshot(), audio.snapshot());
});

test("corrupt channel ownership and missing active media remain errors, not completion", () => {
  const audio = new StaticAudioState();
  audio.play(1, 0, 0, 0, media);
  assert.throws(() => pollAudioReadiness(sync0, audio), /Missing BGM.*media/);
  const corrupt = audio.snapshot();
  corrupt.voices = [];
  assert.throws(
    () => pollAudioReadiness(sync0, new StaticAudioState(corrupt), media),
    /ownership/,
  );
  assert.throws(
    () =>
      pollAudioReadiness(
        { kind: "bgm-sync", channel: 2 } as unknown as AudioReadinessOp,
        audio,
        media,
      ),
    /channel/,
  );
});

test("decoder distinguishes master identity from static channel and rejects unsupported forms", () => {
  assert.deepEqual(compileAudioReadinessInstruction(raw("ReadyBGM", 1)), ready);
  assert.deepEqual(compileAudioReadinessInstruction(raw("SyncBGM", 0)), sync0);
  assert.deepEqual(compileAudioReadinessInstruction(raw("SyncBGM", 1)), sync1);
  for (const input of [
    raw("ReadyBGM", 0),
    raw("ReadyBGM", -1),
    raw("ReadyBGM", 0x80000000),
    raw("ReadyBGM", 1.2),
    raw("SyncBGM", 2),
    raw("SyncBGM", -1),
    raw("ReadySE", 1),
    raw("LoadBGM", 1),
    { ...raw("ReadyBGM", 1), type: 2 },
    ...["iValues", "rValues", "sValues"].flatMap((field) => {
      const extra = raw("ReadyBGM", 1),
        short = raw("ReadyBGM", 1);
      if (field === "sValues") extra.operands.sValues[1] = "source-ref";
      else if (field === "iValues") extra.operands.iValues[1] = 1;
      else extra.operands.rValues[1] = 1;
      short.operands[field as keyof typeof short.operands].pop();
      return [extra, short];
    }),
  ])
    assert.throws(() => compileAudioReadinessInstruction(input));
});
