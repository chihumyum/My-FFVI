import test from "node:test";
import assert from "node:assert/strict";
import { FieldSoundState, type SoundSnapshot } from "../src/core/field-sound.js";
import type { FieldSoundCommand } from "../src/core/field-sound-command.js";
import { audioGain, audioPosition, type AudioMedia, type AudioTrack } from "../src/core/static-audio.js";

const track = (loop: AudioTrack["loop"] = null): AudioTrack => ({
  file: "/controlled/se.flac", sha256: "a".repeat(64), sampleRate: 1000,
  frames: 2000, channels: 2, loop,
  source: { file: "controlled", assetPath: "se" },
  tableSource: { file: "controlled", assetPath: "sound-table" },
});
const media: AudioMedia = { sourceSetHash: "controlled-se", tracks: {
  1: track(), 2: track({ start: 500, end: 1500 }),
} };
const play = (overrides: Partial<Extract<FieldSoundCommand, { kind: "play" }>> = {}):
Extract<FieldSoundCommand, { kind: "play" }> => ({
  kind: "play", soundId: 1, asynchronous: true, handleSlot: 0,
  fadeSeconds: 0, seekSeconds: 0, pan: 0, ...overrides,
});

test("same SE overlaps as distinct dynamic handles, independently of a reused local slot", () => {
  const sound = new FieldSoundState();
  const first = sound.play(play({ pan: -1 }), media),
    second = sound.play(play({ pan: 1 }), media),
    sync = sound.play(play({ asynchronous: false, handleSlot: 9 }), media);
  assert.deepEqual([first, second, sync], [1, 2, 3]);
  assert.deepEqual(sound.voices.map(voice => [voice.track, voice.pan]), [[1, -1], [1, 1], [1, 0]]);
  sound.stop(second, 0);
  assert.equal(sound.isPlaying(first), true);
  assert.equal(sound.isPlaying(second), false);
  assert.equal(sound.isPlaying(sync), true);
  assert.equal(sound.play(play(), media), 4);
  assert.deepEqual(Object.keys(sound.snapshot()).sort(), ["kind", "nextId", "time", "voices"]);
});

test("one-shot completion, seek and looping use the one logical clock", () => {
  const sound = new FieldSoundState(),
    short = sound.play(play({ seekSeconds: 1.5 }), media),
    loop = sound.play(play({ soundId: 2 }), media);
  const paused = sound.snapshot();
  for (let i = 0; i < 5; i++) assert.equal(sound.isPlaying(short), true);
  assert.deepEqual(sound.snapshot(), paused);
  sound.advance(499, media);
  assert.equal(sound.isPlaying(short), true);
  sound.advance(1, media);
  assert.equal(sound.isPlaying(short), false);
  sound.advance(3250, media);
  assert.equal(sound.isPlaying(loop), true);
  assert.equal(audioPosition(sound.voices[0]!, sound.time, media.tracks[2]!), 0.75);
  sound.advance(1_000_000, media);
  assert.equal(sound.isPlaying(loop), true);
});

test("dynamic Stop remains playing during its fade and stops at completion", () => {
  const sound = new FieldSoundState(), id = sound.play(play({ soundId: 2, fadeSeconds: 1 }), media);
  sound.advance(500, media);
  assert.equal(audioGain(sound.voices[0]!, sound.time), 0.5);
  sound.stop(id, 1);
  assert.equal(sound.isPlaying(id), true);
  sound.advance(500, media);
  assert.equal(sound.isPlaying(id), true);
  assert.equal(audioGain(sound.voices[0]!, sound.time), 0.25);
  sound.advance(499, media);
  assert.equal(sound.isPlaying(id), true);
  sound.advance(1, media);
  assert.equal(sound.isPlaying(id), false);
});

test("Web stop adaptation rebases repeated fades without a gain jump and natural completion still wins", () => {
  const sound = new FieldSoundState(), id = sound.play(play(), media);
  sound.stop(id, 2);
  sound.advance(500, media);
  sound.stop(id, 4);
  assert.equal(audioGain(sound.voices[0]!, sound.time), 0.75);
  sound.advance(1000, media);
  assert.equal(audioGain(sound.voices[0]!, sound.time), 0.5625);
  sound.advance(500, media);
  assert.equal(sound.isPlaying(id), false);
});

