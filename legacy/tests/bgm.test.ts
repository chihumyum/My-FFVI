import test from "node:test";
import assert from "node:assert/strict";
import {
  StaticAudioState,
  audioGain,
  audioPosition,
  type AudioMedia,
} from "../src/core/static-audio.js";
import { decodeFieldOp } from "../src/compiler/field.js";

const source = {
  file: "synthetic",
  assetPath: "bgm",
  objectId: "9007199254740993",
};
const track = {
  file: "synthetic.flac",
  sha256: "synthetic",
  sampleRate: 44100,
  frames: 441000,
  channels: 2,
  loop: null,
  source,
  tableSource: source,
};
const media: AudioMedia = {
  sourceSetHash: "synthetic",
  tracks: { 1: track, 2: { ...track, loop: { start: 88200, end: 352800 } } },
};
const site = { script: "event", index: 0, source };
const op = (mnemonic: string, iValues: number[], rValues: number[] = []) =>
  decodeFieldOp(
    { mnemonic, type: 1, operands: { iValues, rValues, sValues: [] } },
    site,
    {},
  );

test("BGM decoding preserves channels/fade/seek and refuses synchronous playback and negative fades", () => {
  assert.deepEqual(op("PlayBGM", [17, 1, 1], [0.7, 2]), {
    ...site,
    kind: "bgm-play",
    track: 17,
    channel: 1,
    fade: Math.fround(0.7),
    seek: 2,
  });
  for (const bad of [
    op("PlayBGM", [17, 0, 0]),
    op("PlayBGM", [17, 1, 2]),
    op("PlayBGM", [17, 1, 0], [0, 0, 1]),
    op("StopBGM", [0], [-1.4]),
  ])
    assert.equal(bad.kind, "blocked");
  assert.deepEqual(op("StopBGM", [1], [0.35]), {
    ...site,
    kind: "bgm-stop",
    channel: 1,
    fade: Math.fround(0.35),
  });
});

test("music retains its introduction once, loops source samples, and expires one-shot tracks", () => {
  const bgm = new StaticAudioState();
  const id = bgm.play(2, 0, 0, 0, media);
  bgm.advance(1000, media);
  assert.equal(audioPosition(bgm.voices[0]!, bgm.time, media.tracks[2]!), 1);
  assert.equal(bgm.play(2, 0, 0.7, 0, media), id);
  bgm.advance(7000, media);
  assert.equal(audioPosition(bgm.voices[0]!, bgm.time, media.tracks[2]!), 2);
  bgm.advance(6500, media);
  assert.equal(audioPosition(bgm.voices[0]!, bgm.time, media.tracks[2]!), 2.5);
  const first = bgm.play(1, 1, 0, 0, media);
  bgm.advance(10000, media);
  assert.equal(bgm.voices.length, 1);
  assert.notEqual(bgm.play(1, 1, 0, 0, media), first);
});

test("source channel replacement fades the previous voice and invalid media cannot silence it", () => {
  const bgm = new StaticAudioState();
  bgm.play(2, 0, 1, 0, media);
  bgm.advance(500, media);
  assert.equal(audioGain(bgm.voices[0]!, bgm.time), 0.5);
  const before = bgm.snapshot();
  assert.throws(() => bgm.play(99, 0, 0, 0, media), /Missing audio media/);
  assert.deepEqual(bgm.snapshot(), before);
  bgm.play(1, 0, 0, 2, media);
  bgm.advance(250, media);
  assert.equal(bgm.voices.length, 2);
  assert.equal(audioGain(bgm.voices[0]!, bgm.time), 0.25);
  bgm.advance(250, media);
  assert.equal(bgm.voices.length, 1);
  assert.equal(audioPosition(bgm.voices[0]!, bgm.time, track), 2.5);
  bgm.stop(0, 0.2);
  assert.equal(bgm.snapshot().channels[0], null);
  bgm.advance(200, media);
  assert.equal(bgm.voices.length, 0);
});

test("BGM snapshots are isolated and keep playback position across a staged map load", () => {
  const original = new StaticAudioState();
  const id = original.play(2, 0, 0, 0, media);
  original.advance(3000, media);
  const snapshot = original.snapshot(),
    next = new StaticAudioState(snapshot);
  next.play(2, 0, 0, 0, media);
  assert.equal(next.voices[0]!.id, id);
  assert.equal(audioPosition(next.voices[0]!, next.time, media.tracks[2]!), 3);
  next.stop(0, 0);
  assert.equal(original.voices.length, 1);
  snapshot.voices[0]!.seek = 9;
  assert.equal(original.voices[0]!.seek, 0);
});

test("environment decoding accepts source static channels but rejects unreviewed seeks and mixer controls", () => {
  assert.deepEqual(op("PlayEnvSe", [944, 1, 1], [0.5, 0, 0]), {
    ...site,
    kind: "environment-play",
    track: 944,
    channel: 1,
    fade: 0.5,
    seek: 0,
  });
  assert.deepEqual(op("StopEnvSe", [1], [0.5]), {
    ...site,
    kind: "environment-stop",
    channel: 1,
    fade: 0.5,
  });
  for (const bad of [
    op("PlayEnvSe", [944, 0, 0]),
    op("PlayEnvSe", [944, 1, 2]),
    op("PlayEnvSe", [944, 1, 0], [0, 0.5]),
    op("PlayEnvSe", [944, 1, 0], [0, 0, 1]),
    op("StopEnvSe", [0], [-1]),
    op("PauseEnvSe", [0]),
    op("PitchEnvSe", [0], [0.5]),
  ])
    assert.equal(bad.kind, "blocked");
});

test("shared PCM retains distinct bank gains and source envelopes through a stop fade", () => {
  const quiet = { ...track, gain: 0.2, gainRamp: null };
  const ramped = {
    ...track,
    gain: 0.5,
    gainRamp: { from: 0, to: 1, durationMs: 600 },
  };
  const envMedia = { ...media, tracks: { 1: quiet, 2: ramped } };
  const state = new StaticAudioState();
  state.play(1, 0, 0, 0, envMedia);
  state.play(2, 1, 1, 0, envMedia);
  assert.equal(quiet.sha256, ramped.sha256);
  state.advance(300, envMedia);
  assert.equal(audioGain(state.voices[0]!, state.time, quiet), 0.2);
  assert.equal(audioGain(state.voices[1]!, state.time, ramped), 0.075);
  state.stop(1, 0.3);
  state.advance(150, envMedia);
  assert.equal(
    audioGain(state.voices[1]!, state.time, ramped),
    0.5 * 0.75 * 0.3 * 0.5,
  );
  state.advance(150, envMedia);
  assert.equal(state.voices.length, 1);
  assert.equal(state.voices[0]!.track, 1);
});
