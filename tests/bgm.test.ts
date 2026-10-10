import test from "node:test";
import assert from "node:assert/strict";
import {
  BgmState,
  bgmGain,
  bgmPosition,
  type BgmMedia,
} from "../src/core/bgm.js";
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
const media: BgmMedia = {
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
  const bgm = new BgmState();
  const id = bgm.play(2, 0, 0, 0, media);
  bgm.advance(1000, media);
  assert.equal(bgmPosition(bgm.voices[0]!, bgm.time, media.tracks[2]!), 1);
  assert.equal(bgm.play(2, 0, 0.7, 0, media), id);
  bgm.advance(7000, media);
  assert.equal(bgmPosition(bgm.voices[0]!, bgm.time, media.tracks[2]!), 2);
  bgm.advance(6500, media);
  assert.equal(bgmPosition(bgm.voices[0]!, bgm.time, media.tracks[2]!), 2.5);
  const first = bgm.play(1, 1, 0, 0, media);
  bgm.advance(10000, media);
  assert.equal(bgm.voices.length, 1);
  assert.notEqual(bgm.play(1, 1, 0, 0, media), first);
});

test("source channel replacement fades the previous voice and invalid media cannot silence it", () => {
  const bgm = new BgmState();
  bgm.play(2, 0, 1, 0, media);
  bgm.advance(500, media);
  assert.equal(bgmGain(bgm.voices[0]!, bgm.time), 0.5);
  const before = bgm.snapshot();
  assert.throws(() => bgm.play(99, 0, 0, 0, media), /Missing BGM media/);
  assert.deepEqual(bgm.snapshot(), before);
  bgm.play(1, 0, 0, 2, media);
  bgm.advance(250, media);
  assert.equal(bgm.voices.length, 2);
  assert.equal(bgmGain(bgm.voices[0]!, bgm.time), 0.25);
  bgm.advance(250, media);
  assert.equal(bgm.voices.length, 1);
  assert.equal(bgmPosition(bgm.voices[0]!, bgm.time, track), 2.5);
  bgm.stop(0, 0.2);
  assert.equal(bgm.snapshot().channels[0], null);
  bgm.advance(200, media);
  assert.equal(bgm.voices.length, 0);
});

test("BGM snapshots are isolated and keep playback position across a staged map load", () => {
  const original = new BgmState();
  const id = original.play(2, 0, 0, 0, media);
  original.advance(3000, media);
  const snapshot = original.snapshot(),
    next = new BgmState(snapshot);
  next.play(2, 0, 0, 0, media);
  assert.equal(next.voices[0]!.id, id);
  assert.equal(bgmPosition(next.voices[0]!, next.time, media.tracks[2]!), 3);
  next.stop(0, 0);
  assert.equal(original.voices.length, 1);
  snapshot.voices[0]!.seek = 9;
  assert.equal(original.voices[0]!.seek, 0);
});