test("zero, negative, completed and unknown int32 handles do not select another voice", () => {
  const sound = new FieldSoundState(), id = sound.play(play(), media);
  for (const handle of [0, -1, -0x80000000, 1234, 0x7fffffff]) {
    const before = sound.snapshot();
    assert.equal(sound.isPlaying(handle), false);
    sound.stop(handle, 0.5);
    assert.deepEqual(sound.snapshot(), before);
  }
  sound.stop(id, 0);
  sound.stop(id, 2);
  assert.equal(sound.isPlaying(id), false);
  assert.equal(sound.time, 0);
});

test("invalid commands, fades and handles cannot change current voices or allocate an ID", () => {
  const sound = new FieldSoundState();
  sound.play(play(), media);
  const before = sound.snapshot();
  for (const command of [
    play({ soundId: 99 }), play({ soundId: 0 }), play({ soundId: 1.5 }),
    play({ fadeSeconds: -1 }), play({ fadeSeconds: Infinity }), play({ fadeSeconds: Number.MAX_VALUE }),
    play({ seekSeconds: -1 }), play({ seekSeconds: 2 }), play({ seekSeconds: NaN }),
    play({ pan: -1.01 }), play({ pan: 1.01 }), play({ pan: Infinity }),
    play({ handleSlot: -1 }), play({ handleSlot: 0x80000000 }),
    { ...play(), asynchronous: 1 } as unknown as ReturnType<typeof play>,
  ]) {
    assert.throws(() => sound.play(command, media));
    assert.deepEqual(sound.snapshot(), before);
  }
  assert.throws(() => sound.play(play()));
  for (const handle of [NaN, Infinity, 1.5, -0x80000001, 0x80000000]) {
    assert.throws(() => sound.stop(handle, 0));
    assert.throws(() => sound.isPlaying(handle));
  }
  for (const duration of [NaN, Infinity, -0.1, Number.MAX_VALUE])
    assert.throws(() => sound.stop(1, duration));
  assert.deepEqual(sound.snapshot(), before);
});

test("missing or malformed media blocks without advancing time or silently finishing a sound", () => {
  const sound = new FieldSoundState();
  sound.play(play(), media);
  const before = sound.snapshot();
  assert.throws(() => sound.advance(3000), /Missing field sound media/);
  for (const patch of [
    { sampleRate: 0 }, { sampleRate: NaN }, { frames: 0 }, { channels: 0 },
    { loop: { start: 500, end: 500 } }, { loop: { start: 500, end: 2001 } },
    { gain: NaN }, { gainRamp: { from: 0, to: 1, durationMs: 0 } },
  ]) {
    const broken = structuredClone(media);
    Object.assign(broken.tracks[1]!, patch);
    assert.throws(() => sound.advance(3000, broken));
    assert.throws(() => sound.play(play(), broken));
    assert.deepEqual(sound.snapshot(), before);
  }
  for (const ms of [NaN, Infinity, -1, Number.MAX_VALUE]) assert.throws(() => sound.advance(ms, media));
  assert.deepEqual(sound.snapshot(), before);
  const silent = new FieldSoundState();
  silent.advance(100);
  assert.equal(silent.time, 100);
});

test("active sounds, loop position and stop tails survive JSON restore and frame partitioning", () => {
  const original = new FieldSoundState();
  original.play(play({ soundId: 2, seekSeconds: 1, fadeSeconds: 1, pan: -0.3 }), media);
  original.play(play({ seekSeconds: 0.4, pan: 0.5 }), media);
  original.advance(300, media);
  original.stop(1, 2);
  const restored = FieldSoundState.restore(JSON.parse(JSON.stringify(original.snapshot())) as SoundSnapshot, media);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  original.advance(1300, media);
  for (const ms of [101, 199, 200, 800]) restored.advance(ms, media);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.equal(restored.isPlaying(2), false);
  assert.equal(restored.isPlaying(1), true);
  for (const owner of [original, restored]) owner.advance(700, media);
  assert.deepEqual(restored.snapshot(), original.snapshot());
  assert.equal(restored.voices.length, 0);
  assert.equal(restored.play(play(), media), 3);
});

test("snapshots, restored input and voice projections cannot mutate the sound owner", () => {
  const sound = new FieldSoundState();
  sound.play(play(), media);
  sound.stop(1, 1);
  const before = sound.snapshot(), input = sound.snapshot(), restored = FieldSoundState.restore(input, media);
  input.voices[0]!.pan = 100;
  input.voices[0]!.stop!.gain = 100;
  const projected = sound.voices;
  projected[0]!.pan = 10;
  projected[0]!.stop!.duration = 0;
  assert.deepEqual(sound.snapshot(), before);
  assert.deepEqual(restored.snapshot(), before);
});

test("restore rejects wrong shape, handles, dependencies, expired voices and invalid voice geometry", () => {
  const sound = new FieldSoundState();
  sound.play(play(), media);
  sound.advance(500, media);
  sound.stop(1, 1);
  const before = sound.snapshot();
  const mutations: ((snapshot: SoundSnapshot) => void)[] = [
    s => { Object.assign(s, { kind: "field-sound-state-v0" }); },
    s => { Object.assign(s, { channels: [1, null] }); },
    s => { s.time = -1; }, s => { s.time = Infinity; },
    s => { s.nextId = 0; }, s => { s.nextId = 1; }, s => { s.nextId = 0x80000001; },
    s => { s.voices.push(structuredClone(s.voices[0]!)); },
    s => { s.voices[0]!.id = 0; }, s => { s.voices[0]!.id = -1; },
    s => { s.voices[0]!.track = 99; }, s => { s.voices[0]!.started = 501; },
    s => { s.voices[0]!.seek = 2; }, s => { s.voices[0]!.fadeIn = -1; },
    s => { s.voices[0]!.pan = 1.01; }, s => { s.voices[0]!.stop!.at = 501; },
    s => { s.voices[0]!.stop!.duration = -1; }, s => { s.voices[0]!.stop!.gain = 1.01; },
    s => { s.time = 1500; }, s => { s.voices[0]!.stop = null; s.time = 2000; },
  ];
  for (const mutate of mutations) {
    const corrupt = structuredClone(before);
    mutate(corrupt);
    assert.throws(() => FieldSoundState.restore(corrupt, media));
    assert.deepEqual(sound.snapshot(), before);
  }
  assert.throws(() => FieldSoundState.restore(before), /Missing field sound media/);
});

test("the last positive int32 handle is usable once and exhaustion never wraps into a local value", () => {
  const seed: SoundSnapshot = { kind: "field-sound-state-v1", time: 0, nextId: 0x7fffffff, voices: [] },
    sound = FieldSoundState.restore(seed, media);
  assert.equal(sound.play(play(), media), 0x7fffffff);
  assert.equal(sound.snapshot().nextId, 0x80000000);
  const before = sound.snapshot();
  assert.throws(() => sound.play(play(), media), /exhausted/);
  assert.deepEqual(sound.snapshot(), before);
  sound.stop(0x7fffffff, 0);
  const restored = FieldSoundState.restore(sound.snapshot(), media);
  assert.throws(() => restored.play(play(), media), /exhausted/);
});

test("time and fade overflow fail before publication", () => {
  const sound = FieldSoundState.restore({ kind: "field-sound-state-v1",
    time: Number.MAX_SAFE_INTEGER - 10, nextId: 1, voices: [] }, media);
  sound.play(play(), media);
  const before = sound.snapshot();
  assert.throws(() => sound.advance(20, media));
  assert.throws(() => sound.play(play({ fadeSeconds: 1 }), media));
  assert.throws(() => sound.stop(1, 1));
  assert.deepEqual(sound.snapshot(), before);
});
